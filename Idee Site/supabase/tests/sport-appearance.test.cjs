// Disposable Supabase-compatible fixture only; never use against production.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync, existsSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const expected = [
  ['Fotbal', 'fotbalrealist.png', 'RealistFotbal.png', 1],
  ['Baschet', 'baschetrealist.png', 'RealisBaschet.png', 2],
  ['Tenis', 'tenisrealist.png', 'RealistTenis.png', 3],
  ['Volei', 'voleirealist.png', 'RealistVolei.png', 4]
].map(([sport, icon, background, ordine]) => ({
  sport, icona_url: `assets/imagini/${icon}`, fundal_url: `assets/imagini/${background}`, ordine
}));
const migration = file('005_sport_appearance.sql');
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (process.env.SPOTIVITY_TEST_INTEGER_IDS === '1') {
      schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    }
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${person ? uid(person) : ''}', false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const read = (role = 'anon', person = null) => as(role, person, 'select sport, icona_url, fundal_url, ordine from public.site_sporturi order by ordine, sport');
    const coreTables = ['auth.users', 'public.clienti', 'public.users_admin', 'public.terenuri', 'public.rezervari', 'public.mesaje_chat', 'public.rezervari_disponibilitate', 'storage.buckets', 'storage.objects'];
    const coreState = async () => {
      const snapshot = {};
      for (const table of coreTables) {
        snapshot[table] = (await root(`select coalesce(jsonb_agg(to_jsonb(item) order by id), '[]'::jsonb) as rows from ${table} item`)).rows[0].rows;
      }
      snapshot.policies = (await root("select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where tablename <> 'site_sporturi' order by schemaname, tablename, policyname")).rows;
      snapshot.triggers = (await root('select oid::text, tgname, tgenabled, md5(pg_get_triggerdef(oid)) hash from pg_trigger where not tgisinternal order by oid')).rows;
      return snapshot;
    };

    await check('005 refuses an unsecured project and leaves no visual table', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply 001_security.sql/);
      await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.site_sporturi')::text name")).rows[0].name, null);
    });
    await pg.exec(file('001_security.sql'));
    await pg.exec(file('003_court_hours.sql'));
    await check('005 requires the latest admin scope protection', async () => {
      await assert.rejects(() => pg.exec(migration), /004_admin_scope_hardening.sql/);
      await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.site_sporturi')::text name")).rows[0].name, null);
    });
    await pg.exec(file('004_admin_scope_hardening.sql'));
    await check('005 refuses to take over an unrelated existing table', async () => {
      await root('create table public.site_sporturi (unrelated text)');
      await assert.rejects(() => pg.exec(migration), /existing unregistered/);
      await pg.exec('rollback');
      assert.deepEqual((await root("select column_name from information_schema.columns where table_schema='public' and table_name='site_sporturi'")).rows, [{column_name: 'unrelated'}]);
      await root('drop table public.site_sporturi');
    });
    const before = await coreState();
    await pg.exec(migration);

    await check('anonymous visitors can read exactly the four configured sports', async () => {
      assert.deepEqual((await read()).rows, expected);
    });
    await check('seeded sport icons remain available after background cleanup', async () => {
      for (const row of expected) {
        assert.ok(existsSync(join(__dirname, '..', '..', row.icona_url)), row.icona_url);
      }
      // Migration 005's historical backgrounds are superseded by migration
      // 020; its final-sport-backgrounds test checks all current image paths.
    });
    await check('clients and ordinary admins retain public visual reads', async () => {
      for (const person of [1, 2, 3]) assert.deepEqual((await read('authenticated', person)).rows, expected);
    });
    await check('anonymous writes and truncation have no grants', async () => {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await root('select has_table_privilege($1,$2,$3) allowed', ['anon', 'public.site_sporturi', privilege])).rows[0].allowed, false);
      }
      for (const sql of ["update public.site_sporturi set ordine=1", "delete from public.site_sporturi", "insert into public.site_sporturi values('Fotbal','assets/imagini/fotbalrealist.png','assets/imagini/RealistFotbal.png',1)"]) {
        await assert.rejects(() => as('anon', null, sql), /permission denied/);
      }
    });
    await check('client and ordinary-admin writes are denied by RLS', async () => {
      for (const person of [1, 2, 3]) {
        await assert.rejects(() => as('authenticated', person, 'insert into public.site_sporturi(sport,icona_url,fundal_url,ordine) values($1,$2,$3,$4)', Object.values(expected[0])), /row-level security/);
        assert.equal((await as('authenticated', person, "update public.site_sporturi set fundal_url='assets/imagini/stadium.jpg' where sport='Fotbal' returning sport")).rows.length, 0);
        assert.equal((await as('authenticated', person, "delete from public.site_sporturi where sport='Fotbal' returning sport")).rows.length, 0);
      }
      assert.deepEqual((await read()).rows, expected);
    });
    await check('metadata cannot grant visual write privileges', async () => {
      await root("update auth.users set raw_user_meta_data=jsonb_build_object('is_super',true,'role','superadmin') where id=$1", [uid(1)]);
      assert.equal((await as('authenticated', 1, "update public.site_sporturi set ordine=4 where sport='Fotbal' returning sport")).rows.length, 0);
      await root("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1", [uid(1)]);
    });
    await check('superadmin can update the visual configuration', async () => {
      const url = 'https://cdn.example.test/football/photo.png?width=1600&quality=90';
      assert.equal((await as('authenticated', 4, "update public.site_sporturi set fundal_url=$1 where sport='Fotbal' returning fundal_url", [url])).rows[0].fundal_url, url);
      assert.equal((await read()).rows[0].fundal_url, url);
    });
    await check('superadmin can remove and recreate a sport visual row', async () => {
      assert.equal((await as('authenticated', 4, "delete from public.site_sporturi where sport='Volei' returning sport")).rows.length, 1);
      assert.equal((await as('authenticated', 4, 'insert into public.site_sporturi(sport,icona_url,fundal_url,ordine) values($1,$2,$3,$4) returning sport', Object.values(expected[3]))).rows[0].sport, 'Volei');
    });
    await check('demoted superadmin loses visual writes without refreshing claims', async () => {
      await root("update public.users_admin set is_super=false, terenuri='Court A' where user_id=$1", [uid(4)]);
      assert.equal((await as('authenticated', 4, "update public.site_sporturi set ordine=2 where sport='Fotbal' returning sport")).rows.length, 0);
      await root('update public.users_admin set is_super=true where user_id=$1', [uid(4)]);
    });
    await check('image constraints reject scripts, traversal, HTTP and CSS escapes', async () => {
      for (const value of ['javascript:alert(1)', 'data:image/png;base64,ABC', 'assets/imagini/../../secret.png', 'http://example.test/image.png', 'https://user:password@example.test/image.png', 'https://example.test/image.png\');background:red', 'https://example.test/a\\b.png', 'assets/imagini/image.svg', 'https://example.test/x\n.png', '']) {
        for (const column of ['icona_url', 'fundal_url']) {
          await assert.rejects(() => as('authenticated', 4, `update public.site_sporturi set ${column}=$1 where sport='Tenis'`, [value]), /check constraint/);
        }
      }
    });
    await check('sport keys and order stay within the four existing categories', async () => {
      await assert.rejects(() => as('authenticated', 4, "update public.site_sporturi set sport='Invented sport' where sport='Tenis'"), /check constraint/);
      for (const order of [0, 5]) await assert.rejects(() => as('authenticated', 4, "update public.site_sporturi set ordine=$1 where sport='Tenis'", [order]), /check constraint/);
      for (const column of ['sport', 'icona_url', 'fundal_url', 'ordine']) await assert.rejects(() => as('authenticated', 4, `update public.site_sporturi set ${column}=null where sport='Tenis'`), /not-null constraint/);
      await assert.rejects(() => as('authenticated', 4, "update public.site_sporturi set icona_url=$1 where sport='Tenis'", ['https://example.test/' + 'a'.repeat(2048)]), /check constraint/);
    });
    await check('trusted service role can update visuals without browser identity', async () => {
      assert.equal((await as('service_role', null, "update public.site_sporturi set icona_url='assets/imagini/tenis.png' where sport='Tenis' returning sport")).rows.length, 1);
      await root('update public.site_sporturi set icona_url=$1 where sport=$2', [expected[2].icona_url, 'Tenis']);
    });
    const custom = (await read()).rows;
    await check('rerunning 005 preserves custom URLs and has one ledger entry', async () => {
      await root('select 1');
      await pg.exec(migration);
      assert.deepEqual((await read()).rows, custom);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(r => r.version), [1, 3, 4, 5]);
    });
    await check('rerunning 005 removes an accidental permissive visual policy', async () => {
      await root('create policy accidentally_public on public.site_sporturi for all to authenticated using (true) with check (true)');
      await pg.exec(migration);
      assert.equal((await root("select count(*)::integer total from pg_policies where tablename='site_sporturi'")).rows[0].total, 4);
      assert.equal((await as('authenticated', 3, "update public.site_sporturi set ordine=2 where sport='Fotbal' returning sport")).rows.length, 0);
      assert.deepEqual((await read()).rows, custom);
    });
    await check('migration and visual writes leave all business data and guards intact', async () => {
      assert.deepEqual(await coreState(), before);
    });
    console.log(`\n${passed} sport appearance checks passed (${process.env.SPOTIVITY_TEST_INTEGER_IDS === '1' ? 'numeric' : 'UUID'} IDs).`);
  } finally {
    await pg.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
