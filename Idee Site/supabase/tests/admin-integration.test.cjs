// Disposable PostgreSQL regression suite. Never run this fixture on hosted Supabase.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
const integerIds=process.env.SPOTIVITY_TEST_INTEGER_IDS==='1';
let passed=0;
(async()=>{const pg=new PGlite();try{
  let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
  if(integerIds)schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
  else schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
  await pg.exec(schema);
  const as=async(role,person,sql,params=[])=>{
    await pg.exec(`reset role;select set_config('request.jwt.claim.sub','${person?uid(person):''}',false);set role ${role}`);
    return pg.query(sql,params);
  };
  const root=(sql,params=[])=>as('postgres',null,sql,params);
  const access=person=>as('authenticated',person,'select public.get_admin_access() value').then(r=>r.rows[0].value);
  const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
  const tables=['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','storage.objects','storage.buckets'];
  const snapshot=async()=>{const values={};for(const table of tables)values[table]=(await root(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows;return values};
  await check('013 requires all earlier migrations',async()=>{await assert.rejects(()=>pg.exec(file('013_admin_integration.sql')),/Apply migrations/);await pg.exec('rollback')});
  for(const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql'])await pg.exec(file(name));
  await check('unregistered conflicting scope RPC is not overwritten',async()=>{
    await root("create function public.get_admin_access() returns jsonb language sql as $$select '{}'::jsonb$$");
    await assert.rejects(()=>pg.exec(file('013_admin_integration.sql')),/unregistered/);await pg.exec('rollback');await root('drop function public.get_admin_access()');
  });
  const before=await snapshot();
  const previousTriggers=(await root("select tgname,pg_get_triggerdef(oid) definition,tgenabled::text from pg_trigger where not tgisinternal order by tgname")).rows;
  await pg.exec(file('013_admin_integration.sql'));
  await check('migration preserves every business row and previous trigger definition',async()=>{
    assert.deepEqual(await snapshot(),before);
    const after=(await root("select tgname,pg_get_triggerdef(oid) definition,tgenabled::text from pg_trigger where not tgisinternal and tgname<>'spotivity_booking_history_guard' order by tgname")).rows;
    assert.deepEqual(after,previousTriggers);
  });
  await check('013 is repeatable without changing data or duplicating policies',async()=>{
    await root('select 1');await pg.exec(file('013_admin_integration.sql'));assert.deepEqual(await snapshot(),before);
    assert.equal((await root('select count(*)::integer total from spotivity_private.migrations where version=13')).rows[0].total,1);
    assert.equal((await root("select count(*)::integer total from pg_policies where policyname like 'spotivity_boundary_%' and permissive='RESTRICTIVE'")).rows[0].total,31);
  });
  await check('scope RPC requires authenticated role and has no caller-selected identity',async()=>{
    for(const role of ['anon','service_role'])await assert.rejects(()=>as(role,null,'select public.get_admin_access()'),/permission denied/);
    const definition=(await root("select prosecdef,provolatile,proconfig,pronargs from pg_proc where oid='public.get_admin_access()'::regprocedure")).rows[0];
    assert.equal(definition.prosecdef,true);assert.equal(definition.provolatile,'s');assert.equal(definition.pronargs,0);assert.deepEqual(definition.proconfig,['search_path=""']);
    assert.equal((await access(null)).can_manage,false);
  });
  await check('client-controlled profile metadata grants no authority',async()=>{
    await root('update auth.users set raw_user_meta_data=$1::jsonb where id=$2',[JSON.stringify({is_super:true,role:'admin',terenuri:['Court A']}),uid(2)]);
    assert.deepEqual(await access(2),{is_super:false,nume_admin:null,can_manage:false,courts:[],bases:[]});
  });
  await check('legacy standalone court allocation works without inventing a base',async()=>{
    const a=await access(3);assert.equal(a.can_manage,true);assert.equal(a.is_super,false);assert.equal(a.nume_admin,'Manager');assert.deepEqual(a.courts.map(c=>c.nume),['Court A']);assert.equal(a.courts[0].baza_sportiva_id,null);assert.equal(typeof a.courts[0].id,'string');assert.deepEqual(a.bases,[]);
  });
  await root("insert into public.baze_sportive(id,nume,oras,este_activa) values($1,'Base One','Cluj',false),($2,'Base Two','Cluj',false),($3,'Presentation Only','Cluj',false)",[uid(501),uid(502),uid(503)]);
  await root("update public.terenuri set baza_sportiva_id=$1 where nume in ('Court A','Court B')",[uid(501)]);
  await root("update public.terenuri set baza_sportiva_id=$1 where nume='Hidden Court'",[uid(502)]);
  await root("update public.users_admin set terenuri='Court A,Hidden Court' where user_id=$1",[uid(3)]);
  await root('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[uid(503),uid(3)]);
  await check('multiple and inactive bases expose exact independent court and presentation grants',async()=>{
    const a=await access(3);assert.deepEqual(a.courts.map(c=>c.nume),['Court A','Hidden Court']);assert.equal(a.bases.length,3);
    assert.deepEqual(a.bases.map(b=>[b.id,b.can_edit_details]).sort(),[[uid(501),false],[uid(502),false],[uid(503),true]]);
    assert.equal((await as('authenticated',3,'select * from public.baze_sportive where id=$1',[uid(501)])).rows.length,0);
    assert.equal(a.courts.some(c=>c.nume==='Court B'),false);
  });
  await check('base description/photo grant does not grant reservation, client, chat or court permissions',async()=>{
    assert.equal((await as('authenticated',3,"update public.terenuri set pret=1 where nume='Court B' returning id")).rows.length,0);
    assert.equal((await as('authenticated',3,"update public.baze_sportive set descriere='allowed' where id=$1 returning id",[uid(503)])).rows.length,1);
    assert.equal((await as('authenticated',3,"update public.baze_sportive set descriere='denied' where id=$1 returning id",[uid(501)])).rows.length,0);
    await assert.rejects(()=>as('authenticated',3,"update public.baze_sportive set nume='Renamed' where id=$1",[uid(503)]),/description and photo/);
  });
  await check('revocation is reflected immediately without replacing the Auth session',async()=>{
    await root('delete from public.baze_sportive_admini where user_id=$1',[uid(3)]);
    await root("update public.users_admin set terenuri='Court B' where user_id=$1",[uid(3)]);
    const a=await access(3);assert.deepEqual(a.courts.map(c=>c.nume),['Court B']);assert.deepEqual(a.bases.map(b=>b.id),[uid(501)]);assert.equal(a.bases[0].can_edit_details,false);
    await root("update public.users_admin set terenuri='Court A,Hidden Court' where user_id=$1",[uid(3)]);
  });
  await check('superadmin retains all real bases and courts',async()=>{
    const a=await access(4);assert.equal(a.is_super,true);assert.equal(a.can_manage,true);assert.equal(a.courts.length,3);assert.equal(a.bases.length,3);assert.ok(a.bases.every(b=>b.can_edit_details));
  });
  await check('presentation-only rights work while a stale admin row without real grants grants no access',async()=>{
    await root("insert into auth.users(id,email,email_confirmed_at) values($1,'presentation@example.test',now())",[uid(5)]);
    await root("insert into public.terenuri(nume,sport,pret) values('Temporary Allocation','Fotbal',100)");
    await root("insert into public.users_admin(nume_admin,email,user_id,is_super,terenuri) values('Presentation','presentation@example.test',$1,false,'Temporary Allocation')",[uid(5)]);
    await root('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[uid(503),uid(5)]);
    await root("delete from public.terenuri where nume='Temporary Allocation'");
    const a=await access(5);assert.equal(a.can_manage,true);assert.deepEqual(a.courts,[]);assert.deepEqual(a.bases.map(b=>[b.id,b.can_edit_details]),[[uid(503),true]]);
    assert.equal((await as('authenticated',5,"update public.terenuri set pret=1 where nume='Court A' returning id")).rows.length,0);
    await root('delete from public.baze_sportive_admini where user_id=$1',[uid(5)]);
    const revoked=await access(5);assert.equal(revoked.can_manage,false);assert.deepEqual(revoked.courts,[]);assert.deepEqual(revoked.bases,[]);
  });
  // Add deliberately permissive policies after migration. The new restrictive
  // boundaries must still enforce server-side authority for direct REST SQL.
  for(const table of ['users_admin','baze_sportive_admini','baze_sportive','terenuri','rezervari','mesaje_chat','clienti','site_sporturi','cereri_baze_sportive'])await root(`create policy fixture_unsafe on public.${table} for all to authenticated using(true) with check(true)`);
  await check('permissive policy drift cannot reopen global admin roles, grants or sports configuration',async()=>{
    assert.deepEqual((await as('authenticated',3,'select user_id from public.users_admin order by user_id')).rows.map(r=>r.user_id),[uid(3)]);
    for(const person of [1,2,3]){
      assert.equal((await as('authenticated',person,'delete from public.users_admin where user_id=$1 returning id',[uid(4)])).rows.length,0);
      assert.equal((await as('authenticated',person,"update public.users_admin set is_super=true where user_id=$1 returning id",[uid(3)])).rows.length,0);
      await assert.rejects(()=>as('authenticated',person,'insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[uid(501),uid(3)]));
      assert.equal((await as('authenticated',person,"update public.site_sporturi set ordine=2 where sport='Fotbal' returning sport")).rows.length,0);
      assert.equal((await as('authenticated',person,"delete from public.site_sporturi where sport='Fotbal' returning sport")).rows.length,0);
      assert.equal((await as('authenticated',person,'delete from public.baze_sportive where id=$1 returning id',[uid(501)])).rows.length,0);
      await assert.rejects(()=>as('authenticated',person,"insert into public.baze_sportive(nume,oras) values('Forged','Cluj')"));
      await assert.rejects(()=>as('authenticated',person,"insert into public.terenuri(nume,sport,pret) values('Forged','Fotbal',1)"));
      assert.equal((await as('authenticated',person,"delete from public.terenuri where nume='Court B' returning id")).rows.length,0);
      await assert.rejects(()=>as('authenticated',person,'select public.save_sports_base(null,$1,$2,$3,true,$4::text[],$5::uuid[])',['Forged','Cluj','',[],[]]),/Only authenticated superadmins/);
    }
  });
  const day=(await root("select ((now() at time zone 'Europe/Bucharest')::date+1)::text as d")).rows[0].d;
  const book=(person,court,hour,email)=>as('authenticated',person,"insert into public.rezervari(email_client,teren,data_str,ora,stare) values($1,$2,$3,$4,'activa') returning *",[email,court,day,hour]).then(r=>r.rows[0]);
  const own=await book(1,'Court A','12:00','alice@example.test');
  const other=await book(2,'Court B','12:00','bob@example.test');
  await check('booking identity, authoritative price and assigned-court API scope survive policy drift',async()=>{
    assert.equal(own.pret_total,'100 RON');assert.equal(own.client_user_id,uid(1));
    assert.deepEqual((await as('authenticated',3,'select id from public.rezervari where id in ($1,$2) order by id',[own.id,other.id])).rows.map(r=>r.id),[own.id]);
    assert.equal((await as('authenticated',3,"update public.rezervari set stare='anulata' where id=$1 returning id",[other.id])).rows.length,0);
    assert.equal((await as('authenticated',3,'delete from public.rezervari where id=$1 returning id',[other.id])).rows.length,0);
    await assert.rejects(()=>book(1,'Court A','13:00','bob@example.test'));
    await assert.rejects(()=>book(3,'Court B','13:00','Manual Guest'));
    assert.equal((await book(3,'Court A','13:00','Manual Guest')).client_user_id,null);
  });
  await check('chat and client-profile API scope survives permissive policies',async()=>{
    for(const [person,court,email]of [[1,'Court A','alice@example.test'],[2,'Court B','bob@example.test']])await as('authenticated',person,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values($1,$2,'client','hello')",[email,court]);
    assert.deepEqual((await as('authenticated',3,'select teren from public.mesaje_chat')).rows.map(r=>r.teren),['Court A']);
    assert.equal((await as('authenticated',3,'select user_id from public.clienti where user_id=$1',[uid(2)])).rows.length,0);
    await assert.rejects(()=>as('authenticated',3,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('bob@example.test','Court B','admin','forged')"));
    assert.equal((await as('authenticated',3,"update public.clienti set telefon='forged' where user_id=$1 returning user_id",[uid(1)])).rows.length,0);
    assert.equal((await as('authenticated',3,'delete from public.mesaje_chat where teren=$1 returning id',['Court B'])).rows.length,0);
  });
  await check('court settings, hourly schedule and image Storage scope are still authorized independently',async()=>{
    assert.equal((await as('authenticated',3,"update public.terenuri set pret=130,ore_rezervabile=array['12:00','13:00','14:00'] where nume='Court A' returning id")).rows.length,1);
    assert.equal((await as('authenticated',3,"update public.terenuri set pret=1 where nume='Court B' returning id")).rows.length,0);
    await assert.rejects(()=>as('authenticated',3,"update public.terenuri set baza_sportiva_id=$1 where nume='Court A'",[uid(502)]),/link or unlink/);
    await assert.rejects(()=>as('authenticated',3,"update public.terenuri set nume='Renamed' where nume='Court A'"),/rename/);
    await as('authenticated',3,'insert into storage.objects(bucket_id,name) values($1,$2)',['poze_terenuri',uid(3)+'/own.png']);
    await assert.rejects(()=>as('authenticated',3,'insert into storage.objects(bucket_id,name) values($1,$2)',['poze_baze_sportive',uid(501)+'/'+uid(600)+'.png']));
  });
  await check('approval is superadmin-only and immediately enables the existing applicant session',async()=>{
    assert.equal((await access(2)).can_manage,false);
    await as('service_role',null,'select public.submit_club_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb)',[uid(2),uid(700),'New Club','Bob','bob@example.test','0712345678','Cluj','Strada 1','https://maps.app.goo.gl/Abc123',JSON.stringify([{nume:'New Court',sport:'Fotbal'}]),'Description',null,JSON.stringify([180])]);
    for(const person of [1,2,3]){
      assert.equal((await as('authenticated',person,'select id from public.cereri_baze_sportive')).rows.length,0);
      assert.equal((await as('authenticated',person,"update public.cereri_baze_sportive set stare='respinsa' where id=$1 returning id",[uid(700)])).rows.length,0);
      await assert.rejects(()=>as('authenticated',person,"select public.approve_club_request($1,'[180]'::jsonb)",[uid(700)]),/Only authenticated superadmins/);
      await assert.rejects(()=>as('authenticated',person,'select public.reject_club_request($1)',[uid(700)]),/Only authenticated superadmins/);
    }
    const approved=(await as('authenticated',4,"select public.approve_club_request($1,'[180]'::jsonb) value",[uid(700)])).rows[0].value;
    const a=await access(2);assert.equal(a.is_super,false);assert.equal(a.can_manage,true);assert.equal(a.courts.length,1);assert.equal(a.courts[0].baza_sportiva_id,approved.base_id);assert.equal(a.bases[0].can_edit_details,true);
    assert.equal((await as('authenticated',2,"update public.terenuri set pret=190 where id::text=$1 returning id",[a.courts[0].id])).rows.length,1);
    assert.equal((await as('authenticated',2,"update public.terenuri set pret=1 where nume='Court A' returning id")).rows.length,0);
    await root('delete from public.users_admin where user_id=$1',[uid(2)]);assert.equal((await access(2)).can_manage,false);
  });
  // Seed completed history through trusted maintenance, preserving all browser
  // guards. The migration must reject DELETE and separate rescheduling calls.
  const completed=(await root("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$1,'Court A','2020-01-01','12:00','activa') returning *",[uid(1)])).rows[0];
  await check('clients, assigned admins and superadmins cannot cancel, delete or reschedule completed active bookings',async()=>{
    for(const person of [1,3,4]){
      await assert.rejects(()=>as('authenticated',person,"update public.rezervari set stare='anulata' where id=$1",[completed.id]),/Completed bookings/);
      await assert.rejects(()=>as('authenticated',person,'update public.rezervari set data_str=$2 where id=$1',[completed.id,day]));
      if(person!==1)await assert.rejects(()=>as('authenticated',person,'delete from public.rezervari where id=$1',[completed.id]),/Completed bookings cannot be removed/);
      else assert.equal((await as('authenticated',person,'delete from public.rezervari where id=$1 returning id',[completed.id])).rows.length,0);
    }
    assert.deepEqual((await root('select * from public.rezervari where id=$1',[completed.id])).rows[0],completed);
  });
  await check('future cancellations and trusted maintenance remain available',async()=>{
    assert.equal((await as('authenticated',1,"update public.rezervari set stare='anulata' where id=$1 returning id",[own.id])).rows.length,1);
    assert.equal((await as('authenticated',3,"update public.rezervari set stare='anulata' where teren='Court A' and ora='13:00' returning id")).rows.length,1);
    assert.equal((await as('service_role',null,'delete from public.rezervari where id=$1 returning id',[completed.id])).rows.length,1);
  });
  console.log(`\n${passed} integrated admin security checks passed (${integerIds?'integer':'UUID'} IDs).`);
}finally{await pg.close()}})().catch(error=>{console.error(error);process.exitCode=1});
