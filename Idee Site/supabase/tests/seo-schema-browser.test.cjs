// Parse the published JSON-LD without JavaScript, then exercise its live
// navigation lifecycle with the pinned SDK and disposable PostgreSQL/RLS.
const {chromium} = require('playwright');
const {readFileSync, mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join, resolve} = require('node:path');
const assert = require('node:assert/strict');
const paths = require('../../js/entity-paths.js');
const seo = require('../../js/seo-data.js');
const {servePublicArtifact} = require('./public-artifact-server.cjs');
const {createFixture, host} = require('./club-request-fixture.cjs');
const root = resolve(__dirname, '../../..');
const directory = resolve(process.env.PUBLIC_BUILD_DIR || join(root, 'dist'));
const screenshotDir = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
const catalog = JSON.parse(readFileSync(join(root, 'scripts/seo-public-catalog.json'), 'utf8'));
const baseById = new Map(catalog.bases.map(base => [String(base.id), base]));
const productionRoot = 'https://spotivity.ro/';
const pagesRoot = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
const headings = {ro: 'Rezervă terenuri de sport online', hu: 'Foglalj sportpályát online', en: 'Book sports courts online'};
const cleanCity = value => value.trim().replace(/\.+$/, '');
const courtRoute = court => paths.courtPath(court, baseById.get(String(court.baza_sportiva_id)));
const hasType = (node, type) => [node['@type']].flat().includes(type);
let checks = 0;
const pass = message => { checks++; console.log('PASS', message); };

function assertGraph(graph, descriptor, baseUrl, title) {
    const canonical = new URL(descriptor.route, baseUrl).href;
    assert.equal(graph['@context'], 'https://schema.org');
    assert.ok(Array.isArray(graph['@graph']));
    const nodes = graph['@graph'];
    assert.equal(new Set(nodes.map(node => node['@id'])).size, nodes.length, 'Graph IDs are unique');
    for (const [type, fragment] of [['Organization', '#organization'], ['WebSite', '#website']]) {
        const matches = nodes.filter(node => hasType(node, type));
        assert.equal(matches.length, 1);
        assert.equal(matches[0]['@id'], baseUrl+fragment);
        assert.equal(matches[0].name, 'Spotivity');
        assert.equal(matches[0].url, baseUrl);
    }
    const page = nodes.find(node => hasType(node, 'WebPage') || hasType(node, 'CollectionPage'));
    assert.ok(page, 'Graph has a page node');
    assert.equal(page['@id'], canonical+'#webpage');
    assert.equal(page.url, canonical);
    if (title) assert.equal(page.name, title);
    assert.deepEqual(page.isPartOf, {'@id': baseUrl+'#website'});
    const crumbs = nodes.filter(node => hasType(node, 'BreadcrumbList'));
    assert.equal(crumbs.length, descriptor.kind === 'home' ? 0 : 1);
    if (crumbs.length) {
        assert.equal(crumbs[0]['@id'], canonical+'#breadcrumb');
        assert.deepEqual(page.breadcrumb, {'@id': crumbs[0]['@id']});
        const items = crumbs[0].itemListElement;
        assert.equal(items[0].item, baseUrl);
        assert.equal(items.at(-1).item, canonical);
        assert.deepEqual(items.map(item => item.position), items.map((_, index) => index+1));
        assert.ok(items.every(item => item['@type'] === 'ListItem' && typeof item.name === 'string' && item.name.trim()));
    }
    const places = nodes.filter(node => hasType(node, 'Place') || hasType(node, 'SportsActivityLocation'));
    if (descriptor.kind === 'court' || descriptor.kind === 'base') {
        const entity = descriptor[descriptor.kind];
        const place = nodes.find(node => node['@id'] === canonical+'#place');
        assert.ok(place, 'Entity graph identifies the selected public place');
        assert.equal(place['@type'], descriptor.kind === 'court' ? 'Place' : 'SportsActivityLocation');
        assert.equal(place.name, entity.nume);
        assert.equal(place.url, canonical);
        assert.deepEqual(place.address, {'@type': 'PostalAddress', addressLocality: cleanCity(entity.oras)});
        assert.deepEqual(page.mainEntity, {'@id': place['@id']});
        if (descriptor.kind === 'court' && entity.baza_sportiva_id) {
            const base = baseById.get(String(entity.baza_sportiva_id));
            if (base) assert.deepEqual(place.containedInPlace, {'@id': new URL(paths.basePath(base), baseUrl).href+'#place'});
        }
    } else {
        assert.equal(places.length, 0, 'Home and sport graphs never impersonate a court or sports base');
        assert.equal(page.mainEntity, undefined);
    }
    // Every public URL in the graph must belong to this exact deployment root.
    const visit = (value, key) => {
        if (typeof value === 'string') {
            if (value.startsWith('https://') && key !== '@context') assert.ok(value.startsWith(baseUrl), value);
        } else if (Array.isArray(value)) value.forEach(item => visit(item));
        else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) {
            assert.ok(!['aggregateRating', 'review', 'geo', 'openingHours', 'telephone', 'streetAddress', 'postalCode', 'offers'].includes(name), 'No unpublished '+name);
            visit(item, name);
        }
    };
    visit(graph);
    for (const place of places) {
        assert.ok(typeof place.name === 'string' && place.name.trim());
        assert.deepEqual(Object.keys(place.address).sort(), ['@type', 'addressLocality']);
    }
}

