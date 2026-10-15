// Isolated PostgreSQL/Storage metadata fixture. Never writes to hosted Supabase.
// Bucket configuration is tested here; actual image bytes use the Storage API.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('009_base_photos.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const bucket = 'poze_baze_sportive';
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (integerIds) schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    else schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const image = (base, number, extension = 'jpg') => `${base}/${uid(number)}.${extension}`;
    const upload = (person, name, role = 'authenticated', targetBucket = bucket) => as(role, person,
      'insert into storage.objects(bucket_id,name) values($1,$2) returning *', [targetBucket, name]);
    const remove = (person, name, role = 'authenticated') => as(role, person,
      'delete from storage.objects where bucket_id=$1 and name=$2 returning *', [bucket, name]);
    const move = (person, oldName, newName) => as('authenticated', person,
      'update storage.objects set name=$1 where bucket_id=$2 and name=$3 returning *', [newName, bucket, oldName]);
    const photo = (person, base, name) => as('authenticated', person,
      'update public.baze_sportive set poza=$1 where id=$2 returning *', [name, base]);
    const baseRow = base => root('select * from public.baze_sportive where id=$1', [base]).then(result => result.rows[0]);
    const stateTables = ['auth.users', 'public.clienti', 'public.users_admin', 'public.terenuri', 'public.rezervari', 'public.mesaje_chat', 'public.rezervari_disponibilitate', 'public.site_sporturi', 'public.baze_sportive', 'public.baze_sportive_admini', 'storage.objects'];
    const state = async (withPhoto = true) => {
      const saved = {};
      for (const table of stateTables) {
        const expression = table === 'public.baze_sportive' && !withPhoto ? "to_jsonb(t)-'poza'" : 'to_jsonb(t)';
        saved[table] = (await root(`select ${expression} row from ${table} t order by to_jsonb(t)::text`)).rows;
      }
      return saved;
    };
    const triggers = () => root('select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid').then(result => result.rows);
    const originalPolicies = () => root("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where policyname not like 'spotivity_base_images_%' order by schemaname,tablename,policyname").then(result => result.rows);
    const save = (person, {id = null, name = 'Sports base', city = 'Test city', description = 'Existing description', active = true, courts = [], admins = []} = {}) => as('authenticated', person,
      'select public.save_sports_base($1,$2,$3,$4,$5,$6::text[],$7::uuid[]) id', [id, name, city, description, active, courts, admins]);

    await check('009 rejects an unsecured schema without installing its column or bucket', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
      await pg.exec('rollback');
      assert.equal((await root("select count(*)::integer total from storage.buckets where id=$1", [bucket])).rows[0].total, 0);
    });
    for (const name of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql', '005_sport_appearance.sql', '006_sports_bases.sql', '007_completed_booking_cancellation.sql']) await pg.exec(file(name));
    await check('009 requires profile migration 008 as well as the earlier security chain', async () => {
      await assert.rejects(() => pg.exec(migration), /008 before 009/);
      await pg.exec('rollback');
    });
    await pg.exec(file('008_profile_edit.sql'));
    await check('009 checks every required migration version', async () => {
      for (const version of [1, 3, 4, 5, 6, 7, 8]) {
        const saved = (await root('delete from spotivity_private.migrations where version=$1 returning *', [version])).rows[0];
        await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
        await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)', [saved.version, saved.applied_at]);
      }
    });
    await check('009 refuses an unrelated unregistered base photo column', async () => {
      await root('alter table public.baze_sportive add column poza text');
      await assert.rejects(() => pg.exec(migration), /existing unregistered sports-base photo column/);
      await pg.exec('rollback');
      await root('alter table public.baze_sportive drop column poza');
    });
    const courts = Object.fromEntries((await root('select nume,id::text id from public.terenuri')).rows.map(row => [row.nume, row.id]));
    const baseA = (await save(4, {name: 'Base A', courts: [courts['Court A']], admins: [uid(3)]})).rows[0].id;
    const baseB = (await save(4, {name: 'Base B', courts: [courts['Court B']]})).rows[0].id;
    const hiddenBase = (await save(4, {name: 'Hidden base', active: false, courts: [courts['Hidden Court']], admins: [uid(3)]})).rows[0].id;
    const draftBase = (await save(4, {name: 'Draft base'})).rows[0].id;
    const oldCourtImage = `${uid(3)}/existing-court.jpg`;
    await upload(3, oldCourtImage, 'authenticated', 'poze_terenuri');
    await as('authenticated', 3, "update public.terenuri set poza=$1 where nume='Court A'", [`https://fixture.invalid/storage/v1/object/public/poze_terenuri/${oldCourtImage}`]);
    const tomorrow = (await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+1)::text booking_date")).rows[0].booking_date;
    const completed = (await root("insert into public.rezervari(client_user_id,email_client,teren,data_str,ora,stare) values($1,'alice@example.test','Court A','2000-01-01','12:00','activa') returning *", [uid(1)])).rows[0];
    const future = (await as('authenticated', 1, "insert into public.rezervari(email_client,teren,data_str,ora,stare) values('alice@example.test','Court A',$1,'12:00','activa') returning *", [tomorrow])).rows[0];
    await root('select 1');
    await pg.exec(`create schema supabase_functions;
      create function supabase_functions.http_request() returns trigger
      language plpgsql security definer set search_path='' as $$ begin
        if current_setting('spotivity.test_forbid_http',true)='on' then
          raise exception 'Migration unexpectedly invoked a booking webhook';
        end if;
        return new;
      end $$;
      create trigger fixture_base_photo_webhook after update on public.rezervari
      for each row execute function supabase_functions.http_request('https://fixture.invalid/update');
      select set_config('spotivity.test_forbid_http','on',false)`);
    const before = await state(false);
    const oldTriggers = await triggers();
    const oldPolicies = await originalPolicies();
    const oldBuckets = (await root('select * from storage.buckets order by id')).rows;
    const oldRpc = (await root("select pg_get_functiondef('public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])'::regprocedure) definition")).rows[0].definition;
    await pg.exec(migration);
    await check('009 preserves every existing business row, court image, allocation, policy and trigger object', async () => {
      assert.deepEqual(await state(false), before);
      assert.deepEqual(await triggers(), oldTriggers);
      assert.deepEqual(await originalPolicies(), oldPolicies);
      for (const old of oldBuckets) assert.deepEqual((await root('select * from storage.buckets where id=$1', [old.id])).rows[0], old);
      assert.equal((await root("select pg_get_functiondef('public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])'::regprocedure) definition")).rows[0].definition, oldRpc);
      assert.ok((await root('select poza from public.baze_sportive')).rows.every(row => row.poza === null));
    });
    await check('dedicated public bucket enforces 5MB and a raster MIME allowlist without SVG', async () => {
      const configured = (await root('select * from storage.buckets where id=$1', [bucket])).rows[0];
      assert.equal(configured.public, true);
      assert.equal(configured.file_size_limit, 5 * 1024 * 1024);
      assert.deepEqual(configured.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
      assert.equal(configured.allowed_mime_types.includes('image/svg+xml'), false);
      assert.equal(configured.allowed_mime_types.includes('application/octet-stream'), false);
    });
    await check('009 repeats without changing existing rows or adding duplicate policies', async () => {
      const saved = await state();
      await pg.exec(migration);
      assert.deepEqual(await state(), saved);
      assert.deepEqual(await triggers(), oldTriggers);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(row => row.version), [1, 3, 4, 5, 6, 7, 8, 9]);
      assert.equal((await root("select count(*)::integer total from pg_policies where policyname like 'spotivity_base_images_%'")).rows[0].total, 10);
    });
    await root("select set_config('spotivity.test_forbid_http','off',false)");

    let fileNumber = 200;
    const mainImage = image(baseA, fileNumber++);
    await check('an explicitly assigned ordinary admin can upload and assign the base photo', async () => {
      assert.equal((await upload(3, mainImage)).rows[0].name, mainImage);
      const original = await baseRow(baseA);
      const changed = (await photo(3, baseA, mainImage)).rows[0];
      assert.equal(changed.poza, mainImage);
      assert.equal(changed.nume, original.nume);
      assert.equal(changed.oras, original.oras);
      assert.ok(new Date(changed.updated_at) >= new Date(original.updated_at));
    });
    await check('a superadmin can upload to any existing base, including an empty saved draft', async () => {
      for (const base of [baseB, draftBase]) {
        const name = image(base, fileNumber++, 'webp');
        await upload(4, name);
        assert.equal((await photo(4, base, name)).rows[0].poza, name);
      }
    });
    await check('a new base must exist before even a superadmin may upload into its UUID', async () => {
      await assert.rejects(() => upload(4, image(uid(999), fileNumber++)), /row-level security/);
    });
    await check('each allowed raster extension has a valid canonical Storage path', async () => {
      for (const extension of ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']) {
        const name = image(baseA, fileNumber++, extension);
        assert.equal((await upload(3, name)).rows[0].name, name);
      }
    });
    for (const [label, path] of [
      ['SVG', image(baseA, 500, 'svg')], ['HTML', image(baseA, 501, 'html')],
      ['uppercase extension', image(baseA, 502, 'PNG')],
      ['non-UUID filename', `${baseA}/photo.jpg`], ['extra directory', `${baseA}/nested/${uid(503)}.jpg`],
      ['traversal', `${baseA}/../${uid(504)}.jpg`], ['encoded traversal', `${baseA}/%2e%2e/${uid(505)}.jpg`],
      ['query suffix', `${image(baseA, 506)}?token=bad`], ['external URL', `https://bad.invalid/${image(baseA, 507)}`],
      ['user UUID folder', image(uid(3), 508)], ['null name', null], ['empty name', '']
    ]) await check(`${label} upload path is rejected by Storage RLS`, async () => {
      await assert.rejects(() => upload(3, path), /row-level security/);
    });
    await check('ordinary admins cannot upload to a different base without its explicit grant', async () => {
      await assert.rejects(() => upload(3, image(baseB, fileNumber++)), /row-level security/);
      const other = (await baseRow(baseB)).poza;
      assert.equal((await move(3, other, image(baseB, fileNumber++))).rows.length, 0);
      assert.equal((await remove(3, other)).rows.length, 0);
      assert.equal((await photo(3, baseB, null)).rows.length, 0);
    });
    await check('clients cannot upload, overwrite, delete or assign any base photo', async () => {
      for (const person of [1, 2]) {
        await assert.rejects(() => upload(person, image(baseA, fileNumber++)), /row-level security/);
        assert.equal((await move(person, mainImage, image(baseA, fileNumber++))).rows.length, 0);
        assert.equal((await remove(person, mainImage)).rows.length, 0);
        assert.equal((await photo(person, baseA, null)).rows.length, 0);
      }
      assert.equal((await baseRow(baseA)).poza, mainImage);
    });
    await check('anonymous users can read public image metadata but cannot write even with a legacy permissive policy', async () => {
      assert.equal((await as('anon', null, 'select name from storage.objects where bucket_id=$1 and name=$2', [bucket, mainImage])).rows.length, 1);
      await assert.rejects(() => upload(null, image(baseA, fileNumber++), 'anon'), /row-level security/);
      assert.equal((await as('anon', null, 'update storage.objects set name=name where bucket_id=$1 and name=$2 returning id', [bucket, mainImage])).rows.length, 0);
      assert.equal((await remove(null, mainImage, 'anon')).rows.length, 0);
    });
    await check('authenticated requests without an Auth subject cannot upload or edit photos', async () => {
      await assert.rejects(() => upload(null, image(baseA, fileNumber++)), /row-level security/);
      assert.equal((await remove(null, mainImage)).rows.length, 0);
      assert.equal((await photo(null, baseA, null)).rows.length, 0);
    });
    await check('spoofed email claims and metadata cannot grant base image permissions', async () => {
      await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [uid(1), JSON.stringify({is_super: true, baza_id: baseA})]);
      await as('authenticated', 1, "select set_config('request.jwt.claim.email','admin@example.test',false)");
      await assert.rejects(() => upload(1, image(baseA, fileNumber++)), /row-level security/);
    });
    await check('an ordinary admin can replace and delete an image within their own base', async () => {
      const initial = image(baseA, fileNumber++);
      const replacement = image(baseA, fileNumber++, 'png');
      await upload(3, initial);
      assert.equal((await move(3, initial, replacement)).rows[0].name, replacement);
      assert.equal((await remove(3, replacement)).rows.length, 1);
    });
    await check('moving an owned image into another base fails its new-row check atomically', async () => {
      const beforeImage = (await root('select * from storage.objects where bucket_id=$1 and name=$2', [bucket, mainImage])).rows[0];
      await assert.rejects(() => move(3, mainImage, image(baseB, fileNumber++)), /row-level security/);
      assert.deepEqual((await root('select * from storage.objects where bucket_id=$1 and name=$2', [bucket, mainImage])).rows[0], beforeImage);
    });
    await check('moving another base image into an owned base is blocked by its old-row check', async () => {
      const other = (await baseRow(baseB)).poza;
      assert.equal((await move(3, other, image(baseA, fileNumber++))).rows.length, 0);
      assert.equal((await root('select name from storage.objects where bucket_id=$1 and name=$2', [bucket, other])).rows.length, 1);
    });
    await check('malformed renamed objects are rejected without changing existing Storage rows', async () => {
      await assert.rejects(() => move(3, mainImage, `${baseA}/bad.svg`), /row-level security/);
      assert.equal((await root('select id from storage.objects where bucket_id=$1 and name=$2', [bucket, mainImage])).rows.length, 1);
    });
    await check('base metadata cannot borrow another base image even when uploaded by a superadmin', async () => {
      await assert.rejects(async () => photo(3, baseA, (await baseRow(baseB)).poza), /own base UUID/);
      assert.equal((await baseRow(baseA)).poza, mainImage);
    });
    await check('photo assignment requires an uploaded object in the dedicated bucket', async () => {
      const missing = image(baseA, fileNumber++);
      await assert.rejects(() => photo(3, baseA, missing), /Upload the sports-base photo/);
      await root('insert into storage.objects(bucket_id,name) values($1,$2)', ['poze_terenuri', missing]);
      await assert.rejects(() => photo(3, baseA, missing), /Upload the sports-base photo/);
      await root('delete from storage.objects where bucket_id=$1 and name=$2', ['poze_terenuri', missing]);
    });
    await check('URLs, scripts and unrelated filenames are rejected as base photo metadata', async () => {
      for (const value of [`https://fixture.invalid/storage/v1/object/public/${bucket}/${mainImage}`, 'javascript:alert(1)', 'data:image/png;base64,AA==', `${baseA}/file.svg`, '']) {
        await assert.rejects(() => photo(3, baseA, value), /own base UUID/);
      }
    });
    await check('assigned admins can change description and photo together but never structure', async () => {
      const alternative = image(baseA, fileNumber++);
      await upload(3, alternative);
      const changed = (await as('authenticated', 3, 'update public.baze_sportive set descriere=$1,poza=$2 where id=$3 returning *', ['Updated base text', alternative, baseA])).rows[0];
      assert.equal(changed.descriere, 'Updated base text');
      assert.equal(changed.poza, alternative);
      for (const [field, value] of [['nume', 'Other name'], ['oras', 'Other city'], ['este_activa', false], ['id', uid(999)], ['created_at', '2001-01-01']]) {
        await assert.rejects(() => as('authenticated', 3, `update public.baze_sportive set ${field}=$1,poza=$2 where id=$3`, [value, mainImage, baseA]), /only a sports-base description and photo/);
      }
      assert.equal((await baseRow(baseA)).poza, alternative);
      await photo(3, baseA, mainImage);
    });
    await check('ordinary admins may clear the base photo without deleting any court image', async () => {
      assert.equal((await photo(3, baseA, null)).rows[0].poza, null);
      assert.equal((await root('select name from storage.objects where bucket_id=$1 and name=$2', ['poze_terenuri', oldCourtImage])).rows.length, 1);
      await photo(3, baseA, mainImage);
    });
    await check('explicit editors may manage photos of their inactive base', async () => {
      const name = image(hiddenBase, fileNumber++);
      await upload(3, name);
      assert.equal((await photo(3, hiddenBase, name)).rows[0].poza, name);
      assert.equal((await as('anon', null, 'select id from public.baze_sportive where id=$1', [hiddenBase])).rows.length, 0);
      await photo(3, hiddenBase, null);
      assert.equal((await remove(3, name)).rows.length, 1);
    });
    await check('revoking a base grant immediately blocks upload, overwrite, deletion and metadata editing', async () => {
      await as('authenticated', 4, 'delete from public.baze_sportive_admini where baza_id=$1 and user_id=$2', [baseA, uid(3)]);
      await assert.rejects(() => upload(3, image(baseA, fileNumber++)), /row-level security/);
      assert.equal((await move(3, mainImage, image(baseA, fileNumber++))).rows.length, 0);
      assert.equal((await remove(3, mainImage)).rows.length, 0);
      assert.equal((await photo(3, baseA, null)).rows.length, 0);
      assert.equal((await baseRow(baseA)).poza, mainImage);
      await as('authenticated', 4, 'insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)', [baseA, uid(3)]);
    });
    await check('removing an admin role cascades grants and stops all image writes immediately', async () => {
      const admin = (await root('select * from public.users_admin where user_id=$1', [uid(3)])).rows[0];
      await as('authenticated', 4, 'delete from public.users_admin where user_id=$1', [uid(3)]);
      assert.equal((await root('select * from public.baze_sportive_admini where user_id=$1', [uid(3)])).rows.length, 0);
      await assert.rejects(() => upload(3, image(baseA, fileNumber++)), /row-level security/);
      assert.equal((await remove(3, mainImage)).rows.length, 0);
      assert.equal((await photo(3, baseA, null)).rows.length, 0);
      await root('insert into public.users_admin(user_id,nume_admin,email,is_super,terenuri) values($1,$2,$3,$4,$5)', [admin.user_id, admin.nume_admin, admin.email, admin.is_super, admin.terenuri]);
      await as('authenticated', 4, 'insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)', [baseA, uid(3)]);
    });
    await check('base-photo access grants no additional court, client, reservation, role or court-image permissions', async () => {
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=1 where nume='Court B' returning id")).rows.length, 0);
      assert.equal((await as('authenticated', 3, 'select * from public.clienti where user_id=$1', [uid(2)])).rows.length, 0);
      await assert.rejects(() => as('authenticated', 3, 'insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)', [baseB, uid(3)]));
      await assert.rejects(() => upload(3, `${uid(4)}/unowned.jpg`, 'authenticated', 'poze_terenuri'), /row-level security/);
      await assert.rejects(() => save(3, {id: baseA}), /Only authenticated superadmins/);
    });
    await check('atomic superadmin base save preserves an existing base photo and its Storage row', async () => {
      await save(4, {id: baseA, name: 'Renamed base', courts: [courts['Court A']], admins: [uid(3)]});
      assert.equal((await baseRow(baseA)).poza, mainImage);
      assert.equal((await root('select id from storage.objects where bucket_id=$1 and name=$2', [bucket, mainImage])).rows.length, 1);
    });
    await check('public active base reads include its safe photo path and no grant records', async () => {
      assert.equal((await as('anon', null, 'select poza from public.baze_sportive where id=$1', [baseA])).rows[0].poza, mainImage);
      await assert.rejects(() => as('anon', null, 'select * from public.baze_sportive_admini'), /permission denied/);
    });
    await check('only the authenticated Storage helper is executable; parser and triggers stay private', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const fn of ['spotivity_private.base_image_base(text)', 'spotivity_private.guard_base()']) assert.equal((await root('select has_function_privilege($1,$2,$3) allowed', [role, fn, 'execute'])).rows[0].allowed, false);
      }
      assert.equal((await root("select has_function_privilege('authenticated','spotivity_private.may_write_base_image(text)','execute') allowed")).rows[0].allowed, true);
      assert.equal((await root("select has_function_privilege('anon','spotivity_private.may_write_base_image(text)','execute') allowed")).rows[0].allowed, false);
      const fn = (await root("select prosecdef,proconfig from pg_proc where oid='spotivity_private.may_write_base_image(text)'::regprocedure")).rows[0];
      assert.equal(fn.prosecdef, true);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
    });
    await check('ordinary and super admins still cannot cancel completed reservations', async () => {
      for (const person of [1, 3, 4]) await assert.rejects(() => as('authenticated', person, "update public.rezervari set stare='anulata' where id=$1", [completed.id]), /Completed bookings cannot be cancelled/);
      assert.equal((await root('select stare from public.rezervari where id=$1', [completed.id])).rows[0].stare, 'activa');
    });
    await check('future reservation cancellation still works after photo configuration', async () => {
      assert.equal((await as('authenticated', 1, "update public.rezervari set stare='anulata' where id=$1 returning stare", [future.id])).rows[0].stare, 'anulata');
    });
    await check('rerunning 009 preserves uploaded photos, references, roles and all other final business rows', async () => {
      const final = await state();
      const finalTriggers = await triggers();
      await root("select set_config('spotivity.test_forbid_http','on',false)");
      await pg.exec(migration);
      assert.deepEqual(await state(), final);
      assert.deepEqual(await triggers(), finalTriggers);
      assert.equal((await baseRow(baseA)).poza, mainImage);
    });
    console.log(`\n${passed} base photo checks passed (${integerIds ? 'numeric' : 'UUID'} IDs).`);
  } finally { await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
