// Chromium, the real pinned/SRI Supabase SDK, and a disposable PostgreSQL/RLS
// fixture. OAuth navigation, Auth transport and every hosted API are intercepted;
// this suite never contacts Google or writes to the hosted Supabase project.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const {createFixture,uid,host}=require('./club-request-fixture.cjs');

const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8103/';
const siteHome=new URL('./',base).href;
const localOrigin=new URL(base).origin;
const authOrigin=`https://${host}`;
const authStorageKey=`sb-${host.split('.')[0]}-auth-token`;
const cors={'access-control-allow-origin':'*','access-control-expose-headers':'X-Supabase-Api-Version','x-supabase-api-version':'2024-01-01'};
const json=(route,status,body)=>route.fulfill({status,contentType:'application/json',headers:cors,body:JSON.stringify(body)});
const gate=()=>{let enter,release;return {entered:new Promise(resolve=>enter=resolve),wait:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};};
async function entered(pending){
  let timeout;
  try{await Promise.race([pending.entered,new Promise((_,reject)=>timeout=setTimeout(()=>reject(new Error('OAuth availability recheck did not start')),15000))]);}
  finally{clearTimeout(timeout);}
}
let checks=0;
const pass=label=>{checks++;console.log('PASS',label);};

async function openAuth(page){
  await page.locator('#btn-top-cont').click();
  await page.locator('#modal-auth').waitFor({state:'visible'});
}
async function signedIn(page,id){
  await page.waitForFunction(async expected=>typeof db!=='undefined'&&(await db.auth.getSession()).data.session?.user.id===expected,id);
  await page.waitForFunction(expected=>window.getSpotivityProfileUser?.()?.id===expected,id);
  await page.waitForLoadState('networkidle');
}
async function beginCallback(page,kind){
  await Promise.all([
    page.waitForEvent('framenavigated',frame=>{
      if(frame!==page.mainFrame())return false;
      const url=new URL(frame.url());
      return url.origin===localOrigin&&(kind==='code'?url.searchParams.has('code')
        :url.searchParams.has('error')||new URLSearchParams(url.hash.slice(1)).has('error'));
    }),
    page.locator('#btn-google-login').click()
  ]);
}
async function errorStatus(page){
  await page.waitForFunction(()=>{
    const status=document.querySelector('#google-auth-status'),button=document.querySelector('#btn-google-login');
    return status&&!status.hidden&&status.dataset.kind==='error'&&button&&!button.disabled;
  });
}
async function fits(page){
  for(const language of ['ro','hu','en']){
    await page.evaluate(value=>window.schimbaLimba(value),language);
    await page.waitForFunction(()=>document.querySelector('#google-auth-label')?.textContent.includes('Google'));
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:width<768?844:1000});
      for(const tab of ['#tab-login','#tab-register']){
        await page.locator(tab).click();
        await page.locator('#btn-google-login').scrollIntoViewIfNeeded();
        const dimensions=await page.locator('#modal-auth .modal-continut').evaluate(panel=>{
          const box=node=>{const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};};
          const button=panel.querySelector('#btn-google-login'),wrapper=panel.querySelector('#google-auth-options');
          return {viewport:innerWidth,page:document.documentElement.scrollWidth,panel:box(panel),button:box(button),wrapper:box(wrapper),type:button.type,label:button.textContent.trim(),insideForm:!!button.closest('#form-login,#form-register')};
        });
        const message=`Google ${language} ${width} ${tab}: ${JSON.stringify(dimensions)}`;
        assert.ok(dimensions.page<=width+1,message);
        assert.ok(dimensions.panel.left>=-1&&dimensions.panel.right<=width+1,message);
        assert.ok(dimensions.button.left>=dimensions.panel.left&&dimensions.button.right<=dimensions.panel.right,message);
        assert.ok(dimensions.button.height>=44&&dimensions.button.width>=44,message);
        assert.equal(dimensions.type,'button',message);
        assert.equal(dimensions.insideForm,false,message);
        assert.match(dimensions.label,/Google/,message);
      }
    }
  }
  await page.evaluate(()=>window.schimbaLimba('ro'));
  await page.locator('#tab-login').click();
}

