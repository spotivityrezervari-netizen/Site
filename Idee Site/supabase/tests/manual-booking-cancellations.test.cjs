// Full SQL fixtures only. No hosted records, email or Make execution is used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const directory=join(__dirname,'..');
const file=name=>readFileSync(join(directory,name),'utf8');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function fixture(integer){
 const pg=new PGlite();let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(integer)schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
 await pg.exec(schema);
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 for(const name of readdirSync(directory).filter(name=>/^(001|00[3-9]|01[0-9]|02[0-9]|030|032|033|034|035)_.*\.sql$/.test(name)).sort())await pg.exec(file(name));
 const root=async(sql,params=[])=>{await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");return pg.query(sql,params);};
 const as=async(person,sql,params=[])=>{await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(person)]);await pg.exec('set role authenticated');return pg.query(sql,params);};
 const seed=async({email='alice@example.test',owner=1,hour='14:00',price='50,5 Lei (Manual)',lead=30,court='Court A'}={})=>{
  const r=(await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,pret_total,stare)values($1,$2,$3,'Fotbal',((statement_timestamp()at time zone'Europe/Bucharest')::date+2)::text,$4,$5,'activa')returning id::text",[email,owner?uid(owner):null,court,hour,price])).rows[0];
  // Clock-independent fixture: preserve the original public fields, except for
  // the server timestamp that determines the cancellation lead time.
  await root('alter table public.rezervari disable trigger spotivity_booking_guard');
  await root("update public.rezervari set starts_at=statement_timestamp()+make_interval(mins=>$2)where id::text=$1",[r.id,lead]);
  await root('alter table public.rezervari enable trigger spotivity_booking_guard');return r.id;
 };
 const cancel=async(id,person=1)=>(await as(person,"update public.rezervari set stare='anulata'where id::text=$1 returning id::text,booking_group_id,client_user_id,email_client",[id])).rows[0];
 return{pg,root,as,seed,cancel};
}
for(const integer of [false,true])test(`manual cancellation uses normal mail/count flow with ${integer?'integer':'UUID'} reservation IDs`,async t=>{
 const f=await fixture(integer),{pg,root,as,seed,cancel}=f;
 try{
  const first=await seed();
  const snapshot=async()=>({rows:(await root('select to_jsonb(r) v from public.rezervari r order by id')).rows,
   groups:(await root('select to_jsonb(r) v from spotivity_private.booking_groups r order by id')).rows,
   notices:(await root('select to_jsonb(r) v from spotivity_private.notification_outbox r order by id')).rows});
  const before=await snapshot();const priceBody=(await root("select prosrc from pg_proc where oid=to_regprocedure('spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text,numeric)')")).rows[0].prosrc;
  await root('select 1');await pg.exec(file('036_manual_booking_cancellations.sql'));
  await root('select 1');await pg.exec(file('036_manual_booking_cancellations.sql'));assert.deepEqual(await snapshot(),before,'Installing/rerunning the migration never rewrites bookings or queues historical mail');
  assert.equal((await root("select prosrc from pg_proc where oid=to_regprocedure('spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text,numeric)')")).rows[0].prosrc,priceBody,'The reviewed live pricing/quota implementation is preserved exactly');
  for(const next of ['037_client_restrictions.sql','038_guest_email_validation.sql','039_court_photo_cleanup.sql','048_fix_booking_restriction_phone.sql']){
   await root('select 1');await pg.exec(file(next));
  }
  await root('select 1');await pg.exec(file('036_manual_booking_cancellations.sql'));
  assert.deepEqual(await snapshot(),before,'All current migrations remain compatible without changing historical rows or mail');
  let group;
  await t.test('own late cancellation queues exactly one client/owner pair and one combined incident',async()=>{
   const record=await cancel(first);group=record.booking_group_id;assert.ok(group);assert.equal(record.client_user_id,uid(1));
   const b=(await root('select * from spotivity_private.booking_groups where id=$1',[group])).rows[0];assert.equal(b.owner_auth_id,uid(1));assert.equal(b.status,'anulata');assert.equal(b.sealed,true);assert.equal(Number(b.total),50.5);
   const incidents=(await root('select * from spotivity_private.late_cancellation_events where booking_id=$1',[group])).rows;assert.equal(incidents.length,1);assert.equal(incidents[0].incident_total_count,1);
   const jobs=(await root('select * from spotivity_private.notification_outbox where booking_id=$1 order by kind',[group])).rows;assert.deepEqual(jobs.map(job=>job.kind),['booking_cancelled_client','booking_cancelled_owner']);
   for(const job of jobs){const p=(await root('select spotivity_private.notification_payload($1) v',[job.id])).rows[0].v;assert.ok(p);assert.equal(p.booking.amountRON,50.5);assert.deepEqual(p.booking.hours,['14:00']);if(job.kind.endsWith('_client')){assert.equal(p.recipient.email,'alice@example.test');assert.equal(p.late_cancellation.incident_total_count,1);}}
   await as(3,"update public.rezervari set stare='anulata'where id::text=$1",[first]);
   assert.equal((await root('select count(*)::int n from spotivity_private.notification_outbox where booking_id=$1',[group])).rows[0].n,2);
   assert.equal((await root('select count(*)::int n from spotivity_private.late_cancellation_events where booking_id=$1',[group])).rows[0].n,1);
  });
  await t.test('early cancellation notifies normally but does not create an incident',async()=>{
   const id=await seed({email:'bob@example.test',owner:2,hour:'15:00',lead:150});const r=await cancel(id,2);assert.ok(r.booking_group_id);
   assert.equal((await root('select count(*)::int n from spotivity_private.late_cancellation_events where booking_id=$1',[r.booking_group_id])).rows[0].n,0);
   assert.equal((await root('select count(*)::int n from spotivity_private.notification_outbox where booking_id=$1',[r.booking_group_id])).rows[0].n,2);
  });
  await t.test('cancellation remains scoped, immutable and transactional',async()=>{
   const id=await seed({hour:'16:00'});assert.equal((await as(2,"update public.rezervari set stare='anulata'where id::text=$1 returning id",[id])).rows.length,0);
   await assert.rejects(()=>as(1,"update public.rezervari set stare='anulata',pret_total='1 RON'where id::text=$1",[id]));
   await assert.rejects(()=>as(1,"update public.rezervari set stare='anulata',booking_group_id=$2 where id::text=$1",[id,group]));
   await root('begin');await pg.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(1)]);await pg.exec('set local role authenticated');const row=(await pg.query("update public.rezervari set stare='anulata'where id::text=$1 returning booking_group_id",[id])).rows[0];assert.ok(row.booking_group_id);await pg.exec('rollback');
   assert.equal((await root('select stare,booking_group_id from public.rezervari where id::text=$1',[id])).rows[0].booking_group_id,null);
   assert.equal((await root('select count(*)::int n from spotivity_private.booking_groups where id=$1',[row.booking_group_id])).rows[0].n,0);
  });
  await t.test('staff cancellations and contact-only guests retain identity and omit late punishment',async()=>{
   // Staff's guard normalizes starts_at: this fixture needs no synthetic clock.
   const id=(await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,pret_total,stare)values('alice@example.test',null,'Court A','Fotbal',((statement_timestamp()at time zone'Europe/Bucharest')::date+2)::text,'18:00','25 RON','activa')returning id::text")).rows[0].id;
   const r=await cancel(id,3);assert.ok(r.booking_group_id);assert.equal(r.client_user_id,null);
   const b=(await root('select owner_auth_id,contact_email from spotivity_private.booking_groups where id=$1',[r.booking_group_id])).rows[0];assert.equal(b.owner_auth_id,null);assert.equal(b.contact_email,'alice@example.test');
   assert.equal((await root('select count(*)::int n from spotivity_private.late_cancellation_events where booking_id=$1',[r.booking_group_id])).rows[0].n,0);
  });
  await t.test('name-only records, blocked hours and root maintenance remain silent',async()=>{
   for(const email of ['Client fără email','Teren Blocat']){
    const id=await seed({email,owner:null,hour:email==='Teren Blocat'?'20:00':'19:00'});const r=await cancel(id,3);assert.equal(r.booking_group_id,null);
   }
   const id=await seed({hour:'21:00'});await root("update public.rezervari set stare='anulata'where id::text=$1",[id]);assert.equal((await root('select booking_group_id from public.rezervari where id::text=$1',[id])).rows[0].booking_group_id,null);
  });
  await t.test('normal grouped cancellation keeps its existing count and deduplication',async()=>{
   const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0];const day=(await root("select ((statement_timestamp()at time zone'Europe/Bucharest')::date+3)::text d")).rows[0].d;
   const result=(await as(2,'select public.create_booking_group($1,$2,$3::date,$4::text[],false,100) v',[uid(36900),court.id,day,['12:00']])).rows[0].v;
   await root('alter table public.rezervari disable trigger spotivity_booking_guard');await root("update public.rezervari set starts_at=statement_timestamp()+interval'30 minutes'where booking_group_id=$1",[result.booking_id]);await root('alter table public.rezervari enable trigger spotivity_booking_guard');
   await as(2,"update public.rezervari set stare='anulata'where booking_group_id=$1",[result.booking_id]);assert.equal((await root('select count(*)::int n from spotivity_private.late_cancellation_events where booking_id=$1',[result.booking_id])).rows[0].n,1);
  });
  await t.test('private helpers and snapshots are not exposed as browser RPCs',async()=>{
   for(const role of ['anon','authenticated','service_role'])for(const signature of ['spotivity_private.materialize_manual_cancellation()','spotivity_private.notification_payload_v35(uuid)'])assert.equal((await root('select has_function_privilege($1,$2,\'execute\') v',[role,signature])).rows[0].v,false);
  });
  await t.test('stricter email validation never prevents cancellation of historical manual contacts',async()=>{
   const beforeJobs=(await root('select count(*)::int n from spotivity_private.notification_outbox')).rows[0].n;
   for(const email of ['old\ufeffaddress@example.test','é'.repeat(124)+'@test.example']){
    assert.equal((await root('select spotivity_private.valid_booking_email($1) valid',[email])).rows[0].valid,false);
    const id=await seed({email,owner:null,hour:'20:00'});const r=await cancel(id,3);
    assert.equal(r.booking_group_id,null);assert.equal(r.client_user_id,null);
    assert.equal((await root('select stare from public.rezervari where id::text=$1',[id])).rows[0].stare,'anulata');
   }
   assert.equal((await root('select count(*)::int n from spotivity_private.notification_outbox')).rows[0].n,beforeJobs,'No invented email destination or historical backfill');
  });
  await t.test('deleted court identities retain client history without inventing another owner',async()=>{
   const id=await seed({hour:'22:00'});const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0];
   await root('delete from public.terenuri where id::text=$1',[court.id]);const r=await cancel(id);assert.ok(r.booking_group_id);
   const b=(await root('select court_id,court_name from spotivity_private.booking_groups where id=$1',[r.booking_group_id])).rows[0];assert.equal(b.court_id,court.id);assert.equal(b.court_name,'Court A');
   const jobs=(await root('select * from spotivity_private.notification_outbox where booking_id=$1',[r.booking_group_id])).rows;assert.deepEqual(jobs.map(job=>job.kind),['booking_cancelled_client']);
   const payload=(await root('select spotivity_private.notification_payload($1) v',[jobs[0].id])).rows[0].v;assert.equal(payload.recipient.email,'alice@example.test');assert.equal(payload.booking.courtName,'Court A');
  });
 }finally{await pg.close();}
});
