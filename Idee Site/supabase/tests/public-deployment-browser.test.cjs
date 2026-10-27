// Exercise the actual public build with its Netlify response headers. The real
// pinned SDK runs in Chromium; all Supabase transport uses disposable SQL/RLS.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const {servePublicArtifact}=require('./public-artifact-server.cjs');
const {createFixture,host}=require('./club-request-fixture.cjs');
const directory=resolve(process.env.PUBLIC_BUILD_DIR||join(__dirname,'../../../dist'));
const screenshotDir=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
let checks=0;
const pass=message=>{checks++;console.log('PASS',message);};

(async()=>{
  const site=await servePublicArtifact({directory});let fixture,browser;
  try{
    const response=await fetch(site.url),headers=response.headers,html=await response.text();
    assert.equal(response.status,200);assert.equal(html,readFileSync(join(directory,'index.html'),'utf8'));
    const policy=headers.get('content-security-policy');assert.ok(policy,'Enforced HTTP CSP must be present');
    const directives=new Map(policy.split(';').map(rule=>rule.trim().split(/\s+/)).filter(tokens=>tokens[0]).map(([name,...sources])=>[name,sources]));
    assert.deepEqual(directives.get('default-src'),["'none'"]);
    assert.ok(directives.get('script-src').includes("'self'"));
    assert.ok(!directives.get('script-src').some(source=>["'unsafe-inline'","'unsafe-eval'",'https:','*'].includes(source)));
    assert.deepEqual(directives.get('script-src-attr'),["'unsafe-inline'"]);
    assert.deepEqual(directives.get('base-uri'),["'none'"]);assert.deepEqual(directives.get('object-src'),["'none'"]);
    assert.deepEqual(directives.get('frame-ancestors'),["'none'"]);assert.deepEqual(directives.get('form-action'),["'self'"]);
    assert.equal(headers.get('x-content-type-options'),'nosniff');assert.equal(headers.get('x-frame-options'),'DENY');assert.equal(headers.get('referrer-policy'),'no-referrer');
    assert.match(headers.get('strict-transport-security'),/max-age=31536000/);assert.match(headers.get('permissions-policy'),/geolocation=\(\)/);
    assert.ok(!html.includes('Content-Security-Policy-Report-Only'));
    pass('the built index is served with enforced CSP, anti-framing, no-referrer, MIME, permissions and HTTPS headers');

    const privatePaths=['/README.md','/netlify.toml','/package.json','/admin.html','/.git/config','/_headers','/deploy/netlify/_headers',
      '/scripts/build-public.mjs','/scripts/start-site.sh','/supabase/001_security.sql','/supabase/020_booking_groups.sql',
      '/supabase/tests/schema.sql','/supabase/tests/club-request-fixture.cjs','/supabase/functions/club-applications/handler.ts',
      '/supabase/functions/booking-workflow/handler.ts'];
    for(const path of privatePaths){const result=await fetch(new URL(path,site.url));assert.equal(result.status,404,path);assert.ok(!(await result.text()).includes('create or replace function'),path);}
    pass('documentation, SQL migrations, test fixtures, Edge source, Git metadata and deployment configuration have no public URL');

    const localTags=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g)].map(match=>match[1]).filter(value=>!/^https?:/.test(value));
    assert.ok(localTags.some(path=>path.startsWith('js/modules/public-auth.js')));assert.ok(localTags.some(path=>path.startsWith('js/modules/admin-core.js')));
    for(const path of localTags){const result=await fetch(new URL(path,site.url));assert.equal(result.status,200,path);assert.ok(result.headers.get('content-type')?.startsWith(/\.css(?:\?|$)/.test(path)?'text/css':/\.js(?:\?|$)/.test(path)?'text/javascript':'image/'),path);}
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(sdkTag);
    assert.ok(directives.get('script-src').includes(sdkTag[1]),'Only the pinned SDK CDN path is allowed');
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    pass('every referenced module, stylesheet and icon exists in the build and the allowed SDK bytes match their pinned SRI');

    fixture=await createFixture();
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;if(proxy){const url=new URL(proxy);launch.proxy={server:url.origin,bypass:'127.0.0.1,localhost'};}
    browser=await chromium.launch(launch);
    const context=await browser.newContext({timezoneId:'Europe/Bucharest',viewport:{width:390,height:844}});
    const errors=[],resourceFailures=[],forbiddenRequests=[];
    await context.addInitScript(()=>{
      window.__deploymentCSP=[];
      document.addEventListener('securitypolicyviolation',event=>window.__deploymentCSP.push({directive:event.effectiveDirective,blocked:event.blockedURI,disposition:event.disposition}));
    });
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin===new URL(site.url).origin)return route.continue();
      if(req.url()===sdkTag[1])return route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}});
      if(url.hostname===host){
        if(url.pathname==='/auth/v1/settings')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({external:{google:false}}),headers:{'access-control-allow-origin':'*'}});
        return fixture.browserRoute(route);
      }
      forbiddenRequests.push(req.url());return route.abort('blockedbyclient');
    });
    await context.routeWebSocket(url=>url.hostname.endsWith('.supabase.co'),socket=>socket.close());
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    page.on('response',response=>{if(new URL(response.url()).origin===new URL(site.url).origin&&response.status()>=400)resourceFailures.push(response.url());});
    await page.goto(site.url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>typeof window.SpotivityModules?.publicAuth==='function'&&typeof window.SpotivityModules?.adminCore==='function'&&typeof window.SpotivityBooking?.create==='function');
    await page.locator('#sport-fotbal .home-hero-art img').evaluate(image=>image.decode());
    assert.deepEqual(await page.evaluate(()=>window.__deploymentCSP),[],'Existing startup must not generate CSP violations');
    await page.locator('#btn-lang-en').click();await page.waitForFunction(()=>window.lang==='en');
    assert.equal(await page.locator('#home-nav-search-input').getAttribute('placeholder'),'Find a court');
    await page.locator('#btn-lang-ro').click();await page.waitForFunction(()=>window.lang==='ro');
    await page.locator('#sport-fotbal .home-reserve-button').click();await page.locator('#modal-terenuri').waitFor({state:'visible'});
    await page.locator('.card-teren-poza').filter({hasText:'Court A'}).click();await page.locator('#modal-rezervare').waitFor({state:'visible'});
    await page.keyboard.press('Escape');await page.locator('#modal-rezervare').waitFor({state:'hidden'});
    pass('the real built modules and images initialize under CSP, existing inline language handlers work, and the court/booking dialogs still open');

    for(const width of [390,1440]){
      await page.setViewportSize({width,height:width<768?844:1000});
      const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1);
      await page.locator('#btn-top-cont').click();await page.locator('#modal-auth').waitFor({state:'visible'});
      const box=await page.locator('#modal-auth .modal-continut').boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1);
      await page.locator('#login-email').fill('alice@example.test');await page.locator('#login-parola').fill('fixture-password');await page.locator('#btn-executa-login').click();await page.locator('#modal-auth').waitFor({state:'hidden'});
      await page.waitForFunction(()=>window.getSpotivityProfileUser?.()?.email==='alice@example.test');
      await page.locator('#btn-top-cont').click();await page.locator('#modal-profil').waitFor({state:'visible'});assert.equal(await page.locator('#btn-administreaza-baza').isVisible(),false);
      if(screenshotDir){mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:join(screenshotDir,`deployment-profile-${width}.png`)});}
      await page.locator('#btn-logout').click();await page.waitForFunction(async()=>(await db.auth.getSession()).data.session===null);
    }
    assert.deepEqual(await page.evaluate(()=>window.__deploymentCSP),[],'Existing auth/styles must remain usable under the enforced policy');
    assert.deepEqual(errors,[]);assert.deepEqual(resourceFailures,[]);
    pass('desktop and phone password sign-in, profile, ordinary-account permissions, inline styles and logout work without CSP or asset errors');

    await page.evaluate(()=>{
      const inline=document.createElement('script');inline.textContent='window.__deploymentInlineExecuted = true';document.head.append(inline);
      const external=document.createElement('script');external.src='https://unapproved-script.example.invalid/injected.js';document.head.append(external);
      const alternate=document.createElement('script');alternate.src='https://cdn.jsdelivr.net/npm/unapproved-package@1.0.0/index.js';document.head.append(alternate);
    });
    await page.waitForFunction(()=>window.__deploymentCSP.filter(event=>event.directive==='script-src-elem').length>=3);
    const attacks=await page.evaluate(()=>({inline:window.__deploymentInlineExecuted,violations:window.__deploymentCSP}));
    assert.equal(attacks.inline,undefined);assert.ok(attacks.violations.some(event=>event.blocked==='inline'&&event.disposition==='enforce'));
    assert.ok(attacks.violations.some(event=>event.blocked.startsWith('https://unapproved-script.example.invalid/')));
    assert.ok(attacks.violations.some(event=>event.blocked.startsWith('https://cdn.jsdelivr.net/npm/unapproved-package')));
    assert.deepEqual(forbiddenRequests,[],'CSP must reject unapproved scripts before the network adapter');
    pass('enforced browser CSP blocks injected inline scripts, unapproved external hosts and other packages on the approved CDN');
    console.log(`${checks} public deployment browser checks passed.`);
  }finally{if(browser)await browser.close();if(fixture)await fixture.close();await site.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
