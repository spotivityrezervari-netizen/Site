// Exercise the real email cancellation dialog with local responses only.
// The cancellation capability must stay in memory while a failed read is retried.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const script = readFileSync(join(__dirname, '../../js/guest-booking.js'), 'utf8');
const bookingId = '00000000-0000-0000-0000-000000000009';
const token = 'a'.repeat(64);
const preview = { booking_id: bookingId, court_name: 'Teren A', day: '2030-06-12', hours: ['17:00'], total: 100, state: 'activa', can_cancel: true };

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const setup = async handler => {
            const page = await browser.newPage();
            const requests = [], failures = [];
            page.on('pageerror', error => failures.push(error.message));
            await page.route('**/*', async route => {
                const request = route.request(), url = new URL(request.url());
                if (url.host === 'cancellation-ui.test') {
                    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="UTF-8"></head><body><script>const supabaseUrl='https://project.test';const supabaseKey='public-anon';window.bookingEnded=()=>false;</script><script>${script}</script></body></html>` });
                }
                assert.equal(url.href, 'https://project.test/functions/v1/booking-workflow');
                assert.equal(new URL(page.url()).hash, '', 'The capability leaves the URL before every request');
                const item = { body: request.postDataJSON(), headers: request.headers() };
                requests.push(item);
                const response = await handler(item, requests.length);
                if (response.abort) return route.abort('failed');
                return route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: response.raw ?? JSON.stringify(response.data) });
            });
            await page.goto(`https://cancellation-ui.test/#anulare-rezervare=${bookingId}&token=${token}`, { waitUntil: 'domcontentloaded' });
            return { page, requests, failures };
        };

        for (const failure of [
            { abort: true },
            { status: 503, data: { code: 'service_unavailable', error: 'Try again later' } },
            { status: 429, data: { code: 'rate_limit', error: 'Too many requests' } },
            { status: 200, data: { booking_id: 'unconfirmed-response' } },
            { status: 200, data: null },
            { status: 200, raw: '{' }
        ]) {
            let release;
            const t = await setup((item, count) => {
                if (count === 1) return failure;
                if (item.body.action === 'preview_cancel') return new Promise(resolve => { release = () => resolve({ status: 200, data: preview }); });
                return { status: 200, data: { ...preview, state: 'anulata' } };
            });
            await t.page.waitForFunction(() => document.querySelector('.workflow-status')?.textContent !== 'Se verifică rezervarea…');
            assert.equal(await t.page.locator('#email-booking-preview-retry').count(), 1, 'A failed preview needs an explicit retry action');
            await t.page.locator('#email-booking-preview-retry').waitFor({ state: 'visible' });
            assert.equal(await t.page.locator('#email-booking-cancel-confirm').isVisible(), false);
            assert.equal(t.requests.length, 1, 'A failed preview is never retried automatically');
            await t.page.evaluate(() => {
                const retry = document.getElementById('email-booking-preview-retry');
                retry.click(); retry.click();
                document.getElementById('email-booking-cancel-confirm').click();
            });
            await t.page.waitForFunction(() => document.getElementById('email-booking-preview-retry').disabled);
            await t.page.waitForTimeout(50);
            assert.equal(t.requests.length, 2, 'Busy retry cannot overlap another preview or cancel before it is confirmed');
            assert.equal(t.requests[1].body.action, 'preview_cancel');
            assert.deepEqual(t.requests[1].body, t.requests[0].body, 'Retry keeps the same in-memory capability');
            release();
            await t.page.locator('#email-booking-cancel-confirm').waitFor({ state: 'visible' });
            assert.equal(await t.page.locator('#email-booking-preview-retry').isVisible(), false);
            assert.equal(t.requests.length, 2, 'A successful preview still requires explicit cancellation');
            await t.page.locator('#email-booking-cancel-confirm').click();
            await t.page.waitForFunction(() => document.querySelector('.workflow-status').textContent.includes('a fost anulată'));
            assert.equal(t.requests.length, 3);
            assert.equal(t.requests[2].body.action, 'cancel');
            assert.equal(t.requests[2].body.token, token);
            assert.equal(t.requests.every(item => item.headers.authorization === undefined), true);
            assert.deepEqual(await t.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
            assert.deepEqual(t.failures, []);
            await t.page.close();
        }
        console.log('PASS network, server, rate-limit and malformed success preview failures allow one explicit retry before cancellation');

        for (const [status, code] of [[403, 'invalid_cancellation'], [403, 'invalid_token'], [403, 'forbidden'], [400, 'invalid_input'], [409, 'completed_booking'], [503, 'invalid_cancellation']]) {
            const t = await setup(() => ({ status, data: { code, error: 'Permanent failure' } }));
            await t.page.waitForFunction(() => document.querySelector('.workflow-status')?.textContent !== 'Se verifică rezervarea…');
            assert.equal(await t.page.locator('#email-booking-preview-retry').isVisible(), false);
            assert.equal(await t.page.locator('#email-booking-cancel-confirm').isVisible(), false);
            await t.page.evaluate(() => document.getElementById('email-booking-preview-retry').click());
            await t.page.waitForTimeout(25);
            assert.equal(t.requests.length, 1, 'A permanent refusal cannot reuse the capability');
            assert.deepEqual(t.failures, []);
            await t.page.close();
        }
        console.log('PASS permanent preview refusals expose neither retry nor cancellation');

        {
            const t = await setup(() => ({ status: 503, data: { code: 'service_unavailable', error: 'Try again later' } }));
            await t.page.locator('#email-booking-preview-retry').waitFor({ state: 'visible' });
            await t.page.evaluate(() => { window.detachedRetry = document.getElementById('email-booking-preview-retry'); });
            await t.page.getByRole('button', { name: 'Închide', exact: true }).last().click();
            await t.page.locator('#modal-anulare-rezervare-email').waitFor({ state: 'detached' });
            await t.page.evaluate(() => window.detachedRetry.click());
            await t.page.waitForTimeout(25);
            assert.equal(t.requests.length, 1, 'Closing destroys the capability even if a detached action is invoked');
            await t.page.reload({ waitUntil: 'domcontentloaded' });
            assert.equal(await t.page.locator('#modal-anulare-rezervare-email').count(), 0);
            assert.deepEqual(t.failures, []);
            await t.page.close();
        }
        console.log('PASS closing and reloading do not retain the cancellation capability');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
