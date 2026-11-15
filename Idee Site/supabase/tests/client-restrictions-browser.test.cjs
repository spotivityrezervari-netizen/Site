// Production review UI and styles; all RPC responses are local deterministic fixtures.
// SQL authorization and reservation enforcement are tested in client-restrictions.test.cjs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8117/';
const screenshots=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
(async()=>{
 if(screenshots)mkdirSync(screenshots,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/__restriction-ui__'))return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
   const stylesheet=url.pathname.match(/\/css\/([a-z-]+)\.css$/);
   if(url.origin===new URL(base).origin&&stylesheet)return route.fulfill({contentType:'text/css',body:readFileSync(join(__dirname,'../../css',stylesheet[1]+'.css'),'utf8')});
   return route.abort();
  });
  await page.goto(new URL('__restriction-ui__',base).href);
  await page.setContent(`<html><head><base href="${base}">${['style','theme','admin','admin-theme','base-admin','admin-late-cancellations'].map(name=>`<link rel="stylesheet" href="css/${name}.css">`).join('')}</head><body class="pagina-publica"><div id="base-admin-workspace" class="base-admin-workspace"><div class="base-admin-panel"><div class="base-admin-tools"></div></div></div></body></html>`);
  await page.addScriptTag({path:join(__dirname,'../../js/admin-late-cancellations.js')});
  await page.evaluate(()=>{
   window.calls=[];window.confirmations=[];window.allowConfirm=true;window.rejectWrite=false;window.failRestrictions=false;window.deferWrite=false;
   window.confirm=message=>{confirmations.push(message);return allowConfirm;};
   window.reviewData={combined_incidents:true,customers:[{name:'<img src=x onerror="window.attacked=true">',email:'ana@example.test',phone:'+40721123456',count:1,total_count:3,frequent:false,last_cancelled_at:'2026-11-13T09:30:00Z',events:[{booking_id:'aaaaaaaa-1111-4111-8111-111111111111',court_name:'Court A',starts_at:'2026-11-13T10:00:00Z',cancelled_at:'2026-11-13T09:30:00Z',lead_minutes:30,kind:'late_cancel'}]}]};
   window.restrictionData={restrictions:[],can_restrict_globally:false,automatic_restrictions:false};
   const complete=params=>{
    restrictionData.restrictions=[{restriction_id:'bbbbbbbb-1111-4111-8111-111111111111',name:reviewData.customers[0].name,email:'ana@example.test',court_name:params.p_global?'Toate terenurile':'Court A',global:params.p_global,permanent:params.p_permanent,expires_at:params.p_permanent?null:'2099-11-20T09:00:00Z',reason:params.p_reason}];
    return {data:{restriction_ids:['bbbbbbbb-1111-4111-8111-111111111111']},error:null};
   };
   window.createLateCancellationReview({rpc(name,args){
    calls.push({name,args});
    if(name==='list_late_cancellations')return Promise.resolve({data:reviewData,error:null});
    if(name==='list_customer_booking_restrictions')return Promise.resolve(failRestrictions?{data:null,error:{code:'42501'}}:{data:restrictionData,error:null});
    if(name==='set_customer_booking_restriction'){
     if(rejectWrite)return Promise.resolve({data:null,error:{code:'42501',message:'private backend detail'}});
     if(deferWrite)return new Promise(resolve=>window.resolveWrite=()=>resolve(complete(args)));
     return Promise.resolve(complete(args));
    }
    if(name==='revoke_customer_booking_restriction'){restrictionData.restrictions=[];return Promise.resolve({data:{changed:true},error:null});}
    throw new Error('Unexpected RPC '+name);
   }});
  });
  const writes=()=>page.evaluate(()=>calls.filter(call=>['set_customer_booking_restriction','revoke_customer_booking_restriction'].includes(call.name)));
  const open=async isSuper=>{
   await page.evaluate(isSuper=>{restrictionData.can_restrict_globally=isSuper;dispatchEvent(new CustomEvent('spotivity:admin-role',{detail:{userId:isSuper?'super':'owner',isSuper}}));},isSuper);
   await page.locator('#btn-late-cancellations').click();await page.locator('#late-cancellation-list .late-cancellation-customer').waitFor();
  };
  await open(false);
  assert.equal(await page.locator('.late-restriction-controls').count(),1);
  assert.equal(await page.locator('.late-restriction-global').count(),0);
  assert.equal(await page.locator('.late-cancellation-count').innerText(),'3');
  assert.equal(await page.locator('.late-cancellation-customer img').count(),0);assert.equal(await page.evaluate(()=>window.attacked),undefined);
  await page.evaluate(()=>allowConfirm=false);await page.locator('.late-restriction-controls button').click();assert.equal((await writes()).length,0);
  await page.evaluate(()=>allowConfirm=true);
  await page.locator('.late-restriction-duration').selectOption('3');await page.locator('.late-restriction-reason').fill('  Repeated incidents <b>reviewed</b>  ');
  await page.locator('.late-restriction-controls button').click();await page.locator('.late-restriction-active').waitFor();
  const first=(await writes())[0];assert.deepEqual(first,{name:'set_customer_booking_restriction',args:{p_booking_id:'aaaaaaaa-1111-4111-8111-111111111111',p_days:3,p_permanent:false,p_global:false,p_reason:'Repeated incidents <b>reviewed</b>'}});
  assert.match(await page.locator('.late-restriction-active').innerText(),/Court A · Până la/);
  assert.equal(await page.locator('.late-restriction-active b').count(),0);
  await page.locator('.late-restriction-active button').click();await page.waitForFunction(()=>!document.querySelector('.late-restriction-active'));
  assert.equal((await writes())[1].name,'revoke_customer_booking_restriction');
  for(const width of[320,390,768,1440]){
   await page.setViewportSize({width,height:844});
   const fits=await page.evaluate(()=>{const panel=document.querySelector('.late-cancellation-panel').getBoundingClientRect();return panel.left>=-1&&panel.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;});assert.ok(fits,'Restriction form fits '+width+'px');
   if(screenshots)await page.screenshot({path:join(screenshots,'client-restrictions-'+width+'.png')});
  }
  await page.locator('.late-cancellation-close').click();await open(true);
  assert.equal(await page.locator('.late-restriction-global input').isChecked(),true);
  await page.locator('.late-restriction-duration').selectOption('permanent');await page.locator('.late-restriction-controls button').click();
  await page.locator('.late-restriction-active').waitFor();const permanent=(await writes()).at(-1);
  assert.equal(permanent.args.p_days,null);assert.equal(permanent.args.p_permanent,true);assert.equal(permanent.args.p_global,true);
  assert.match(await page.locator('.late-restriction-active').innerText(),/Toate terenurile · Permanentă/);
  await page.locator('.late-restriction-active button').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.late-cancellation-close')),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.late-restriction-active button')),true,'Keyboard focus stays inside the dialog with restriction controls');
  await page.locator('.late-restriction-active button').click();await page.waitForFunction(()=>!document.querySelector('.late-restriction-active'));
  await page.evaluate(()=>{reviewData.customers[0].total_count=2;});await page.locator('.late-cancellation-refresh').click();
  await page.waitForFunction(()=>document.querySelector('.late-cancellation-count')?.textContent==='2');assert.equal(await page.locator('.late-restriction-controls').count(),0,'Below3 incidents no restriction action');
  await page.evaluate(()=>{reviewData.customers[0].total_count=3;failRestrictions=true;});await page.locator('.late-cancellation-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#client-restriction-list')?.textContent.includes('nu au putut fi încărcate'));assert.equal(await page.locator('.late-restriction-controls').count(),0,'Unavailable restriction state cannot enable decisions');
  await page.evaluate(()=>{failRestrictions=false;rejectWrite=true;});await page.locator('.late-cancellation-refresh').click();await page.locator('.late-restriction-controls button').waitFor();
  await page.locator('.late-restriction-controls button').click();await page.waitForFunction(()=>document.querySelector('#late-cancellation-status').textContent.includes('respinsă'));
  assert.equal(await page.locator('.late-restriction-active').count(),0);assert.doesNotMatch(await page.locator('#late-cancellation-status').innerText(),/private backend/);
  await page.evaluate(()=>{rejectWrite=false;deferWrite=true;});const before=(await writes()).length;
  await page.locator('.late-restriction-controls button').click();await page.waitForFunction(()=>typeof resolveWrite==='function');assert.equal(await page.locator('.late-restriction-controls button').isDisabled(),true);
  await page.evaluate(()=>document.querySelector('.late-restriction-controls button').click());assert.equal((await writes()).length,before+1,'Double activation produces one write');
  await page.evaluate(()=>{dispatchEvent(new Event('spotivity:admin-clear'));resolveWrite();});
  await page.waitForTimeout(50);assert.equal(await page.locator('#modal-late-cancellations').isVisible(),false);assert.equal(await page.locator('#client-restriction-list').textContent(),'');assert.equal(await page.locator('#btn-late-cancellations').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS real restriction controls: temporary/permanent/lift, ordinary scoped vs super global payloads, combined lifetime eligibility, escaping, responsive320/390/768/1440, failed reads/writes, duplicate clicks and signout stale responses.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
