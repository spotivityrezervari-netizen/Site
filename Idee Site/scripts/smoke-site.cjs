const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const {readFileSync, mkdtempSync, rmSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createHash} = require('node:crypto');
const runFile = promisify(execFile);
const baseUrl = process.env.SITE_BASE_URL || 'http://127.0.0.1:8000/';
const siteBaseUrl = new URL(baseUrl);
if (!siteBaseUrl.pathname.endsWith('/')) siteBaseUrl.pathname += '/';
const siteOrigin = siteBaseUrl.origin;
// Opt in when Chromium does not inherit the cloud machine's HTTPS trust store.
// This transports real responses; no API responses or images are substituted.
const tlsTransport = process.env.SPOTIVITY_SMOKE_TLS_TRANSPORT || 'browser';
assert.ok(['browser', 'curl'].includes(tlsTransport), 'SPOTIVITY_SMOKE_TLS_TRANSPORT must be browser or curl');

async function verifiedHttpsRead(request) {
  const url = new URL(request.url());
  assert.equal(url.protocol, 'https:');
  assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()), 'Smoke transport permits read requests only');
  const directory = mkdtempSync(join(tmpdir(), 'spotivity-smoke-https-'));
  const headersFile = join(directory, 'headers');
  const bodyFile = join(directory, 'body');
  try {
    const args = ['--silent', '--show-error', '--location', '--compressed', '--max-time', '30',
      '--proto', '=https', '--proto-redir', '=https', '--request', request.method(),
      '--dump-header', headersFile, '--output', bodyFile, '--write-out', '%{http_code}'];
    if (request.method() === 'HEAD') args.push('--head');
    // Reuse the browser's current public API key/Auth binding. Never print
    // request headers or curl's argument list, including on a process error.
    for (const [name, value] of Object.entries(await request.allHeaders())) {
      if (['host', 'connection', 'content-length', 'accept-encoding'].includes(name.toLowerCase())) continue;
      args.push('--header', `${name}: ${value}`);
    }
    args.push('--url', url.href);
    let result;
    try { result = await runFile('curl', args, {maxBuffer: 1024*1024}); }
    catch { throw new Error(`TLS-validated HTTPS transport failed for ${url.hostname}${url.pathname}`); }
    const status = Number(result.stdout);
    assert.ok(status >= 100 && status <= 599, 'Curl must return an HTTP status');
    const blocks = readFileSync(headersFile, 'utf8').split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
    assert.ok(blocks.length, 'Curl must return HTTPS response headers');
    const headers = {};
    for (const line of blocks.at(-1).split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(':');
      if (colon < 1) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) continue;
      headers[name] = line.slice(colon+1).trim();
    }
    return {status, headers, body: readFileSync(bodyFile)};
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

async function openProfile(page) {
  const profile = page.locator('#btn-top-cont');
  if (await profile.isVisible()) {
    await profile.click();
    return;
  }
  const menu = page.locator('#home-mobile-menu');
  if (!await menu.isVisible()) await page.locator('#btn-mobile-menu').click();
  await menu.locator('[data-profile-target]').click();
}

