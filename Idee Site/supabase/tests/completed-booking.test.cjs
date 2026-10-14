// Disposable Supabase-compatible fixture only; never run against production.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('007_completed_booking_cancellation.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const completedError = /Completed bookings cannot be cancelled/;
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (integerIds) {
      schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    } else {
      schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    }
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${person ? uid(person) : ''}', false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const row = id => root('select * from public.rezervari where id=$1', [id]).then(result => result.rows[0]);
    const cancel = (person, id, role = 'authenticated') => as(role, person, "update public.rezervari set stare='anulata' where id=$1 returning *", [id]);
    const tables = ['auth.users', 'public.clienti', 'public.users_admin', 'public.terenuri', 'public.rezervari', 'public.mesaje_chat', 'public.rezervari_disponibilitate', 'public.site_sporturi', 'public.baze_sportive', 'public.baze_sportive_admini', 'storage.buckets', 'storage.objects'];
    const businessState = async () => {
      const state = {};
      for (const table of tables) state[table] = (await root(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
      return state;
    };
    const policies = () => root('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname').then(result => result.rows);
    const definitions = () => root("select 'function' kind,p.oid::text id,pg_get_functiondef(p.oid) definition,null::text enabled from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('spotivity_private','supabase_functions') union all select 'trigger',t.oid::text,pg_get_triggerdef(t.oid),t.tgenabled::text from pg_trigger t where not t.tgisinternal order by kind,id").then(result => result.rows);
    const events = () => root('select * from public.fixture_completed_events order by trigger_name,operation').then(result => result.rows);

    await check('007 rejects an unsecured schema without installing its trigger', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
      await pg.exec('rollback');
      assert.equal((await root("select count(*)::integer total from pg_trigger where tgname='spotivity_booking_completed_guard'")).rows[0].total, 0);
    });
    for (const name of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql', '005_sport_appearance.sql']) await pg.exec(file(name));
    await check('007 requires sports-base migration 006', async () => {
      await assert.rejects(() => pg.exec(migration), /006 before 007/);
      await pg.exec('rollback');
    });
    await pg.exec(file('006_sports_bases.sql'));
    await check('007 checks every prerequisite version', async () => {
      for (const version of [1, 3, 4, 5, 6]) {
        const saved = (await root('delete from spotivity_private.migrations where version=$1 returning *', [version])).rows[0];
        await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
        await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)', [saved.version, saved.applied_at]);
      }
    });
    await pg.exec(`
      create schema supabase_functions;
      create table public.fixture_completed_events(trigger_name text, operation text);
      create function supabase_functions.http_request() returns trigger
      language plpgsql security definer set search_path='' as $$
      begin
        if current_setting('spotivity.test_forbid_http',true)='on' then
          raise exception 'Migration unexpectedly fired a reservation webhook';
        end if;
        insert into public.fixture_completed_events values(tg_name,tg_op);
        return coalesce(new,old);
      end $$;
      create trigger fixture_completed_insert after insert on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/insert');
      create trigger fixture_completed_update_o after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/update');
      create trigger fixture_completed_update_a after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/always');
      alter table public.rezervari enable always trigger fixture_completed_update_a;
      create trigger fixture_completed_update_r after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/replica');
      alter table public.rezervari enable replica trigger fixture_completed_update_r;
      create trigger fixture_completed_update_d after update on public.rezervari
        for each row execute function supabase_functions.http_request('https://fixture.invalid/disabled');
      alter table public.rezervari disable trigger fixture_completed_update_d;
      select set_config('spotivity.test_forbid_http','on',false);
    `);
    const originalState = await businessState();
    const originalPolicies = await policies();
    const originalDefinitions = await definitions();
    await pg.exec(migration);
    await check('007 preserves every business row, existing policy, guard and webhook state', async () => {
      assert.deepEqual(await businessState(), originalState);
      assert.deepEqual(await policies(), originalPolicies);
      const after = new Map((await definitions()).map(item => [item.kind + item.id, item]));
      for (const item of originalDefinitions) assert.deepEqual(after.get(item.kind + item.id), item);
      assert.deepEqual(await events(), []);
    });
    await check('007 has one enabled before-update guard and records version 7 once', async () => {
      const trigger = (await root("select tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where tgname='spotivity_booking_completed_guard'")).rows;
      assert.equal(trigger.length, 1);
      assert.equal(trigger[0].tgenabled, 'O');
      assert.match(trigger[0].definition, /BEFORE UPDATE ON public.rezervari FOR EACH ROW/);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(item => item.version), [1, 3, 4, 5, 6, 7]);
    });
    await check('browser and service roles cannot directly invoke the trigger function', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await root("select has_function_privilege($1, 'spotivity_private.guard_completed_booking_cancellation()', 'execute') allowed", [role])).rows[0].allowed, false);
      }
    });
    await root("select set_config('spotivity.test_forbid_http','off',false)");
    let nextDay = 1;
    const seed = async ({kind = 'past', person = 1, court = 'Court A', state = 'activa'} = {}) => {
      const timing = (await root(`select
        case when $1='future' then ((statement_timestamp() at time zone 'Europe/Bucharest')::date+$2::integer)::text
          else ('2001-01-01'::date+$2::integer)::text end as booking_date`, [kind, nextDay++])).rows[0];
      const booking = (await root('insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values($1,$2,$3,$4,$5,$6) returning *',
        [person === 1 ? 'alice@example.test' : 'bob@example.test', uid(person), court, timing.booking_date, '12:00', state])).rows[0];
      if (kind !== 'ongoing') return booking;
      // Set a deterministic persisted start in this isolated fixture, so the
      // ongoing tests also work when the wall clock is outside court hours.
      // The new completed-booking guard stays enabled during this override.
      await root('alter table public.rezervari disable trigger spotivity_booking_guard');
      try { await root("update public.rezervari set starts_at=statement_timestamp()-interval '30 minutes' where id=$1", [booking.id]); }
      finally { await root('alter table public.rezervari enable trigger spotivity_booking_guard'); }
      return row(booking.id);
    };

    for (const [person, label] of [[1, 'owner'], [3, 'assigned administrator'], [4, 'superadministrator']]) {
      await check(`${label} cannot cancel a completed active reservation`, async () => {
        const booking = await seed();
        const previousEvents = await events();
        await assert.rejects(() => cancel(person, booking.id), completedError);
        assert.deepEqual(await row(booking.id), booking);
        assert.deepEqual(await events(), previousEvents);
        assert.equal((await root('select id from public.rezervari_disponibilitate where id=$1', [String(booking.id)])).rows.length, 1);
      });
      await check(`${label} can still cancel a future reservation`, async () => {
        const booking = await seed({kind: 'future'});
        const result = await cancel(person, booking.id);
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].stare, 'anulata');
        assert.equal((await root('select id from public.rezervari_disponibilitate where id=$1', [String(booking.id)])).rows.length, 0);
      });
      await check(`${label} can still cancel an ongoing reservation`, async () => {
        const booking = await seed({kind: 'ongoing'});
        const result = await cancel(person, booking.id);
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].stare, 'anulata');
      });
    }
    await check('another client and an unassigned administrator retain no cancellation access', async () => {
      for (const kind of ['past', 'future']) {
        const otherClient = await seed({kind, person: 2});
        assert.equal((await cancel(1, otherClient.id)).rows.length, 0);
        assert.deepEqual(await row(otherClient.id), otherClient);
        const otherCourt = await seed({kind, court: 'Court B'});
        assert.equal((await cancel(3, otherCourt.id)).rows.length, 0);
        assert.deepEqual(await row(otherCourt.id), otherCourt);
      }
    });
    await check('anonymous requests cannot cancel a reservation', async () => {
      const booking = await seed({kind: 'future'});
      await assert.rejects(() => cancel(null, booking.id, 'anon'), /permission denied/);
      assert.deepEqual(await row(booking.id), booking);
    });
    await check('changing starts_at or the date and hour in the same cancellation cannot evade the cutoff', async () => {
      for (const person of [1, 3, 4]) {
        const booking = await seed();
        await assert.rejects(() => as('authenticated', person,
          "update public.rezervari set stare='anulata',starts_at=statement_timestamp()+interval '1 day' where id=$1", [booking.id]), completedError);
        await assert.rejects(() => as('authenticated', person,
          "update public.rezervari set stare='anulata',data_str=((statement_timestamp() at time zone 'Europe/Bucharest')::date+1)::text,ora='13:00' where id=$1", [booking.id]), completedError);
        assert.deepEqual(await row(booking.id), booking);
      }
    });
    await check('a failed mixed bulk cancellation leaves every row, availability entry and webhook event unchanged', async () => {
      const future = await seed({kind: 'future'});
      const past = await seed();
      const before = await businessState();
      const hooks = await events();
      await assert.rejects(() => as('authenticated', 4,
        "update public.rezervari set stare='anulata' where id::text=any($1::text[])", [[String(future.id), String(past.id)]]), completedError);
      assert.deepEqual(await businessState(), before);
      assert.deepEqual(await events(), hooks);
    });
    await check('all authenticated roles are blocked at the exact one-hour end instant', async () => {
      const booking = await seed();
      for (const person of [1, 3, 4]) {
        await root('begin');
        try {
          // Fixture-only override constructs exact equality within one SQL
          // statement; the new cancellation guard remains enabled throughout.
          await root('alter table public.rezervari disable trigger spotivity_booking_guard');
          await assert.rejects(() => root(`do $fixture$
            begin
              update public.rezervari set starts_at=statement_timestamp()-interval '1 hour' where id::text='${booking.id}';
              perform set_config('request.jwt.claim.sub','${uid(person)}',true);
              set local role authenticated;
              update public.rezervari set stare='anulata' where id::text='${booking.id}';
            end $fixture$`), completedError);
        } finally { await pg.exec('rollback; reset role'); }
        assert.deepEqual(await row(booking.id), booking);
      }
    });
    await check('one microsecond before the end remains cancellable', async () => {
      const booking = await seed();
      await root('begin');
      try {
        await root('alter table public.rezervari disable trigger spotivity_booking_guard');
        await root(`do $fixture$
          begin
            update public.rezervari set starts_at=statement_timestamp()-interval '1 hour'+interval '1 microsecond' where id::text='${booking.id}';
            perform set_config('request.jwt.claim.sub','${uid(1)}',true);
            set local role authenticated;
            update public.rezervari set stare='anulata' where id::text='${booking.id}';
          end $fixture$`);
        assert.equal((await row(booking.id)).stare, 'anulata');
      } finally { await pg.exec('rollback; reset role'); }
    });
    await check('a transaction started before the end cannot cancel after the end', async () => {
      const booking = await seed();
      await root('begin');
      try {
        await root('alter table public.rezervari disable trigger spotivity_booking_guard');
        await root("update public.rezervari set starts_at=transaction_timestamp()-interval '1 hour'+interval '1 millisecond' where id=$1", [booking.id]);
        await root('alter table public.rezervari enable trigger spotivity_booking_guard');
        await new Promise(resolve => setTimeout(resolve, 20));
        const clocks = (await root("select transaction_timestamp()<starts_at+interval '1 hour' before_end,statement_timestamp()>=starts_at+interval '1 hour' after_end from public.rezervari where id=$1", [booking.id])).rows[0];
        assert.deepEqual(clocks, {before_end: true, after_end: true});
        await assert.rejects(() => cancel(1, booking.id), completedError);
      } finally { await pg.exec('rollback; reset role'); }
      assert.deepEqual(await row(booking.id), booking);
    });
    await check('the old superadmin shortcut cannot cancel a completed booking on a removed court', async () => {
      const booking = await seed({court: 'Removed Court', state: 'anulata'});
      await root('alter table public.rezervari disable trigger spotivity_booking_guard');
      try { await root("update public.rezervari set stare='activa' where id=$1", [booking.id]); }
      finally { await root('alter table public.rezervari enable trigger spotivity_booking_guard'); }
      await assert.rejects(() => cancel(4, booking.id), completedError);
      assert.equal((await row(booking.id)).stare, 'activa');
    });
    await check('trusted postgres and service maintenance can still cancel completed reservations without an Auth subject', async () => {
      for (const role of ['postgres', 'service_role']) {
        const booking = await seed();
        assert.equal((await cancel(null, booking.id, role)).rows[0].stare, 'anulata');
      }
    });
    await check('authenticated identity is checked even when a service role has table privileges', async () => {
      const booking = await seed();
      await assert.rejects(() => cancel(4, booking.id, 'service_role'), completedError);
    });
    await check('completed-booking metadata and already-cancelled state updates keep their existing staff permissions', async () => {
      const booking = await seed();
      assert.equal((await as('authenticated', 3, "update public.rezervari set pret_total='125 RON' where id=$1 returning stare", [booking.id])).rows[0].stare, 'activa');
      const cancelled = await seed({state: 'anulata'});
      assert.equal((await cancel(4, cancelled.id)).rows[0].stare, 'anulata');
      const future = await seed({kind: 'future'});
      await assert.rejects(() => as('authenticated', 1, "update public.rezervari set stare='anulata',pret_total='1 RON' where id=$1", [future.id]), /Only cancellation of your own active booking/);
    });
    await check('successful cancellation still fires the original origin and always webhooks', async () => {
      const booking = await seed({kind: 'future'});
      await root('truncate public.fixture_completed_events');
      await cancel(1, booking.id);
      assert.deepEqual(await events(), [
        {trigger_name: 'fixture_completed_update_a', operation: 'UPDATE'},
        {trigger_name: 'fixture_completed_update_o', operation: 'UPDATE'}
      ]);
    });
    await check('rerunning 004 cannot remove the independent completed-booking restriction', async () => {
      await root('select 1');
      await pg.exec(file('004_admin_scope_hardening.sql'));
      const booking = await seed();
      await assert.rejects(() => cancel(4, booking.id), completedError);
      const future = await seed({kind: 'future'});
      assert.equal((await cancel(1, future.id)).rows[0].stare, 'anulata');
    });
    await check('007 reruns without business writes, webhook events or duplicate ledger entries', async () => {
      const before = await businessState();
      const beforePolicies = await policies();
      const beforeEvents = await events();
      const ledger = (await root('select * from spotivity_private.migrations order by version')).rows;
      const hooks = (await root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where tgname like 'fixture_completed_%' order by tgname")).rows;
      await root("select set_config('spotivity.test_forbid_http','on',false)");
      await pg.exec(migration);
      assert.deepEqual(await businessState(), before);
      assert.deepEqual(await policies(), beforePolicies);
      assert.deepEqual(await events(), beforeEvents);
      assert.deepEqual((await root('select * from spotivity_private.migrations order by version')).rows, ledger);
      assert.deepEqual((await root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where tgname like 'fixture_completed_%' order by tgname")).rows, hooks);
      await root("select set_config('spotivity.test_forbid_http','off',false)");
      const booking = await seed();
      await assert.rejects(() => cancel(1, booking.id), completedError);
    });
    console.log(`\n${passed} completed-booking checks passed (${integerIds ? 'numeric' : 'UUID'} identifiers).`);
  } finally {
    await pg.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
