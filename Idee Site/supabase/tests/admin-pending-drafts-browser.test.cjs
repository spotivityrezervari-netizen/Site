// Real administration modules and native Chromium controls; database calls stay in memory.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {chromium} = require('playwright');
let browser;
before(async () => {browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});});
after(async () => {await browser?.close();});

async function fixture(t) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.route('**/*', route => route.abort());
    await page.setContent(`
        <div id="modal-tabel-program" style="display:flex">
            <select id="tabel-teren"><option>Court A</option></select>
            <input id="tabel-data" value="2099-11-03">
            <table><tbody id="tabel-corp-program"></tbody></table>
        </div>
        <div id="modal-creeaza-cont" style="display:flex">
            <input id="super-nume" value="First Admin"><input id="super-email" value="first@example.test">
            <input type="checkbox" id="check-super-admin">
            <input type="checkbox" class="check-teren-alocat" value="Court A" checked>
            <input type="checkbox" class="check-teren-alocat" value="Court B">
            <button id="creeaza-supervisor-btn">Alocă Terenuri</button>
        </div>`);
    for (const name of ['security.js', 'modules/admin-core.js', 'modules/admin-schedule.js', 'modules/admin-bookings.js', 'modules/admin-allocations.js']) {
        await page.addScriptTag({content: readFileSync(join(__dirname, '../../js', name), 'utf8')});
    }
    await page.evaluate(async () => {
        window.alerts = []; window.alert = message => alerts.push(message); window.confirm = () => true;
        window.reads = []; window.inserts = []; window.gates = new Map(); window.responses = new Map();
        window.hold = key => gates.set(key, new Promise(resolve => {window['release_' + key] = resolve;}));
        async function execute(key, response) {
            reads.push(key);
            await gates.get(key);
            return responses.get(key) || response;
        }
        const court = {id: 1, nume: 'Court A', sport: 'Fotbal', ore_rezervabile: ['12:00']};
        const db = {from(table) {
            return {
                select() {return this;}, eq() {return this;}, neq() {return this;}, order() {return this;},
                single() {return execute(table + ':single', {data: court, error: null});},
                then(resolve, reject) {return execute(table + ':select', {data: [], error: null}).then(resolve, reject);},
                async insert(values) {inserts.push({table, values}); return execute(table + ':insert', {error: null});}
            };
        }};
        window.spotivityReadAllRows = async factory => {factory(); return {data: [], error: null};};
        window.adminContext = SpotivityModules.adminCore(db);
        adminContext.state.account = {user_id: 'staff', is_super: true};
        SpotivityModules.adminSchedule(adminContext);
        SpotivityModules.adminBookings(adminContext);
        SpotivityModules.adminAllocations(adminContext);
        await incarcaTabelProgram();
    });
    await page.locator('#select-stare-1200').selectOption('ocupat');
    await page.locator('#inline-nume-1200').fill('First Client');
    await page.locator('#inline-pret-1200').fill('100');
    return page;
}

async function startInline(page, gate) {
    await page.evaluate(key => hold(key), gate);
    await page.locator('#form-inline-1200 button').click();
    await page.waitForFunction(key => reads.includes(key), gate);
}
async function release(page, gate) {
    await page.evaluate(key => window['release_' + key](), gate);
    // Await the native click's async work, including any schedule render.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
}

for (const gate of ['terenuri:single', 'rezervari:select']) {
    for (const [field, value] of [['nume', 'New Client'], ['pret', '200']]) {
        test(`inline booking abandons changed ${field} during ${gate} before writing`, async t => {
            const page = await fixture(t);
            await startInline(page, gate);
            await page.locator(`#inline-${field}-1200`).fill(value);
            await release(page, gate);
            assert.deepEqual(await page.evaluate(() => inserts), []);
            assert.equal(await page.locator(`#inline-${field}-1200`).inputValue(), value);
            assert.equal(await page.locator('#form-inline-1200 button').isEnabled(), true);
        });
    }
}

test('inline booking keeps a newer draft after an earlier insert completes', async t => {
    const page = await fixture(t);
    await startInline(page, 'rezervari:insert');
    await page.locator('#inline-nume-1200').fill('New Client');
    await release(page, 'rezervari:insert');
    assert.equal(await page.evaluate(() => inserts.length), 1);
    assert.equal(await page.evaluate(() => inserts[0].values[0].email_client), 'First Client');
    assert.equal(await page.locator('#inline-nume-1200').inputValue(), 'New Client');
    assert.equal(await page.locator('#form-inline-1200 button').isEnabled(), true);
});

test('inline booking deduplicates pending saves and recovers from a database failure', async t => {
    const page = await fixture(t);
    await page.evaluate(() => responses.set('rezervari:insert', {error: {message: 'temporary failure'}}));
    await startInline(page, 'rezervari:insert');
    assert.equal(await page.locator('#form-inline-1200 button').isDisabled(), true);
    await page.evaluate(() => {window.repeatedInline = salveazaRezervareInlineAdmin('Court A', '2099-11-03', '12:00');});
    await release(page, 'rezervari:insert');
    assert.equal(await page.evaluate(() => inserts.length), 1);
    assert.equal(await page.locator('#inline-nume-1200').inputValue(), 'First Client');
    assert.equal(await page.locator('#form-inline-1200 button').isEnabled(), true);
    await page.evaluate(() => responses.delete('rezervari:insert'));
    await page.locator('#form-inline-1200 button').click();
    await page.waitForFunction(() => inserts.length === 2);
});

