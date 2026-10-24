// Real Chromium, pinned/SRI Supabase SDK and disposable PostgreSQL/Edge handlers.
// Hosted Auth/database/Storage requests are intercepted; never writes live data.
const {chromium} = require('playwright');
const {readFileSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const {createFixture, host} = require('./club-request-fixture.cjs');
const {createBookingWorkflowFixture} = require('./booking-workflow-fixture.cjs');
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8002/';
let checks = 0;
const pass = label => { checks++; console.log('PASS', label); };

async function locked(page, expected) {
    await page.waitForFunction(expected => document.body.classList.contains('fara-scroll') === expected, expected);
}

async function swipe(page, touch, from, to) {
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [from]});
    for (let step = 1; step <= 12; step++) {
        await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{
            x: from.x+(to.x-from.x)*step/12, y: from.y+(to.y-from.y)*step/12
        }]});
        await page.waitForTimeout(20);
    }
    await page.waitForTimeout(70);
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.waitForTimeout(250);
}

async function footballPans(page, touch, label) {
    await page.setViewportSize({width: 390, height: 844});
    await locked(page, false);
    assert.equal(await page.locator('.modal:visible').count(), 0, `${label}: all dialogs closed`);
    for (const distance of [-180, 180]) {
        const art = page.locator('#sport-fotbal .home-hero-art');
        await art.evaluate(node => {
            const box = node.getBoundingClientRect();
            scrollTo({top: scrollY+box.top+box.height*.65-300, behavior: 'instant'});
        });
        await page.waitForTimeout(250);
        const start = await art.evaluate(node => {
            const box = node.getBoundingClientRect(), x = box.left+box.width/2, y = box.top+box.height*.65;
            return {x, y, top: scrollY, touch: getComputedStyle(document.body).touchAction,
                onPhoto: node.contains(document.elementFromPoint(x, y)),
                pageFilter: getComputedStyle(document.getElementById('spotivity-top')).filter};
        });
        assert.equal(start.onPhoto, true, `${label}: the gesture starts on the Football photograph`);
        assert.notEqual(start.touch, 'none', `${label}: page touch gestures remain enabled`);
        assert.equal(start.pageFilter, 'none', `${label}: no full-page blur remains after closing`);
        await swipe(page, touch, {x: start.x, y: start.y}, {x: start.x, y: start.y+distance});
        const end = await page.evaluate(() => scrollY);
        assert.ok(distance < 0 ? end > start.top+60 : end < start.top-60,
            `${label}: Football swipe ${distance}, scroll ${start.top} → ${end}`);
    }
}

async function openCourts(page) {
    await page.locator('#sport-fotbal .home-reserve-button').click();
    await page.locator('#modal-terenuri').waitFor({state: 'visible'});
    await locked(page, true);
}

async function openBooking(page) {
    await openCourts(page);
    await page.locator('.card-teren-poza').filter({hasText: 'Court A'}).click();
    await page.locator('#modal-rezervare').waitFor({state: 'visible'});
    await locked(page, true);
}

