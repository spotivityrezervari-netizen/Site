// Disposable PostgreSQL/Auth-shaped fixture. Never run against hosted accounts.
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
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
    const phone = person => root('select telefon from public.clienti where user_id=$1', [uid(person)]).then(r => r.rows[0]?.telefon);
    const user = async (person, metadata = {}) => root('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)', [uid(person), `contact${person}@example.test`, metadata]);
    const request = async (number, person, phone, email = `contact${person}@example.test`, date = '2026-10-17T12:00:00Z') => root(`
      insert into public.cereri_baze_sportive(id,solicitant_user_id,nume_baza,nume_contact,email,telefon,oras,link_maps,terenuri,created_at)
      values($1,$2,'Contact Base','Contact Person',$3,$4,'Test City','https://maps.app.goo.gl/Abc123','[{"nume":"New Court","sport":"Fotbal"}]',$5)`, [uid(number), uid(person), email, phone, date]);
    const tables = ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','storage.buckets','storage.objects'];
    const snapshot = async () => {
      const state = {};
      for (const table of tables) state[table] = (await root(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows.map(r => r.value);
      return state;
    };
    const policies = () => root('select * from pg_policies order by schemaname,tablename,policyname').then(r => r.rows);
    const triggers = () => root('select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid').then(r => r.rows);
    await check('015 rejects a schema missing its security prerequisites', async () => {
      await assert.rejects(() => pg.exec(file('015_profile_contact.sql')), /Apply migrations/);
      await pg.exec('rollback');
    });
    for (const migration of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql']) await pg.exec(file(migration));
    for (const n of [21,22,23,24,25,26,27,28]) await user(n);
    await root('update auth.users set raw_user_meta_data=$2 where id=$1', [uid(21), {nume:'Metadata Name',telefon:'  +40 721 111 111  ',is_super:true}]);
    await root("update public.clienti set telefon='0722222222' where user_id=$1", [uid(22)]);
    await root('update auth.users set raw_user_meta_data=$2 where id=$1', [uid(22), {telefon:'0733333333'}]);
    await root('update auth.users set raw_user_meta_data=$2 where id=$1', [uid(24), {telefon:'0744444444'}]);
    await root('update auth.users set raw_user_meta_data=$2 where id=$1', [uid(25), {telefon:'<script>invalid</script>'}]);
    await root('alter table public.clienti disable trigger spotivity_profile_guard');
    try { await root("update public.clienti set telefon='-' where user_id=$1", [uid(28)]); }
    finally { await root('alter table public.clienti enable trigger spotivity_profile_guard'); }
    await request(201,22,'0755555555');
    await request(202,23,'0766666666','contact23@example.test','2026-10-16T12:00:00Z');
    await request(203,23,'0777777777');
    await request(204,24,'0788888888');
    await request(205,26,'0799999999','other@example.test');
    await request(206,27,'0712121212','contact26@example.test');
    await request(207,28,'0734343434');
    const original = await snapshot(), beforePolicies = await policies(), beforeTriggers = await triggers();
    await pg.exec(file('015_profile_contact.sql'));
    await check('015 fills only missing phones using valid own metadata or the latest exact-owner application', async () => {
      assert.equal(await phone(21), '+40 721 111 111');
      assert.equal(await phone(23), '0777777777');
      assert.equal(await phone(24), '0744444444');
      assert.equal(await phone(28), '0734343434');
      assert.equal(await phone(22), '0722222222');
      for (const n of [25,26,27]) assert.equal(await phone(n), '');
    });
    await check('backfill preserves every other contact field, business row, Auth identity, role, RLS policy and existing trigger', async () => {
      const after = await snapshot();
      for (const table of tables.filter(t => t !== 'public.clienti')) assert.deepEqual(after[table], original[table], table);
      for (const old of original['public.clienti']) {
        const changed = after['public.clienti'].find(row => row.id === old.id);
        assert.deepEqual({...changed,telefon:old.telefon}, old);
        if (![21,23,24,28].map(uid).includes(old.user_id)) assert.deepEqual(changed, old);
      }
      assert.deepEqual(await policies(), beforePolicies);
      const afterTriggers = await triggers();
      for (const trigger of beforeTriggers) assert.deepEqual(afterTriggers.find(t => t.oid === trigger.oid), trigger);
    });
    await check('015 repeats without rewriting contacts or duplicating the request trigger', async () => {
      const before = await snapshot();
      await pg.exec(file('015_profile_contact.sql'));
      assert.deepEqual(await snapshot(), before);
      assert.equal((await root("select count(*)::int total from pg_trigger where tgname='spotivity_club_request_contact' and not tgisinternal")).rows[0].total, 1);
    });
    await check('new normal Auth signups retain validated phone formatting up to 50 characters without granting admin', async () => {
      const value = '+40' + ' '.repeat(35) + '721234567';
      await user(31, {nume:' New Owner ',telefon:`  ${value}  `,is_super:true});
      assert.equal(await phone(31), value);
      assert.equal((await root('select nume from public.clienti where user_id=$1', [uid(31)])).rows[0].nume, 'New Owner');
      assert.equal((await root('select count(*)::int total from public.users_admin where user_id=$1', [uid(31)])).rows[0].total, 0);
      for (const [person,value] of [[32,'123'],[33,'<script>0712345678</script>'],[34,'+4071234567890123456'],[35,'0712\n345678']]) { await user(person,{telefon:value}); assert.equal(await phone(person), ''); }
    });
    await check('future existing-account application fills only its missing phone and creates no role or public base', async () => {
      await user(36);
      const before = await snapshot();
      await as('service_role', null, `select public.submit_club_application($1,$2,'Future Base','Future Contact',$3,'+40 721 345 678','Test City',null,'https://maps.app.goo.gl/Abc123','[{"nume":"Future Court","sport":"Fotbal"}]',null,null,'[100]')`, [uid(36),uid(301),'contact36@example.test']);
      assert.equal(await phone(36), '+40 721 345 678');
      const after = await snapshot();
      for (const table of ['public.users_admin','public.baze_sportive','public.baze_sportive_admini','public.terenuri']) assert.deepEqual(after[table], before[table]);
      await request(302,36,'+40 722 000 000');
      assert.equal(await phone(36), '+40 721 345 678');
    });
    await check('future mismatched-email application cannot fill someone else\'s blank contact', async () => {
      await user(37);
      await request(303,37,'0736363636','contact36@example.test');
      assert.equal(await phone(37), '');
    });
    await check('contact recovery functions cannot be invoked as client or service RPCs', async () => {
      for (const role of ['anon','authenticated','service_role']) for (const fn of ['spotivity_private.create_profile()','spotivity_private.fill_missing_applicant_phone()']) {
        assert.equal((await root('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn])).rows[0].allowed, false);
      }
      assert.equal((await as('authenticated',36,'select telefon from public.clienti where user_id=$1',[uid(36)])).rows[0].telefon, '+40 721 345 678');
      assert.equal((await as('authenticated',37,'select telefon from public.clienti where user_id=$1',[uid(36)])).rows.length, 0);
    });
    console.log(`Passed ${passed} profile-contact checks (${integerIds ? 'integer' : 'UUID'} IDs).`);
  } finally { await pg.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
