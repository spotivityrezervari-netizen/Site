// Native workflow UI + fetch in Chromium. The sole server is intercepted;
// this verifies public error handling without hosted bookings or email delivery.
const {chromium} = require('playwright');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const source = readFileSync(join(__dirname, '../../js/guest-booking.js'), 'utf8');
const backend = 'https://fixture.supabase.test';
const user = {id: '00000000-0000-0000-0000-000000000001'};
const booking = '00000000-0000-0000-0000-000000000101';
const selection = {court_id: '1', day: '2030-01-01', hours: ['09:00'], expected_total: 100};
const messages = {
 ro: 'Nu poți face rezervări la acest teren cât timp restricția este activă. Contactează administratorul terenului pentru detalii.',
 hu: 'Amíg a korlátozás érvényes, ezen a pályán nem foglalhatsz. A részletekért fordulj a pálya adminisztrátorához.',
 en: 'You cannot book this court while the restriction is active. Contact the court administrator for details.'
};

(async () => {
 const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
 try {
  for (const language of ['ro', 'hu', 'en', 'unsupported']) {
   const context = await browser.newContext();
   try {
    const page = await context.newPage(), errors = [], calls = [];
    let restricted = true;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
     const request = route.request(), url = new URL(request.url());
     if (url.origin === backend) {
      assert.equal(url.pathname, '/functions/v1/booking-workflow');
      const headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey, authorization, content-type'};
      if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
      assert.equal(request.method(), 'POST');
      calls.push({body: request.postDataJSON(), authorization: request.headers().authorization});
      return route.fulfill({status: restricted === 'uncertain' ? 503 : restricted ? 403 : 200, headers, contentType: 'application/json',
       body: JSON.stringify(restricted === 'uncertain' ? {code: 'service_unavailable', error: 'Fixture acknowledgement unavailable'}
        : restricted ? {code: 'booking_restricted', error: 'Private SQL/restriction details must not be displayed'}
        : {booking_id: booking, notification_status: 'queued'})});
     }
     assert.equal(url.origin, 'https://booking-ui.example.test');
     return route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>'});
    });
    await page.goto('https://booking-ui.example.test/');
    await page.evaluate(({backend, user, language}) => {
     window.supabaseUrl = backend; window.supabaseKey = 'fixture-public-key'; window.lang = language;
     window.db = {auth: {getSession: async () => ({data: {session: {user, access_token: 'fixture-access-token'}}, error: null})}};
    }, {backend, user, language});
    await page.addScriptTag({content: source});
    const expected = messages[language] || messages.ro;
    const error = await page.evaluate(async ({selection, user}) => {
     try { await SpotivityBooking.create(selection, {user}); throw new Error('Restriction must reject the request'); }
     catch (error) { return {code: error.code, message: error.message, unknown: error.unknown, pending: SpotivityBooking.pendingSelection(user.id)}; }
    }, {selection, user});
    assert.deepEqual(error, {code: 'booking_restricted', message: expected, unknown: false, pending: null});
    assert.equal(calls.length, 1); assert.equal(calls[0].body.action, 'create');
    assert.equal(calls[0].authorization, 'Bearer fixture-access-token');
    restricted = false;
    const confirmed = await page.evaluate(async ({selection, user}) => SpotivityBooking.create(selection, {user}), {selection, user});
    assert.equal(confirmed.booking_id, booking);
    assert.notEqual(calls[0].body.request_id, calls[1].body.request_id, 'A definite server refusal is not an uncertain committed booking');
    console.log('PASS authenticated restriction message and retry ' + language);

    restricted = true;
    await page.evaluate(selection => { window.guestOutcome = 'waiting'; SpotivityBooking.create(selection).then(result => { window.guestOutcome = result; }); }, selection);
    await page.locator('#guest-contact_name').fill('Fixture Client');
    await page.locator('#guest-email').fill('fixture@example.test');
    await page.locator('#guest-phone').fill('+40700111222');
    await page.locator('#guest-booking-submit').click();
    await page.waitForFunction(message => document.querySelector('#modal-rezervare-vizitator .workflow-status')?.textContent === message, expected);
    assert.equal(await page.locator('#guest-email').isEnabled(), true, 'Definite refusal keeps the guest contact editable');
    assert.equal(await page.locator('#guest-booking-submit').isEnabled(), true);
    assert.equal(await page.evaluate(() => SpotivityBooking.pendingSelection()), null);
    assert.equal(calls[2].body.action, 'create_guest'); assert.equal(calls[2].authorization, undefined);
    assert.equal(await page.evaluate(() => guestOutcome), 'waiting', 'A rejected booking never reports confirmation');
    restricted = false;
    await page.locator('#guest-booking-submit').click();
    await page.waitForFunction(() => typeof guestOutcome === 'object' && guestOutcome?.booking_id);
    assert.equal(await page.evaluate(() => guestOutcome.booking_id), booking);
    assert.notEqual(calls[2].body.request_id, calls[3].body.request_id);
    assert.equal(await page.locator('#modal-rezervare-vizitator').count(), 0);
    assert.deepEqual(errors, []); console.log('PASS guest restriction message and retry ' + language);
    if (language === 'ro') {
     const uncertainSelection = {...selection, hours: ['10:00']};
     const attempt = () => page.evaluate(async ({selection, user}) => {
      try { return await SpotivityBooking.create(selection, {user}); }
      catch (error) { return {code: error.code, unknown: error.unknown, message: error.message, pending: SpotivityBooking.pendingSelection(user.id)}; }
     }, {selection: uncertainSelection, user});
     restricted = 'uncertain';
     const uncertain = await attempt();
     assert.equal(uncertain.unknown, true); assert.deepEqual(uncertain.pending, {...uncertainSelection, with_ball: false});
     restricted = true;
     const blocked = await attempt();
     assert.equal(blocked.code, 'booking_restricted'); assert.equal(blocked.message, expected);
     assert.deepEqual(blocked.pending, uncertain.pending, 'A later refusal cannot discard an earlier uncertain booking');
     assert.equal(calls[4].body.request_id, calls[5].body.request_id, 'The same UUID verifies the original uncertain request');
     restricted = false; assert.equal((await attempt()).booking_id, booking);
     assert.equal(calls[4].body.request_id, calls[6].body.request_id);
     assert.equal(await page.evaluate(userId => SpotivityBooking.pendingSelection(userId), user.id), null);
     assert.deepEqual(errors, []); console.log('PASS restriction refusal preserves prior uncertain booking identity');
    }
   } finally { await context.close(); }
  }
 } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
