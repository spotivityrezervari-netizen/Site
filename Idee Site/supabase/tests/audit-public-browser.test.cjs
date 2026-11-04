// Price/retry regressions use the real public modules with isolated HTTP/DOM only.
// No hosted project, accounts, bookings or email are used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require('playwright');
const source=name=>readFileSync(join(__dirname,'../../js',name),'utf8');
const uid='00000000-0000-0000-0000-000000000001';
const bookingId='00000000-0000-0000-0000-000000000009';
const chosen={court_id:'1',day:'2027-01-03',hours:['12:00','13:00'],with_ball:true,expected_total:215};

async function browserTest(fn){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 try{await fn(browser)}finally{await browser.close()}
}

test('fresh settings replace cached base/ball prices and PRICE_CHANGED requires another explicit confirmation',()=>browserTest(async browser=>{
 const page=await browser.newPage();
 await page.route('**/*',route=>route.abort());
 await page.setContent(`<div id="rezervare-teren-selectat"></div><button id="buton-vezi-locatia"></button>
 <input type="checkbox" id="checkbox-minge"><div id="container-minge"></div><span id="text-label-minge"></span>
 <div id="modal-terenuri"></div><div id="modal-rezervare"><div class="modal-continut"></div></div>
 <div id="container-zile"></div><div id="container-ore"></div><button id="buton-confirma"></button>
 <input id="filtru-data"><select id="filtru-ora"><option value="ALL">ALL</option></select>`);
 await page.addScriptTag({content:source('security.js')});
 await page.addScriptTag({content:source('modules/public-bookings.js')});
 await page.evaluate(()=>{
  window.lang='ro';window.dict={ro:{azi:'Azi',maine:'Mâine',zile:['Du','Lu','Ma','Mi','Jo','Vi','Sa'],alegeti_o_ora:'Alege ora',rezerva:'Rezervă',nevoie_minge:'Minge',ocupat:'ocupat',trecut:'trecut'}};
  window.traduData=x=>x;window.siteClock=()=>({hour:0,minute:0});
  const cached={id:1,nume:'Court',pret:100,pret_minge:15,este_activ:true,optiune_minge:true,ore_rezervabile:['12:00','13:00']};
  window.freshCourt={...cached,pret:200,pret_minge:25};window.attempts=[];window.alerts=[];
  window.alert=message=>window.alerts.push(message);
  const db={from(table){return{select(){return this},eq(){return this},maybeSingle(){return Promise.resolve({data:{...window.freshCourt},error:null})},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}}},channel(){return{on(){return this},subscribe(){}}}};
  window.SpotivityBooking={pendingSelection:()=>null,async create(selection){
   window.attempts.push({...selection});
   if(window.attempts.length===1){window.freshCourt={...window.freshCourt,pret:250};throw Object.assign(new Error('Prețul s-a modificat.'),{code:'price_changed'})}
   return {booking_id:'confirmed'};
  },notificationText:()=> 'Confirmat'};
  const api=window.SpotivityModules.publicBookings({db,state:{user:{id:'person'},courts:[cached],sport:''},services:{ui:{setSportBackground(){},resetSportBackground(){},showBookingSuccess(){},availabilityText(){return'Unavailable'}}}});
  api.mount();api.openCourt(cached);
 });
 await page.locator('.btn-ora').first().click();
 await page.locator('#checkbox-minge').check();
 assert.equal(await page.locator('#buton-confirma').innerText(),'Rezervă (225)');
 assert.match(await page.locator('#text-label-minge').innerText(),/25/);
 await page.locator('#buton-confirma').click();
 await page.waitForFunction(()=>document.querySelector('#buton-confirma').innerText==='Rezervă (275)');
 const first=await page.evaluate(()=>window.attempts);
 assert.equal(first.length,1,'The new price must not be submitted without another click');
 assert.equal(first[0].expected_total,225);
 assert.equal((await page.evaluate(()=>window.alerts)).length,1);
 await page.locator('#buton-confirma').click();
 await page.waitForFunction(()=>window.attempts.length===2);
 assert.equal((await page.evaluate(()=>window.attempts))[1].expected_total,275);
 assert.equal(await page.locator('#modal-rezervare').evaluate(node=>node.style.display),'none');
}));

async function workflowPage(browser,{user=null,handler}){
 const page=await browser.newPage();const requests=[];
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='price-ui.test')return route.fulfill({contentType:'text/html',body:`<!doctype html><button>Start</button><script>const supabaseUrl='https://project.test';const supabaseKey='anon';const db={auth:{getSession:async()=>({data:{session:${JSON.stringify(user?{user,access_token:'fixture-jwt'}:null)}}})}};</script>`});
  assert.equal(url.href,'https://project.test/functions/v1/booking-workflow');
  requests.push(request.postDataJSON());const reply=handler(requests.length);
  if(reply.abort)return route.abort('failed');
  return route.fulfill({status:reply.status||200,contentType:'application/json',body:JSON.stringify(reply.data),headers:{'access-control-allow-origin':'*'}});
 });
 await page.goto('https://price-ui.test/');await page.addScriptTag({content:source('guest-booking.js')});
 return {page,requests};
}

