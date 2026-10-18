// Focused browser tests for the public contact/cancellation boundary.
// All HTTP is fulfilled locally; this test never calls the hosted project.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const script = readFileSync(join(__dirname, '../../js/guest-booking.js'), 'utf8');
const css = readFileSync(join(__dirname, '../../css/guest-booking.css'), 'utf8');
const bookingId = '00000000-0000-0000-0000-000000000009';
const userId = '00000000-0000-0000-0000-000000000001';
const selection = { court_id: '1', day: '2027-01-03', hours: ['13:00', '12:00'], with_ball: true };
const token = 'a'.repeat(64);
const result = { booking_id: bookingId, court_name: 'Court A', day: selection.day, hours: ['12:00', '13:00'], total: 215, state: 'activa', notification_status: 'queued' };
let checks = 0;
function pass(name) { checks++; process.stdout.write(`ok ${checks} - ${name}\n`); }

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const setup = async ({ hash = '', user = null, handler = () => ({ status: 200, data: result }), width = 390 } = {}) => {
            const page = await browser.newPage({ viewport: { width, height: 844 } });
            const requests = [], failures = [];
            page.on('pageerror', error => failures.push(error.message));
            await page.route('**/*', async route => {
                const request = route.request(), url = new URL(request.url());
                if (url.host === 'booking-ui.test') {
                    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui}.modal{position:fixed;inset:0;display:none;justify-content:center;background:#0008}.buton-rezervare{background:#d8b66a;color:#111;border:0}${css}</style></head><body><button id="original">Rezervă</button><script>const supabaseUrl='https://project.test';const supabaseKey='public-anon';let fixtureUser=${JSON.stringify(user)};const db={auth:{getSession:async()=>({data:{session:fixtureUser?{user:fixtureUser,access_token:'real-user-token'}:null}})}};window.bookingEnded=()=>false;</script><script>${script}</script></body></html>` });
                }
                assert.equal(url.href, 'https://project.test/functions/v1/booking-workflow');
                assert.equal(request.method(), 'POST');
                const item = { body: request.postDataJSON(), headers: request.headers() };
                requests.push(item);
                const response = await handler(item, requests.length);
                if (response.abort) return route.abort('failed');
                return route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(response.data) });
            });
            await page.goto(`https://booking-ui.test/${hash}`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => !!window.SpotivityBooking);
            const create = async (chosen = selection) => page.evaluate(chosen => { window.bookingPromise = window.SpotivityBooking.create(chosen, { court_name: 'Court A' }); }, chosen);
            const fill = async () => {
                await page.locator('#guest-contact_name').fill('Client Vizitator');
                await page.locator('#guest-email').fill('guest@example.test');
                await page.locator('#guest-phone').fill('+40 722 123 456');
            };
            return { page, requests, failures, create, fill };
        };
        {
            const t = await setup(); await t.create(); await t.fill();
            assert.equal(await t.page.locator('#modal-rezervare-vizitator input[type=password]').count(), 0);
            await t.page.locator('#guest-phone').fill('not a phone');
            await t.page.locator('#guest-booking-submit').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('Verifică numele'));
            assert.equal(t.requests.length, 0);
            await t.page.locator('#guest-phone').fill('+40 722 123 456');
            await t.page.locator('#guest-booking-submit').click();
            await t.page.locator('#modal-rezervare-vizitator').waitFor({ state: 'detached' });
            assert.deepEqual(await t.page.evaluate(() => window.bookingPromise), result);
            const payload = t.requests[0].body;
            assert.equal(payload.action, 'create_guest'); assert.equal(payload.contact_name, 'Client Vizitator');
            assert.equal(payload.email, 'guest@example.test'); assert.equal(payload.phone, '+40 722 123 456');
            assert.deepEqual(payload.hours, ['12:00', '13:00']); assert.match(payload.request_id, /^[0-9a-f-]{36}$/);
            assert.equal(t.requests[0].headers.authorization, undefined);
            assert.equal(t.requests[0].headers.apikey, 'public-anon');
            assert.equal(Object.keys(payload).some(key => /password|user_id|token/.test(key)), false);
            assert.deepEqual(await t.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
            assert.deepEqual(t.failures, []); pass('guest validates contact and books consecutive hours without Auth signup, password or persistent personal data'); await t.page.close();
        }
        {
            const t = await setup({ handler: (_, count) => count === 1
                ? { status: 409, data: { code: 'booking_limit', error: 'conflict' } } : {status: 200, data: result} });
            await t.create(); await t.fill(); await t.page.locator('#guest-booking-submit').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('indiferent de teren sau oraș'));
            assert.equal(await t.page.locator('#guest-email').isDisabled(), false);
            assert.equal(await t.page.evaluate(() => window.SpotivityBooking.pendingSelection(null)), null);
            await t.page.locator('#guest-booking-submit').click();
            await t.page.locator('#modal-rezervare-vizitator').waitFor({state: 'detached'});
            assert.equal(t.requests.length, 2);
            assert.notEqual(t.requests[0].body.request_id, t.requests[1].body.request_id);
            pass('a first definite daily conflict explains the cross-city limit and permits a fresh UUID after correction'); await t.page.close();
        }
        {
            const t = await setup({ handler: () => ({ status: 503, data: { code: 'guest_unavailable', error: 'Email service unavailable' } }) });
            await t.create(); await t.fill(); await t.page.locator('#guest-booking-submit').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('Nu a fost creată nicio rezervare'));
            assert.equal(await t.page.evaluate(() => window.SpotivityBooking.pendingSelection(null)), null);
            assert.equal(await t.page.locator('#guest-email').isDisabled(), false);
            assert.equal(await t.page.locator('#guest-booking-signin').isVisible(), true);
            pass('missing Make setup explicitly blocks guest booking without claiming an email was sent'); await t.page.close();
        }
        {
            const t = await setup({ handler: (_, count) => count === 1 ? { abort: true }
                : count === 2 ? { status: 429, data: { code: 'rate_limit', error: 'Retry later' } }
                : count === 3 ? { status: 503, data: { code: 'guest_unavailable', error: 'Email service unavailable' } }
                : { status: 200, data: result } });
            await t.create(); await t.fill(); await t.page.locator('#guest-booking-submit').click();
            await t.page.waitForFunction(() => document.querySelector('#guest-booking-submit').textContent.includes('aceeași'));
            assert.equal(await t.page.locator('#guest-email').isDisabled(), true);
            assert.equal(await t.page.locator('#guest-booking-signin').isVisible(), false);
            await t.page.getByRole('button', {name: 'Înapoi la ore', exact: true}).click();
            assert.equal(await t.page.evaluate(() => window.bookingPromise), null);
            await t.create({ ...selection, hours: ['16:00'] });
            assert.match(await t.page.locator('.workflow-summary').textContent(), /12:00–14:00/);
            await t.page.locator('#guest-booking-submit').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('prea multe cereri'));
            assert.equal(await t.page.locator('#guest-email').isDisabled(), true);
            assert.equal(await t.page.locator('#guest-booking-signin').isVisible(), false);
            assert.deepEqual(await t.page.evaluate(() => window.SpotivityBooking.pendingSelection(null)), {...selection, hours: ['12:00', '13:00']});
            await t.page.getByRole('button', {name: 'Înapoi la ore', exact: true}).click();
            await t.create({ ...selection, day: '2027-01-04', hours: ['16:00'] });
            await t.page.locator('#guest-booking-submit').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('Serviciul de email nu este disponibil'));
            assert.doesNotMatch(await t.page.locator('.workflow-status').textContent(), /Nu a fost creată nicio rezervare/);
            assert.equal(await t.page.locator('#guest-email').isDisabled(), true);
            assert.equal(await t.page.locator('#guest-booking-signin').isVisible(), false);
            await t.page.locator('#guest-booking-submit').click();
            await t.page.locator('#modal-rezervare-vizitator').waitFor({ state: 'detached' });
            assert.equal(t.requests.length, 4);
            for (const request of t.requests) assert.deepEqual(request.body, t.requests[0].body);
            assert.equal(await t.page.evaluate(() => window.SpotivityBooking.pendingSelection(null)), null);
            assert.deepEqual(await t.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
            pass('unknown guest reply survives close/reopen, rate limiting and unavailable email with the original frozen UUID until confirmation'); await t.page.close();
        }
        {
            const t = await setup();
            await t.page.evaluate(() => { window.signinRequests = 0; window.addEventListener('spotivity:booking-signin', () => window.signinRequests++); });
            await t.create(); await t.fill();
            await t.page.locator('#guest-booking-signin').click();
            await t.page.locator('#modal-rezervare-vizitator').waitFor({state: 'detached'});
            assert.equal(await t.page.evaluate(() => window.bookingPromise), null);
            assert.equal(await t.page.evaluate(() => window.signinRequests), 1);
            assert.equal(await t.page.evaluate(() => window.SpotivityBooking.pendingSelection(null)), null);
            assert.equal(t.requests.length, 0);
            pass('existing-account action closes guest contact, clears its draft and requests the existing login without creating an account'); await t.page.close();
        }
        {
            const t = await setup({ user: { id: userId } });
            const created = await t.page.evaluate(async ({ selection, userId }) => window.SpotivityBooking.create(selection, { user: { id: userId } }), { selection, userId });
            assert.deepEqual(created, result); assert.equal(t.requests[0].body.action, 'create');
            assert.equal(t.requests[0].headers.authorization, 'Bearer real-user-token');
            const invalid = await t.page.evaluate(async ({ selection, userId }) => { try { await window.SpotivityBooking.create({ ...selection, hours: ['12:00', '14:00'] }, { user: { id: userId } }); } catch (error) { return error.code; } }, { selection, userId });
            assert.equal(invalid, 'invalid_hours'); assert.equal(t.requests.length, 1);
            await t.page.evaluate(({ bookingId, userId }) => window.SpotivityBooking.cancelOwned(bookingId, userId), { bookingId, userId });
            assert.equal(t.requests[1].body.action, 'cancel_owned');
            pass('signed-in booking and grouped cancellation use the current JWT; disjoint hours never reach the server'); await t.page.close();
        }
        {
            const t = await setup({user: {id: userId}, handler: (_, count) => count === 1 ? {abort: true}
                : count === 2 ? {status: 401, data: {code: 'unauthenticated', error: 'Session expired'}}
                : {status: 200, data: {...result, state: 'anulata'}}});
            const attempt = chosen => t.page.evaluate(async ({selection, userId}) => {
                try { return await window.SpotivityBooking.create(selection, {user: {id: userId}}); }
                catch (error) { return {code: error.code, unknown: error.unknown, message: error.message}; }
            }, {selection: chosen, userId});
            assert.equal((await attempt(selection)).unknown, true);
            const expired = await attempt(selection);
            assert.equal(expired.code, 'unauthenticated'); assert.match(expired.message, /Sesiunea a expirat/);
            assert.deepEqual(await t.page.evaluate(userId => window.SpotivityBooking.pendingSelection(userId), userId), {...selection, hours: ['12:00', '13:00']});
            assert.equal((await attempt({...selection, hours: ['16:00']})).code, 'pending_booking');
            assert.equal(t.requests.length, 2);
            const replay = await attempt(selection);
            assert.equal(replay.state, 'anulata');
            assert.equal(t.requests.length, 3);
            for (const request of t.requests) assert.deepEqual(request.body, t.requests[0].body);
            assert.equal(await t.page.evaluate(userId => window.SpotivityBooking.pendingSelection(userId), userId), null);
            pass('unknown signed-in reply retains its original UUID after Auth401 and prevents recreating an already-cancelled booking'); await t.page.close();
        }
        {
            const t = await setup();
            const code = await t.page.evaluate(async userId => { try { await window.SpotivityBooking.cancelOwned('invalid', userId); } catch (error) { return error.code; } }, userId);
            assert.equal(code, 'unauthorized'); assert.equal(t.requests.length, 0);
            pass('a missing current Auth session cannot call owner cancellation'); await t.page.close();
        }
        {
            const t = await setup({ hash: `#anulare-rezervare=${bookingId}&token=${token}`, handler: item => ({ status: 200, data: item.body.action === 'preview_cancel' ? { ...result, can_cancel: true } : { ...result, state: 'anulata' } }) });
            await t.page.locator('#email-booking-cancel-confirm').waitFor({ state: 'visible' });
            assert.equal(new URL(t.page.url()).hash, ''); assert.equal(t.requests.length, 1);
            assert.equal(t.requests[0].body.action, 'preview_cancel'); assert.equal(t.requests[0].body.token, token);
            assert.equal(t.requests[0].headers.authorization, undefined);
            assert.equal(await t.page.locator('.workflow-status').textContent(), 'Vrei să anulezi această rezervare? Orele vor deveni disponibile din nou.');
            await t.page.locator('#email-booking-cancel-confirm').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('a fost anulată'));
            assert.equal(t.requests.length, 2); assert.equal(t.requests[1].body.action, 'cancel');
            assert.deepEqual(await t.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
            assert.equal(await t.page.locator('#email-booking-cancel-confirm').isVisible(), false);
            pass('email secret leaves the URL immediately; preview is read-only and cancellation needs an explicit button'); await t.page.close();
        }
        {
            const t = await setup({ hash: `#anulare-rezervare=${bookingId}&token=${token}`, handler: () => ({ status: 200, data: { ...result, can_cancel: false } }) });
            await t.page.waitForFunction(() => document.querySelector('.workflow-status')?.textContent.includes('finalizată'));
            assert.equal(await t.page.locator('#email-booking-cancel-confirm').isVisible(), false);
            assert.equal(t.requests.length, 1); pass('completed reservation preview offers no cancellation action'); await t.page.close();
        }
        {
            const t = await setup({ hash: `#anulare-rezervare=${bookingId}&token=invalid` });
            await t.page.waitForFunction(() => document.querySelector('.workflow-status')?.textContent.includes('invalid'));
            assert.equal(t.requests.length, 0); assert.equal(new URL(t.page.url()).hash, '');
            pass('malformed cancellation links are stripped and never sent to the API'); await t.page.close();
        }
        for (const [code, message] of [['completed_booking', 'finalizată'], ['invalid_cancellation', 'invalid']]) {
            const t = await setup({hash: `#anulare-rezervare=${bookingId}&token=${token}`,
                handler: () => ({status: 409, data: {code, error: 'Rejected cancellation'}})});
            await t.page.waitForFunction(message => document.querySelector('.workflow-status')?.textContent.includes(message), message);
            assert.equal(await t.page.locator('#email-booking-cancel-confirm').isVisible(), false);
            assert.equal(t.requests.length, 1);
            pass(`server ${code} cancellation error uses the matching Romanian explanation`); await t.page.close();
        }
        for (const width of [320, 390, 768, 1440]) {
            const t = await setup({ width }); await t.create(); await t.fill();
            const geometry = await t.page.locator('.workflow-panel').evaluate(el => {
                const panel = el.getBoundingClientRect(), actions = [...el.querySelectorAll('.workflow-actions button')].map(button => button.getBoundingClientRect());
                return { x: panel.x, right: panel.right, viewport: innerWidth, scroll: el.scrollWidth, client: el.clientWidth, gap: actions[1].top - actions[0].bottom, font: getComputedStyle(el.querySelector('input')).fontSize };
            });
            assert.ok(geometry.x >= 0 && geometry.right <= width + 1, JSON.stringify(geometry));
            assert.ok(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry)); assert.ok(geometry.gap >= 10, JSON.stringify(geometry));
            assert.equal(geometry.font, '16px');
            assert.deepEqual(t.failures, []); pass(`guest dialog fits ${width}px with separated buttons and readable contact fields`); await t.page.close();
        }
        process.stdout.write(`PASS: ${checks} guest booking browser checks\n`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
