// Disposable PostgreSQL only; no live accounts, bookings or recipients.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=name=>readFileSync(join(__dirname,'..',name),'utf8');

test('administrator late-cancellation review follows current stable court scope',async t=>{
 const pg=new PGlite();
 try{
  let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
  if(process.env.SPOTIVITY_TEST_UUID_IDS==='1')schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
  await pg.exec(schema);
  for(const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql','014_booking_groups.sql','016_notification_outbox.sql','023_late_cancellations.sql'])await pg.exec(migration(name));
  const as=async(role,person,q,params=[])=>{
   await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[person?uid(person):'',JSON.stringify({role,sub:person?uid(person):null})]);await pg.exec(`set role ${role}`);return pg.query(q,params);
  };
  const root=(q,p=[])=>as('postgres',null,q,p);
  const review=(person,days=30)=>as('authenticated',person,'select public.list_late_cancellations($1) result',[days]).then(r=>r.rows[0].result);
  const courts=(await root('select id::text id,nume from public.terenuri')).rows;
  const a=courts.find(c=>c.nume==='Court A').id,b=courts.find(c=>c.nume==='Court B').id;
  await root('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[uid(5),'admin-b@example.test',uid(6),'unverified@example.test']);
  await root('insert into public.users_admin(nume_admin,email,is_super,terenuri,user_id) values($1,$2,false,$3,$4),($5,$6,false,$7,$8)', ['Manager B','admin-b@example.test','Court B',uid(5),'Unverified','unverified@example.test','Court A',uid(6)]);
  await root('update auth.users set email_confirmed_at=null where id=$1',[uid(6)]);
  let next=8100;
  const event=async(courtId,courtName,email,name,phone,age=0)=>{
   const id=uid(next++);
   await root("insert into spotivity_private.booking_groups(id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status) values($1,$2,$3,$4,$5,$6,'Fotbal',current_date,array['12:00'],false,100,true,'anulata')",[id,name,email,phone,courtId,courtName]);
   await root("insert into spotivity_private.late_cancellation_events(booking_id,customer_email,customer_name,customer_phone,court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds) values($1,$2,$3,$4,$5,current_date,statement_timestamp()+interval '30 minutes',statement_timestamp()-make_interval(days=>$6),1800)",[id,email,name,phone,courtName,age]);
   return id;
  };
  const aEvents=[await event(a,'Court A','shared@example.test','Shared at A','+40 711 111 111'),await event(a,'Court A','shared@example.test','Shared at A','+40 711 111 111',1)];
  const bEvents=[];for(let i=0;i<3;i++)bEvents.push(await event(b,'Court B','shared@example.test','Shared at B','+40 722 222 222',i));
  const hiddenId=await event(b,'Court B','private-b@example.test','Private at B','+40 733 333 333');
  const oldId=await event(a,'Court A','old@example.test','Old at A','+40 744 444 444',40);
  const snapshot=()=>root("select jsonb_build_object('users',(select jsonb_agg(to_jsonb(r) order by id) from auth.users r),'profiles',(select jsonb_agg(to_jsonb(r) order by id) from public.clienti r),'admins',(select jsonb_agg(to_jsonb(r) order by id) from public.users_admin r),'courts',(select jsonb_agg(to_jsonb(r) order by id) from public.terenuri r),'bookings',(select jsonb_agg(to_jsonb(r) order by id) from public.rezervari r),'chat',(select jsonb_agg(to_jsonb(r) order by id) from public.mesaje_chat r),'groups',(select jsonb_agg(to_jsonb(r) order by id) from spotivity_private.booking_groups r),'events',(select jsonb_agg(to_jsonb(r) order by booking_id) from spotivity_private.late_cancellation_events r)) snapshot").then(r=>r.rows[0].snapshot);
  await t.test('migration and reapplication preserve all existing identities, rows and allocations',async()=>{
   const before=await snapshot();
   await pg.exec(migration('025_admin_late_cancellation_scope.sql'));await pg.exec(migration('025_admin_late_cancellation_scope.sql'));
   assert.deepEqual(await snapshot(),before);
  });
  await t.test('anonymous, client, unverified and service roles cannot read the review or its private table',async()=>{
   for(const role of ['anon','authenticated','service_role'])await assert.rejects(()=>as(role,role==='authenticated'?3:null,'select * from spotivity_private.late_cancellation_events'),/permission denied/);
   await assert.rejects(()=>as('anon',null,'select public.list_late_cancellations()'),/permission denied/);
   await assert.rejects(()=>as('service_role',null,'select public.list_late_cancellations()'),/permission denied/);
   for(const person of [1,2,6,null])await assert.rejects(()=>review(person),/Only a verified administrator/);
  });
  await t.test('ordinary administrator counts, contacts and frequent flags exclude other court events for the same customer',async()=>{
   const data=await review(3);assert.equal(data.scope,'assigned_courts');assert.equal(data.automatic_restrictions,false);
   assert.equal(data.customers.length,1);const customer=data.customers[0];
   assert.equal(customer.email,'shared@example.test');assert.equal(customer.name,'Shared at A');assert.equal(customer.phone,'+40 711 111 111');
   assert.equal(customer.count,2);assert.equal(customer.frequent,false);assert.deepEqual(customer.events.map(e=>e.booking_id).sort(),aEvents.sort());
   assert.ok(!JSON.stringify(data).includes(hiddenId));assert.ok(!JSON.stringify(data).includes(oldId));assert.ok(!JSON.stringify(data).includes('Shared at B'));
  });
  await t.test('another administrator sees only that court and its independently computed repeat threshold',async()=>{
   const data=await review(5);assert.equal(data.customers.length,2);
   const customer=data.customers.find(c=>c.email==='shared@example.test');assert.equal(customer.count,3);assert.equal(customer.frequent,true);assert.equal(customer.name,'Shared at B');
   assert.deepEqual(customer.events.map(e=>e.booking_id).sort(),bEvents.sort());
  });
  await t.test('superadmin keeps all-court visibility, period bounds and the original no-ban behavior',async()=>{
   const data=await review(4);assert.equal(data.scope,'all');assert.equal(data.automatic_restrictions,false);
   assert.equal(data.customers.find(c=>c.email==='shared@example.test').count,5);assert.equal(data.customers.length,2);
   assert.ok((await review(4,60)).customers.some(c=>c.email==='old@example.test'));
   for(const days of [0,366,null])await assert.rejects(()=>review(4,days),/Review period/);
  });
  await t.test('scope follows current stable court ID through a court rename',async()=>{
   // Trusted maintenance bypasses rename guards only in this disposable fixture.
   await root('alter table public.terenuri disable trigger user');
   await root("update public.terenuri set nume='Court A renamed' where id::text=$1",[a]);
   await root("update public.users_admin set terenuri='Court A renamed' where user_id=$1",[uid(3)]);
   await root('alter table public.terenuri enable trigger user');
   assert.equal((await review(3)).customers[0].count,2);assert.equal((await review(3)).customers[0].events[0].court_name,'Court A');
  });
  await t.test('reassigning the old display name to another court cannot expose historical contacts',async()=>{
   await root('alter table public.terenuri disable trigger user');
   await root("update public.terenuri set nume='Court A' where id::text=$1",[b]);
   await root('alter table public.terenuri enable trigger user');
   await root("update public.users_admin set terenuri='Court A' where user_id=$1",[uid(5)]);
   const data=await review(5);assert.equal(data.customers.find(c=>c.email==='shared@example.test').count,3);
   assert.ok(data.customers.flatMap(c=>c.events).every(e=>!aEvents.includes(e.booking_id)));
  });
  await t.test('revocation applies on the next RPC even with the same active Auth identity',async()=>{
   await root("update public.users_admin set terenuri='Hidden Court' where user_id=$1",[uid(3)]);
   assert.deepEqual((await review(3)).customers,[]);
   await root('delete from public.users_admin where user_id=$1',[uid(3)]);
   await assert.rejects(()=>review(3),/Only a verified administrator/);
  });
  await t.test('deleted court and reused display name keep former events superadmin-only',async()=>{
   await root('alter table public.terenuri disable trigger user');
   await root('delete from public.terenuri where id::text=$1',[b]);
   await root("insert into public.terenuri(nume,sport,pret,ore_rezervabile) values('Court A','Tenis',100,array['12:00'])");
   await root('alter table public.terenuri enable trigger user');
   assert.deepEqual((await review(5)).customers,[]);assert.ok((await review(4)).customers.some(c=>c.email==='private-b@example.test'));
  });
 }finally{await pg.close();}
});
