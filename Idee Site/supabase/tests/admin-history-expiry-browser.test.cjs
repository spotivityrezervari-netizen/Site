// Real history module and Chromium clock; no hosted Auth, database or email.
const {chromium} = require('playwright');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const root = join(__dirname, '../..');

(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
    try {
        async function historyPage({day = '2026-11-15', end = '2026-11-15T09:00:00Z', starts = true} = {}) {
            const context = await browser.newContext({timezoneId: 'America/Los_Angeles'});
            const page = await context.newPage();
            await page.route('**/*', route => route.abort());
            await page.setContent('<div id="base-admin-workspace"><div id="modal-istoric" style="display:flex"><button id="btn-istoric">Încarcă</button><div id="container-istoric" style="height:260px;overflow:auto"></div></div></div>');
            await page.clock.install({time: new Date(Date.parse(end) - 30000)});
            for (const name of ['security.js', 'modules/admin-history.js']) await page.addScriptTag({content: readFileSync(join(root, 'js', name), 'utf8')});
            await page.evaluate(async options => {
                window.lang = 'ro';
                window.traduData = value => value;
                window.historyState = {authGeneration: 1, account: {user_id: 'staff', is_super: false, terenuri: 'Test Court'}};
                const start = Date.parse(options.end) - 3600000;
                const row = {id: 1, teren: 'Test Court', sport: 'Fotbal', data_str: options.day, ora: '10:00', email_client: 'client@example.test', stare: 'activa', pret_total: '100 RON', ...(options.starts ? {starts_at: new Date(start).toISOString()} : {})};
                window.historyRows = [row, {...row, id: 2, ora: '13:00', ...(options.starts ? {starts_at: new Date(start + 10800000).toISOString()} : {})}];
                window.historyReads = 0;
                window.attendanceMounts = 0;
                window.spotivityReadAllRows = async factory => {
                    const query = factory(); historyReads++;
                    return {data: query.table === 'rezervari' ? historyRows : [], error: null};
                };
                window.loadBookingAttendanceControls = async ({container, isCurrent}) => {
                    if (!isCurrent()) return;
                    attendanceMounts++;
                    container.querySelectorAll('.admin-history-card').forEach(card => {card.style.minHeight = '170px';});
                    container.querySelectorAll('.booking-attendance').forEach(target => {
                        target.innerHTML = '<input aria-label="Email client"><button disabled>Se salvează…</button>';
                    });
                };
                const db = {from(table) { return {table, select() {return this;}, order() {return this;}}; }};
                window.SpotivityModules.adminHistory({db, state: historyState});
                await window.reincarcaIstoricAdmin();
            }, {day, end, starts});
            return {page, context};
        }
        for (const options of [{}, {day: '2027-07-10', end: '2027-07-10T08:00:00Z', starts: false}, {starts: false}]) {
            const {page, context} = await historyPage(options);
            assert.match(await page.locator('.admin-history-card').first().innerText(), /\[ACTIVĂ\]/);
            assert.equal(await page.locator('[data-cancel-history]').count(), 2);
            await page.locator('.admin-history-card').first().locator('input').fill('pending@example.test');
            await page.locator('.admin-history-card').first().locator('input').evaluate(node => {window.expiringAttendanceInput = node;});
            const input = page.locator('.admin-history-card').nth(1).locator('input');
            await input.fill('draft@example.test'); await input.focus();
            await input.evaluate(node => {window.savedAttendanceInput = node;});
            await page.locator('#container-istoric').evaluate(node => {node.scrollTop = 55;});
            const scroll = await page.locator('#container-istoric').evaluate(node => node.scrollTop);
            await page.clock.fastForward(31000);
            assert.match(await page.locator('.admin-history-card').first().innerText(), /\[FINALIZATĂ\]/);
            assert.equal(await page.locator('.admin-history-card').first().locator('[data-cancel-history]').count(), 0);
            assert.match(await page.locator('.admin-history-card').nth(1).innerText(), /\[ACTIVĂ\]/);
            assert.equal(await page.evaluate(() => savedAttendanceInput === document.activeElement && savedAttendanceInput.isConnected), true);
            assert.equal(await page.evaluate(() => expiringAttendanceInput.isConnected && expiringAttendanceInput.value === 'pending@example.test'), true);
            assert.equal(await input.inputValue(), 'draft@example.test');
            assert.equal(await page.locator('#container-istoric').evaluate(node => node.scrollTop), scroll);
            assert.equal(await page.evaluate(() => attendanceMounts), 1, 'Clock updates must not remount attendance controls');
            assert.equal(await page.evaluate(() => historyReads), 2, 'Clock updates must not poll database');
            await context.close();
        }
        console.log('PASS staff history expires in winter/summer Bucharest time, preserves attendance drafts/focus/scroll and makes no database requests');

        for (const action of ['close', 'hidden-tab', 'hidden-workspace', 'admin-clear', 'role-change']) {
            const {page, context} = await historyPage();
            await page.evaluate(action => {
                if (action === 'close') document.getElementById('modal-istoric').style.display = 'none';
                if (action === 'hidden-tab') {Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}); document.dispatchEvent(new Event('visibilitychange'));}
                if (action === 'hidden-workspace') document.getElementById('base-admin-workspace').hidden = true;
                if (action === 'admin-clear') {historyState.authGeneration++; historyState.account = null; dispatchEvent(new Event('spotivity:admin-clear'));}
                if (action === 'role-change') {historyState.authGeneration++; historyState.account = {user_id: 'other', is_super: true};}
            }, action);
            await page.clock.fastForward(31000);
            assert.match(await page.locator('.admin-history-card').first().textContent(), /\[ACTIVĂ\]/, action);
            assert.equal(await page.evaluate(() => historyReads), 2, action);
            if (['close', 'hidden-tab', 'hidden-workspace'].includes(action)) {
                await page.evaluate(action => {
                    if (action === 'close') document.getElementById('modal-istoric').style.display = 'flex';
                    if (action === 'hidden-tab') {Object.defineProperty(document, 'hidden', {configurable: true, get: () => false}); document.dispatchEvent(new Event('visibilitychange'));}
                    if (action === 'hidden-workspace') document.getElementById('base-admin-workspace').hidden = false;
                }, action);
                await page.waitForFunction(() => document.querySelector('.admin-history-card').textContent.includes('[FINALIZATĂ]'));
            } else {
                await page.evaluate(() => dispatchEvent(new Event('focus')));
                assert.match(await page.locator('.admin-history-card').first().textContent(), /\[ACTIVĂ\]/, action);
            }
            await context.close();
        }
        console.log('PASS hidden and unauthorized staff history stops updating; returning to visible history catches up from cache');

        {
            const {page, context} = await historyPage();
            await page.evaluate(() => {
                let held = false;
                window.spotivityReadAllRows = async factory => {
                    const query = factory();
                    if (query.table !== 'rezervari') return {data: [], error: null};
                    if (!held) {
                        held = true; const oldRows = historyRows.map(row => ({...row, teren: 'Old Court'}));
                        await new Promise(resolve => {window.releaseOldHistory = resolve;});
                        return {data: oldRows, error: null};
                    }
                    return {data: historyRows.map(row => ({...row, teren: 'Latest Court'})), error: null};
                };
                historyState.account = {...historyState.account, is_super: true};
                window.oldHistoryRequest = window.reincarcaIstoricAdmin();
            });
            await page.waitForFunction(() => typeof releaseOldHistory === 'function');
            await page.evaluate(() => window.reincarcaIstoricAdmin());
            await page.evaluate(async () => {releaseOldHistory(); await oldHistoryRequest;});
            assert.match(await page.locator('#container-istoric').innerText(), /Latest Court/);
            assert.doesNotMatch(await page.locator('#container-istoric').innerText(), /Old Court/);
            await context.close();
        }
        console.log('PASS late history response cannot overwrite the latest reload');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
