// Disposable PostgreSQL only. No hosted data, Make requests or email delivery.
// PGlite serializes one connection; these checks do not claim multi-session isolation.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {fixture:staffFixture,uid}=require('./court-staff-chat.test.cjs');
const migration=readFileSync(join(__dirname,'../033_late_cancellation_counts.sql'),'utf8');
const warning='La mai mult de 3 neprezentări, riști închiderea contului.';

test('late cancellation snapshots count lifetime bookings while administrator totals respect court scope',async t=>{
 const f=await staffFixture(),{pg,root,as}=f;
 let sequence=33100;
 try{
  await f.apply();
  const courts=(await root('select id::text id,nume,sport from public.terenuri')).rows;
  const courtA=courts.find(c=>c.nume==='Court A'),courtB=courts.find(c=>c.nume==='Court B');
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+5)::text d")).rows[0].d;
  // A test-only clock hook keeps exact boundaries deterministic at any UTC hour.
  // Real booking creation still uses the production Europe/Bucharest conversion.
  await root(`create or replace function spotivity_private.booking_instant(day_text text,hour_text text)
   returns timestamptz language sql stable set search_path='' as $$
    select case when nullif(current_setting('spotivity.test_lead_seconds',true),'') is null
     then (day_text::date+hour_text::time) at time zone 'Europe/Bucharest'
     else statement_timestamp()+make_interval(secs=>current_setting('spotivity.test_lead_seconds')::integer
      +(extract(hour from hour_text::time)::integer-16)*3600) end
   $$`);
  const service=async(q,p=[])=>{await root('select 1');await pg.exec('set role service_role');return pg.query(q,p);};
  const create=async({email=`guest${sequence}@example.test`,owner=null,court=courtA,hours=['16:00']}={})=>{
   const id=uid(sequence++);
   await root("select set_config('spotivity.test_lead_seconds','',false)");
   await root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5::uuid,$6,$7,$8)',
    [id,court.id,day,hours,owner?uid(owner):null,'Test Client',email,`+407${String(sequence).padStart(8,'0')}`]);
   await service('select public.attach_cancellation_token($1,$2)',[id,'a'.repeat(64)]);
   return id;
  };
  const lead=async(id,seconds)=>{
   await root("select set_config('spotivity.test_lead_seconds',$1,false)",[String(seconds)]);
   await root('update public.rezervari set starts_at=starts_at where booking_group_id=$1',[id]);
  };
  const cancel=id=>service('select public.cancel_booking_group_by_token($1,$2) v',[id,'a'.repeat(64)]).then(r=>r.rows[0].v);
  const audit=id=>root('select * from spotivity_private.late_cancellation_events where booking_id=$1',[id]).then(r=>r.rows[0]);
  const jobs=id=>root("select * from spotivity_private.notification_outbox where booking_id=$1 and kind like 'booking_cancelled_%' order by kind,event_key",[id]).then(r=>r.rows);
  const payload=id=>root('select spotivity_private.notification_payload($1) v',[id]).then(r=>r.rows[0].v);
  const review=(person=4,days=30)=>as(person,'select public.list_late_cancellations($1) v',[days]).then(r=>r.rows[0].v);
  const seed=async({email,owner=null,court=courtA,age=45}={})=>{
   const id=uid(sequence++);
   await root("insert into spotivity_private.booking_groups(id,owner_auth_id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status) values($1,$2,'Historic Client',$3,'+40711111111',$4,$5,$6,current_date,array['16:00'],false,100,true,'anulata')",[id,owner?uid(owner):null,email,court.id,court.nume,court.sport]);
   await root("insert into spotivity_private.late_cancellation_events(booking_id,customer_user_id,customer_email,customer_name,customer_phone,court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds) values($1,$2,$3,'Historic Client','+40711111111',$4,current_date,statement_timestamp()+interval '30 minutes',statement_timestamp()-make_interval(days=>$5),1800)",[id,owner?uid(owner):null,email,court.nume,age]);
   return id;
  };
  const business=async()=>{
   const result={};
   for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','spotivity_private.booking_groups','spotivity_private.notification_outbox'])result[table]=(await root(`select to_jsonb(r) v from ${table} r order by to_jsonb(r)::text`)).rows;
   result.events=(await root("select to_jsonb(r)-'total_count'-'notification_event_key' v from spotivity_private.late_cancellation_events r order by booking_id")).rows;
   return result;
  };

  const oldBooking=await create({email:'pre-migration@example.test'});await lead(oldBooking,1800);await cancel(oldBooking);
  const legacy=await seed({email:'lifetime@example.test',court:courtA,age:70});
  await seed({email:'lifetime@example.test',court:courtB,age:80});
  await seed({email:'alice@example.test',owner:1,age:90});
  await seed({email:'alice@example.test',owner:1,age:110});
  await seed({email:'alice@example.test',owner:null,age:120});
  const before=await business();

  await t.test('reviewed hosted function bodies match the fixture and unknown prerequisites or objects stop migration',async()=>{
   // Hosted audit hashes use pg_get_functiondef; the migration deliberately
   // normalizes prosrc. These hashes were also checked against the hosted bodies.
   for(const [signature,expected] of [
    ['spotivity_private.record_late_customer_cancellations()','14e48c6aeca7933abb4f9b46e0860887'],
    ['public.list_late_cancellations(integer)','a142ac3a6bb2cb1a445367c45d9faaca'],
    ['spotivity_private.notification_payload(uuid)','f1a95c66914764947150a055d7a670b9'],
    ['spotivity_private.enqueue_booking_cancellations()','c451f1a62cdb7eb492a2c2379839e0ec']
   ])assert.equal((await root("select md5(btrim(replace(prosrc,E'\\r\\n',E'\\n'),E' \\t\\r\\n')) h from pg_proc where oid=to_regprocedure($1)",[signature])).rows[0].h,expected);
   for(const [setup,pattern] of [
    ['delete from spotivity_private.migrations where version=27',/Apply 027 before 033/],
    ['delete from spotivity_private.migrations where version=32',/Apply 032 before 033/],
    ['insert into spotivity_private.migrations(version) values(34)',/superseded/],
    ['alter table spotivity_private.late_cancellation_events add column total_count integer',/unregistered/],
    ["create function spotivity_private.notification_payload_v32(uuid) returns jsonb language sql as $$select null::jsonb$$",/unregistered/]
   ]){
    await root('begin');
    try{await root(setup);await assert.rejects(()=>pg.exec(migration),pattern);}
    finally{await pg.exec('rollback');}
   }
   assert.deepEqual(await business(),before);
  });

  await root('select 1');await pg.exec(migration);await pg.exec(migration);

  await t.test('migration is repeatable, preserves business data and never enriches historical jobs',async()=>{
   assert.deepEqual(await business(),before);
   const event=await audit(legacy);assert.equal(event.total_count,null);assert.equal(event.notification_event_key,null);
   for(const job of await jobs(oldBooking))assert.equal((await payload(job.id)).late_cancellation,undefined);
   assert.equal((await root("select relrowsecurity v from pg_class where oid='spotivity_private.late_cancellation_events'::regclass")).rows[0].v,true);
   for(const role of ['anon','authenticated','service_role']){
    for(const signature of ['spotivity_private.record_late_customer_cancellations()','spotivity_private.notification_payload(uuid)','spotivity_private.notification_payload_v32(uuid)'])
     assert.equal((await root('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,signature])).rows[0].v,false);
    assert.equal((await root("select has_function_privilege($1,'public.list_late_cancellations(integer)','EXECUTE') v",[role])).rows[0].v,role==='authenticated');
   }
  });

  await t.test('one two-hour cancellation records one cumulative event and enriches only its customer mail',async()=>{
   const id=await create({email:'lifetime@example.test',hours:['16:00','17:00']});await lead(id,-1800);
   assert.equal((await cancel(id)).cancelled_count,2);
   const event=await audit(id);assert.equal(event.total_count,3);assert.ok(event.lead_seconds<0);
   const notifications=await jobs(id);assert.equal(notifications.length,2);
   const client=notifications.find(j=>j.kind==='booking_cancelled_client'),owner=notifications.find(j=>j.kind==='booking_cancelled_owner');
   assert.equal(event.notification_event_key,client.event_key);
   assert.deepEqual((await payload(client.id)).late_cancellation,{total_count:3,threshold:3,warning});
   assert.equal((await payload(owner.id)).late_cancellation,undefined);
   assert.deepEqual((await payload(client.id)).booking.hours,['16:00','17:00']);
   await cancel(id);assert.equal((await jobs(id)).length,2);assert.equal((await audit(id)).total_count,3);
   const next=await create({email:'lifetime@example.test'});await lead(next,1800);await cancel(next);
   assert.equal((await audit(next)).total_count,4);
   assert.equal((await payload(client.id)).late_cancellation.total_count,3,'Retry keeps the count frozen at the cancellation event');
  });

  await t.test('less than one hour is strict and unfinished in-progress cancellation stays allowed',async()=>{
   for(const [seconds,late] of [[3601,false],[3600,false],[3599,true],[-3599,true]]){
    const id=await create();await lead(id,seconds);await cancel(id);
    const event=await audit(id);assert.equal(Boolean(event),late,`lead ${seconds}`);
    const client=(await jobs(id)).find(j=>j.kind==='booking_cancelled_client');
    assert.equal(Boolean((await payload(client.id)).late_cancellation),late,`mail lead ${seconds}`);
    if(late)assert.equal(event.total_count,1);
   }
   const completed=await create();await lead(completed,-3601);
   await assert.rejects(()=>cancel(completed),/Completed bookings cannot be cancelled/);
   assert.equal(await audit(completed),undefined);assert.deepEqual(await jobs(completed),[]);
   assert.equal((await root('select stare from public.rezervari where booking_group_id=$1',[completed])).rows[0].stare,'activa');
   // Release the trusted fixture slot so following cases can reuse its court.
   await root("select set_config('spotivity.test_lead_seconds','',false)");
   await root("update public.rezervari set stare='anulata' where booking_group_id=$1",[completed]);
  });

  await t.test('account UUID history and guest email history are separate identities',async()=>{
   const account=await create({email:'alice@example.test',owner:1});await lead(account,1800);
   await as(1,'select public.cancel_owned_booking_group($1)',[account]);
   assert.equal((await audit(account)).total_count,3);assert.equal((await audit(account)).customer_user_id,uid(1));
   const guest=await create({email:' ALICE@example.test '});await lead(guest,1800);await cancel(guest);
   assert.equal((await audit(guest)).total_count,2);assert.equal((await audit(guest)).customer_user_id,null);
   const direct=await create({email:'alice@example.test',owner:1});await lead(direct,1800);
   await as(1,"update public.rezervari set stare='anulata' where booking_group_id=$1",[direct]);
   assert.equal((await audit(direct)).total_count,4,'The existing direct-owner policy uses the same authoritative audit');
  });

  await t.test('reservation, audit counter and existing mail event commit or roll back together',async()=>{
   const id=await create({email:'atomic@example.test'});await lead(id,1800);
   await root('begin');
   await cancel(id);
   assert.equal((await audit(id)).total_count,1);assert.equal((await jobs(id)).length,2);
   await root('rollback');
   assert.equal(await audit(id),undefined);assert.deepEqual(await jobs(id),[]);
   assert.equal((await root('select stare from public.rezervari where booking_group_id=$1',[id])).rows[0].stare,'activa');
   await cancel(id);assert.equal((await audit(id)).total_count,1);
  });

  await t.test('administrator lifetime totals include older authorized courts only and keep the period count compatible',async()=>{
   const ordinary=await review(3),all=await review(4);
   const scoped=ordinary.customers.find(c=>c.email==='lifetime@example.test'),global=all.customers.find(c=>c.email==='lifetime@example.test');
   assert.equal(ordinary.scope,'assigned_courts');assert.equal(scoped.count,2);assert.equal(scoped.total_count,3);assert.equal(scoped.frequent,false);
   assert.equal(global.count,2);assert.equal(global.total_count,4);assert.equal(global.frequent,false);
   assert.equal(scoped.events.length,2);assert.ok(scoped.events.every(e=>e.court_name==='Court A'));
   assert.equal(all.automatic_restrictions,false);
   assert.deepEqual((await root('select to_jsonb(r) v from auth.users r order by to_jsonb(r)::text')).rows,before['auth.users'],'Repeated cancellations do not change account status');
   assert.equal(all.customers.filter(c=>c.email==='alice@example.test').length,2,'Account and guest identities must not merge');
   await root("update public.users_admin set terenuri='Hidden Court' where user_id=$1",[uid(3)]);
   assert.deepEqual((await review(3)).customers,[]);
   await root("update public.users_admin set terenuri='Court A' where user_id=$1",[uid(3)]);
   for(const person of [1,2,null])await assert.rejects(()=>review(person),/Only a verified administrator|permission denied/);
  });

  await t.test('staff cancellation and unauthorized cancellation never charge a customer event',async()=>{
   for(const person of [3,4]){
    const id=await create();await lead(id,1800);
    await as(person,"update public.rezervari set stare='anulata' where booking_group_id=$1",[id]);
    assert.equal(await audit(id),undefined);
    for(const job of await jobs(id))assert.equal((await payload(job.id)).late_cancellation,undefined);
   }
   const id=await create({email:'alice@example.test',owner:1});await lead(id,1800);
   await assert.rejects(()=>as(2,'select public.cancel_owned_booking_group($1)',[id]),/Only the booking owner/);
   await assert.rejects(()=>service('select public.cancel_booking_group_by_token($1,$2)',[id,'b'.repeat(64)]),/Invalid cancellation link/);
   assert.equal(await audit(id),undefined);assert.deepEqual(await jobs(id),[]);
   for(const role of ['anon','authenticated','service_role']){
    await root('select 1');await pg.exec(`set role ${role}`);
    await assert.rejects(()=>pg.query('select * from spotivity_private.late_cancellation_events'),/permission denied/);
   }
   await as(1,'select public.cancel_owned_booking_group($1)',[id]);
  });

  await t.test('only the first qualifying cancellation of a booking receives late metadata',async()=>{
   const id=await create({email:'partial@example.test',owner:2,hours:['16:00','17:00']});await lead(id,-1800);
   await as(2,"update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='16:00'",[id]);
   const first=(await jobs(id)).find(j=>j.kind==='booking_cancelled_client');assert.equal((await payload(first.id)).late_cancellation.total_count,1);
   await as(3,"update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='17:00'",[id]);
   const later=(await jobs(id)).filter(j=>j.kind==='booking_cancelled_client'&&j.id!==first.id);
   assert.equal(later.length,1);assert.equal((await payload(later[0].id)).late_cancellation,undefined);
   assert.equal((await audit(id)).total_count,1);
  });

  await t.test('a previous staff release never inherits the later customer cancellation warning',async()=>{
   const id=await create({email:'staff-before-client@example.test',owner:2,hours:['16:00','17:00']});await lead(id,-1800);
   await as(3,"update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='17:00'",[id]);
   const staffJob=(await jobs(id)).find(j=>j.kind==='booking_cancelled_client');
   assert.equal(await audit(id),undefined);assert.equal((await payload(staffJob.id)).late_cancellation,undefined);
   await as(2,'select public.cancel_owned_booking_group($1)',[id]);
   const clientJob=(await jobs(id)).find(j=>j.kind==='booking_cancelled_client'&&j.id!==staffJob.id);
   assert.equal((await audit(id)).notification_event_key,clientJob.event_key);
   assert.equal((await payload(clientJob.id)).late_cancellation.total_count,2,'The same account retains its earlier partial-cancellation event across contact emails');
   assert.deepEqual((await payload(clientJob.id)).booking.hours,['16:00']);
   assert.equal((await payload(staffJob.id)).late_cancellation,undefined);
  });

  await t.test('drifted function definitions stop migration reapplication for review',async()=>{
   for(const signature of ['public.list_late_cancellations(integer)','spotivity_private.notification_payload_v32(uuid)']){
    const original=(await root('select pg_get_functiondef(to_regprocedure($1)) d',[signature])).rows[0].d;
    await root('select 1');await pg.exec(original.replace(/(AS \$function\$\s*)/,'$1-- Fixture drift must be reviewed.\n'));
    await assert.rejects(()=>pg.exec(migration),/Review|review|definition/);await pg.exec('rollback');
    await pg.exec(original);await pg.exec(migration);
   }
  });

  await t.test('lifetime totals follow stable court identity after rename and keep deleted history superadmin-only',async()=>{
   await root("update public.terenuri set nume='Court A renamed' where id::text=$1",[courtA.id]);
   await root("update public.users_admin set terenuri='Court A renamed' where user_id=$1",[uid(3)]);
   const renamed=(await review(3)).customers.find(c=>c.email==='lifetime@example.test');
   assert.equal(renamed.total_count,3);assert.equal(renamed.count,2);
   assert.ok(renamed.events.every(e=>e.court_name==='Court A'));
   await root('delete from public.terenuri where id::text=$1',[courtA.id]);
   assert.deepEqual((await review(3)).customers,[]);
   assert.equal((await review(4)).customers.find(c=>c.email==='lifetime@example.test').total_count,4);
   await root('update auth.users set email_confirmed_at=null where id=$1',[uid(3)]);
   await assert.rejects(()=>review(3),/Only a verified administrator/);
  });
 }finally{await pg.close();}
});
