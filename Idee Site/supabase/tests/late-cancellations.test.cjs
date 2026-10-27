// Disposable PostgreSQL: no live bookings, recipients, Make or email calls.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=name=>readFileSync(join(__dirname,'..',name),'utf8');

test('late cancellation review preserves booking permissions and isolates customer audit',async t=>{
 const pg=new PGlite();let sequence=3100;
 try{
  let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
  if(process.env.SPOTIVITY_TEST_UUID_IDS==='1')schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
  await pg.exec(schema);
  for(const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql','014_booking_groups.sql','016_notification_outbox.sql'])await pg.exec(sql(name));
  const as=async(role,person,query,params=[])=>{
   await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[person?uid(person):'',JSON.stringify({role,sub:person?uid(person):null})]);await pg.exec(`set role ${role}`);return pg.query(query,params);
  };
  const root=(q,p=[])=>as('postgres',null,q,p),service=(q,p=[])=>as('service_role',null,q,p);
  const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+3)::text d")).rows[0].d;
  // Test-only broadened clock slots keep near-now cases independent of the
  // machine's current hour. Production court-hours validation is unchanged.
  await root("alter table public.terenuri drop constraint spotivity_court_hours_canonical");
  await root("create or replace function spotivity_private.normalize_court_hours(hours text[]) returns text[] language sql immutable set search_path='' as $$ select array(select h from unnest(hours) h order by h) $$");
  await root("update public.terenuri set ore_rezervabile=array(select to_char(h*interval '1 hour','HH24:MI') from generate_series(0,23)h)");
  await root("create or replace function spotivity_private.booking_instant(day_text text,hour_text text) returns timestamptz language sql immutable set search_path='' as $$ select (day_text::date+hour_text::time) at time zone 'Europe/Bucharest' $$");
  const create=async({email,hours=['12:00'],owner=null,selectedCourt=court}={})=>{
   const id=uid(sequence++);
   await root('select spotivity_private.create_booking_group_internal($1,$2,$3,$4::text[],false,$5::uuid,$6,$7,$8)',[id,selectedCourt,day,hours,owner?uid(owner):null,'Ana Client',email||`guest${sequence}@example.test`,`+40 72${String(sequence).padStart(7,'0')}`]);
   await service('select public.attach_cancellation_token($1,$2)',[id,'a'.repeat(64)]);
   return id;
  };
  const shift=async(id,offset)=>{
   // Test-only trusted maintenance moves the fixture's slot relative to now.
   const point=(await root("select to_char(p,'YYYY-MM-DD') d,to_char(p,'HH24:MI') h from(select date_trunc('hour',statement_timestamp() at time zone 'Europe/Bucharest')+make_interval(hours=>$1) p)s",[offset])).rows[0];
   await root('update spotivity_private.booking_groups set booking_day=$2,hours=array[$3] where id=$1',[id,point.d,point.h]);
   await root('update public.rezervari set data_str=$2,ora=$3 where booking_group_id=$1',[id,point.d,point.h]);
  };
  const cancel=id=>service('select public.cancel_booking_group_by_token($1,$2) result',[id,'a'.repeat(64)]);
  const events=()=>root('select * from spotivity_private.late_cancellation_events order by booking_id').then(r=>r.rows);
  const review=(person=4)=>as('authenticated',person,'select public.list_late_cancellations() result').then(r=>r.rows[0].result);
  await t.test('migration does not backfill or rewrite business data and remains repeatable',async()=>{
   const warm=await create();await cancel(warm); // Warm existing RPC plans before replacing the internal function.
   const before=(await root("select jsonb_build_object('bookings',(select jsonb_agg(to_jsonb(r)) from public.rezervari r),'groups',(select jsonb_agg(to_jsonb(g)) from spotivity_private.booking_groups g),'admins',(select jsonb_agg(to_jsonb(a)) from public.users_admin a)) s")).rows[0].s;
   await pg.exec(sql('023_late_cancellations.sql'));await pg.exec(sql('023_late_cancellations.sql'));
   const after=(await root("select jsonb_build_object('bookings',(select jsonb_agg(to_jsonb(r)) from public.rezervari r),'groups',(select jsonb_agg(to_jsonb(g)) from spotivity_private.booking_groups g),'admins',(select jsonb_agg(to_jsonb(a)) from public.users_admin a)) s")).rows[0].s;
   assert.deepEqual(after,before);assert.deepEqual(await events(),[]);
   assert.equal((await root("select relrowsecurity from pg_class where oid='spotivity_private.late_cancellation_events'::regclass")).rows[0].relrowsecurity,true);
  });
  await t.test('private audit and marker wrappers cannot be used by public, client, owner or service',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    for(const q of ['select * from spotivity_private.late_cancellation_events',`select spotivity_private.cancel_booking_group_internal('${uid(99)}')`,`select spotivity_private.cancel_booking_group_internal_v14('${uid(99)}')`])await assert.rejects(()=>as(role,role==='authenticated'?1:null,q),/permission denied/);
   }
   await assert.rejects(()=>as('anon',null,'select public.list_late_cancellations()'),/permission denied/);
   for(const person of[1,2,3])await assert.rejects(()=>review(person),/Only the site superadmin/);
  });
  await t.test('guest token cancellation within one hour is recorded once and remains allowed',async()=>{
   const id=await create();await shift(id,1);
   const result=(await cancel(id)).rows[0].result;assert.equal(result.cancelled_count,1);
   let audit=await events();assert.equal(audit.length,1);assert.equal(audit[0].booking_id,id);assert.ok(audit[0].lead_seconds>=0&&audit[0].lead_seconds<3600);
   await cancel(id);assert.equal((await events()).length,1);
   assert.equal((await root("select current_setting('spotivity.client_cancellation_booking',true) marker")).rows[0].marker,'');
  });
  await t.test('ordinary early cancellation is allowed without a late event',async()=>{
   const before=(await events()).length,id=await create();await shift(id,2);await cancel(id);assert.equal((await events()).length,before);
  });
  await t.test('ongoing but unfinished cancellation is tracked; completed booking stays protected',async()=>{
   const id=await create();await shift(id,0);await cancel(id);assert.ok((await events()).find(e=>e.booking_id===id).lead_seconds<0);
   const completed=await create();await shift(completed,-2);const before=(await events()).length;
   await assert.rejects(()=>cancel(completed),/Completed bookings cannot be cancelled/);assert.equal((await events()).length,before);
   assert.equal((await root('select stare from public.rezervari where booking_group_id=$1',[completed])).rows[0].stare,'activa');
   assert.equal((await root("select current_setting('spotivity.client_cancellation_booking',true) marker")).rows[0].marker,'');
  });
  await t.test('partial group cancellation keeps completed hours and creates one review event',async()=>{
   const otherCourt=(await root("select id::text id from public.terenuri where nume='Court B'")).rows[0].id;
   const id=await create({selectedCourt:otherCourt,hours:['12:00','13:00']});
   const points=(await root("select to_char(p,'YYYY-MM-DD') d,to_char(p,'HH24:MI') h,hour_delta from(select date_trunc('hour',statement_timestamp() at time zone 'Europe/Bucharest')+make_interval(hours=>hour_delta) p,hour_delta from unnest(array[-2,1])hour_delta)s order by hour_delta")).rows;
   const slots=(await root('select id from public.rezervari where booking_group_id=$1 order by ora',[id])).rows;
   for(let i=0;i<2;i++)await root('update public.rezervari set data_str=$2,ora=$3 where id=$1',[slots[i].id,points[i].d,points[i].h]);
   assert.equal((await cancel(id)).rows[0].result.cancelled_count,1);
   const states=(await root('select stare,count(*)::int n from public.rezervari where booking_group_id=$1 group by stare',[id])).rows;
   assert.deepEqual(states.sort((a,b)=>a.stare.localeCompare(b.stare)),[{stare:'activa',n:1},{stare:'anulata',n:1}]);
   assert.equal((await events()).filter(e=>e.booking_id===id).length,1);
   await assert.rejects(()=>cancel(id),/Completed bookings cannot be cancelled/);
   assert.equal((await events()).filter(e=>e.booking_id===id).length,1);
  });
  await t.test('staff-initiated cancellation is never recorded against the customer',async()=>{
   for(const person of[3,4]){
    const id=await create();await shift(id,1);const before=(await events()).length;
    await as('authenticated',person,"update public.rezervari set stare='anulata' where booking_group_id=$1",[id]);assert.equal((await events()).length,before);
   }
  });
  await t.test('real authenticated owner cancellation records the same customer-safe audit',async()=>{
   const id=await create({email:'alice@example.test',owner:1});await shift(id,1);
   await as('authenticated',1,'select public.cancel_owned_booking_group($1)',[id]);assert.equal((await events()).find(e=>e.booking_id===id).customer_user_id,uid(1));
  });
  await t.test('superadmin review aggregates distinct bookings and does not restrict accounts',async()=>{
   for(let i=0;i<3;i++){const id=await create({email:'repeat@example.test'});await shift(id,1);await cancel(id);}
   const data=await review();assert.equal(data.days,30);assert.equal(data.frequent_threshold,3);assert.equal(data.automatic_restrictions,false);
   const repeat=data.customers.find(c=>c.email==='repeat@example.test');assert.equal(repeat.count,3);assert.equal(repeat.events.length,3);assert.equal(repeat.frequent,true);
   assert.equal(repeat.name,'Ana Client');assert.match(repeat.phone,/^\+40 72/);
   await assert.rejects(()=>as('authenticated',4,'select public.list_late_cancellations(0)'),/Review period/);
   await root('update auth.users set email_confirmed_at=null where id=$1',[uid(4)]);await assert.rejects(()=>review(),/Only the site superadmin/);
  });
 }finally{await pg.close();}
});
