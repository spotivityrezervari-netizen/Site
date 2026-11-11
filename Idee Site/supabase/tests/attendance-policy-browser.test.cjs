// Production markup/modules with local adapters. No live booking or email calls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = name => readFileSync(join(__dirname, '../../js', name), 'utf8');
const html = readFileSync(join(__dirname, '../../index.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
const warnings = {
    ro: 'La mai mult de 3 neprezentări sau anulări târzii, riști închiderea contului.',
    hu: 'Több mint 3 meg nem jelenés vagy késői lemondás esetén a fiókod megszüntetését kockáztatod.',
    en: 'More than 3 no-shows or late cancellations may lead to your account being closed.'
};
const bookingId = '00000000-0000-0000-0000-000000000009';
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true }); });
after(async () => { await browser?.close(); });

async function pageFor(language, hash = '') {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', route => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
        const url = new URL(route.request().url());
        if (url.origin === 'https://attendance-ui.test' && /^\/css\/[a-z-]+\.css$/.test(url.pathname)) {
            return route.fulfill({ contentType: 'text/css', body: readFileSync(join(__dirname, '../..', url.pathname), 'utf8') });
        }
        return route.abort();
    });
    await page.goto(`https://attendance-ui.test/${hash}`, { waitUntil: 'domcontentloaded' });
    for (const file of ['security.js', 'modules/public-i18n.js']) await page.evaluate(code => (0, eval)(code), source(file));
    await page.evaluate(language => { window.SpotivityModules.publicI18n(); window.schimbaLimba(language); }, language);
    return page;
}

for (const [language, warning] of Object.entries(warnings)) {
    test(`${language}: the booking warning is readable and linked to the confirmation button`, async () => {
        const page = await pageFor(language);
        try {
            await page.evaluate(() => { document.getElementById('modal-rezervare').style.display = 'flex'; });
            assert.equal(await page.locator('#booking-attendance-warning').innerText(), warning);
            assert.equal(await page.locator('#booking-attendance-warning').isVisible(), true);
            assert.equal(await page.locator('#buton-confirma').getAttribute('aria-describedby'), 'booking-attendance-warning');
            assert.equal(await page.locator('#booking-attendance-warning').evaluate(node => !!(node.compareDocumentPosition(document.getElementById('buton-confirma')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
            for (const width of [320, 390, 1440]) {
                await page.setViewportSize({ width, height: 844 });
                await page.locator('#booking-attendance-warning').scrollIntoViewIfNeeded();
                const layout = await page.locator('#booking-attendance-warning').evaluate(node => {
                    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
                    return { left: rect.left, right: rect.right, viewport: innerWidth, font: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), border: style.borderTopStyle };
                });
                assert.ok(layout.left >= 0 && layout.right <= layout.viewport + 1 && layout.font >= 14 && layout.lineHeight >= 20 && layout.border === 'solid', JSON.stringify(layout));
            }
            await page.evaluate(() => window.schimbaLimba('ro'));
            assert.equal(await page.locator('#booking-attendance-warning').innerText(), warnings.ro, 'Open booking policy follows the selected language');
            assert.equal(await page.evaluate(() => window.dict[window.lang].disclaimer), 'Rezervarea poate fi anulată gratuit până la încheierea orei rezervate.');
        } finally { await page.close(); }
    });

    test(`${language}: grouped and historical cancellation confirmations show the warning before acting`, async () => {
        const page = await pageFor(language);
        try {
            await page.evaluate(code => (0, eval)(code), source('modules/public-history.js'));
            await page.evaluate(async bookingId => {
                window.fixtureCancelCalls = [];
                window.fixtureRows = [
                    { id: '1', booking_group_id: bookingId, teren: 'Grouped court', sport: 'Fotbal', data_str: '2027-01-03', ora: '12:00', stare: 'activa', pret_total: '100 RON' },
                    { id: '2', booking_group_id: null, teren: 'Historical court', sport: 'Tenis', data_str: '2027-01-03', ora: '13:00', stare: 'activa', pret_total: '100 RON' }
                ];
                window.esteRezervareTrecuta = () => false;
                window.bookingInRecentHistory = () => true;
                window.spotivityReadAllRows = async () => ({ data: window.fixtureRows, error: null });
                const db = { from: () => ({ select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, update: () => ({ eq: async (_, id) => { window.fixtureCancelCalls.push({ type: 'historical', id }); return { error: null }; } }) }) };
                window.SpotivityBooking = { cancelOwned: async (id, owner) => window.fixtureCancelCalls.push({ type: 'group', id, owner }) };
                window.fixtureHistory = window.SpotivityModules.publicHistory({ db, state: { user: { id: 'current-client' }, courts: [] }, services: {} });
                window.fixtureHistory.mount(); await window.fixtureHistory.open('active');
            }, bookingId);
            for (const id of ['1', '2']) {
                let message = '';
                page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
                await page.locator(`.anulare-client[data-id="${id}"]`).click();
                assert.ok(message.includes(warning), message);
                assert.equal(await page.evaluate(() => window.fixtureCancelCalls.length), Number(id) - 1, 'Dismissing confirmation leaves the booking intact');
                page.once('dialog', dialog => dialog.accept());
                await page.locator(`.anulare-client[data-id="${id}"]`).click();
                await page.waitForFunction(expected => window.fixtureCancelCalls.length === expected, Number(id));
            }
            assert.deepEqual(await page.evaluate(() => window.fixtureCancelCalls), [{ type: 'group', id: bookingId, owner: 'current-client' }, { type: 'historical', id: '2' }]);
        } finally { await page.close(); }
    });

    test(`${language}: the account email link warns before cancellation and requires its confirmation`, async () => {
        const page = await pageFor(language, `#spotivity-action=reservation&booking=${bookingId}`);
        try {
            await page.evaluate(code => (0, eval)(code), source('email-links.js'));
            await page.evaluate(bookingId => {
                window.fixtureCancelCalls = [];
                window.SpotivityBooking = { cancelOwned: async (id, owner) => window.fixtureCancelCalls.push({ id, owner }) };
                const db = { rpc: async () => ({ data: { booking_id: bookingId, court_name: 'Client court', hours: ['12:00'], day: '2027-01-03', total: 100, status: 'activa', can_chat: false, can_cancel: true, is_owner: false }, error: null }) };
                const api = window.SpotivityModules.emailLinks({ db, state: { user: { id: 'current-client' } }, services: {} }); api.mount();
            }, bookingId);
            const modal = page.locator('#modal-email-booking'); await modal.waitFor({ state: 'visible' });
            assert.equal(await modal.locator('.workflow-attendance-warning').innerText(), warning);
            assert.equal(await modal.locator('.workflow-attendance-warning').isVisible(), true);
            assert.equal(await page.evaluate(() => window.fixtureCancelCalls.length), 0);
            let message = '';
            page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
            await modal.getByRole('button', { name: 'Anulează rezervarea', exact: true }).click();
            assert.ok(message.includes(warning), message);
            assert.equal(await page.evaluate(() => window.fixtureCancelCalls.length), 0);
            page.once('dialog', dialog => dialog.accept());
            await modal.getByRole('button', { name: 'Anulează rezervarea', exact: true }).click();
            await page.waitForFunction(() => window.fixtureCancelCalls.length === 1);
            assert.deepEqual(await page.evaluate(() => window.fixtureCancelCalls), [{ id: bookingId, owner: 'current-client' }]);
            assert.equal(await modal.locator('.workflow-attendance-warning').isVisible(), false);
        } finally { await page.close(); }
    });
}
