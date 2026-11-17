// Real schedule module and Chromium clock; all database results stay in memory.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {chromium} = require('playwright');
let browser;
before(async () => {browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});});
after(async () => {await browser?.close();});

async function fixture(t, {day = '2026-11-15', end = '2026-11-15T09:00:00Z', starts = true, blocked = false, empty = false} = {}) {
    const context = await browser.newContext({timezoneId: 'America/Los_Angeles'});
    t.after(() => context.close());
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<div id="base-admin-workspace"><div id="modal-tabel-program" style="display:flex">
        <select id="tabel-teren"><option>Court A</option><option>Court B</option></select>
        <input id="tabel-data" value="${day}">
        <div id="schedule-scroll" style="height:280px;overflow:auto"><table><tbody id="tabel-corp-program"></tbody></table></div>
    </div></div>`);
    await page.clock.install({time: new Date(Date.parse(end) - 30000)});
    for (const name of ['security.js', 'modules/admin-schedule.js']) {
        await page.addScriptTag({content: readFileSync(join(__dirname, '../../js', name), 'utf8')});
    }
    await page.evaluate(async ({day, end, starts, blocked, empty}) => {
        window.scheduleState = {account: {user_id: 'staff', is_super: true}, authGeneration: 1, programGeneration: 0};
        const row = {id: 1, teren: 'Court A', data_str: day, ora: '10:00', email_client: blocked ? 'Teren Blocat' : 'client@example.test',
            stare: 'activa', pret_total: '100 RON', ...(starts ? {starts_at: new Date(Date.parse(end) - 3600000).toISOString()} : {})};
        window.scheduleRows = [row, {...row, id: 2, email_client: 'Teren Blocat'}, {...row, id: 3, ora: '13:00',
            ...(starts ? {starts_at: new Date(Date.parse(end) + 7200000).toISOString()} : {})},
            {...row, id: 4, ora: '14:00', stare: 'anulata'}];
        // An already-ended blocked slot keeps its closure details.
        scheduleRows[1].ora = '09:00';
        if (starts) scheduleRows[1].starts_at = new Date(Date.parse(end) - 7200000).toISOString();
        if (empty) scheduleRows = [];
        window.scheduleReads = 0; window.attendanceMounts = 0;
        window.spotivityReadAllRows = async factory => {
            const q = factory(); scheduleReads++;
            return {data: q.table === 'rezervari' ? scheduleRows.filter(row => row.stare !== 'anulata') : [], error: null};
        };
        window.loadBookingAttendanceControls = async ({container, isCurrent}) => {
            if (!isCurrent()) return;
            attendanceMounts++;
            container.querySelectorAll('.booking-attendance').forEach(target => {
                target.style.minHeight = '160px';
                target.innerHTML = '<input aria-label="Email client"><button disabled>Se salvează…</button>';
            });
        };
        window.schimbaStareNoua = select => {document.getElementById('form-inline-' + select.id.split('-').at(-1)).style.display = 'flex';};
        const db = {from(table) {return {table, select() {return this;}, eq() {return this;}, neq() {return this;},
            order() {return this;}, in() {return this;}, single: async () => {
                scheduleReads++;
                return {data: {nume: 'Court A', ore_rezervabile: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00']}, error: null};
            }};}};
        window.SpotivityModules.adminSchedule({db, state: scheduleState});
        await window.incarcaTabelProgram();
    }, {day, end, starts, blocked, empty});
    return page;
}

test('open schedule expires occupied controls without replacing attendance or empty-slot drafts', async t => {
    for (const options of [{}, {starts: false}, {day: '2027-07-10', end: '2027-07-10T08:00:00Z', starts: false}]) {
        const page = await fixture(t, options);
        const expiring = page.locator('tr[data-ora="10:00"]');
        assert.equal(await expiring.locator('.program-anulare').count(), 1);
        await expiring.locator('.booking-attendance input').fill('pending@example.test');
        await expiring.locator('.booking-attendance input').evaluate(node => {window.pendingAttendance = node;});
        await page.locator('#select-stare-1100').selectOption('ocupat');
        await page.locator('#inline-nume-1100').fill('Manual draft');
        const input = page.locator('tr[data-ora="13:00"] .booking-attendance input');
        await input.fill('another@example.test'); await input.focus();
        await input.evaluate(node => {window.focusedAttendance = node;});
        await page.locator('#schedule-scroll').evaluate(node => {node.scrollTop = 70;});
        const scroll = await page.locator('#schedule-scroll').evaluate(node => node.scrollTop);
        const reads = await page.evaluate(() => scheduleReads);
        await page.clock.fastForward(31000);
        assert.equal(await expiring.locator('.program-col-stare').innerText(), 'FINALIZATĂ');
        assert.equal(await expiring.locator('.program-anulare, select').count(), 0);
        assert.equal(await page.locator('tr[data-ora="13:00"] .program-anulare').count(), 1);
        assert.equal(await page.evaluate(() => pendingAttendance.isConnected && pendingAttendance.value === 'pending@example.test'), true);
        assert.equal(await page.evaluate(() => focusedAttendance === document.activeElement && focusedAttendance.isConnected), true);
        assert.equal(await page.locator('#inline-nume-1100').inputValue(), 'Manual draft');
        assert.equal(await page.locator('#select-stare-1100').isEnabled(), true, 'Empty historical slots stay manually bookable');
        assert.equal(await page.locator('#schedule-scroll').evaluate(node => node.scrollTop), scroll);
        assert.equal(await page.evaluate(() => attendanceMounts), 1);
        assert.equal(await page.evaluate(() => scheduleReads), reads, 'Expiry uses cached rows rather than database polling');
        assert.equal(await page.locator('tr[data-ora="09:00"] .program-col-stare').innerText(), 'FINALIZATĂ');
        assert.match(await page.locator('tr[data-ora="09:00"]').innerText(), /Închis de Admin/);
        assert.equal(await page.locator('tr[data-ora="09:00"] .booking-attendance').count(), 0);
        assert.equal(await page.locator('#select-stare-1400').isEnabled(), true, 'Canceled rows remain empty and manually bookable');
        await page.close();
    }
});

test('expiry moves focus from removed controls to their row', async t => {
    const page = await fixture(t);
    await page.locator('tr[data-ora="10:00"] .program-anulare').focus();
    await page.clock.fastForward(31000);
    assert.equal(await page.evaluate(() => document.activeElement.matches('tr[data-ora="10:00"]')), true);
});

test('blocked slots retain their closure details when their controls expire', async t => {
    const page = await fixture(t, {blocked: true});
    const row = page.locator('tr[data-ora="10:00"]');
    assert.equal(await row.locator('select').inputValue(), 'blocat');
    await page.clock.fastForward(31000);
    assert.equal(await row.locator('.program-col-stare').innerText(), 'FINALIZATĂ');
    assert.equal(await row.locator('.program-anulare, select, .booking-attendance').count(), 0);
    assert.match(await row.innerText(), /Închis de Admin/);
});

test('empty dates remain manually bookable throughout the supported calendar range', async t => {
    for (const day of ['0001-01-01', '9999-12-31']) {
        const page = await fixture(t, {day, empty: true});
        await page.locator('#select-stare-1100').selectOption('ocupat');
        await page.locator('#inline-nume-1100').fill('Historical manual entry');
        await page.clock.fastForward(31000);
        assert.equal(await page.locator('#select-stare-1100').isEnabled(), true, day);
        assert.equal(await page.locator('#inline-nume-1100').inputValue(), 'Historical manual entry', day);
        await page.close();
    }
});

test('schedule cache pauses while hidden and catches up without another read', async t => {
    for (const action of ['modal', 'workspace', 'tab']) {
        const page = await fixture(t);
        const reads = await page.evaluate(() => scheduleReads);
        await page.evaluate(action => {
            if (action === 'modal') document.getElementById('modal-tabel-program').style.display = 'none';
            if (action === 'workspace') document.getElementById('base-admin-workspace').hidden = true;
            if (action === 'tab') {Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'));}
        }, action);
        await page.clock.fastForward(31000);
        assert.equal(await page.locator('tr[data-ora="10:00"] .program-anulare').count(), 1, action);
        await page.evaluate(action => {
            if (action === 'modal') document.getElementById('modal-tabel-program').style.display = 'flex';
            if (action === 'workspace') document.getElementById('base-admin-workspace').hidden = false;
            if (action === 'tab') {Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'));}
        }, action);
        await page.waitForFunction(() => document.querySelector('tr[data-ora="10:00"] .program-col-stare').textContent === 'FINALIZATĂ');
        assert.equal(await page.evaluate(() => scheduleReads), reads);
        await page.close();
    }
});

test('schedule expiry abandons stale authentication and court/date scopes', async t => {
    for (const action of ['clear', 'account', 'court', 'date', 'generation']) {
        const page = await fixture(t);
        await page.evaluate(action => {
            if (action === 'clear') {scheduleState.authGeneration++; scheduleState.account = null; dispatchEvent(new Event('spotivity:admin-clear'));}
            if (action === 'account') {scheduleState.authGeneration++; scheduleState.account = {user_id: 'other', is_super: true};}
            if (action === 'court') document.getElementById('tabel-teren').value = 'Court B';
            if (action === 'date') document.getElementById('tabel-data').value = '2026-11-16';
            if (action === 'generation') scheduleState.programGeneration++;
        }, action);
        await page.clock.fastForward(31000);
        await page.evaluate(() => dispatchEvent(new Event('focus')));
        assert.equal(await page.locator('tr[data-ora="10:00"] .program-anulare').count(), 1, action);
        await page.close();
    }
});