(async () => {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  const options = { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true };
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    options.proxy = { server: u.origin, bypass: '127.0.0.1,localhost' };
    if (u.username) options.proxy.username = decodeURIComponent(u.username);
    if (u.password) options.proxy.password = decodeURIComponent(u.password);
  }
  const browser = await chromium.launch(options);
  try {
    const context = await browser.newContext({ timezoneId: 'Europe/Bucharest' });
    const transportErrors = [];
    let verifiedSdk = false;
    const sdkTag = tlsTransport === 'curl' && readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
      .match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    if (tlsTransport === 'curl') assert.ok(sdkTag, 'The application must pin Supabase SDK with SRI');
    await context.route('**/*', async route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
      const request = route.request(), url = new URL(request.url());
      if (tlsTransport === 'curl' && url.protocol === 'https:'
          && (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'ndubcdwohqzgxpuiowye.supabase.co' || url.origin === siteOrigin)) {
        let response;
        try {
          response = await verifiedHttpsRead(request);
          if (url.href === sdkTag[1] && request.method() === 'GET') {
            assert.equal(response.status, 200, 'The real pinned SDK must download successfully');
            assert.equal('sha384-' + createHash('sha384').update(response.body).digest('base64'), sdkTag[2],
              'TLS-validated SDK bytes must match the exact application SRI');
            verifiedSdk = true;
          }
        } catch (error) {
          transportErrors.push(error.message);
          return route.abort();
        }
        return route.fulfill(response);
      }
      return route.continue();
    });
    const page = await context.newPage();
    const jsErrors = [];
    const failedSiteAssets = [];
    const backend = [];
    page.on('pageerror', e => { jsErrors.push(e.message); console.log('Browser exception:', e.message); });
    page.on('response', r => {
      const u = new URL(r.url());
      if (u.origin === siteOrigin && r.status() >= 400) failedSiteAssets.push(`${r.status()} ${u.pathname}`);
      if (u.hostname.endsWith('.supabase.co')) backend.push({ status: r.status(), path: u.pathname });
    });
    page.on('requestfailed', r => {
      const u = new URL(r.url());
      console.log('Request failed:', u.hostname + u.pathname, r.failure()?.errorText);
      if (u.origin === siteOrigin) failedSiteAssets.push(u.pathname);
      if (u.hostname.endsWith('.supabase.co')) backend.push({ path: u.pathname, error: r.failure()?.errorText });
    });
    assert.equal((await page.goto(siteBaseUrl.href, {waitUntil:'networkidle'})).status(), 200);
    await page.waitForFunction(() => typeof window.actualizeazaButonCont === 'function');
    await page.evaluate(() => window.spotivitySportAppearanceReady);
    assert.equal(await page.locator('.card-sport[data-sport]').count(), 5);
    assert.equal(await page.locator('#btn-administreaza-baza').isVisible(), false);
    assert.equal(await page.locator('#base-admin-workspace').isVisible(), false);
    assert.equal(await page.evaluate(() => typeof supabase.createClient), 'function');
    if (tlsTransport === 'curl') assert.equal(verifiedSdk, true, 'The SDK must pass TLS and exact SRI verification');
    await openProfile(page);
    await page.locator('#modal-auth').waitFor({state:'visible'});
    assert.ok(await page.locator('#form-login').isVisible());
    await page.keyboard.press('Escape');
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    for (const sport of ['Fotbal','Baschet','Volei','Tenis','Tenis Picior']) {
      const courtsResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.pathname.endsWith('/rest/v1/terenuri')
          && url.searchParams.get('select') === '*';
      });
      await page.locator(`.card-sport[data-sport="${sport}"]`).click();
      await page.locator('#modal-terenuri').waitFor({state:'visible'});
      const sportLabel = await page.evaluate(sport => window.dict?.[window.lang]?.[sport.toLowerCase()] || sport, sport);
      assert.ok((await page.locator('#titlu-sport').innerText()).includes(sportLabel));
      assert.equal((await courtsResponse).status(), 200);
      await page.waitForFunction(() => {
        const container = document.getElementById('container-dinamic-terenuri');
        return container.textContent.trim() && container.textContent.trim() !== window.dict?.[window.lang]?.se_cauta;
      });
      await page.waitForLoadState('networkidle');
      const courtImages = await page.locator('#container-dinamic-terenuri img').evaluateAll(async images => {
        await Promise.all(images.map(image => image.decode().catch(() => {})));
        return images.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.getAttribute('src'));
      });
      assert.deepEqual(courtImages, [], `Court images failed for ${sport}`);
      await page.locator('#inchide-terenuri').click();
      await page.locator('#modal-terenuri').waitFor({state:'hidden'});
    }
    await page.waitForFunction(() => [...document.images].every(img => img.complete));
    const imageFailures = await page.locator('img').evaluateAll(imgs => imgs.filter(i => (i.getAttribute('src') || i.getClientRects().length) && i.naturalWidth === 0).map(i => i.getAttribute('src')));
    assert.deepEqual(imageFailures, []);
    console.log('PASS homepage: SDK loaded, all five sport dialogs, login dialog, Escape, and images');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#home-nav-search').isVisible(),true);
    assert.equal(await page.locator('#btn-top-cont').isVisible(),true);
    assert.equal(await page.locator('#btn-top-cont .home-profile-symbol').isVisible(),true);
    await page.locator('#btn-mobile-menu').click();
    await page.locator('#home-mobile-menu').waitFor({state:'visible'});
    assert.equal(await page.locator('#home-mobile-menu [data-sport-target]').count(),5);
    assert.equal(await page.locator('#home-mobile-menu [data-club-registration-target]').innerText(),'Înscrie-ți baza');
    assert.equal(await page.locator('#home-mobile-menu button').first().evaluate(button=>button.hasAttribute('data-profile-target')),true);
    assert.equal(await page.locator('#btn-top-cont').isVisible(),false);
    assert.equal(await page.locator('#home-nav-search').isVisible(),false);
    await page.locator('#home-mobile-menu [data-club-registration-target]').click();
    await page.locator('#home-mobile-menu').waitFor({state:'hidden'});
    await page.locator('#modal-club-registration').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.locator('#modal-club-registration').waitFor({state:'hidden'});
    assert.equal(await page.locator('#btn-mobile-menu').evaluate(node=>node===document.activeElement),true);
    await openProfile(page);
    await page.locator('#modal-auth').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    console.log('PASS mobile viewport: login dialog opens and closes');
    assert.equal(await page.locator('.home-sport-heading img').count(),0);
    const basesRead = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rest/v1/baze_sportive'));
    await page.locator('#btn-home-baze').click();
    await page.locator('#modal-baze-sportive').waitFor({state:'visible'});
    assert.equal((await basesRead).status(),200);
    await page.waitForFunction(()=>document.getElementById('baze-sportive-continut').getAttribute('aria-busy')==='false');
    const baseCards=page.locator('[data-base-id]');
    if (await baseCards.count()) {
      await baseCards.first().click();
      await page.locator('#baze-sportive-share').waitFor({state:'visible'});
      assert.ok(await page.locator('[data-base-court]').count()>0);
      assert.ok(await page.locator('#baze-sportive-descriere').isVisible());
    }
    await page.locator('#inchide-baze-sportive').click();
    await page.locator('#modal-baze-sportive').waitFor({state:'hidden'});
    console.log('PASS public sports bases: live directory, description, share and associated court controls');

    await page.evaluate(() => window.spotivityDiscoveryReady);
    assert.equal(await page.locator('.home-nav [data-bases-target]').count(), 0);
    assert.equal(await page.locator('.home-explore-button').count(), 0);
    assert.equal(await page.locator('.home-hero-actions button').count(), 5);
    assert.ok(await page.locator('#home-bases-section').isVisible());
    await page.locator('#btn-home-search').click();
    await page.locator('#modal-cautare-terenuri').waitFor({state:'visible'});
    const allCourtCount = await page.locator('#home-search-results [data-discovery-court]').count();
    assert.ok(allCourtCount > 0);
    await page.locator('#home-search-input').fill('zz-nu-exista-teren-zz');
    assert.equal(await page.locator('#home-search-results [data-discovery-court]').count(), 0);
    await page.locator('#home-search-input').fill('');
    assert.equal(await page.locator('#home-search-results [data-discovery-court]').count(), allCourtCount);
    const firstCourtName = await page.locator('#home-search-results .home-court-details strong').first().innerText();
    await page.locator('#home-search-input').fill(firstCourtName.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    assert.ok((await page.locator('#home-search-results').innerText()).includes(firstCourtName));
    await page.locator('#home-search-results [data-discovery-court]').first().click();
    await page.locator('#modal-rezervare').waitFor({state:'visible'});
    await page.locator('#modal-cautare-terenuri').waitFor({state:'hidden'});
    assert.equal(await page.locator('#rezervare-teren-selectat').innerText(), firstCourtName);
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('PASS live discovery: global name search, empty results, existing reservation form, one action per sport and separate bases section');
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 844});
      await page.locator('#btn-club-registration').click();
      await page.locator('#modal-club-registration').waitFor({state: 'visible'});
      assert.equal(await page.locator('#club-request-name').isVisible(), true);
      assert.equal(await page.locator('#club-request-email').getAttribute('type'), 'email');
      assert.equal(await page.locator('#club-request-password').getAttribute('type'), 'password');
      assert.equal(await page.locator('#club-request-password-confirm').getAttribute('type'), 'password');
      assert.equal(await page.locator('[data-club-court-price]').getAttribute('step'), '1');
      assert.equal(await page.locator('#club-request-submit').isEnabled(), true);
      assert.equal(await page.locator('[data-club-court-sport] option').count(), 5);
      assert.equal(await page.locator('#club-request-photo').getAttribute('type'), 'file');
      const bounds = await page.locator('.club-registration-panel').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      if (process.env.SPOTIVITY_SMOKE_SCREENSHOT_DIR) {
        mkdirSync(process.env.SPOTIVITY_SMOKE_SCREENSHOT_DIR, {recursive: true});
        await page.locator('.club-registration-panel').evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({path: join(process.env.SPOTIVITY_SMOKE_SCREENSHOT_DIR, `registration-${width}.png`)});
      }
      await page.keyboard.press('Escape');
      await page.locator('#modal-club-registration').waitFor({state: 'hidden'});
    }
    console.log('PASS club registration: public multi-sport form, contact fields, photo picker, responsive layout and Escape; no submission writes');


    assert.equal((await page.goto(new URL('admin.html', siteBaseUrl).href, {waitUntil:'networkidle'})).status(), 200);
    assert.ok(await page.locator('#sectiune-login').isVisible());
    assert.ok(await page.locator('#login-admin-btn').isVisible());
    assert.ok(!(await page.locator('#sectiune-dashboard').isVisible()));
    assert.deepEqual(failedSiteAssets, []);
    assert.deepEqual(jsErrors, []);
    assert.deepEqual(transportErrors, []);
    assert.equal(await page.locator('#btn-cereri-baze-admin').isVisible(), false);
    console.log('PASS admin: login visible, dashboard hidden; no JavaScript exceptions or failed site assets');
    console.log('Backend read results:', JSON.stringify(backend));
    const read = await page.evaluate(async () => {
      const result = await db.from('terenuri').select('id').limit(1);
      const appearance = await db.from('site_sporturi').select('*').order('ordine');
      return { status: result.status, isArray: Array.isArray(result.data), hasError: !!result.error,
        appearanceStatus: appearance.status, appearanceCount: appearance.data?.length, appearanceError: !!appearance.error };
    });
    assert.ok(read.status === 200 && read.isArray && !read.hasError,
      `Required Supabase read failed: ${JSON.stringify(read)}. Check environment network access to ndubcdwohqzgxpuiowye.supabase.co.`);
    assert.ok(read.appearanceStatus === 200 && read.appearanceCount === 5 && !read.appearanceError,
      `Required Supabase sport appearance read failed: ${JSON.stringify(read)}`);
    console.log('PASS live Supabase: read-only court and all five sport appearance queries returned HTTP 200');
    if (tlsTransport === 'curl') console.log('PASS HTTPS transport: real CDN/Supabase responses validated with curl TLS and exact pinned SDK SRI');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
