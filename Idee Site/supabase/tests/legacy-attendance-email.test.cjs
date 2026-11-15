// Disposable PostgreSQL only. This test never calls hosted Auth, Storage or mail.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const directory=join(__dirname,'..');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=readFileSync(join(directory,'040_legacy_attendance_email_contract.sql'),'utf8');

async function fixture(){
 const pg=new PGlite();
 let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
 await pg.exec(schema);
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 for(const file of readdirSync(directory).filter(file=>/^\d{3}_.*\.sql$/.test(file)&&Number(file.slice(0,3))>=1&&Number(file.slice(0,3))<=39).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
 const root=async(query,params=[])=>{
  await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
  return pg.query(query,params);
 };
 const as=async(person,query,params=[])=>{
  await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[person?uid(person):'']);
  await pg.exec('set role '+(person?'authenticated':'anon'));return pg.query(query,params);
 };
 let sequence=0;
 const seed=async(email,{owner=null,court='Court A',offset=-1}={})=>{
  const day=offset<0?offset-sequence++:offset;
  return (await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,pret_total,stare)values($1,$2,$3,'Fotbal',((statement_timestamp()at time zone'Europe/Bucharest')::date+$4::integer)::text,'18:00','50,5 RON','activa')returning id::text",[email,owner?uid(owner):null,court,day])).rows[0].id;
 };
 const get=(id,person=3)=>as(person,'select public.get_legacy_booking_attendance($1::text[])value',[[id]]).then(r=>r.rows[0].value);
 const mark=(id,email=null,{person=3,status='no_show',revision=0}={})=>as(person,'select public.set_legacy_booking_attendance($1,$2,$3,$4)value',[id,status,revision,email]).then(r=>r.rows[0].value);
 const counts=()=>root('select (select count(*)from spotivity_private.booking_groups)groups,(select count(*)from spotivity_private.legacy_attendance_bookings)links,(select count(*)from spotivity_private.booking_attendance)attendance,(select count(*)from spotivity_private.booking_attendance_events)events,(select count(*)from spotivity_private.notification_outbox)jobs').then(r=>r.rows[0]);
 return {pg,root,as,seed,get,mark,counts};
}

