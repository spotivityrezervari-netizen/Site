// Real Chromium regression for slideshow booking actions and accessible autoplay.
// Serve the reviewed public site and set SITE_BASE_URL, as for other browser tests.
// All hosted Auth/database/Storage/WebSocket requests are intercepted; no live writes.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync,writeFileSync,mkdtempSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {tmpdir}=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'../..');
const out=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR||mkdtempSync(join(tmpdir(),'spotivity-home-gallery-'));
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8105/';
const sports=['Fotbal','Baschet','Tenis','Volei','Tenis Picior'];
const slugs={Fotbal:'fotbal',Baschet:'baschet',Tenis:'tenis',Volei:'volei','Tenis Picior':'tenis-de-picior'};
(async()=>{
 mkdirSync(out,{recursive:true});
 const html=readFileSync(root+'/index.html','utf8');
 const tag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(tag);
 const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',tag[1]],{maxBuffer:2*1024*1024});
 assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),tag[2]);
 const launch={executablePath:'/usr/bin/chromium',headless:true};
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;if(proxy)launch.proxy={server:new URL(proxy).origin,bypass:'127.0.0.1,localhost'};
 const browser=await chromium.launch(launch);
 const errors=[],failed=[],bad=[],results=[];
 try{
  const context=await browser.newContext({timezoneId:'Europe/Bucharest',viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.route(tag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
  await context.route(url=>url.hostname.endsWith('.supabase.co'),route=>{
   const path=new URL(route.request().url()).pathname;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path==='/auth/v1/settings'?{external:{google:false}}:path==='/rest/v1/site_sporturi'?sports.map((sport,i)=>({sport,fundal_url:'assets/imagini/'+({Fotbal:'BackgroundFootball.avif',Baschet:'BackgroundBasketball.avif',Tenis:'TenisFINAL.jpeg',Volei:'BackgroundVoleyball.avif','Tenis Picior':'BackgroundLavolei.avif'})[sport],icona_url:'assets/imagini/avatar2.png',ordine:i+1})):[]),headers:{'access-control-allow-origin':'*','content-range':'0-0/0'}});
  });
  await context.routeWebSocket(url=>url.hostname.endsWith('.supabase.co'),socket=>socket.close());
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});
  await page.goto(base,{waitUntil:'networkidle',timeout:90000});
  await page.waitForFunction(()=>typeof window.openSpotivityCourtList==='function');
  await page.evaluate(()=>window.spotivitySportAppearanceReady);
  const metadata=await page.evaluate(()=>({h1:document.querySelectorAll('h1').length,canonical:document.querySelector('link[rel="canonical"]').href,title:document.title,json:document.querySelector('#spotivity-seo-data').textContent}));assert.equal(metadata.h1,1);
  const front=page.locator('[data-photo-current]'),cover=page.locator('.welcome-cover'),link=front.locator('.welcome-photo-link');
  async function choose(sport){
   await page.locator(`[data-welcome-sport="${sport}"]`).click();
   await page.waitForFunction(sport=>document.querySelector('.welcome-cover').dataset.gallerySport===sport,sport);
   await page.waitForFunction(sport=>document.querySelector('[data-photo-current] .welcome-photo-link').dataset.sport===sport,sport);
  }
  async function assertCard(sport,width,language){
   const detail=await front.evaluate(card=>{const a=card.querySelector('a'),title=card.querySelector('[data-slide-title]'),cta=card.querySelector('[data-slide-cta]');return {href:a.href,sport:a.dataset.sport,title:title.textContent,cta:cta.textContent,hidden:card.closest('[aria-hidden="true"]')!==null,tabindex:a.tabIndex,card:card.getBoundingClientRect().toJSON(),ctaBox:cta.getBoundingClientRect().toJSON(),image:card.querySelector('img').src};});
   assert.ok(new URL(detail.href).pathname.endsWith('/terenuri/'+slugs[sport]+'/'),JSON.stringify(detail));assert.equal(detail.sport,sport);assert.equal(detail.hidden,false);assert.equal(detail.tabindex,0);
   const expected=await page.evaluate(sport=>({title:window.dict[window.lang][sport.toLowerCase()]||sport,cta:window.dict[window.lang].home_rezerva}),sport);
   assert.equal(detail.title,expected.title);assert.equal(detail.cta,expected.cta);
   assert.ok(detail.ctaBox.left>=detail.card.left-1&&detail.ctaBox.right<=detail.card.right+1&&detail.ctaBox.bottom<=detail.card.bottom+1,JSON.stringify({width,language,sport,detail}));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   return detail;
  }
  async function clickAndClose(sport,kind){
   if(kind==='cta')await front.locator('[data-slide-cta]').click();
   else if(kind==='keyboard'){await link.focus();await link.press('Enter');}
   else{const box=await link.boundingBox();await link.click({position:{x:box.width*.5,y:box.height-20}});}
   await page.locator('#modal-terenuri').waitFor({state:'visible'});assert.equal(await page.locator('#modal-terenuri').getAttribute('data-sport'),sport);
   assert.equal(new URL(page.url()).pathname,new URL(base).pathname,'Ordinary click uses current lower sport booking flow');
   await page.locator('#inchide-terenuri').click();await page.locator('#modal-terenuri').waitFor({state:'hidden'});
  }
  for(const width of [320,390,768,1024,1440,1920]){
   await page.setViewportSize({width,height:width<768?844:1000});
   for(const language of ['ro','hu','en']){
    await page.evaluate(language=>window.schimbaLimba(language),language);
    for(const [i,sport]of sports.entries()){
     await choose(sport);const detail=await assertCard(sport,width,language);
     await clickAndClose(sport,i%2?'photo':'cta');
     results.push({width,language,sport,href:detail.href});
    }
   }
   await page.evaluate(()=>window.schimbaLimba('ro'));await choose('Fotbal');
   if([390,1440].includes(width)){
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.locator('.home-welcome').screenshot({path:out+'/welcome-'+width+'.png'});
    for(const sport of ['Tenis','Tenis Picior']){await choose(sport);await page.locator('.home-welcome').screenshot({path:out+'/welcome-'+sport.replaceAll(' ','-')+'-'+width+'.png'});}
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.schimbaLimba('ro'));await choose('Fotbal');
  // Keyboard activation uses the same existing sport action.
  await clickAndClose('Fotbal','keyboard');
  // Correct visual sport and action survive slow custom sources and stale requests.
  await context.route('https://images.example.test/gallery-slow.jpg',async route=>{await new Promise(resolve=>setTimeout(resolve,2400));await route.fulfill({status:200,contentType:'image/jpeg',body:readFileSync(root+'/assets/imagini/TenisFINAL.jpeg')});});
  await page.evaluate(()=>window.spotivitySportAppearance.Tenis.fundal_url='https://images.example.test/gallery-slow.jpg');
  await page.locator('[data-welcome-sport="Tenis"]').click();await page.locator('[data-welcome-sport="Volei"]').click();
  await page.waitForFunction(()=>document.querySelector('.welcome-cover').dataset.gallerySport==='Volei');await page.waitForTimeout(2700);await assertCard('Volei',1440,'ro');
  await page.evaluate(()=>{window.spotivitySportAppearance.Volei.fundal_url='assets/imagini/BackgroundFootball.avif';dispatchEvent(new CustomEvent('spotivity:sport-appearance'));});
  await choose('Volei');await page.waitForFunction(()=>document.querySelector('.welcome-cover').src.endsWith('BackgroundFootball.avif'));await assertCard('Volei',1440,'ro');await clickAndClose('Volei','cta');
  await page.evaluate(()=>{window.spotivitySportAppearance.Tenis.fundal_url='assets/imagini/TenisFINAL.jpeg';window.spotivitySportAppearance.Volei.fundal_url='assets/imagini/BackgroundVoleyball.avif';dispatchEvent(new CustomEvent('spotivity:sport-appearance'));});
  // Modified click retains native category href navigation in a new tab.
  await choose('Fotbal');const popupPromise=context.waitForEvent('page');await link.click({modifiers:['Control']});const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');assert.ok(new URL(popup.url()).pathname.endsWith('/terenuri/fotbal/'));assert.equal(await page.locator('#modal-terenuri').isVisible(),false);await popup.close();
  await page.emulateMedia({reducedMotion:'no-preference'});await choose('Fotbal');await page.locator('[data-welcome-gallery]').hover();
  await page.evaluate(()=>{document.activeElement?.blur();window.slideEvents=[];let previous=document.querySelector('.welcome-cover').dataset.gallerySport;new MutationObserver(()=>{const sport=document.querySelector('.welcome-cover').dataset.gallerySport;if(sport!==previous){slideEvents.push({sport,at:performance.now()});previous=sport;}}).observe(document.querySelector('.welcome-cover'),{attributes:true,attributeFilter:['data-gallery-sport']});});
  await page.waitForFunction(()=>document.querySelector('[data-photo-next]').getAnimations().some(a=>a.playState==='running'));
  const next=page.locator('[data-photo-next]');assert.equal(await next.evaluate(node=>node.getAnimations()[0].effect.getTiming().duration),600);
  const start=await next.boundingBox();await page.waitForTimeout(100);const end=await next.boundingBox();assert.ok(end.x<start.x,'Slides move right to left');
  await page.waitForFunction(()=>slideEvents.length>=5,null,{timeout:16000});
  const cycle=await page.evaluate(()=>slideEvents.slice(0,5));assert.deepEqual(cycle.map(x=>x.sport),['Baschet','Tenis','Volei','Tenis Picior','Fotbal']);
  const intervals=cycle.slice(1).map((event,index)=>Math.round(event.at-cycle[index].at));assert.ok(intervals.every(ms=>ms>=2400&&ms<=2850),JSON.stringify(intervals));
  await link.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await link.evaluate(node=>node.matches(':focus-visible')),true);const focused=await cover.getAttribute('data-gallery-sport');await page.waitForTimeout(2850);assert.equal(await cover.getAttribute('data-gallery-sport'),focused,'Booking link remains stable while keyboard-focused');
  await page.locator('[data-gallery-toggle]').click();const paused=await cover.getAttribute('data-gallery-sport');await page.waitForTimeout(2850);assert.equal(await cover.getAttribute('data-gallery-sport'),paused,'Pause is respected');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-gallery-toggle]').waitFor({state:'hidden'});await choose('Tenis');await page.waitForTimeout(2700);assert.equal(await cover.getAttribute('data-gallery-sport'),'Tenis');
  const afterMetadata=await page.evaluate(()=>({h1:document.querySelectorAll('h1').length,canonical:document.querySelector('link[rel="canonical"]').href,title:document.title,json:document.querySelector('#spotivity-seo-data').textContent}));assert.deepEqual(afterMetadata,metadata);
  for(const sport of sports)assert.ok(await page.locator(`a[href$="terenuri/${slugs[sport]}/"]`).count()>0);
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(bad,[]);
  writeFileSync(out+'/result.json',JSON.stringify({results,automaticCycle:cycle.map(x=>x.sport),intervalsMs:intervals,errors,failed,bad,metadataUnchanged:true,keyboard:true,customSource:true,nativeModifiedClick:true},null,2));
  console.log(JSON.stringify({cases:results.length,viewports:[320,390,768,1024,1440,1920],languages:['ro','hu','en'],intervalsMs:intervals,metadataUnchanged:true,errors,failed,bad}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
