// Disposable PostgreSQL/Storage metadata fixture. Never writes to hosted Supabase.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('011_club_requests.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const bucket = 'cereri_baze_sportive';
const signature = 'public.submit_club_request(uuid,text,text,text,text,text,text,text,jsonb,text,text)';
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (integerIds) schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    else schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    await pg.exec(schema);
    await pg.exec('alter table storage.objects add column if not exists metadata jsonb');
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const request = (number, changes = {}) => ({id:uid(number),nume_baza:'Baza sportivă Test',nume_contact:'Ana Pop',email:'contact@example.test',telefon:'+40 712 345 678',oras:'Cluj-Napoca',adresa:'Strada Sportului 3',link_maps:'https://maps.app.goo.gl/Abc123',terenuri:[{nume:'Fotbal 1',sport:'Fotbal'},{nume:'Picior 1',sport:'Tenis Picior'}],descriere:'Două terenuri pentru comunitate.',poza_path:null,...changes});
    const submit = (person, value, role = 'authenticated') => as(role, person,
      'select public.submit_club_request($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) id',
      [value.id,value.nume_baza,value.nume_contact,value.email,value.telefon,value.oras,value.adresa,value.link_maps,JSON.stringify(value.terenuri),value.descriere,value.poza_path]);
    const all = (person, role = 'authenticated') => as(role, person,'select * from public.cereri_baze_sportive order by created_at,id').then(result=>result.rows);
    const photo = (owner, requestId, number=500, extension='png') => `${uid(owner)}/${requestId}/${uid(number)}.${extension}`;
    const upload = (person, path, metadata={size:2048,mimetype:'image/png'}, role='authenticated', target=bucket) => as(role,person,
      'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[target,path,JSON.stringify(metadata)]);
    const readPhoto = (person,path,role='authenticated') => as(role,person,'select name from storage.objects where bucket_id=$1 and name=$2',[bucket,path]).then(result=>result.rows);
    const deletePhoto = (person,path,role='authenticated') => as(role,person,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,path]).then(result=>result.rows);
    const review = (person,id,status,note='') => as('authenticated',person,'update public.cereri_baze_sportive set stare=$1,nota_interna=$2 where id=$3 returning *',[status,note,id]);
    const protectedTables = ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive','public.baze_sportive_admini','storage.objects'];
    const business = async () => {
      const state={};
      for(const table of protectedTables) state[table]=(await root(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
      return state;
    };
    const definitions = async () => ({
      policies:(await root("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where policyname not like 'spotivity_club_%' order by schemaname,tablename,policyname")).rows,
      triggers:(await root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgname not like 'spotivity_club_%' order by oid")).rows,
      guards:(await root("select p.oid::text,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='spotivity_private' and p.proname not like '%club_request%') or (n.nspname='public' and p.proname='save_sports_base') order by p.oid")).rows
    });
    await check('011 refuses unsecured projects without creating requests or bucket',async()=>{
      await assert.rejects(()=>pg.exec(migration),/Apply migrations 001/); await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.cereri_baze_sportive')::text name")).rows[0].name,null);
    });
    for(const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql']) await pg.exec(file(name));
    await check('011 requires 010 and checks every registered predecessor',async()=>{
      await assert.rejects(()=>pg.exec(migration),/010 before 011/); await pg.exec('rollback');
      await pg.exec(file('010_foot_tennis.sql'));
      for(const version of [1,3,4,5,6,7,8,9,10]){
        const saved=(await root('delete from spotivity_private.migrations where version=$1 returning *',[version])).rows[0];
        await assert.rejects(()=>pg.exec(migration),/Apply migrations 001/);await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)',[saved.version,saved.applied_at]);
      }
    });
    await check('011 refuses an unregistered application table or bucket',async()=>{
      await root('create table public.cereri_baze_sportive(id uuid)');
      await assert.rejects(()=>pg.exec(migration),/unregistered sports-base applications/);await pg.exec('rollback');
      await root('drop table public.cereri_baze_sportive');
      await root('insert into storage.buckets(id,name,public) values($1,$1,true)',[bucket]);
      await assert.rejects(()=>pg.exec(migration),/unregistered sports-base applications/);await pg.exec('rollback');
      await root('delete from storage.buckets where id=$1',[bucket]);
    });
    const before=await business();const oldDefinitions=await definitions();const oldBuckets=(await root('select * from storage.buckets order by id')).rows;
    await pg.exec(migration);
    await check('011 preserves existing business rows, permissions, guards and triggers',async()=>{
      assert.deepEqual(await business(),before);assert.deepEqual(await definitions(),oldDefinitions);
      for(const old of oldBuckets)assert.deepEqual((await root('select * from storage.buckets where id=$1',[old.id])).rows[0],old);
      assert.equal((await all(4)).length,0);
    });
    await check('request photos use a private 5 MiB raster-only bucket',async()=>{
      const config=(await root('select * from storage.buckets where id=$1',[bucket])).rows[0];
      assert.equal(config.public,false);assert.equal(Number(config.file_size_limit),5242880);
      assert.deepEqual(config.allowed_mime_types,['image/jpeg','image/png','image/webp','image/avif','image/gif']);
    });
    await check('anonymous callers cannot execute RPC, read requests, or write/read request photos',async()=>{
      await assert.rejects(()=>submit(null,request(100),'anon'),/permission denied/);
      await assert.rejects(()=>all(null,'anon'),/permission denied/);
      await assert.rejects(()=>submit(null,request(100)),/Authentication is required/);
      await assert.rejects(()=>submit(999,request(100)),/Authentication is required/);
      await assert.rejects(()=>upload(null,photo(1,uid(100)),undefined,'anon'),/row-level security/);
    });
    await check('direct application INSERT, DELETE, TRUNCATE and submitted-field UPDATE have no browser grant',async()=>{
      for(const privilege of ['INSERT','DELETE','TRUNCATE'])assert.equal((await root('select has_table_privilege($1,$2,$3) ok',['authenticated','public.cereri_baze_sportive',privilege])).rows[0].ok,false);
      for(const column of ['id','solicitant_user_id','created_at','updated_at','nume_baza','email','poza_path','reviewer_user_id','reviewed_at'])assert.equal((await root('select has_column_privilege($1,$2,$3,$4) ok',['authenticated','public.cereri_baze_sportive',column,'UPDATE'])).rows[0].ok,false);
      for(const column of ['stare','nota_interna'])assert.equal((await root('select has_column_privilege($1,$2,$3,$4) ok',['authenticated','public.cereri_baze_sportive',column,'UPDATE'])).rows[0].ok,true);
    });
    await check('server validates required names/contact/city, supported court arrays and safe Maps hosts',async()=>{
      const invalids=[{id:null},{nume_baza:null},{nume_baza:'A'},{nume_baza:'x'.repeat(161)},{nume_contact:'B'},{nume_contact:'A\nB'},{email:'no-address'},{email:'a@b.test\nCC'},{telefon:'123456'},{telefon:'+1234567890123456'},{telefon:'phone1234567'},{oras:'A'},{adresa:'x'.repeat(301)},{descriere:'x'.repeat(3001)},{link_maps:'http://maps.app.goo.gl/Abc'},{link_maps:'https://evil.test/maps'},{link_maps:'https://google.com.evil.test/maps'},{link_maps:'https://google.com@evil.test/maps'},{link_maps:'https://maps.app.goo.gl.evil.test/X'},{link_maps:'javascript:alert(1)'},{terenuri:null},{terenuri:{}},{terenuri:[]},{terenuri:Array(21).fill({nume:'Court',sport:'Fotbal'})},{terenuri:[{nume:'A',sport:'Fotbal'}]},{terenuri:[{nume:'Court',sport:'Golf'}]},{terenuri:[{nume:'Court',sport:'Tenis de picior'}]},{terenuri:[{nume:'Court',sport:'Fotbal',admin:true}]},{terenuri:[{nume:123,sport:'Fotbal'}]}];
      for(const change of invalids)await assert.rejects(()=>submit(1,request(100,change)),/Check the required|identifier is required/);
      assert.equal((await all(4)).length,0);
    });
    const first=request(100,{nume_baza:'  Baza Test  ',email:'  CONTACT@EXAMPLE.TEST  ',terenuri:[{nume:'  Court 1 ',sport:'Fotbal'},{nume:'Tenis 1',sport:'Tenis'},{nume:'Baschet 1',sport:'Baschet'},{nume:'Volei 1',sport:'Volei'},{nume:'Picior 1',sport:'Tenis Picior'}]});
    await check('authenticated requester submits all five sports and receives only the request UUID',async()=>{
      assert.deepEqual((await submit(1,first)).rows,[{id:uid(100)}]);
      const row=(await all(4))[0];assert.equal(row.solicitant_user_id,uid(1));assert.equal(row.nume_baza,'Baza Test');assert.equal(row.email,'contact@example.test');assert.equal(row.terenuri[0].nume,'Court 1');assert.equal(row.terenuri.length,5);assert.equal(row.stare,'noua');assert.equal(row.nota_interna,'');assert.equal(row.reviewer_user_id,null);
    });
    await check('requester, other clients, ordinary admins and metadata-spoofed users cannot list applications',async()=>{
      for(const person of [1,2,3])assert.deepEqual(await all(person),[]);
      assert.deepEqual(await all(null),[]);
      await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1',[uid(1),JSON.stringify({is_super:true,role:'superadmin'})]);
      assert.deepEqual(await all(1),[]);
      await root("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1",[uid(1)]);
    });
    await check('retry is idempotent, detects changed payload and never adopts another user request UUID',async()=>{
      assert.equal((await submit(1,first)).rows[0].id,uid(100));
      await assert.rejects(()=>submit(1,{...first,oras:'Oradea'}),/already used with different details/);
      await assert.rejects(()=>submit(2,first),/identifier is unavailable/);
      assert.equal((await all(4)).length,1);
    });
    await check('unattached drafts are visible and removable only to their own signed-in uploader and superadmin',async()=>{
      const path=photo(1,uid(101));await upload(1,path);
      assert.equal((await readPhoto(1,path)).length,1);assert.equal((await readPhoto(4,path)).length,1);
      for(const person of [2,3]){assert.deepEqual(await readPhoto(person,path),[]);assert.deepEqual(await deletePhoto(person,path),[]);}
      assert.deepEqual(await readPhoto(null,path,'anon'),[]);
      assert.equal((await deletePhoto(1,path)).length,1);assert.deepEqual(await readPhoto(4,path),[]);
    });
    await check('uploads reject another account, traversal, unsupported extensions, malformed IDs and all object replacements',async()=>{
      for(const path of [photo(2,uid(101)),`${uid(1)}/../image.png`,`${uid(1)}/${uid(101)}/bad.png`,photo(1,uid(101),500,'svg'),`${uid(1)}/${uid(101)}/${uid(500)}.PNG`])await assert.rejects(()=>upload(1,path),/row-level security|must belong/);
      const path=photo(1,uid(101));await upload(1,path);
      for(const person of [1,4])assert.deepEqual((await as('authenticated',person,'update storage.objects set metadata=$1::jsonb where bucket_id=$2 and name=$3 returning name',[JSON.stringify({size:100,mimetype:'image/png'}),bucket,path])).rows,[]);
      await deletePhoto(1,path);
    });
    const attachedPath=photo(1,uid(101));
    await check('submission requires photo ownership, matching request ID, an existing raster object and valid metadata',async()=>{
      await assert.rejects(()=>submit(1,request(101,{poza_path:attachedPath})),/Upload an allowed/);
      await upload(2,photo(2,uid(101)));
      await assert.rejects(()=>submit(1,request(101,{poza_path:photo(2,uid(101))})),/must belong/);
      await upload(1,photo(1,uid(999)));
      await assert.rejects(()=>submit(1,request(101,{poza_path:photo(1,uid(999))})),/must belong/);
      for(const metadata of [null,{}, {size:0,mimetype:'image/png'},{size:5242881,mimetype:'image/png'},{size:42,mimetype:'image/svg+xml'},{size:'invalid',mimetype:'image/png'}]){
        await root('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[bucket,attachedPath,JSON.stringify(metadata)]);
        await assert.rejects(()=>submit(1,request(101,{poza_path:attachedPath})),/Upload an allowed|at most 5 MB/);
        await root('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,attachedPath]);
      }
      await upload(1,attachedPath);
      assert.equal((await submit(1,request(101,{poza_path:attachedPath}))).rows[0].id,uid(101));
    });
    await check('submitted photos become private to superadmins and immutable to the submitting user',async()=>{
      for(const person of [1,2,3]){assert.deepEqual(await readPhoto(person,attachedPath),[]);assert.deepEqual(await deletePhoto(person,attachedPath),[]);}
      assert.deepEqual(await readPhoto(null,attachedPath,'anon'),[]);assert.equal((await readPhoto(4,attachedPath)).length,1);
      await assert.rejects(()=>upload(1,photo(1,uid(101),501)),/row-level security|immutable/);
      const changed=await as('authenticated',4,'update storage.objects set name=$1 where bucket_id=$2 and name=$3 returning name',[photo(1,uid(101),502),bucket,attachedPath]);assert.deepEqual(changed.rows,[]);
    });
    await check('legacy permissive policies cannot reopen requests or submitted images',async()=>{
      await root('create policy fixture_unsafe_club_requests on public.cereri_baze_sportive for all to public using(true) with check(true)');
      for(const person of [1,2,3]){assert.deepEqual(await all(person),[]);assert.equal((await review(person,uid(100),'acceptata','Bad')).rows.length,0);}
      assert.equal((await all(4)).length,2);await root('drop policy fixture_unsafe_club_requests on public.cereri_baze_sportive');
      assert.deepEqual(await readPhoto(1,attachedPath),[]);
    });
    await check('only superadmins may review, with server attribution and immutable submitted details',async()=>{
      const before=(await all(4)).find(row=>row.id===uid(100));
      const changed=(await review(4,uid(100),'in_analiza','Am verificat baza.')).rows[0];
      assert.equal(changed.stare,'in_analiza');assert.equal(changed.nota_interna,'Am verificat baza.');assert.equal(changed.reviewer_user_id,uid(4));assert.ok(changed.reviewed_at);assert.ok(new Date(changed.updated_at)>=new Date(before.updated_at));
      for(const field of ['nume_baza','nume_contact','email','telefon','oras','adresa','terenuri','descriere','poza_path','solicitant_user_id','created_at'])assert.deepEqual(changed[field],before[field]);
      await assert.rejects(()=>as('authenticated',4,"update public.cereri_baze_sportive set email='changed@example.test' where id=$1",[uid(100)]),/permission denied/);
      await assert.rejects(()=>review(4,uid(100),'published'),/check constraint/);await assert.rejects(()=>review(4,uid(100),'in_analiza','x'.repeat(2001)),/check constraint/);
      assert.equal((await submit(1,first)).rows[0].id,uid(100));
      const submitted=await business();await review(4,uid(100),'acceptata','Pregătită pentru contact.');assert.deepEqual(await business(),submitted);
    });
    await check('even an accidental broad UPDATE grant cannot let superadmins mutate contact data or attribution',async()=>{
      await root('grant update on public.cereri_baze_sportive to authenticated');
      await assert.rejects(()=>as('authenticated',4,"update public.cereri_baze_sportive set email='changed@example.test' where id=$1",[uid(100)]),/submitted details are immutable/);
      await assert.rejects(()=>as('authenticated',4,'update public.cereri_baze_sportive set reviewer_user_id=$1 where id=$2',[uid(1),uid(100)]),/controlled by the server/);
      await root('revoke update on public.cereri_baze_sportive from authenticated');await root('grant update(stare,nota_interna) on public.cereri_baze_sportive to authenticated');
    });
    await check('superadmin demotion immediately removes request and photo visibility and review permissions',async()=>{
      await root("update public.users_admin set is_super=false,terenuri='Court A' where user_id=$1",[uid(4)]);
      assert.deepEqual(await all(4),[]);assert.deepEqual(await readPhoto(4,attachedPath),[]);assert.equal((await review(4,uid(100),'respinsa')).rows.length,0);
      await root("update public.users_admin set is_super=true,terenuri='ALL' where user_id=$1",[uid(4)]);
    });
    await check('rate limit is per-account and retries do not consume more submissions',async()=>{
      for(const n of [102,103,104])await submit(1,request(n));
      await assert.rejects(()=>submit(1,request(105)),/five sports-base applications/);
      assert.equal((await submit(1,first)).rows[0].id,uid(100));assert.equal((await submit(2,request(200))).rows[0].id,uid(200));
      await root("update public.cereri_baze_sportive set created_at=statement_timestamp()-interval '25 hours' where id=$1",[uid(102)]);
      assert.equal((await submit(1,request(105))).rows[0].id,uid(105));
    });
    await check('ordinary court-admin and public court-photo access stays scoped and unchanged',async()=>{
      const own=`${uid(3)}/legacy-court.jpg`;await upload(3,own,{size:10,mimetype:'image/jpeg'},'authenticated','poze_terenuri');
      assert.equal((await as('anon',null,'select name from storage.objects where bucket_id=$1 and name=$2',['poze_terenuri',own])).rows.length,1);
      assert.equal((await as('authenticated',3,"update public.terenuri set pret=110 where nume='Court A' returning id")).rows.length,1);
      assert.equal((await as('authenticated',3,"update public.terenuri set pret=1 where nume='Court B' returning id")).rows.length,0);
    });
    await check('completed reservations remain uncancellable by their client and both admin roles',async()=>{
      const completed=(await root("insert into public.rezervari(email_client,client_user_id,sport,teren,data_str,ora,stare) values('alice@example.test',$1,'Fotbal','Court A','2000-01-01','12:00','activa') returning *",[uid(1)])).rows[0];
      for(const person of [1,3,4])await assert.rejects(()=>as('authenticated',person,"update public.rezervari set stare='anulata' where id=$1",[completed.id]),/Completed bookings cannot be cancelled/);
      assert.equal((await root('select stare from public.rezervari where id=$1',[completed.id])).rows[0].stare,'activa');
    });
    await check('requester and reviewer account deletion retain the application but clear Auth references',async()=>{
      await root("insert into auth.users(id,email,email_confirmed_at) values($1,'temporary@example.test',now())",[uid(9)]);
      await root("insert into auth.users(id,email,email_confirmed_at) values($1,'temporary-reviewer@example.test',now())",[uid(10)]);
      await root("insert into public.users_admin(nume_admin,email,user_id,is_super,terenuri) values('Temporary reviewer','temporary-reviewer@example.test',$1,true,'ALL')",[uid(10)]);
      const retainedPhoto=photo(9,uid(900));await upload(9,retainedPhoto);
      await submit(9,request(900,{poza_path:retainedPhoto}));
      const reviewed=(await review(10,uid(900),'contactata','Date verificate înainte de ștergerea conturilor.')).rows[0];
      assert.equal(reviewed.reviewer_user_id,uid(10));assert.ok(reviewed.reviewed_at);
      await root('delete from auth.users where id=any($1::uuid[])',[[uid(9),uid(10)]]);
      const retained=(await all(4)).find(row=>row.id===uid(900));
      assert.equal(retained.solicitant_user_id,null);assert.equal(retained.poza_path,retainedPhoto);
      assert.equal(retained.reviewer_user_id,null);assert.deepEqual(retained.reviewed_at,reviewed.reviewed_at);assert.equal(retained.nota_interna,reviewed.nota_interna);
      assert.equal((await readPhoto(4,retainedPhoto)).length,1);
      for(const person of [1,2,3])assert.deepEqual(await readPhoto(person,retainedPhoto),[]);
    });
    await check('reapplying migration preserves requests, review attribution, business rows and trigger identities',async()=>{
      const rows=await all(4);const state=await business();const defs=await definitions();
      const triggers=(await root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid")).rows;
      await root('select 1');await pg.exec(migration);
      assert.deepEqual(await all(4),rows);assert.deepEqual(await business(),state);assert.deepEqual(await definitions(),defs);
      assert.deepEqual((await root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid")).rows,triggers);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(row=>row.version),[1,3,4,5,6,7,8,9,10,11]);
      assert.equal((await root('select has_function_privilege($1,$2,$3) ok',['anon',signature,'EXECUTE'])).rows[0].ok,false);
    });
    console.log(`\n${passed} private club-request checks passed (${integerIds?'numeric':'UUID'} court IDs).`);
  } finally {await pg.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
