// Isolated PostgreSQL/RLS fixture only. Never run against the hosted project.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
const migration=file('019_owner_court_creation.sql');
const integers=process.env.SPOTIVITY_TEST_INTEGER_IDS==='1';
const chain=['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql',
 '006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql',
 '010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql','014_booking_groups.sql',
 '015_profile_contact.sql','016_notification_outbox.sql','017_base_avatars.sql','018_google_profile_names.sql'];
let checks=0;
(async()=>{
 const pg=new PGlite();
 try{
  let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
  if(integers)schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
  else schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
  await pg.exec(schema);
  const as=async(role,person,sql,args=[])=>{
   await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person?uid(person):''}',false); set role ${role}`);
   return pg.query(sql,args);
  };
  const root=(sql,args=[])=>as('postgres',null,sql,args);
  const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
  const call=(person,base,name,sport='Fotbal',price=100,hours=null)=>as('authenticated',person,
   'select public.create_managed_court($1,$2,$3,$4,$5) court',[base,name,sport,price,hours]).then(result=>result.rows[0].court);
  const tables=['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat',
   'public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive','public.baze_sportive_admini',
   'public.cereri_baze_sportive','spotivity_private.booking_groups','spotivity_private.notification_config',
   'spotivity_private.notification_outbox','storage.objects','storage.buckets'];
  const snapshot=async()=>{
   const result={};
   for(const table of tables)result[table]=(await root(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows;
   return result;
  };
  const admins=()=>root('select to_jsonb(a) value from public.users_admin a order by user_id').then(r=>r.rows.map(row=>row.value));
  const policies=()=>root('select * from pg_policies order by schemaname,tablename,policyname').then(r=>r.rows);
  const triggers=()=>root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgname<>'spotivity_allocate_created_court' order by oid").then(r=>r.rows);
  const otherFunctions=()=>root("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','spotivity_private') and p.oid not in ('spotivity_private.guard_court()'::regprocedure,'spotivity_private.guard_court_base()'::regprocedure) and p.proname not in ('allocate_created_court','create_managed_court') order by n.nspname,p.proname,arguments").then(r=>r.rows);
  await check('019 refuses an unsecured schema',async()=>{
   await assert.rejects(()=>pg.exec(migration),/Apply migrations 001 through 018/);await pg.exec('rollback');
  });
  for(const name of chain)await pg.exec(file(name));
  const own=uid(101),other=uid(102);
  await root("insert into public.baze_sportive(id,nume,oras) values($1,'Managed Base','Reghin'),($2,'Other Base','Cluj-Napoca')",[own,other]);
  await root("update public.terenuri set baza_sportiva_id=$1,oras='Reghin',locatie='https://maps.google.com/?q=fixture' where nume='Court A'",[own]);
  await root("update public.terenuri set baza_sportiva_id=$1,oras='Cluj-Napoca' where nume='Court B'",[other]);
  for(const person of [5,6]){
   await root('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid(person),`owner${person}@example.test`]);
   await root("insert into public.users_admin(user_id,email,nume_admin,is_super,terenuri) values($1,$2,'Additional Owner',false,'Court B')",[uid(person),`owner${person}@example.test`]);
  }
  await root('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2),($1,$3)',[own,uid(3),uid(5)]);
  await root("insert into public.rezervari(email_client,client_user_id,sport,teren,data_str,ora,pret_total,stare) values('alice@example.test',$1,'Fotbal','Court A',((now() at time zone 'Europe/Bucharest')::date-10)::text,'12:00','100 RON','activa')",[uid(1)]);
  await check('019 refuses changed guards and preserves their security instead of overwriting another platform',async()=>{
   const definition=(await root("select pg_get_functiondef('spotivity_private.guard_court()'::regprocedure) definition")).rows[0].definition;
   await root("create or replace function spotivity_private.guard_court() returns trigger language plpgsql security definer set search_path='' as $$begin return new; end$$");
   await assert.rejects(()=>pg.exec(migration),/guard_court function/);await pg.exec('rollback');await root(definition);
   await root('alter function spotivity_private.guard_court() security invoker');
   await assert.rejects(()=>pg.exec(migration),/guard_court function/);await pg.exec('rollback');await root('alter function spotivity_private.guard_court() security definer');
  });
  const before=await snapshot(),beforePolicies=await policies(),beforeTriggers=await triggers(),beforeFunctions=await otherFunctions();
  await root('select 1');await pg.exec(migration);
  await check('019 preserves every existing data row, policy, trigger and unrelated function',async()=>{
   assert.deepEqual(await snapshot(),before);assert.deepEqual(await policies(),beforePolicies);
   assert.deepEqual(await triggers(),beforeTriggers);assert.deepEqual(await otherFunctions(),beforeFunctions);
   assert.equal((await root("select count(*)::int total from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_allocate_created_court'")).rows[0].total,1);
  });
  await check('only authenticated callers can execute the narrow RPC and trigger functions remain private',async()=>{
   for(const role of ['anon','service_role'])await assert.rejects(()=>as(role,null,'select public.create_managed_court($1,$2,$3,$4,$5)',[own,'Disallowed','Fotbal',100,null]),/permission denied/);
   await assert.rejects(()=>as('authenticated',null,'select public.create_managed_court($1,$2,$3,$4,$5)',[own,'No identity','Fotbal',100,null]),/Sign in/);
   for(const role of ['anon','authenticated','service_role'])for(const fn of ['guard_court','guard_court_base','allocate_created_court'])
    assert.equal((await root('select has_function_privilege($1,$2,\'execute\') allowed',[role,`spotivity_private.${fn}()`])).rows[0].allowed,false);
  });
  await check('ordinary direct INSERT remains denied even with an extra permissive court policy',async()=>{
   const insert="insert into public.terenuri(nume,sport,pret,pret_minge,baza_sportiva_id) values('REST bypass','Fotbal',100,0,$1)";
   await assert.rejects(()=>as('authenticated',3,insert,[own]),/row-level security/);
   await root('create policy fixture_extra_insert on public.terenuri for insert to authenticated with check(true)');
   await assert.rejects(()=>as('authenticated',3,insert,[own]),/row-level security/);
   await root('drop policy fixture_extra_insert on public.terenuri');
  });
  const preCreateAdmins=await admins();let created;
  await check('ordinary owner creates one court in the explicitly assigned base and is allocated only that new court',async()=>{
   created=await call(3,own,' New Owner Court ','Tenis Picior',0,['14:00','12:00']);
   assert.equal(created.nume,'New Owner Court');assert.equal(created.sport,'Tenis Picior');assert.equal(created.oras,'Reghin');
   assert.equal(created.locatie,'https://maps.google.com/?q=fixture');assert.equal(created.baza_sportiva_id,own);
   assert.equal(created.pret,0);assert.equal(created.pret_minge,0);assert.equal(created.optiune_minge,false);assert.equal(created.poza,null);
   assert.equal(created.este_activ,true);assert.equal(created.are_chat,true);assert.deepEqual(created.ore_rezervabile,['12:00','14:00']);
   assert.equal(typeof created.id,'string');if(integers)assert.match(created.id,/^\d+$/);else assert.match(created.id,/^[a-f0-9-]{36}$/);
   const after=await admins();
   for(const old of preCreateAdmins){const saved=after.find(row=>row.user_id===old.user_id);if(old.user_id!==uid(3))assert.deepEqual(saved,old);
    else {const {terenuri,...rest}=saved;assert.deepEqual(rest,(({terenuri,...rest})=>rest)(old));assert.deepEqual(terenuri.split(',').sort(),[...old.terenuri.split(','),created.nume].sort());}}
   const access=(await as('authenticated',3,'select public.get_admin_access() access')).rows[0].access;
   assert.ok(access.courts.some(row=>row.id===created.id));assert.equal(access.is_super,false);
   assert.equal((await as('authenticated',5,'select public.get_admin_access() access')).rows[0].access.courts.some(row=>row.id===created.id),false);
  });
  await check('the creator can edit the new court while rename, relink, role elevation and other-base access remain denied',async()=>{
   const changed=await as('authenticated',3,'update public.terenuri set pret=125 where id::text=$1 returning pret',[created.id]);assert.equal(changed.rows[0].pret,'125');
   await assert.rejects(()=>as('authenticated',3,"update public.terenuri set nume='Renamed' where id::text=$1",[created.id]),/Only superadmins/);
   await assert.rejects(()=>as('authenticated',3,'update public.terenuri set baza_sportiva_id=$1 where id::text=$2',[other,created.id]),/Only superadmins|only settings/);
   assert.equal((await as('authenticated',3,'update public.users_admin set is_super=true where user_id=$1 returning user_id',[uid(3)])).rows.length,0);
   await assert.rejects(()=>call(3,other,'Foreign Base Court'),/not explicitly assigned/);
   await assert.rejects(()=>call(6,own,'Delegated Court Only'),/not explicitly assigned/);
   await assert.rejects(()=>call(1,own,'Client Court'),/existing administrator/);
  });
  await check('invalid names, sports, prices and hours fail atomically without new assignments',async()=>{
   const saved=await snapshot();
   for(const name of ['A','X'.repeat(121),'Comma, Court','Control\nCourt',null])await assert.rejects(()=>call(3,own,name),/Court name/);
   for(const sport of ['fotbal','Unknown',null])await assert.rejects(()=>call(3,own,'Rejected Sport',sport),/supported sport/);
   for(const price of [-1,100001,null])await assert.rejects(()=>call(3,own,'Rejected Price','Fotbal',price),/Court price/);
   await assert.rejects(()=>call(3,own,'Decimal Price','Fotbal',1.5),/invalid input syntax/);
   for(const hours of [['08:00'],['12:30'],['12:00','12:00'],[null]])await assert.rejects(()=>call(3,own,'Rejected Hours','Fotbal',100,hours),/Court hours/);
   await assert.rejects(()=>call(3,own,'Court A'),/unique constraint/);
   assert.deepEqual(await snapshot(),saved);
  });
  await check('revoked base grants and roles cannot create a court or exploit client-supplied context',async()=>{
   await root('delete from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[own,uid(5)]);
   await as('authenticated',5,"select set_config('spotivity.owner_base',$1,false),set_config('spotivity.create_court','true',false)",[own]);
   await assert.rejects(()=>call(5,own,'Revoked Base Grant'),/not explicitly assigned/);
   await root('delete from public.users_admin where user_id=$1',[uid(6)]);
   await assert.rejects(()=>call(6,own,'Revoked Role'),/existing administrator/);
   await root('update auth.users set email_confirmed_at=null where id=$1',[uid(3)]);
   await assert.rejects(()=>call(3,own,'Unconfirmed Caller'),/confirmed Auth email/);
   await root('update auth.users set email_confirmed_at=now() where id=$1',[uid(3)]);
  });
  await check('default hours and an explicitly empty schedule remain distinct',async()=>{
   const defaultHours=await call(3,own,'Default Schedule');assert.equal(defaultHours.ore_rezervabile.length,11);assert.equal(defaultHours.ore_rezervabile[0],'12:00');
   const empty=await call(3,own,'Empty Schedule','Volei',100,[]);assert.deepEqual(empty.ore_rezervabile,[]);
  });
  await check('superadmin creates in any base without a grant and remains ALL without ordinary-role changes',async()=>{
   const previous=await admins();const court=await call(4,other,'Super Created Court','Baschet',140);
   assert.equal(court.baza_sportiva_id,other);assert.deepEqual(await admins(),previous);
  });
  await check('completed bookings still reject staff cancellation and removal',async()=>{
   await assert.rejects(()=>as('authenticated',3,"update public.rezervari set stare='anulata' where teren='Court A' and stare='activa' and starts_at<now()"),/Completed bookings/);
   await assert.rejects(()=>as('authenticated',3,"delete from public.rezervari where teren='Court A' and stare='activa' and starts_at<now()"),/Completed bookings/);
  });
  await check('reapplication refuses later changes to creation bodies, security, trigger configuration or grants',async()=>{
   for(const [signature,change] of [
    ['public.create_managed_court(uuid,text,text,integer,text[])',"create or replace function public.create_managed_court(p_base_id uuid,p_name text,p_sport text,p_price integer,p_hours text[] default null) returns jsonb language plpgsql security definer set search_path='' as $$begin return '{}'::jsonb; end$$"],
    ['spotivity_private.allocate_created_court()',"create or replace function spotivity_private.allocate_created_court() returns trigger language plpgsql security definer set search_path='' as $$begin return new; end$$"]]){
    const original=(await root('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
    await root(change);
    const changed=(await root('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
    await assert.rejects(()=>pg.exec(migration),/before reapplying migration 019/);await pg.exec('rollback');
    assert.equal((await root('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition,changed);
    await root(original);
    await root(`alter function ${signature} security invoker`);
    await assert.rejects(()=>pg.exec(migration),/before reapplying migration 019/);await pg.exec('rollback');
    assert.equal((await root('select prosecdef from pg_proc where oid=$1::regprocedure',[signature])).rows[0].prosecdef,false);
    await root(`alter function ${signature} security definer`);
   }
   await root('alter table public.terenuri disable trigger spotivity_allocate_created_court');
   await assert.rejects(()=>pg.exec(migration),/allocation trigger before reapplying/);await pg.exec('rollback');
   assert.equal((await root("select tgenabled from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_allocate_created_court'")).rows[0].tgenabled,'D');
   await root('alter table public.terenuri enable trigger spotivity_allocate_created_court');
   await root('grant execute on function public.create_managed_court(uuid,text,text,integer,text[]) to anon');
   await assert.rejects(()=>pg.exec(migration),/creation function grants before reapplying/);await pg.exec('rollback');
   assert.equal((await root("select has_function_privilege('anon','public.create_managed_court(uuid,text,text,integer,text[])','execute') allowed")).rows[0].allowed,true);
   await root('revoke execute on function public.create_managed_court(uuid,text,text,integer,text[]) from anon');
  });
  await check('reapplying 019 preserves all rows, policies, original triggers and existing allocations',async()=>{
   const saved=await snapshot();
   const addedTrigger=(await root("select oid::text,pg_get_triggerdef(oid) definition,tgenabled from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_allocate_created_court'")).rows[0];
   await root('select 1');await pg.exec(migration);
   assert.deepEqual(await snapshot(),saved);assert.deepEqual(await policies(),beforePolicies);assert.deepEqual(await triggers(),beforeTriggers);
   assert.deepEqual((await root("select oid::text,pg_get_triggerdef(oid) definition,tgenabled from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_allocate_created_court'")).rows[0],addedTrigger);
   assert.equal((await root('select count(*)::int total from spotivity_private.migrations where version=19')).rows[0].total,1);
  });
  console.log(`${checks} owner court-creation checks passed (${integers?'integer':'UUID'} IDs)`);
 }finally{await pg.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
