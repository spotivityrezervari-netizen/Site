// Actual booking workflow, public court controls and status UI in Chromium.
// Every request is fulfilled locally; no hosted bookings or emails are possible.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {chromium} = require('playwright');
const sources = ['guest-booking.js', 'modules/public-ui.js', 'modules/public-bookings.js', 'modules/public-courts.js']
    .map(file => readFileSync(join(__dirname, '../../js', file), 'utf8'));
const owner = {id: '00000000-0000-0000-0000-000000000001'};
const otherOwner = {id: '00000000-0000-0000-0000-000000000002'};
const bookingId = '00000000-0000-0000-0000-000000000009';

(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
    try {
        const setup = async () => {
            const page = await browser.newPage(), errors = [], requests = [];
            let release;
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.origin === 'https://booking-context.test') return route.fulfill({contentType: 'text/html', body: `<!doctype html><html><body>
                    <div id="fundal-imagine-sport"></div>
                    <div class="modal" id="modal-terenuri" style="display:none"><div class="modal-continut">
                        <h2 id="titlu-sport"></h2><input id="filtru-data" value="2030-06-12"><input id="filtru-nume">
                        <select id="filtru-ora"><option value="ALL">ALL</option><option value="17:00" selected>17:00</option></select>
                        <div id="container-dinamic-terenuri"></div>
                    </div></div>
                    <div class="modal" id="modal-rezervare" style="display:none"><div class="modal-continut">
                        <h2 id="rezervare-teren-selectat"></h2><button id="buton-vezi-locatia"></button>
                        <div id="container-minge"><input type="checkbox" id="checkbox-minge"><span id="text-label-minge"></span></div>
                        <div id="container-zile"></div><div id="container-ore"></div><button id="buton-confirma"></button>
                        <button id="inchide-rezervare">Închide</button><button id="inapoi-la-terenuri">Înapoi la terenuri</button>
                    </div></div>
                    <div class="modal" id="modal-auth" style="display:none">Autentificare</div>
                    <div id="notificare-rezervare" hidden><span id="notificare-rezervare-text"></span></div>
                </body></html>`});
                if (url.origin !== 'https://workflow.test') return route.abort();
                assert.equal(url.pathname, '/functions/v1/booking-workflow');
                const headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,apikey,authorization'};
                if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
                assert.equal(route.request().method(), 'POST');
                requests.push(route.request().postDataJSON());
                const response = await new Promise(resolve => { release = resolve; });
                return route.fulfill({status: response.status, headers, contentType: 'application/json', body: JSON.stringify(response.body)});
            });
            await page.goto('https://booking-context.test/');
            await page.evaluate(owner => {
                window.supabaseUrl = 'https://workflow.test'; window.supabaseKey = 'fixture-public-key';
                window.lang = 'ro'; window.dict = {ro: {nevoie_minge: 'Minge', azi: 'Azi', maine: 'Mâine', zile: ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'],
                    ocupat: 'ocupat', trecut: 'trecut', alegeti_o_ora: 'Alege o oră', rezerva: 'Rezervă', alege_terenul: 'Alege terenul', toate_orele: 'Toate orele', se_cauta: 'Se caută'}};
                window.siteDate = () => '2030-06-12'; window.siteClock = () => ({hour: 12, minute: 0}); window.traduData = value => value;
                window.safeUrl = () => ''; window.siteHomeUrl = () => 'https://booking-context.test/';
                window.getSportAppearance = () => ({fundal_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'});
                window.getCourtBookingHours = () => ['17:00', '18:00', '19:00']; window.bookingHourOptions = ['17:00', '18:00', '19:00'];
                window.normalizeSportName = value => value; window.escapeHtml = value => String(value); window.appAssetUrl = value => value;
                window.SpotivityNavigation = {courtUrl: court => `https://booking-context.test/?teren=${court.id}`};
                window.courts = [{id: 1, nume: 'Teren A', pret: 100, sport: 'Fotbal', optiune_minge: false},
                    {id: 2, nume: 'Teren B', pret: 150, sport: 'Fotbal', optiune_minge: false}];
                window.fixtureState = {user: owner, authGeneration: 0, courts, sport: 'Fotbal'};
                window.availabilityReads = 0; window.bookingEvents = []; window.alerts = [];
                window.alert = message => alerts.push(message);
                window.addEventListener('spotivity:booking-created', event => bookingEvents.push(event.detail.booking_id));
                window.db = {
                    auth: {getSession: async () => ({data: {session: fixtureState.user ? {user: fixtureState.user, access_token: 'fixture-token'} : null}, error: null})},
                    from(table) {
                        const filters = {};
                        return {select() {return this;}, eq(key, value) {filters[key] = value; return this;}, order() {return this;},
                            async maybeSingle() {return {data: courts.find(court => String(court.id) === String(filters.id)), error: null};},
                            then(resolve, reject) {if (table === 'rezervari_disponibilitate') availabilityReads++;
                                return Promise.resolve({data: table === 'terenuri' ? courts : [], error: null}).then(resolve, reject);}};
                    },
                    channel() {return {on() {return this;}, subscribe() {return this;}};}
                };
                window.spotivityReadAllRows = query => query();
            }, owner);
            for (const source of sources) await page.addScriptTag({content: source});
            await page.evaluate(async () => {
                window.fixtureServices = {ui: SpotivityModules.publicUi()};
                window.bookingApi = fixtureServices.bookings = SpotivityModules.publicBookings({db, state: fixtureState, services: fixtureServices});
                const courtApi = SpotivityModules.publicCourts({db, state: fixtureState, services: fixtureServices});
                bookingApi.mount(); courtApi.mount(); await courtApi.render(); bookingApi.openCourt(courts[0]);
            });
            const ready = () => page.waitForFunction(() => document.querySelectorAll('.btn-ora').length === 3 && !document.querySelector('#container-ore').textContent.includes('⏳'));
            await ready();
            const submit = async () => {release = null; await page.locator('#buton-confirma').click(); await page.waitForFunction(ownerId => !!SpotivityBooking.pendingSelection(ownerId), owner.id);
                await new Promise(resolve => {const poll = () => release ? resolve() : setTimeout(poll, 5); poll();});};
            const reply = async (status = 200) => {
                release({status, body: status === 200 ? {booking_id: bookingId, notification_status: 'queued'}
                    : status >= 500 ? {error: 'Fixture acknowledgement unavailable', code: 'service_unavailable'} : {error: 'Fixture slot conflict', code: 'slot_unavailable'}});
                if (status < 500) await page.waitForFunction(ownerId => !SpotivityBooking.pendingSelection(ownerId), owner.id);
                await page.waitForFunction(() => !document.querySelector('#buton-confirma').textContent.includes('Se procesează'));
            };
            return {page, errors, requests, submit, reply, ready};
        };
        {
            const t = await setup(); await t.submit(); await t.reply();
            assert.equal(await t.page.locator('#modal-rezervare').evaluate(node => node.style.display), 'none');
            assert.equal(await t.page.locator('#notificare-rezervare').isVisible(), true);
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), [bookingId]);
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS normal confirmation closes its own selection and reports success');
        }
        {
            const t = await setup(); await t.submit(); await t.page.locator('.btn-zi').nth(1).click();
            const background = await t.page.locator('#modal-rezervare .modal-continut').getAttribute('style');
            await t.reply(); await t.ready();
            assert.equal(t.requests[0].day, '2030-06-12');
            assert.equal(await t.page.locator('#modal-rezervare').isVisible(), true);
            assert.match(await t.page.locator('.btn-zi.selectat').innerText(), /13\.06/);
            assert.equal(await t.page.locator('#modal-rezervare .modal-continut').getAttribute('style'), background);
            assert.equal(await t.page.locator('#buton-confirma').isDisabled(), true);
            await t.page.getByRole('button', {name: '18:00', exact: true}).click();
            assert.equal(await t.page.locator('#buton-confirma').innerText(), 'Rezervă (100\u00a0Lei)');
            assert.equal(await t.page.locator('#notificare-rezervare').isVisible(), true);
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), [bookingId]);
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS a delayed confirmation preserves the newer day, background and quote');
        }
        {
            const t = await setup(); await t.submit();
            await t.page.locator('#inapoi-la-terenuri').click(); await t.page.locator('.card-teren-poza').nth(1).click();
            assert.equal(await t.page.locator('#rezervare-teren-selectat').innerText(), 'Teren B');
            const background = await t.page.locator('#modal-rezervare .modal-continut').getAttribute('style');
            await t.reply(); await t.ready();
            assert.equal(t.requests[0].court_id, '1'); assert.equal(t.requests[0].expected_total, 100);
            assert.equal(await t.page.locator('#modal-rezervare').isVisible(), true);
            assert.equal(await t.page.locator('#rezervare-teren-selectat').innerText(), 'Teren B');
            assert.equal(await t.page.locator('#modal-rezervare .modal-continut').getAttribute('style'), background);
            assert.equal(await t.page.locator('#buton-confirma').innerText(), 'Rezervă (150\u00a0Lei)');
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), [bookingId]);
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS a delayed confirmation preserves another court opened through the public controls');
        }
        {
            const t = await setup(); await t.submit();
            await t.page.locator('#inapoi-la-terenuri').click(); await t.page.locator('.card-teren-poza').nth(1).click();
            await t.reply(503);
            assert.equal(await t.page.locator('#buton-confirma').innerText(), 'Verifică rezervarea anterioară');
            assert.equal(await t.page.evaluate(ownerId => SpotivityBooking.pendingSelection(ownerId).court_id, owner.id), '1');
            const background = await t.page.locator('#modal-rezervare .modal-continut').getAttribute('style');
            await t.submit(); await t.reply(); await t.ready();
            assert.deepEqual(t.requests[1], t.requests[0], 'Verification retries the same UUID and quote for court A');
            assert.equal(await t.page.locator('#modal-rezervare').isVisible(), true);
            assert.equal(await t.page.locator('#rezervare-teren-selectat').innerText(), 'Teren B');
            assert.equal(await t.page.locator('#modal-rezervare .modal-continut').getAttribute('style'), background);
            assert.equal(await t.page.locator('#buton-confirma').innerText(), 'Rezervă (150\u00a0Lei)');
            assert.equal(await t.page.locator('#notificare-rezervare').isVisible(), true);
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), [bookingId]);
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS verifying an uncertain prior booking preserves the newer court and price');
        }
        {
            const t = await setup(); await t.submit(); await t.page.locator('#inchide-rezervare').click();
            await t.page.evaluate(() => {document.getElementById('modal-auth').style.display = 'flex'; document.getElementById('fundal-imagine-sport').hidden = false;});
            await t.reply();
            assert.equal(await t.page.locator('#modal-auth').isVisible(), true);
            assert.equal(await t.page.locator('#fundal-imagine-sport').evaluate(node => node.hidden), false);
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), [bookingId]);
            assert.equal(await t.page.locator('#notificare-rezervare').isVisible(), true);
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS closing the booking before its response preserves the active auth view');
        }
        {
            const t = await setup(); await t.submit();
            await t.page.evaluate(user => {fixtureState.user = user; fixtureState.authGeneration++; bookingApi.invalidate();}, otherOwner);
            await t.reply(); await t.ready();
            assert.equal(await t.page.locator('#modal-rezervare').isVisible(), true);
            assert.equal(await t.page.locator('#notificare-rezervare').isVisible(), false);
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), []);
            assert.deepEqual(await t.page.evaluate(() => alerts), []);
            assert.equal(await t.page.locator('#buton-confirma').innerText(), 'Rezervă (100\u00a0Lei)');
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS an account switch suppresses the prior account’s result and refresh event');
        }
        {
            const t = await setup(); await t.submit(); await t.page.locator('.btn-zi').nth(1).click(); await t.reply(409); await t.ready();
            assert.equal(await t.page.locator('#modal-rezervare').isVisible(), true);
            assert.match(await t.page.locator('.btn-zi.selectat').innerText(), /13\.06/);
            assert.equal(await t.page.locator('#notificare-rezervare').isVisible(), false);
            assert.deepEqual(await t.page.evaluate(() => bookingEvents), []);
            assert.equal(await t.page.locator('#buton-confirma').isDisabled(), true);
            await t.page.getByRole('button', {name: '18:00', exact: true}).click();
            assert.equal(await t.page.locator('#buton-confirma').innerText(), 'Rezervă (100\u00a0Lei)');
            assert.deepEqual(await t.page.evaluate(() => alerts), ['Una dintre ore nu mai este disponibilă. Alege alte ore.']);
            assert.deepEqual(t.errors, []); await t.page.close();
            console.log('PASS a delayed refusal recovers availability for the newer day');
        }
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
