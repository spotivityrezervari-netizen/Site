// Disposable PostgreSQL/Storage metadata tests. Never writes to hosted Supabase.
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('017_base_avatars.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const bucket = 'poze_baze_sportive';
const chain = ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql','014_booking_groups.sql','015_profile_contact.sql','016_notification_outbox.sql'];
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (integerIds) schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    else schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); select set_config('request.jwt.claims','${JSON.stringify({role, sub: person ? uid(person) : null})}',false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const image = (base, n, ext = 'jpg') => `${base}/${uid(n)}.${ext}`;
    const upload = (person, path, role = 'authenticated', target = bucket) => as(role, person, 'insert into storage.objects(bucket_id,name) values($1,$2) returning name', [target, path]);
    const avatar = (person, base, path) => as('authenticated', person, 'update public.baze_sportive set poza_profil=$1 where id=$2 returning *', [path, base]);
    const row = base => root('select * from public.baze_sportive where id=$1', [base]).then(r => r.rows[0]);
    const access = person => as('authenticated', person, 'select public.get_admin_access() value').then(r => r.rows[0].value);
    const withoutAvatar = value => ({...value, bases: value.bases.map(({poza_profil, ...base}) => base)});
    const state = async (omitAvatar = false) => {
      const saved = {};
      for (const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','spotivity_private.booking_groups','spotivity_private.notification_outbox','spotivity_private.notification_config','storage.buckets','storage.objects']) {
        const expression = table === 'public.baze_sportive' && omitAvatar ? "to_jsonb(t)-'poza_profil'" : 'to_jsonb(t)';
        saved[table] = (await root(`select ${expression} value from ${table} t order by (${expression})::text`)).rows;
      }
      return saved;
    };
    const triggers = () => root('select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid').then(r => r.rows);
    const policies = () => root('select * from pg_policies order by schemaname,tablename,policyname').then(r => r.rows);
    const otherFunctions = () => root("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','spotivity_private') and p.oid not in ('spotivity_private.guard_base()'::regprocedure,'public.get_admin_access()'::regprocedure) order by n.nspname,p.proname,arguments").then(r => r.rows);
    await check('017 refuses an unsecured schema without adding an avatar column', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply migrations 001 through 016/); await pg.exec('rollback');
    });
    for (const name of chain) await pg.exec(file(name));
    await check('017 requires every recorded prerequisite, including existing booking and notification protections', async () => {
      for (const version of [1,3,4,5,6,7,8,9,10,11,12,13,14,15,16]) {
        const saved = (await root('delete from spotivity_private.migrations where version=$1 returning *', [version])).rows[0];
        await assert.rejects(() => pg.exec(migration), /Apply migrations 001 through 016/); await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)', [saved.version,saved.applied_at]);
      }
    });
    await check('017 refuses to overwrite an unregistered existing avatar field', async () => {
      await root('alter table public.baze_sportive add column poza_profil text');
      await assert.rejects(() => pg.exec(migration), /existing unregistered sports-base profile photo column/); await pg.exec('rollback');
      await root('alter table public.baze_sportive drop column poza_profil');
    });
    const courts = Object.fromEntries((await root('select nume,id::text id from public.terenuri')).rows.map(c => [c.nume,c.id]));
    await root("insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Court-only admin','bob@example.test',false,'Court B')");
    await root('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [uid(5),'presentation@example.test']);
    // A base-presentation grant may outlive removal of its last allocated court.
    await root("insert into public.terenuri(nume,sport,pret) values('Removed avatar allocation','Fotbal',90)");
    await root("insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Presentation admin','presentation@example.test',false,'Removed avatar allocation')");
    await root("delete from public.terenuri where nume='Removed avatar allocation'");
    const save = (id, name, assignedCourts, admins = [], active = true) => as('authenticated', 4,
      'select public.save_sports_base($1,$2,$3,$4,$5,$6::text[],$7::uuid[]) id', [id,name,'Cluj','Existing description',active,assignedCourts,admins]);
    const baseA = (await save(null,'Base A',[courts['Court A']],[uid(3)])).rows[0].id;
    const baseB = (await save(null,'Base B',[courts['Court B']])).rows[0].id;
    const privateBase = (await save(null,'Presentation only',[],[uid(5)],false)).rows[0].id;
    const coverA = image(baseA,100), coverB = image(baseB,101), originalPrivate = image(privateBase,102);
    await upload(3,coverA); await upload(4,coverB); await upload(5,originalPrivate);
    await as('authenticated',3,'update public.baze_sportive set poza=$1 where id=$2',[coverA,baseA]);
    await as('authenticated',4,'update public.baze_sportive set poza=$1 where id=$2',[coverB,baseB]);
    await as('authenticated',5,'update public.baze_sportive set poza=$1 where id=$2',[originalPrivate,privateBase]);
    const tomorrow = (await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+1)::text as booking_day")).rows[0].booking_day;
    const completed = (await root("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$1,'Court A','2000-01-01','12:00','activa') returning id",[uid(1)])).rows[0].id;
    const future = (await root("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$1,'Court A',$2,'12:00','activa') returning id",[uid(1),tomorrow])).rows[0].id;
    const before = await state(true), beforeTriggers = await triggers(), beforePolicies = await policies(), beforeFunctions = await otherFunctions();
    const beforeAccess = {};
    for (const person of [1,2,3,4,5]) beforeAccess[person] = await access(person);
    await root('select 1'); await pg.exec(migration);
    await check('migration preserves all existing rows, covers, Storage settings, grants, policies, triggers and unrelated functions', async () => {
      assert.deepEqual(await state(true),before); assert.deepEqual(await triggers(),beforeTriggers);
      assert.deepEqual(await policies(),beforePolicies); assert.deepEqual(await otherFunctions(),beforeFunctions);
      assert.ok((await root('select poza_profil from public.baze_sportive')).rows.every(b => b.poza_profil === null));
      assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=17')).rows[0].n,1);
    });
    await check('server-derived management scope is unchanged apart from the new presentation field', async () => {
      for (const person of [1,2,3,4,5]) assert.deepEqual(withoutAvatar(await access(person)),beforeAccess[person]);
      assert.equal((await access(2)).bases.find(b => b.id === baseB).can_edit_details,false);
      assert.deepEqual((await access(5)).courts,[]);
    });
    await check('only authenticated callers can read management scope; private guards remain inaccessible', async () => {
      for (const role of ['anon','service_role']) await assert.rejects(() => as(role,null,'select public.get_admin_access()'),/permission denied/);
      for (const role of ['anon','authenticated','service_role']) assert.equal((await root("select has_function_privilege($1,'spotivity_private.guard_base()','execute') allowed",[role])).rows[0].allowed,false);
      for (const signature of ['spotivity_private.guard_base()','public.get_admin_access()']) assert.deepEqual((await root('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0],{prosecdef:true,proconfig:['search_path=""']});
    });
    const avatarA = image(baseA,110,'png');
    await check('an explicitly assigned administrator uploads and saves an avatar without replacing the cover', async () => {
      await upload(3,avatarA); assert.equal((await avatar(3,baseA,avatarA)).rows.length,1);
      const saved = await row(baseA); assert.equal(saved.poza,coverA); assert.equal(saved.poza_profil,avatarA);
      assert.equal((await access(3)).bases.find(b => b.id === baseA).poza_profil,avatarA);
    });
    await check('public active-base reads return both independent images without exposing a private base', async () => {
      const visible = (await as('anon',null,'select id,poza,poza_profil from public.baze_sportive order by id')).rows;
      assert.deepEqual(visible.find(b => b.id === baseA),{id:baseA,poza:coverA,poza_profil:avatarA});
      assert.equal(visible.some(b => b.id === privateBase),false);
    });
    await check('avatar replacement/removal and cover replacement preserve the other image reference', async () => {
      const replacement = image(baseA,111,'webp'), cover = image(baseA,112,'avif');
      await upload(3,replacement); await avatar(3,baseA,replacement); assert.equal((await row(baseA)).poza,coverA);
      await avatar(3,baseA,null); assert.equal((await row(baseA)).poza,coverA);
      await avatar(3,baseA,avatarA); await upload(3,cover);
      await as('authenticated',3,'update public.baze_sportive set poza=$1 where id=$2',[cover,baseA]);
      assert.equal((await row(baseA)).poza_profil,avatarA);
    });
    await check('avatars reject malformed paths, SVG, other-base objects, URLs and unuploaded raster paths', async () => {
      for (const invalid of ['',`https://example.test/${avatarA}`,image(baseA,120,'svg'),image(baseA,120,'PNG'),`${baseA}/nested/${uid(120)}.png`,`${baseA}/../${uid(120)}.png`,`${baseA}/human-name.png`,coverB,image(baseA,120)]) {
        await assert.rejects(() => avatar(3,baseA,invalid),/profile photo|constraint/);
      }
      assert.equal((await row(baseA)).poza_profil,avatarA);
    });
    await check('bucket-object existence is enforced for superadmin and trusted maintenance too', async () => {
      for (const person of [3,4]) await assert.rejects(() => avatar(person,baseA,image(baseA,121)),/Upload the sports-base profile photo/);
      await assert.rejects(() => root('update public.baze_sportive set poza_profil=$1 where id=$2',[image(baseA,122),baseA]),/Upload the sports-base profile photo/);
    });
    await check('anonymous visitors and ordinary clients cannot upload or edit any base avatar', async () => {
      await assert.rejects(() => upload(null,image(baseA,130),'anon'),/row-level security/);
      await assert.rejects(() => as('anon',null,'update public.baze_sportive set poza_profil=null where id=$1',[baseA]),/permission denied/);
      assert.equal((await avatar(1,baseA,null)).rows.length,0);
      await assert.rejects(() => upload(1,image(baseA,131)),/row-level security/);
    });
    await check('court allocation alone permits court management but never base-avatar edits or uploads', async () => {
      assert.equal((await as('authenticated',2,"update public.terenuri set pret=220 where nume='Court B' returning id")).rows.length,1);
      assert.equal((await avatar(2,baseB,null)).rows.length,0);
      await assert.rejects(() => upload(2,image(baseB,132)),/row-level security/);
      assert.equal((await row(baseB)).poza,coverB);
    });
    await check('an assigned base administrator cannot upload, edit or move images into another base', async () => {
      assert.equal((await avatar(3,baseB,null)).rows.length,0);
      await assert.rejects(() => upload(3,image(baseB,133)),/row-level security/);
      await assert.rejects(() => as('authenticated',3,'update storage.objects set name=$1 where bucket_id=$2 and name=$3',[image(baseB,134),bucket,avatarA]),/row-level security/);
      assert.equal((await as('authenticated',3,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,coverB])).rows.length,0);
    });
    await check('a presentation-only grant can edit its private base avatar without gaining unrelated court or client access', async () => {
      const path = image(privateBase,140); await upload(5,path); assert.equal((await avatar(5,privateBase,path)).rows.length,1);
      assert.deepEqual((await access(5)).courts,[]);
      assert.equal((await as('authenticated',5,"update public.terenuri set pret=1 where nume='Court A' returning id")).rows.length,0);
      assert.equal((await as('authenticated',5,'select user_id from public.clienti where user_id=$1',[uid(1)])).rows.length,0);
      assert.equal((await as('authenticated',5,'select id from public.rezervari where client_user_id=$1',[uid(1)])).rows.length,0);
    });
    await check('ordinary base administrators still cannot change structural fields alongside a valid avatar', async () => {
      const beforeRow = await row(baseA);
      for (const sql of ["set nume='Forged',poza_profil=$1", "set oras='Forged',poza_profil=$1",'set este_activa=false,poza_profil=$1','set id=gen_random_uuid(),poza_profil=$1',"set created_at=now()+interval '1 day',poza_profil=$1"]) {
        await assert.rejects(() => as('authenticated',3,`update public.baze_sportive ${sql} where id=$2`,[avatarA,baseA]),/only a sports-base description/);
      }
      assert.deepEqual(await row(baseA),beforeRow);
      await assert.rejects(() => as('authenticated',3,'insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[baseB,uid(3)]));
      assert.equal((await as('authenticated',3,'update public.users_admin set is_super=true where user_id=$1 returning id',[uid(3)])).rows.length,0);
    });
    await check('superadmin can set both photos for another base while preserving the explicit owner grants', async () => {
      const path = image(baseB,150,'gif'); await upload(4,path); assert.equal((await avatar(4,baseB,path)).rows.length,1);
      const base = (await access(4)).bases.find(b => b.id === baseB); assert.equal(base.poza_profil,path); assert.equal(base.can_edit_details,true);
      assert.equal((await root('select count(*)::int n from public.baze_sportive_admini where baza_id=$1',[baseB])).rows[0].n,0);
    });
    await check('revoking a base grant immediately removes avatar write/delete rights from the same Auth identity', async () => {
      await root('delete from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[baseA,uid(3)]);
      assert.equal((await avatar(3,baseA,null)).rows.length,0);
      await assert.rejects(() => upload(3,image(baseA,151)),/row-level security/);
      assert.equal((await as('authenticated',3,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,avatarA])).rows.length,0);
      assert.equal((await access(3)).bases.find(b => b.id === baseA).can_edit_details,false);
      assert.equal((await row(baseA)).poza_profil,avatarA);
      await root('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[baseA,uid(3)]);
    });
    await check('new permissive policies cannot reopen another base or the presentation-field whitelist', async () => {
      await root('create policy fixture_avatar_unsafe on public.baze_sportive for all to authenticated using(true) with check(true)');
      await root('create policy fixture_avatar_unsafe on storage.objects for all to authenticated using(true) with check(true)');
      assert.equal((await avatar(2,baseB,null)).rows.length,0); assert.equal((await avatar(3,baseB,null)).rows.length,0);
      await assert.rejects(() => upload(3,image(baseB,152)),/row-level security/);
      await assert.rejects(() => as('authenticated',3,"update public.baze_sportive set nume='Forged',poza_profil=$1 where id=$2",[avatarA,baseA]),/only a sports-base description/);
    });
    await check('completed booking protection and cancellation of a future booking remain intact', async () => {
      for (const person of [1,3,4]) await assert.rejects(() => as('authenticated',person,"update public.rezervari set stare='anulata' where id=$1",[completed]),/Completed bookings/);
      assert.equal((await as('authenticated',1,"update public.rezervari set stare='anulata' where id=$1 returning id",[future])).rows.length,1);
    });
    await check('rerunning 017 preserves all live avatar/cover references, business data, policies and trigger objects', async () => {
      const final = await state(), finalTriggers = await triggers(), finalPolicies = await policies(), finalFunctions = await otherFunctions();
      await root('select 1'); await pg.exec(migration);
      assert.deepEqual(await state(),final); assert.deepEqual(await triggers(),finalTriggers);
      assert.deepEqual(await policies(),finalPolicies); assert.deepEqual(await otherFunctions(),finalFunctions);
      assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=17')).rows[0].n,1);
    });
    console.log(`\n${passed} base avatar checks passed (${integerIds ? 'numeric' : 'UUID'} IDs).`);
  } finally { await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
