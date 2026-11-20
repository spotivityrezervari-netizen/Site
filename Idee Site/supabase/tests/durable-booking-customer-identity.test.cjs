// Disposable PostgreSQL only. Never uses hosted Auth, mail or production data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const directory=join(__dirname,'..');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=readFileSync(join(directory,'041_durable_booking_customer_identity.sql'),'utf8');

async function fixture(){
 const pg=new PGlite();
 let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
 await pg.exec(schema);
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 for(const file of readdirSync(directory).filter(file=>/^\d{3}_.*\.sql$/.test(file)&&Number(file.slice(0,3))>=1&&Number(file.slice(0,3))<=40).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
 // Real auth.users has a phone column, so 037's guard needs 048's fix. Only the
 // function is taken here: the version row would mark this replayed migration superseded.
 await pg.exec(readFileSync(join(directory,'048_fix_booking_restriction_phone.sql'),'utf8'));
 await pg.exec('delete from spotivity_private.migrations where version=48');
 const root=async(query,params=[])=>{
  await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
  return pg.query(query,params);
 };
 const as=async(person,query,params=[])=>{
  await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(person)]);
  await pg.exec('set role authenticated');return pg.query(query,params);
 };
 let sequence=41000,bookingDay=1;
 const group=async(owner=1,email='alice@example.test')=>{
  const id=uid(sequence++),day=bookingDay++;
  const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
  await root("select spotivity_private.create_booking_group_internal($1,$2,(statement_timestamp()at time zone'Europe/Bucharest')::date+$3::integer,array['16:00'],false,$4::uuid,'Synthetic Customer',$5,'0712345678')",[id,court,day,owner?uid(owner):null,email]);
  return id;
 };
 const manual=async({owner=1,email='alice@example.test',past=true}={})=>{
  const day=past?-sequence++:sequence++;
  return(await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,pret_total,stare)values($1,$2,'Court A','Fotbal',((statement_timestamp()at time zone'Europe/Bucharest')::date+$3::integer)::text,'18:00','50,5 RON','activa')returning id::text",[email,owner?uid(owner):null,day])).rows[0].id;
 };
 const mark=(id,status='no_show',revision=0)=>as(3,'select public.set_booking_attendance($1,$2,$3)value',[id,status,revision]).then(r=>r.rows[0].value);
 const markManual=(id,email=null)=>as(3,"select public.set_legacy_booking_attendance($1,'no_show',0,$2)value",[id,email]).then(r=>r.rows[0].value);
 const age=async ids=>{
  await root('alter table public.rezervari disable trigger spotivity_booking_guard');
  try{await root("update public.rezervari set starts_at=starts_at-interval'10 days'where booking_group_id=any($1::uuid[])",[ids]);}
  finally{await root('alter table public.rezervari enable trigger spotivity_booking_guard');}
 };
 return{pg,root,as,group,manual,mark,markManual,age};
}

