// Real modules and SQL in a disposable database. All browser requests stay in fixtures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {fixture,uid}=require('./court-staff-chat.test.cjs');
const root=join(__dirname,'../..'),source=name=>readFileSync(join(root,'js',name),'utf8');
const html=readFileSync(join(root,'index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'');
test('administrators record and correct attendance through the real schedule, history and incident review',async()=>{
 const f=await fixture();let browser;
 try{
  await f.apply();await f.root('select 1');await f.pg.exec(readFileSync(join(__dirname,'../033_late_cancellation_counts.sql'),'utf8'));await f.root('select 1');await f.pg.exec(readFileSync(join(__dirname,'../034_booking_attendance.sql'),'utf8'));await f.root('select 1');await f.pg.exec(readFileSync(join(__dirname,'../035_legacy_booking_attendance.sql'),'utf8'));
  const day=(await f.root("select ((now() at time zone 'Europe/Bucharest')::date-1)::text d")).rows[0].d;
  const court=(await f.root("select id::text id from public.terenuri where nume='Court A'")).rows[0];
  await f.root(`create or replace function spotivity_private.booking_instant(day_text text,hour_text text) returns timestamptz language sql stable set search_path='' as $$select statement_timestamp()+make_interval(secs=>coalesce(nullif(current_setting('spotivity.test_start',true),''),'7200')::integer+(extract(hour from hour_text::time)::integer-16)*3600)$$`);
  const booking=uid(34901),other=uid(34902);
  for(const [id,person,email,hour]of [[booking,1,'alice@example.test','16:00'],[other,2,'bob@example.test','18:00']]){
   await f.root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5,$6,$7,$8)',[id,court.id,day,[hour],uid(person),'Test Client',email,'+40711111111']);
  }
  await f.root("select set_config('spotivity.test_start','-14400',false)");await f.root('update public.rezervari set starts_at=starts_at where booking_group_id=any($1::uuid[])',[[booking,other]]);
  const legacy=(await f.root("insert into public.rezervari(email_client,teren,sport,data_str,ora,pret_total,stare)values('Client manual','Court A','Fotbal',$1,'14:00','Custom','activa')returning id::text",[day])).rows[0].id;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
   const css=url.pathname.match(/^\/css\/([a-z-]+\.css)$/);
   if(css)return route.fulfill({contentType:'text/css',body:readFileSync(join(root,'css',css[1]))});
   return route.abort();
  });
  const calls=[];let rejectWrite=false;
  await page.exposeFunction('attendanceRpc',async(name,args)=>{
   calls.push({name,args});
   if(rejectWrite&&name==='set_booking_attendance')return{data:null,error:{code:'42501'}};
   try{
    let sql,params;
    if(name==='get_booking_attendance'){sql='select public.get_booking_attendance($1::uuid[]) v';params=[args.p_booking_ids];}
    else if(name==='set_booking_attendance'){sql='select public.set_booking_attendance($1,$2,$3) v';params=[args.p_booking_id,args.p_status,args.p_expected_revision];}
    else if(name==='get_legacy_booking_attendance'){sql='select public.get_legacy_booking_attendance($1::text[]) v';params=[args.p_reservation_ids];}
    else if(name==='set_legacy_booking_attendance'){sql='select public.set_legacy_booking_attendance($1,$2,$3,$4) v';params=[args.p_reservation_id,args.p_status,args.p_expected_revision,args.p_email];}
    else if(name==='list_late_cancellations'){sql='select public.list_late_cancellations($1) v';params=[args.p_days];}
    else throw new Error('Unexpected fixture RPC');
    return{data:(await f.as(3,sql,params)).rows[0].v,error:null};
   }catch(error){return{data:null,error:{code:error.code}};}
  });
  await page.exposeFunction('attendanceRows',async({table,filters,first,last,single})=>{
   assert.ok(['clienti','rezervari','terenuri'].includes(table));
   let rows=(await f.as(3,'select * from public.'+table)).rows;
   rows=rows.filter(row=>filters.every(([op,key,value])=>op==='eq'?row[key]===value:op==='neq'?row[key]!==value:value.includes(row[key])));
   return{data:single?rows[0]:rows.slice(first,last+1),error:null};
  });
  await page.goto('https://attendance-admin.test/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
   window.db={rpc:(name,args)=>attendanceRpc(name,args),from(table){const filters=[];const q={select(){return q;},eq(k,v){filters.push(['eq',k,v]);return q;},neq(k,v){filters.push(['neq',k,v]);return q;},in(k,v){filters.push(['in',k,v]);return q;},order(){return q;},range(first,last){return attendanceRows({table,filters,first,last});},single(){return attendanceRows({table,filters,single:true});}};return q;}};
   window.lang='ro';window.traduData=value=>value;
   window.testState={account:{user_id:'00000000-0000-0000-0000-000000000003',is_super:false,terenuri:'Court A'},authGeneration:1,programGeneration:0,managedCourts:[{nume:'Court A'}]};
   document.getElementById('base-admin-workspace').hidden=false;
  });
  for(const file of ['security.js','admin-attendance.js','modules/admin-schedule.js','modules/admin-history.js','admin-late-cancellations.js'])await page.evaluate(code=>(0,eval)(code),source(file));
  await page.evaluate(day=>{SpotivityModules.adminSchedule({db,state:testState});SpotivityModules.adminHistory({db,state:testState});document.getElementById('tabel-data').value=day;initializeazaTabel(['Court A']);document.getElementById('modal-tabel-program').style.display='flex';},day);
  const controls=page.locator(`[data-booking-attendance="${booking}"]`).first();
  await controls.locator('[data-attendance-choice="no_show"]').waitFor();
  rejectWrite=true;await controls.locator('[data-attendance-choice="no_show"]').click();await controls.getByRole('status').filter({hasText:'nu a putut fi salvată'}).waitFor();
  assert.equal((await f.root('select count(*)::int n from spotivity_private.booking_attendance_events')).rows[0].n,0,'Failed writes never show saved attendance');
  rejectWrite=false;await controls.locator('[data-attendance-choice="no_show"]').click();await controls.locator('[data-attendance-status="no_show"]').waitFor();
  assert.ok(await controls.locator('[data-attendance-choice="no_show"]').isDisabled());
  const jobs=async()=>(await f.root("select * from spotivity_private.notification_outbox where kind='booking_attendance_client'")).rows;
  assert.equal((await jobs()).length,1);
  const screenshots=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;if(screenshots)mkdirSync(screenshots,{recursive:true});
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:844});
   for(const button of await controls.locator('button').all()){
    const box=await button.boundingBox();assert.ok(box.height>=44&&box.x>=-1&&box.x+box.width<=width+1,JSON.stringify({width,box}));
   }
   if(screenshots)await page.screenshot({path:join(screenshots,`attendance-schedule-${width}.png`)});
  }
  await page.evaluate(async()=>{document.getElementById('modal-tabel-program').style.display='none';document.getElementById('modal-istoric').style.display='flex';await reincarcaIstoricAdmin();});
  const manual=page.locator(`#container-istoric [data-reservation-attendance="${legacy}"]`).first();
  await manual.locator('input[type="email"]').waitFor();
  await manual.locator('input').fill('manual@example.test');
  await manual.locator('[data-attendance-choice="no_show"]').click();
  await manual.locator('[data-attendance-status="no_show"]').waitFor();
  assert.equal((await jobs()).length,2);
  const history=page.locator(`#container-istoric [data-booking-attendance="${booking}"]`).first();await history.locator('[data-attendance-status="no_show"]').waitFor();
  await history.locator('[data-attendance-choice="present"]').click();await history.locator('[data-attendance-status="present"]').waitFor();assert.equal((await jobs()).length,3);
  await page.evaluate(()=>{document.getElementById('modal-istoric').style.display='none';dispatchEvent(new CustomEvent('spotivity:admin-role',{detail:{userId:testState.account.user_id,isSuper:false}}));openLateCancellationReview();});
  await page.locator('#late-cancellation-status').filter({hasText:'1 client cu abateri'}).waitFor();
  await page.locator('#btn-mark-no-show').click();
  await page.locator('#modal-istoric').waitFor({state:'visible'});
  await page.locator('#container-istoric [data-reservation-attendance]').first().waitFor();
  const upcoming=page.locator('#container-istoric [data-booking-attendance="00000000-0000-0000-0000-000000032001"]');
  await upcoming.locator('[data-attendance-choice="no_show"]').waitFor();assert.ok(await upcoming.locator('[data-attendance-choice="no_show"]').isDisabled());assert.match(await upcoming.innerText(),/ora României/);
  assert.deepEqual(errors,[]);assert.ok(calls.some(c=>c.name==='set_booking_attendance'&&c.args.p_expected_revision===1));
 }finally{await browser?.close();await f.pg.close();}
});
