// Disposable Supabase-compatible fixture only; never run against production.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('006_sports_bases.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (integerIds) {
      schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    } else {
      // The shared legacy fixture uses integer court IDs; explicitly exercise
      // UUID court membership as well as UUID booking/profile IDs in this run.
      schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    }
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${person ? uid(person) : ''}', false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const read = (role = 'anon', person = null) => as(role, person, 'select id,nume,oras,descriere,este_activa from public.baze_sportive order by nume');
    const save = (person, {id = null, name = 'Baza A', city = 'Reghin', description = '', active = true, courts = [], admins = []} = {}) =>
      as('authenticated', person, 'select public.save_sports_base($1,$2,$3,$4,$5,$6::text[],$7::uuid[]) id', [id, name, city, description, active, courts, admins]);
    const coreTables = ['auth.users', 'public.clienti', 'public.users_admin', 'public.terenuri', 'public.rezervari', 'public.mesaje_chat', 'public.rezervari_disponibilitate', 'public.site_sporturi', 'storage.buckets', 'storage.objects'];
    const coreState = async () => {
      const snapshot = {};
      for (const table of coreTables) {
        const key = table === 'public.site_sporturi' ? 'sport' : 'id';
        snapshot[table] = (await root(`select coalesce(jsonb_agg(to_jsonb(item) - 'baza_sportiva_id' order by ${key}), '[]'::jsonb) rows from ${table} item`)).rows[0].rows;
      }
      snapshot.policies = (await root("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where tablename not in ('baze_sportive','baze_sportive_admini') order by schemaname,tablename,policyname")).rows;
      return snapshot;
    };
    const definitions = () => root("select 'function' kind,p.oid::text id,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='spotivity_private' union all select 'trigger',t.oid::text,pg_get_triggerdef(t.oid) from pg_trigger t where not t.tgisinternal order by kind,id");

    await check('006 rejects an unsecured schema without creating tables', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
      await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.baze_sportive')::text name")).rows[0].name, null);
    });
    for (const name of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql']) await pg.exec(file(name));
    await check('006 requires sport appearance migration 005', async () => {
      await assert.rejects(() => pg.exec(migration), /005 before/);
      await pg.exec('rollback');
    });
    await pg.exec(file('005_sport_appearance.sql'));
    await check('006 refuses unrelated existing sports-base tables', async () => {
      await root('create table public.baze_sportive(unrelated text)');
      await assert.rejects(() => pg.exec(migration), /existing unregistered/);
      await pg.exec('rollback');
      assert.deepEqual((await root("select column_name from information_schema.columns where table_schema='public' and table_name='baze_sportive'")).rows, [{column_name: 'unrelated'}]);
      await root('drop table public.baze_sportive');
    });
    await check('006 refuses to replace an unregistered existing RPC', async () => {
      await root("create function public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[]) returns uuid language sql as 'select null::uuid'");
      await assert.rejects(() => pg.exec(migration), /existing unregistered/);
      await pg.exec('rollback');
      await root('drop function public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])');
    });
    const before = await coreState();
    const oldDefinitions = (await definitions()).rows;
    await pg.exec(migration);
    await check('006 preserves business data and all pre-existing policies and guards', async () => {
      assert.deepEqual(await coreState(), before);
      const after = new Map((await definitions()).rows.map(row => [row.kind + row.id, row]));
      for (const row of oldDefinitions) assert.deepEqual(after.get(row.kind + row.id), row);
    });
    await check('generic migration creates no invented bases or memberships', async () => {
      assert.equal((await root('select count(*)::integer total from public.baze_sportive')).rows[0].total, 0);
      assert.equal((await root('select count(*)::integer total from public.baze_sportive_admini')).rows[0].total, 0);
      assert.equal((await root('select count(*)::integer total from public.terenuri where baza_sportiva_id is not null')).rows[0].total, 0);
    });
    await check('both new tables have RLS and browser roles cannot truncate them', async () => {
      for (const table of ['baze_sportive', 'baze_sportive_admini']) {
        assert.equal((await root('select relrowsecurity from pg_class where oid=$1::regclass', ['public.' + table])).rows[0].relrowsecurity, true);
        for (const role of ['anon', 'authenticated']) assert.equal((await root('select has_table_privilege($1,$2,$3) allowed', [role, 'public.' + table, 'TRUNCATE'])).rows[0].allowed, false);
      }
      await assert.rejects(() => as('anon', null, 'select * from public.baze_sportive_admini'), /permission denied/);
    });
    await check('atomic RPC is SECURITY INVOKER with a fixed search path and no anonymous execute', async () => {
      const fn = (await root("select prosecdef,proconfig from pg_proc where oid='public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])'::regprocedure")).rows[0];
      assert.equal(fn.prosecdef, false);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
      assert.equal((await root("select has_function_privilege('anon','public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])','EXECUTE') allowed")).rows[0].allowed, false);
      await assert.rejects(() => as('anon', null, 'select spotivity_private.manages_base($1)', [uid(101)]), /permission denied/);
    });
    const courts = Object.fromEntries((await root('select nume,id::text id from public.terenuri')).rows.map(row => [row.nume, row.id]));
    let baseA, baseB, hiddenBase;
    await check('superadmin atomically creates an empty draft base hidden from public', async () => {
      baseA = (await save(4, {name: '  Baza A  ', city: ' Reghin '})).rows[0].id;
      assert.equal((await read()).rows.length, 0);
      assert.equal((await read('authenticated', 4)).rows[0].nume, 'Baza A');
      assert.equal((await read('authenticated', 4)).rows[0].oras, 'Reghin');
    });
    await check('adding active courts makes the active base publicly visible', async () => {
      await save(4, {id: baseA, courts: [courts['Court A'], courts['Court B']]});
      assert.deepEqual((await read()).rows.map(row => row.id), [baseA]);
      assert.equal((await as('anon', null, 'select id from public.terenuri where baza_sportiva_id=$1', [baseA])).rows.length, 2);
    });
    await check('bases with only inactive courts stay private', async () => {
      hiddenBase = (await save(4, {name: 'Hidden base', courts: [courts['Hidden Court']]})).rows[0].id;
      assert.deepEqual((await read()).rows.map(row => row.id), [baseA]);
    });
    await check('hiding a base removes it from public reads without changing court visibility', async () => {
      await save(4, {id: baseA, active: false, courts: [courts['Court A'], courts['Court B']]});
      assert.equal((await read()).rows.length, 0);
      assert.equal((await as('anon', null, 'select id from public.terenuri where baza_sportiva_id=$1', [baseA])).rows.length, 2);
      await save(4, {id: baseA, courts: [courts['Court A'], courts['Court B']]});
    });
    await check('anonymous users and clients cannot create, edit or delete bases', async () => {
      await assert.rejects(() => as('anon', null, "insert into public.baze_sportive(nume,oras) values('Bad','Bad')"), /permission denied/);
      for (const person of [1, 2, 3]) {
        await assert.rejects(() => as('authenticated', person, "insert into public.baze_sportive(nume,oras) values('Bad','Bad')"));
        assert.equal((await as('authenticated', person, "update public.baze_sportive set descriere='Bad' where id=$1 returning id", [baseA])).rows.length, 0);
        assert.equal((await as('authenticated', person, 'delete from public.baze_sportive where id=$1 returning id', [baseA])).rows.length, 0);
        await assert.rejects(() => save(person, {id: baseA}), /Only authenticated superadmins/);
      }
      await assert.rejects(() => save(null), /Only authenticated superadmins/);
    });
    await check('a court administrator needs an explicit description permission', async () => {
      assert.equal((await as('authenticated', 3, "update public.baze_sportive set descriere='Not granted' where id=$1 returning id", [baseA])).rows.length, 0);
      await save(4, {id: baseA, courts: [courts['Court A'], courts['Court B']], admins: [uid(3)]});
      const result = await as('authenticated', 3, 'update public.baze_sportive set descriere=$1 where id=$2 returning descriere', ['Descriere cu diacritice și <script>plain text</script>.', baseA]);
      assert.equal(result.rows[0].descriere, 'Descriere cu diacritice și <script>plain text</script>.');
    });
    await check('description editors cannot change name, city, visibility, identity or creation time', async () => {
      for (const [column, value] of [['nume', 'Other name'], ['oras', 'Other city'], ['este_activa', false], ['id', uid(199)], ['created_at', '2001-01-01']]) {
        await assert.rejects(() => as('authenticated', 3, `update public.baze_sportive set ${column}=$1 where id=$2`, [value, baseA]), /only a sports-base description/);
      }
      const updated = (await as('authenticated', 3, "update public.baze_sportive set updated_at='2001-01-01',descriere='Updated' where id=$1 returning updated_at", [baseA])).rows[0].updated_at;
      assert.ok(new Date(updated).getUTCFullYear() > 2001);
    });
    await check('explicit editors can read and describe their inactive base but other clients cannot', async () => {
      await save(4, {id: baseA, active: false, courts: [courts['Court A'], courts['Court B']], admins: [uid(3)]});
      assert.equal((await read('authenticated', 1)).rows.length, 0);
      assert.deepEqual((await read('authenticated', 3)).rows.map(row => row.id), [baseA]);
      assert.equal((await as('authenticated', 3, "update public.baze_sportive set descriere='Draft description' where id=$1 returning id", [baseA])).rows.length, 1);
      await save(4, {id: baseA, courts: [courts['Court A'], courts['Court B']], admins: [uid(3)]});
    });
    await check('base description grants never expand court, client, booking or chat access', async () => {
      const day = (await root("select ((now() at time zone 'Europe/Bucharest')::date+1)::text as day_value")).rows[0].day_value;
      await as('authenticated', 2, "insert into public.rezervari(email_client,teren,data_str,ora,stare) values('bob@example.test','Court B',$1,'12:00','activa')", [day]);
      await as('authenticated', 2, "insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('bob@example.test','Court B','client','Private message')");
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=1 where nume='Court B' returning id")).rows.length, 0);
      assert.equal((await as('authenticated', 3, "select id from public.rezervari where teren='Court B'")).rows.length, 0);
      assert.equal((await as('authenticated', 3, "select id from public.mesaje_chat where teren='Court B'")).rows.length, 0);
      assert.equal((await as('authenticated', 3, 'select id from public.clienti where user_id=$1', [uid(2)])).rows.length, 0);
      await assert.rejects(() => as('authenticated', 3, "insert into public.rezervari(email_client,teren,data_str,ora,stare) values('Guest','Court B',$1,'13:00','activa')", [day]));
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=pret where nume='Court A' returning id")).rows.length, 1);
    });
    await check('description editors cannot link or unlink even their assigned courts', async () => {
      await assert.rejects(() => as('authenticated', 3, "update public.terenuri set baza_sportiva_id=null where nume='Court A'"), /Only superadmins|Admin may update only settings/);
      await assert.rejects(() => as('authenticated', 3, "update public.terenuri set baza_sportiva_id=$1 where nume='Court A'", [hiddenBase]), /Only superadmins|Admin may update only settings/);
    });
    await check('description editors cannot grant permissions or invoke the superadmin save', async () => {
      await assert.rejects(() => as('authenticated', 3, 'insert into public.baze_sportive_admini values($1,$2)', [hiddenBase, uid(3)]));
      assert.equal((await as('authenticated', 3, 'delete from public.baze_sportive_admini where baza_id=$1 returning user_id', [baseA])).rows.length, 0);
      await assert.rejects(() => save(3, {id: baseA, courts: [courts['Court A']]}), /Only authenticated superadmins/);
      assert.deepEqual((await as('authenticated', 3, 'select baza_id,user_id from public.baze_sportive_admini')).rows, [{baza_id: baseA, user_id: uid(3)}]);
      assert.equal((await as('authenticated', 1, 'select * from public.baze_sportive_admini')).rows.length, 0);
    });
    await check('revoking explicit permission immediately stops description edits', async () => {
      await save(4, {id: baseA, courts: [courts['Court A'], courts['Court B']]});
      assert.equal((await as('authenticated', 3, "update public.baze_sportive set descriere='Revoked' where id=$1 returning id", [baseA])).rows.length, 0);
      await save(4, {id: baseA, courts: [courts['Court A'], courts['Court B']], admins: [uid(3)]});
    });
    await check('removing the admin role cascades description permissions and denies editing', async () => {
      const admin = (await root('select * from public.users_admin where user_id=$1', [uid(3)])).rows[0];
      await as('authenticated', 4, 'delete from public.users_admin where user_id=$1', [uid(3)]);
      assert.equal((await root('select count(*)::integer total from public.baze_sportive_admini where user_id=$1', [uid(3)])).rows[0].total, 0);
      assert.equal((await as('authenticated', 3, "update public.baze_sportive set descriere='Former admin' where id=$1 returning id", [baseA])).rows.length, 0);
      await root('insert into public.users_admin(user_id,nume_admin,email,is_super,terenuri) values($1,$2,$3,$4,$5)', [admin.user_id, admin.nume_admin, admin.email, admin.is_super, admin.terenuri]);
    });
    await check('unknown courts or administrators reject the entire atomic save', async () => {
      const count = (await root('select count(*)::integer total from public.baze_sportive')).rows[0].total;
      await assert.rejects(() => save(4, {name: 'Should not exist', courts: ['missing']}), /court no longer exists/);
      await assert.rejects(() => save(4, {id: baseA, name: 'Should not change', courts: [courts['Court A']], admins: [uid(1)]}), /administrator no longer exists/);
      assert.equal((await root('select count(*)::integer total from public.baze_sportive')).rows[0].total, count);
      assert.equal((await root('select nume from public.baze_sportive where id=$1', [baseA])).rows[0].nume, 'Baza A');
      assert.equal((await root('select id from public.terenuri where baza_sportiva_id=$1', [baseA])).rows.length, 2);
    });
    await check('missing lists, null entries and a stale base ID reject atomically', async () => {
      for (const change of [{courts: null}, {admins: null}, {courts: [null]}, {admins: [null]}]) await assert.rejects(() => save(4, {id: baseA, ...change}), /complete court and description-editor lists/);
      await assert.rejects(() => save(4, {id: uid(999)}), /sports base no longer exists/);
    });
    await check('saving a base cannot steal courts from another base', async () => {
      await assert.rejects(() => save(4, {name: 'Baza B', courts: [courts['Court A']]}), /Unlink the court/);
      assert.equal((await root("select count(*)::integer total from public.baze_sportive where nume='Baza B'")).rows[0].total, 0);
      await assert.rejects(() => save(4, {id: hiddenBase, courts: [courts['Court A'], courts['Hidden Court']]}), /Unlink the court/);
    });
    await check('superadmin can unlink then move courts with exact membership and deduplicated grants', async () => {
      await save(4, {id: baseA, courts: [courts['Court A']], admins: [uid(3), uid(3)]});
      assert.equal((await root('select baza_sportiva_id from public.terenuri where nume=$1', ['Court B'])).rows[0].baza_sportiva_id, null);
      baseB = (await save(4, {name: 'Baza B', city: 'Cluj', courts: [courts['Court B'], courts['Court B']]})).rows[0].id;
      assert.equal((await root('select id from public.terenuri where baza_sportiva_id=$1', [baseB])).rows.length, 1);
      assert.equal((await root('select user_id from public.baze_sportive_admini where baza_id=$1', [baseA])).rows.length, 1);
      assert.deepEqual((await read()).rows.map(row => row.nume), ['Baza A', 'Baza B']);
    });
    await check('database validates required text, description length and foreign keys', async () => {
      for (const change of [{name: ''}, {city: ' '}, {name: 'a'.repeat(161)}, {city: 'a'.repeat(121)}, {description: 'a'.repeat(2001)}, {description: null}, {active: null}]) {
        await assert.rejects(() => save(4, {id: baseA, courts: [courts['Court A']], ...change}), /constraint/);
      }
      await assert.rejects(() => as('authenticated', 3, 'update public.baze_sportive set descriere=$1 where id=$2', ['a'.repeat(2001), baseA]), /check constraint/);
      await assert.rejects(() => root('update public.terenuri set baza_sportiva_id=$1 where nume=$2', [uid(999), 'Court A']), /foreign key constraint/);
      await assert.rejects(() => root('insert into public.baze_sportive_admini values($1,$2)', [baseA, uid(1)]), /foreign key constraint/);
    });
    await check('a failed final permission insert rolls back metadata and court updates', async () => {
      await root("create function public.fixture_reject_permission() returns trigger language plpgsql as $$ begin raise exception 'Fixture final-stage failure'; end $$");
      await root('create trigger fixture_permission_failure before insert on public.baze_sportive_admini for each row execute function public.fixture_reject_permission()');
      await assert.rejects(() => save(4, {id: baseA, name: 'Must roll back', courts: [], admins: [uid(3)]}), /Fixture final-stage failure/);
      assert.equal((await root('select nume from public.baze_sportive where id=$1', [baseA])).rows[0].nume, 'Baza A');
      assert.equal((await root('select baza_sportiva_id from public.terenuri where nume=$1', ['Court A'])).rows[0].baza_sportiva_id, baseA);
      await root('drop trigger fixture_permission_failure on public.baze_sportive_admini');
      await root('drop function public.fixture_reject_permission()');
    });
    await check('demoted superadmin loses structural writes with the same JWT subject', async () => {
      await root("update public.users_admin set is_super=false,terenuri='Court A' where user_id=$1", [uid(4)]);
      await assert.rejects(() => save(4, {id: baseA}), /Only authenticated superadmins/);
      await root('update public.users_admin set is_super=true where user_id=$1', [uid(4)]);
    });
    await check('trusted service-role description writes work without browser identity', async () => {
      assert.equal((await as('service_role', null, "update public.baze_sportive set descriere='Service update' where id=$1 returning id", [baseB])).rows.length, 1);
    });
    await check('deleting a base unlinks courts without deleting bookings or courts', async () => {
      const count = (await root('select count(*)::integer total from public.rezervari')).rows[0].total;
      await as('authenticated', 4, 'delete from public.baze_sportive where id=$1', [baseB]);
      assert.equal((await root("select baza_sportiva_id from public.terenuri where nume='Court B'")).rows[0].baza_sportiva_id, null);
      assert.equal((await root('select count(*)::integer total from public.rezervari')).rows[0].total, count);
      assert.equal((await root('select count(*)::integer total from public.terenuri')).rows[0].total, 3);
    });
    await check('006 can be rerun without resetting descriptions, associations or editor grants', async () => {
      const state = (await root('select to_jsonb(b) row from public.baze_sportive b order by id')).rows;
      const memberships = (await root('select id::text,baza_sportiva_id from public.terenuri order by id::text')).rows;
      const grants = (await root('select * from public.baze_sportive_admini order by baza_id,user_id')).rows;
      const core = await coreState();
      await root('select 1');
      await pg.exec(migration);
      assert.deepEqual((await root('select to_jsonb(b) row from public.baze_sportive b order by id')).rows, state);
      assert.deepEqual((await root('select id::text,baza_sportiva_id from public.terenuri order by id::text')).rows, memberships);
      assert.deepEqual((await root('select * from public.baze_sportive_admini order by baza_id,user_id')).rows, grants);
      assert.deepEqual(await coreState(), core);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(row => row.version), [1, 3, 4, 5, 6]);
    });
    await check('rerun removes accidental permissive policies on the two new tables', async () => {
      for (const table of ['baze_sportive', 'baze_sportive_admini']) await root(`create policy accidentally_public on public.${table} for all to authenticated using(true) with check(true)`);
      await pg.exec(migration);
      assert.equal((await as('authenticated', 1, "update public.baze_sportive set descriere='Forbidden' returning id")).rows.length, 0);
      assert.equal((await as('authenticated', 1, 'select * from public.baze_sportive_admini')).rows.length, 0);
      assert.equal((await root("select count(*)::integer total from pg_policies where tablename in ('baze_sportive','baze_sportive_admini')")).rows[0].total, 9);
    });
    console.log(`\n${passed} sports-base checks passed (${integerIds ? 'numeric' : 'UUID'} court IDs).`);
  } finally {
    await pg.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
