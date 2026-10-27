// Real Auth SDK with HTTP/WebSocket fixtures only; no hosted Auth writes or emails.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8010/';
const host='ndubcdwohqzgxpuiowye.supabase.co';
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const expiry=Math.floor(Date.now()/1000)+3600;
const token=n=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:uid(n),exp:expiry,role:'authenticated'})).toString('base64url')+'.fixture';
const user=n=>({id:uid(n),email:n===3?'admin@example.test':'alice@example.test',app_metadata:{provider:'email'},user_metadata:{}});
const recoveryUrl=()=>new URL(base).href+'#'+new URLSearchParams({access_token:token(1),refresh_token:'fixture-refresh',expires_in:'3600',token_type:'bearer',type:'recovery'});
let passed=0;
(async()=>{
 const options={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
 if(proxy){const u=new URL(proxy);options.proxy={server:u.origin,bypass:'127.0.0.1,localhost'};if(u.username)options.proxy.username=decodeURIComponent(u.username);if(u.password)options.proxy.password=decodeURIComponent(u.password)}
 const browser=await chromium.launch(options);const contexts=[];const errors=[];
 try{
  const html=readFileSync(join(__dirname,'..','..','index.html'),'utf8');
  const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
  assert.ok(sdkTag,'The application must pin the real SDK with SRI');
  const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
  assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
  async function fixture({delayApp=false}={}){
   const context=await browser.newContext({timezoneId:'Europe/Bucharest'});contexts.push(context);
   await context.route(sdkTag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
   const writes=[];const alerts=[];let userGate=null;
   let initialUserResolve;const initialUser=new Promise(resolve=>{initialUserResolve=resolve});
   if(context.routeWebSocket)await context.routeWebSocket(url=>url.hostname===host,ws=>ws.close());
   await context.route(url=>url.hostname===host,async route=>{
    const r=route.request(),u=new URL(r.url());const bearer=(r.headers().authorization||'').replace(/^Bearer /,'');
    const n=bearer===token(3)?3:bearer===token(1)?1:null;
    const reply=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(u.pathname==='/auth/v1/token'){
     if(r.postDataJSON().email==='rejected@example.test')return reply(400,{code:'invalid_credentials',msg:'Invalid login credentials'});
     const who=r.postDataJSON().email==='admin@example.test'?3:1;
     return reply(200,{access_token:token(who),refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user:user(who)});
    }
    if(u.pathname==='/auth/v1/signup')return reply(200,user(1));
    if(u.pathname==='/auth/v1/logout')return route.fulfill({status:204,body:''});
    if(u.pathname==='/auth/v1/user'&&n){
     initialUserResolve();
     if(r.method()==='GET'&&userGate){const gate=userGate;userGate=null;gate.enter();await gate.wait}
     if(r.method()==='PUT')writes.push({person:n,body:r.postDataJSON()});
     return reply(200,user(n));
    }
    if(u.pathname.startsWith('/rest/v1/')){
     if(u.pathname.endsWith('/rpc/get_admin_access')){
      assert.equal(r.method(),'POST');
      return reply(200,{is_super:false,can_manage:false,courts:[],bases:[]});
     }
     assert.equal(r.method(),'GET','Unexpected fixture business write');
     if(u.pathname.endsWith('/site_sporturi'))return reply(200,[
      {sport:'Fotbal',icona_url:'assets/imagini/fotbalrealist.png',fundal_url:'assets/imagini/FotbalFinal.jpeg',ordine:1},
      {sport:'Baschet',icona_url:'assets/imagini/baschetrealist.png',fundal_url:'assets/imagini/BaschetFinal.jpeg',ordine:2},
      {sport:'Tenis',icona_url:'assets/imagini/tenisrealist.png',fundal_url:'assets/imagini/TenisFINAL.jpeg',ordine:3},
      {sport:'Volei',icona_url:'assets/imagini/voleirealist.png',fundal_url:'assets/imagini/RealistVolei.png',ordine:4},
      {sport:'Tenis Picior',icona_url:'assets/imagini/fotbalrealist.png',fundal_url:'assets/imagini/RealistTenispicior.png',ordine:5}
     ]);
     if(u.pathname.endsWith('/terenuri'))return reply(200,[{id:1,nume:'Court A',sport:'Fotbal',pret:100,poza:null,este_activ:true,are_chat:true,oras:'Test',ore_rezervabile:['12:00']}]);
     return reply(200,[]);
    }
    return reply(401,{message:'No fixture session'});
   });
   if(delayApp)await context.route('**/js/app.js*',async route=>{await initialUser;await route.continue()});
   const page=await context.newPage();page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss()});page.on('pageerror',e=>errors.push(e.message));
   const pauseUser=()=>{let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);userGate={enter,wait};return{entered,release}};
   return{page,writes,alerts,pauseUser};
  }
  const valid=await fixture({delayApp:true});await valid.page.goto(recoveryUrl(),{waitUntil:'networkidle'});
  await valid.page.locator('#modal-parola-noua').waitFor({state:'visible'});
  assert.equal(await valid.page.locator('#modal-parola-noua').count(),1);
  assert.ok(!valid.page.url().includes('access_token'));
  await valid.page.locator('#input-noua-parola-js').fill('12345');await valid.page.locator('#btn-salveaza-parola-js').click();
  assert.match(await valid.page.locator('#mesaj-resetare-parola').innerText(),/minim 6/);assert.equal(valid.writes.length,0);
  await valid.page.locator('#input-noua-parola-js').fill('123456');await valid.page.locator('#btn-salveaza-parola-js').click();
  await valid.page.locator('#modal-parola-noua').waitFor({state:'detached'});
  assert.equal(valid.writes.length,1);assert.equal(valid.writes[0].person,1);assert.equal(valid.writes[0].body.password,'123456');
  console.log('PASS slow app load captures one SDK-verified recovery and accepts a six-character password');passed++;
  const normal=await fixture();await normal.page.goto(base,{waitUntil:'networkidle'});
  await normal.page.evaluate(async()=>{await db.auth.signInWithPassword({email:'admin@example.test',password:'fixture'})});
  await normal.page.goto(new URL('?type=recovery',base).href,{waitUntil:'networkidle'});
  assert.equal(await normal.page.locator('#modal-parola-noua').count(),0);assert.equal(normal.writes.length,0);
  assert.ok(normal.alerts.some(s=>s.includes('invalid sau a expirat')));
  console.log('PASS a recovery URL marker cannot reset an unrelated existing login');passed++;
  const expired=await fixture();await expired.page.goto(new URL(base).href+'#error=access_denied&error_code=otp_expired&type=recovery',{waitUntil:'networkidle'});
  assert.equal(await expired.page.locator('#modal-parola-noua').count(),0);assert.equal(expired.writes.length,0);assert.ok(expired.alerts.some(s=>s.includes('invalid sau a expirat')));
  assert.equal(await expired.page.locator('.card-sport[data-sport]').count(),5);
  console.log('PASS an expired link leaves the site usable and sends no password update');passed++;
  const switched=await fixture();await switched.page.goto(recoveryUrl(),{waitUntil:'networkidle'});await switched.page.locator('#modal-parola-noua').waitFor({state:'visible'});
  const gate=switched.pauseUser();await switched.page.locator('#input-noua-parola-js').fill('654321');await switched.page.locator('#btn-salveaza-parola-js').click();await gate.entered;
  await switched.page.evaluate(async()=>{await db.auth.signInWithPassword({email:'admin@example.test',password:'fixture'})});
  await switched.page.locator('#modal-parola-noua').waitFor({state:'detached'});gate.release();
  await switched.page.waitForLoadState('networkidle');assert.equal(switched.writes.length,0);
  console.log('PASS account switching during recovery aborts the pending password change');passed++;
  const cancelled=await fixture();await cancelled.page.goto(recoveryUrl(),{waitUntil:'networkidle'});await cancelled.page.locator('#modal-parola-noua').waitFor({state:'visible'});await cancelled.page.keyboard.press('Escape');
  assert.equal(await cancelled.page.locator('#modal-parola-noua').count(),0);assert.equal(cancelled.writes.length,0);assert.ok(!cancelled.page.url().includes('access_token'));
  console.log('PASS recovery can be closed with Escape without changing a password');passed++;
  const forms=await fixture();await forms.page.goto(base,{waitUntil:'networkidle'});
  await forms.page.locator('#btn-top-cont').click();await forms.page.locator('#modal-auth').waitFor({state:'visible'});
  await forms.page.locator('#login-email').fill('alice@example.test');await forms.page.locator('#login-parola').fill('fixture-password');
  await forms.page.locator('#inchide-auth').click();
  assert.equal(await forms.page.locator('#login-parola').inputValue(),'');
  assert.equal(await forms.page.locator('#login-email').inputValue(),'alice@example.test','Closing only clears credentials, preserving the email for retry');
  await forms.page.locator('#btn-top-cont').click();await forms.page.locator('#login-parola').fill('fixture-password');
  await forms.page.keyboard.press('Escape');assert.equal(await forms.page.locator('#login-parola').inputValue(),'');
  await forms.page.locator('#btn-top-cont').click();await forms.page.locator('#login-email').fill('rejected@example.test');
  await forms.page.locator('#login-parola').fill('wrong-password');await forms.page.locator('#btn-executa-login').click();
  await forms.page.waitForFunction(()=>!document.getElementById('btn-executa-login').disabled);
  assert.equal(await forms.page.locator('#login-parola').inputValue(),'');assert.equal(await forms.page.locator('#modal-auth').isVisible(),true);
  await forms.page.locator('#login-email').fill('alice@example.test');await forms.page.locator('#login-parola').fill('fixture-password');
  await forms.page.locator('#btn-executa-login').click();await forms.page.locator('#modal-auth').waitFor({state:'hidden'});
  assert.equal(await forms.page.locator('#login-parola').inputValue(),'');
  await forms.page.locator('#btn-top-cont').click();await forms.page.locator('#modal-profil').waitFor({state:'visible'});
  await forms.page.evaluate(()=>{document.getElementById('reg-parola').value='stale-password'});
  await forms.page.locator('#btn-logout').click();await forms.page.waitForFunction(async()=>(await db.auth.getSession()).data.session===null);
  assert.equal(await forms.page.locator('#reg-parola').inputValue(),'');
  await forms.page.locator('#btn-top-cont').click();await forms.page.locator('#tab-register').click();
  await forms.page.locator('#reg-nume').fill('Fixture Person');await forms.page.locator('#reg-email').fill('alice@example.test');
  await forms.page.locator('#reg-telefon').fill('0700000000');await forms.page.locator('#reg-parola').fill('fixture-password');
  await forms.page.locator('#btn-executa-register').click();await forms.page.locator('#form-login').waitFor({state:'visible'});
  assert.equal(await forms.page.locator('#reg-parola').inputValue(),'');
  console.log('PASS passwords are cleared after login/register attempts, close, Escape and logout while email retry data stays available');passed++;
  await normal.page.locator('.card-sport[data-sport="Fotbal"]').click();await normal.page.locator('#modal-terenuri').waitFor({state:'visible'});
  const image=normal.page.locator('.card-teren-poza img');await image.waitFor();await normal.page.waitForFunction(()=>document.querySelector('.card-teren-poza img')?.naturalWidth>0);
  assert.equal(await image.getAttribute('src'),'assets/imagini/avatar2.png');
  console.log('PASS a court without a photo gets a valid image in the same card layout');passed++;
  assert.deepEqual(errors,[]);console.log(`\n${passed} recovery and photo checks passed.`);
 }finally{for(const context of contexts)await context.close();await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
