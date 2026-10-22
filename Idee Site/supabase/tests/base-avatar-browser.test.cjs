// Real Chromium + pinned Supabase SDK + disposable PostgreSQL/RLS. Every
// hosted Auth, REST and Storage request is intercepted; no live writes occur.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const {createFixture,uid,host}=require('./club-request-fixture.cjs');
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8096/';
const screenshotDir=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
const bucket='poze_baze_sportive';
if(screenshotDir)mkdirSync(screenshotDir,{recursive:true});
let checks=0;

async function profile(page){
  if(await page.locator('#modal-profil').isVisible())return;
  if(await page.locator('#base-admin-workspace').isVisible()&&await page.locator('#btn-inchide-administrare').isVisible()){
    await page.locator('#btn-inchide-administrare').click();
    await page.locator('#base-admin-workspace').waitFor({state:'hidden'});
    await page.locator('#spotivity-top').waitFor({state:'visible'});
  }
  if(await page.locator('#btn-top-cont').isVisible())await page.locator('#btn-top-cont').click();
  else{if(!await page.locator('#home-mobile-menu').isVisible())await page.locator('#btn-mobile-menu').click();await page.locator('#home-mobile-menu [data-profile-target]').click();}
}
async function login(page,email){
  await profile(page);await page.locator('#modal-auth').waitFor({state:'visible'});
  await page.locator('#login-email').fill(email);await page.locator('#login-parola').fill('fixture-password');
  await page.locator('#btn-executa-login').click();await page.locator('#modal-auth').waitFor({state:'hidden'});await page.waitForLoadState('networkidle');
}
async function editor(page){
  if(await page.locator('#modal-profil').isVisible())await page.locator('#btn-administreaza-baza').click();
  else if(!await page.locator('#base-admin-workspace').isVisible()&&await page.locator('#btn-return-to-administration').isVisible())await page.locator('#btn-return-to-administration').click();
  await page.locator('#base-admin-workspace').waitFor({state:'visible'});
  await page.locator('#base-admin-edit-base').click();await page.locator('#admin-baza-form').waitFor({state:'visible'});
}
async function choose(page,prefix,buffer,name='profile.png',mimeType='image/png'){
  await page.locator(`#${prefix}-file`).setInputFiles({name,mimeType,buffer});
  await page.waitForFunction(prefix=>!document.getElementById('btn-'+prefix+'-save').disabled,prefix);
}
async function saved(page,prefix,statusId){
  await page.locator(`#btn-${prefix}-save`).click();
  await page.waitForFunction(id=>document.getElementById(id).textContent.includes('salvată'),statusId);
  await page.waitForLoadState('networkidle');
}
async function fits(page,selector,label){
  for(const width of[320,390,768,1440]){
    await page.setViewportSize({width,height:width<768?844:1000});
    const root=page.locator(selector);await root.waitFor({state:'visible'});
    const dimensions=await root.evaluate(node=>{
      const r=node.getBoundingClientRect();return{viewport:innerWidth,page:document.documentElement.scrollWidth,left:r.left,right:r.right,
        controls:[...node.querySelectorAll('button,input,select,textarea')].filter(n=>n.getClientRects().length&&!n.hidden)
          .map(n=>({id:n.id,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})).filter(n=>n.left<r.left-1||n.right>r.right+1)};
    });
    assert.ok(dimensions.page<=width+1&&dimensions.left>=-1&&dimensions.right<=width+1,`${label} ${width}: ${JSON.stringify(dimensions)}`);
    assert.deepEqual(dimensions.controls,[],`${label} ${width}: controls`);
    if(screenshotDir){if(label==='editor')await page.locator('#admin-baza-avatar-section').scrollIntoViewIfNeeded();await page.screenshot({path:join(screenshotDir,`base-avatar-${label}-${width}.png`)});}
  }
}

