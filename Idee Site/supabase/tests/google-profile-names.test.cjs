// Disposable Auth/PostgreSQL fixture only. Never writes hosted users or profiles.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
const migration=file('018_google_profile_names.sql');
const integerIds=process.env.SPOTIVITY_TEST_INTEGER_IDS==='1';
const chain=['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql',
  '005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql',
  '008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql',
  '012_club_approval.sql','013_admin_integration.sql','014_booking_groups.sql',
  '015_profile_contact.sql','016_notification_outbox.sql','017_base_avatars.sql'];
let checks=0;

(async()=>{
  const pg=new PGlite();
  try{
    let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
    if(integerIds)schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
    else schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    await pg.exec(schema);
    const as=async(role,person,sql,params=[])=>{
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person?uid(person):''}',false); set role ${role}`);
      return pg.query(sql,params);
    };
    const root=(sql,params=[])=>as('postgres',null,sql,params);
    const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
    const profile=person=>root('select * from public.clienti where user_id=$1',[uid(person)]).then(r=>r.rows[0]);
    const user=(person,metadata={})=>root('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)',[uid(person),`google${person}@example.test`,JSON.stringify(metadata)]);
    const tables=['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari',
      'public.mesaje_chat','public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive',
      'public.baze_sportive_admini','public.cereri_baze_sportive','spotivity_private.booking_groups',
      'spotivity_private.notification_config','spotivity_private.notification_outbox','storage.buckets','storage.objects'];
    const snapshot=async()=>{
      const saved={};
      for(const table of tables)saved[table]=(await root(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows;
      return saved;
    };
    const policies=()=>root('select * from pg_policies order by schemaname,tablename,policyname').then(r=>r.rows);
    const triggers=()=>root('select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid').then(r=>r.rows);
    const others=()=>root("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','spotivity_private') and p.oid<>'spotivity_private.create_profile()'::regprocedure order by n.nspname,p.proname,arguments").then(r=>r.rows);
    const security=()=>root("select oid::text,proowner,proacl,prosecdef,proconfig from pg_proc where oid='spotivity_private.create_profile()'::regprocedure").then(r=>r.rows[0]);

    await check('018 refuses an unsecured schema without changing any existing profiles',async()=>{
      const before=(await root('select to_jsonb(c) row from public.clienti c order by email')).rows;
      await assert.rejects(()=>pg.exec(migration),/Apply migrations 001 through 017/);await pg.exec('rollback');
      assert.deepEqual((await root('select to_jsonb(c) row from public.clienti c order by email')).rows,before);
    });
    for(const name of chain)await pg.exec(file(name));
    await check('018 requires each recorded security and presentation prerequisite',async()=>{
      for(const version of [1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]){
        const saved=(await root('delete from spotivity_private.migrations where version=$1 returning *',[version])).rows[0];
        await assert.rejects(()=>pg.exec(migration),/Apply migrations 001 through 017/);await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)',[saved.version,saved.applied_at]);
      }
    });
    await check('018 refuses to replace an unrecognized profile function from another platform',async()=>{
      const definition=(await root("select pg_get_functiondef('spotivity_private.create_profile()'::regprocedure) definition")).rows[0].definition;
      await root("create or replace function spotivity_private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin return new; end $$");
      await assert.rejects(()=>pg.exec(migration),/differs from migration 015/);await pg.exec('rollback');
      await root(definition);
    });
    await check('018 refuses unexpected existing security attributes without changing them',async()=>{
      await root('alter function spotivity_private.create_profile() security invoker');
      await assert.rejects(()=>pg.exec(migration),/function security/);await pg.exec('rollback');
      assert.equal((await security()).prosecdef,false);
      await root('alter function spotivity_private.create_profile() security definer');
    });

    await user(21,{full_name:'Previously Ignored Provider Name'});
    await root("update public.clienti set nume='Previously Saved Name',telefon='0722123456' where user_id=$1",[uid(21)]);
    const before=await snapshot(),beforePolicies=await policies(),beforeTriggers=await triggers(),beforeFunctions=await others(),beforeSecurity=await security();
    const beforeAccess=[];
    for(const person of [1,2,3,4])beforeAccess.push((await as('authenticated',person,'select public.get_admin_access() value')).rows[0].value);
    await root('select 1');await pg.exec(migration);
    await check('018 changes no existing profile, Auth account, role, booking, Storage row, grant, policy or trigger',async()=>{
      assert.deepEqual(await snapshot(),before);assert.deepEqual(await policies(),beforePolicies);
      assert.deepEqual(await triggers(),beforeTriggers);assert.deepEqual(await others(),beforeFunctions);
      assert.deepEqual(await security(),beforeSecurity);
      assert.equal((await profile(21)).nume,'Previously Saved Name');
      for(const [index,person]of [1,2,3,4].entries())assert.deepEqual((await as('authenticated',person,'select public.get_admin_access() value')).rows[0].value,beforeAccess[index]);
    });
    await check('new Google profiles use a trimmed full_name without inventing a phone',async()=>{
      await user(30,{full_name:'  Alexandra Popescu  ',name:'Another Name'});
      const saved=await profile(30);assert.equal(saved.nume,'Alexandra Popescu');assert.equal(saved.telefon,'');
      assert.equal(saved.user_id,uid(30));assert.equal(saved.email,'google30@example.test');
    });
    await check('existing registration metadata nume remains first and retains its original truncation behavior',async()=>{
      await user(31,{nume:'  Saved Signup Name  ',full_name:'Provider Name',name:'Fallback Name',telefon:' +40 721 111 111 '});
      assert.equal((await profile(31)).nume,'Saved Signup Name');assert.equal((await profile(31)).telefon,'+40 721 111 111');
      await user(32,{nume:'X'.repeat(210),full_name:'Provider Name'});assert.equal((await profile(32)).nume,'X'.repeat(200));
      await user(33,{nume:'A',full_name:'Provider Name'});assert.equal((await profile(33)).nume,'A');
    });
    await check('valid provider name is the fallback when full_name is absent, blank, invalid or non-text',async()=>{
      for(const [person,full]of [[40,undefined],[41,'   '],[42,'A'],[43,'Invalid\nName'],[44,'X'.repeat(201)],[45,{name:'Object'}],[46,123],[47,null]]){
        const metadata={name:'  Fallback Name  '};if(full!==undefined)metadata.full_name=full;
        await user(person,metadata);assert.equal((await profile(person)).nume,'Fallback Name');
      }
    });
    await check('invalid provider names fall back to the email prefix and never block signup',async()=>{
      const cases=[{}, {full_name:'A',name:'B'}, {full_name:'Bad\tName',name:'Bad\nName'},
        {full_name:'X'.repeat(201),name:'Y'.repeat(201)}, {full_name:{bad:true},name:['Array']},
        {nume:' ',full_name:null,name:false}];
      for(const [index,metadata]of cases.entries()){
        const person=50+index;await user(person,metadata);assert.equal((await profile(person)).nume,`google${person}`);
      }
      await user(56,{full_name:'Ștefan Árpád 😀'});assert.equal((await profile(56)).nume,'Ștefan Árpád 😀');
    });
    await check('the existing 50-character phone validation and blank fallback are unchanged',async()=>{
      const formatted='+40'+' '.repeat(35)+'721234567';
      await user(60,{full_name:'Provider Phone',telefon:formatted});assert.equal((await profile(60)).telefon,formatted);
      for(const [person,phone]of [[61,'123'],[62,'+4071234567890123456'],[63,'0712\n345678'],[64,'<script>0712345678</script>']]){
        await user(person,{full_name:'No Valid Phone',telefon:phone});assert.equal((await profile(person)).telefon,'');
      }
    });
    await check('provider metadata cannot create an admin role or base allocation',async()=>{
      await user(70,{full_name:'Provider Client',is_super:true,role:'superadmin',terenuri:'ALL',baze:['ALL']});
      assert.equal((await root('select count(*)::int total from public.users_admin where user_id=$1',[uid(70)])).rows[0].total,0);
      assert.equal((await root('select count(*)::int total from public.baze_sportive_admini where user_id=$1',[uid(70)])).rows[0].total,0);
      const access=(await as('authenticated',70,'select public.get_admin_access() value')).rows[0].value;
      assert.equal(access.is_super,false);assert.equal(access.can_manage,false);assert.deepEqual(access.courts,[]);assert.deepEqual(access.bases,[]);
    });
    await check('later provider metadata changes do not overwrite a saved display name',async()=>{
      await root("update auth.users set raw_user_meta_data=$2 where id=$1",[uid(30),{full_name:'Later Provider Name'}]);
      assert.equal((await profile(30)).nume,'Alexandra Popescu');
      await as('authenticated',30,"update public.clienti set nume='My Edited Name',telefon='0722123456' where user_id=$1",[uid(30)]);
      await root("update auth.users set raw_user_meta_data=$2 where id=$1",[uid(30),{full_name:'Again Different Name'}]);
      assert.equal((await profile(30)).nume,'My Edited Name');
      assert.equal((await as('authenticated',70,"update public.clienti set nume='Other Name' where user_id=$1 returning user_id",[uid(30)])).rows.length,0);
    });
    await check('the private Auth trigger remains inaccessible to browser and service RPC roles',async()=>{
      for(const role of ['anon','authenticated','service_role'])assert.equal((await root("select has_function_privilege($1,'spotivity_private.create_profile()','execute') allowed",[role])).rows[0].allowed,false);
      assert.equal((await security()).prosecdef,true);assert.deepEqual((await security()).proconfig,['search_path=""']);
    });
    await check('reapplying 018 preserves all newly created profiles and existing authorization',async()=>{
      const saved=await snapshot(),savedSecurity=await security();
      await root('select 1');await pg.exec(migration);
      assert.deepEqual(await snapshot(),saved);assert.deepEqual(await security(),savedSecurity);
      assert.equal((await root('select count(*)::int total from spotivity_private.migrations where version=18')).rows[0].total,1);
      assert.deepEqual(await policies(),beforePolicies);assert.deepEqual(await triggers(),beforeTriggers);
    });
    console.log(`${checks} Google profile-name checks passed (${integerIds?'integer':'UUID'} IDs)`);
  }finally{await pg.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