test('authenticated price rejection clears a ruled-out UUID after an unknown response and freezes all other uncertain retries',()=>browserTest(async browser=>{
 const {page,requests}=await workflowPage(browser,{user:{id:uid},handler:count=>count===1?{abort:true}:count===2?{status:409,data:{code:'price_changed',error:'PRICE_CHANGED'}}:{data:{booking_id:bookingId}}});
 const attempt=selection=>page.evaluate(async({selection,uid})=>{
  try{return await window.SpotivityBooking.create(selection,{user:{id:uid}})}catch(error){return{code:error.code,unknown:error.unknown}}
 },{selection,uid});
 assert.equal((await attempt(chosen)).unknown,true);
 assert.equal((await attempt({...chosen,expected_total:300})).code,'pending_booking');
 assert.equal(requests.length,1);
 assert.equal((await attempt(chosen)).code,'price_changed');
 assert.deepEqual(requests[0],requests[1]);
 assert.equal(await page.evaluate(uid=>window.SpotivityBooking.pendingSelection(uid),uid),null);
 await attempt({...chosen,expected_total:300});
 assert.notEqual(requests[2].request_id,requests[0].request_id);
 assert.equal(requests[2].expected_total,300);
}));

test('guest price rejection returns to the quote; an explicit new guest confirmation gets a fresh UUID and total',()=>browserTest(async browser=>{
 const {page,requests}=await workflowPage(browser,{handler:count=>count===1?{status:409,data:{code:'price_changed',error:'PRICE_CHANGED'}}:{data:{booking_id:bookingId}}});
 const open=selection=>page.evaluate(selection=>{window.result=window.SpotivityBooking.create(selection).catch(error=>({code:error.code}));},selection);
 const fill=async()=>{await page.locator('#guest-contact_name').fill('Client Test');await page.locator('#guest-email').fill('guest@example.test');await page.locator('#guest-phone').fill('0721123456')};
 await open(chosen);await fill();
 assert.match(await page.locator('.workflow-summary').innerText(),/215 lei/);
 await page.locator('#guest-booking-submit').click();
 await page.locator('#modal-rezervare-vizitator').waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.result),{code:'price_changed'});
 assert.equal(await page.evaluate(()=>window.SpotivityBooking.pendingSelection(null)),null);
 assert.equal(requests.length,1);
 await open({...chosen,expected_total:300});await fill();
 assert.match(await page.locator('.workflow-summary').innerText(),/300 lei/);
 await page.locator('#guest-booking-submit').click();await page.locator('#modal-rezervare-vizitator').waitFor({state:'detached'});
 assert.equal(requests[0].expected_total,215);assert.equal(requests[1].expected_total,300);
 assert.notEqual(requests[0].request_id,requests[1].request_id);
}));

test('invalid or missing quoted totals never reach the booking server',()=>browserTest(async browser=>{
 const {page,requests}=await workflowPage(browser,{user:{id:uid},handler:()=>({data:{booking_id:bookingId}})});
 for(const total of [null,-1,1.001,'215']){
  const code=await page.evaluate(async({selection,uid})=>{try{await window.SpotivityBooking.create(selection,{user:{id:uid}})}catch(error){return error.code}},{selection:{...chosen,expected_total:total},uid});
  assert.equal(code,'invalid_quote');
 }
 assert.equal(requests.length,0);
}));

test('a first account price conflict cannot succeed until a new displayed quote is explicitly confirmed',()=>browserTest(async browser=>{
 const {page,requests}=await workflowPage(browser,{user:{id:uid},handler:count=>count===1?{status:409,data:{code:'price_changed',error:'PRICE_CHANGED'}}:{data:{booking_id:bookingId}}});
 const create=selection=>page.evaluate(async({selection,uid})=>{
  try{return await window.SpotivityBooking.create(selection,{user:{id:uid}})}catch(error){return{code:error.code}}
 },{selection,uid});
 assert.equal((await create(chosen)).code,'price_changed');
 assert.equal(requests.length,1);
 assert.equal(await page.evaluate(uid=>window.SpotivityBooking.pendingSelection(uid),uid),null);
 assert.equal((await create({...chosen,expected_total:300})).booking_id,bookingId);
 assert.equal(requests[0].expected_total,215);assert.equal(requests[1].expected_total,300);
 assert.notEqual(requests[0].request_id,requests[1].request_id);
}));

test('timeout then429 keeps the account request UUID and accepted quote frozen until a response is known',()=>browserTest(async browser=>{
 const {page,requests}=await workflowPage(browser,{user:{id:uid},handler:count=>count===1?{abort:true}:count===2?{status:429,data:{code:'rate_limit',error:'Retry later'}}:{data:{booking_id:bookingId}}});
 const create=selection=>page.evaluate(async({selection,uid})=>{
  try{return await window.SpotivityBooking.create(selection,{user:{id:uid}})}catch(error){return{code:error.code,unknown:error.unknown}}
 },{selection,uid});
 assert.equal((await create(chosen)).unknown,true);
 assert.equal((await create(chosen)).code,'rate_limit');
 assert.equal((await create({...chosen,expected_total:300})).code,'pending_booking');
 assert.equal(requests.length,2);
 assert.equal((await create(chosen)).booking_id,bookingId);
 for(const request of requests)assert.deepEqual(request,requests[0]);
 assert.equal(requests[2].expected_total,215);
}));