test('deleted Auth accounts retain account incident identity and never become equal-mailbox guests',async t=>{
 const f=await fixture(),{pg,root,as,group,manual,mark,markManual,age}=f;
 try{
  const owned=await group(),guest=await group(null),late=await group(),accountManual=await manual(),guestManual=await manual({owner:null});
  const oldJobs=(await root("select id from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_created_client'",[owned])).rows;
  const before=(await root('select(select count(*)from public.rezervari)reservations,(select count(*)from spotivity_private.booking_groups)groups,(select count(*)from spotivity_private.booking_attendance)attendance,(select count(*)from spotivity_private.notification_outbox)jobs')).rows[0];
  await root('select 1');await pg.exec(migration);await pg.exec(migration);
  assert.deepEqual((await root('select(select count(*)from public.rezervari)reservations,(select count(*)from spotivity_private.booking_groups)groups,(select count(*)from spotivity_private.booking_attendance)attendance,(select count(*)from spotivity_private.notification_outbox)jobs')).rows[0],before,'Installation/reapplication queues no mail or new bookings');
  await root('delete from auth.users where id=$1',[uid(1)]);await age([owned,guest]);

  await t.test('first account attendance after deletion remains separate from a matching guest',async()=>{
   const accountResult=await mark(owned),guestResult=await mark(guest);
   assert.equal(accountResult.email_queued,false,'A deleted account has no deliverable client address');assert.equal(guestResult.email_queued,true);
   const records=(await root('select booking_id,customer_user_id,customer_email,spotivity_private.booking_incident_count(customer_user_id,customer_email)total from spotivity_private.booking_attendance order by booking_id')).rows;
   assert.deepEqual(records.map(r=>[r.customer_user_id,r.total]),[[uid(1),1],[null,1]]);
   assert.equal((await root('select owner_auth_id,identity_user_id from spotivity_private.booking_groups where id=$1',[owned])).rows[0].owner_auth_id,null,'Live authorization FK remains cleared');
   for(const job of oldJobs)assert.equal((await root('select spotivity_private.notification_payload($1)value',[job.id])).rows[0].value,null,'Queued account mail never falls back to its former address');
  });

  await t.test('a manual booking materialized after deletion preserves UUID and immutable contact',async()=>{
   await assert.rejects(()=>markManual(accountManual,'replacement@example.test'),e=>e.code==='22023'&&/account email/.test(e.message));
   const accountResult=await markManual(accountManual),guestResult=await markManual(guestManual);
   assert.equal(accountResult.email_queued,false);assert.equal(guestResult.email_queued,true);
   const account=(await root('select a.customer_user_id,b.owner_auth_id,b.identity_user_id,b.contact_email from spotivity_private.booking_attendance a join spotivity_private.booking_groups b on b.id=a.booking_id where a.booking_id=$1',[accountResult.booking_id])).rows[0];
   assert.deepEqual(account,{customer_user_id:uid(1),owner_auth_id:null,identity_user_id:uid(1),contact_email:'alice@example.test'});
   assert.equal((await root("select spotivity_private.booking_incident_count($1,'alice@example.test')total",[uid(1)])).rows[0].total,2);
   assert.equal((await root("select spotivity_private.booking_incident_count(null,'alice@example.test')total")).rows[0].total,2);
  });

  await t.test('private cancellation links after account deletion retain the account count and cannot restrict an equal guest',async()=>{
   const token='a'.repeat(64);
   await root('update spotivity_private.booking_groups set cancellation_token_hash=$2 where id=$1',[late,token]);
   const instant=(await root("select pg_get_functiondef('spotivity_private.booking_instant(text,text)'::regprocedure)definition")).rows[0].definition;
   await root("create or replace function spotivity_private.booking_instant(day_text text,hour_text text)returns timestamptz language sql stable set search_path=''as $$select statement_timestamp()+interval'30 minutes'$$");
   await root('update public.rezervari set starts_at=starts_at where booking_group_id=$1',[late]);
   await root('select public.cancel_booking_group_by_token($1,$2)',[late,token]);
   await root(instant);
   const event=(await root('select customer_user_id,incident_total_count from spotivity_private.late_cancellation_events where booking_id=$1',[late])).rows[0];
   assert.deepEqual(event,{customer_user_id:uid(1),incident_total_count:3});
   const result=(await as(3,"select public.set_customer_booking_restriction($1,7,false,false,'Reviewed exact account incidents')value",[late])).rows[0].value;
   assert.equal(result.count,1);
   const restriction=(await root('select customer_user_id,incident_count from spotivity_private.booking_restrictions')).rows[0];assert.deepEqual(restriction,{customer_user_id:uid(1),incident_count:3});
   await assert.rejects(()=>as(3,"select public.set_customer_booking_restriction($1,7,false,false,'Guest has only its own incidents')",[guest]),e=>e.code==='22023'&&/at least 3/.test(e.message));
   const created=await group(null);assert.ok(created,'A distinct guest mailbox namespace does not inherit the deleted account restriction');
   const jobs=(await root("select id from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_cancelled_client'",[late])).rows;
   for(const job of jobs)assert.equal((await root('select spotivity_private.notification_payload($1)value',[job.id])).rows[0].value,null);
  });
 }finally{await pg.close();}
});

test('manual identity follows real row edits and never survives a deleted/reused reservation ID',async()=>{
 const f=await fixture(),{pg,root,manual,markManual}=f;
 try{
  const retained=await manual(),replacement=await manual(),unlinked=await manual({owner:2,email:'bob@example.test'});
  await root('select 1');await pg.exec(migration);
  const identity=async id=>(await root('select customer_user_id from spotivity_private.reservation_account_identities where reservation_id=$1',[id])).rows[0]?.customer_user_id??null;
  const type=(await root("select atttypid::regtype::text type from pg_attribute where attrelid='public.rezervari'::regclass and attname='id'")).rows[0].type;
  const moved=type==='uuid'?uid(419999):(await root('update public.rezervari set id=default where id::text=$1 returning id::text',[retained])).rows[0].id;
  if(type==='uuid')await root('update public.rezervari set id=$2 where id::text=$1',[retained,moved]);
  assert.equal(await identity(retained),null);assert.equal(await identity(moved),uid(1),'An ID edit moves the exact same row identity');
  await root('update public.rezervari set client_user_id=null where id::text=$1',[unlinked]);
  assert.equal(await identity(unlinked),null,'An intentional unlink of a still-live account keeps guest semantics');
  await root('delete from auth.users where id=$1',[uid(1)]);
  assert.equal(await identity(moved),uid(1),'Auth FK clearing preserves the deleted account UUID');
  await root("update public.rezervari set email_client='replacement@example.test'where id::text=$1",[replacement]);
  assert.equal(await identity(replacement),null,'An explicit later contact replacement starts a guest identity');
  await root('delete from public.rezervari where id::text=$1',[moved]);
  assert.equal(await identity(moved),null,'Deleting the reservation removes its identity fallback');
  await root("insert into public.rezervari(id,email_client,teren,sport,data_str,ora,pret_total,stare)overriding system value values($1,'alice@example.test','Court A','Fotbal','2000-01-01','18:00','50 RON','activa')",[moved]);
  assert.equal(await identity(moved),null,'A reused row ID cannot inherit a deleted customer');
  const recorded=await markManual(moved);
  assert.equal((await root('select customer_user_id from spotivity_private.booking_attendance where booking_id=$1',[recorded.booking_id])).rows[0].customer_user_id,null);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await root("select has_table_privilege($1,'spotivity_private.reservation_account_identities','select')allowed",[role])).rows[0].allowed,false);
 }finally{await pg.close();}
});
