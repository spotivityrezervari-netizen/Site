// City listing pages (terenuri/<sport>/<oras>/) and shareable search addresses
// (?q=...) in the real public build, against disposable PostgreSQL only.
const {chromium} = require('playwright');
const {readFileSync, existsSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {join, resolve} = require('node:path');
const assert = require('node:assert/strict');
const {servePublicArtifact} = require('./public-artifact-server.cjs');
const {createFixture, host} = require('./club-request-fixture.cjs');
const directory = resolve(process.env.PUBLIC_BUILD_DIR || join(__dirname, '../../../dist'));
let checks = 0;
const pass = message => { checks++; console.log('PASS', message); };

(async () => {
    let site, browser, fixture, context;
    try {
        assert.ok(existsSync(join(directory, 'terenuri/fotbal/reghin/index.html')), 'The build contains the Reghin football listing');
        site = await servePublicArtifact({directory});
        const html = readFileSync(join(directory, 'index.html'), 'utf8');
        const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
        const sdk = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
        fixture = await createFixture();
        await fixture.pg.query("update public.terenuri set oras='Reghin' where nume='Court A'");
        await fixture.pg.query("insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,este_activ,oras) values ('Court Suceava','Fotbal',80,null,false,true,'Suceava')");
        browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
        context = await browser.newContext({viewport: {width: 390, height: 844}, timezoneId: 'Europe/Bucharest'});
        await context.route(sdkTag[1], route => route.fulfill({contentType: 'application/javascript', body: sdk, headers: {'access-control-allow-origin': '*'}}));
        await context.route(url => url.hostname === host, route => {
            if (new URL(route.request().url()).pathname === '/auth/v1/settings') return route.fulfill({contentType: 'application/json', body: JSON.stringify({external: {google: false}}), headers: {'access-control-allow-origin': '*'}});
            return fixture.browserRoute(route);
        });
        await context.routeWebSocket(url => url.hostname.endsWith('.supabase.co'), socket => socket.close());
        const errors = [], csp = [];
        await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.__cityCsp = (window.__cityCsp || 0) + 1));
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.dismiss());

        await page.goto(new URL('terenuri/fotbal/reghin/', site.url).href, {waitUntil: 'networkidle'});
        await page.evaluate(() => window.spotivityDiscoveryReady);
        assert.equal(await page.locator('h1').innerText(), 'Terenuri de fotbal în Reghin');
        assert.equal(await page.locator('#filtru-oras-global').inputValue(), 'Reghin');
        const cards = page.locator('[data-home-courts="Fotbal"] [data-discovery-court]');
        await page.waitForFunction(() => document.querySelectorAll('[data-home-courts="Fotbal"] [data-discovery-court]').length === 1);
        assert.match(await cards.first().innerText(), /Court A/);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('spotivity-city')), null, 'Visiting a city page does not change the remembered city');
        await page.locator('#filtru-oras-global').selectOption('ALL');
        await page.waitForFunction(() => document.querySelectorAll('[data-home-courts="Fotbal"] [data-discovery-court]').length === 2);
        pass('a city page starts filtered on its own city, keeps the visitor choice separate and still lets them see every city');

        await page.goto(site.url, {waitUntil: 'networkidle'});
        await page.evaluate(() => window.spotivityDiscoveryReady);
        const robotsBefore = await page.locator('meta[name="robots"]').getAttribute('content');
        await page.locator('#home-nav-search-input').fill('Court');
        await page.locator('#btn-home-search').click();
        await page.locator('#modal-cautare-terenuri').waitFor({state: 'visible'});
        assert.equal(new URL(page.url()).searchParams.get('q'), 'Court');
        assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
        await page.locator('#home-search-input').fill('Court Suceava');
        await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'Court Suceava');
        await page.keyboard.press('Escape');
        await page.locator('#modal-cautare-terenuri').waitFor({state: 'hidden'});
        assert.equal(new URL(page.url()).searchParams.has('q'), false);
        assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), robotsBefore);
        pass('searching gives the page a ?q= address with noindex, and closing the search restores the address and robots');

        await page.goto(new URL('?q=Court%20A', site.url).href, {waitUntil: 'networkidle'});
        await page.locator('#modal-cautare-terenuri').waitFor({state: 'visible'});
        assert.equal(await page.locator('#home-search-input').inputValue(), 'Court A');
        await page.waitForFunction(() => [...document.querySelectorAll('#home-search-results [data-discovery-court]')].some(card => card.textContent.includes('Court A')));
        assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
        pass('opening a shared ?q= address shows the same search results');

        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => window.__cityCsp || 0), 0);
        console.log(`\n${checks} city and search browser checks passed.`);
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
        if (fixture) await fixture.close();
        if (site) await site.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
