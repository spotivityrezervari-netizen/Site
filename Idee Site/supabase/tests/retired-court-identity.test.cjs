// Disposable PostgreSQL only. No hosted accounts, credentials or email delivery.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
const uuidCourts=process.env.SPOTIVITY_TEST_UUID_IDS==='1';

async function fixture(){
 const pg=new PGlite();let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(uuidCourts)schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
 await pg.exec(schema);
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01T00:00:00Z'");
 for(const name of readdirSync(join(__dirname,'..')).filter(name=>/^(001|00[3-9]|01[0-9]|02[0-5])_.*\.sql$/.test(name)).sort())await pg.exec(file(name));
 const as=async(role,person,q,params=[])=>{
  await pg.exec('reset role');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[person?uid(person):'',JSON.stringify({role,sub:person?uid(person):null})]);
  await pg.exec(`set role ${role}`);return pg.query(q,params);
 };
 const root=(q,p=[])=>as('postgres',null,q,p);
 const snapshot=async()=>{
  const result={};
  for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.baze_sportive','public.baze_sportive_admini','spotivity_private.booking_groups','spotivity_private.notification_outbox','spotivity_private.late_cancellation_events'])result[table]=(await root(`select to_jsonb(r) row from ${table} r order by to_jsonb(r)::text`)).rows;
  return result;
 };
 const migrate=async()=>{await root('select 1');await pg.exec(file('026_retired_court_identity.sql'));};
 const count=async(person,table,where,params=[])=>Number((await as('authenticated',person,`select count(*)::integer n from ${table} where ${where}`,params)).rows[0].n);
 return {pg,as,root,snapshot,migrate,count};
}