(async()=>{
  const fixture=await createFixture();let browser;
  const errors=[],blockedHosts=[],contexts=[];
  try{
    const baseId=uid(880),newUserId=uid(881);
    await fixture.root(async()=>{
      await fixture.pg.query("insert into public.baze_sportive(id,nume,oras,descriere) values($1,'Google Existing Club','Cluj-Napoca','Existing managed club')",[baseId]);
      await fixture.pg.query("update public.terenuri set baza_sportiva_id=$1,oras='Cluj-Napoca' where nume='Court A'",[baseId]);
      await fixture.pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[baseId,uid(3)]);
      await fixture.pg.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)',[newUserId,'google.client@example.test',JSON.stringify({full_name:'Google Client',role:'superadmin',is_super:true})]);
    });
    const originalState=await fixture.protectedState();
    const originalProfiles=await fixture.root(async()=>(await fixture.pg.query('select * from public.clienti order by id')).rows);
    const originalBookings=await fixture.root(async()=>(await fixture.pg.query('select * from public.rezervari order by id')).rows);
    const html=readFileSync(join(__dirname,'../../index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    assert.ok(sdkTag,'The browser test uses the app\'s pinned real SDK');
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
    if(proxy){const url=new URL(proxy);launch.proxy={server:url.origin,bypass:'127.0.0.1,localhost'};}
    browser=await chromium.launch(launch);

    async function userFor(id){
      return fixture.root(async()=>{
        const row=(await fixture.pg.query('select * from auth.users where id=$1',[id])).rows[0];
        assert.ok(row,`Unknown OAuth fixture identity ${id}`);
        return {...row,aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',
          app_metadata:{provider:'google',providers:['email','google']},user_metadata:row.raw_user_meta_data,
          identities:[{id:`google-${id}`,user_id:id,provider:'google',identity_data:{sub:`google-${id}`,email:row.email,email_verified:true}}]};
      });
    }
    async function sessionFor(id){
      return {access_token:fixture.token(id),refresh_token:`fixture-google-refresh-${id}`,expires_in:3600,token_type:'bearer',user:await userFor(id)};
    }
    async function pageFor(options={}){
      const context=await browser.newContext({timezoneId:'Europe/Bucharest',viewport:{width:390,height:844}});contexts.push(context);
      const state={settings:'enabled',identity:uid(1),settingsCalls:0,authorize:[],exchanges:[],recoveries:[],authRequests:[],callback:'success',nextSettingsGate:null,...options};
      const codes=new Map();let codeSequence=0;
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin===localOrigin)return route.continue();
        if(request.url()===sdkTag[1])return route.fulfill({status:200,contentType:'application/javascript',headers:cors,body:sdk});
        if(url.hostname!==host){blockedHosts.push(url.hostname);return route.abort('blockedbyclient');}
        if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{...cors,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'}});
        if(url.pathname==='/auth/v1/settings'){
          state.settingsCalls++;
          if(state.nextSettingsGate){const pending=state.nextSettingsGate;state.nextSettingsGate=null;pending.enter();await pending.wait;}
          if(state.settings==='network-error')return route.abort('failed');
          if(state.settings==='server-error')return json(route,503,{message:'fixture unavailable'});
          if(state.settings==='malformed')return json(route,200,{external:{google:'true'}});
          return json(route,200,{external:{google:state.settings==='enabled'},disable_signup:false});
        }
        if(url.pathname==='/auth/v1/authorize'){
          assert.equal(request.isNavigationRequest(),true,'OAuth must use a top-level same-tab navigation');
          assert.equal(url.origin,authOrigin);
          assert.equal(url.searchParams.get('provider'),'google');
          assert.equal(url.searchParams.get('redirect_to'),siteHome);
          assert.equal(url.searchParams.get('code_challenge_method')?.toLowerCase(),'s256');
          assert.match(url.searchParams.get('code_challenge')||'',/^[A-Za-z0-9_-]{43}$/);
          assert.equal(url.searchParams.get('prompt'),'select_account');
          state.authorize.push(url.href);
          const callback=new URL(siteHome);
          if(state.callback==='cancel'||state.callback==='cancel-hash'){
            const error=new URLSearchParams({error:'access_denied',error_description:'The user cancelled Google consent.'});
            if(state.callback==='cancel-hash')callback.hash=error.toString();
            else callback.search=error.toString();
          }else{
            const code=`fixture-google-code-${++codeSequence}`;
            codes.set(code,{id:state.identity,challenge:url.searchParams.get('code_challenge')});
            callback.searchParams.set('code',code);
          }
          return route.fulfill({status:302,headers:{location:callback.href}});
        }
        if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='pkce'){
          const body=request.postDataJSON(),issued=codes.get(body.auth_code);state.exchanges.push(body);
          assert.ok(issued,'The SDK exchanges exactly the issued authorization code');
          assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),issued.challenge,'The real SDK must present the verifier matching S256');
          assert.ok(body.code_verifier.length>=43);
          codes.delete(body.auth_code);
          if(state.exchangeError)return json(route,400,{code:'bad_code_verifier',msg:'OAuth fixture exchange rejected',error_description:'OAuth fixture exchange rejected'});
          return json(route,200,await sessionFor(issued.id));
        }
        if(url.pathname==='/auth/v1/recover'&&request.method()==='POST'){
          const body=request.postDataJSON();
          assert.equal(body.email,'alice@example.test');
          assert.equal(url.searchParams.get('redirect_to'),siteHome);
          assert.equal(body.code_challenge_method?.toLowerCase(),'s256');
          assert.match(body.code_challenge||'',/^[A-Za-z0-9_-]{43}$/);
          state.recoveryCode=`fixture-recovery-code-${++codeSequence}`;
          codes.set(state.recoveryCode,{id:uid(1),challenge:body.code_challenge});
          state.recoveries.push(body);return json(route,200,{});
        }
        if(url.pathname==='/auth/v1/user'&&request.method()==='GET'){
          const token=(request.headers().authorization||'').replace(/^Bearer /,''),id=fixture.tokens.get(token);
          if(id)return json(route,200,await userFor(id));
        }
        state.authRequests.push({path:url.pathname,method:request.method(),search:url.search});
        return fixture.browserRoute(route);
      });
      await context.routeWebSocket(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),ws=>ws.close());
      const page=await context.newPage();state.page=page;
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',async dialog=>{(state.alerts||=[]).push(dialog.message());await dialog.dismiss();});
      return state;
    }
    async function enabledPage(options={}){
      const state=await pageFor(options);await state.page.goto(base,{waitUntil:'networkidle'});await openAuth(state.page);
      await state.page.locator('#google-auth-options').waitFor({state:'visible'});
      await state.page.locator('#btn-google-login').waitFor({state:'visible'});
      return state;
    }

    for(const settings of ['disabled','malformed','server-error','network-error']){
      const state=await pageFor({settings});await state.page.goto(base,{waitUntil:'networkidle'});await openAuth(state.page);
      await state.page.waitForFunction(()=>!document.querySelector('#btn-google-login')||document.querySelector('#btn-google-login').disabled||document.querySelector('#google-auth-options').hidden);
      await state.page.waitForLoadState('networkidle');
      assert.ok(state.settingsCalls>0,`Google availability must be read for ${settings}`);
      assert.equal(await state.page.locator('#google-auth-options').isVisible(),false,settings);
      assert.equal(await state.page.locator('#google-auth-divider').isVisible(),false,settings);
      assert.equal(await state.page.locator('#btn-executa-login').isEnabled(),true,settings);
      assert.equal(state.authorize.length,0,settings);
      if(settings==='disabled'){
        await state.page.locator('#login-email').fill('alice@example.test');await state.page.locator('#login-parola').fill('fixture-password');
        await state.page.locator('#btn-executa-login').click();await signedIn(state.page,uid(1));
      }
      await state.page.context().close();
    }
    pass('disabled, malformed and unavailable provider settings hide Google and its divider while existing password sign-in still works');

    const layout=await enabledPage();await fits(layout.page);
    const labels=[];for(const lang of ['ro','hu','en']){await layout.page.evaluate(value=>window.schimbaLimba(value),lang);labels.push(await layout.page.locator('#google-auth-label').innerText());}
    assert.equal(new Set(labels).size,3,'Google labels must be translated in all three site languages');
    await layout.page.context().close();
    pass('Google is shared by login and registration, translated in RO/HU/EN, and fits 320/390/768/1440px without overlap');

    const alice=await enabledPage();
    await alice.page.locator('#btn-google-login').click();await signedIn(alice.page,uid(1));
    assert.equal(alice.authorize.length,1);assert.equal(alice.exchanges.length,1);
    assert.equal(await alice.page.locator('#modal-parola-noua').count(),0,'A normal Google callback must not open password recovery');
    assert.equal(new URL(alice.page.url()).searchParams.has('code'),false,'The initialized SDK consumes the OAuth code');
    const aliceData=await alice.page.evaluate(async()=>({user:window.getSpotivityProfileUser(),access:(await db.rpc('get_admin_access')).data,bookings:(await db.from('rezervari').select('*').eq('client_user_id',(await db.auth.getSession()).data.session.user.id)).data}));
    assert.equal(aliceData.user.id,uid(1));assert.equal(aliceData.user.telefon,'111');
    assert.equal(aliceData.access.can_manage,false);assert.ok(aliceData.bookings.some(row=>row.id===originalBookings[0].id));
    await alice.page.reload({waitUntil:'networkidle'});await signedIn(alice.page,uid(1));
    assert.equal(alice.exchanges.length,1,'Reload restores the persisted session instead of exchanging the code twice');
    assert.equal(await alice.page.evaluate(key=>localStorage.getItem(key+'-code-verifier'),authStorageKey),null);
    await alice.page.context().close();
    pass('real SDK S256 PKCE exchange preserves an existing customer UUID, phone and reservation history, then restores the session on reload');

    const manager=await enabledPage({identity:uid(3)});
    const pending=gate();manager.nextSettingsGate=pending;
    await manager.page.locator('#btn-google-login').click();await entered(pending);
    await manager.page.evaluate(()=>{document.querySelector('#btn-google-login').click();document.querySelector('#btn-google-login').click();});
    assert.equal(manager.authorize.length,0);pending.release();
    await signedIn(manager.page,uid(3));await manager.page.locator('#owner-home').waitFor({state:'visible'});
    assert.equal(await manager.page.locator('#base-admin-workspace').isVisible(),false);
    await manager.page.locator('#owner-home-menu-toggle').click();
    await manager.page.locator('#owner-home-menu [data-owner-action="administration"]').click();
    await manager.page.locator('#base-admin-workspace').waitFor({state:'visible'});
    assert.equal(manager.authorize.length,1);assert.equal(manager.exchanges.length,1);
    const managerData=await manager.page.evaluate(async()=>({access:(await db.rpc('get_admin_access')).data,profile:window.getSpotivityProfileUser(),grants:(await db.from('baze_sportive_admini').select('*')).data}));
    assert.equal(managerData.profile.id,uid(3));assert.equal(managerData.access.can_manage,true);assert.equal(managerData.access.is_super,false);
    assert.ok(managerData.grants.some(row=>row.baza_id===baseId&&row.user_id===uid(3)));
    assert.equal(await manager.page.locator('#btn-cereri-baze-admin').isVisible(),false);
    await manager.page.context().close();
    pass('an existing manager keeps UUID-bound base grants, its scoped homepage and same-page workspace, while repeated clicks start only one OAuth redirect');

    const superadmin=await enabledPage({identity:uid(4)});await superadmin.page.locator('#btn-google-login').click();await signedIn(superadmin.page,uid(4));
    const superAccess=await superadmin.page.evaluate(async()=>(await db.rpc('get_admin_access')).data);
    assert.equal(superAccess.can_manage,true);assert.equal(superAccess.is_super,true);
    await superadmin.page.locator('#btn-top-cont').click();await superadmin.page.locator('#btn-administreaza-baza').waitFor({state:'visible'});
    await superadmin.page.locator('#btn-administreaza-baza').click();await superadmin.page.locator('#base-admin-workspace').waitFor({state:'visible'});
    assert.equal(await superadmin.page.locator('#btn-cereri-baze-admin').isVisible(),true);
    await superadmin.page.context().close();
    pass('the existing superadmin identity keeps its full same-page management panel after Google sign-in');

    const client=await enabledPage({identity:newUserId});await client.page.locator('#btn-google-login').click();await signedIn(client.page,newUserId);
    const clientAccess=await client.page.evaluate(async({id})=>({access:(await db.rpc('get_admin_access')).data,roles:(await db.from('users_admin').select('*')).data,grants:(await db.from('baze_sportive_admini').select('*')).data,courtWrite:await db.from('terenuri').update({pret:1}).eq('nume','Court A').select('id'),roleWrite:await db.from('users_admin').update({is_super:true}).select('id')}),{id:baseId});
    assert.equal(clientAccess.access.can_manage,false);assert.deepEqual(clientAccess.roles,[]);assert.deepEqual(clientAccess.grants,[]);
    assert.equal(clientAccess.courtWrite.data?.length||0,0);assert.equal(clientAccess.roleWrite.data?.length||0,0);
    assert.equal(await client.page.locator('#base-admin-workspace').isVisible(),false);
    assert.equal(await client.page.locator('#btn-administreaza-baza').isVisible(),false);
    await client.page.context().close();
    pass('an ordinary Google account gets no management access, and actual RLS rejects court/role writes despite forged admin metadata');

    for(const callback of ['cancel','cancel-hash']){
      const cancelled=await enabledPage({callback});await beginCallback(cancelled.page,'error');
      await cancelled.page.waitForURL(url=>url.origin===localOrigin&&!url.searchParams.has('error')&&!new URLSearchParams(url.hash.slice(1)).has('error'));
      await cancelled.page.locator('#modal-auth').waitFor({state:'visible'});
      await errorStatus(cancelled.page);
      assert.equal(await cancelled.page.locator('#modal-parola-noua').count(),0);assert.equal(cancelled.exchanges.length,0);
      assert.equal((cancelled.alerts||[]).some(text=>/resetare|reset|recovery/i.test(text)),false);
      assert.equal(await cancelled.page.evaluate(async()=>(await db.auth.getSession()).data.session),null);
      assert.equal(await cancelled.page.locator('#btn-google-login').isEnabled(),true);
      cancelled.callback='success';await cancelled.page.locator('#btn-google-login').click();await signedIn(cancelled.page,uid(1));
      await cancelled.page.context().close();
    }
    pass('query/hash Google consent cancellations show retryable sign-in messages, clean callback errors, and never open password recovery');

    const rejected=await enabledPage({exchangeError:true});await beginCallback(rejected.page,'code');
    await errorStatus(rejected.page);await rejected.page.waitForLoadState('networkidle');
    assert.equal(rejected.exchanges.length,1);assert.equal(await rejected.page.locator('#modal-parola-noua').count(),0);
    assert.equal(await rejected.page.evaluate(async()=>(await db.auth.getSession()).data.session),null);
    assert.equal(new URL(rejected.page.url()).searchParams.has('code'),false);
    await rejected.page.context().close();
    pass('a rejected real SDK PKCE code exchange leaves no session, removes its code, and does not become password recovery');

    const retry=await enabledPage();
    await retry.page.evaluate(()=>{window.fixtureOriginalGoogleSignIn=db.auth.signInWithOAuth.bind(db.auth);db.auth.signInWithOAuth=async()=>({data:{provider:'google',url:null},error:new Error('fixture SDK failure')});});
    await retry.page.locator('#btn-google-login').click();await errorStatus(retry.page);
    assert.equal(await retry.page.locator('#btn-google-login').isEnabled(),true);assert.equal(retry.authorize.length,0);
    for(const target of [
      'https://evil.example.test/auth/v1/authorize?provider=google',
      `${authOrigin}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(siteHome)}`,
      `${authOrigin}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://evil.example.test/')}`,
      `${authOrigin}/auth/v1/logout?provider=google&redirect_to=${encodeURIComponent(siteHome)}`
    ]){
      await retry.page.evaluate(url=>{db.auth.signInWithOAuth=async()=>({data:{provider:'google',url},error:null});},target);
      await retry.page.locator('#btn-google-login').click();await errorStatus(retry.page);
      assert.equal(await retry.page.locator('#btn-google-login').isEnabled(),true);assert.equal(retry.authorize.length,0);assert.equal(new URL(retry.page.url()).origin,localOrigin);
    }
    await retry.page.evaluate(()=>{db.auth.signInWithOAuth=window.fixtureOriginalGoogleSignIn;});
    await retry.page.locator('#btn-google-login').click();await signedIn(retry.page,uid(1));await retry.page.context().close();
    pass('SDK failures and unsafe authorize URLs are rejected without navigation, and the same modal can retry with the real SDK');

    const closed=await enabledPage(),closeGate=gate();closed.nextSettingsGate=closeGate;
    await closed.page.locator('#btn-google-login').click();await entered(closeGate);
    await closed.page.locator('#inchide-auth').click();closeGate.release();await closed.page.waitForLoadState('networkidle');
    assert.equal(closed.authorize.length,0);assert.equal(await closed.page.locator('#modal-auth').isVisible(),false);
    await openAuth(closed.page);await closed.page.locator('#btn-google-login').waitFor({state:'visible'});
    assert.equal(await closed.page.locator('#btn-google-login').isEnabled(),true);
    await closed.page.context().close();
    pass('closing the modal while provider availability is pending cancels the redirect and reopening allows another attempt');

    const switched=await enabledPage(),switchGate=gate();switched.nextSettingsGate=switchGate;
    await switched.page.locator('#btn-google-login').click();await entered(switchGate);
    const otherSession=await sessionFor(uid(2));
    await switched.page.evaluate(async session=>{const {error}=await db.auth.setSession(session);if(error)throw error;},otherSession);
    await switched.page.waitForFunction(id=>window.getSpotivityProfileUser?.()?.id===id,uid(2));switchGate.release();await switched.page.waitForLoadState('networkidle');
    assert.equal(switched.authorize.length,0);assert.equal(await switched.page.evaluate(async()=>(await db.auth.getSession()).data.session.user.id),uid(2));
    await switched.page.context().close();
    pass('an account change during an outstanding OAuth attempt preserves the new account and prevents stale navigation');

    const recovery=await pageFor();const recoverySession=await sessionFor(uid(1));
    const recoveryUrl=new URL(base);recoveryUrl.hash=new URLSearchParams({access_token:recoverySession.access_token,refresh_token:recoverySession.refresh_token,expires_in:'3600',token_type:'bearer',type:'recovery'}).toString();
    await recovery.page.goto(recoveryUrl.href,{waitUntil:'networkidle'});await recovery.page.locator('#modal-parola-noua').waitFor({state:'visible'});
    assert.equal(await recovery.page.locator('#google-auth-status').isVisible(),false);assert.equal(recovery.exchanges.length,0);
    await recovery.page.locator('#modal-parola-noua .buton-inchidere').click();await recovery.page.context().close();
    pass('existing implicit-hash recovery links remain usable alongside the new PKCE Google flow');

    const pkceRecovery=await enabledPage();await pkceRecovery.page.locator('#login-email').fill('alice@example.test');
    await Promise.all([
      pkceRecovery.page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/v1/recover'),
      pkceRecovery.page.locator('#btn-forgot-password').click()
    ]);
    assert.equal(pkceRecovery.recoveries.length,1);
    const recoveryVerifier=await pkceRecovery.page.evaluate(key=>localStorage.getItem(key+'-code-verifier'),authStorageKey);
    assert.match(JSON.parse(recoveryVerifier),/\/recovery$/,'The real SDK remembers that this PKCE flow was a recovery request');
    await pkceRecovery.page.goto(`${siteHome}?code=${pkceRecovery.recoveryCode}`,{waitUntil:'networkidle'});
    await pkceRecovery.page.locator('#modal-parola-noua').waitFor({state:'visible'});
    assert.equal(pkceRecovery.exchanges.length,1);assert.equal(pkceRecovery.authorize.length,0);
    assert.equal(await pkceRecovery.page.locator('#google-auth-status').isVisible(),false);
    assert.equal(new URL(pkceRecovery.page.url()).searchParams.has('code'),false);
    await pkceRecovery.page.locator('#modal-parola-noua .buton-inchidere').click();await pkceRecovery.page.context().close();
    pass('new password-reset email requests use real SDK PKCE/S256 and their verified callback still opens password recovery instead of Google sign-in');

    const failedRecovery=await enabledPage({exchangeError:true});await failedRecovery.page.locator('#login-email').fill('alice@example.test');
    await Promise.all([
      failedRecovery.page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/v1/recover'),
      failedRecovery.page.locator('#btn-forgot-password').click()
    ]);
    await failedRecovery.page.goto(`${siteHome}?code=${failedRecovery.recoveryCode}`,{waitUntil:'networkidle'});
    await failedRecovery.page.waitForFunction(()=>!new URL(window.location.href).searchParams.has('code'));
    assert.equal(failedRecovery.exchanges.length,1);
    assert.ok((failedRecovery.alerts||[]).some(text=>/Linkul de resetare.*invalid/i.test(text)),'A rejected PKCE recovery code must retain the password-reset error message');
    assert.equal(await failedRecovery.page.locator('#modal-parola-noua').count(),0);
    assert.equal(await failedRecovery.page.locator('#modal-auth').isVisible(),false);
    assert.equal(await failedRecovery.page.locator('#google-auth-status').isVisible(),false);
    assert.equal(await failedRecovery.page.evaluate(async()=>(await db.auth.getSession()).data.session),null);
    await failedRecovery.page.context().close();
    pass('a rejected PKCE password-reset code keeps the reset-specific error and never opens Google sign-in or a usable recovery session');

    const expiredRecovery=await enabledPage();await expiredRecovery.page.locator('#login-email').fill('alice@example.test');
    await Promise.all([
      expiredRecovery.page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/v1/recover'),
      expiredRecovery.page.locator('#btn-forgot-password').click()
    ]);
    const expiredUrl=new URL(siteHome);expiredUrl.search=new URLSearchParams({error:'access_denied',error_code:'otp_expired',error_description:'Fixture reset verification link expired'}).toString();
    await expiredRecovery.page.goto(expiredUrl.href,{waitUntil:'networkidle'});
    await expiredRecovery.page.waitForFunction(()=>!new URL(window.location.href).searchParams.has('error'));
    assert.equal(expiredRecovery.exchanges.length,0);
    assert.ok((expiredRecovery.alerts||[]).some(text=>/Linkul de resetare.*invalid/i.test(text)),'An expired reset verification callback retains its password-reset error even without code/type');
    assert.equal(await expiredRecovery.page.locator('#modal-parola-noua').count(),0);
    assert.equal(await expiredRecovery.page.locator('#modal-auth').isVisible(),false);
    assert.equal(await expiredRecovery.page.locator('#google-auth-status').isVisible(),false);
    assert.equal(await expiredRecovery.page.evaluate(async()=>(await db.auth.getSession()).data.session),null);
    await expiredRecovery.page.context().close();
    pass('an expired reset verification callback without code/type keeps its reset-specific error and cannot be mistaken for cancelled Google consent');

    for(const callback of ['error=access_denied&error_code=otp_expired','code=unbound-fixture-code']){
      const unbound=await pageFor();await unbound.page.goto(`${siteHome}?${callback}`,{waitUntil:'networkidle'});
      await unbound.page.locator('#modal-auth').waitFor({state:'visible'});await errorStatus(unbound.page);
      const message=await unbound.page.locator('#google-auth-status').innerText();
      assert.match(message,/Linkul de autentificare.*invalid|expirat/i);
      assert.doesNotMatch(message,/Google|resetar/i,'A callback from another browser must not claim a Google or password-reset flow');
      assert.equal(await unbound.page.locator('#modal-parola-noua').count(),0);
      assert.equal(await unbound.page.evaluate(async()=>(await db.auth.getSession()).data.session),null);
      assert.equal(new URL(unbound.page.url()).searchParams.has('code'),false);
      assert.equal(new URL(unbound.page.url()).searchParams.has('error'),false);
      assert.equal(unbound.exchanges.length,0,'An unknown callback without a verifier cannot exchange a PKCE code');
      await unbound.page.context().close();
    }
    pass('callbacks missing this browser\'s verifier/intent show a generic invalid-link message rather than claiming Google or password recovery');

    assert.deepEqual(await fixture.protectedState(),originalState,'OAuth and rejected RLS attempts must not modify existing business data');
    assert.deepEqual(await fixture.root(async()=>(await fixture.pg.query('select * from public.clienti order by id')).rows),originalProfiles);
    const automaticWrites=fixture.requests.filter(request=>request.source==='browser'&&request.path.startsWith('/rest/v1/')&&request.method!=='GET'&&request.method!=='HEAD'&&request.path!=='/rest/v1/rpc/get_admin_access'&&!(request.method==='PATCH'&&['/rest/v1/terenuri','/rest/v1/users_admin'].includes(request.path)));
    assert.deepEqual(automaticWrites,[],'Sign-in must not create/update profiles, roles, grants or reservations in the browser');
    assert.deepEqual(fixture.requests.filter(request=>request.source==='browser'&&request.path.startsWith('/auth/v1/')&&(['PUT','PATCH','DELETE'].includes(request.method)||request.path.includes('/admin/')||request.path.endsWith('/signup'))),[],'OAuth must not rewrite Auth identities, create another account or call Auth admin APIs');
    assert.deepEqual(errors,[],'No uncaught browser errors');
    assert.equal(blockedHosts.some(hostname=>hostname==='accounts.google.com'||hostname.endsWith('.supabase.co')),false,'No real Google or hosted Supabase request may escape interception');
    pass('all profile, permission and reservation records remain intact with no browser-side automatic identity or role writes');
    console.log(`${checks} Google OAuth browser checks passed.`);
  }finally{
    for(const context of contexts)await context.close().catch(()=>{});
    if(browser)await browser.close();await fixture.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
