// Isolated PostgreSQL only; all historical and manual reservations below are fixtures.
const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {join}=require('node:path');const {fixture,uid}=require('./court-staff-chat.test.cjs');
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
test('manual and historical reservations support one no-show, scoped counts and the existing client mail',async t=>{
 const f=await fixture(),{pg,root,as}=f;
 try{
  await f.apply();await root('select 1');await pg.exec(file('033_late_cancellation_counts.sql'));await root('select 1');await pg.exec(file('034_booking_attendance.sql'));
  const get=(id,person=3)=>as(person,'select public.get_legacy_booking_attendance($1::text[]) v',[[id]]).then(r=>r.rows[0].v);
  const mark=(id,status='no_show',rev=0,email=null,person=3)=>as(person,'select public.set_legacy_booking_attendance($1,$2,$3,$4) v',[id,status,rev,email]).then(r=>r.rows[0].v);
  const seed=async(email='alice@example.test',owner=1,court='Court A',hour='16:00',day=-1)=>{
   const r=(await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,pret_total,stare) values($1,$2,$3,'Fotbal',((statement_timestamp() at time zone 'Europe/Bucharest')::date+$4::integer)::text,$5,'50,5 RON','activa')returning id::text",[email,owner?uid(owner):null,court,day,hour])).rows[0];return r.id;
  };
  const account=await seed(),guest=await seed(' Alice@Example.Test ',null,'Court A','17:00'),manual=await seed('Client fără email',null,'Court A','18:00'),future=await seed('bob@example.test',2,'Court A','19:00',2),foreign=await seed('bob@example.test',2,'Court B','20:00');
  const before=(await root('select to_jsonb(r) v from public.rezervari r order by id')).rows;
  await root('select 1');await pg.exec(file('035_legacy_booking_attendance.sql'));
  assert.deepEqual((await root('select to_jsonb(r) v from public.rezervari r order by id')).rows,before);
  await t.test('clients cannot read or mark attendance and administrators see only current allocated courts',async()=>{
   await assert.rejects(()=>get(account,1));assert.deepEqual(await get(foreign),[]);await assert.rejects(()=>mark(foreign));
  });
  await t.test('future records expose an end time but reject all attendance mutations',async()=>{
   const record=(await get(future))[0];assert.equal(record.can_mark,false);assert.ok(Date.parse(record.ends_at)>Date.now());await assert.rejects(()=>mark(future),/entire reservation/);
  });
  let saved;
  await t.test('an existing account receives one attendance notice without changing its reservation or sending another receipt',async()=>{
   saved=await mark(account);assert.equal(saved.email_queued,true);assert.equal(saved.reservation_id,account);
   const jobs=(await root('select * from spotivity_private.notification_outbox where booking_id=$1',[saved.booking_id])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].kind,'booking_attendance_client');
   const payload=(await root('select spotivity_private.notification_payload($1) v',[jobs[0].id])).rows[0].v;assert.equal(payload.recipient.email,'alice@example.test');assert.equal(payload.attendance.total_count,1);
   assert.deepEqual((await root('select to_jsonb(r) v from public.rezervari r order by id')).rows,before);
   assert.equal((await mark(account)).changed,false);assert.equal((await root('select count(*)::int n from spotivity_private.notification_outbox where booking_id=$1',[saved.booking_id])).rows[0].n,1);
   assert.equal((await get(account))[0].status,'no_show');
  });
  await t.test('guest email matching an account keeps a separate identity and cannot redirect an existing contact',async()=>{
   const record=await mark(guest);const b=(await root('select owner_auth_id from spotivity_private.booking_groups where id=$1',[record.booking_id])).rows[0];assert.equal(b.owner_auth_id,null);
   const job=(await root('select id from spotivity_private.notification_outbox where booking_id=$1',[record.booking_id])).rows[0];const mail=(await root('select spotivity_private.notification_payload($1) v',[job.id])).rows[0].v;assert.equal(mail.attendance.total_count,1);
   await assert.rejects(()=>mark(guest,'present',1,'other@example.test'),/cannot be replaced/);
   await assert.rejects(()=>mark(account,'present',1,'other@example.test'),/cannot be replaced/);
  });
  await t.test('a name-only manual record requires an explicit valid email and never invents an account association',async()=>{
   assert.equal((await get(manual))[0].needs_email,true);await assert.rejects(()=>mark(manual),/client email/);await assert.rejects(()=>mark(manual,'no_show',0,'invalid'),/client email/);
   const result=await mark(manual,'no_show',0,'manual@example.test');assert.equal(result.email_queued,true);assert.equal((await get(manual))[0].needs_email,false);
   const record=(await root('select owner_auth_id,contact_email from spotivity_private.booking_groups where id=$1',[result.booking_id])).rows[0];assert.equal(record.owner_auth_id,null);assert.equal(record.contact_email,'manual@example.test');
  });
  await t.test('correction adjusts the shared count and retains audit; stale updates cannot overwrite it',async()=>{
   await assert.rejects(()=>mark(account,'present',0),/Attendance changed/);const result=await mark(account,'present',1);assert.equal(result.email_queued,true);
   const review=(await as(3,'select public.list_late_cancellations(30) v')).rows[0].v;assert.ok(!review.customers.some(c=>c.identity_kind==='account'));
   assert.equal((await root('select count(*)::int n from spotivity_private.booking_attendance_events where booking_id=$1',[saved.booking_id])).rows[0].n,2);
  });
  await t.test('attendance bookkeeping does not consume guest booking quotas',async()=>{
   const email='quota-guest@example.test';
   for(let offset=0;offset<10;offset++){const id=await seed(email,null,'Court A','16:00',-2-offset);await mark(id);}
   const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0];
   const tomorrow=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+1)::text d")).rows[0].d;
   const result=(await root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,null,$5,$6,$7) v',[uid(35999),court.id,tomorrow,['16:00'],'Guest',email,'+40722222222'])).rows[0].v;
   assert.ok(result);
  });
  await t.test('table and slot resolver are private to the backend',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    assert.equal((await root("select has_table_privilege($1,'spotivity_private.legacy_attendance_bookings','select') v",[role])).rows[0].v,false);
    assert.equal((await root("select has_function_privilege($1,'spotivity_private.attendance_booking_slots(uuid)','execute') v",[role])).rows[0].v,false);
   }
  });
 }finally{await pg.close();}
});

test('attendance migration preserves the reviewed live price checks and idempotent booking contract',async()=>{
 const f=await fixture();
 try{
  await f.apply();await f.root('select 1');await f.pg.exec(file('033_late_cancellation_counts.sql'));await f.root('select 1');await f.pg.exec(file('034_booking_attendance.sql'));
  await f.root('select 1');await f.pg.exec(readFileSync(join(__dirname,'fixtures/pre-035-booking-internal.sql'),'utf8'));
  await f.root('select 1');await f.pg.exec(file('035_legacy_booking_attendance.sql'));
  const b=(await f.root('select * from spotivity_private.booking_groups where id=$1',[uid(32001)])).rows[0];
  const request=total=>f.root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],$5,$6,$7,$8,$9,$10::numeric) v',[b.id,b.court_id,b.booking_day,b.hours,b.with_ball,b.owner_auth_id,b.contact_name,b.contact_email,b.contact_phone,total]);
  await assert.rejects(()=>request(-1),/Invalid accepted booking total/);
  await assert.rejects(()=>request(Number(b.total)+1),/PRICE_CHANGED/);
  assert.ok((await request(Number(b.total))).rows[0].v);
 }finally{await f.pg.close();}
});
