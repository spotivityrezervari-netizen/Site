// Real PostgreSQL, disposable state only. No hosted Auth/booking writes or mail.
// 049: booking mail goes only to the court's allocated ordinary administrators;
// the superadmin is never a recipient, not even for a court without staff.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const migration=readFileSync(join(directory,'049_booking_mail_court_admins_only.sql'),'utf8');

test('booking mail reaches only the allocated court administrators (049)',async t=>{
 const pg=new PGlite();
 try{
  await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
  await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
  for(const file of readdirSync(directory).filter(name=>/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))>=1&&Number(name.slice(0,3))<=48).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
  const root=async(sql,args=[])=>{await pg.exec('reset role');return pg.query(sql,args);};
  const day=(await root("select ((statement_timestamp()at time zone'Europe/Bucharest')::date+1)::text d")).rows[0].d;
  const courts=Object.fromEntries((await root('select nume,id::text id,pret from public.terenuri')).rows.map(row=>[row.nume,row]));
  let seq=49000;
  const book=async(court,owner,hour)=>{
   const id=uid(seq++),c=courts[court];
   await root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5::uuid,$6,$7,$8,$9)',
    [id,c.id,day,[hour],uid(owner),'Fixture customer',owner===1?'alice@example.test':'bob@example.test',null,c.pret]);
   return id;
  };
  const recipients=async booking=>(await root(`select o.kind,lower(btrim(u.email)) email from spotivity_private.notification_outbox o
   left join auth.users u on u.id=o.recipient_user_id where o.booking_id=$1 and o.kind like '%\\_owner' order by 2`,[booking])).rows;

  await t.test('before 049 a court without staff fell back to the superadmin',async()=>{
   const booking=await book('Court B',1,'16:00');
   assert.deepEqual(await recipients(booking),[{kind:'booking_created_owner',email:'super@example.test'}]);
  });

  await pg.exec(migration);await pg.exec(migration);
  assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=49')).rows[0].n,1);

  await t.test('allocated court: only its ordinary administrator, never the superadmin',async()=>{
   const booking=await book('Court A',1,'17:00');
   assert.deepEqual(await recipients(booking),[{kind:'booking_created_owner',email:'admin@example.test'}]);
   assert.equal((await root("select count(*)::int n from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_created_client'",[booking])).rows[0].n,1,'The client still gets the email');
  });

  await t.test('court without staff: no administrator email at all, client still notified',async()=>{
   const booking=await book('Court B',2,'18:00');
   assert.deepEqual(await recipients(booking),[]);
   assert.equal((await root("select count(*)::int n from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_created_client'",[booking])).rows[0].n,1);
  });

  await t.test('a superadmin allocated to a court is still not a booking recipient',async()=>{
   await root("update public.users_admin set terenuri='Court A,Court B' where is_super");
   const booking=await book('Court A',2,'19:00');
   assert.deepEqual((await recipients(booking)).map(row=>row.email),['admin@example.test']);
  });

  await t.test('the function stays private',async()=>{
   for(const role of ['anon','authenticated','service_role'])
    assert.equal((await root("select has_function_privilege($1,'spotivity_private.notification_owners(text)','execute')v",[role])).rows[0].v,false);
  });
 }finally{await pg.close();}
});
