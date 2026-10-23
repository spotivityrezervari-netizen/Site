// Disposable PostgreSQL/RLS fixture only. Never connects to hosted services.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
const migration=file('020_final_sport_backgrounds.sql');
const replacements={Fotbal:'assets/imagini/FotbalFinal.jpeg',Baschet:'assets/imagini/BaschetFinal.jpeg',Tenis:'assets/imagini/TenisFINAL.jpeg'};
const chain=['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql',
  '006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql',
  '010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql',
  '014_booking_groups.sql','015_profile_contact.sql','016_notification_outbox.sql','017_base_avatars.sql',
  '018_google_profile_names.sql','019_owner_court_creation.sql'];
let checks=0;
(async()=>{
  const pg=new PGlite();
  try{
    let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
    if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
    await pg.exec(schema);
    const root=async(sql,args=[])=>{await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");return pg.query(sql,args);};
    const check=async(label,fn)=>{await fn();checks++;console.log('PASS',label);};
    const read=()=>root('select * from public.site_sporturi order by sport').then(r=>r.rows);
    const recorded=()=>root('select count(*)::int total from spotivity_private.migrations where version=20').then(r=>r.rows[0].total);
    const snapshot=async()=>{
      const state={};
      const tables=(await root("select schemaname||'.'||tablename as name from pg_tables where schemaname in ('auth','public','spotivity_private','storage') and tablename not in ('site_sporturi','migrations') order by schemaname,tablename")).rows;
      for(const {name}of tables)state[name]=(await root(`select to_jsonb(t) value from ${name} t order by to_jsonb(t)::text`)).rows;
      state.policies=(await root('select * from pg_policies order by schemaname,tablename,policyname')).rows;
      state.triggers=(await root('select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid')).rows;
      state.functions=(await root("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','spotivity_private') order by n.nspname,p.proname,arguments")).rows;
      state.grants=(await root("select * from information_schema.role_table_grants where table_schema in ('public','spotivity_private','storage') order by table_schema,table_name,grantee,privilege_type")).rows;
      return state;
    };
    await check('020 refuses an unsecured schema without creating presentation data',async()=>{
      await assert.rejects(()=>pg.exec(migration),/Apply visual migrations 005 and 010/);await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.site_sporturi')::text name")).rows[0].name,null);
    });
    for(const name of chain)await pg.exec(file(name));
    await check('020 requires both recorded visual prerequisites',async()=>{
      for(const version of [5,10]){
        const saved=(await root('delete from spotivity_private.migrations where version=$1 returning *',[version])).rows[0];
        const before=await read();
        await assert.rejects(()=>pg.exec(migration),/Apply visual migrations 005 and 010/);await pg.exec('rollback');
        assert.deepEqual(await read(),before);assert.equal(await recorded(),0);
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)',[saved.version,saved.applied_at]);
      }
    });
    await check('020 refuses a missing target without partial updates or registering itself',async()=>{
      const removed=(await root("delete from public.site_sporturi where sport='Tenis' returning *")).rows[0];
      const before=await read();
      await assert.rejects(()=>pg.exec(migration),/Expected all three existing sports/);await pg.exec('rollback');
      assert.deepEqual(await read(),before);assert.equal(await recorded(),0);
      await root('insert into public.site_sporturi(sport,icona_url,fundal_url,ordine) values($1,$2,$3,$4)',[removed.sport,removed.icona_url,removed.fundal_url,removed.ordine]);
    });
    await root("update public.site_sporturi set icona_url='https://cdn.example.test/custom-football-icon.webp',ordine=3,fundal_url='https://cdn.example.test/previous-football.jpg' where sport='Fotbal'");
    await root("update public.site_sporturi set fundal_url='https://cdn.example.test/custom-volleyball.webp' where sport='Volei'");
    const beforeVisuals=await read(),before=await snapshot();
    const beforeVersions=(await root('select * from spotivity_private.migrations order by version')).rows;
    await root('select 1');await pg.exec(migration);
    await check('020 changes only the three requested backgrounds, preserving icons, ordering and other sports',async()=>{
      assert.deepEqual(await read(),beforeVisuals.map(row=>replacements[row.sport]?{...row,fundal_url:replacements[row.sport]}:row));
      assert.equal(await recorded(),1);
      assert.deepEqual((await root('select * from spotivity_private.migrations where version<>20 order by version')).rows,beforeVersions);
    });
    await check('020 leaves Auth, profiles, courts, bookings, grants, Storage, policies, functions and triggers unchanged',async()=>{
      assert.deepEqual(await snapshot(),before);
    });
    await check('the current standard backgrounds and retained icons resolve to exact case-sensitive repository assets',async()=>{
      for(const row of beforeVisuals){
        const background=replacements[row.sport]||row.fundal_url;
        for(const path of [row.icona_url,background])if(path.startsWith('assets/'))assert.ok(existsSync(join(__dirname,'../..',path)),path);
      }
      assert.ok(existsSync(join(__dirname,'../../assets/imagini/RealistVolei.png')));
      assert.ok(existsSync(join(__dirname,'../../assets/imagini/fotbalrealist.png')));
    });
    await root("update public.site_sporturi set fundal_url='https://cdn.example.test/later-football.webp' where sport='Fotbal'");
    await root("delete from public.site_sporturi where sport='Tenis'");
    const later=await read(),laterState=await snapshot();
    await root('select 1');await pg.exec(migration);
    await check('reapplying 020 retains later custom images and deliberately deleted sport rows',async()=>{
      assert.deepEqual(await read(),later);assert.deepEqual(await snapshot(),laterState);assert.equal(await recorded(),1);
    });
    console.log(`${checks} final sport background checks passed.`);
  }finally{await pg.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
