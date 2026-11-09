// Crawl real static sport pages with JavaScript disabled, then use the pinned
// Supabase SDK against disposable PostgreSQL. No hosted data is written.
const {chromium} = require('playwright');
const {readFileSync, mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join, resolve} = require('node:path');
const assert = require('node:assert/strict');
const {servePublicArtifact} = require('./public-artifact-server.cjs');
const {createFixture, host} = require('./club-request-fixture.cjs');
const directory = resolve(process.env.PUBLIC_BUILD_DIR || join(__dirname, '../../../dist'));
const screenshotDir = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, {recursive: true});
let checks = 0;
const pass = message => { checks++; console.log('PASS', message); };

(async () => {
    const {SPORTS} = await import('../../../scripts/seo-pages.mjs');
    const servers = [], contexts = [];
    let browser, fixture;
    try {
        const site = await servePublicArtifact({directory}); servers.push(site);
        const pages = await servePublicArtifact({directory: join(__dirname, '../..'), mountPath: '/Site/Idee%20Site/', applyHeaders: false}); servers.push(pages);
        const html = readFileSync(join(directory, 'index.html'), 'utf8');
        const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
        assert.ok(sdkTag);
        const sdk = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
        assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'), sdkTag[2]);
        browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true});
        const crawl = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}}); contexts.push(crawl);
        const document = await crawl.newPage();
        for (const hosted of [site, pages]) {
            const titles = new Set(), descriptions = new Set();
            for (const {sport, slug} of SPORTS) {
                const url = new URL(`terenuri/${slug}/`, hosted.url).href;
                assert.equal((await document.goto(url, {waitUntil: 'domcontentloaded'})).status(), 200);
                assert.equal(await document.locator('h1').count(), 1);
                assert.match(await document.locator('h1').innerText(), /^Terenuri de /);
                assert.equal(await document.locator('body').getAttribute('data-category-sport'), sport);
                assert.equal(await document.locator('[data-home-sport]').count(), 1);
                const title = await document.title(), description = await document.locator('meta[name="description"]').getAttribute('content');
                assert.ok(title.includes('Spotivity')); assert.ok(description.length >= 70);
                titles.add(title); descriptions.add(description);
                const canonical = new URL(await document.locator('link[rel="canonical"]').getAttribute('href'));
                assert.ok(canonical.pathname.endsWith(`/terenuri/${slug}/`));
                assert.equal(canonical.origin, hosted === site ? 'https://spotivity.ro' : 'https://spotivityrezervari-netizen.github.io');
                assert.ok((await document.locator('.category-intro').innerText()).trim().length > 70);
                assert.ok((await document.locator('[data-home-courts]').innerText()).trim(), 'The HTML has a catalog or an honest empty state before JavaScript');
                const assets = await document.locator('script[src],link[rel="stylesheet"][href],link[rel="icon"][href]').evaluateAll(nodes => nodes.map(node => node.src || node.href).filter(url => new URL(url).origin === location.origin));
                for (const asset of assets) assert.equal((await fetch(asset)).status, 200, asset);
                const sportLinks = await document.locator('[data-sport-target]').evaluateAll(nodes => nodes.map(node => ({tag: node.tagName, href: node.href})));
                assert.equal(sportLinks.length, SPORTS.length*2);
                for (const link of sportLinks) { assert.equal(link.tag, 'A'); assert.ok(link.href.startsWith(hosted.url)); }
                const redirect = await fetch(url.slice(0, -1)+'?from=seo', {redirect: 'manual'});
                assert.equal(redirect.status, 301); assert.ok(redirect.headers.get('location').endsWith(`/${slug}/?from=seo`));
            }
            assert.equal(titles.size, SPORTS.length); assert.equal(descriptions.size, SPORTS.length);
        }
        pass('five unique category pages have crawlable content, canonical URLs, real links and valid assets without JavaScript on both hosting paths');

        fixture = await createFixture();
        const errors = [], failures = [];
        for (const hosted of [site, pages]) {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, timezoneId: 'Europe/Bucharest'}); contexts.push(context);
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
            const football = new URL('terenuri/fotbal/', hosted.url).href;
            await page.goto(football, {waitUntil: 'networkidle'});
            await page.evaluate(() => Promise.all([window.spotivityDiscoveryReady, window.spotivitySportAppearanceReady]));
            assert.equal(await page.evaluate(() => window.siteHomeUrl()), hosted.url);
            await page.locator('#sport-fotbal .home-hero-art img').evaluate(image => image.decode());
            if (screenshotDir && hosted === site) {
                await page.setViewportSize({width: 1440, height: 1000});
                await page.screenshot({path: join(screenshotDir, 'category-fotbal-desktop.png')});
                await page.setViewportSize({width: 390, height: 844});
            }
            assert.equal(await page.locator('[data-home-courts="Fotbal"] [data-discovery-court]').count(), 1);
            await page.locator('[data-home-courts="Fotbal"] [data-discovery-court]').click();
            await page.locator('#modal-rezervare').waitFor({state: 'visible'});
            assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), 'Court A');
            await page.keyboard.press('Escape');
            await page.locator('#modal-rezervare').waitFor({state: 'hidden'});
            await page.evaluate(() => window.SpotivityNavigation?.whenSettled());
            for (const width of hosted === site ? [320, 390, 768, 1440] : [390]) {
                await page.setViewportSize({width, height: 844});
                await page.evaluate(() => window.scrollTo({top: 45, behavior: 'instant'}));
                const entry = page.locator('button.card-sport[data-sport="Fotbal"]');
                await entry.scrollIntoViewIfNeeded();
                const scroll = await page.evaluate(() => scrollY);
                const before = await page.evaluate(() => ({scrollY, height:document.documentElement.scrollHeight, width:document.documentElement.clientWidth, bodyOverflow:getComputedStyle(document.body).overflow, htmlOverflow:getComputedStyle(document.documentElement).overflow,cityHeight:document.getElementById('home-city-region').getBoundingClientRect().height,languageHeight:document.getElementById('selector-limba').getBoundingClientRect().height,ctaTop:document.querySelector('button.card-sport[data-sport]').getBoundingClientRect().top}));
                await entry.click();
                await page.locator('#modal-terenuri').waitFor({state: 'visible'});
                await page.waitForFunction(() => document.body.classList.contains('fara-scroll'));
                assert.equal(await page.locator('#filtru-nume').isVisible(), true);
                const opened = await page.evaluate(() => ({scrollY, height:document.documentElement.scrollHeight, width:document.documentElement.clientWidth, bodyOverflow:getComputedStyle(document.body).overflow, htmlOverflow:getComputedStyle(document.documentElement).overflow,cityHeight:document.getElementById('home-city-region').getBoundingClientRect().height,languageHeight:document.getElementById('selector-limba').getBoundingClientRect().height,ctaTop:document.querySelector('button.card-sport[data-sport]').getBoundingClientRect().top}));
                await page.mouse.wheel(0, 300); await page.waitForTimeout(100);
                const after = await page.evaluate(() => ({scrollY, height:document.documentElement.scrollHeight, width:document.documentElement.clientWidth, bodyOverflow:getComputedStyle(document.body).overflow, htmlOverflow:getComputedStyle(document.documentElement).overflow,cityHeight:document.getElementById('home-city-region').getBoundingClientRect().height,languageHeight:document.getElementById('selector-limba').getBoundingClientRect().height,ctaTop:document.querySelector('button.card-sport[data-sport]').getBoundingClientRect().top}));
                assert.ok(Math.abs(after.scrollY-scroll) <= 1, `Category chooser locks scroll at ${width}px: ${JSON.stringify({before,opened,after})}`);
                await page.keyboard.press('Escape');
                await page.locator('#modal-terenuri').waitFor({state: 'hidden'});
                await page.evaluate(() => window.SpotivityNavigation?.whenSettled());
                await page.waitForFunction(() => !document.body.classList.contains('fara-scroll'));
                assert.ok(Math.abs((await page.evaluate(() => scrollY))-scroll) <= 1, `Closing category chooser restores scroll at ${width}px`);
            }
            await page.setViewportSize({width: 390, height: 844});
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'Category fits a phone viewport');
            await page.reload({waitUntil: 'networkidle'});
            assert.equal(await page.evaluate(() => window.siteHomeUrl()), hosted.url);
            await page.locator('#btn-mobile-menu').click();
            await page.locator('#home-mobile-menu [data-sport-target="Tenis"]').click();
            await page.waitForURL(new URL('terenuri/tenis/', hosted.url).href);
            assert.equal(await page.locator('body').getAttribute('data-category-sport'), 'Tenis');
            if (screenshotDir && hosted === site) {
                await page.evaluate(() => Promise.all([window.spotivityDiscoveryReady, window.spotivitySportAppearanceReady]));
                await page.locator('#sport-tenis .home-hero-art img').evaluate(image => image.decode());
                await page.screenshot({path: join(screenshotDir, 'category-tenis-mobile.png')});
            }
            assert.equal(await page.locator('#home-mobile-menu').isHidden(), true);
            await page.goBack({waitUntil: 'networkidle'});
            assert.equal(new URL(page.url()).pathname, new URL(football).pathname);
            await page.locator('#home-brand').click();
            await page.waitForURL(hosted.url);
            assert.equal(await page.locator('[data-home-sport]').count(), SPORTS.length);
        }
        assert.deepEqual(errors, []); assert.deepEqual(failures, []);
        assert.ok(!fixture.requests.some(request => !['GET', 'OPTIONS'].includes(request.method) && !request.path.endsWith('/get_admin_access')), 'Browsing and opening dialogs creates no booking or email');
        pass('direct links, reload, mobile sport navigation, browser history, home and booking dialogs work at the root and the GitHub Pages prefix');
        console.log(`\n${checks} category SEO browser checks passed.`);
    } finally {
        for (const context of contexts) await context.close();
        if (browser) await browser.close();
        if (fixture) await fixture.close();
        for (const server of servers) await server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
