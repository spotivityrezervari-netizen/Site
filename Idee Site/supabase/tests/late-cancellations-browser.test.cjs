// Isolated UI with the real module/styles; no Auth, live database or email calls.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {mkdirSync,readFileSync}=require('node:fs');
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8117/';
const screenshots=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if(screenshots)mkdirSync(screenshots,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/__late-cancellation-ui__'))return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body></body></html>'});const stylesheet=url.pathname.match(/\/css\/([a-z-]+)\.css$/);if(url.origin===new URL(base).origin&&stylesheet)return route.fulfill({contentType:'text/css',body:readFileSync(join(__dirname,'../../css',`${stylesheet[1]}.css`),'utf8')});return route.abort();});
  await page.goto(new URL('__late-cancellation-ui__',base).href);
  // Remove the app frame; tests below mount just the production review module.
  await page.setContent(`<html><head><base href="${base}">${['style','theme','admin','admin-theme','base-admin','admin-late-cancellations'].map(name=>`<link rel="stylesheet" href="css/${name}.css">`).join('')}</head><body class="pagina-publica"><div id="base-admin-workspace" class="base-admin-workspace"><div class="base-admin-panel"><div class="base-admin-tools"></div></div></div></body></html>`);
  await page.addScriptTag({path:join(__dirname,'../../js/admin-late-cancellations.js')});
  await page.evaluate(()=>{
   window.reviewRequests=[];window.reviewDeferred=false;
   window.reviewData={days:30,frequent_threshold:3,automatic_restrictions:false,customers:[{name:'<img src=x onerror="window.attacked=true">',email:'ana@example.test',phone:'+40 721 123 456',count:3,total_count:8,frequent:true,last_cancelled_at:'2026-10-25T09:30:00Z',events:[{court_name:'Court A',starts_at:'2026-10-25T10:00:00Z',cancelled_at:'2026-10-25T09:30:00Z',lead_minutes:30}]}]};
   window.createLateCancellationReview({rpc(name,args){window.reviewRequests.push({name,args});if(window.reviewDeferred)return new Promise(resolve=>window.reviewResolve=resolve);return Promise.resolve({data:window.reviewData,error:null});}});
  });
  assert.equal(await page.locator('#modal-late-cancellations').evaluate(node=>getComputedStyle(node).position),'fixed','Production modal stylesheet loaded');
  assert.equal(await page.locator('#btn-late-cancellations').isVisible(),false);
  assert.equal(await page.evaluate(()=>openLateCancellationReview()),false);
  await page.evaluate(()=>dispatchEvent(new CustomEvent('spotivity:admin-role',{detail:{userId:'owner',isSuper:false}})));
  assert.equal(await page.locator('#btn-late-cancellations').isVisible(),true);assert.equal(await page.evaluate(()=>reviewRequests.length),0);
  assert.equal(await page.evaluate(()=>openLateCancellationReview()),true);await page.locator('.late-cancellation-customer').waitFor();
  assert.match(await page.locator('#late-cancellation-scope').innerText(),/numai.*terenurile alocate/);
  assert.equal(await page.locator('.late-cancellation-count').innerText(),'8','Badge uses the authorised server lifetime total, independently of the 30-day count and listed events');
  assert.equal(await page.locator('.late-cancellation-count').getAttribute('aria-label'),'8 anulări târzii până acum');
  assert.equal(await page.locator('.late-cancellation-count').getAttribute('title'),'8 anulări târzii până acum');
  assert.match(await page.locator('.late-cancellation-window-count').innerText(),/ultimele 30 de zile: 3/);
  assert.deepEqual(await page.evaluate(()=>reviewRequests),[{name:'list_late_cancellations',args:{p_days:30}}]);
  await page.locator('.late-cancellation-close').click();
  console.log('PASS ordinary administrator can open the server-scoped review with clear assigned-courts explanation');
  await page.evaluate(()=>dispatchEvent(new CustomEvent('spotivity:admin-role',{detail:{userId:'super',isSuper:true}})));
  await page.locator('#btn-late-cancellations').click();await page.locator('.late-cancellation-customer').waitFor();
  assert.match(await page.locator('#late-cancellation-scope').innerText(),/toate terenurile/);
  assert.equal(await page.locator('.late-cancellation-contact a[href="tel:+40721123456"]').count(),1);
  assert.equal(await page.locator('.late-cancellation-contact a[href="mailto:ana@example.test"]').count(),1);
  assert.equal(await page.locator('.late-cancellation-customer img').count(),0);assert.equal(await page.evaluate(()=>window.attacked),undefined);
  assert.match(await page.locator('.late-cancellation-policy').innerText(),/nu sunt blocate automat/);
  assert.match(await page.locator('.late-cancellation-policy').innerText(),/până acum/);
  await page.locator('.late-cancellation-events summary').click();
  assert.match(await page.locator('.late-cancellation-events').innerText(),/30 minute înainte/);
  assert.deepEqual(await page.evaluate(()=>reviewRequests),Array.from({length:2},()=>({name:'list_late_cancellations',args:{p_days:30}})));
  for(const width of[320,390,1440]){
   await page.setViewportSize({width,height:844});
   const panel=await page.locator('.late-cancellation-panel').evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,page:document.documentElement.scrollWidth,viewport:innerWidth};});
   assert.ok(panel.left>=-1&&panel.right<=width+1&&panel.page<=width+1,JSON.stringify(panel));
   if(screenshots)await page.screenshot({path:join(screenshots,`late-cancellations-${width}.png`)});
  }
  console.log('PASS superadmin renders escaped contacts, a numeric lifetime badge separate from the 30-day count, no automatic ban and responsive320/390/1440 panels');
  await page.evaluate(()=>{reviewData.customers[0].total_count=0;});
  await page.locator('.late-cancellation-refresh').click();
  await page.waitForFunction(()=>document.querySelector('.late-cancellation-count')?.textContent==='0');
  assert.equal(await page.locator('.late-cancellation-count').getAttribute('aria-label'),'0 anulări târzii până acum');
  await page.evaluate(()=>{delete reviewData.customers[0].total_count;});
  await page.locator('.late-cancellation-refresh').click();
  await page.waitForFunction(()=>document.querySelector('.late-cancellation-count')?.textContent==='—');
  assert.equal(await page.locator('.late-cancellation-count').getAttribute('aria-label'),'Totalul anulărilor târzii nu este disponibil');
  assert.match(await page.locator('.late-cancellation-window-count').innerText(),/ultimele 30 de zile: 3/);
  console.log('PASS a true zero stays numeric and an older server without lifetime totals shows unavailable instead of the 30-day count');
  await page.locator('.late-cancellation-close').click();await page.evaluate(()=>window.reviewDeferred=true);
  await page.locator('#btn-late-cancellations').click();
  await page.waitForFunction(()=>typeof reviewResolve==='function');
  await page.evaluate(()=>{dispatchEvent(new CustomEvent('spotivity:admin-role',{detail:{userId:'super',isSuper:false}}));reviewResolve({data:reviewData,error:null});});
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#btn-late-cancellations').isVisible(),true);assert.equal(await page.locator('#modal-late-cancellations').isVisible(),false);assert.equal(await page.locator('#late-cancellation-list').textContent(),'');
  assert.match(await page.locator('#late-cancellation-scope').textContent(),/numai.*terenurile alocate/);
  await page.evaluate(()=>dispatchEvent(new Event('spotivity:admin-clear')));
  assert.equal(await page.locator('#btn-late-cancellations').isVisible(),false);assert.equal(await page.evaluate(()=>openLateCancellationReview()),false);
  assert.equal(await page.locator('#late-cancellation-scope').textContent(),'');
  console.log('PASS same-account role changes and logout drop outstanding private responses and clear all visible data');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
