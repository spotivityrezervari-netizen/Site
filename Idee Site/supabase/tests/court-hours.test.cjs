// Disposable PostgreSQL tests. Never run fixture SQL against the real project.
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sqlFile = name => readFileSync(join(__dirname, '..', name), 'utf8');
const legacyHours = Array.from({ length: 11 }, (_, i) => `${i + 12}:00`);
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (process.env.SPOTIVITY_TEST_INTEGER_IDS === '1') schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); set role ${role};`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const denied = fn => assert.rejects(fn);
    const migration = sqlFile('003_court_hours.sql');
    await check('migration requires completed security migration and changes nothing on failure', async () => {
      await denied(() => pg.exec(migration));
      await pg.exec('rollback');
      assert.equal((await root("select count(*)::integer n from information_schema.columns where table_schema='public' and table_name='terenuri' and column_name='ore_rezervabile'")).rows[0].n, 0);
    });
    await pg.exec(sqlFile('001_security.sql'));
    await pg.exec(`
      create schema supabase_functions;
      create table public.test_hour_webhook_events(trigger_name text, operation text);
      create function supabase_functions.http_request() returns trigger
      language plpgsql security definer set search_path='' as $$
      begin
        if current_setting('spotivity.test_forbid_http',true)='on' then
          raise exception 'Migration unexpectedly fired a reservation webhook';
        end if;
        insert into public.test_hour_webhook_events values(tg_name,tg_op);
        return coalesce(new,old);
      end $$;
      create trigger test_hour_insert after insert on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/insert');
      create trigger test_hour_update_o after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/update');
      create trigger test_hour_update_a after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/always');
      alter table public.rezervari enable always trigger test_hour_update_a;
      create trigger test_hour_update_r after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/replica');
      alter table public.rezervari enable replica trigger test_hour_update_r;
      create trigger test_hour_update_d after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/disabled');
      alter table public.rezervari disable trigger test_hour_update_d;
      select set_config('spotivity.test_forbid_http','on',false);
    `);
    const before = (await root('select * from public.rezervari order by id')).rows;
    const triggersBefore = (await root("select oid::text,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.rezervari'::regclass order by oid")).rows;
    await pg.exec(migration);
    await pg.exec("select set_config('spotivity.test_forbid_http','off',false)");
    const tomorrow = (await root("select ((now() at time zone 'Europe/Bucharest')::date + 1)::text as booking_date")).rows[0].booking_date;
    const booking = (person, court, hour, extras = {}) => as('authenticated', person,
      'insert into public.rezervari(email_client,teren,data_str,ora,pret_total,stare,cu_minge) values($1,$2,$3,$4,$5,$6,$7) returning *',
      [extras.email || (person === 1 ? 'alice@example.test' : 'Manual booking'), court, extras.day || tomorrow, hour, '0 RON', extras.state || 'activa', Boolean(extras.ball)]);
    await check('existing schedules, bookings and trigger objects are preserved', async () => {
      assert.ok((await root('select ore_rezervabile from public.terenuri')).rows.every(r => JSON.stringify(r.ore_rezervabile) === JSON.stringify(legacyHours)));
      assert.deepEqual((await root('select * from public.rezervari order by id')).rows, before);
      assert.deepEqual((await root("select oid::text,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.rezervari'::regclass order by oid")).rows, triggersBefore);
      assert.deepEqual((await root('select * from public.test_hour_webhook_events')).rows, []);
    });
    await check('anonymous can read hours but cannot change them', async () => {
      assert.deepEqual((await as('anon', null, "select ore_rezervabile from public.terenuri where nume='Court A'")).rows[0].ore_rezervabile, legacyHours);
      await denied(() => as('anon', null, "update public.terenuri set ore_rezervabile=array['09:00']"));
    });
    await check('09:00 is rejected until configured, including admin and superadmin writes', async () => {
      for (const person of [1, 3, 4]) await denied(() => booking(person, 'Court A', '09:00'));
    });
    await check('assigned admin changes schedule and stored hours are canonical', async () => {
      const rows = (await as('authenticated', 3, "update public.terenuri set ore_rezervabile=array['22:00','09:00','12:00'] where nume='Court A' returning ore_rezervabile")).rows;
      assert.deepEqual(rows[0].ore_rezervabile, ['09:00', '12:00', '22:00']);
    });
    await check('configured 09:00 booking keeps server ownership and ball pricing', async () => {
      const row = (await booking(1, 'Court A', '09:00', { ball: true })).rows[0];
      assert.equal(row.client_user_id, uid(1));
      assert.equal(row.email_client, 'alice@example.test');
      assert.equal(row.sport, 'Fotbal');
      assert.equal(row.pret_total, '115 RON (+Minge)');
      assert.equal(row.starts_at.toISOString(), (await root("select ('" + tomorrow + "'::date + '09:00'::time) at time zone 'Europe/Bucharest' starts_at")).rows[0].starts_at.toISOString());
    });
    await check('disabled intermediate hour is denied for clients, manual bookings and blocks', async () => {
      await denied(() => booking(1, 'Court A', '10:00'));
      await denied(() => booking(3, 'Court A', '10:00', { email: 'Manual customer' }));
      await denied(() => booking(3, 'Court A', '11:00', { email: 'Teren Blocat' }));
      await denied(() => booking(4, 'Court A', '13:00'));
    });
    await check('assigned admin can block configured hours without inventing a user identity', async () => {
      const row = (await booking(3, 'Court A', '12:00', { email: 'Teren Blocat' })).rows[0];
      assert.equal(row.client_user_id, null);
      assert.equal(row.email_client, 'Teren Blocat');
    });
    await check('ordinary admin cannot change another court or unrelated court fields', async () => {
      assert.equal((await as('authenticated', 3, "update public.terenuri set ore_rezervabile=array['09:00'] where nume='Court B' returning id")).rows.length, 0);
      await denied(() => as('authenticated', 3, "update public.terenuri set ore_rezervabile=array['09:00'],sport='Hacked' where nume='Court A'"));
      await denied(() => as('authenticated', 3, "update public.terenuri set nume='Hacked' where nume='Court A'"));
      assert.equal((await as('authenticated', 1, "update public.terenuri set ore_rezervabile=array['09:00'] where nume='Court A' returning id")).rows.length, 0);
    });
    await check('invalid arrays are rejected without changing stored hours', async () => {
      const values = [null, ['08:00'], ['23:00'], ['9:00'], ['09:30'], ['09:00', null], ['09:00', '09:00']];
      for (const value of values) await denied(() => as('authenticated', 3,
        "update public.terenuri set ore_rezervabile=$1::text[] where nume='Court A'", [value]));
      for (const expression of ["array[['09:00','12:00']]", "'[0:1]={09:00,12:00}'::text[]"])
        await denied(() => as('authenticated', 3, `update public.terenuri set ore_rezervabile=${expression} where nume='Court A'`));
      assert.deepEqual((await root("select ore_rezervabile from public.terenuri where nume='Court A'")).rows[0].ore_rezervabile, ['09:00', '12:00', '22:00']);
    });
    await check('superadmin configures other courts while client spoofing and date restrictions remain', async () => {
      assert.equal((await as('authenticated', 4, "update public.terenuri set ore_rezervabile=array['09:00','22:00'] where nume='Court B' returning id")).rows.length, 1);
      await denied(() => booking(1, 'Court B', '09:00', { email: 'bob@example.test' }));
      await denied(() => booking(1, 'Court B', '09:00', { day: '2000-01-01' }));
      await denied(() => booking(1, 'Court B', '09:00', { day: '2100-01-01' }));
      await denied(() => booking(1, 'Hidden Court', '12:00'));
      await denied(() => booking(1, 'Court B', '09:00', { ball: true }));
    });
    await check('22:00 remains a valid hourly start and its duplicate is denied', async () => {
      await booking(1, 'Court A', '22:00');
      await denied(() => booking(3, 'Court A', '22:00'));
    });
    await check('empty hours deny new bookings while existing bookings and availability stay intact', async () => {
      const rows = (await root("select * from public.rezervari where teren='Court A' order by id")).rows;
      const availability = (await root("select * from public.rezervari_disponibilitate where teren='Court A' order by id")).rows;
      await as('authenticated', 3, "update public.terenuri set ore_rezervabile=array[]::text[] where nume='Court A'");
      for (const person of [1, 3, 4]) await denied(() => booking(person, 'Court A', '14:00'));
      assert.deepEqual((await root("select * from public.rezervari where teren='Court A' order by id")).rows, rows);
      assert.deepEqual((await root("select * from public.rezervari_disponibilitate where teren='Court A' order by id")).rows, availability);
    });
    await check('client can cancel an existing disabled hour without changing booking details', async () => {
      const previous = (await root("select * from public.rezervari where teren='Court A' and ora='09:00' and stare='activa'")).rows[0];
      const row = (await as('authenticated', 1, "update public.rezervari set stare='anulata' where id::text=$1 returning *", [String(previous.id)])).rows[0];
      assert.deepEqual(row, { ...previous, stare: 'anulata' });
      assert.equal((await root('select * from public.rezervari_disponibilitate where id=$1', [String(previous.id)])).rows.length, 0);
      await denied(() => as('authenticated', 1, "update public.rezervari set stare='activa' where id::text=$1", [String(previous.id)]));
    });
    await check('admin can cancel disabled-hour blocks but cannot reactivate or move into disabled slots', async () => {
      await as('authenticated', 3, "update public.rezervari set stare='anulata' where teren='Court A' and ora='12:00' and stare='activa'");
      await denied(() => as('authenticated', 3, "update public.rezervari set stare='activa' where teren='Court A' and ora='12:00'"));
      await denied(() => as('authenticated', 3, "update public.rezervari set ora='14:00' where teren='Court A' and ora='22:00' and stare='activa'"));
    });
    await check('migration rerun preserves custom schedules, bookings and trigger objects', async () => {
      const courts = (await root('select * from public.terenuri order by id')).rows;
      const bookings = (await root('select * from public.rezervari order by id')).rows;
      await pg.exec("select set_config('spotivity.test_forbid_http','on',false)");
      await pg.exec(migration);
      await pg.exec("select set_config('spotivity.test_forbid_http','off',false)");
      assert.deepEqual((await root('select * from public.terenuri order by id')).rows, courts);
      assert.deepEqual((await root('select * from public.rezervari order by id')).rows, bookings);
      assert.deepEqual((await root("select oid::text,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.rezervari'::regclass order by oid")).rows, triggersBefore);
      assert.equal((await root('select count(*)::integer n from spotivity_private.migrations where version=3')).rows[0].n, 1);
    });
    await check('old security migration cannot silently downgrade configurable-hour guards', async () => {
      await denied(() => pg.exec(sqlFile('001_security.sql')));
      await pg.exec('rollback');
      assert.deepEqual((await root("select ore_rezervabile from public.terenuri where nume='Court A'")).rows[0].ore_rezervabile, []);
      await denied(() => booking(3, 'Court A', '12:00'));
    });
    await check('webhooks still fire for normal INSERT and cancellation with original enabled states', async () => {
      await root('truncate public.test_hour_webhook_events');
      await booking(1, 'Court B', '09:00');
      assert.deepEqual((await root('select * from public.test_hour_webhook_events order by trigger_name')).rows,
        [{ trigger_name: 'test_hour_insert', operation: 'INSERT' }]);
      await root('truncate public.test_hour_webhook_events');
      await as('authenticated', 1, "update public.rezervari set stare='anulata' where teren='Court B' and ora='09:00' and stare='activa'");
      assert.deepEqual((await root('select * from public.test_hour_webhook_events order by trigger_name')).rows, [
        { trigger_name: 'test_hour_update_a', operation: 'UPDATE' },
        { trigger_name: 'test_hour_update_o', operation: 'UPDATE' },
      ]);
    });
    await check('cancellation after the booking has ended still succeeds after schedule removal', async () => {
      const previous = (await booking(4, 'Court B', '09:00', { email: 'alice@example.test', day: '2000-01-01' })).rows[0];
      await as('authenticated', 4, "update public.terenuri set ore_rezervabile=array[]::text[] where nume='Court B'");
      const row = (await as('authenticated', 1, "update public.rezervari set stare='anulata' where id::text=$1 returning *", [String(previous.id)])).rows[0];
      assert.deepEqual(row, { ...previous, stare: 'anulata' });
    });
    await check('trusted Auth email and court rename synchronization preserve out-of-program bookings', async () => {
      const before = (await root('select id::text,stare,client_user_id,starts_at,ora,data_str from public.rezervari order by id')).rows;
      await root("update auth.users set email='alice-new@example.test' where id='" + uid(1) + "'");
      await as('authenticated', 4, "update public.terenuri set nume='Court Renamed' where nume='Court A'");
      assert.deepEqual((await root('select id::text,stare,client_user_id,starts_at,ora,data_str from public.rezervari order by id')).rows, before);
      assert.ok((await root("select email_client from public.rezervari where client_user_id='" + uid(1) + "'")).rows.every(row => row.email_client === 'alice-new@example.test'));
      assert.equal((await as('authenticated', 3, 'select terenuri from public.users_admin')).rows[0].terenuri, 'Court Renamed');
    });
    await check('new validation helper does not expose private trigger execution', async () => {
      assert.equal((await root("select has_function_privilege('anon','spotivity_private.normalize_court_hours(text[])','EXECUTE') allowed")).rows[0].allowed, false);
      for (const fn of ['spotivity_private.guard_court()', 'spotivity_private.guard_booking()', 'spotivity_private.booking_instant(text,text)'])
        assert.equal((await root('select has_function_privilege(\'authenticated\',$1,\'EXECUTE\') allowed', [fn])).rows[0].allowed, false);
    });
    console.log(`\n${passed} court-hours PostgreSQL security checks passed.`);
  } finally { await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
