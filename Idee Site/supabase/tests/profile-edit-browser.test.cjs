// Real pinned Supabase SDK + Chromium + disposable PostgreSQL/RLS fixture.
// All requests to the hosted Supabase project are intercepted. No hosted writes.
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const {readFileSync, mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const {createBookingWorkflowFixture} = require('./booking-workflow-fixture.cjs');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8002/';
const screenshotDir = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, {recursive: true});
const tokens = new Map();
const token = person => {
  const payload = Buffer.from(JSON.stringify({sub: uid(person), exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated'})).toString('base64url');
  const signature = Buffer.from(`fixture-${person}`).toString('base64url');
  const value = `eyJhbGciOiJIUzI1NiJ9.${payload}.${signature}`;
  tokens.set(value, person); return value;
};
const ident = value => { assert.match(value, /^[a-zA-Z_][a-zA-Z0-9_]*$/); return `"${value}"`; };
let checks = 0;

async function openProfile(page) {
  if (await page.locator('#modal-profil').isVisible()) return;
  if (await page.locator('#base-admin-workspace').isVisible()) {
    await page.locator('#btn-inchide-administrare').click();
    await page.locator('#base-admin-workspace').waitFor({state: 'hidden'});
  }
  assert.equal(await page.locator('#owner-home').isVisible(),false,'Facility administrators use the management menu instead of a profile entry');
  const profile = page.locator('#btn-top-cont');
  if (await profile.isVisible()) {
    await profile.click();
    return;
  }
  const menu = page.locator('#home-mobile-menu');
  if (!await menu.isVisible()) await page.locator('#btn-mobile-menu').click();
  await menu.locator('[data-profile-target]').click();
}

(async () => {
  const pg = new PGlite();
  let browser;
  try {
    await pg.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
    for (const file of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql',
      '005_sport_appearance.sql', '006_sports_bases.sql', '007_completed_booking_cancellation.sql', '008_profile_edit.sql', '009_base_photos.sql', '010_foot_tennis.sql', '011_club_requests.sql', '012_club_approval.sql', '013_admin_integration.sql', '014_booking_groups.sql', '015_profile_contact.sql', '016_notification_outbox.sql', '017_base_avatars.sql']) {
      await pg.exec(readFileSync(join(__dirname, '..', file), 'utf8'));
    }
    await pg.exec("alter table auth.users add column new_email text; update public.terenuri set poza='assets/imagini/avatar2.png'");
    let queue = Promise.resolve();
    const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
    const asOwner = fn => serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      return fn();
    });
    const requests = [], errors = [];
    const bookingWorkflow = await createBookingWorkflowFixture({pg, host,
      resolveUser: bearer => {const person = tokens.get(bearer); return person ? uid(person) : null;}, records: requests});
    let rejectProfile = false, rejectProfileRead = false, rejectEmail = false, gate = null;
    const pauseNext = (path, method) => {
      let enter, release, timeout;
      const entered = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Expected ${method} ${path} did not reach the fixture gate`)), 10000);
        enter = () => { clearTimeout(timeout); resolve(); };
      });
      const wait = new Promise(resolve => release = resolve);
      gate = {path, method, enter, wait};
      return {entered, release};
    };
    const authUser = user => ({...user, aud: 'authenticated', role: 'authenticated',
      app_metadata: {provider: 'email', providers: ['email']}, user_metadata: user.raw_user_meta_data, identities: []});
    const api = async route => {
      const request = route.request(), url = new URL(request.url());
      const person = tokens.get((request.headers().authorization || '').replace(/^Bearer /, ''));
      const recorded = {path: url.pathname, method: request.method(), person, search: url.search};
      if (request.postData()) recorded.body = request.postDataJSON();
      requests.push(recorded);
      if (gate && url.pathname === gate.path && request.method() === gate.method) {
        const pending = gate; gate = null; pending.enter(); await pending.wait;
      }
      return serial(async () => {
        const reply = (status, data) => {
          recorded.response = {status, code: data?.code};
          return request.failure() ? Promise.resolve() : route.fulfill({status, contentType: 'application/json',
            headers: {'x-supabase-api-version': '2024-01-01', 'access-control-allow-origin': '*',
              'access-control-expose-headers': 'X-Supabase-Api-Version'}, body: data === undefined ? '' : JSON.stringify(data)});
        };
        try {
          if (url.pathname === '/functions/v1/booking-workflow') return bookingWorkflow.browserRoute(route);
          await pg.exec('reset role');
          await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [person ? uid(person) : '']);
          if (url.pathname.startsWith('/auth/v1/')) {
            if (url.pathname.endsWith('/logout')) return reply(204);
            if (url.pathname.endsWith('/token')) {
              const n = recorded.body.email === 'bob@example.test' ? 2 : 1;
              const user = (await pg.query('select * from auth.users where id=$1', [uid(n)])).rows[0];
              assert.equal(recorded.body.password, 'fixture-password');
              return reply(200, {access_token: token(n), refresh_token: `fixture-refresh-${n}`,
                token_type: 'bearer', expires_in: 3600, user: authUser(user)});
            }
            if (url.pathname.endsWith('/user') && person) {
              if (request.method() === 'PUT') {
                const email = recorded.body.email;
                assert.ok(Object.keys(recorded.body).every(key => ['email', 'code_challenge', 'code_challenge_method'].includes(key)),
                  'Profile editing must not modify passwords, roles or Auth metadata');
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(422, {code: 'validation_failed', message: 'Invalid email address'});
                const duplicate = (await pg.query('select 1 from auth.users where email=$1 and id<>$2', [email, uid(person)])).rows.length;
                if (duplicate) return reply(422, {code: 'email_exists', message: 'Email address already registered'});
                if (rejectEmail) return reply(429, {code: 'over_email_send_rate_limit', message: 'Email confirmation could not be sent; retry later'});
                // Secure email change only records a proposal. The fixture's
                // explicit confirmation below is the sole change of identity.
                await pg.query('update auth.users set new_email=$1 where id=$2', [email, uid(person)]);
              }
              const user = (await pg.query('select * from auth.users where id=$1', [uid(person)])).rows[0];
              return reply(200, authUser(user));
            }
            return reply(401, {message: 'No fixture session'});
          }
          if (url.pathname === '/rest/v1/rpc/get_admin_access') {
            assert.equal(request.method(), 'POST');
            await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
            return reply(200, (await pg.query('select public.get_admin_access() value')).rows[0].value);
          }
          const table = url.pathname.split('/').pop();
          assert.ok(['clienti', 'users_admin', 'terenuri', 'rezervari', 'rezervari_disponibilitate',
            'mesaje_chat', 'site_sporturi', 'baze_sportive', 'baze_sportive_admini', 'cereri_baze_sportive'].includes(table));
          if (rejectProfileRead && table === 'clienti' && request.method() === 'GET') return reply(503, {code: 'FIXTURE_UNAVAILABLE', message: 'Fixture profile refresh unavailable'});
          if (rejectProfile && table === 'clienti' && request.method() === 'PATCH') return reply(403, {code: '42501', message: 'Fixture rejected the profile update'});
          await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
          const params = [], conditions = [];
          for (const [field, value] of url.searchParams) {
            if (['select', 'order', 'limit', 'offset', 'columns'].includes(field)) continue;
            if (value === 'is.null' || value === 'not.is.null') {
              conditions.push(`${ident(field)} is ${value === 'not.is.null' ? 'not ' : ''}null`);
            } else if (value.startsWith('in.(')) {
              const values = value.slice(4, -1).split(',').map(v => v.replace(/^"|"$/g, ''));
              conditions.push(`${ident(field)} in (${values.map(v => { params.push(v); return `$${params.length}`; }).join(',')})`);
            } else {
              const match = value.match(/^(eq|neq|ilike|gt|gte|lt|lte)\.(.*)$/s); assert.ok(match, value);
              const booleanField = ['is_super', 'este_activ', 'este_activa', 'are_chat', 'optiune_minge', 'citit'].includes(field);
              params.push(booleanField && ['true', 'false'].includes(match[2]) ? match[2] === 'true' : match[2]);
              conditions.push(`${ident(field)} ${{eq: '=', neq: '<>', ilike: 'ilike', gt: '>', gte: '>=', lt: '<', lte: '<='}[match[1]]} $${params.length}`);
            }
          }
          const where = conditions.length ? ' where ' + conditions.join(' and ') : '';
        if (request.method() === 'HEAD') {
          const total = Number((await pg.query(`select count(*) total from public.${ident(table)}${where}`, params)).rows[0].total);
          return route.fulfill({status: 200, headers: {'content-range': `*/${total}`, 'access-control-expose-headers': 'content-range'}, body: ''});
        }
          let query;
          if (request.method() === 'GET') {
            const columns = (url.searchParams.get('select') || '*').split(',').map(c => c === '*' ? '*' : ident(c)).join(',');
            query = `select ${columns} from public.${ident(table)}${where}`;
            if (url.searchParams.has('order')) query += ' order by ' + url.searchParams.get('order').split(',').map(o => {
              const [col, direction] = o.split('.'); return ident(col) + (direction === 'desc' ? ' desc' : ' asc');
            }).join(',');
            if (url.searchParams.has('limit')) { params.push(Number(url.searchParams.get('limit'))); query += ` limit $${params.length}`; }
            if (url.searchParams.has('offset')) { params.push(Number(url.searchParams.get('offset'))); query += ` offset $${params.length}`; }
          } else if (request.method() === 'PATCH') {
            const sets = Object.entries(recorded.body).map(([field, value]) => { params.push(value); return `${ident(field)}=$${params.length}`; });
            query = `update public.${ident(table)} set ${sets.join(',')}${where} returning *`;
          } else return reply(405, {message: 'Unexpected fixture mutation'});
          const result = await pg.query(query, params);
          const single = (request.headers().accept || '').includes('vnd.pgrst.object');
          if (single && result.rows.length !== 1) return reply(406, {code: 'PGRST116', message: 'Expected exactly one row'});
          return reply(200, single ? result.rows[0] : result.rows);
        } catch (error) { return reply(403, {code: error.code || 'FIXTURE', message: error.message}); }
      });
    };
    const launch = {executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true};
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxy) launch.proxy = {server: new URL(proxy).origin, bypass: '127.0.0.1,localhost'};
    browser = await chromium.launch(launch);
    const context = await browser.newContext({timezoneId: 'Europe/Bucharest'});
    // Chromium may not inherit the machine's managed HTTPS trust/proxy
    // configuration. Curl validates TLS using that configuration; independently
    // verify the exact pinned SRI before serving identical bytes to Chromium,
    // which still enforces the unchanged integrity attribute in the real page.
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
    const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    assert.ok(sdkTag, 'The application must pin Supabase SDK with SRI');
    const sdk = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
    assert.equal('sha384-' + createHash('sha384').update(sdk).digest('base64'), sdkTag[2], 'Downloaded SDK must match application SRI');
    await context.route(sdkTag[1], route => route.fulfill({status: 200, contentType: 'application/javascript', body: sdk,
      headers: {'access-control-allow-origin': '*'}}));
    await context.route(url => url.hostname === host, api);
    await context.routeWebSocket(url => url.hostname === host, ws => ws.close());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base, {waitUntil: 'networkidle'});
    assert.equal(await page.evaluate(() => typeof window.supabase?.createClient), 'function', 'The real pinned SDK must load with TLS/SRI verification');
    await page.waitForFunction(() => typeof window.getSpotivityProfileUser === 'function');
    const pass = label => { checks++; console.log('PASS', label); };
    const writes = () => requests.filter(r => (r.path === '/rest/v1/clienti' && r.method === 'PATCH') || (r.path === '/auth/v1/user' && r.method === 'PUT'));
    const ownProfile = n => asOwner(async () => (await pg.query('select nume,telefon,email from public.clienti where user_id=$1', [uid(n)])).rows[0]);
    const login = async email => {
      await page.evaluate(async email => {
        const {error} = await db.auth.signInWithPassword({email, password: 'fixture-password'});
        if (error) throw error;
      }, email);
      await page.waitForFunction(email => window.getSpotivityProfileUser()?.email === email, email);
    };
    const openEditor = async () => {
      if (await page.locator('#modal-editare-profil').isVisible()) await page.locator('#inchide-editare-profil').click();
      if (!await page.locator('#modal-profil').isVisible()) await openProfile(page);
      await page.locator('#btn-editeaza-profil').click();
      await page.locator('#profil-edit-fields').waitFor({state: 'visible'});
      await page.waitForFunction(() => !document.getElementById('btn-profil-continua').disabled);
    };
    const fill = async ({name, phone, email}) => {
      if (name !== undefined) {
        await page.locator('#profil-edit-nume').fill(name);
        // Maxlength prevents typing oversized names, but runtime validation
        // must also reject a value supplied by an extension or script.
        if (name.length > 200) await page.locator('#profil-edit-nume').evaluate((input, value) => input.value = value, name);
      }
      if (phone !== undefined) await page.locator('#profil-edit-telefon').fill(phone);
      if (email !== undefined) await page.locator('#profil-edit-email').fill(email);
    };
    const review = async values => {
      await openEditor(); await fill(values);
      await page.locator('#btn-profil-continua').click();
      await page.locator('#profil-edit-review').waitFor({state: 'visible'});
    };
    const waitSettled = async () => {
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(() => !document.getElementById('btn-profil-confirma').disabled);
    };

    await login('alice@example.test');
    const beforePhoneFallback = writes().length;
    const fixtureContact = async (phone, metadata) => asOwner(async () => {
      await pg.exec('alter table public.clienti disable trigger spotivity_profile_guard');
      try {
        await pg.query('update public.clienti set telefon=$1 where user_id=$2', [phone, uid(1)]);
        await pg.query('update auth.users set raw_user_meta_data=$1 where id=$2', [metadata, uid(1)]);
      } finally { await pg.exec('alter table public.clienti enable trigger spotivity_profile_guard'); }
    });
    await fixtureContact('', {telefon: '+40 721 555 666'});
    await page.evaluate(() => window.refreshSpotivityProfile());
    await openProfile(page);
    assert.equal(await page.locator('#profil-telefon').innerText(), '+40 721 555 666');
    assert.equal((await ownProfile(1)).telefon, '');
    assert.equal(writes().length, beforePhoneFallback);
    pass('My Account shows a validated phone from its own Auth metadata when the contact row is blank without writing on read');

    await fixtureContact('+40 722 111 222', {telefon: '+40 721 555 666'});
    await page.evaluate(() => window.refreshSpotivityProfile());
    assert.equal(await page.locator('#profil-telefon').innerText(), '+40 722 111 222');
    await fixtureContact('-', {telefon: '<script>0712345678</script>'});
    await page.evaluate(() => window.refreshSpotivityProfile());
    assert.equal(await page.locator('#profil-telefon').innerText(), '-');
    assert.equal(writes().length, beforePhoneFallback);
    await fixtureContact('111', {});
    await page.evaluate(() => window.refreshSpotivityProfile());
    pass('saved phone edits take precedence over stale metadata and invalid metadata never appears in the account');

    await review({email: 'legacy-pending@example.test'});
    const beforeLegacy = writes().length;
    await page.locator('#btn-profil-confirma').click(); await waitSettled();
    assert.equal(writes().length, beforeLegacy + 1);
    assert.equal(writes().at(-1).path, '/auth/v1/user');
    assert.equal((await ownProfile(1)).telefon, '111');
    assert.equal((await ownProfile(1)).email, 'alice@example.test');
    pass('email-only editing tolerates unchanged legacy contact fields without rewriting them');

    await page.locator('#inchide-editare-profil').click();
    rejectProfileRead = true;
    const beforeRefreshFailure = writes().length;
    await page.locator('#btn-editeaza-profil').click();
    await page.waitForFunction(() => document.getElementById('profil-edit-status').dataset.kind === 'error');
    assert.equal(await page.locator('#btn-profil-continua').isDisabled(), true);
    await page.evaluate(() => document.getElementById('profil-edit-form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
    assert.equal(writes().length, beforeRefreshFailure);
    assert.equal(await page.locator('#profil-edit-review').isVisible(), false);
    await page.locator('#btn-profil-anuleaza').click();
    rejectProfileRead = false;
    pass('an unavailable authoritative profile disables review and prevents Enter from saving stale details');

    await openEditor();
    assert.equal(await page.locator('#profil-edit-nume').inputValue(), 'Alice');
    assert.equal(await page.locator('#profil-edit-email').inputValue(), 'alice@example.test');
    const initialWrites = writes().length;
    await fill({name: 'Alice Actualizată', phone: '+40 721 234 567'});
    await page.locator('#btn-profil-continua').click();
    await page.locator('#profil-edit-review').waitFor({state: 'visible'});
    assert.match(await page.locator('#profil-edit-summary').innerText(), /Alice Actualizată/);
    assert.equal(writes().length, initialWrites);
    await page.locator('#btn-profil-inapoi').click();
    assert.equal(await page.locator('#profil-edit-nume').inputValue(), 'Alice Actualizată');
    await page.locator('#btn-profil-anuleaza').click();
    assert.equal(writes().length, initialWrites);
    assert.equal((await ownProfile(1)).nume, 'Alice');
    pass('editing, reviewing, going back and cancelling never write before explicit confirmation');

    await review({name: 'Alice Actualizată', phone: '+40 721 234 567'});
    await page.locator('#btn-profil-confirma').click();
    await page.waitForFunction(() => window.getSpotivityProfileUser()?.nume === 'Alice Actualizată');
    assert.deepEqual(await ownProfile(1), {nume: 'Alice Actualizată', telefon: '+40 721 234 567', email: 'alice@example.test'});
    assert.equal(await page.locator('#profil-nume').innerText(), 'Alice Actualizată');
    assert.equal(await page.locator('#profil-telefon').innerText(), '+40 721 234 567');
    assert.equal(writes().length, initialWrites + 1);
    assert.equal(writes().at(-1).person, 1);
    assert.equal(new URLSearchParams(writes().at(-1).search).get('user_id'), `eq.${uid(1)}`);
    assert.deepEqual(writes().at(-1).body, {nume: 'Alice Actualizată', telefon: '+40 721 234 567'});
    assert.deepEqual(await ownProfile(2), {nume: 'Bob', telefon: '222', email: 'bob@example.test'});
    pass('confirmed name and phone persist through real SDK/RLS and refresh the profile without changing another user');

    for (const values of [{name: 'A'}, {name: 'A'.repeat(201)}, {phone: '123'}, {phone: '+40 721<script>'}, {email: 'invalid-address'}]) {
      await openEditor(); await fill(values);
      const before = writes().length;
      await page.locator('#btn-profil-continua').click();
      assert.equal(await page.locator('#profil-edit-review').isVisible(), false, `Invalid ${Object.keys(values)[0]} reached confirmation`);
      assert.equal(writes().length, before);
    }
    pass('invalid names, phones and email cannot reach confirmation or the API');

    rejectProfile = true;
    await review({name: 'Rejected Name'});
    await page.locator('#btn-profil-confirma').click(); await waitSettled();
    assert.equal((await ownProfile(1)).nume, 'Alice Actualizată');
    assert.equal(await page.locator('#profil-nume').innerText(), 'Alice Actualizată');
    assert.match(await page.locator('#profil-edit-status').innerText(), /rejected|eșuat|salv|eroare|nu/i);
    rejectProfile = false;
    pass('a rejected database update leaves the authoritative profile unchanged and reports failure');

    await review({email: 'bob@example.test'});
    const beforeDuplicate = writes().length;
    await page.locator('#btn-profil-confirma').click(); await waitSettled();
    assert.equal(writes().length, beforeDuplicate + 1);
    assert.equal(writes().at(-1).path, '/auth/v1/user');
    assert.equal((await ownProfile(1)).email, 'alice@example.test');
    assert.equal(await page.locator('#profil-email').innerText(), 'alice@example.test');
    assert.match(await page.locator('#profil-edit-status').innerText(), /deja folosită|already.*used/i);
    pass('a duplicate Auth email is rejected without claiming the email was changed');

    rejectEmail = true;
    await review({name: 'Alice Salvată', email: 'partial@example.test'});
    const beforePartial = writes().length;
    await page.locator('#btn-profil-confirma').click(); await waitSettled();
    assert.equal(writes().length, beforePartial + 2);
    assert.equal((await ownProfile(1)).nume, 'Alice Salvată');
    assert.equal((await ownProfile(1)).email, 'alice@example.test');
    const partialStatus = await page.locator('#profil-edit-status').innerText();
    assert.match(partialStatus, /salvat/i);
    assert.match(partialStatus, /email|mail/i);
    assert.match(partialStatus, /nu|eșuat|eroare|așteaptă|încerci|could not/i);
    rejectEmail = false;
    pass('partial success distinguishes saved contact details from a failed email confirmation request');

    await review({email: 'confirmed-next@example.test'});
    const beforeEmail = writes().length;
    await page.locator('#btn-profil-confirma').click(); await waitSettled();
    assert.equal(writes().length, beforeEmail + 1, JSON.stringify({status: await page.locator('#profil-edit-status').innerText(),
      recent: requests.slice(-12).map(({path, method, person}) => ({path, method, person}))}));
    assert.equal(writes().at(-1).path, '/auth/v1/user');
    assert.equal(writes().at(-1).person, 1);
    const redirect = new URLSearchParams(writes().at(-1).search).get('redirect_to');
    assert.equal(redirect, new URL('./', base).href, 'Email verification must return to the directory containing the app');
    assert.equal((await ownProfile(1)).email, 'alice@example.test');
    assert.equal(await page.locator('#profil-email').innerText(), 'alice@example.test');
    assert.match(await page.locator('#profil-email-pending').innerText(), /confirmed-next@example\.test/);
    assert.match(await page.locator('#profil-email-pending').innerText(), /confirm/i);
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForFunction(() => window.getSpotivityProfileUser()?.newEmail === 'confirmed-next@example.test');
    await openProfile(page);
    assert.match(await page.locator('#profil-email-pending').innerText(), /confirmed-next@example\.test/);
    pass('email uses Auth, remains pending after reload and preserves the old verified identity until confirmation');

    await page.locator('#inchide-profil').click();
    await asOwner(() => pg.query('update auth.users set email=new_email,new_email=null where id=$1', [uid(1)]));
    await openProfile(page);
    await page.locator('#modal-profil').waitFor({state: 'visible'});
    await page.waitForFunction(() => window.getSpotivityProfileUser()?.email === 'confirmed-next@example.test');
    assert.equal((await ownProfile(1)).email, 'confirmed-next@example.test');
    assert.equal(await page.locator('#profil-email').innerText(), 'confirmed-next@example.test');
    assert.equal(await page.locator('#profil-email-pending').isVisible(), false);
    pass('normal profile reopening fetches the newly confirmed Auth identity and its synchronized email');

    await review({name: 'Alice Once'});
    const beforeDouble = writes().length;
    const pendingProfile = pauseNext('/rest/v1/clienti', 'PATCH');
    await page.locator('#btn-profil-confirma').click(); await pendingProfile.entered;
    await page.evaluate(() => {
      document.getElementById('btn-profil-confirma').click();
      document.getElementById('profil-edit-form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    assert.equal(writes().length, beforeDouble + 1);
    pendingProfile.release();
    await page.waitForFunction(() => window.getSpotivityProfileUser()?.nume === 'Alice Once');
    assert.equal((await ownProfile(1)).nume, 'Alice Once');
    assert.equal(writes().length, beforeDouble + 1);
    pass('double confirmation and Enter during an in-flight save issue only one update');

    await review({name: 'Stale Alice', email: 'must-not-send@example.test'});
    const beforeLogout = writes().length;
    const pendingLogout = pauseNext('/rest/v1/clienti', 'PATCH');
    await page.locator('#btn-profil-confirma').click(); await pendingLogout.entered;
    await page.evaluate(() => db.auth.signOut({scope: 'local'}));
    await page.locator('#modal-editare-profil').waitFor({state: 'hidden'});
    await login('bob@example.test');
    pendingLogout.release(); await page.waitForLoadState('networkidle');
    assert.equal(writes().length, beforeLogout + 1, 'A stale draft must not continue into an email change after logout');
    assert.equal(writes().at(-1).person, 1);
    assert.deepEqual(await ownProfile(2), {nume: 'Bob', telefon: '222', email: 'bob@example.test'});
    assert.equal(await page.evaluate(() => window.getSpotivityProfileUser()?.nume), 'Bob');
    await openEditor();
    assert.equal(await page.locator('#profil-edit-nume').inputValue(), 'Bob');
    assert.equal(await page.locator('#profil-edit-email').inputValue(), 'bob@example.test');
    pass('logout closes and clears a pending draft; its already-sent request cannot edit the next account or send its stale email');

    // Return to Alice via the SDK (the Auth fixture chooses its UUID); the
    // confirmed email must come from server identity, never the login input.
    await page.locator('#inchide-editare-profil').click();
    await login('confirmed-next@example.test');
    await review({email: 'race-pending@example.test'});
    const pendingAuth = pauseNext('/auth/v1/user', 'PUT');
    await page.locator('#btn-profil-confirma').click(); await pendingAuth.entered;
    const inFlightEmail = writes().at(-1);
    await login('bob@example.test');
    await page.locator('#modal-editare-profil').waitFor({state: 'hidden'});
    pendingAuth.release(); await page.waitForLoadState('networkidle');
    assert.equal(inFlightEmail.person, 1, 'The separate in-memory Auth client must bind email changes to the original user');
    assert.equal(await page.evaluate(() => window.getSpotivityProfileUser()?.email), 'bob@example.test');
    assert.equal(await asOwner(async () => (await pg.query('select new_email from auth.users where id=$1', [uid(2)])).rows[0].new_email), null);
    assert.equal(await page.locator('#profil-email-pending').isVisible(), false);
    pass('an in-flight Auth email change stays bound to its verified session and cannot overwrite the next user or their UI');

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width, height: width < 768 ? 844 : 1000});
      await openEditor();
      // Long but permitted content exercises wrapping in the review summary.
      await fill({name: 'Nume de profil pentru verificarea afișării pe dispozitive mici', phone: '+40 (721) 234-567',
        email: 'long-profile-address-for-layout@example.test'});
      for (const stage of ['fields', 'review']) {
        if (stage === 'review') {
          await page.locator('#btn-profil-continua').click();
          await page.locator('#profil-edit-review').waitFor({state: 'visible'});
        }
        const layout = await page.locator('#modal-editare-profil .modal-continut').evaluate(root => {
          const box = root.getBoundingClientRect();
          const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
          return {viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, left: box.left, right: box.right,
            outside: [...root.querySelectorAll('input,button')].filter(visible).filter(node => {
              const r = node.getBoundingClientRect(); return r.left < box.left-1 || r.right > box.right+1;
            }).map(node => node.id),
            overflow: [root, ...root.querySelectorAll('div,p,dl,dd')].filter(visible)
              .filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth+1).map(node => node.id || node.tagName)};
        });
        const primary = page.locator(stage === 'fields' ? '#btn-profil-continua' : '#btn-profil-confirma');
        for (const interaction of ['normal', 'hover', 'focus']) {
          if (interaction === 'hover') await primary.hover();
          if (interaction === 'focus') await primary.focus();
          const contrast = await primary.evaluate(button => {
            const style = getComputedStyle(button);
            const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
            const luminance = channels => channels.map(channel => {
              const s = channel/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4;
            }).reduce((total, channel, i) => total + channel*[.2126, .7152, .0722][i], 0);
            const foreground = luminance(rgb(style.color));
            const backgrounds = style.backgroundImage === 'none' ? [style.backgroundColor]
              : (style.backgroundImage.match(/rgba?\([^)]*\)/g) || []);
            return {opacity: style.opacity, ratios: backgrounds.map(value => {
              const background = luminance(rgb(value));
              return (Math.max(foreground, background)+.05)/(Math.min(foreground, background)+.05);
            })};
          });
          assert.equal(contrast.opacity, '1', `${stage} ${interaction} CTA must remain readable`);
          assert.ok(contrast.ratios.length > 0 && contrast.ratios.every(ratio => ratio >= 4.5),
            `${stage} ${interaction} CTA contrast: ${JSON.stringify(contrast)}`);
        }
        if (screenshotDir) await page.screenshot({path: join(screenshotDir, `profile-edit-${stage}-${width}.png`)});
        assert.ok(layout.pageWidth <= layout.viewport+1 && layout.left >= -1 && layout.right <= layout.viewport+1, JSON.stringify(layout));
        assert.deepEqual(layout.outside, [], JSON.stringify(layout));
        assert.deepEqual(layout.overflow, [], JSON.stringify(layout));
        assert.equal(await page.locator('#btn-profil-anuleaza').isVisible(), true);
        pass(`profile ${stage} fits ${width}px with wrapping text and readable normal, hover and focus controls`);
      }
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(`Profile editor browser checks passed: ${checks}`);
  } finally {
    if (browser) await browser.close();
    await pg.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