test('legacy attendance uses the same contact validation as booking and mail while retaining authorization and identity',async t=>{
 const f=await fixture(),{pg,root,as,seed,get,mark,counts}=f;
 try{
  // These first two addresses matched the older035 regex but are rejected by
  // the shared038 validator. The reservation remains a historical fixture.
  const malformed=['a\ufeffb@example.test','é'.repeat(124)+'@test.example',null,'','Client fără email'];
  const records=[];
  for(const email of malformed)records.push({email,id:await seed(email)});
  const valid=await seed(' Valid+tag@Example.Test ');
  const account=await seed('alice@example.test',{owner:1});
  const foreign=await seed('Client without email',{court:'Court B'});
  const future=await seed('Client without email',{offset:2});
  const blocked=await seed('Teren Blocat');
  const before=(await root('select to_jsonb(r)value from public.rezervari r order by id')).rows;
  const beforeCounts=await counts();await root('select 1');await pg.exec(migration);
  assert.deepEqual(await counts(),beforeCounts,'Installation does not materialize contacts, incidents or mail');
  assert.deepEqual((await root('select to_jsonb(r)value from public.rezervari r order by id')).rows,before);
  await root('select 1');await pg.exec(migration);assert.deepEqual(await counts(),beforeCounts,'Reapplying the reviewed040 is safe');

  await t.test('missing or undeliverable legacy guest contacts expose an email input and reject invalid values without side effects',async()=>{
   for(const {id}of records){
    const record=(await get(id))[0];assert.ok(record,'Even a NULL-contact historical reservation is visible');assert.equal(record.can_mark,true);assert.equal(record.needs_email,true);
    const unchanged=await counts();
    for(const email of [null,'invalid','a\ufeffb@example.test','é'.repeat(124)+'@test.example'])await assert.rejects(()=>mark(id,email),e=>e.code==='22023'&&/client email/.test(e.message));
    assert.deepEqual(await counts(),unchanged,'An unusable address never commits a private group, incident or notice');
   }
  });

  await t.test('explicit corrected contacts record one no-show and one addressed notice without rewriting the reservation',async()=>{
   for(let index=0;index<records.length;index++){
    const {id}=records[index],email=index===0?'alice@example.test':`corrected-${index}@example.test`;
    const result=await mark(id,email);assert.equal(result.email_queued,true);assert.equal(result.needs_email,false);
    const group=(await root('select owner_auth_id,contact_email,total from spotivity_private.booking_groups where id=$1',[result.booking_id])).rows[0];
    assert.equal(group.owner_auth_id,null,'Supplying an email never binds a guest to an Auth account');assert.equal(group.contact_email,email);assert.equal(Number(group.total),50.5);
    const jobs=(await root('select id,kind from spotivity_private.notification_outbox where booking_id=$1',[result.booking_id])).rows;
    assert.equal(jobs.length,1);assert.equal(jobs[0].kind,'booking_attendance_client');
    const payload=(await root('select spotivity_private.notification_payload($1)value',[jobs[0].id])).rows[0].value;
    assert.equal(payload.recipient.email,email);assert.equal(payload.attendance.total_count,1);
    const grouped=(await as(3,'select public.get_booking_attendance($1::uuid[])value',[[result.booking_id]])).rows[0].value[0];assert.equal(grouped.can_mark,true,'NULL raw contacts no longer hide an already materialized slot');
    assert.equal((await get(id))[0].needs_email,false);assert.equal((await get(id))[0].status,'no_show');
    assert.equal((await mark(id)).changed,false);assert.equal((await root('select count(*)::integer n from spotivity_private.notification_outbox where booking_id=$1',[result.booking_id])).rows[0].n,1);
    await assert.rejects(()=>mark(id,'redirected@example.test',{status:'present',revision:1}),e=>e.code==='22023'&&/saved contact/.test(e.message));
    await assert.rejects(()=>mark(id,null,{status:'present',revision:0}),e=>e.code==='40001');
    const corrected=await mark(id,null,{status:'present',revision:1});assert.equal(corrected.changed,true);assert.equal(corrected.email_queued,true);
    assert.equal((await root('select count(*)::integer n from spotivity_private.booking_incidents where booking_id=$1',[result.booking_id])).rows[0].n,0);
   }
   assert.deepEqual((await root('select to_jsonb(r)value from public.rezervari r order by id')).rows,before,'Attendance never rewrites raw historical contacts or booking rows');
  });

  await t.test('valid saved guest contacts and verified account contacts cannot be redirected',async()=>{
   assert.equal((await get(valid))[0].needs_email,false);assert.equal((await get(account))[0].needs_email,false);
   const unchanged=await counts();
   await assert.rejects(()=>mark(valid,'other@example.test'),e=>e.code==='22023'&&/booking email/.test(e.message));
   await assert.rejects(()=>mark(account,'other@example.test'),e=>e.code==='22023'&&/account email/.test(e.message));
   assert.deepEqual(await counts(),unchanged);
   const guest=await mark(valid);assert.equal((await root('select contact_email from spotivity_private.booking_groups where id=$1',[guest.booking_id])).rows[0].contact_email,'valid+tag@example.test');
   const owned=await mark(account);assert.equal((await root('select owner_auth_id from spotivity_private.booking_groups where id=$1',[owned.booking_id])).rows[0].owner_auth_id,uid(1));
  });

  await t.test('correction never bypasses role, court, time, blocked-slot or private-function guards',async()=>{
   const unchanged=await counts();
   for(const person of [null,1,2]){
    await assert.rejects(()=>get(foreign,person),e=>e.code==='42501');
    await assert.rejects(()=>mark(foreign,'proper@example.test',{person}),e=>e.code==='42501');
   }
   assert.deepEqual(await get(foreign),[]);await assert.rejects(()=>mark(foreign,'proper@example.test'),e=>e.code==='42501');
   assert.equal((await get(future))[0].can_mark,false);await assert.rejects(()=>mark(future,'proper@example.test'),e=>e.code==='22023'&&/entire reservation/.test(e.message));
   assert.deepEqual(await get(blocked),[]);await assert.rejects(()=>mark(blocked,'proper@example.test'),e=>e.code==='42501');
   assert.deepEqual(await counts(),unchanged);
   for(const role of ['anon','authenticated','service_role']){
    for(const signature of ['public.get_booking_attendance(uuid[])','public.set_booking_attendance(uuid,text,integer)','public.get_legacy_booking_attendance(text[])','public.set_legacy_booking_attendance(text,text,integer,text)'])assert.equal((await root('select has_function_privilege($1,$2,\'execute\')allowed',[role,signature])).rows[0].allowed,role==='authenticated');
    assert.equal((await root("select has_function_privilege($1,'spotivity_private.valid_booking_email(text)','execute')allowed",[role])).rows[0].allowed,false);
   }
  });

  await t.test('reapplication refuses to overwrite an unexpected function body',async()=>{
   const definition=(await root("select pg_get_functiondef('public.get_booking_attendance(uuid[])'::regprocedure)definition")).rows[0].definition;
   const altered=definition.replace('declare super boolean; result jsonb;','declare super boolean; result jsonb;\n-- unreviewed fixture change');
   assert.notEqual(altered,definition);await pg.exec(altered);
   await assert.rejects(()=>pg.exec(migration),/Review public.get_booking_attendance/);await pg.exec('rollback');
   assert.equal((await root("select pg_get_functiondef('public.get_booking_attendance(uuid[])'::regprocedure)definition")).rows[0].definition,altered,'040 refuses rather than replacing the unexpected source');
   await pg.exec(definition);
  });

  await t.test('a superseded040 refuses to replace later function definitions',async()=>{
   await root('insert into spotivity_private.migrations(version)values(41)');
   await assert.rejects(()=>pg.exec(migration),/superseded/);await pg.exec('rollback');
  });
 }finally{await pg.close();}
});