test('single-slot blocking stops when availability cannot be read', async t => {
    const page = await fixture(t);
    await page.evaluate(async () => {
        responses.set('rezervari:select', {data: null, error: {message: 'offline'}});
        await blocheazaOraSinguraAdmin('Court A', '2099-11-03', '12:00');
    });
    assert.deepEqual(await page.evaluate(() => inserts), []);
    assert.match(await page.evaluate(() => alerts.at(-1)), /nu pot fi verificate/);
});

test('allocation stops when duplicate-email lookup fails', async t => {
    const page = await fixture(t);
    await page.evaluate(() => responses.set('users_admin:select', {data: null, error: {message: 'offline'}}));
    await page.locator('#creeaza-supervisor-btn').click();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.deepEqual(await page.evaluate(() => inserts), []);
    assert.equal(await page.locator('#super-email').inputValue(), 'first@example.test');
    assert.equal(await page.locator('#creeaza-supervisor-btn').isEnabled(), true);
});

for (const field of ['name', 'email', 'super', 'courts']) {
    test(`allocation abandons edited ${field} before writing`, async t => {
        const page = await fixture(t);
        await page.evaluate(() => hold('users_admin:select'));
        await page.locator('#creeaza-supervisor-btn').click();
        await page.waitForFunction(() => reads.includes('users_admin:select'));
        if (field === 'name') await page.locator('#super-nume').fill('New Admin');
        if (field === 'email') await page.locator('#super-email').fill('new@example.test');
        if (field === 'super') await page.locator('#check-super-admin').check();
        if (field === 'courts') await page.locator('.check-teren-alocat[value="Court B"]').check();
        const draft = await page.locator('#modal-creeaza-cont input').evaluateAll(nodes => nodes.map(node => [node.value, node.checked]));
        await release(page, 'users_admin:select');
        assert.deepEqual(await page.evaluate(() => inserts), []);
        assert.equal(await page.locator('#modal-creeaza-cont').isVisible(), true);
        assert.deepEqual(await page.locator('#modal-creeaza-cont input').evaluateAll(nodes => nodes.map(node => [node.value, node.checked])), draft);
        assert.equal(await page.locator('#creeaza-supervisor-btn').isEnabled(), true);
    });
}

test('allocation preserves the newer form when an earlier insert completes', async t => {
    const page = await fixture(t);
    await page.evaluate(() => hold('users_admin:insert'));
    await page.locator('#creeaza-supervisor-btn').click();
    await page.waitForFunction(() => inserts.length === 1);
    await page.locator('#super-nume').fill('New Admin');
    await page.locator('#super-email').fill('new@example.test');
    await page.locator('#check-super-admin').check();
    await release(page, 'users_admin:insert');
    assert.equal(await page.locator('#modal-creeaza-cont').isVisible(), true);
    assert.equal(await page.locator('#super-nume').inputValue(), 'New Admin');
    assert.equal(await page.locator('#super-email').inputValue(), 'new@example.test');
    assert.equal(await page.locator('#check-super-admin').isChecked(), true);
    assert.equal(await page.locator('#creeaza-supervisor-btn').isEnabled(), true);
});

test('allocation permits one pending submission and clears its own successful draft', async t => {
    const page = await fixture(t);
    await page.evaluate(() => hold('users_admin:insert'));
    await page.locator('#creeaza-supervisor-btn').click();
    await page.waitForFunction(() => inserts.length === 1);
    assert.equal(await page.locator('#creeaza-supervisor-btn').isDisabled(), true);
    await page.evaluate(() => document.getElementById('creeaza-supervisor-btn').dispatchEvent(new MouseEvent('click')));
    await release(page, 'users_admin:insert');
    assert.equal(await page.evaluate(() => inserts.length), 1);
    assert.equal(await page.locator('#modal-creeaza-cont').isVisible(), false);
    assert.equal(await page.locator('#super-email').inputValue(), '');
    assert.equal(await page.locator('#creeaza-supervisor-btn').isEnabled(), true);
});

for (const oldGate of ['users_admin:select', 'users_admin:insert']) {
    test(`clearing an admin session unlocks allocations during old ${oldGate}`, async t => {
        const page = await fixture(t);
        await page.evaluate(key => hold(key), oldGate);
        await page.locator('#creeaza-supervisor-btn').click();
        await page.waitForFunction(key => reads.includes(key), oldGate);
        await page.evaluate(key => {
            adminContext.state.authGeneration++;
            adminContext.state.account = null;
            dispatchEvent(new Event('spotivity:admin-clear'));
            adminContext.state.account = {user_id: 'other-admin', is_super: true};
            window.releaseOldAllocation = window['release_' + key];
            gates.delete(key);
            hold('users_admin:insert');
        }, oldGate);
        assert.equal(await page.locator('#creeaza-supervisor-btn').isEnabled(), true);
        await page.locator('#super-email').fill('other@example.test');
        await page.locator('#creeaza-supervisor-btn').click();
        await page.waitForFunction(count => inserts.length === count, oldGate === 'users_admin:insert' ? 2 : 1);
        await page.evaluate(async () => {releaseOldAllocation(); await new Promise(resolve => setTimeout(resolve, 30));});
        assert.equal(await page.evaluate(() => inserts.at(-1).values[0].email), 'other@example.test');
        assert.equal(await page.locator('#creeaza-supervisor-btn').isDisabled(), true, 'Old cleanup cannot unlock the newer pending request');
        assert.equal(await page.locator('#super-email').inputValue(), 'other@example.test');
        assert.equal(await page.locator('#modal-creeaza-cont').isVisible(), true);
        await release(page, 'users_admin:insert');
        assert.equal(await page.locator('#creeaza-supervisor-btn').isEnabled(), true);
    });
}
