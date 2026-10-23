// Disposable PostgreSQL fixture only. No hosted Supabase writes or emails.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync, existsSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('010_foot_tennis.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const footImage = 'assets/imagini/RealistTenispicior.png';
const footballImage = 'assets/imagini/RealistFotbal1.png';
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
    const read = (role = 'anon', person = null) => as(role, person, 'select * from public.site_sporturi order by sport').then(result => result.rows);
    const tables = ['auth.users', 'public.clienti', 'public.users_admin', 'public.terenuri', 'public.rezervari', 'public.mesaje_chat', 'public.rezervari_disponibilitate', 'public.baze_sportive', 'public.baze_sportive_admini', 'storage.buckets', 'storage.objects'];
    const businessState = async () => {
      const state = {};
      for (const table of tables) state[table] = (await root(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
      return state;
    };
    const definitions = async () => ({
      policies: (await root('select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname')).rows,
      grants: (await root("select grantee,table_schema,table_name,privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated','service_role') order by grantee,table_schema,table_name,privilege_type")).rows,
      triggers: (await root('select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid')).rows,
      functions: (await root("select p.oid::text,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('spotivity_private','supabase_functions') or n.nspname='public' and p.proname='save_sports_base' order by p.oid")).rows,
      checks: (await root("select c.oid::text,c.conname,pg_get_constraintdef(c.oid) definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','storage','auth') and c.conname not in ('site_sporturi_sport_valid','site_sporturi_ordine_valid') order by c.oid")).rows
    });

    await check('010 refuses an unsecured project without creating a visual table', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
      await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.site_sporturi')::text name")).rows[0].name, null);
    });
    for (const name of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql', '005_sport_appearance.sql', '006_sports_bases.sql', '007_completed_booking_cancellation.sql', '008_profile_edit.sql']) await pg.exec(file(name));
    await check('010 requires base-photo migration 009 before expanding visual categories', async () => {
      await assert.rejects(() => pg.exec(migration), /009 before 010/);
      await pg.exec('rollback');
    });
    await pg.exec(file('009_base_photos.sql'));
    await check('010 checks every migration prerequisite version', async () => {
      for (const version of [1, 3, 4, 5, 6, 7, 8, 9]) {
        const saved = (await root('delete from spotivity_private.migrations where version=$1 returning *', [version])).rows[0];
        await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
        await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)', [saved.version, saved.applied_at]);
      }
    });
    await root("update public.site_sporturi set icona_url='https://cdn.example.test/custom-football.png',fundal_url='https://cdn.example.test/old-football.jpg',ordine=3 where sport='Fotbal'");
    await root("update public.site_sporturi set icona_url='https://cdn.example.test/custom-basketball.png',fundal_url='https://cdn.example.test/custom-basketball.jpg',ordine=1 where sport='Baschet'");
    await root("update public.site_sporturi set fundal_url='https://cdn.example.test/custom-tennis.webp' where sport='Tenis'");
    await as('authenticated', 4, "insert into public.terenuri(nume,sport,pret,optiune_minge,oras,este_activ) values('Foot tennis court','Tenis Picior',80,false,'Test city',true)");
    await root("update public.users_admin set terenuri='Court A,Foot tennis court' where user_id=$1", [uid(3)]);
    const completed = (await root("insert into public.rezervari(email_client,client_user_id,sport,teren,data_str,ora,stare) values('alice@example.test',$1,'Tenis Picior','Foot tennis court','2000-01-01','12:00','activa') returning *", [uid(1)])).rows[0];
    await root('select 1');
    await pg.exec(`create schema supabase_functions;
      create function supabase_functions.http_request() returns trigger
      language plpgsql security definer set search_path='' as $$ begin
        if current_setting('spotivity.test_forbid_http',true)='on' then
          raise exception 'Visual migration unexpectedly invoked a reservation webhook';
        end if;
        return new;
      end $$;
      create trigger fixture_foot_tennis_webhook after update on public.rezervari
      for each row execute function supabase_functions.http_request('https://fixture.invalid/update');
      select set_config('spotivity.test_forbid_http','on',false)`);
    const before = await businessState();
    const originalDefinitions = await definitions();
    const originalVisuals = await read();
    await root('select 1');
    await pg.exec(migration);
    await check('010 changes no business rows, policies, grants, guards, webhook states or other constraints', async () => {
      assert.deepEqual(await businessState(), before);
      assert.deepEqual(await definitions(), originalDefinitions);
    });
    await check('initial apply changes only the football background among all existing visual rows', async () => {
      const after = await read();
      for (const original of originalVisuals) {
        assert.deepEqual(after.find(row => row.sport === original.sport), original.sport === 'Fotbal' ? {...original, fundal_url: footballImage} : original);
      }
      assert.equal(after.length, 5);
    });
    await check('fifth category uses the existing canonical court key, requested asset path and order 5', async () => {
      assert.deepEqual((await read()).find(row => row.sport === 'Tenis Picior'), {sport: 'Tenis Picior', icona_url: 'assets/imagini/fotbalrealist.png', fundal_url: footImage, ordine: 5});
      assert.equal((await root("select sport from public.terenuri where nume='Foot tennis court'")).rows[0].sport, 'Tenis Picior');
      assert.equal((await root('select sport from public.rezervari where id=$1', [completed.id])).rows[0].sport, 'Tenis Picior');
    });
    await check('the retained foot-tennis background resolves to its exact repository asset', async () => {
      assert.ok(existsSync(join(__dirname, '..', '..', footImage)), footImage);
      // Migration 020 replaces the historical football image; its dedicated
      // test verifies the current football background exists after cleanup.
    });
    await check('anonymous visitors and authenticated users can read all five category settings', async () => {
      const expected = await read();
      assert.equal(expected.length, 5);
      for (const person of [1, 2, 3, 4]) assert.deepEqual(await read('authenticated', person), expected);
    });
    await check('anonymous writes and truncation still have no grants', async () => {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal((await root('select has_table_privilege($1,$2,$3) allowed', ['anon', 'public.site_sporturi', privilege])).rows[0].allowed, false);
      await assert.rejects(() => as('anon', null, "update public.site_sporturi set ordine=1 where sport='Tenis Picior'"), /permission denied/);
    });
    await check('clients and ordinary admins cannot insert, edit or delete fifth-category visuals', async () => {
      const saved = await read();
      for (const person of [1, 2, 3]) {
        await assert.rejects(() => as('authenticated', person, "insert into public.site_sporturi(sport,icona_url,fundal_url,ordine) values('Tenis Picior',$1,$1,5)", [footImage]), /row-level security/);
        assert.equal((await as('authenticated', person, "update public.site_sporturi set fundal_url='https://cdn.example.test/unauthorized.jpg' where sport='Tenis Picior' returning sport")).rows.length, 0);
        assert.equal((await as('authenticated', person, "delete from public.site_sporturi where sport='Tenis Picior' returning sport")).rows.length, 0);
      }
      assert.deepEqual(await read(), saved);
    });
    await check('missing Auth subject and spoofed metadata do not grant category editing', async () => {
      assert.equal((await as('authenticated', null, "update public.site_sporturi set ordine=2 where sport='Tenis Picior' returning sport")).rows.length, 0);
      await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [uid(1), JSON.stringify({is_super: true})]);
      assert.equal((await as('authenticated', 1, "update public.site_sporturi set ordine=2 where sport='Tenis Picior' returning sport")).rows.length, 0);
      await root("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1", [uid(1)]);
    });
    await check('only the five canonical sport keys and orders 1 through 5 are accepted', async () => {
      for (const value of ['Tenis de picior', 'Tenis picior', 'Invented sport']) await assert.rejects(() => as('authenticated', 4, "update public.site_sporturi set sport=$1 where sport='Tenis Picior'", [value]), /check constraint/);
      for (const value of [0, 6]) await assert.rejects(() => as('authenticated', 4, "update public.site_sporturi set ordine=$1 where sport='Tenis Picior'", [value]), /check constraint/);
      for (const column of ['sport', 'icona_url', 'fundal_url', 'ordine']) await assert.rejects(() => as('authenticated', 4, `update public.site_sporturi set ${column}=null where sport='Tenis Picior'`), /not-null constraint/);
    });
    await check('existing image-safety constraints also protect the fifth category', async () => {
      for (const value of ['javascript:alert(1)', 'data:image/svg+xml,bad', 'assets/imagini/../secret.png', 'assets/imagini/unsafe.svg', 'http://bad.example.test/image.jpg', 'https://bad.example.test/image.jpg\');color:red']) {
        for (const column of ['icona_url', 'fundal_url']) await assert.rejects(() => as('authenticated', 4, `update public.site_sporturi set ${column}=$1 where sport='Tenis Picior'`, [value]), /check constraint/);
      }
    });
    await check('superadmin can edit and recreate the fifth visual row through unchanged RLS', async () => {
      const changed = (await as('authenticated', 4, "update public.site_sporturi set fundal_url='https://cdn.example.test/custom-foot-tennis.webp',ordine=2 where sport='Tenis Picior' returning *")).rows[0];
      assert.equal(changed.fundal_url, 'https://cdn.example.test/custom-foot-tennis.webp');
      assert.equal(changed.ordine, 2);
      assert.equal((await as('authenticated', 4, "delete from public.site_sporturi where sport='Tenis Picior' returning sport")).rows.length, 1);
      assert.equal((await as('authenticated', 4, 'insert into public.site_sporturi(sport,icona_url,fundal_url,ordine) values($1,$2,$3,$4) returning sport', [changed.sport, changed.icona_url, changed.fundal_url, changed.ordine])).rows[0].sport, 'Tenis Picior');
    });
    await check('demoting the superadmin immediately removes fifth-category write access', async () => {
      await root("update public.users_admin set is_super=false,terenuri='Court A' where user_id=$1", [uid(4)]);
      assert.equal((await as('authenticated', 4, "update public.site_sporturi set ordine=1 where sport='Tenis Picior' returning sport")).rows.length, 0);
      await root('update public.users_admin set is_super=true where user_id=$1', [uid(4)]);
    });
    await check('ordinary court admins keep their settings scope without receiving sport-change permission', async () => {
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=90 where nume='Foot tennis court' returning sport")).rows[0].sport, 'Tenis Picior');
      await assert.rejects(() => as('authenticated', 3, "update public.terenuri set sport='Fotbal' where nume='Foot tennis court'"), /Admin may update only settings/);
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=1 where nume='Court B' returning id")).rows.length, 0);
    });
    await root("select set_config('spotivity.test_forbid_http','off',false)");
    let future;
    await check('clients can reserve canonical Tenis Picior courts with server-controlled sport and price', async () => {
      const tomorrow = (await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+1)::text booking_date")).rows[0].booking_date;
      future = (await as('authenticated', 1, "insert into public.rezervari(email_client,sport,teren,data_str,ora,pret_total,stare) values('alice@example.test','Spoofed sport','Foot tennis court',$1,'12:00','1 RON','activa') returning *", [tomorrow])).rows[0];
      assert.equal(future.sport, 'Tenis Picior');
      assert.equal(future.pret_total, '90 RON');
      assert.equal(future.client_user_id, uid(1));
      assert.equal((await as('authenticated', 2, 'select id from public.rezervari where id=$1', [future.id])).rows.length, 0);
    });
    await check('a completed foot-tennis reservation remains uncancellable by client and both admin roles', async () => {
      for (const person of [1, 3, 4]) await assert.rejects(() => as('authenticated', person, "update public.rezervari set stare='anulata' where id=$1", [completed.id]), /Completed bookings cannot be cancelled/);
      assert.equal((await root('select stare from public.rezervari where id=$1', [completed.id])).rows[0].stare, 'activa');
    });
    await check('a future foot-tennis reservation still supports the existing cancellation flow', async () => {
      assert.equal((await as('authenticated', 1, "update public.rezervari set stare='anulata' where id=$1 returning stare", [future.id])).rows[0].stare, 'anulata');
      assert.equal((await as('anon', null, 'select id from public.rezervari_disponibilitate where id=$1', [String(future.id)])).rows.length, 0);
    });
    await check('rerunning 010 preserves later custom visuals and every final business row', async () => {
      await as('authenticated', 4, "update public.site_sporturi set fundal_url='https://cdn.example.test/later-football.jpg' where sport='Fotbal'");
      const customVisuals = await read();
      const finalState = await businessState();
      const finalDefinitions = await definitions();
      await root("select set_config('spotivity.test_forbid_http','on',false)");
      await pg.exec(migration);
      assert.deepEqual(await read(), customVisuals);
      assert.deepEqual(await businessState(), finalState);
      assert.deepEqual(await definitions(), finalDefinitions);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(row => row.version), [1, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
    await check('rerunning 010 does not recreate a visual row deliberately removed after migration', async () => {
      await as('authenticated', 4, "delete from public.site_sporturi where sport='Tenis Picior'");
      const removed = await read();
      await root('select 1');
      await pg.exec(migration);
      assert.deepEqual(await read(), removed);
    });
    console.log(`\n${passed} foot-tennis checks passed (${integerIds ? 'numeric' : 'UUID'} IDs).`);
  } finally { await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