async function graphText(page) {
    assert.equal(await page.locator('#spotivity-seo-data[type="application/ld+json"]').count(), 1);
    return page.locator('#spotivity-seo-data').textContent();
}
async function settled(page) { await page.evaluate(() => window.SpotivityNavigation?.whenSettled()); }
async function ready(page) {
    await page.waitForFunction(() => !!window.SpotivitySeoData && !!window.SpotivityNavigation && typeof window.openCourtReservation === 'function');
    await page.evaluate(() => Promise.all([window.spotivityDiscoveryReady, window.spotivitySportAppearanceReady]));
    await settled(page);
}
async function closeModal(page, id) {
    await page.keyboard.press('Escape');
    await page.locator('#'+id).waitFor({state: 'hidden'});
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
    });
}

(async () => {
    const {SPORTS} = await import('../../../scripts/seo-pages.mjs');
    const descriptors = [
        {kind: 'home', route: ''},
        ...SPORTS.map(({sport, slug}) => ({kind: 'sport', sport, route: `terenuri/${slug}/`})),
        ...catalog.courts.map(court => ({kind: 'court', court, route: courtRoute(court)})),
        ...catalog.bases.map(base => ({kind: 'base', base, route: paths.basePath(base)}))
    ];
    const servers = [], contexts = [];
    let browser, fixture;
    try {
        const site = await servePublicArtifact({directory}); servers.push(site);
        const pages = await servePublicArtifact({directory: join(root, 'Idee Site'), mountPath: '/Site/Idee%20Site/', applyHeaders: false}); servers.push(pages);
        const hosts = [{server: site, canonicalRoot: productionRoot}, {server: pages, canonicalRoot: pagesRoot}];
        const html = readFileSync(join(directory, 'index.html'), 'utf8');
        const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
        assert.ok(sdkTag);
        const sdk = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
        assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'), sdkTag[2]);
        browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
        const crawl = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}}); contexts.push(crawl);
        const document = await crawl.newPage();
        for (const hosted of hosts) for (const descriptor of descriptors) {
            const url = new URL(descriptor.route, hosted.server.url).href;
            const response = await document.goto(url, {waitUntil: 'domcontentloaded'});
            assert.equal(response.status(), 200, url);
            const source = await response.text();
            const metaCsp = source.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
            assert.ok(metaCsp, url);
            assert.ok(source.indexOf(metaCsp[0]) < source.search(/<(?:script|link|img)\b/i));
            assert.match(metaCsp[1], /default-src 'none'/);
            const scriptPolicy = metaCsp[1].split(';').map(value => value.trim()).find(value => value.startsWith('script-src '));
            assert.ok(scriptPolicy && !/unsafe-inline|unsafe-eval|(?:^|\s)\*(?:\s|$)/.test(scriptPolicy));
            const referrerMeta = source.match(/<meta name="referrer" content="no-referrer">/);
            assert.ok(referrerMeta && source.indexOf(referrerMeta[0]) < source.search(/<(?:script|link|img)\b/i));
            if (hosted.server === site) {
                assert.ok(response.headers()['content-security-policy']);
                assert.equal(response.headers()['referrer-policy'], 'no-referrer');
            }
            assert.equal(await document.locator('h1').count(), 1, url);
            assert.equal(await document.locator('section[data-home-intro].home-intro').count(), descriptor.kind === 'home' ? 1 : 0);
            if (descriptor.kind === 'home') {
                assert.equal(await document.locator('h1').innerText(), headings.ro);
                assert.equal(await document.locator('#home-title-fotbal').evaluate(node => node.tagName), 'H2');
                assert.equal(await document.locator('button.card-sport[data-sport]').count(), SPORTS.length);
            }
            const canonical = new URL(descriptor.route, hosted.canonicalRoot).href;
            assert.equal(await document.locator('link[rel="canonical"]').getAttribute('href'), canonical);
            assertGraph(JSON.parse(await graphText(document)), descriptor, hosted.canonicalRoot, await document.title());
            assert.ok(source.indexOf('id="spotivity-seo-data"') < source.search(/<script\b[^>]*\bsrc=/i), 'Static JSON-LD exists before app execution');
        }
        pass(`${descriptors.length} public HTML pages on each host expose one H1 and valid, canonical, factual JSON-LD before JavaScript`);

        // This document deliberately has no CSP: correct serialization itself
        // must keep attacker text inside the inert JSON data element.
        const injection = '</script><script id="seo-untrusted-execution">window.__seoInjected=1</script><img id="seo-untrusted-image" src=x onerror="window.__seoInjected=2"> & \u2028\u2029 public text';
        const maliciousCourt = {...catalog.courts[0], nume: injection};
        const maliciousGraph = seo.graphFor({baseUrl: productionRoot, kind: 'court', court: maliciousCourt, route: courtRoute(catalog.courts[0])});
        const probeContext = await browser.newContext(); contexts.push(probeContext);
        const probe = await probeContext.newPage();
        await probe.setContent('<!doctype html><html><head>'+seo.script(maliciousGraph)+'</head><body><p>JSON-LD serialization probe</p></body></html>');
        assert.equal(await probe.locator('script').count(), 1);
        assert.equal(await probe.locator('#seo-untrusted-execution, #seo-untrusted-image').count(), 0);
        assert.equal(await probe.evaluate(() => window.__seoInjected), undefined);
        const parsedProbe = JSON.parse(await graphText(probe));
        assert.equal(parsedProbe['@graph'].find(node => hasType(node, 'Place')).name, injection);
        pass('closing-script, executable markup, ampersands and Unicode separators remain inert JSON data without relying on CSP');

        fixture = await createFixture(); await seed(fixture);
        const errors = [], failures = [], forbidden = [], violations = [];
        for (const hosted of hosts) {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, timezoneId: 'Europe/Bucharest'}); contexts.push(context);
            await context.addInitScript(() => {
                window.__seoCsp = [];
                document.addEventListener('securitypolicyviolation', event => window.__seoCsp.push({directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition}));
            });
            await context.route('**/*', route => {
                const request = route.request(), url = new URL(request.url());
                if (url.origin === new URL(hosted.server.url).origin) return route.continue();
                if (request.url() === sdkTag[1]) return route.fulfill({contentType: 'application/javascript', body: sdk, headers: {'access-control-allow-origin': '*'}});
                if (url.hostname === host) {
                    if (url.pathname === '/auth/v1/settings') return route.fulfill({contentType: 'application/json', body: JSON.stringify({external: {google: false}}), headers: {'access-control-allow-origin': '*'}});
                    return fixture.browserRoute(route);
                }
                forbidden.push(request.url()); return route.abort('blockedbyclient');
            });
            await context.routeWebSocket(url => url.hostname.endsWith('.supabase.co'), socket => socket.close());
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            page.on('dialog', dialog => dialog.dismiss());
            page.on('response', response => { if (new URL(response.url()).origin === new URL(hosted.server.url).origin && response.status() >= 400) failures.push(response.url()); });
            await page.goto(hosted.server.url, {waitUntil: 'networkidle'}); await ready(page);
            const originalGraph = await graphText(page);
            for (const width of [320, 390, 768, 1440]) {
                await page.setViewportSize({width, height: 844});
                for (const [language, heading] of Object.entries(headings)) {
                    await page.locator('#btn-lang-'+language).click();
                    assert.equal(await page.locator('h1').count(), 1);
                    assert.equal(await page.locator('h1').innerText(), heading);
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `Homepage fits ${width}px in ${language}`);
                }
                await page.locator('#btn-lang-ro').click();
                for (const {sport} of SPORTS) {
                    const entry = page.locator(`button.card-sport[data-sport="${sport}"]`);
                    await entry.scrollIntoViewIfNeeded();
                    const before = await page.evaluate(() => scrollY);
                    await entry.click();
                    await page.locator('#modal-terenuri').waitFor({state: 'visible'});
                    await page.waitForFunction(() => document.body.classList.contains('fara-scroll'));
                    assert.equal(page.url(), hosted.server.url, sport+' opens its picker before navigation');
                    assert.equal(await graphText(page), originalGraph, 'Picker keeps the homepage graph');
                    await page.mouse.wheel(0, 280); await page.waitForTimeout(80);
                    assert.ok(Math.abs((await page.evaluate(() => scrollY))-before) <= 1, `${sport} picker locks scroll at ${width}px`);
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `Picker fits ${width}px`);
                    await closeModal(page, 'modal-terenuri');
                    await page.waitForFunction(() => !document.body.classList.contains('fara-scroll'));
                    assert.ok(Math.abs((await page.evaluate(() => scrollY))-before) <= 1, `${sport} picker restores scroll at ${width}px`);
                }
            }
            // Each real entity replaces the homepage graph while its modal is
            // active, then Close restores the exact original document graph.
            for (const descriptor of descriptors.filter(item => item.kind === 'court' || item.kind === 'base')) {
                const entity = descriptor[descriptor.kind];
                await page.evaluate(({kind, id}) => kind === 'court' ? window.openCourtReservation(id) : window.openSportsBases(id), {kind: descriptor.kind, id: entity.id});
                const modal = descriptor.kind === 'court' ? 'modal-rezervare' : 'modal-baze-sportive';
                await page.locator('#'+modal).waitFor({state: 'visible'}); await settled(page);
                await page.waitForURL(new URL(descriptor.route, hosted.server.url).href);
                assertGraph(JSON.parse(await graphText(page)), descriptor, hosted.canonicalRoot, await page.title());
                await closeModal(page, modal); await page.waitForURL(hosted.server.url);
                assert.equal(await graphText(page), originalGraph, 'Close restores the source graph exactly');
            }
            const court = catalog.courts[0], descriptor = {kind: 'court', court, route: courtRoute(court)};
            await page.evaluate(id => window.openCourtReservation(id), court.id);
            await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            const selectedGraph = await graphText(page);
            await page.goBack(); await settled(page); await page.waitForURL(hosted.server.url);
            assert.equal(await graphText(page), originalGraph, 'Browser Back restores the source graph exactly');
            await page.goForward(); await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            assert.equal(await graphText(page), selectedGraph, 'Browser Forward restores the selected entity graph');
            violations.push(...await page.evaluate(() => window.__seoCsp));
            await page.reload({waitUntil: 'networkidle'}); await ready(page);
            const directGraph = await graphText(page);
            assertGraph(JSON.parse(directGraph), descriptor, hosted.canonicalRoot, await page.title());
            await closeModal(page, 'modal-rezervare');
            assert.equal(await graphText(page), directGraph, 'Closing a directly loaded entity retains its source entity graph');
            // Fixture Court A is not in the reviewed static snapshot. Its root
            // query fallback must never retain the previously selected entity.
            await page.evaluate(() => window.openCourtReservation(1));
            await page.locator('#modal-rezervare').waitFor({state: 'visible'}); await settled(page);
            await page.waitForFunction(() => new URL(location.href).searchParams.get('teren') === '1');
            assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
            const fallback = JSON.parse(await graphText(page));
            assert.equal(fallback['@graph'].some(node => hasType(node, 'Place') || hasType(node, 'SportsActivityLocation')), false, 'Unpublished fallback clears the previous entity graph');
            await closeModal(page, 'modal-rezervare');
            assert.equal(await graphText(page), directGraph, 'Closing a fallback restores the directly loaded graph');
            violations.push(...await page.evaluate(() => window.__seoCsp));
            await page.goto(hosted.server.url, {waitUntil: 'networkidle'}); await ready(page);
            if (screenshotDir && hosted.server === site) {
                mkdirSync(screenshotDir, {recursive: true});
                for (const [name, width, height] of [['seo-home-mobile', 390, 844], ['seo-home-desktop', 1440, 1000]]) {
                    await page.setViewportSize({width, height});
                    await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
                    await page.locator('#sport-fotbal .home-hero-art img').evaluate(image => image.decode());
                    await page.screenshot({path: join(screenshotDir, name+'.png')});
                }
            }
            violations.push(...await page.evaluate(() => window.__seoCsp));
        }
        assert.deepEqual(errors, []); assert.deepEqual(failures, []); assert.deepEqual(forbidden, []); assert.deepEqual(violations, []);
        assert.ok(!fixture.requests.some(request => !['GET', 'OPTIONS'].includes(request.method) && !request.path.endsWith('/get_admin_access')), 'SEO browsing creates no booking, customer or email');
        pass('all five direct reservation buttons, RO/HU/EN headings, four widths, scroll restoration and zero CSP violations work on root and Pages');
        pass('every named court/base updates its graph; Close, Back, Forward, direct reload and unindexed fallback preserve the correct source graph');
        console.log(`\n${checks} structured-data browser checks passed.`);
    } finally {
        for (const context of contexts) await context.close();
        if (browser) await browser.close();
        if (fixture) await fixture.close();
        for (const server of servers) await server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
