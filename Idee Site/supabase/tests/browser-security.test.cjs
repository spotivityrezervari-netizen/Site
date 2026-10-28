// Browser helpers must not turn stored URLs or historical fields into active content.
// No hosted credentials, live data, external traffic, or email is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { chromium } = require('playwright');
const source = name => readFileSync(join(__dirname, '../../js', name), 'utf8');

test('public URL helper preserves secure links and bundled assets, rejects credentials, plaintext and active schemes', () => {
    const window = {};
    runInNewContext(source('security.js'), { window, URL, Intl, Date, document: { addEventListener() {} } });
    for (const link of [
        'https://maps.app.goo.gl/validMap123?g_st=ic',
        'https://www.google.com/maps/search/?api=1&query=Spotivity',
        'https://ndubcdwohqzgxpuiowye.supabase.co/storage/v1/object/public/poze-baze/exemplu.webp'
    ]) assert.equal(window.safeUrl(link), link);
    assert.equal(window.safeUrl('assets/imagini/avatar2.png', true), 'assets/imagini/avatar2.png');
    for (const link of [
        'http://example.test/location',
        'https://user:password@example.test/location',
        'https://user@example.test/location',
        'https://example.test\n/location',
        'https://example.test/location\u0000',
        'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
        'blob:https://example.test/id', '//example.test/location', '/private-file',
        'assets/imagini/../../secret', 'assets/imagini/avatar2.png" onerror="alert(1)'
    ]) assert.equal(window.safeUrl(link, true), '', link);
    assert.equal(window.safeUrl('assets/imagini/avatar2.png'), '');
});

test('administrator history renders hostile legacy date/hour values as readable text, without creating executable elements', async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.abort());
        await page.setContent('<main><button id="btn-istoric">Istoric</button><div id="container-istoric"></div></main>');
        await page.addScriptTag({ content: source('security.js') });
        await page.addScriptTag({ content: source('modules/admin-history.js') });
        await page.evaluate(async () => {
            const date = '<svg onload="window.__legacyDateExecuted=true">';
            const hour = '<img src=x onerror="window.__legacyHourExecuted=true">';
            window.lang = 'ro';
            window.bookingInRecentHistory = () => true;
            window.bookingEnded = () => false;
            window.traduData = value => value;
            const row = { id: 7, sport: 'Fotbal', teren: 'Court A', data_str: date, ora: hour,
                email_client: 'Manual client', stare: 'activa', pret_total: '100 RON' };
            window.SpotivityModules.adminHistory({
                state: { account: { is_super: true }, authGeneration: 1 },
                db: { from: table => ({ select: async () => ({ data: table === 'rezervari' ? [row] : [], error: null }) }) }
            });
            await window.reincarcaIstoricAdmin();
        });
        const history = page.locator('#container-istoric');
        assert.ok((await history.innerText()).includes('<svg onload="window.__legacyDateExecuted=true">'));
        assert.ok((await history.innerText()).includes('<img src=x onerror="window.__legacyHourExecuted=true">'));
        assert.equal(await history.locator('svg,img,script').count(), 0);
        assert.deepEqual(await page.evaluate(() => ({ date: window.__legacyDateExecuted, hour: window.__legacyHourExecuted })), { date: undefined, hour: undefined });
        assert.equal(await history.locator('[data-cancel-history]').count(), 1, 'Normal authorized history actions remain available');
    } finally { await browser.close(); }
});