test(`retired court identity protects booking, profile and chat scope (${uuidCourts?'UUID':'numeric'} court IDs)`,async t=>{
 const f=await fixture(),{pg,as,root,snapshot,migrate,count}=f;
 const conflict=e=>e.code==='23505';
 try{
  const courts=(await root('select id::text id,nume from public.terenuri')).rows;
  const a=courts.find(c=>c.nume==='Court A').id,b=courts.find(c=>c.nume==='Court B').id;
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+2)::text booking_day")).rows[0].booking_day;
  for(const [person,phone]of [[1,'0712345678'],[2,'0799999999']])await as('authenticated',person,'update public.clienti set telefon=$1 where user_id=auth.uid()',[phone]);
  await as('authenticated',1,'select public.create_booking_group($1,$2,$3::date,array[\'12:00\',\'13:00\'],false)',[uid(9201),a,day]);
  await as('authenticated',2,'select public.create_booking_group($1,$2,$3::date,array[\'15:00\'],false)',[uid(9202),b,day]);
  const message=(await as('authenticated',1,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj,citit)values('alice@example.test','Court A','client','Booking question',false)returning id::text id")).rows[0].id;
  await as('authenticated',3,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj,citit)values('alice@example.test','Court A','admin','Court A reply',false)");
  await root('insert into auth.users(id,email,email_confirmed_at)values($1,$2,statement_timestamp())',[uid(5),'other-manager@example.test']);
  await as('authenticated',4,"insert into public.users_admin(nume_admin,email,is_super,terenuri,user_id)values('Other Manager','other-manager@example.test',false,'Court B',$1)",[uid(5)]);
  // Historical orphan identity is unknown. Reserving the name must not invent
  // a court ID or attach those rows to a future administrator.
  await root("insert into public.rezervari(email_client,client_user_id,teren,sport,data_str,ora,stare)values('alice@example.test',$1,'Orphan history','Fotbal','2000-01-01','16:00','anulata')",[uid(1)]);
  await root("insert into public.mesaje_chat(email_client,client_user_id,teren,expeditor,mesaj,citit)values('alice@example.test',$1,'Orphan history','admin','Historical message',false)",[uid(1)]);
  const ambiguousIds=uuidCourts?[uid(9261),uid(9262)]:['90011','90012'];
  for(const [index,court]of ambiguousIds.entries())await root("insert into spotivity_private.booking_groups(id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status)values($1,'Historical customer','history@example.test','0712345678',$2,'Ambiguous orphan','Fotbal','2000-01-01',array['12:00'],false,100,true,'anulata')",[uid(9263+index),court]);
  await t.test('migration and reapplication preserve every existing business row and allocation',async()=>{
   const before=await snapshot();await migrate();assert.deepEqual(await snapshot(),before);
   const registry=(await root('select * from spotivity_private.court_name_registry order by court_name')).rows;
   const identifiers=(await root('select * from spotivity_private.court_id_registry order by court_id')).rows;
   await migrate();assert.deepEqual(await snapshot(),before);
   assert.deepEqual((await root('select * from spotivity_private.court_name_registry order by court_name')).rows,registry);
   assert.deepEqual((await root('select * from spotivity_private.court_id_registry order by court_id')).rows,identifiers);
   assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=26')).rows[0].n,1);
  });
  await t.test('browser and service roles cannot read or alter the identity registry',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    for(const table of ['court_name_registry','court_id_registry']){
     await assert.rejects(()=>as(role,role==='authenticated'?3:null,`select * from spotivity_private.${table}`),e=>e.code==='42501');
     assert.equal((await root("select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') allowed",[role,'spotivity_private.'+table])).rows[0].allowed,false);
    }
    assert.equal((await root("select has_function_privilege($1,'spotivity_private.guard_court_identity()','execute') allowed",[role])).rows[0].allowed,false);
   }
  });
  await t.test('current administrator retains its bookings, customers, chat and court settings only',async()=>{
   assert.equal(await count(3,'public.rezervari','booking_group_id=$1',[uid(9201)]),2);
   assert.equal(await count(3,'public.rezervari','booking_group_id=$1',[uid(9202)]),0);
   assert.equal(await count(3,'public.clienti','user_id=$1',[uid(1)]),1);
   assert.equal(await count(3,'public.clienti','user_id=$1',[uid(2)]),0);
   assert.equal(await count(3,'public.mesaje_chat','id::text=$1',[message]),1);
   assert.equal((await as('authenticated',3,"update public.terenuri set pret=110 where nume='Court A' returning id")).rows.length,1);
  });
  await t.test('ordinary administrators can still create and receive a court in their explicit base',async()=>{
   await as('authenticated',4,"insert into public.baze_sportive(id,nume,oras)values($1,'Managed Base','Cluj')",[uid(9250)]);
   await as('authenticated',4,'insert into public.baze_sportive_admini(baza_id,user_id)values($1,$2)',[uid(9250),uid(3)]);
   const made=(await as('authenticated',3,"select public.create_managed_court($1,'New assigned court','Volei',90,array['12:00']) value",[uid(9250)])).rows[0].value;
   assert.equal(made.nume,'New assigned court');
   assert.equal((await as('authenticated',3,"select spotivity_private.manages_court('New assigned court') allowed")).rows[0].allowed,true);
   assert.equal((await root('select court_id from spotivity_private.court_name_registry where court_name=$1',[made.nume])).rows[0].court_id,String(made.id));
  });
  await t.test('legitimate rename and rename-back retain the same physical court and administrator history',async()=>{
   await as('authenticated',4,"update public.terenuri set nume='Court A renamed' where id::text=$1",[a]);
   for(const alias of ['Court A','Court A renamed'])assert.equal((await as('authenticated',3,'select spotivity_private.manages_court($1) allowed',[alias])).rows[0].allowed,true);
   assert.equal(await count(3,'public.rezervari','booking_group_id=$1',[uid(9201)]),2);
   assert.equal(await count(3,'public.clienti','user_id=$1',[uid(1)]),1);
   assert.equal(await count(3,'public.mesaje_chat','id::text=$1',[message]),1);
   await as('authenticated',4,"update public.terenuri set nume='Court A' where id::text=$1",[a]);
   assert.equal((await root("select count(*)::int n from spotivity_private.court_name_registry where court_id=$1 and court_name in('Court A','Court A renamed')",[a])).rows[0].n,2);
   await assert.rejects(()=>as('authenticated',4,"insert into public.terenuri(nume,sport,pret,pret_minge)values('Court A renamed','Fotbal',100,0)"),conflict);
  });
  await t.test('court IDs are immutable even for a superadmin',async()=>{
   const fresh=uuidCourts?uid(9251):'90001';
   await assert.rejects(()=>as('authenticated',4,'update public.terenuri set id=$1 where id::text=$2',[fresh,a]),e=>e.code==='23514'||(!uuidCourts&&e.code==='428C9'));
   assert.equal((await root('select id::text id from public.terenuri where nume=$1',['Court A'])).rows[0].id,a);
  });
  await t.test('deleting a court immediately removes former staff access while preserving own-client and superadmin history',async()=>{
   await as('authenticated',4,'delete from public.terenuri where id::text=$1',[a]);
   for(const manager of [3,5]){
    assert.equal(await count(manager,'public.rezervari','booking_group_id=$1',[uid(9201)]),0);
    assert.equal(await count(manager,'public.clienti','user_id=$1',[uid(1)]),0);
    assert.equal(await count(manager,'public.mesaje_chat','id::text=$1',[message]),0);
   }
   for(const person of [1,4]){
    assert.equal(await count(person,'public.rezervari','booking_group_id=$1',[uid(9201)]),2);
    assert.equal(await count(person,'public.mesaje_chat','id::text=$1',[message]),1);
   }
   assert.equal((await as('authenticated',3,"select spotivity_private.manages_court('Court A') allowed")).rows[0].allowed,false);
   assert.equal((await as('authenticated',4,"select spotivity_private.manages_court('Court A') allowed")).rows[0].allowed,true);
  });
  await t.test('deleted names and historical aliases cannot be assigned to a different court',async()=>{
   for(const name of ['Court A','Court A renamed','Orphan history'])await assert.rejects(()=>as('authenticated',4,'insert into public.terenuri(nume,sport,pret,pret_minge)values($1,\'Fotbal\',100,0)',[name]),conflict);
   assert.equal((await root("select court_id from spotivity_private.court_name_registry where court_name='Orphan history'")).rows[0].court_id,null);
   assert.equal(await count(5,'public.clienti','user_id=$1',[uid(1)]),0);
  });
  await t.test('an explicitly supplied retired ID cannot resurrect old access under the same or a fresh name',async()=>{
   for(const name of ['Court A','Different new court'])await assert.rejects(()=>as('authenticated',4,'insert into public.terenuri(id,nume,sport,pret,pret_minge) overriding system value values($1,$2,\'Fotbal\',100,0)',[a,name]),conflict);
   await assert.rejects(()=>as('authenticated',4,'update public.terenuri set id=$1 where id::text=$2',[a,b]),e=>e.code==='23514'||(!uuidCourts&&e.code==='428C9'));
   assert.equal((await root('select count(*)::int n from public.terenuri where id::text=$1',[a])).rows[0].n,0);
  });
  await t.test('multiple historical IDs behind one ambiguous orphan alias all remain reserved',async()=>{
   assert.equal((await root("select court_id from spotivity_private.court_name_registry where court_name='Ambiguous orphan'")).rows[0].court_id,null);
   for(const id of ambiguousIds)assert.equal((await root('select count(*)::int n from spotivity_private.court_id_registry where court_id=$1',[id])).rows[0].n,1);
   for(const id of ambiguousIds)await assert.rejects(()=>as('authenticated',4,'insert into public.terenuri(id,nume,sport,pret,pret_minge)overriding system value values($1,$2,\'Fotbal\',100,0)',[id,'Fresh display name '+id]),conflict);
  });
  await t.test('revocation remains immediate and cannot be bypassed through an old alias',async()=>{
   await as('authenticated',4,"update public.users_admin set terenuri='Court B' where user_id=$1",[uid(3)]);
   for(const name of ['Court A','Court A renamed','New assigned court'])assert.equal((await as('authenticated',3,'select spotivity_private.manages_court($1) allowed',[name])).rows[0].allowed,false);
   assert.equal((await as('authenticated',3,"select spotivity_private.manages_court('Court B') allowed")).rows[0].allowed,true);
   await as('authenticated',4,'delete from public.users_admin where user_id=$1',[uid(3)]);
   assert.equal((await as('authenticated',3,"select spotivity_private.manages_court('Court B') allowed")).rows[0].allowed,false);
  });
  await t.test('own unfinished orphan booking still cancels; completed booking remains protected',async()=>{
   const result=(await as('authenticated',1,'select public.cancel_owned_booking_group($1) value',[uid(9201)])).rows[0].value;
   assert.equal(result.cancelled_count,2);
   await root("update spotivity_private.booking_groups set booking_day='2000-01-01' where id=$1",[uid(9202)]);
   await root("update public.rezervari set data_str='2000-01-01' where booking_group_id=$1",[uid(9202)]);
   const before=await snapshot();
   await assert.rejects(()=>as('authenticated',2,'select public.cancel_owned_booking_group($1)',[uid(9202)]),e=>e.code==='42501');
   assert.deepEqual(await snapshot(),before);
  });
 }finally{await pg.close();}
});

