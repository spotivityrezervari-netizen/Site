// Disposable PostgreSQL only; no hosted booking writes or real email deliveries.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {fixture,uid}=require('./court-staff-chat.test.cjs');
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
test('administrator attendance, combined incidents and immutable email snapshots',async t=>{
 const f=await fixture(),{pg,root,as}=f;
 let seq=34000;
 try{
  await f.apply();await root('select 1');await pg.exec(file('033_late_cancellation_counts.sql'));
  const snapshot=await root('select count(*)::integer n from spotivity_private.notification_outbox');
  await root('select 1');await pg.exec(file('034_booking_attendance.sql'));
  assert.equal((await root('select count(*)::integer n from spotivity_private.notification_outbox')).rows[0].n,snapshot.rows[0].n,'Migration does not queue historic messages');
  const courts=(await root('select id::text id,nume from public.terenuri')).rows;
  const day=(await root("select ((now() at time zone 'Europe/Bucharest')::date)::text d")).rows[0].d;
  await root(`create or replace function spotivity_private.booking_instant(day_text text,hour_text text) returns timestamptz language sql stable set search_path='' as $$
   select case when nullif(current_setting('spotivity.test_lead',true),'') is null then (day_text::date+hour_text::time) at time zone 'Europe/Bucharest'
   else statement_timestamp()+make_interval(secs=>current_setting('spotivity.test_lead')::integer+(extract(hour from hour_text::time)::integer-16)*3600) end $$`);
  const create=async({owner=1,email='alice@example.test',court='Court A',hours=['16:00']}={})=>{
   const id=uid(seq++),c=courts.find(c=>c.nume===court);
   await root("select set_config('spotivity.test_lead','',false)");
   const bookingDay=(await root('select ($1::date+$2::integer)::text d',[day,[1,2,3,4,5,6,2,4][seq-34001]])).rows[0].d;
   await root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5::uuid,$6,$7,$8)',[id,c.id,bookingDay,hours,owner?uid(owner):null,'Test Client',email,'+40711111111']);
   return id;
  };
  const lead=async(id,seconds)=>{await root("select set_config('spotivity.test_lead',$1,false)",[String(seconds)]);await root('update public.rezervari set starts_at=starts_at where booking_group_id=$1',[id]);};
  const mark=(id,status='no_show',revision=0,person=3)=>as(person,'select public.set_booking_attendance($1,$2,$3) v',[id,status,revision]).then(r=>r.rows[0].v);
  const read=(ids,person=3)=>as(person,'select public.get_booking_attendance($1::uuid[]) v',[ids]).then(r=>r.rows[0].v);
  const jobs=id=>root("select * from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_attendance_client' order by created_at,id",[id]).then(r=>r.rows);
  const payload=id=>root('select spotivity_private.notification_payload($1) v',[id]).then(r=>r.rows[0].v);
  const total=(person=4)=>as(person,'select public.list_late_cancellations(30) v').then(r=>r.rows[0].v);
  const id=await create();
  await t.test('verified current court administrators alone may read and mark attendance',async()=>{
   await assert.rejects(()=>mark(id,'no_show',0,1));
   assert.deepEqual(await read([id],1).catch(()=>[]),[]);
   const foreign=await create({owner:2,email:'bob@example.test',court:'Court B'});await lead(foreign,-7200);
   assert.deepEqual(await read([foreign]),[]);await assert.rejects(()=>mark(foreign));
   const unconfirmed=(await root('select email_confirmed_at from auth.users where id=$1',[uid(3)])).rows[0].email_confirmed_at;
   await root('update auth.users set email_confirmed_at=null where id=$1',[uid(3)]);await assert.rejects(()=>mark(id));
   await root('update auth.users set email_confirmed_at=$2 where id=$1',[uid(3),unconfirmed]);
   await mark(foreign,'present',0,4);
  });
  await t.test('future and ongoing complete groups cannot be marked absent',async()=>{
   await assert.rejects(()=>mark(id),/entire reservation has ended/);
   await lead(id,-1800);assert.equal((await read([id]))[0].can_mark,false);await assert.rejects(()=>mark(id),/entire reservation has ended/);
  });
  await t.test('one completed reservation creates one no-show and one client email',async()=>{
   await lead(id,-7200);const result=await mark(id);assert.equal(result.email_queued,true);assert.equal(result.revision,1);
   const job=(await jobs(id))[0],mail=await payload(job.id);assert.equal(mail.kind,'booking_attendance_client');assert.equal(mail.recipient.email,'alice@example.test');assert.equal(mail.attendance.total_count,1);
   assert.equal((await mark(id)).changed,false);assert.equal((await jobs(id)).length,1);
   const review=await total();assert.equal(review.combined_incidents,true);assert.equal(review.customers.find(c=>c.identity_kind==='account').total_count,1);assert.equal(review.customers[0].events[0].kind,'no_show');
  });
  await t.test('correction removes the no-show, skips an unsent stale report and queues an explicit correction',async()=>{
   const first=(await jobs(id))[0];await assert.rejects(()=>mark(id,'present',0),/Attendance changed/);
   const result=await mark(id,'present',1);assert.equal(result.email_queued,true);assert.equal(result.revision,2);
   assert.equal(await payload(first.id),null);
   const correction=(await jobs(id)).find(j=>j.id!==first.id),mail=await payload(correction.id);assert.equal(mail.attendance.status,'present');assert.equal(mail.attendance.total_count,0);
   assert.equal((await total()).customers.some(c=>c.identity_kind==='account'),false);
   assert.equal((await root('select count(*)::int n from spotivity_private.booking_attendance_events where booking_id=$1',[id])).rows[0].n,2,'Correction retains audit');
  });
  await t.test('lifetime counts distinguish an account from an equal guest mailbox',async()=>{
   await mark(id,'no_show',2);
   const guest=await create({owner:null});await lead(guest,-7200);await mark(guest);
   const review=await total();assert.equal(review.customers.length,2);assert.ok(review.customers.every(c=>c.total_count===1));
   const scoped=await total(3);assert.ok(scoped.customers.every(c=>c.total_count===1));
  });
  await t.test('an initial present choice sends no warning and adds no incident',async()=>{
   const b=await create({owner:2,email:'bob@example.test'});await lead(b,-7200);assert.equal((await mark(b,'present')).email_queued,false);assert.equal((await jobs(b)).length,0);
  });
  await t.test('a multi-hour booking can be marked only after its final retained hour',async()=>{
   const b=await create({hours:['16:00','17:00']});await lead(b,-5400);await assert.rejects(()=>mark(b),/entire reservation/);
   await lead(b,-10800);await mark(b);assert.equal((await jobs(b)).length,1);
  });
  await t.test('late cancellations and no-shows count the same booking once; late mail gets the combined total',async()=>{
   const b=await create({hours:['16:00','17:00']});await lead(b,1800);
   await as(1,"update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='16:00'",[b]);
   let event=(await root('select * from spotivity_private.late_cancellation_events where booking_id=$1',[b])).rows[0];assert.equal(event.total_count,1);assert.ok(event.incident_total_count>event.total_count);
   const lateJob=(await root("select id from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_cancelled_client'",[b])).rows[0];const mail=await payload(lateJob.id);assert.equal(mail.late_cancellation.incident_total_count,event.incident_total_count);
   const before=(await total()).customers.find(c=>c.identity_kind==='account').total_count;
   await lead(b,-10800);await mark(b);assert.equal((await total()).customers.find(c=>c.identity_kind==='account').total_count,before);
   await mark(b,'present',1);assert.equal((await total()).customers.find(c=>c.identity_kind==='account').total_count,before,'The original late cancellation survives correction');
  });
  await t.test('fully cancelled bookings cannot be marked and staff scope hides foreign incidents',async()=>{
   const b=await create();await as(1,"update public.rezervari set stare='anulata' where booking_group_id=$1",[b]);await assert.rejects(()=>mark(b),/entire reservation/);
   const foreign=await create({court:'Court B'});await lead(foreign,-7200);await mark(foreign,'no_show',0,4);
   const staff=(await total(3)).customers.find(c=>c.identity_kind==='account'),superadmin=(await total(4)).customers.find(c=>c.identity_kind==='account');assert.equal(superadmin.total_count,staff.total_count+1);
  });
  await t.test('private attendance tables and count helper cannot be read or invoked by API roles',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    assert.equal((await root("select has_table_privilege($1,'spotivity_private.booking_attendance','select') ok",[role])).rows[0].ok,false);
    assert.equal((await root("select has_function_privilege($1,'spotivity_private.booking_incident_count(uuid,text)','execute') ok",[role])).rows[0].ok,false);
   }
  });
 }finally{await pg.close();}
});
