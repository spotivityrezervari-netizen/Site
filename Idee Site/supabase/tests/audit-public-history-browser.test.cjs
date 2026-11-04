// Real browser/production modules with disposable paginated adapters only.
// No network requests, hosted database changes, credentials or email are used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = name => readFileSync(join(__dirname, '../../js', name), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true }); });
after(async () => { await browser?.close(); });
async function pageFor(modules) {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<div id="modal-profil"></div><div id="modal-lista-rezervari"></div><h2 id="titlu-lista-rezervari"></h2><div id="container-rezervari"></div>
        <div id="modal-chat-client" style="display:flex"><div class="modal-chat-box"></div></div><button id="btn-vezi-chat"></button><button id="inchide-chat-client"></button><input id="chat-client-input"><button id="chat-client-btn-trimite"></button><p id="chat-client-avertisment"></p><div id="bulina-chat-client"></div><div id="chat-client-lista-terenuri"></div><div id="chat-client-teren-titlu"></div><div id="chat-client-mesaje"></div>`);
    for (const name of ['security.js', ...modules]) await page.addScriptTag({ content: source(name) });
    await page.evaluate(() => {
        window.lang = 'ro'; window.dict = { ro: { istoric: 'Istoric', rez_active: 'Active', fara_rezervari: 'Fără rezervări', vezi_locatia: 'Vezi locația', anuleaza: 'Anulează' } };
        window.traduData = value => value;
        window.esteRezervareTrecuta = (day, hour) => window.bookingEnded(day, hour);
        window.makeBooking = (id, override = {}) => ({ id, client_user_id: 'alice', booking_group_id: null, teren: `Court ${id}`, sport: 'Fotbal', data_str: window.siteDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), ora: '12:00', starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), stare: 'activa', pret_total: '100 RON', ...override });
        window.calls = [];
        window.rows = {};
        window.db = { from(table) {
            const filters = [], orders = []; let fields = '*';
            return { select(value) { fields = value; return this; }, eq(key, value) { filters.push([key, value]); return this; }, gte() { return this; }, order(key) { orders.push(key); return this; }, async range(first, last) {
                window.calls.push({ table, first, last, fields, orders, filters });
                if (window.pageGate) await window.pageGate;
                if (window.failPage === first) return { data: null, error: { message: 'Fixture page failed' } };
                const data = (window.rows[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
                // An actual PostgREST max_rows may be lower than the requested range.
                return { data: data.slice(first, Math.min(last + 1, first + 137)), error: null };
            } };
        } };
        window.state = { user: { id: 'alice', email: 'alice@example.test' }, courts: [] };
        window.services = { bookings: { invalidate() {} }, history: { invalidate() {} } };
    });
    return page;
}

test('recent grouped history reads every capped page and separates retained intervals, interior cancellations and amounts', async () => {
    const page = await pageFor(['modules/public-history.js']);
    try {
        await page.evaluate(async () => {
            window.rows.rezervari = Array.from({ length: 1003 }, (_, index) => window.makeBooking(index + 1));
            for (const [index, hour] of ['12:00', '13:00', '14:00'].entries()) window.rows.rezervari.push(window.makeBooking(2000 + index, { booking_group_id: 'partial', teren: 'Partially cancelled court', ora: hour, stare: index === 1 ? 'anulata' : 'activa' }));
            window.api = window.SpotivityModules.publicHistory({ db: window.db, state: window.state, services: window.services });
            await window.api.open('istoric');
        });
        assert.equal(await page.locator('#container-rezervari > div').count(), 1004);
        const card = page.locator('#container-rezervari > div').filter({ hasText: 'Partially cancelled court' });
        const text = await card.innerText();
        assert.match(text, /\[ACTIVE\].*\[PARTIALLY CANCELED\]/);
        assert.match(text, /Ore păstrate: 12:00–13:00, 14:00–15:00 · 200 RON/);
        assert.match(text, /Ore anulate: 13:00–14:00 · 100 RON/);
        assert.match(text, /Total ore păstrate: 200 RON/);
        assert.equal(await card.locator('.anulare-client').count(), 1);
        assert.ok(await page.evaluate(() => window.calls.some(call => call.first >= 1000)));
        assert.ok(await page.evaluate(() => window.calls.every(call => call.orders.includes('id'))));
    } finally { await page.close(); }
});

test('partially cancelled completed groups remain explicit in history and disappear from active bookings', async () => {
    const page = await pageFor(['modules/public-history.js']);
    try {
        await page.evaluate(async () => {
            const yesterday = window.siteDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
            const starts_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            window.rows.rezervari = [window.makeBooking(1, { booking_group_id: 'partial', data_str: yesterday, starts_at }), window.makeBooking(2, { booking_group_id: 'partial', data_str: yesterday, starts_at, ora: '13:00', stare: 'anulata' })];
            window.api = window.SpotivityModules.publicHistory({ db: window.db, state: window.state, services: window.services });
            await window.api.open('istoric');
        });
        const text = await page.locator('#container-rezervari').innerText();
        assert.match(text, /\[FINALIZED\].*\[PARTIALLY CANCELED\]/);
        assert.match(text, /Ore păstrate: 12:00–13:00 · 100 RON/);
        assert.match(text, /Ore anulate: 13:00–14:00 · 100 RON/);
        assert.equal(await page.locator('.anulare-client').count(), 0);
        await page.evaluate(() => window.api.open('active'));
        assert.equal(await page.locator('#container-rezervari').innerText(), 'Fără rezervări');
    } finally { await page.close(); }
});

test('a failed later history page reports failure instead of showing a partial or empty successful history', async () => {
    const page = await pageFor(['modules/public-history.js']);
    try {
        await page.evaluate(async () => {
            window.rows.rezervari = Array.from({ length: 200 }, (_, index) => window.makeBooking(index + 1)); window.failPage = 137;
            const api = window.SpotivityModules.publicHistory({ db: window.db, state: window.state, services: window.services });
            await api.open('istoric');
        });
        assert.match(await page.locator('#container-rezervari').innerText(), /nu au putut fi încărcate/);
        assert.equal(await page.locator('#container-rezervari > div').count(), 0);
    } finally { await page.close(); }
});

test('account changes invalidate delayed history before private rows are rendered', async () => {
    const page = await pageFor(['modules/public-history.js']);
    try {
        await page.evaluate(() => {
            window.rows.rezervari = [window.makeBooking(1)];
            window.pageGate = new Promise(resolve => { window.releasePage = resolve; });
            window.api = window.SpotivityModules.publicHistory({ db: window.db, state: window.state, services: window.services });
            window.pending = window.api.open('istoric');
        });
        await page.waitForFunction(() => window.calls.length > 0);
        await page.evaluate(async () => { window.state.user = null; window.api.invalidate(); document.getElementById('container-rezervari').textContent = 'Logged out'; window.releasePage(); await window.pending; });
        assert.equal(await page.locator('#container-rezervari').innerText(), 'Logged out');
    } finally { await page.close(); }
});

test('client chat reads messages and reserved courts beyond 1000 rows without losing late conversations', async () => {
    const page = await pageFor(['modules/public-chat.js']);
    try {
        await page.evaluate(async () => {
            window.rows.mesaje_chat = Array.from({ length: 1003 }, (_, index) => ({ id: index + 1, client_user_id: 'alice', teren: 'Court A', mesaj: `Message ${index + 1}`, expeditor: 'client', citit: true, created_at: new Date(Date.now() + index).toISOString() }));
            window.rows.rezervari = Array.from({ length: 1003 }, (_, index) => window.makeBooking(index + 1, { teren: index === 1002 ? 'Late court' : 'Court A' }));
            window.rows.terenuri = [{ id: 1, nume: 'Court A', are_chat: true }, { id: 2, nume: 'Late court', are_chat: true }];
            window.api = window.SpotivityModules.publicChat({ db: window.db, state: window.state, services: window.services });
            await window.api.load();
        });
        await page.waitForFunction(() => document.querySelectorAll('.card-conversatie').length === 2);
        assert.match(await page.locator('#chat-client-lista-terenuri').innerText(), /Late court/);
        await page.evaluate(() => window.api.selectCourt('Court A'));
        assert.equal(await page.locator('#chat-client-mesaje .mesaj-bula').count(), 1003);
        assert.match(await page.locator('#chat-client-mesaje .mesaj-bula').last().innerText(), /^Message 1003/);
        assert.equal(await page.locator('#chat-client-input').isDisabled(), false);
        assert.ok(await page.evaluate(() => window.calls.filter(call => call.table === 'mesaje_chat').every(call => call.orders.join(',') === 'created_at,id')));
    } finally { await page.close(); }
});

test('large client conversations acknowledge every unread message with bounded REST URLs', async () => {
    const page = await pageFor(['modules/public-chat.js']);
    try {
        await page.evaluate(async () => {
            window.rows.mesaje_chat = Array.from({length: 1003}, (_, index) => ({id: index + 1, client_user_id: 'alice', teren: 'Court A', mesaj: `Reply ${index + 1}`, expeditor: 'admin', citit: false, created_at: new Date(Date.now() + index).toISOString()}));
            window.rows.rezervari = [window.makeBooking(1, {teren: 'Court A'})];
            window.rows.terenuri = [{id: 1, nume: 'Court A', are_chat: true}];
            const from = window.db.from;
            window.readBatches = [];
            window.db.from = table => Object.assign(from(table), {update() {return {in: async (field, ids) => {
                window.readBatches.push(ids.slice()); return {error: null};
            }};}});
            window.api = window.SpotivityModules.publicChat({db: window.db, state: window.state, services: window.services});
            await window.api.load();
        });
        await page.waitForFunction(() => document.querySelectorAll('.card-conversatie').length === 1);
        await page.evaluate(() => window.api.selectCourt('Court A'));
        const batches = await page.evaluate(() => window.readBatches);
        assert.ok(batches.length > 1);
        assert.ok(batches.every(ids => ids.length <= 100));
        assert.deepEqual([...new Set(batches.flat())].sort((a, b) => a - b), Array.from({length: 1003}, (_, index) => index + 1));
    } finally { await page.close(); }
});

test('chat refresh preserves the draft and leaving then returning invalidates a delayed send', async () => {
    const page = await pageFor(['modules/public-chat.js']);
    try {
        await page.evaluate(async () => {
            window.rows.mesaje_chat = [];
            window.rows.rezervari = [window.makeBooking(1, { teren: 'Court A' }), window.makeBooking(2, { teren: 'Court B' })];
            window.rows.terenuri = [{ id: 1, nume: 'Court A', are_chat: true }, { id: 2, nume: 'Court B', are_chat: true }];
            const from = window.db.from;
            window.sent = [];
            window.db.from = table => Object.assign(from(table), { insert(rows) { window.sent.push(...rows); return Promise.resolve({ error: null }); } });
            window.db.channel = () => ({ on() { return this; }, subscribe() { return this; } });
            window.db.removeChannel = async () => {};
            window.api = window.SpotivityModules.publicChat({ db: window.db, state: window.state, services: window.services });
            await window.api.load(); await window.api.selectCourt('Court A');
            document.getElementById('chat-client-input').value = 'Keep this draft';
            await window.api.load();
        });
        assert.equal(await page.locator('#chat-client-input').inputValue(), 'Keep this draft', 'An incoming message/read receipt must not erase the composed text');
        await page.evaluate(async () => {
            window.api.mount();
            await window.api.selectCourt('Court A');
            const gate = new Promise(resolve => { window.releaseSend = resolve; });
            window.pageGate = gate;
            document.getElementById('chat-client-btn-trimite').click();
            window.pageGate = null;
            await window.api.selectCourt('Court B');
            await window.api.selectCourt('Court A');
            document.getElementById('chat-client-input').value = 'A new draft';
            window.releaseSend();
            // Queue a later read after the released send's permission read.
            await gate; await window.api.load();
        });
        assert.equal(await page.locator('#chat-client-input').inputValue(), 'A new draft');
        assert.deepEqual(await page.evaluate(() => window.sent), [], 'The abandoned send cannot resume when the same court is reselected');
    } finally { await page.close(); }
});
