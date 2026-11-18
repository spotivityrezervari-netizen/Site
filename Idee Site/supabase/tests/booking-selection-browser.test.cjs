// Exercise the actual booking module in Chromium. Hosted transports are absent;
// the clock advances the real availability timer without making live bookings.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
 const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
 if(proxy)launch.proxy={server:new URL(proxy).origin,bypass:'127.0.0.1,localhost'};
 const browser=await chromium.launch(launch);
 try{
  const context=await browser.newContext();
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent(`
   <div id="modal-terenuri" style="display:none"><input id="filtru-data" value="2030-06-12"><select id="filtru-ora"><option value="17:00" selected>17:00</option></select></div>
   <div id="modal-rezervare" style="display:none"><div class="modal-continut">
    <h2 id="rezervare-teren-selectat"></h2><button id="buton-vezi-locatia"></button>
    <div id="container-minge"><input type="checkbox" id="checkbox-minge"><span id="text-label-minge"></span></div>
    <div id="container-zile"></div><div id="container-ore"></div><button id="buton-confirma"></button><button id="inchide-rezervare"></button>
   </div></div>`);
  await page.clock.install({time:new Date('2030-06-12T10:00:00Z')});
  await page.addScriptTag({content:readFileSync(join(__dirname,'../../js/modules/public-bookings.js'),'utf8')});
  await page.evaluate(()=>{
   window.lang='ro';window.dict={ro:{nevoie_minge:'Minge',azi:'Azi',maine:'Mâine',zile:['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'],ocupat:'ocupat',trecut:'trecut',alegeti_o_ora:'Alege o oră',rezerva:'Rezervă'}};
   window.siteDate=()=> '2030-06-12';window.siteClock=()=>({hour:12,minute:0});window.traduData=value=>value;window.safeUrl=()=>'';
   window.getCourtBookingHours=()=>['17:00','18:00','19:00'];
   window.courts=[{id:1,nume:'Teren A',pret:100,sport:'Fotbal',optiune_minge:false},{id:2,nume:'Teren B',pret:150,sport:'Fotbal',optiune_minge:false}];
   window.occupiedHours=[];window.availabilityReads=0;window.createdBookings=[];
   const db={
    from(table){
     const filters={};const query={
      select(){return this;},eq(column,value){filters[column]=value;return this;},
      async maybeSingle(){return {data:courts.find(court=>String(court.id)===String(filters.id)),error:null};},
      then(resolve,reject){availabilityReads++;return Promise.resolve({data:occupiedHours.map(ora=>({ora})),error:null}).then(resolve,reject);}
     };return query;
    },
    channel(){return {on(kind,filter,handler){window.availabilityEvent=handler;return this;},subscribe(){return this;}};}
   };
   window.SpotivityBooking={pendingSelection:()=>null,async create(selection){createdBookings.push(selection);return {booking_id:'test-booking'};},notificationText:()=> 'Confirmată'};
   window.bookingApi=window.SpotivityModules.publicBookings({db,state:{user:null,courts,sport:'Fotbal'},services:{ui:{setSportBackground(){},resetSportBackground(){},availabilityText:()=> 'Indisponibil',showBookingSuccess(){}}}});
   bookingApi.mount();bookingApi.openCourt(courts[0]);
  });
  const selected=()=>page.locator('.btn-ora.selectat').allTextContents();
  const ready=()=>page.waitForFunction(()=>document.querySelectorAll('.btn-ora').length===3&&!document.querySelector('#container-ore').textContent.includes('⏳'));
  const refresh=async()=>{const before=await page.evaluate(()=>availabilityReads);await page.clock.fastForward(15001);await page.waitForFunction(before=>availabilityReads>before,before);await ready();};
  await ready();assert.deepEqual(await selected(),['17:00'],'The initial matching filter hour is selected');
  await page.getByRole('button',{name:'18:00',exact:true}).click();
  await page.getByRole('button',{name:'17:00',exact:true}).click();
  assert.deepEqual(await selected(),['18:00']);
  await refresh();assert.deepEqual(await selected(),['18:00'],'Polling must preserve an explicit replacement of the filter hour');
  await refresh();assert.deepEqual(await selected(),['18:00'],'Repeated polling must not add an extra charged hour');
  assert.equal(await page.locator('#buton-confirma').innerText(),'Rezervă (100\u00a0Lei)');
  console.log('PASS availability polling preserves the chosen hours and price');

  await page.getByRole('button',{name:'18:00',exact:true}).click();
  await refresh();assert.deepEqual(await selected(),[],'Explicitly clearing the selection survives polling');
  assert.equal(await page.locator('#buton-confirma').isDisabled(),true);
  await page.getByRole('button',{name:'18:00',exact:true}).click();
  await page.evaluate(()=>availabilityEvent({eventType:'DELETE'}));await ready();
  assert.deepEqual(await selected(),['18:00'],'Realtime-driven refresh preserves the explicit choice');
  await page.evaluate(()=>occupiedHours=['18:00']);await refresh();
  assert.deepEqual(await selected(),[],'A newly occupied hour is removed without selecting a replacement');
  assert.equal(await page.locator('#buton-confirma').isDisabled(),true);
  console.log('PASS empty selection and occupied hours are handled safely for polling and realtime');

  await page.evaluate(()=>occupiedHours=[]);
  await page.locator('.btn-zi').nth(1).click();await ready();
  assert.deepEqual(await selected(),[],'The filter hour is not applied to a different date');
  await page.locator('.btn-zi').first().click();await ready();
  assert.deepEqual(await selected(),['17:00'],'Explicitly returning to the filtered date initializes its matching hour');
  await page.getByRole('button',{name:'18:00',exact:true}).click();
  await page.getByRole('button',{name:'17:00',exact:true}).click();
  await page.evaluate(()=>bookingApi.openCourt(courts[1]));await ready();
  assert.deepEqual(await selected(),['17:00'],'Opening a different court starts a new selection');
  assert.equal(await page.locator('#buton-confirma').innerText(),'Rezervă (150\u00a0Lei)');
  await page.getByRole('button',{name:'18:00',exact:true}).click();
  await page.getByRole('button',{name:'17:00',exact:true}).click();await refresh();
  await page.locator('#buton-confirma').click();
  assert.deepEqual(await page.evaluate(()=>createdBookings),[{court_id:'2',day:'2030-06-12',hours:['18:00'],with_ball:false,expected_total:150}]);
  assert.deepEqual(errors,[]);
  console.log('PASS day/court changes initialize correctly and submission uses exactly the chosen hour');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
