// Disposable PostgreSQL/Auth-shaped fixture only. No live users or emails.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const migration = file('008_profile_edit.sql');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const profileError = /Clients may change only their own name and phone/;
const nameError = /Profile name must contain 2 to 200 characters/;
const phoneError = /Profile phone must contain 7 to 15 digits/;
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
    const profile = person => root('select * from public.clienti where user_id=$1', [uid(person)]).then(result => result.rows[0]);
    const update = (person, name, phone) => as('authenticated', person,
      'update public.clienti set nume=$1,telefon=$2 where user_id=$3 returning *', [name, phone, uid(person)]);
    const stateTables = ['auth.users', 'public.clienti', 'public.users_admin', 'public.terenuri', 'public.rezervari', 'public.mesaje_chat', 'public.rezervari_disponibilitate', 'public.site_sporturi', 'public.baze_sportive', 'public.baze_sportive_admini', 'storage.buckets', 'storage.objects'];
    const state = async () => {
      const saved = {};
      for (const table of stateTables) saved[table] = (await root(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
      return saved;
    };
    const triggers = () => root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid").then(result => result.rows);
    const policies = () => root("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where not (schemaname='public' and tablename='clienti' and policyname in ('profiles_update','spotivity_profiles_update_guard')) order by schemaname,tablename,policyname").then(result => result.rows);

    await check('008 rejects an unsecured schema without installing profile policies', async () => {
      await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
      await pg.exec('rollback');
      assert.equal((await root("select count(*)::integer total from pg_policies where policyname='spotivity_profiles_update_guard'")).rows[0].total, 0);
    });
    for (const name of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql', '005_sport_appearance.sql', '006_sports_bases.sql']) await pg.exec(file(name));
    await check('008 requires the completed-reservation guard migration', async () => {
      await assert.rejects(() => pg.exec(migration), /007 before 008/);
      await pg.exec('rollback');
    });
    await pg.exec(file('007_completed_booking_cancellation.sql'));
    await check('008 checks every required migration version', async () => {
      for (const version of [1, 3, 4, 5, 6, 7]) {
        const saved = (await root('delete from spotivity_private.migrations where version=$1 returning *', [version])).rows[0];
        await assert.rejects(() => pg.exec(migration), /Apply migrations 001/);
        await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)', [saved.version, saved.applied_at]);
      }
    });
    // Fixture-only GoTrue pending-email columns model a request awaiting the
    // confirmation links. They are not installed by migration 008.
    await root("alter table auth.users add column email_change text not null default '', add column email_change_confirm_status smallint not null default 0");
    await root('alter table auth.users alter column email drop not null');
    const historicalUser = async (person, email, metadata = {}) => {
      await root('alter table auth.users disable trigger spotivity_auth_profile');
      try { await root('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)', [uid(person), email, JSON.stringify(metadata)]); }
      finally { await root('alter table auth.users enable trigger spotivity_auth_profile'); }
    };
    await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [uid(3), JSON.stringify({nume: '  Historical Admin  ', telefon: '0712345678'})]);
    await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [uid(4), JSON.stringify({nume: '   ', is_super: false})]);
    await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [uid(1), JSON.stringify({nume: 'Stale metadata name', telefon: 'metadata must not replace contact'})]);
    await historicalUser(6, ' HISTORICAL@example.test ', {nume: 'N'.repeat(205), telefon: '7'.repeat(35), is_super: true});
    await historicalUser(7, 'fallback@example.test');
    await historicalUser(8, '   ');
    await historicalUser(9, null);
    const base = (await root("insert into public.baze_sportive(nume,oras,descriere) values('Assigned base','Test city','Existing description') returning id")).rows[0];
    await root('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)', [base.id, uid(3)]);
    await root("update public.terenuri set baza_sportiva_id=$1 where nume='Court A'", [base.id]);
    const day = (await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+1)::text value")).rows[0].value;
    const book = (person, court, date, hour) => root("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) select email,id,$2,$3,$4,'activa' from auth.users where id=$1 returning *", [uid(person), court, date, hour]).then(result => result.rows[0]);
    const future = await book(1, 'Court A', day, '12:00');
    const completed = await book(1, 'Court A', '2000-01-01', '13:00');
    const bobBooking = await book(2, 'Court B', day, '14:00');
    await root("insert into public.mesaje_chat(client_user_id,email_client,teren,expeditor,mesaj) values($1,'alice@example.test','Court A','client','Existing message')", [uid(1)]);
    // An existing webhook must keep its definition and enabled state, and
    // missing profile insertion must not rebuild any reservations.
    await root('select 1');
    await pg.exec(`create schema supabase_functions;
      create function supabase_functions.http_request() returns trigger
      language plpgsql security definer set search_path='' as $$
      begin
        if current_setting('spotivity.test_forbid_http',true)='on' then
          raise exception 'Migration unexpectedly invoked a reservation webhook';
        end if;
        return new;
      end $$;
      create trigger fixture_profile_email_webhook after update on public.rezervari
      for each row execute function supabase_functions.http_request('https://fixture.invalid/update');
      select set_config('spotivity.test_forbid_http','on',false)`);
    await check('backfill rejects an email already owned by another profile and rolls back schema changes', async () => {
      await historicalUser(90, ' ALICE@EXAMPLE.TEST ');
      const before = await state();
      const beforeGuard = (await root("select pg_get_functiondef('spotivity_private.guard_profile()'::regprocedure) definition")).rows[0].definition;
      await assert.rejects(() => pg.exec(migration), /Missing profile email conflicts with an existing profile/);
      await pg.exec('rollback');
      assert.deepEqual(await state(), before);
      assert.equal((await root("select pg_get_functiondef('spotivity_private.guard_profile()'::regprocedure) definition")).rows[0].definition, beforeGuard);
      assert.equal((await root('select version from spotivity_private.migrations where version=8')).rows.length, 0);
      assert.equal((await root("select policyname from pg_policies where policyname='spotivity_profiles_update_guard'")).rows.length, 0);
      await root('delete from auth.users where id=$1', [uid(90)]);
    });
    await check('backfill never reassigns an unlinked legacy same-email profile', async () => {
      await historicalUser(90, 'unlinked@example.test');
      await root("insert into public.clienti(email,nume,telefon) values(' UNLINKED@EXAMPLE.TEST ','Unlinked Legacy Contact','legacy')");
      const before = await state();
      await assert.rejects(() => pg.exec(migration), /Missing profile email conflicts with an existing profile/);
      await pg.exec('rollback');
      assert.deepEqual(await state(), before);
      assert.equal((await root("select user_id from public.clienti where lower(btrim(email))='unlinked@example.test'")).rows[0].user_id, null);
      await root("delete from public.clienti where lower(btrim(email))='unlinked@example.test'");
      await root('delete from auth.users where id=$1', [uid(90)]);
    });
    await check('backfill rejects duplicate normalized emails among missing Auth accounts', async () => {
      await historicalUser(90, 'duplicate@example.test');
      await historicalUser(91, ' DUPLICATE@EXAMPLE.TEST ');
      const before = await state();
      await assert.rejects(() => pg.exec(migration), /Missing profiles have duplicate normalized Auth emails/);
      await pg.exec('rollback');
      assert.deepEqual(await state(), before);
      await root('delete from auth.users where id=any($1::uuid[])', [[uid(90), uid(91)]]);
    });
    const originalState = await state();
    const originalTriggers = await triggers();
    const originalPolicies = await policies();
    await pg.exec(migration);
    await check('008 preserves all existing contacts, other business data, allocation, policies and trigger objects', async () => {
      const after = await state();
      for (const table of stateTables.filter(table => table !== 'public.clienti')) assert.deepEqual(after[table], originalState[table]);
      for (const original of originalState['public.clienti']) assert.deepEqual(after['public.clienti'].find(item => item.row.id === original.row.id), original);
      assert.deepEqual(await triggers(), originalTriggers);
      assert.deepEqual(await policies(), originalPolicies);
    });
    await check('historical missing profiles get UUID ownership, normalized email and existing signup metadata semantics', async () => {
      assert.equal((await profile(3)).nume, 'Historical Admin');
      assert.equal((await profile(3)).telefon, '0712345678');
      assert.equal((await profile(4)).nume, 'super');
      assert.equal((await profile(4)).telefon, '');
      const metadata = await profile(6);
      assert.equal(metadata.user_id, uid(6));
      assert.equal(metadata.email, 'historical@example.test');
      assert.equal(metadata.nume, 'N'.repeat(200));
      assert.equal(metadata.telefon, '7'.repeat(30));
      assert.equal((await root('select * from public.users_admin where user_id=$1', [uid(6)])).rows.length, 0);
    });
    await check('metadata-free historical accounts get an email-prefix name and an editable empty phone', async () => {
      assert.equal((await profile(7)).nume, 'fallback');
      assert.equal((await profile(7)).telefon, '');
      assert.equal((await profile(1)).nume, 'Alice');
      assert.equal((await profile(1)).telefon, '111');
    });
    await check('historical Auth accounts with empty or null emails are not given invented contact data', async () => {
      assert.equal(await profile(8), undefined);
      assert.equal(await profile(9), undefined);
      assert.equal((await root("select count(*)::integer total from auth.users u where email is not null and btrim(email)<>'' and not exists(select 1 from public.clienti c where c.user_id=u.id)")).rows[0].total, 0);
      assert.equal((await root('select count(*)::integer total from public.clienti')).rows[0].total, 6);
    });
    const backfilledState = await state();
    await check('008 can be repeated without rewriting data or duplicating policies', async () => {
      await pg.exec(migration);
      assert.deepEqual(await state(), backfilledState);
      assert.deepEqual(await triggers(), originalTriggers);
      assert.deepEqual((await root('select version from spotivity_private.migrations order by version')).rows.map(row => row.version), [1, 3, 4, 5, 6, 7, 8]);
      assert.equal((await root("select count(*)::integer total from pg_policies where schemaname='public' and tablename='clienti' and policyname in ('profiles_update','spotivity_profiles_update_guard')")).rows[0].total, 2);
    });
    await root("select set_config('spotivity.test_forbid_http','off',false)");
    await check('backfilled historical customers can edit their own profile after confirmation', async () => {
      const before = await profile(7);
      assert.deepEqual((await update(7, 'Historical Customer', '0712345678')).rows[0], {...before, nume: 'Historical Customer', telefon: '0712345678'});
    });

    await check('client can edit their own name and phone; values are trimmed server-side', async () => {
      const before = await profile(1);
      const changed = (await update(1, ' \tAlice Popescu \n', '  +40 (712) 345-678  ')).rows[0];
      assert.deepEqual(changed, {...before, nume: 'Alice Popescu', telefon: '+40 (712) 345-678'});
      assert.deepEqual((await root('select * from public.rezervari where id=$1', [future.id])).rows[0], future);
    });
    await check('name validation does not require replacing a legacy short phone', async () => {
      const changed = (await as('authenticated', 2, 'update public.clienti set nume=$1 where user_id=$2 returning *', ['Bob Updated', uid(2)])).rows[0];
      assert.equal(changed.nume, 'Bob Updated');
      assert.equal(changed.telefon, '222');
    });
    await check('phone validation does not require replacing a legacy empty name', async () => {
      await root('alter table public.clienti disable trigger spotivity_profile_guard');
      try { await root('update public.clienti set nume=null where user_id=$1', [uid(3)]); }
      finally { await root('alter table public.clienti enable trigger spotivity_profile_guard'); }
      const changed = (await as('authenticated', 3, 'update public.clienti set telefon=$1 where user_id=$2 returning *', ['0712345678', uid(3)])).rows[0];
      assert.equal(changed.nume, null);
      assert.equal(changed.telefon, '0712345678');
    });
    for (const [label, value] of [['null', null], ['empty', ''], ['whitespace', ' \t\n '], ['one character', 'A'], ['overlong', 'A'.repeat(201)], ['embedded control character', 'Alice\nPopescu']]) {
      await check(`${label} name is rejected without saving either field`, async () => {
        const before = await profile(1);
        await assert.rejects(() => update(1, value, '0712000000'), nameError);
        assert.deepEqual(await profile(1), before);
      });
    }
    await check('two-character and 200-character names are accepted', async () => {
      for (const value of ['Al', 'Ă'.repeat(200)]) assert.equal((await update(1, value, '0712345678')).rows[0].nume, value);
    });
    for (const [label, value] of [['null', null], ['empty', ''], ['whitespace', '   '], ['too few digits', '123456'], ['too many digits', '+1234567890123456'], ['letters', 'call 0712345678'], ['internal plus', '0712+345678'], ['duplicate plus', '++40712345678'], ['line break', '0712\n345678'], ['overlong formatting', '07' + ' '.repeat(41) + '12345678']]) {
      await check(`${label} phone is rejected atomically`, async () => {
        const before = await profile(1);
        await assert.rejects(() => update(1, 'Should not be saved', value), phoneError);
        assert.deepEqual(await profile(1), before);
      });
    }
    await check('phone accepts 7 or 15 digits, formatting and up to 50 characters', async () => {
      for (const value of ['1234567', '+123456789012345', '+40.712-345 (678)', '07' + ' '.repeat(40) + '12345678']) {
        assert.equal((await update(1, 'Alice Popescu', value)).rows[0].telefon, value);
      }
    });
    for (const person of [1, 3, 4]) {
      const label = person === 1 ? 'client' : person === 3 ? 'ordinary administrator' : 'superadministrator';
      await check(`${label} cannot change their profile email, Auth UUID or row ID directly`, async () => {
        const before = await profile(person);
        for (const sql of [
          "update public.clienti set email='unconfirmed@example.test' where user_id=$1 returning *",
          `update public.clienti set user_id='${uid(90)}' where user_id=$1 returning *`,
          `update public.clienti set id=${integerIds ? 'default' : 'gen_random_uuid()'} where user_id=$1 returning *`
        ]) await assert.rejects(() => as('authenticated', person, sql, [uid(person)]), profileError);
        assert.deepEqual(await profile(person), before);
      });
    }
    await check('another customer cannot edit a profile or see private contact details', async () => {
      const before = await profile(1);
      assert.equal((await as('authenticated', 2, 'select * from public.clienti where user_id=$1', [uid(1)])).rows.length, 0);
      assert.equal((await as('authenticated', 2, "update public.clienti set nume='Unauthorized' where user_id=$1 returning *", [uid(1)])).rows.length, 0);
      assert.deepEqual(await profile(1), before);
    });
    await check('admin customer visibility does not grant customer profile editing', async () => {
      const before = await profile(1);
      for (const person of [3, 4]) {
        assert.equal((await as('authenticated', person, 'select * from public.clienti where user_id=$1', [uid(1)])).rows.length, 1);
        assert.equal((await as('authenticated', person, "update public.clienti set nume='Unauthorized admin edit' where user_id=$1 returning *", [uid(1)])).rows.length, 0);
      }
      assert.deepEqual(await profile(1), before);
    });
    await check('administrators can still edit their own profile contact fields', async () => {
      for (const person of [3, 4]) assert.equal((await update(person, `Admin ${person}`, '0712345678')).rows[0].user_id, uid(person));
    });
    await check('missing Auth subject and spoofed email claims never grant profile updates', async () => {
      const before = await profile(1);
      assert.equal((await as('authenticated', null, "update public.clienti set nume='No subject' where user_id=$1 returning *", [uid(1)])).rows.length, 0);
      await as('authenticated', 2, "select set_config('request.jwt.claim.email','alice@example.test',false)");
      assert.equal((await as('authenticated', 2, "update public.clienti set nume='Forged email' where user_id=$1 returning *", [uid(1)])).rows.length, 0);
      assert.deepEqual(await profile(1), before);
    });
    await check('a permissive legacy UPDATE policy cannot reopen cross-user editing', async () => {
      await root('create policy fixture_allow_all_profile_updates on public.clienti for update to authenticated using(true) with check(true)');
      try {
        for (const person of [3, 4]) assert.equal((await as('authenticated', person, "update public.clienti set nume='Unsafe policy edit' where user_id=$1 returning *", [uid(1)])).rows.length, 0);
        assert.equal((await as('authenticated', null, "update public.clienti set nume='Missing identity' returning *")).rows.length, 0);
      } finally { await root('drop policy fixture_allow_all_profile_updates on public.clienti'); }
    });
    await check('anonymous requests cannot read or edit profiles', async () => {
      await assert.rejects(() => as('anon', null, 'select * from public.clienti'), /permission denied/);
      await assert.rejects(() => as('anon', null, "update public.clienti set nume='Anonymous'"), /permission denied/);
    });
    await check('clients cannot insert a replacement profile or update Auth directly', async () => {
      await assert.rejects(() => as('authenticated', 1, "insert into public.clienti(user_id,email,nume,telefon) values($1,'fake@example.test','Fake User','0712345678')", [uid(90)]));
      await assert.rejects(() => as('authenticated', 1, "update auth.users set email='fake@example.test' where id=$1", [uid(1)]), /permission denied/);
    });
    await check('trigger validation remains active for an Auth subject even with service table privileges', async () => {
      await assert.rejects(() => as('service_role', 4, "update public.clienti set nume='Other customer' where user_id=$1", [uid(1)]), profileError);
    });
    await check('private profile trigger is not executable by browser or service roles', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await root("select has_function_privilege($1,'spotivity_private.guard_profile()','execute') allowed", [role])).rows[0].allowed, false);
    });
    await check('Auth still creates profiles and only superadmins retain existing insert/delete rights', async () => {
      await root("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'temporary@example.test',now(),$2::jsonb)", [uid(5), JSON.stringify({nume: 'Temporary User', telefon: '0712345678', is_super: true})]);
      assert.equal((await profile(5)).nume, 'Temporary User');
      assert.equal((await root('select * from public.users_admin where user_id=$1', [uid(5)])).rows.length, 0);
      assert.equal((await as('authenticated', 5, 'delete from public.clienti where user_id=$1 returning user_id', [uid(5)])).rows.length, 0);
      assert.equal((await as('authenticated', 4, 'delete from public.clienti where user_id=$1 returning user_id', [uid(5)])).rows.length, 1);
      assert.equal((await as('authenticated', 4, "insert into public.clienti(user_id,email,nume,telefon) values($1,'temporary@example.test','Temporary User','0712345678') returning user_id", [uid(5)])).rows[0].user_id, uid(5));
      assert.equal((await as('authenticated', 4, 'delete from public.clienti where user_id=$1 returning user_id', [uid(5)])).rows.length, 1);
      await root('delete from auth.users where id=$1', [uid(5)]);
    });

    await check('requesting a new email does not change profile, bookings, chat or permissions', async () => {
      const before = await state();
      await root("update auth.users set email_change='alice-new@example.test',email_change_confirm_status=0 where id=$1", [uid(1)]);
      const after = await state();
      for (const table of stateTables.filter(table => table !== 'auth.users')) assert.deepEqual(after[table], before[table]);
      assert.equal((await profile(1)).email, 'alice@example.test');
    });
    await check('one email-change confirmation still leaves the current contact email in use', async () => {
      await root('update auth.users set email_change_confirm_status=1 where id=$1', [uid(1)]);
      assert.equal((await profile(1)).email, 'alice@example.test');
      assert.equal((await as('authenticated', 1, 'select id from public.rezervari')).rows.length, 3);
    });
    await check('confirmed Auth email changes sync all owned contact rows while keeping UUIDs and bookings', async () => {
      const beforeProfile = await profile(1);
      const beforeBookings = (await root('select * from public.rezervari where client_user_id=$1 order by id', [uid(1)])).rows;
      const beforeChat = (await root('select * from public.mesaje_chat where client_user_id=$1 order by id', [uid(1)])).rows;
      // Model the final GoTrue update only after both confirmation links. Real
      // SMTP and token confirmation must be verified separately on Supabase.
      await root("update auth.users set email='alice-new@example.test',email_change='',email_change_confirm_status=0 where id=$1", [uid(1)]);
      assert.deepEqual(await profile(1), {...beforeProfile, email: 'alice-new@example.test'});
      assert.deepEqual((await root('select * from public.rezervari where client_user_id=$1 order by id', [uid(1)])).rows, beforeBookings.map(row => ({...row, email_client: 'alice-new@example.test'})));
      assert.deepEqual((await root('select * from public.mesaje_chat where client_user_id=$1 order by id', [uid(1)])).rows, beforeChat.map(row => ({...row, email_client: 'alice-new@example.test'})));
      assert.equal((await as('authenticated', 1, 'select id from public.rezervari')).rows.length, beforeBookings.length);
      assert.equal((await as('authenticated', 2, 'select id from public.rezervari')).rows.length, 1);
      assert.deepEqual((await root('select * from public.rezervari where id=$1', [bobBooking.id])).rows[0], bobBooking);
    });
    await check('confirmed administrator email change preserves role, allocated courts and base permission', async () => {
      const beforeRole = (await root('select * from public.users_admin where user_id=$1', [uid(3)])).rows[0];
      const beforeGrant = (await root('select * from public.baze_sportive_admini where user_id=$1', [uid(3)])).rows;
      await root("update auth.users set email='admin-new@example.test' where id=$1", [uid(3)]);
      assert.deepEqual((await as('authenticated', 3, 'select * from public.users_admin')).rows[0], {...beforeRole, email: 'admin-new@example.test'});
      assert.deepEqual((await as('authenticated', 3, 'select * from public.baze_sportive_admini')).rows, beforeGrant);
      assert.equal((await as('authenticated', 3, "update public.baze_sportive set descriere='Still allowed' where id=$1 returning id", [base.id])).rows.length, 1);
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=pret where nume='Court A' returning id")).rows.length, 1);
      assert.equal((await as('authenticated', 3, "update public.terenuri set pret=pret where nume='Court B' returning id")).rows.length, 0);
    });
    await check('email sync does not validate unrelated legacy name and phone values', async () => {
      await root('alter table public.clienti disable trigger spotivity_profile_guard');
      try { await root("update public.clienti set nume=null,telefon='legacy' where user_id=$1", [uid(2)]); }
      finally { await root('alter table public.clienti enable trigger spotivity_profile_guard'); }
      const before = await profile(2);
      await root("update auth.users set email='bob-new@example.test' where id=$1", [uid(2)]);
      assert.deepEqual(await profile(2), {...before, email: 'bob-new@example.test'});
    });
    await check('email sync works with an authenticated subject on the trusted nested Auth trigger', async () => {
      await as('postgres', 1, "update auth.users set email='alice-confirmed@example.test' where id=$1", [uid(1)]);
      assert.equal((await profile(1)).email, 'alice-confirmed@example.test');
      assert.equal((await root('select email_client from public.rezervari where id=$1', [completed.id])).rows[0].email_client, 'alice-confirmed@example.test');
    });
    await check('profile and confirmed email editing keep completed cancellation forbidden for all roles', async () => {
      for (const person of [1, 3, 4]) {
        await assert.rejects(() => as('authenticated', person, "update public.rezervari set stare='anulata' where id=$1", [completed.id]), /Completed bookings cannot be cancelled/);
      }
      assert.equal((await root('select stare from public.rezervari where id=$1', [completed.id])).rows[0].stare, 'activa');
      assert.equal((await as('anon', null, 'select id from public.rezervari_disponibilitate where id=$1', [String(completed.id)])).rows.length, 1);
    });
    await check('future reservation cancellation still works after a confirmed email change', async () => {
      const cancelled = (await as('authenticated', 1, "update public.rezervari set stare='anulata' where id=$1 returning *", [future.id])).rows[0];
      assert.equal(cancelled.stare, 'anulata');
      assert.equal(cancelled.client_user_id, uid(1));
      assert.equal(cancelled.email_client, 'alice-confirmed@example.test');
      assert.equal((await as('anon', null, 'select id from public.rezervari_disponibilitate where id=$1', [String(future.id)])).rows.length, 0);
    });
    await check('008 rerun after contact edits preserves the final rows and unrelated permissions', async () => {
      const before = await state();
      const original = await triggers();
      await root("select set_config('spotivity.test_forbid_http','on',false)");
      await pg.exec(migration);
      assert.deepEqual(await state(), before);
      assert.deepEqual(await triggers(), original);
    });
    console.log(`\n${passed} profile editing checks passed (${integerIds ? 'numeric' : 'UUID'} IDs).`);
  } finally { await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