(async()=>{
  const fixture=await createFixture();let browser;
  const {pg,root,objects,requests}=fixture;
  const ids={own:uid(1801),other:uid(1802),cover:uid(1811),avatar:uid(1812),otherCover:uid(1813),otherAvatar:uid(1814)};
  const paths={cover:`${ids.own}/${ids.cover}.png`,avatar:`${ids.own}/${ids.avatar}.png`,otherCover:`${ids.other}/${ids.otherCover}.png`,otherAvatar:`${ids.other}/${ids.otherAvatar}.png`};
  const png=readFileSync(join(__dirname,'../../assets/imagini/avatar2.png'));
  const controls={loseNextPatch:false,userGate:null};
  const errors=[],contexts=[];
  const pass=label=>{checks++;console.log('PASS',label);};
  const row=id=>root(async()=>(await pg.query('select id,nume,poza,poza_profil from public.baze_sportive where id=$1',[id])).rows[0]);
  const writes=()=>requests.filter(r=>r.source==='browser'&&((r.path.startsWith('/storage/v1/object/'+bucket+'/')&&r.method==='POST')||(r.path==='/rest/v1/baze_sportive'&&r.method==='PATCH')));
  const pausePrivateIdentity=()=>{
    let enter,release,timer;const entered=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Expected isolated image-client identity verification')),15000);enter=()=>{clearTimeout(timer);resolve();};});
    const wait=new Promise(resolve=>release=resolve);controls.userGate={remaining:2,enter,wait};return{entered,release};
  };
  try{
    await root(async()=>{
      for(const[id,name]of[[ids.own,'Club Avatar Nord'],[ids.other,'Club Avatar Străin']])await pg.query("insert into public.baze_sportive(id,nume,oras,descriere) values($1,$2,'Cluj-Napoca','Descriere de test')",[id,name]);
      await pg.query('update public.terenuri set baza_sportiva_id=$1,poza=$2 where nume=$3',[ids.own,'assets/imagini/avatar2.png','Court A']);
      await pg.query('update public.terenuri set baza_sportiva_id=$1,poza=$2 where nume=$3',[ids.other,'assets/imagini/avatar2.png','Court B']);
      await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[ids.own,uid(3)]);
      await pg.query("insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Court-only owner','bob@example.test',false,'Court B')");
      for(const path of Object.values(paths)){
        await pg.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[bucket,path,JSON.stringify({size:png.length,mimetype:'image/png'})]);
        objects.set(bucket+'/'+path,{body:png,mime:'image/png'});
      }
      await pg.query('update public.baze_sportive set poza=$2,poza_profil=$3 where id=$1',[ids.own,paths.cover,paths.avatar]);
      await pg.query('update public.baze_sportive set poza=$2,poza_profil=$3 where id=$1',[ids.other,paths.otherCover,paths.otherAvatar]);
    });
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;if(proxy){const u=new URL(proxy);launch.proxy={server:u.origin,bypass:'127.0.0.1,localhost'};}
    browser=await chromium.launch(launch);
    const html=readFileSync(join(__dirname,'../../index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(sdkTag);
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    const pageFor=async()=>{
      const context=await browser.newContext({timezoneId:'Europe/Bucharest'});contexts.push(context);
      await context.route(sdkTag[1],r=>r.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
      await context.route(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),async route=>{
        const request=route.request(),url=new URL(request.url());
        if(controls.userGate&&url.pathname==='/auth/v1/user'&&request.method()==='GET'&&--controls.userGate.remaining===0){
          const pending=controls.userGate;controls.userGate=null;pending.enter();await pending.wait;
        }
        if(controls.loseNextPatch&&url.pathname==='/rest/v1/baze_sportive'&&request.method()==='PATCH'){
          controls.loseNextPatch=false;
          await fixture.serial(()=>fixture.transport(new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.postDataBuffer()}),{},'browser'));
          return route.abort('failed');
        }
        return fixture.browserRoute(route);
      });
      await context.routeWebSocket(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),ws=>ws.close());
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());return page;
    };

    const publicPage=await pageFor();await publicPage.goto(base,{waitUntil:'networkidle'});
    const card=publicPage.locator(`[data-home-base-id="${ids.own}"]`);
    try{await card.waitFor({state:'visible'});}catch(error){
      console.error('Initial public avatar diagnostics',JSON.stringify({errors,directory:await publicPage.locator('#home-bases-directory').innerText(),requests:requests.map(({path,method,status,error})=>({path,method,status,error}))}));throw error;
    }
    assert.equal(await card.locator(`img[src$="/${paths.cover}"]`).count(),1);
    const publicAvatar=card.locator('.sports-base-avatar');await publicAvatar.waitFor({state:'visible'});await publicAvatar.locator(`img[src$="/${paths.avatar}"]`).evaluate(image=>image.decode());
    for(const width of[320,390,768,1440]){
      await publicPage.setViewportSize({width,height:844});
      const avatar=await publicAvatar.evaluate(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{width:r.width,height:r.height,radius:s.borderRadius};});
      assert.ok(avatar.width>0&&avatar.width<=128&&Math.abs(avatar.width-avatar.height)<=1,JSON.stringify(avatar));
      assert.ok(avatar.radius.includes('%')?parseFloat(avatar.radius)>=50:parseFloat(avatar.radius)>=avatar.width/2-1,JSON.stringify(avatar));
    }
    await card.click();await publicPage.locator('#modal-baze-sportive').waitFor({state:'visible'});
    assert.equal(await publicPage.locator(`#baze-sportive-continut img[src$="/${paths.cover}"]`).count(),1);
    assert.equal(await publicPage.locator(`#baze-sportive-continut img[src$="/${paths.avatar}"]`).count(),1);
    await fits(publicPage,'#modal-baze-sportive .sports-bases-panel','public-profile');await publicPage.keyboard.press('Escape');
    pass('public base cards and detail keep the cover plus a separate small round avatar at phone and desktop widths');

    const admin=await pageFor();await admin.goto(base,{waitUntil:'networkidle'});await login(admin,'admin@example.test');
    await admin.locator('#base-admin-workspace').waitFor({state:'visible'});
    assert.equal(await admin.locator('#spotivity-top').isVisible(),false);
    assert.equal(await admin.locator('#base-admin-base-avatar img').count(),1);
    assert.equal(await admin.locator('#container-meniu-terenuri [data-admin-court]').count(),1);
    await editor(admin);await fits(admin,'#modal-baze-admin .modal-continut','editor');
    assert.equal(await admin.locator('#baza-avatar-file').isEnabled(),true);
    assert.equal(await admin.locator('#baza-poza-preview').getAttribute('src').then(x=>x.endsWith('/'+paths.cover)),true);
    pass('a permitted owner automatically sees only its court and can edit the independent avatar beside the existing cover');

    const beforeInvalid=writes().length;
    await admin.locator('#baza-avatar-file').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')});
    await admin.waitForFunction(()=>document.getElementById('admin-baza-avatar-status').textContent.includes('SVG'));
    assert.equal(await admin.locator('#btn-baza-avatar-save').isDisabled(),true);
    await admin.locator('#baza-avatar-file').setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)});
    await admin.waitForFunction(()=>document.getElementById('admin-baza-avatar-status').textContent.includes('5 MB'));
    assert.equal(await admin.locator('#btn-baza-avatar-save').isDisabled(),true);
    await admin.locator('#baza-avatar-file').setInputFiles({name:'corrupt.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
    await admin.waitForFunction(()=>document.getElementById('admin-baza-avatar-status').textContent.includes('nu poate fi afișat'));
    assert.equal(await admin.locator('#btn-baza-avatar-save').isDisabled(),true);assert.equal(writes().length,beforeInvalid);
    pass('SVG, oversized and undecodable avatar files are rejected before uploads or metadata writes');

    await choose(admin,'baza-avatar',png);await saved(admin,'baza-avatar','admin-baza-avatar-status');
    const firstSaved=await row(ids.own);assert.equal(firstSaved.poza,paths.cover);assert.notEqual(firstSaved.poza_profil,paths.avatar);assert.match(firstSaved.poza_profil,new RegExp('^'+ids.own+'/'));
    assert.ok(objects.get(bucket+'/'+firstSaved.poza_profil)?.body.equals(png));assert.ok(objects.has(bucket+'/'+paths.cover));assert.equal(objects.has(bucket+'/'+paths.avatar),false);
    await admin.reload({waitUntil:'networkidle'});await admin.locator('#base-admin-workspace').waitFor({state:'visible'});await editor(admin);
    assert.ok((await admin.locator('#baza-avatar-preview').getAttribute('src')).endsWith('/'+firstSaved.poza_profil));
    assert.ok((await admin.locator('#baza-poza-preview').getAttribute('src')).endsWith('/'+paths.cover));
    pass('saving and restoring an avatar changes only poza_profil and cleans only the old unreferenced avatar');

    await admin.locator('#btn-baza-avatar-remove').click();await admin.waitForFunction(()=>document.getElementById('admin-baza-avatar-status').textContent.includes('eliminată'));
    assert.equal((await row(ids.own)).poza_profil,null);assert.equal((await row(ids.own)).poza,paths.cover);assert.ok(objects.has(bucket+'/'+paths.cover));
    assert.equal(objects.has(bucket+'/'+firstSaved.poza_profil),false);
    pass('removing the avatar preserves the cover and removes only the now-unreferenced avatar object');

    await root(()=>pg.query('update public.baze_sportive set poza_profil=poza where id=$1',[ids.own]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await editor(admin);
    await admin.locator('#btn-baza-avatar-remove').click();await admin.waitForFunction(()=>document.getElementById('admin-baza-avatar-status').textContent.includes('eliminată'));
    assert.equal((await row(ids.own)).poza,paths.cover);assert.ok(objects.has(bucket+'/'+paths.cover));
    await root(()=>pg.query('update public.baze_sportive set poza_profil=poza where id=$1',[ids.own]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await editor(admin);
    await choose(admin,'baza-poza',png,'new-cover.png');await saved(admin,'baza-poza','admin-baza-photo-status');
    const shared=await row(ids.own);assert.notEqual(shared.poza,paths.cover);assert.equal(shared.poza_profil,paths.cover);assert.ok(objects.has(bucket+'/'+paths.cover));
    pass('cleanup checks both metadata fields, so removing a shared avatar or replacing its cover cannot delete the other image');

    await choose(admin,'baza-avatar',png,'unknown-ack.png');controls.loseNextPatch=true;await admin.locator('#btn-baza-avatar-save').click();
    await admin.waitForFunction(()=>document.getElementById('admin-baza-avatar-section').getAttribute('aria-busy')==='false');await admin.waitForLoadState('networkidle');
    const unknown=await row(ids.own);assert.notEqual(unknown.poza_profil,shared.poza_profil);assert.equal(unknown.poza,shared.poza);
    assert.ok(objects.has(bucket+'/'+unknown.poza_profil));assert.ok(objects.has(bucket+'/'+shared.poza));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await editor(admin);
    assert.ok((await admin.locator('#baza-avatar-preview').getAttribute('src')).endsWith('/'+unknown.poza_profil));
    pass('a lost metadata acknowledgement keeps a successfully assigned avatar and cover intact until reloading confirms the saved result');

    const foreignBefore=await row(ids.other);
    const foreign=await admin.evaluate(async({id,path})=>db.from('baze_sportive').update({poza_profil:path}).eq('id',id).select('id'),{id:ids.other,path:paths.otherAvatar});
    assert.equal(foreign.data?.length||0,0);assert.deepEqual(await row(ids.other),foreignBefore);
    const courtOnly=await pageFor();await courtOnly.goto(base,{waitUntil:'networkidle'});await login(courtOnly,'bob@example.test');await courtOnly.locator('#base-admin-workspace').waitFor({state:'visible'});
    assert.equal(await courtOnly.locator('#base-admin-edit-base').isVisible(),false);
    const denied=await courtOnly.evaluate(async({id,path,bytes})=>({
      update:await db.from('baze_sportive').update({poza_profil:path}).eq('id',id).select('id'),
      upload:await db.storage.from('poze_baze_sportive').upload(path,new Blob([new Uint8Array(bytes)],{type:'image/png'}),{contentType:'image/png'})
    }),{id:ids.other,path:`${ids.other}/${uid(1889)}.png`,bytes:[...png]});
    assert.equal(denied.update.data?.length||0,0);assert.ok(denied.upload.error);assert.deepEqual(await row(ids.other),foreignBefore);
    pass('real RLS denies foreign-base changes and court-only grants cannot edit or upload base-profile images');

    const beforeClose=writes().length;await choose(admin,'baza-avatar',png,'closed-editor.png');
    const closeGate=fixture.pauseNext('/auth/v1/user','GET');await admin.locator('#btn-baza-avatar-save').click();await closeGate.entered;
    await admin.locator('#btn-inchide-baze-admin').click();closeGate.release();await admin.waitForLoadState('networkidle');
    assert.equal(writes().length,beforeClose);assert.equal((await row(ids.own)).poza_profil,unknown.poza_profil);
    pass('closing the editor during image identity validation aborts the pending upload and metadata change');

    await editor(admin);await choose(admin,'baza-avatar',png,'revoked-grant.png');const beforeRevocation=writes().length;
    const revokeGate=fixture.pauseNext('/auth/v1/user','GET');await admin.locator('#btn-baza-avatar-save').click();await revokeGate.entered;
    await root(()=>pg.query('delete from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[ids.own,uid(3)]));
    await admin.evaluate(()=>window.dispatchEvent(new Event('focus')));await admin.locator('#modal-baze-admin').waitFor({state:'hidden'});
    assert.equal(await admin.locator('#base-admin-edit-base').isVisible(),false);revokeGate.release();await admin.waitForLoadState('networkidle');
    assert.equal(writes().length,beforeRevocation);assert.equal((await row(ids.own)).poza_profil,unknown.poza_profil);
    pass('revoking only the base-presentation grant aborts the pending avatar save while the court-management scope remains separate');

    await root(()=>pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[ids.own,uid(3)]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await editor(admin);await choose(admin,'baza-avatar',png,'account-switch.png');
    const beforeSwitch=writes().length,identityGate=pausePrivateIdentity();await admin.locator('#btn-baza-avatar-save').click();await identityGate.entered;
    await admin.evaluate(()=>db.auth.signInWithPassword({email:'alice@example.test',password:'fixture-password'}));
    await admin.locator('#base-admin-workspace').waitFor({state:'hidden'});identityGate.release();await admin.waitForLoadState('networkidle');
    assert.equal(writes().length,beforeSwitch);assert.equal((await row(ids.own)).poza_profil,unknown.poza_profil);
    assert.equal(await admin.locator('#spotivity-top').isVisible(),true);
    pass('switching accounts during isolated image-client verification clears owner UI and prevents a stale avatar upload');

    assert.deepEqual(errors,[]);assert.deepEqual(await row(ids.other),foreignBefore);
    assert.ok(requests.every(request=>request.path.startsWith('/auth/')||request.path.startsWith('/rest/')||request.path.startsWith('/storage/')));
    pass('avatar flows complete without JavaScript exceptions, unrelated-base changes or requests to hosted write endpoints');
    console.log(`${checks} base avatar browser checks passed`);
  }finally{for(const context of contexts)await context.close();if(browser)await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
