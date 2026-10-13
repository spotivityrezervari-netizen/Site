const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const baseUrl = process.env.SITE_BASE_URL || 'http://127.0.0.1:8000/';
const siteBaseUrl = new URL(baseUrl);
if (!siteBaseUrl.pathname.endsWith('/')) siteBaseUrl.pathname += '/';
const siteOrigin = siteBaseUrl.origin;

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
    await context.route('**/*', route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
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
    assert.equal(await page.locator('.card-sport').count(), 4);
    assert.equal(await page.evaluate(() => typeof supabase.createClient), 'function');
    await page.locator('#btn-top-cont').click();
    await page.locator('#modal-auth').waitFor({state:'visible'});
    assert.ok(await page.locator('#form-login').isVisible());
    await page.keyboard.press('Escape');
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    for (const sport of ['Fotbal','Baschet','Volei','Tenis']) {
      const courtsResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.pathname.endsWith('/rest/v1/terenuri')
          && url.searchParams.get('select') === '*';
      });
      await page.locator(`.card-sport[data-sport="${sport}"]`).click();
      await page.locator('#modal-terenuri').waitFor({state:'visible'});
      assert.ok((await page.locator('#titlu-sport').innerText()).includes(sport));
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
    const imageFailures = await page.locator('img').evaluateAll(imgs => imgs.filter(i => i.naturalWidth === 0).map(i => i.getAttribute('src')));
    assert.deepEqual(imageFailures, []);
    console.log('PASS homepage: SDK loaded, all four sport dialogs, login dialog, Escape, and images');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#btn-mobile-menu').click();
    await page.locator('#home-mobile-menu').waitFor({state:'visible'});
    assert.equal(await page.locator('#home-mobile-menu [data-sport-target]').count(),4);
    await page.keyboard.press('Escape');
    await page.locator('#home-mobile-menu').waitFor({state:'hidden'});
    await page.locator('#btn-top-cont').click();
    await page.locator('#modal-auth').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    console.log('PASS mobile viewport: login dialog opens and closes');
    assert.equal((await page.goto(new URL('admin.html', siteBaseUrl).href, {waitUntil:'networkidle'})).status(), 200);
    assert.ok(await page.locator('#sectiune-login').isVisible());
    assert.ok(await page.locator('#login-admin-btn').isVisible());
    assert.ok(!(await page.locator('#sectiune-dashboard').isVisible()));
    assert.deepEqual(failedSiteAssets, []);
    assert.deepEqual(jsErrors, []);
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
    assert.ok(read.appearanceStatus === 200 && read.appearanceCount === 4 && !read.appearanceError,
      `Required Supabase sport appearance read failed: ${JSON.stringify(read)}`);
    console.log('PASS live Supabase: read-only court and all four sport appearance queries returned HTTP 200');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