(async () => {
    const fixture = await createFixture();
    let browser;
    const contexts = [], errors = [];
    try {
        await fixture.root(async () => {
            for (let index = 1; index <= 4; index++) await fixture.pg.query(
                "insert into public.terenuri(nume,sport,pret,poza,oras,este_activ) values($1,'Fotbal',100,'assets/imagini/avatar2.png','Reghin',true)",
                [`Scroll Court ${index}`]);
        });
        const booking = await createBookingWorkflowFixture({pg: fixture.pg, host,
            resolveUser: bearer => fixture.tokens.get(bearer), records: fixture.requests});
        const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
        const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
        assert.ok(sdkTag);
        const sdk = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
        assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'), sdkTag[2]);
        browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
        async function pageFor() {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 3,
                isMobile: true, hasTouch: true, timezoneId: 'Europe/Bucharest'});
            contexts.push(context);
            await context.route(sdkTag[1], route => route.fulfill({contentType: 'application/javascript', body: sdk,
                headers: {'access-control-allow-origin': '*'}}));
            await context.route(url => url.hostname === host || url.hostname.endsWith('.supabase.co'), route =>
                new URL(route.request().url()).pathname === '/functions/v1/booking-workflow'
                    ? fixture.serial(() => booking.browserRoute(route)) : fixture.browserRoute(route));
            await context.routeWebSocket(url => url.hostname.endsWith('.supabase.co'), socket => socket.close());
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            page.on('dialog', dialog => dialog.accept());
            await page.goto(base, {waitUntil: 'networkidle'});
            return {page, touch: await context.newCDPSession(page)};
        }

        const {page, touch} = await pageFor();
        await page.setViewportSize({width: 390, height: 600});
        await openCourts(page);
        const chooser = page.locator('#modal-terenuri .modal-continut');
        const chooserStart = await chooser.evaluate(node => {
            const box = node.getBoundingClientRect();
            return {x: box.left+8, y: box.bottom-100, scroll: node.scrollTop,
                max: node.scrollHeight-node.clientHeight, pageY: scrollY,
                startsOnBackground: document.elementFromPoint(box.left+8, box.bottom-100) === node};
        });
        assert.ok(chooserStart.max > 60, 'The Football court picker has content to scroll');
        assert.equal(chooserStart.startsOnBackground, true, 'The chooser swipe starts on its padding/background, away from court cards');
        await swipe(page, touch, {x: chooserStart.x, y: chooserStart.y}, {x: chooserStart.x, y: chooserStart.y-180});
        assert.ok(await chooser.evaluate(node => node.scrollTop) > chooserStart.scroll+60,
            'The Football court picker scrolls when a native gesture starts on its background');
        assert.equal(await page.evaluate(() => scrollY), chooserStart.pageY, 'Scrolling the court picker does not move the landing page');
        await page.locator('#inchide-terenuri').click();
        await footballPans(page, touch, 'court picker close');
        pass('the Football picker scrolls from its own background, and closing it restores native landing-page panning');

        await page.setViewportSize({width: 390, height: 600});
        await openBooking(page);
        const panel = page.locator('#modal-rezervare .modal-continut');
        const geometry = await panel.evaluate(node => {
            const box = node.getBoundingClientRect();
            return {x: box.left+8, y: box.bottom-90, before: node.scrollTop,
                max: node.scrollHeight-node.clientHeight, pageY: scrollY,
                startsOnBackground: document.elementFromPoint(box.left+8, box.bottom-90) === node,
                touch: getComputedStyle(document.body).touchAction,
                pageFilter: getComputedStyle(document.getElementById('spotivity-top')).filter};
        });
        assert.ok(geometry.max > 60, 'Short phone viewports have vertically scrollable booking content');
        assert.equal(geometry.startsOnBackground, true, 'The booking swipe starts on padding/background, away from hour controls');
        assert.notEqual(geometry.touch, 'none', 'An open dialog must not globally disable native touch gestures');
        assert.equal(geometry.pageFilter, 'none', 'A dialog must not blur the complete multi-screen landing page');
        await swipe(page, touch, {x: geometry.x, y: geometry.y}, {x: geometry.x, y: geometry.y-180});
        assert.ok(await panel.evaluate(node => node.scrollTop) > geometry.before+60, 'Booking content accepts native vertical panning');
        assert.equal(await page.evaluate(() => scrollY), geometry.pageY, 'Panning booking content keeps the background fixed');
        await swipe(page, touch, {x: 3, y: 430}, {x: 3, y: 230});
        assert.equal(await page.evaluate(() => scrollY), geometry.pageY, 'Dragging the modal margin does not scroll the underlying site');
        await page.locator('#inapoi-la-terenuri').click();
        await page.locator('#modal-rezervare').waitFor({state: 'hidden'});
        await page.locator('#modal-terenuri').waitFor({state: 'visible'});
        await locked(page, true);
        await page.locator('#inchide-terenuri').click();
        await footballPans(page, touch, 'back to courts then close');
        pass('short-screen booking content scrolls while the background stays locked, and returning through the court picker restores page panning');

        for (const close of ['X', 'Escape']) {
            await openBooking(page);
            if (close === 'X') await page.locator('#inchide-rezervare').click();
            else await page.keyboard.press('Escape');
            await footballPans(page, touch, `booking ${close}`);
        }
        pass('closing booking with X or Escape restores Football background panning');

        await openBooking(page);
        await page.locator('.btn-zi').nth(1).click();
        await page.locator('.btn-ora:not([disabled])').first().click();
        await page.locator('#buton-confirma').click();
        await page.locator('#guest-contact_name').fill('Guest Scroll Test');
        await page.locator('#guest-email').fill('scroll@example.test');
        await page.locator('#guest-phone').fill('+40722123456');
        await page.locator('#guest-booking-submit').click();
        await page.locator('#modal-rezervare-vizitator').waitFor({state: 'detached'});
        await page.locator('#modal-rezervare').waitFor({state: 'hidden'});
        await page.locator('#notificare-rezervare').waitFor({state: 'visible'});
        await footballPans(page, touch, 'guest booking success');
        pass('a real guest booking confirms through Edge/SQL and immediately restores native background panning');

        const signed = await pageFor();
        await signed.page.locator('#btn-top-cont').click();
        await signed.page.locator('#login-email').fill('alice@example.test');
        await signed.page.locator('#login-parola').fill('fixture-password');
        await signed.page.locator('#btn-executa-login').click();
        await signed.page.locator('#modal-auth').waitFor({state: 'hidden'});
        await openBooking(signed.page);
        await signed.page.locator('.btn-zi').nth(2).click();
        await signed.page.locator('.btn-ora:not([disabled])').first().click();
        await signed.page.locator('#buton-confirma').click();
        await signed.page.locator('#modal-rezervare').waitFor({state: 'hidden'});
        await signed.page.locator('#notificare-rezervare').waitFor({state: 'visible'});
        await footballPans(signed.page, signed.touch, 'signed-in booking success');
        pass('a real signed-in booking confirms through Edge/SQL and immediately restores native background panning');

        await page.evaluate(() => {
            const wrapper = document.createElement('section'); wrapper.id = 'fixture-modal-wrapper'; wrapper.hidden = true;
            const modal = document.createElement('div'); modal.className = 'modal'; modal.id = 'fixture-dynamic-modal'; modal.style.display = 'flex';
            wrapper.append(modal); document.body.append(wrapper);
        });
        await locked(page, false);
        await page.evaluate(() => { document.getElementById('fixture-modal-wrapper').hidden = false; });
        await locked(page, true);
        await page.evaluate(() => { document.getElementById('fixture-modal-wrapper').style.display = 'none'; });
        await locked(page, false);
        await page.evaluate(() => { document.getElementById('fixture-modal-wrapper').style.display = ''; });
        await locked(page, true);
        await page.evaluate(() => document.getElementById('fixture-dynamic-modal').remove());
        await locked(page, false);
        await page.evaluate(() => document.getElementById('fixture-modal-wrapper').remove());
        await footballPans(page, touch, 'dynamic modal removed');
        pass('hidden modal ancestors do not lock the page, and showing, hiding or removing dynamic dialogs synchronizes the scroll lock');

        const records = await fixture.root(async () => ({
            users: Number((await fixture.pg.query('select count(*) n from auth.users')).rows[0].n),
            active: (await fixture.pg.query("select email_client,stare from public.rezervari where stare='activa' order by email_client")).rows
        }));
        assert.equal(records.users, 4, 'Guest booking does not create an account');
        assert.deepEqual(records.active, [{email_client: 'alice@example.test', stare: 'activa'}, {email_client: 'scroll@example.test', stare: 'activa'}]);
        assert.deepEqual(errors, []);
        pass('the scroll fixes preserve both confirmed bookings and do not create a guest account or browser errors');
        console.log(`${checks} mobile booking scroll browser checks passed.`);
    } finally {
        for (const context of contexts) await context.close().catch(() => {});
        if (browser) await browser.close();
        await fixture.close();
    }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
