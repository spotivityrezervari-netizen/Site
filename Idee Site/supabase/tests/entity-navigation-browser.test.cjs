// Crawl the real generated entity pages, then exercise the pinned SDK with
// disposable PostgreSQL/RLS. Hosted customers, bookings and emails are untouched.
const {chromium} = require('playwright');
const {readFileSync, mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join, resolve} = require('node:path');
const assert = require('node:assert/strict');
const paths = require('../../js/entity-paths.js');
const {servePublicArtifact} = require('./public-artifact-server.cjs');
const {createFixture, host, uid} = require('./club-request-fixture.cjs');
const root = resolve(__dirname, '../../..');
const directory = resolve(process.env.PUBLIC_BUILD_DIR || join(root, 'dist'));
const screenshotDir = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
const sports = ['Fotbal', 'Baschet', 'Tenis', 'Volei', 'Tenis Picior'];
const catalog = JSON.parse(readFileSync(join(root, 'scripts/seo-public-catalog.json'), 'utf8'));
const baseById = new Map(catalog.bases.map(base => [String(base.id), base]));
let checks = 0;
const pass = message => { checks++; console.log('PASS', message); };
const routeForCourt = court => paths.courtPath(court, baseById.get(String(court.baza_sportiva_id)));
const cssString = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function settled(page) {
    await page.evaluate(() => window.SpotivityNavigation?.whenSettled());
}
async function ready(page) {
    await page.waitForFunction(() => typeof window.openCourtReservation === 'function' && !!window.SpotivityNavigation);
    await page.evaluate(() => window.spotivityDiscoveryReady);
    await settled(page);
}
async function hidden(page, id) {
    await page.locator('#'+id).waitFor({state: 'hidden'});
    await settled(page);
}
async function showCourt(page, court) {
    const result = await page.evaluate(id => window.openCourtReservation(id), court.id);
    assert.equal(result, true);
    await page.locator('#modal-rezervare').waitFor({state: 'visible'});
    assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), court.nume);
    await settled(page);
}
async function seed(fixture) {
    await fixture.root(async () => {
        for (const base of catalog.bases) await fixture.pg.query(
            'insert into public.baze_sportive(id,nume,oras,descriere,este_activa) values($1,$2,$3,$4,true)',
            [base.id, base.nume, base.oras, base.descriere]);
        for (const court of catalog.courts) await fixture.pg.query(
            'insert into public.terenuri(id,nume,sport,oras,pret,poza,este_activ,baza_sportiva_id) overriding system value values($1,$2,$3,$4,$5,$6,true,$7)',
            [court.id, court.nume, court.sport, court.oras, court.pret, 'assets/imagini/avatar2.png', court.baza_sportiva_id]);
        await fixture.pg.query('insert into public.baze_sportive(id,nume,oras,descriere,este_activa) values($1,$2,$3,$4,true)',
            [uid(900), 'Bază Nouă & Încercare', 'Reghin', 'Descriere publică a unei baze adăugate după ultima generare.']);
        await fixture.pg.query('update public.terenuri set baza_sportiva_id=$1,oras=$2,poza=$3 where id=1',
            [uid(900), 'Reghin', 'assets/imagini/avatar2.png']);
        for (const [index, sport] of sports.entries()) await fixture.pg.query(
            'insert into public.terenuri(id,nume,sport,oras,pret,poza,este_activ,baza_sportiva_id) overriding system value values($1,$2,$3,$4,100,$5,true,$6)',
            [1001+index, `Teren Știința – ${sport}`, sport, 'Reghin', 'assets/imagini/avatar2.png', uid(900)]);
    });
}

