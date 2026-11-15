// Actual discovery modal markup and controller, driven with real Tab/Enter in
// Chromium. All data is in-memory and no hosted request or booking is made.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const root=join(__dirname,'../..');
(async()=>{
 const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
 if(proxy)launch.proxy={server:new URL(proxy).origin,bypass:'127.0.0.1,localhost'};
 const browser=await chromium.launch(launch);
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  const html=readFileSync(join(root,'index.html'),'utf8');
  const modal=html.slice(html.indexOf('<div class="modal" id="modal-cautare-terenuri"'),html.indexOf('<!-- BAZE SPORTIVE:'));
  assert.ok(modal.includes('home-search-input')&&modal.includes('home-search-results'));
  await page.setContent('<button id="search-trigger">Caută</button><button id="outside">În afara dialogului</button><div id="home-bases-directory"></div>'+modal);
  await page.evaluate(()=>{
   window.lang='ro';window.dict={ro:{fotbal:'Fotbal'}};
   window.normalizeSportName=value=>value;window.appAssetUrl=()=>'';
   window.SpotivityNavigation={courtUrl:court=>'https://example.test/terenuri/'+court.id+'/',baseUrl:()=>''};
   const courts=[{id:1,nume:'Teren A',sport:'Fotbal',oras:'Reghin',pret:100,este_activ:true},{id:2,nume:'Teren B',sport:'Fotbal',oras:'Reghin',pret:100,este_activ:true}];
   window.db={auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){}},from(table){return {select(){return this;},eq(){return this;},order(){return this;},abortSignal(){return this;},then(resolve,reject){return Promise.resolve({data:table==='terenuri'?courts:[],error:null}).then(resolve,reject);}};}};
   window.spotivityReadAllRows=async factory=>await factory();
   window.readSportsBasePresentation=async read=>await read('id,nume,oras,este_activa');
   window.openedCourts=[];window.openCourtReservation=async id=>{openedCourts.push(id);return true;};
  });
  await page.addScriptTag({content:readFileSync(join(root,'js/home-discovery.js'),'utf8')});
  await page.evaluate(async()=>{await spotivityDiscoveryReady;openCourtSearch('',document.getElementById('search-trigger'));});
  const focused=()=>page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.discoveryCourt);
  assert.equal(await focused(),'home-search-input');
  await page.keyboard.press('Tab');assert.equal(await focused(),'1','Tab from the search field must reach the first court link');
  await page.keyboard.press('Tab');assert.equal(await focused(),'2');
  await page.keyboard.press('Tab');assert.equal(await focused(),'inchide-cautare-terenuri','The last court wraps to the close button');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'2','Reverse Tab from the close button reaches the last court');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'1');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'home-search-input');
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>openedCourts),[1],'Enter opens the focused court through the existing booking action');
  assert.equal(await page.locator('#modal-cautare-terenuri').isVisible(),false);
  console.log('PASS keyboard reaches court links, wraps within the modal and opens the selected court');

  await page.evaluate(()=>{openCourtSearch('',document.getElementById('search-trigger'));document.querySelector('[data-discovery-court="1"]').tabIndex=-1;});
  await page.keyboard.press('Tab');assert.equal(await focused(),'2','Explicitly non-focusable links are excluded');
  await page.keyboard.press('Tab');assert.equal(await focused(),'inchide-cautare-terenuri');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'2');
  await page.keyboard.press('Escape');assert.equal(await focused(),'search-trigger');
  assert.equal(await page.locator('#modal-cautare-terenuri').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS non-focusable links stay excluded and Escape restores trigger focus');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