test('an already-reused name aborts migration instead of guessing ownership or changing rows',async()=>{
 const f=await fixture(),{pg,as,root,snapshot,migrate}=f;
 try{
  const a=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+2)::text booking_day")).rows[0].booking_day;
  await as('authenticated',1,"update public.clienti set telefon='0712345678' where user_id=auth.uid()");
  await as('authenticated',1,'select public.create_booking_group($1,$2,$3::date,array[\'12:00\'],false)',[uid(9301),a,day]);
  await as('authenticated',4,'delete from public.terenuri where id::text=$1',[a]);
  await as('authenticated',4,"insert into public.terenuri(nume,sport,pret,pret_minge)values('Court A','Fotbal',100,0)");
  const before=await snapshot();
  await assert.rejects(migrate,/Review historical ownership/);await pg.exec('rollback');
  assert.deepEqual(await snapshot(),before);
  assert.equal((await root("select to_regclass('spotivity_private.court_name_registry') name")).rows[0].name,null);
  assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=26')).rows[0].n,0);
 }finally{await pg.close();}
});

test('unregistered or externally modified identity objects are preserved for explicit review',async t=>{
 const f=await fixture(),{pg,root,migrate}=f;
 try{
  const failed=async message=>{await assert.rejects(migrate,message);await pg.exec('rollback');};
  await t.test('an existing unregistered registry is not adopted or replaced',async()=>{
   await root('create table spotivity_private.court_name_registry(note text)');
   await root("insert into spotivity_private.court_name_registry values('Other platform data')");
   await failed(/unregistered court identity objects/);
   assert.equal((await root('select note from spotivity_private.court_name_registry')).rows[0].note,'Other platform data');
   await root('drop table spotivity_private.court_name_registry');
  });
  await t.test('an existing unregistered ID registry is not adopted or replaced',async()=>{
   await root('create table spotivity_private.court_id_registry(note text)');
   await root("insert into spotivity_private.court_id_registry values('Other platform identifiers')");
   await failed(/unregistered court identity objects/);
   assert.equal((await root('select note from spotivity_private.court_id_registry')).rows[0].note,'Other platform identifiers');
   await root('drop table spotivity_private.court_id_registry');
  });
  await t.test('an existing unregistered function is not overwritten',async()=>{
   await root("create function spotivity_private.guard_court_identity()returns trigger language plpgsql as $$begin return new;end$$");
   const before=(await root("select prosrc from pg_proc where oid='spotivity_private.guard_court_identity()'::regprocedure")).rows[0].prosrc;
   await failed(/unregistered court identity objects/);
   assert.equal((await root("select prosrc from pg_proc where oid='spotivity_private.guard_court_identity()'::regprocedure")).rows[0].prosrc,before);
   await root('drop function spotivity_private.guard_court_identity()');
  });
  await t.test('an existing trigger with another function is not dropped',async()=>{
   await root("create function spotivity_private.fixture_identity_guard()returns trigger language plpgsql as $$begin return new;end$$");
   await root('create trigger spotivity_court_identity before insert on public.terenuri for each row execute function spotivity_private.fixture_identity_guard()');
   const before=(await root("select pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_court_identity'")).rows[0].definition;
   await failed(/unregistered court identity objects/);
   assert.equal((await root("select pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_court_identity'")).rows[0].definition,before);
   await root('drop trigger spotivity_court_identity on public.terenuri');
   await root('drop function spotivity_private.fixture_identity_guard()');
  });
  await t.test('reapplication does not overwrite a guard modified by another platform',async()=>{
   await migrate();
   await root("create or replace function spotivity_private.guard_court_identity()returns trigger language plpgsql security definer set search_path='' as $$begin return new;end$$");
   const before=(await root("select prosrc from pg_proc where oid='spotivity_private.guard_court_identity()'::regprocedure")).rows[0].prosrc;
   await failed(/Review the current court identity guard/);
   assert.equal((await root("select prosrc from pg_proc where oid='spotivity_private.guard_court_identity()'::regprocedure")).rows[0].prosrc,before);
  });
 }finally{await pg.close();}
});