(async () => {
    const servers = [], contexts = [];
    let browser, fixture;
    try {
        const site = await servePublicArtifact({directory}); servers.push(site);
        const pages = await servePublicArtifact({directory: join(root, 'Idee Site'), mountPath: '/Site/Idee%20Site/', applyHeaders: false}); servers.push(pages);
        const html = readFileSync(join(directory, 'index.html'), 'utf8');
        const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
        assert.ok(sdkTag);
        const sdk = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
        assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'), sdkTag[2]);
        browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
        const crawl = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}}); contexts.push(crawl);
        const document = await crawl.newPage();
        for (const hosted of [site, pages]) {
            for (const court of catalog.courts) {
                const route = routeForCourt(court), url = new URL(route, hosted.url).href;
                assert.equal((await document.goto(url, {waitUntil: 'domcontentloaded'})).status(), 200, url);
                assert.equal(await document.locator('h1').count(), 1);
                assert.equal(await document.locator('h1').innerText(), `${court.nume} — ${court.oras.replace(/\.+$/, '')}`);
                assert.equal(await document.locator('body').getAttribute('data-court-id'), String(court.id));
                assert.ok((await document.title()).includes(court.nume));
                assert.ok((await document.title()).includes(court.oras.replace(/\.+$/, '')), 'Court title includes the public city');
                assert.ok((await document.locator('meta[name="description"]').getAttribute('content')).includes(court.nume));
                assert.ok((await document.locator('meta[name="description"]').getAttribute('content')).includes(court.oras.replace(/\.+$/, '')), 'Court description includes the public city');
                assert.ok(route.includes(paths.citySlug(court.oras)), 'Court address includes the city slug');
                const canonical = new URL(await document.locator('link[rel="canonical"]').getAttribute('href'));
                assert.ok(canonical.pathname.endsWith('/'+route));
                assert.equal(canonical.origin, hosted === site ? 'https://spotivity.ro' : 'https://spotivityrezervari-netizen.github.io');
                assert.ok((await document.locator('main').innerText()).includes(court.oras.replace(/\.+$/, '')));
                assert.equal(await document.locator(`[data-entity-booking="${cssString(court.id)}"]`).count(), 1);
                const base = baseById.get(String(court.baza_sportiva_id));
                if (base) assert.equal(await document.locator(`[data-entity-base-id="${cssString(base.id)}"]`).first().getAttribute('href')
                    .then(value => new URL(value, url).href), new URL(paths.basePath(base), hosted.url).href);
                const assets = await document.locator('script[src],link[rel="stylesheet"][href],link[rel="icon"][href]').evaluateAll(nodes => nodes.map(node => node.src || node.href).filter(value => new URL(value).origin === location.origin));
                for (const asset of assets) assert.equal((await fetch(asset)).status, 200, asset);
            }
            for (const base of catalog.bases) {
                const url = new URL(paths.basePath(base), hosted.url).href;
                assert.equal((await document.goto(url, {waitUntil: 'domcontentloaded'})).status(), 200);
                assert.equal(await document.locator('h1').count(), 1);
                assert.equal(await document.locator('h1').innerText(), `${base.nume} — ${base.oras.replace(/\.+$/, '')}`);
                assert.equal(await document.locator('body').getAttribute('data-base-id'), String(base.id));
                assert.ok((await document.title()).includes(base.nume));
                assert.ok((await document.title()).includes(base.oras.replace(/\.+$/, '')), 'Base title includes the public city');
                assert.ok((await document.locator('meta[name="description"]').getAttribute('content')).includes(base.oras.replace(/\.+$/, '')), 'Base description includes the public city');
                assert.ok(paths.basePath(base).includes(paths.citySlug(base.oras)), 'Base address includes the city slug');
                assert.ok((await document.locator('main').innerText()).includes(base.oras));
                if (base.descriere) assert.ok((await document.locator('main').innerText()).includes(base.descriere));
                for (const court of catalog.courts.filter(court => String(court.baza_sportiva_id) === String(base.id))) {
                    const link = document.locator(`[data-entity-court-id="${cssString(court.id)}"]`).first();
                    assert.equal(new URL(await link.getAttribute('href'), url).href, new URL(routeForCourt(court), hosted.url).href);
                }
            }
            const sitemap = await (await fetch(new URL('sitemap.xml', hosted.url))).text();
            for (const court of catalog.courts) assert.ok(sitemap.includes(routeForCourt(court)));
            for (const base of catalog.bases) assert.ok(sitemap.includes(paths.basePath(base)));
        }
        pass('all active public courts and bases have real indexable pages, unique names, canonical URLs, public details and crawlable links without JavaScript on both hosts');

        fixture = await createFixture(); await seed(fixture);
        const errors = [], failures = [];
        const knownCourt = catalog.courts.find(court => court.sport === 'Fotbal' && court.baza_sportiva_id) || catalog.courts.find(court => court.sport === 'Fotbal') || catalog.courts[0];
        assert.ok(knownCourt, 'A real published public court is required for deep-link coverage');
        const knownBase = baseById.get(String(knownCourt.baza_sportiva_id)) || catalog.bases[0];
        for (const hosted of [site, pages]) {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, timezoneId: 'Europe/Bucharest'}); contexts.push(context);
            await context.addInitScript(() => {
                window.__entityClipboard = [];
                Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
                Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => window.__entityClipboard.push(text)}, configurable: true});
            });
            await context.route(sdkTag[1], route => route.fulfill({contentType: 'application/javascript', body: sdk, headers: {'access-control-allow-origin': '*'}}));
            await context.route(url => url.hostname === host, route => {
                if (new URL(route.request().url()).pathname === '/auth/v1/settings') return route.fulfill({contentType: 'application/json', body: JSON.stringify({external: {google: false}}), headers: {'access-control-allow-origin': '*'}});
                return fixture.browserRoute(route);
            });
            await context.routeWebSocket(url => url.hostname.endsWith('.supabase.co'), socket => socket.close());
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            page.on('dialog', dialog => dialog.dismiss());
            page.on('response', response => { if (new URL(response.url()).origin === new URL(hosted.url).origin && response.status() >= 400) failures.push(response.url()); });
            await page.goto(hosted.url, {waitUntil: 'networkidle'}); await ready(page);
            const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
            const initialRobots = await page.locator('meta[name="robots"]').getAttribute('content');
            for (const sport of sports) {
                const current = page.url();
                await page.locator(`button.card-sport[data-sport="${sport}"]`).click();
                await page.locator('#modal-terenuri').waitFor({state: 'visible'});
                assert.equal(page.url(), current, sport+' opens the chooser directly');
                assert.equal(await page.locator('[data-home-sport]').count(), 5);
                await page.locator('#inchide-terenuri').click(); await hidden(page, 'modal-terenuri');
            }
            // Both explicit Back and browser Back keep the user's filter draft.
            await page.locator(`button.card-sport[data-sport="${knownCourt.sport}"]`).click();
            await page.locator('#modal-terenuri').waitFor({state: 'visible'});
            const day = await page.evaluate(() => {
                const date = new Date(`${window.siteDate()}T12:00:00Z`);
                date.setUTCDate(date.getUTCDate()+1);
                return date.toISOString().slice(0, 10);
            });
            await page.locator('#filtru-data').fill(day); await page.locator('#filtru-data').dispatchEvent('change');
            await page.waitForFunction(() => [...document.querySelectorAll('#filtru-ora option')].some(option => option.value === '12:00'));
            await page.locator('#filtru-ora').selectOption('12:00');
            await page.locator('#filtru-nume').fill(knownCourt.nume);
            const choice = page.locator('.card-teren-poza').filter({has: page.getByRole('heading', {name: knownCourt.nume, exact: true})});
            await choice.waitFor({state: 'visible'});
            const filterDraft = {day, hour: '12:00', name: knownCourt.nume};
            const filters = () => page.evaluate(() => ({day: document.getElementById('filtru-data').value, hour: document.getElementById('filtru-ora').value, name: document.getElementById('filtru-nume').value}));
            await choice.click(); await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            await page.locator('#inapoi-la-terenuri').click(); await hidden(page, 'modal-rezervare');
            await page.locator('#modal-terenuri').waitFor({state: 'visible'});
            assert.deepEqual(await filters(), filterDraft, 'Explicit Back preserves date, hour and name filters');
            await choice.click(); await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            await page.goBack(); await hidden(page, 'modal-rezervare');
            await page.locator('#modal-terenuri').waitFor({state: 'visible'});
            assert.deepEqual(await filters(), filterDraft, 'Browser Back preserves date, hour and name filters');
            await page.locator('#inchide-terenuri').click(); await hidden(page, 'modal-terenuri');
            const linksBefore = await page.locator('.home-desktop-nav a, #home-brand, link[rel="stylesheet"], script[src], #sport-fotbal .home-hero-art img').evaluateAll(nodes => nodes.map(node => node.href || node.src));
            await showCourt(page, knownCourt);
            const knownUrl = new URL(routeForCourt(knownCourt), hosted.url).href;
            await page.waitForURL(knownUrl);
            assert.equal(await page.locator('[data-home-sport]').count(), 5, 'A court selection updates URL in place without replacing the homepage');
            assert.deepEqual(await page.locator('.home-desktop-nav a, #home-brand, link[rel="stylesheet"], script[src], #sport-fotbal .home-hero-art img').evaluateAll(nodes => nodes.map(node => node.href || node.src)), linksBefore, 'Changing the path does not break navigation or assets');
            assert.ok((await page.title()).includes(knownCourt.nume));
            assert.ok((await page.title()).includes(knownCourt.oras.replace(/\.+$/, '')), 'The selected court keeps its city in the browser title');
            assert.ok((await page.locator('link[rel="canonical"]').getAttribute('href')).endsWith(routeForCourt(knownCourt)));
            await page.goBack(); await hidden(page, 'modal-rezervare'); await page.waitForURL(hosted.url);
            assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical);
            await page.goForward(); await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), knownCourt.nume);
            await page.keyboard.press('Escape'); await hidden(page, 'modal-rezervare'); await page.waitForURL(hosted.url);
            assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), initialRobots);

            // A late response after Back must not resurrect a closed reservation.
            const paused = fixture.pauseNext('/rest/v1/terenuri', 'GET');
            const forwarding = page.goForward();
            await paused.entered;
            await page.goBack();
            paused.release(); await forwarding;
            await settled(page); await page.waitForURL(hosted.url);
            assert.equal(await page.locator('#modal-rezervare').isVisible(), false);
            await page.goForward(); await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            await page.reload({waitUntil: 'networkidle'}); await ready(page);
            assert.equal(await page.locator('body').getAttribute('data-court-id'), String(knownCourt.id));
            assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), knownCourt.nume);
            assert.equal(await page.evaluate(() => window.siteHomeUrl()), hosted.url);
            if (screenshotDir && hosted === site) {
                mkdirSync(screenshotDir, {recursive: true});
                await page.screenshot({path: join(screenshotDir, 'court-entity-mobile.png')});
            }
            await page.keyboard.press('Escape'); await hidden(page, 'modal-rezervare');
            assert.equal(page.url(), knownUrl, 'Closing a directly loaded detail page keeps its valid address');
            const historyLength = await page.evaluate(() => history.length);
            await page.locator('[data-entity-booking]').click(); await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            assert.equal(await page.evaluate(() => history.length), historyLength, 'Reopening the same detail does not create duplicate history entries');
            await page.keyboard.press('Escape'); await hidden(page, 'modal-rezervare');
            if (knownBase) {
                await page.evaluate(id => window.openSportsBases(id), knownBase.id);
                await page.locator('#modal-baze-sportive').waitFor({state: 'visible'}); await settled(page);
                await page.waitForURL(new URL(paths.basePath(knownBase), hosted.url).href);
                await page.goBack(); await settled(page); await page.waitForURL(knownUrl);
                assert.equal(await page.locator('#modal-rezervare').isVisible(), false, 'Back preserves a directly loaded court detail that the user already closed');
                assert.equal(await page.locator('#modal-baze-sportive').isVisible(), false);
            }

            // The original document can be deep while a newly created court
            // uses the root query fallback. Later root-relative image updates
            // must still survive the next transition back to a named route.
            await showCourt(page, {id: 1001, nume: 'Teren Știința – Fotbal', sport: 'Fotbal', oras: 'Reghin'});
            await page.waitForFunction(() => new URL(location.href).searchParams.get('teren') === '1001');
            await page.locator('#home-brand img').evaluate(image => { image.src = 'assets/imagini/avatar2.png'; });
            await showCourt(page, knownCourt); await page.waitForURL(knownUrl);
            assert.equal(await page.locator('#home-brand img').evaluate(image => image.src), new URL('assets/imagini/avatar2.png', hosted.url).href,
                'A deep document moving through a root fallback keeps later root-relative images correct');

            // Newly created courts still have reloadable links before regeneration.
            for (const [index, sport] of sports.entries()) {
                await page.goto(hosted.url, {waitUntil: 'networkidle'}); await ready(page);
                const court = {id: 1001+index, nume: `Teren Știința – ${sport}`, sport};
                await showCourt(page, court);
                const url = new URL(page.url());
                assert.equal(url.pathname, new URL(hosted.url).pathname);
                assert.equal(url.searchParams.get('teren'), String(court.id));
                assert.ok(url.searchParams.get('nume')?.includes('stiinta'));
                assert.ok(decodeURIComponent(url.href).includes(paths.slug('Reghin')), 'Fallback address includes the city before static regeneration');
                assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
                assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical);
                await page.reload({waitUntil: 'networkidle'}); await ready(page);
                await page.locator('#modal-rezervare').waitFor({state: 'visible'});
                assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), court.nume);
                await page.keyboard.press('Escape'); await hidden(page, 'modal-rezervare');
            }

            if (knownBase) {
                await page.goto(hosted.url+'?source=fixture#private=discard', {waitUntil: 'networkidle'}); await ready(page);
                await page.locator('#btn-home-baze').click(); await page.locator('#modal-baze-sportive').waitFor({state: 'visible'});
                await page.locator(`[data-base-id="${cssString(knownBase.id)}"]`).click(); await settled(page);
                const baseUrl = new URL(paths.basePath(knownBase), hosted.url).href;
                await page.waitForURL(baseUrl);
                assert.equal(await page.locator('#baze-sportive-titlu').innerText(), knownBase.nume);
                assert.ok((await page.title()).includes(knownBase.oras.replace(/\.+$/, '')), 'The selected base keeps its city in the browser title');
                await page.locator('#baze-sportive-share').click();
                assert.equal(await page.evaluate(() => window.__entityClipboard.at(-1)), baseUrl, 'Share uses a clean named URL without unrelated queries or private fragments');
                const member = catalog.courts.find(court => String(court.baza_sportiva_id) === String(knownBase.id));
                assert.ok(member);
                await page.locator(`[data-base-court="${cssString(member.id)}"]`).click();
                await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
                await page.waitForURL(new URL(routeForCourt(member), hosted.url).href);
                assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), member.nume);
                await page.keyboard.press('Escape'); await hidden(page, 'modal-rezervare');
                await page.locator('#modal-baze-sportive').waitFor({state: 'visible'}); await page.waitForURL(baseUrl);
                await page.keyboard.press('Escape'); await hidden(page, 'modal-baze-sportive');
                await page.goto(baseUrl, {waitUntil: 'networkidle'}); await ready(page);
                await page.locator('#modal-baze-sportive').waitFor({state: 'visible'});
                assert.equal(await page.locator('#baze-sportive-titlu').innerText(), knownBase.nume);
                await page.keyboard.press('Escape'); await hidden(page, 'modal-baze-sportive');
                assert.equal(page.url(), baseUrl);
                if (screenshotDir && hosted === site) {
                    await page.setViewportSize({width: 1440, height: 1000});
                    await page.screenshot({path: join(screenshotDir, 'base-entity-desktop.png')});
                    await page.setViewportSize({width: 390, height: 844});
                }
            }
            await page.goto(hosted.url+'?baza='+uid(900)+'&nume=baza-noua-incercare', {waitUntil: 'networkidle'}); await ready(page);
            await page.locator('#modal-baze-sportive').waitFor({state: 'visible'});
            assert.equal(await page.locator('#baze-sportive-titlu').innerText(), 'Bază Nouă & Încercare');
            await page.keyboard.press('Escape'); await hidden(page, 'modal-baze-sportive');

            await page.goto(hosted.url+'?teren=not-an-id&nume=invalid', {waitUntil: 'networkidle'}); await ready(page);
            assert.equal(await page.locator('#modal-rezervare').isVisible(), false);
            assert.ok((await page.locator('#public-navigation-status').innerText()).trim());
            await page.goto(hosted.url+'?teren=1&nume=court-a&type=recovery', {waitUntil: 'networkidle'}); await ready(page);
            assert.equal(await page.locator('#modal-rezervare').isVisible(), false, 'Recovery intent has priority over public entity routing');
            const publicLinks = await page.locator('#home-brand, .home-desktop-nav a').evaluateAll(nodes => nodes.map(node => node.href));
            for (const value of publicLinks) {
                const url = new URL(value);
                for (const key of ['code', 'token_hash', 'type', 'error', 'access_token', 'refresh_token']) assert.equal(url.searchParams.has(key), false, 'Public navigation never reintroduces Auth parameters');
            }
            await page.goto(hosted.url+'?teren=1&nume=court-a#spotivity-action=account', {waitUntil: 'networkidle'}); await ready(page);
            assert.equal(await page.locator('#modal-rezervare').isVisible(), false, 'Email account intent has priority over public entity routing');
        }
        // A static page is never authority to book a now-hidden/removed court.
        await fixture.root(() => fixture.pg.query('update public.terenuri set este_activ=false where id=$1', [knownCourt.id]));
        const unavailable = await contexts[contexts.length-1].newPage();
        await unavailable.goto(new URL(routeForCourt(knownCourt), servers[servers.length-1].url).href, {waitUntil: 'networkidle'}); await ready(unavailable);
        assert.equal(await unavailable.locator('#modal-rezervare').isVisible(), false);
        assert.ok((await unavailable.locator('#public-navigation-status').innerText()).trim());
        assert.deepEqual(errors, []); assert.deepEqual(failures, []);
        assert.ok(!fixture.requests.some(request => !['GET', 'OPTIONS'].includes(request.method) && !request.path.endsWith('/get_admin_access')), 'Browsing, sharing and opening forms sends no booking or email');
        pass('direct reservation, named in-place URLs, all sports, Back/Forward, reload, share, pending cancellation, inactive entities and protected Auth/email intents work on root and Pages');
        console.log(`\n${checks} entity navigation browser checks passed.`);
    } finally {
        for (const context of contexts) await context.close();
        if (browser) await browser.close();
        if (fixture) await fixture.close();
        for (const server of servers) await server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
