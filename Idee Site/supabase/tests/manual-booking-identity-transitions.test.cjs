// Disposable PostgreSQL only. No hosted Auth, production data or mail delivery.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const directory=join(__dirname,'..');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=readFileSync(join(directory,'043_manual_booking_identity_preservation.sql'),'utf8');

async function fixture(){
 const pg=new PGlite();
 let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replace('create table public.rezervari (\n  id uuid primary key default gen_random_uuid()',
  'create table public.rezervari (\n  id bigint generated always as identity primary key');
 await pg.exec(schema);
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 for(const file of readdirSync(directory).filter(file=>/^\d{3}_.*\.sql$/.test(file)&&Number(file.slice(0,3))>=1&&Number(file.slice(0,3))<=42).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
 const root=async(q,p=[])=>{
  await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
  return pg.query(q,p);
 };
 const as=async(person,q,p=[])=>{
  await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(person)]);
  await pg.exec('set role authenticated');return pg.query(q,p);
 };
 let day=1;
 const manual=async(owner=1,email='alice@example.test')=>(await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,pret_total,stare)values($1,$2,'Court A','Fotbal',$3,'18:00','50 RON','activa')returning id::text",[email,owner?uid(owner):null,`2000-01-${String(day++).padStart(2,'0')}`])).rows[0].id;
 const identity=async id=>(await root('select r.client_user_id,r.email_client,i.customer_user_id from public.rezervari r left join spotivity_private.reservation_account_identities i on i.reservation_id=r.id::text where r.id::text=$1',[id])).rows[0];
 const snapshot=async()=>{
  const result={};
  for(const table of ['public.rezervari','spotivity_private.reservation_account_identities','spotivity_private.booking_groups','spotivity_private.booking_attendance','spotivity_private.notification_outbox'])result[table]=(await root(`select to_jsonb(r)row from ${table} r order by to_jsonb(r)::text`)).rows;
  return result;
 };
 const migrate=async()=>{await root('select 1');await pg.exec(migration);};
 return{pg,root,as,manual,identity,snapshot,migrate};
}

test('manual contact updates preserve exact account and guest identities',async t=>{
 const {pg,root,as,manual,identity,snapshot,migrate}=await fixture();
 try{
  const superRow=await manual(),managerRow=await manual(),caseRow=await manual(1,' Alice@Example.Test '),guestRow=await manual(null),reassignedRow=await manual();
  await root('delete from auth.users where id=$1',[uid(1)]);
  await root("insert into auth.users(id,email,email_confirmed_at)values($1,'alice@example.test',statement_timestamp())",[uid(90)]);
  await manual(90); // A real separate booking gives ordinary staff access to the new customer.
  await manual(2,'bob@example.test');

  await t.test('installation checks predecessor sources and trigger wiring, and never rewrites bookings or mail',async()=>{
   const before=await snapshot();
   const saved=(await root('delete from spotivity_private.migrations where version=42 returning *')).rows[0];
   await assert.rejects(migrate,/Apply 042 before 043/);await pg.exec('rollback');
   await root('insert into spotivity_private.migrations(version,applied_at)values($1,$2)',[saved.version,saved.applied_at]);
   const definition=(await root("select pg_get_functiondef('spotivity_private.guard_booking()'::regprocedure)definition")).rows[0].definition;
   await root(definition.replace('begin\n','begin\n perform 1;\n'));
   await assert.rejects(migrate,/Review spotivity_private.guard_booking/);await pg.exec('rollback');await root(definition);
   await root('alter table public.rezervari disable trigger spotivity_booking_guard');
   await assert.rejects(migrate,/Review spotivity_booking_guard/);await pg.exec('rollback');
   await root('alter table public.rezervari enable trigger spotivity_booking_guard');
   await migrate();assert.deepEqual(await snapshot(),before);
   assert.equal((await root("select pg_get_functiondef('spotivity_private.guard_booking()'::regprocedure)definition")).rows[0].definition,definition);
   await migrate();assert.deepEqual(await snapshot(),before);
   for(const role of ['anon','authenticated','service_role'])assert.equal((await root("select has_function_privilege($1,'spotivity_private.preserve_manual_booking_identity()','execute')allowed",[role])).rows[0].allowed,false);
  });

  await t.test('price-only edits by superadmin and ordinary staff retain the deleted UUID',async()=>{
   for(const [person,id]of [[4,superRow],[3,managerRow],[3,caseRow]]){
    const before=await identity(id);
    await as(person,"update public.rezervari set pret_total='55 RON'where id::text=$1",[id]);
    assert.deepEqual(await identity(id),before,'Neither a live owner nor a durable identity is inferred from the reused address');
    assert.equal(before.customer_user_id,uid(1));assert.equal(before.client_user_id,null);
    const recorded=(await as(3,"select public.set_legacy_booking_attendance($1,'no_show',0,null)value",[id])).rows[0].value;
    assert.equal(recorded.email_queued,false);
    assert.equal((await root('select customer_user_id from spotivity_private.booking_attendance where booking_id=$1',[recorded.booking_id])).rows[0].customer_user_id,uid(1));
   }
  });

  await t.test('the new account cannot read or cancel an older reservation with its mailbox',async()=>{
   assert.equal((await as(90,'select id from public.rezervari where id::text=$1',[superRow])).rows.length,0);
   assert.equal((await as(90,"update public.rezervari set stare='anulata'where id::text=$1 returning id",[managerRow])).rows.length,0);
   assert.equal((await root('select stare from public.rezervari where id::text=$1',[managerRow])).rows[0].stare,'activa');
  });

  await t.test('a genuine guest stays a guest when its unchanged address matches a known account',async()=>{
   await as(3,"update public.rezervari set pret_total='60 RON'where id::text=$1",[guestRow]);
   assert.deepEqual(await identity(guestRow),{client_user_id:null,email_client:'alice@example.test',customer_user_id:null});
   const recorded=(await as(3,"select public.set_legacy_booking_attendance($1,'no_show',0,null)value",[guestRow])).rows[0].value;
   assert.equal(recorded.email_queued,true);
   assert.equal((await root('select customer_user_id from spotivity_private.booking_attendance where booking_id=$1',[recorded.booking_id])).rows[0].customer_user_id,null);
  });

  await t.test('a different contact and a new manual booking still use the permitted staff assignment',async()=>{
   await as(3,"update public.rezervari set email_client=' BOB@EXAMPLE.TEST 'where id::text=$1",[reassignedRow]);
   assert.deepEqual(await identity(reassignedRow),{client_user_id:uid(2),email_client:'bob@example.test',customer_user_id:uid(2)});
   const inserted=(await as(3,"insert into public.rezervari(email_client,teren,sport,data_str,ora,pret_total,stare)values('bob@example.test','Court A','Fotbal','2000-02-01','18:00','50 RON','activa')returning id::text")).rows[0].id;
   assert.equal((await identity(inserted)).customer_user_id,uid(2));
   await root("update public.rezervari set email_client='new-guest@example.test',client_user_id=null where id::text=$1",[reassignedRow]);
   assert.equal((await identity(reassignedRow)).customer_user_id,null,'Explicit trusted contact replacement still clears the old fallback');
  });

  await t.test('reapplication rejects a disabled identity guard',async()=>{
   await root('alter table public.rezervari disable trigger spotivity_booking_identity_guard');
   await assert.rejects(migrate,/Review the manual booking identity guard/);await pg.exec('rollback');
   await root('alter table public.rezervari enable trigger spotivity_booking_identity_guard');
   const before=await snapshot();await migrate();assert.deepEqual(await snapshot(),before);
  });
 }finally{await pg.close();}
});
