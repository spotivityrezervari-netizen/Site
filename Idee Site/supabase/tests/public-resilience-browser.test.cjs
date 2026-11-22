// Public bootstrap must survive unavailable preference storage. History expiry
// uses the clock and cached records; all hosted requests remain intercepted.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const {servePublicArtifact}=require('./public-artifact-server.cjs');
const root=join(__dirname,'../..');
const code=name=>readFileSync(join(root,'js',name),'utf8');

(async()=>{
 const site=await servePublicArtifact({directory:root,applyHeaders:false});
 const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
 if(proxy)launch.proxy={server:new URL(proxy).origin,bypass:'127.0.0.1,localhost'};
 let browser;
 try{
  const html=readFileSync(join(root,'index.html'),'utf8');
  const tag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(tag);
  const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',tag[1]],{maxBuffer:2*1024*1024});
  assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),tag[2]);
  browser=await chromium.launch(launch);
  for(const mode of ['normal','read-denied','write-quota','remove-denied','getter-denied','invalid-language']){
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
   await context.route(tag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
   await context.route(url=>url.hostname.endsWith('.supabase.co'),route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/auth/v1/settings'?{external:{google:false}}:[]),headers:{'access-control-allow-origin':'*','content-range':'0-0/0'}}));
   await context.routeWebSocket(url=>url.hostname.endsWith('.supabase.co'),socket=>socket.close());
   await context.addInitScript(mode=>{
    if(mode==='getter-denied'){
     Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Storage refused','SecurityError');}});return;
    }
    if(mode==='invalid-language')localStorage.setItem('limba_app','not-a-supported-language');
    const method={'read-denied':'getItem','write-quota':'setItem','remove-denied':'removeItem'}[mode];
    if(method){const original=Storage.prototype[method];Storage.prototype[method]=function(key,...args){
     if(this===localStorage&&['limba_app','user_session','admin_session'].includes(key))throw new DOMException('Storage refused',mode==='write-quota'?'QuotaExceededError':'SecurityError');
     return original.call(this,key,...args);
    };}
   },mode);
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(site.url,{waitUntil:'networkidle',timeout:90000});
   await page.waitForFunction(()=>window.spotivityPublicReady===true);
   assert.equal(await page.evaluate(()=>window.lang),'ro',mode);
   await page.evaluate(()=>window.schimbaLimba('hu'));assert.equal(await page.evaluate(()=>window.lang),'hu',mode);
   assert.equal((await page.locator('#home-intro-title').textContent()).trim(),'Spotivity',mode);
   assert.equal(await page.locator('.welcome-tagline').innerText(),'A tökéletes helyszín a kívánt tevékenységhez',mode);
   await page.evaluate(()=>window.schimbaLimba('__proto__'));assert.equal(await page.evaluate(()=>window.lang),'ro',mode);
   await page.locator('button.card-sport[data-sport="Fotbal"]').first().click();
   await page.locator('#modal-terenuri').waitFor({state:'visible'});
   assert.deepEqual(errors,[],mode);
   await context.close();console.log('PASS bootstrap and booking with '+mode);
  }

  async function historyPage({day='2026-11-14',hour='10:00',end='2026-11-14T09:00:00Z',starts=true,type='active',grouped=false,extra=false}={}){
   const context=await browser.newContext({timezoneId:'America/Los_Angeles'});
   const page=await context.newPage();await page.route('**/*',route=>route.abort());
   await page.setContent('<div id="modal-profil"></div><div id="modal-lista-rezervari" style="display:none"><div class="modal-continut"><h2 id="titlu-lista-rezervari"></h2><div id="container-rezervari" style="max-height:160px;overflow:auto"></div></div></div>');
   await page.clock.install({time:new Date(Date.parse(end)-30000)});
   for(const name of ['security.js','modules/public-history.js'])await page.addScriptTag({content:code(name)});
   await page.evaluate(async options=>{
    window.lang='ro';window.dict={ro:{rez_active:'Active',istoric:'Istoric',fara_rezervari:'Fără rezervări',vezi_locatia:'Vezi locația',anuleaza:'Anulează'}};
    window.traduData=value=>value;window.esteRezervareTrecuta=(day,hour)=>window.bookingEnded(day,hour);
    const start=Date.parse(options.end)-3600000;
    const row={id:1,teren:'Test Court',sport:'Fotbal',data_str:options.day,ora:options.hour,timestamp_start:start,stare:'activa',pret_total:'100 RON',...(options.starts?{starts_at:new Date(start).toISOString()}:{}),...(options.grouped?{booking_group_id:'group-1'}:{})};
    const rows=[row];
    if(options.grouped)rows.push({...row,id:2,ora:String(Number(options.hour.slice(0,2))+1).padStart(2,'0')+':00',...(options.starts?{starts_at:new Date(start+3600000).toISOString()}:{}),timestamp_start:start+3600000});
    if(options.extra)rows.push({...row,id:3,ora:'13:00',starts_at:new Date(start+10800000).toISOString(),timestamp_start:start+10800000});
    window.historyReads=0;window.spotivityReadAllRows=async factory=>{factory();window.historyReads++;return {data:rows,error:null};};
    const query={select(){return this;},eq(){return this;},gte(){return this;},order(){return this;}};
    window.historyState={user:{id:'alice'},courts:[{nume:'Test Court',locatie:'https://example.test/'}]};
    window.historyApi=window.SpotivityModules.publicHistory({db:{from:()=>query},state:window.historyState,services:{}});
    historyApi.mount();await historyApi.open(options.type);
   },{day,hour,end,starts,type,grouped,extra});
   return {page,context};
  }
  for(const options of [{},{day:'2027-07-10',end:'2027-07-10T08:00:00Z',starts:false},{starts:false}]){
   const {page,context}=await historyPage(options);
   assert.ok((await page.locator('#container-rezervari').innerText()).includes('[ACTIVE]'));
   await page.clock.fastForward(31000);
   assert.equal(await page.locator('#container-rezervari').innerText(),'Fără rezervări');
   assert.equal(await page.evaluate(()=>historyReads),1,'Clock refresh must not poll PostgreSQL');
   assert.equal(await page.evaluate(()=>tipIstoricDeschis),'active');
   await context.close();
  }
  console.log('PASS exact expiry in winter/summer Bucharest time, including rows without starts_at and a different browser timezone');
  {
   const {page,context}=await historyPage({type:'istoric',extra:true});
   await page.locator('[data-history-key="legacy:3"] .location-teren-client').focus();
   await page.locator('#container-rezervari').evaluate(node=>{node.scrollTop=35;});
   const before=await page.locator('#container-rezervari').evaluate(node=>node.scrollTop);
   await page.clock.fastForward(31000);
   const text=await page.locator('#container-rezervari').innerText();assert.ok(text.includes('[FINALIZED]')&&text.includes('[ACTIVE]'));
   assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-history-key]')?.dataset.historyKey),'legacy:3');
   assert.equal(await page.locator('#container-rezervari').evaluate(node=>node.scrollTop),before);
   assert.equal(await page.evaluate(()=>historyReads),1);await context.close();
  }
  console.log('PASS history updates finalized labels without losing mode, scroll or focus');
  {
   const {page,context}=await historyPage({grouped:true});
   await page.clock.fastForward(31000);assert.ok((await page.locator('#container-rezervari').innerText()).includes('[ACTIVE]'));
   await page.clock.fastForward(3600000);assert.equal(await page.locator('#container-rezervari').innerText(),'Fără rezervări');
   assert.equal(await page.evaluate(()=>historyReads),1);await context.close();
  }
  console.log('PASS consecutive booking groups finalize only after their last remaining hour');
  for(const action of ['close','invalidate','signout','hidden-tab']){
   const {page,context}=await historyPage();
   await page.evaluate(action=>{
    if(action==='close')document.getElementById('modal-lista-rezervari').style.display='none';
    if(action==='invalidate')historyApi.invalidate();
    if(action==='signout'){historyState.user=null;dispatchEvent(new CustomEvent('spotivity:profile-user',{detail:{user:null}}));}
    if(action==='hidden-tab'){Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));}
   },action);
   await page.clock.fastForward(31000);assert.ok((await page.locator('#container-rezervari').textContent()).includes('[ACTIVE]'),action);
   assert.equal(await page.evaluate(()=>historyReads),1,action);
   if(action==='hidden-tab'){
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.locator('#container-rezervari').innerText(),'Fără rezervări');
   }
   await context.close();
  }
  console.log('PASS no hidden/invalidated/signed-out refresh; returning to the tab catches up without another database request');
 }finally{await browser?.close();await site.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
