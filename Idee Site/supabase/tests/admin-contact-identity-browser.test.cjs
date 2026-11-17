// Actual staff modules in isolated Chromium; profiles and bookings stay in memory.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {chromium} = require('playwright');
let browser;
before(async () => {browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});});
after(async () => {await browser?.close();});

async function fixture(t, module) {
    const context = await browser.newContext({timezoneId: 'Europe/Bucharest'});
    t.after(() => context.close());
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<div id="base-admin-workspace">
        <div id="modal-istoric" style="display:flex"><div id="container-istoric"></div></div>
        <div id="modal-tabel-program" style="display:flex"><select id="tabel-teren"><option>Court A</option></select>
        <input id="tabel-data" value="2026-11-17"><table><tbody id="tabel-corp-program"></tbody></table></div>
    </div>`);
    await page.clock.install({time: new Date('2026-11-17T06:00:00Z')});
    for (const name of ['security.js', `modules/admin-${module}.js`]) {
        await page.addScriptTag({content: readFileSync(join(__dirname, '../../js', name), 'utf8')});
    }
    await page.evaluate(async module => {
        window.lang = 'ro';
        window.traduData = value => value;
        const row = {teren: 'Court A', sport: 'Fotbal', data_str: '2026-11-17', stare: 'activa', pret_total: '100 RON'};
        window.identityRows = [
            {...row, id: 1, ora: '10:00', email_client: 'reused@example.test', client_user_id: null},
            {...row, id: 2, ora: '11:00', email_client: 'reused@example.test', client_user_id: '00000000-0000-4000-8000-000000000001'},
            {...row, id: 3, ora: '12:00', email_client: 'old@example.test', client_user_id: '00000000-0000-4000-8000-000000000002'},
            {...row, id: 4, ora: '13:00', email_client: 'reused@example.test', client_user_id: '00000000-0000-4000-8000-000000000003'},
            {...row, id: 5, ora: '14:00', email_client: 'reused@example.test', client_user_id: null, guest_name: 'Reservation guest', guest_phone: '0700000000'},
            {...row, id: 6, ora: '15:00', email_client: 'reused@example.test', client_user_id: '00000000-0000-4000-8000-000000000001', guest_name: 'Explicit guest', guest_phone: '0711111111'}
        ];
        const profiles = [
            {id: 1, user_id: '00000000-0000-4000-8000-000000000001', email: 'reused@example.test', nume: 'New email owner', telefon: '0722222222'},
            {id: 2, user_id: '00000000-0000-4000-8000-000000000002', email: 'canonical@example.test', nume: 'Same UUID contact', telefon: '0733333333'}
        ];
        window.identityQueries = [];
        window.identityChats = [];
        window.deschideChatDinTabel = (...args) => identityChats.push(args);
        window.spotivityReadAllRows = async factory => {
            const q = factory();
            identityQueries.push({table: q.table, filters: q.filters});
            return {data: q.table === 'rezervari' ? identityRows : profiles.filter(profile => q.filters.every(({column, values}) => values.includes(profile[column]))), error: null};
        };
        const db = {from(table) {return {table, filters: [], select() {return this;}, eq() {return this;}, neq() {return this;},
            order() {return this;}, in(column, values) {this.filters.push({column, values}); return this;},
            single: async () => ({data: {nume: 'Court A', ore_rezervabile: identityRows.map(row => row.ora), are_chat: true}, error: null})};}};
        const state = {account: {user_id: 'staff', is_super: false, terenuri: 'Court A'}, authGeneration: 1, programGeneration: 0};
        if (module === 'history') {
            window.SpotivityModules.adminHistory({db, state});
            await window.reincarcaIstoricAdmin();
        } else {
            window.SpotivityModules.adminSchedule({db, state});
            await window.incarcaTabelProgram();
        }
    }, module);
    return page;
}

for (const module of ['history', 'schedule']) {
    test(`${module}: contact details require the reservation account UUID`, async t => {
        const page = await fixture(t, module);
        const rows = module === 'history' ? page.locator('.admin-history-card') : page.locator('tr[data-ora]');
        for (const index of [0, 3]) {
            assert.match(await rows.nth(index).innerText(), /reused@example\.test/, `row ${index} keeps its stored contact`);
            assert.doesNotMatch(await rows.nth(index).innerText(), /New email owner|0722222222/, `row ${index} must not borrow a profile by email`);
        }
        assert.match(await rows.nth(1).innerText(), /New email owner/);
        assert.match(await rows.nth(1).innerText(), /0722222222/);
        assert.match(await rows.nth(2).innerText(), /Same UUID contact/);
        assert.match(await rows.nth(2).innerText(), /0733333333/);
        assert.match(await rows.nth(2).innerText(), /canonical@example\.test/);
        for (const [index, name, phone] of [[4, 'Reservation guest', '0700000000'], [5, 'Explicit guest', '0711111111']]) {
            assert.match(await rows.nth(index).innerText(), new RegExp(name));
            assert.match(await rows.nth(index).innerText(), new RegExp(phone));
            assert.doesNotMatch(await rows.nth(index).innerText(), /New email owner|0722222222/);
        }
    });
}

test('schedule: chat requires a matched UUID profile and uses its canonical email', async t => {
    const page = await fixture(t, 'schedule');
    for (const hour of ['10:00', '13:00', '14:00', '15:00']) {
        assert.equal(await page.locator(`tr[data-ora="${hour}"] .btn-tabel-chat`).count(), 0, `${hour} has no proven account contact`);
    }
    await page.locator('tr[data-ora="11:00"] .btn-tabel-chat').click();
    await page.locator('tr[data-ora="12:00"] .btn-tabel-chat').click();
    assert.deepEqual(await page.evaluate(() => identityChats), [
        ['reused@example.test', 'Court A', 'New email owner'],
        ['canonical@example.test', 'Court A', 'Same UUID contact']
    ]);
    const profileQuery = (await page.evaluate(() => identityQueries)).find(query => query.table === 'clienti');
    assert.deepEqual(profileQuery.filters, [{column: 'user_id', values: [
        '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'
    ]}]);
});
