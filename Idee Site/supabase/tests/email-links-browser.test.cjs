// Real browser and disposable PostgreSQL/Auth/Edge adapters. No hosted writes.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { createFixture, uid, host } = require('./club-request-fixture.cjs');
const { createBookingWorkflowFixture } = require('./booking-workflow-fixture.cjs');
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8117/';
const id = uid(51001), guestId = uid(51002);
let checks = 0;
const pass = text => { checks++; console.log('PASS', text); };

(async () => {
    const fixture = await createFixture(); let browser;
    const contexts = [], errors = []; let cancellationPosts = 0;
    try {
        const seeded = await fixture.root(async () => {
            await fixture.pg.exec("alter table auth.users add column if not exists created_at timestamptz not null default '2026-01-01T00:00:00Z'");
            for (const file of ['021_account_welcome.sql', '022_email_booking_context.sql']) await fixture.pg.exec(readFileSync(join(__dirname, '..', file), 'utf8'));
            await fixture.pg.query("update public.clienti set telefon='0721123456' where user_id=$1", [uid(1)]);
            const day = (await fixture.pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text value")).rows[0].value;
            const court = String((await fixture.pg.query("select id from public.terenuri where nume='Court A'")).rows[0].id);
            await fixture.pg.query("update public.terenuri set ore_rezervabile=array['12:00','13:00','14:00','15:00'] where id::text=$1", [court]);
            await fixture.pg.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
            await fixture.pg.exec('set role authenticated');
            await fixture.pg.query('select public.create_booking_group($1,$2,$3,$4::text[],false)', [id, court, day, ['12:00', '13:00']]);
            await fixture.pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
            await fixture.pg.query('select public.create_guest_booking_group($1,$2,$3,$4::text[],false,$5,$6,$7)', [guestId, court, day, ['14:00'], 'Guest Client', 'guest@example.test', '0731123456']);
            const tokenModule = await import(pathToFileURL(join(__dirname, '../functions/_shared/booking-token.ts')).href);
            const token = await tokenModule.deriveBookingCancellationToken('fixture-booking-stable-cancellation-secret', guestId);
            await fixture.pg.query('select public.attach_cancellation_token($1,$2)', [guestId, await tokenModule.hashCancellationToken(token)]);
            return { day, court, token };
        });
        const booking = await createBookingWorkflowFixture({ pg: fixture.pg, host, resolveUser: bearer => fixture.tokens.get(bearer), records: fixture.requests });
        const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
        const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
        assert.ok(sdkTag);
        const sdk = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '30', sdkTag[1]], { maxBuffer: 2 * 1024 * 1024 });
        assert.equal('sha384-' + createHash('sha384').update(sdk).digest('base64'), sdkTag[2]);
        browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
        async function pageFor(hash = '') {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Bucharest' }); contexts.push(context);
            await context.route(sdkTag[1], route => route.fulfill({ contentType: 'application/javascript', body: sdk, headers: { 'access-control-allow-origin': '*' } }));
            await context.route(url => url.hostname === host || url.hostname.endsWith('.supabase.co'), async route => {
                const req = route.request(), url = new URL(req.url());
                if (url.pathname === '/functions/v1/booking-workflow') {
                    if (req.postDataJSON()?.action === 'cancel') cancellationPosts++;
                    return fixture.serial(() => booking.browserRoute(route));
                }
                if (url.pathname === '/rest/v1/rpc/get_email_booking_context') return fixture.serial(async () => {
                    const user = fixture.tokens.get((req.headers().authorization || '').replace(/^Bearer /, ''));
                    try {
                        await fixture.pg.exec('reset role');
                        await fixture.pg.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
                        await fixture.pg.exec(`set role ${user ? 'authenticated' : 'anon'}`);
                        const result = await fixture.pg.query('select public.get_email_booking_context($1::uuid) value', [req.postDataJSON().p_booking_id]);
                        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result.rows[0].value), headers: { 'access-control-allow-origin': '*' } });
                    } catch (error) {
                        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: error.code, message: 'Not available for this account' }), headers: { 'access-control-allow-origin': '*' } });
                    }
                });
                return fixture.browserRoute(route);
            });
            await context.routeWebSocket(url => url.hostname.endsWith('.supabase.co'), socket => socket.close());
            const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
            await page.goto(base + hash, { waitUntil: 'networkidle' }); return page;
        }
        async function login(page, email) {
            await page.locator('#modal-auth').waitFor({ state: 'visible' });
            await page.locator('#login-email').fill(email); await page.locator('#login-parola').fill('fixture-password');
            await page.locator('#btn-executa-login').click(); await page.locator('#modal-auth').waitFor({ state: 'hidden' });
            await page.waitForLoadState('networkidle');
        }
        const client = await pageFor(`#spotivity-action=reservation&booking=${id}`);
        assert.equal(new URL(client.url()).hash, '');
        await login(client, 'alice@example.test');
        const details = client.locator('#modal-email-booking'); await details.waitFor({ state: 'visible' });
        assert.match(await details.innerText(), /Court A/); assert.match(await details.innerText(), /12:00–14:00/);
        assert.equal(await details.getAttribute('data-booking-id'), id);
        assert.equal(await details.getByRole('button', { name: 'Anulează rezervarea', exact: true }).count(), 1);
        for (const width of [320, 390, 1440]) {
            await client.setViewportSize({ width, height: 844 });
            assert.equal(await details.evaluate(node => document.documentElement.scrollWidth <= innerWidth + 1 && node.querySelector('.workflow-panel').getBoundingClientRect().right <= innerWidth + 1), true);
        }
        await details.locator('button').last().focus(); await client.keyboard.press('Tab');
        assert.equal(await details.locator('.workflow-close').evaluate(node => node === document.activeElement), true);
        await client.keyboard.press('Shift+Tab');
        assert.equal(await details.locator('button').last().evaluate(node => node === document.activeElement), true);
        pass('client booking email survives login, resolves only the authorised group and shows its complete consecutive interval at phone/desktop widths');
        await details.getByRole('button', { name: 'Chat cu baza sportivă' }).click();
        await client.locator('#modal-chat-client').waitFor({ state: 'visible' });
        await client.waitForFunction(() => document.getElementById('chat-client-teren-titlu').textContent.includes('Court A') && !document.getElementById('chat-client-input').disabled);
        assert.match(await client.locator('#chat-client-teren-titlu').innerText(), /Court A/);
        assert.equal(await client.locator('#chat-client-input').isEnabled(), true);
        pass('client email chat button opens the actual enabled conversation for the reserved court');

        const outsider = await pageFor(`#spotivity-action=reservation&booking=${id}`); await login(outsider, 'bob@example.test');
        await outsider.locator('#modal-email-booking').waitFor({ state: 'visible' });
        assert.match(await outsider.locator('#modal-email-booking').innerText(), /nu este disponibilă pentru acest cont/);
        assert.ok(!(await outsider.locator('#modal-email-booking').innerText()).includes('Court A'));
        pass('another confirmed account cannot reveal booking details from a copied email reference');

        const owner = await pageFor(`#spotivity-action=chat&booking=${id}`); await login(owner, 'admin@example.test');
        await owner.locator('#modal-chat-admin').waitFor({ state: 'visible' });
        await owner.waitForFunction(() => document.getElementById('chat-admin-conversație-titlu').textContent.includes('Alice'));
        assert.match(await owner.locator('#chat-admin-conversație-titlu').innerText(), /Alice|alice@example.test/);
        assert.equal(await owner.locator('#owner-home').isVisible(), true);
        pass('owner email opens its scoped administration and the reservation client conversation in the same site');
        await owner.locator('#modal-chat-admin .buton-inchidere').click();
        await owner.evaluate(bookingId => { location.hash = `spotivity-action=reservation&booking=${bookingId}`; }, id);
        const ownerDetails = owner.locator('#modal-email-booking'); await ownerDetails.waitFor({ state: 'visible' });
        assert.match(await ownerDetails.innerText(), /Alice/);
        assert.equal(await ownerDetails.getByRole('button', { name: 'Anulează rezervarea', exact: true }).count(), 0);
        await ownerDetails.getByRole('button', { name: 'Deschide programul' }).click();
        await owner.locator('#modal-tabel-program').waitFor({ state: 'visible' });
        await owner.waitForFunction(day => document.getElementById('tabel-data').value === day, seeded.day);
        assert.equal(await owner.locator('#tabel-teren').inputValue(), 'Court A');
        pass('owner management link opens the exact booking details, then its court calendar on the reserved date without a client cancellation capability');

        const guest = await pageFor(`#rezervare=${guestId}&token=${seeded.token}`);
        const guestView = guest.locator('#modal-anulare-rezervare-email'); await guestView.waitFor({ state: 'visible' });
        await guestView.getByRole('button', { name: 'Confirmă anularea' }).waitFor({ state: 'visible' });
        assert.match(await guestView.locator('.titlu-modal').innerText(), /Rezervarea ta/);
        assert.match(await guestView.locator('.workflow-summary').innerText(), /Court A/);
        assert.equal(new URL(guest.url()).hash, ''); assert.equal(cancellationPosts, 0);
        assert.equal(await guest.evaluate(() => JSON.stringify(localStorage).includes('token') || JSON.stringify(sessionStorage).includes('token')), false);
        await guestView.getByRole('button', { name: 'Confirmă anularea' }).click();
        await guestView.getByRole('status').filter({ hasText: 'Rezervarea a fost anulată' }).waitFor({ state: 'visible' });
        assert.equal(cancellationPosts, 1);
        pass('guest view link strips its private capability, previews without cancellation and cancels only after an explicit confirmation');

        const account = await pageFor('#spotivity-action=account'); await login(account, 'alice@example.test');
        await account.locator('#modal-profil').waitFor({ state: 'visible' });
        assert.match(await account.locator('#profil-email').innerText(), /alice@example.test/);
        assert.deepEqual(errors, []);
        pass('welcome account link resumes after login and opens the current profile without browser errors');
        const returning = await pageFor(`#spotivity-action=reservation&booking=${id}`);
        await returning.evaluate(() => {
            const timestamp = String(Date.now()); sessionStorage.setItem('spotivity.google-oauth.started-at', timestamp);
            window.saveSpotivityEmailIntent(timestamp);
        });
        await returning.goto(base, { waitUntil: 'networkidle' });
        await login(returning, 'alice@example.test');
        await returning.locator(`#modal-email-booking[data-booking-id="${id}"]`).waitFor({ state: 'visible' });
        assert.equal(await returning.evaluate(() => sessionStorage.getItem('spotivity.email-link.oauth')), null);
        pass('the explicit Google OAuth handoff resumes a validated non-secret email reference after a full-page return and consumes it once');
        console.log(`${checks} email-link browser checks passed`);
    } finally { for (const context of contexts) await context.close(); if (browser) await browser.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
