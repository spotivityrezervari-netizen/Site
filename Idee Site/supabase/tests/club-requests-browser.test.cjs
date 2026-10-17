// Real Chromium + pinned/SRI Supabase SDK + actual Edge handler + disposable
// PostgreSQL approval/RLS. Every Supabase HTTP/WS request is intercepted.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {createFixture,uid,host}=require('./club-request-fixture.cjs');
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8002/';
const screenshotDir=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if(screenshotDir)mkdirSync(screenshotDir,{recursive:true});
const password='new-owner-password';
let checks=0;

(async()=>{
  const fixture=await createFixture();let browser;
  const {pg,root,requests,rows,protectedState}=fixture;
  try{
    const {createHandler}=await import(pathToFileURL(join(__dirname,'../functions/club-applications/handler.ts')).href);
    const edgeHandler=createHandler({url:`https://${host}`,anonKey:fixture.anonKey,serviceKey:fixture.serviceKey},{fetch:fixture.transport});
    fixture.setHandler(edgeHandler);
    const priorBase=uid(700);
    await root(async()=>{
      await pg.query("insert into public.baze_sportive(id,nume,oras,descriere) values($1,'Baza existentă','Cluj-Napoca','Existentă')",[priorBase]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1 where nume='Court A'",[priorBase]);
    });
    const beforeBusiness=await protectedState();
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
    if(proxy){const parsed=new URL(proxy);launch.proxy={server:parsed.origin,bypass:'127.0.0.1,localhost'};if(parsed.username)launch.proxy.username=decodeURIComponent(parsed.username);if(parsed.password)launch.proxy.password=decodeURIComponent(parsed.password);}
    browser=await chromium.launch(launch);
    const html=readFileSync(join(__dirname,'../../index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    assert.ok(sdkTag,'Pin the real SDK with SRI');
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    const errors=[],dialogs=[];
    const pageFor=async()=>{
      const context=await browser.newContext({timezoneId:'Europe/Bucharest'});
      await context.route(sdkTag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
      await context.route(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),fixture.browserRoute);
      await context.routeWebSocket(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),ws=>ws.close());
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept();});return page;
    };
    const pass=label=>{checks++;console.log('PASS',label);};
    const login=async(page,email,secret='fixture-password')=>{
      await page.locator('#login-email-admin').fill(email);await page.locator('#login-parola').fill(secret);await page.locator('#login-admin-btn').click();await page.waitForLoadState('networkidle');
    };
    const fill=async(page,{name='Club nou',email='owner@example.test',secret=password}={})=>{
      for(const [field,value] of Object.entries({name,contact:'Persoană Contact',city:'Reghin',email,phone:'+40 712 345 678',address:'Strada Sportului 10',maps:'https://maps.app.goo.gl/FixtureClub',password:secret,'password-confirm':secret}))await page.locator('#club-request-'+field).fill(value);
      await page.locator('[data-club-court-name]').first().fill('Teren principal');await page.locator('[data-club-court-sport]').first().selectOption('Fotbal');await page.locator('[data-club-court-price]').first().fill('120');await page.locator('#club-request-consent').check();
    };
    const edgeWrites=()=>requests.filter(r=>r.source==='browser'&&r.path==='/functions/v1/club-applications'&&r.method==='POST');
    const appWrites=()=>requests.filter(r=>r.path==='/rest/v1/rpc/submit_club_application');
    const waitSubmit=async page=>{await page.waitForFunction(()=>!document.getElementById('club-request-submit').disabled);await page.waitForLoadState('networkidle');};
    const fit=async(page,selector,label)=>{
      for(const width of [320,390,768,1440]){
        await page.setViewportSize({width,height:width<768?844:1000});await page.locator(selector).scrollIntoViewIfNeeded();
        const dimensions=await page.locator(selector).evaluate(node=>({viewport:innerWidth,width:node.getBoundingClientRect().width,scroll:node.scrollWidth,client:node.clientWidth,body:document.documentElement.scrollWidth}));
        assert.ok(dimensions.width<=dimensions.viewport+1&&dimensions.scroll<=dimensions.client+1&&dimensions.body<=dimensions.viewport+1,`${label} fits ${width}: ${JSON.stringify(dimensions)}`);
        for(const element of await page.locator(selector+' input:not([type="hidden"]), '+selector+' button').all()){
          if(!await element.isVisible())continue;
          const box=await element.boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1,`${label} control fits ${width}`);
        }
        if(screenshotDir){
          await page.screenshot({path:join(screenshotDir,`club-${label}-${width}.png`)});
          const target=page.locator(label==='public'?'#club-request-password':'#admin-cerere-confirm-submit');
          await target.scrollIntoViewIfNeeded();
          await page.screenshot({path:join(screenshotDir,`club-${label}-action-${width}.png`)});
        }
      }
    };
    const publicPage=await pageFor();await publicPage.goto(base,{waitUntil:'networkidle'});await publicPage.setViewportSize({width:390,height:844});
    await publicPage.locator('#btn-mobile-menu').click();const entry=publicPage.locator('#home-mobile-menu [data-club-registration-target]');assert.equal(await entry.innerText(),'Înscrie-ți baza');await entry.click();
    await publicPage.locator('#modal-club-registration').waitFor({state:'visible'});await publicPage.keyboard.press('Escape');await publicPage.locator('#modal-club-registration').waitFor({state:'hidden'});
    await publicPage.locator('#btn-mobile-menu').click();await entry.click();await fill(publicPage);
    assert.equal(await publicPage.locator('#club-request-login').count(),0);assert.equal(await publicPage.evaluate(async()=>(await db.auth.getSession()).data.session),null);
    pass('signed-out visitors open the form directly from the mobile menu and choose an account password without logging in');

    const beforeValidation=edgeWrites().length;
    for(const [selector,value]of [['#club-request-password-confirm','different-password'],['#club-request-maps','javascript:alert(1)'],['[data-club-court-price]','-1']]){
      const input=publicPage.locator(selector).first(),original=await input.inputValue();await input.fill(value);await publicPage.locator('#club-request-submit').click();assert.equal(edgeWrites().length,beforeValidation);await input.fill(original);
    }
    await publicPage.locator('#club-request-consent').uncheck();await publicPage.locator('#club-request-submit').click();assert.equal(edgeWrites().length,beforeValidation);await publicPage.locator('#club-request-consent').check();
    const png=readFileSync(join(__dirname,'../../assets/imagini/avatar2.png'));
    for(const file of [{name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')},{name:'huge.png',mimeType:'image/png',buffer:Buffer.alloc(5242881)}]){
      await publicPage.locator('#club-request-photo').setInputFiles(file);await publicPage.waitForFunction(()=>document.getElementById('club-request-photo').files.length===0);assert.equal(edgeWrites().length,beforeValidation);
    }
    pass('password confirmation, whole-RON court prices, safe Maps URLs, consent and valid images are checked before submission');
    await publicPage.locator('#club-request-photo').setInputFiles({name:'club.png',mimeType:'image/png',buffer:png});await publicPage.waitForFunction(()=>document.getElementById('club-request-photo-image').naturalWidth>0);
    const sports=['Baschet','Tenis','Volei','Tenis Picior'];
    for(const [index,sport]of sports.entries()){
      await publicPage.locator('#club-request-add-court').click();await publicPage.locator('[data-club-court-name]').last().fill('Teren '+sport);await publicPage.locator('[data-club-court-sport]').last().selectOption(sport);await publicPage.locator('[data-club-court-price]').last().fill(String(80+index*10));
    }
    await publicPage.locator('#club-request-description').fill('<img src=x onerror="window.clubXss=true"> & detalii');await fit(publicPage,'.club-registration-panel','public');
    pass('all five sports, multiple court tariffs, password fields and decoded photo fit phone and desktop widths');
    const pending=fixture.pauseNext('/functions/v1/club-applications','POST');
    await publicPage.locator('#club-registration-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await pending.entered;
    assert.equal(await publicPage.locator('#club-request-submit').isDisabled(),true);pending.release();await waitSubmit(publicPage);
    const first=(await rows())[0];assert.ok(first,JSON.stringify(requests.map(({path,status,error})=>({path,status,error})))+' '+await publicPage.locator('#club-request-status').innerText());
    assert.equal(first.nume_baza,'Club nou');assert.deepEqual(first.terenuri.map(c=>c.sport),['Fotbal',...sports]);assert.deepEqual(first.preturi_solicitate,[120,80,90,100,110]);assert.equal(first.stare,'noua');assert.equal(first.approved_base_id,null);assert.match(first.poza_path,new RegExp(`^${fixture.accounts.get('owner@example.test').id}/${first.id}/${first.id}\\.png$`));
    assert.equal(edgeWrites().length,beforeValidation+1);assert.equal(appWrites().length,1);assert.equal(await publicPage.locator('#club-request-password').inputValue(),'');assert.equal(await publicPage.locator('#club-request-password-confirm').inputValue(),'');
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'');assert.equal(await publicPage.locator('[data-club-court-name]').count(),1);assert.equal(await publicPage.evaluate(async()=>(await db.auth.getSession()).data.session),null);
    const pendingBusiness=await protectedState();
    for(const table of Object.keys(beforeBusiness).filter(table=>table!=='clienti'))assert.deepEqual(pendingBusiness[table],beforeBusiness[table]);
    assert.equal(pendingBusiness.clienti.length,beforeBusiness.clienti.length+1,'Normal Auth signup creates an ordinary customer profile only');
    const stored=await publicPage.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)}));assert.ok(!JSON.stringify(stored).includes(password));assert.ok(!JSON.stringify(first).includes(password));assert.ok(!JSON.stringify(appWrites()).includes(password));
    assert.match(await publicPage.locator('#club-request-status').innerText(),/confirm[aă][\s\S]*email/i,'New unconfirmed accounts receive the email-confirmation instruction');
    pass('one signed-out request creates only an Auth account and private application, clears passwords, and grants no admin access or business resources');
    const access=await publicPage.evaluate(async({id,path})=>({read:await db.from('cereri_baze_sportive').select('*').eq('id',id),photo:await db.storage.from('cereri_baze_sportive').createSignedUrl(path,60),legacy:await db.rpc('submit_club_request',{p_request_id:id})}),{id:first.id,path:first.poza_path});
    assert.equal(access.read.data?.length||0,0);assert.ok(access.photo.error);assert.ok(access.legacy.error);
    pass('anonymous visitors cannot read application contacts, sign private photos or bypass the Edge service through the old RPC');

    await fill(publicPage,{name:'Tentativă cont existent',email:'alice@example.test',secret:'wrong-existing-password'});const accountsBefore=fixture.accounts.size;
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);assert.equal((await rows()).length,1);assert.equal(fixture.accounts.size,accountsBefore);assert.equal(fixture.accounts.get('alice@example.test').password,'fixture-password');assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Tentativă cont existent');
    pass('an existing email with a wrong password cannot submit, reset its password or obtain permissions');
    await fill(publicPage,{name:'Club respins',email:'bob@example.test',secret:'fixture-password'});
    await publicPage.locator('#club-request-photo').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:png});await publicPage.waitForFunction(()=>document.getElementById('club-request-photo-image').naturalWidth>0);
    fixture.state.loseNextAcknowledgement=true;
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);assert.equal((await rows()).length,2);const retryRequest=(await rows()).find(r=>r.id!==first.id);
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Club respins');assert.match(await publicPage.locator('#club-request-submit').innerText(),/verific[aă]/i);
    const retrySnapshot=JSON.stringify(retryRequest),privatePhotosBefore=[...fixture.objects.keys()].filter(key=>key.startsWith('cereri_baze_sportive/')).sort();
    await publicPage.locator('#close-club-registration').click();await publicPage.locator('#modal-club-registration').waitFor({state:'hidden'});
    await publicPage.locator('#btn-club-registration').click();await publicPage.locator('#modal-club-registration').waitFor({state:'visible'});
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Club respins');assert.equal(await publicPage.locator('#club-request-name').isDisabled(),true);
    for(const id of ['password','password-confirm']){assert.equal(await publicPage.locator('#club-request-'+id).inputValue(),'');assert.equal(await publicPage.locator('#club-request-'+id).isEnabled(),true);await publicPage.locator('#club-request-'+id).fill('wrong-existing-password');}
    const writesBeforeWrongRetry=appWrites().length;
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);
    assert.equal(edgeWrites().at(-1).status,401);assert.equal(appWrites().length,writesBeforeWrongRetry);assert.equal((await rows()).length,2);assert.equal(JSON.stringify((await rows()).find(row=>row.id===retryRequest.id)),retrySnapshot);assert.match(await publicPage.locator('#club-request-submit').innerText(),/verific[aă]/i);assert.equal(await publicPage.locator('#club-request-name').isDisabled(),true);
    for(const id of ['password','password-confirm']){assert.equal(await publicPage.locator('#club-request-'+id).inputValue(),'');assert.equal(await publicPage.locator('#club-request-'+id).isEnabled(),true);await publicPage.locator('#club-request-'+id).fill('fixture-password');}
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);
    assert.equal((await rows()).length,2);assert.equal(appWrites().at(-1).body.p_request_id,retryRequest.id);assert.equal(JSON.stringify((await rows()).find(row=>row.id===retryRequest.id)),retrySnapshot);assert.deepEqual([...fixture.objects.keys()].filter(key=>key.startsWith('cereri_baze_sportive/')).sort(),privatePhotosBefore);assert.equal(await publicPage.locator('#club-request-name').inputValue(),'');
    pass('a lost response survives closing and reopening; a wrong retry password cannot discard its frozen UUID, and correcting it confirms the same request and photo without duplicates');

    // Preserve Supabase's real confirmation requirement: email delivery is not
    // triggered by this fixture, and this explicit fixture event is its confirmation.
    const unconfirmedResult=await fixture.serial(()=>edgeHandler(new Request(`https://${host}/functions/v1/club-applications`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+fixture.token(uid(4))},body:JSON.stringify({action:'approve',request_id:first.id,prices:[120,80,90,100,110],expected_updated_at:first.updated_at,note:'Must wait for email confirmation'})})));
    assert.equal(unconfirmedResult.status,409);assert.equal((await unconfirmedResult.json()).code,'email_confirmation_required');assert.deepEqual(await protectedState(),pendingBusiness);assert.ok(![...fixture.objects.keys()].some(key=>key.startsWith('poze_baze_sportive/')),'Failed acceptance cleans only its unreferenced public copy');
    pass('Supabase email confirmation remains required before approval; a failed acceptance leaves no published base, permissions or photo copy');
    await fixture.confirm('owner@example.test');
    const applicant=await pageFor();await applicant.goto(new URL('admin.html',base).href,{waitUntil:'networkidle'});await login(applicant,'owner@example.test',password);
    assert.equal(await applicant.locator('#sectiune-dashboard').isVisible(),false);assert.equal(await applicant.locator('#sectiune-login').isVisible(),true);
    pass('even a confirmed applicant with the chosen password cannot enter admin before superadmin acceptance');
    const ordinary=await pageFor();await ordinary.goto(new URL('admin.html',base).href,{waitUntil:'networkidle'});await login(ordinary,'admin@example.test');
    assert.equal(await ordinary.locator('#sectiune-dashboard').isVisible(),false);assert.equal(await ordinary.locator('#sectiune-login').isVisible(),true);
    assert.equal(await ordinary.locator('#btn-cereri-baze-admin').isVisible(),false);const denied=await ordinary.evaluate(async path=>({rows:(await db.from('cereri_baze_sportive').select('*')).data,photo:(await db.storage.from('cereri_baze_sportive').createSignedUrl(path,60)).data}),first.poza_path);assert.equal(denied.rows?.length||0,0);assert.equal(denied.photo,null);
    pass('ordinary administrators cannot enter the superadmin dashboard or read applications or their private photos');

    const superPage=await pageFor();await superPage.goto(new URL('admin.html',base).href,{waitUntil:'networkidle'});await login(superPage,'super@example.test');await superPage.locator('#btn-cereri-baze-admin').click();
    await superPage.locator(`[data-club-request-id="${first.id}"]`).click();await superPage.waitForFunction(()=>document.getElementById('admin-cerere-photo').naturalWidth>0);
    assert.ok((await superPage.locator('#admin-cerere-data').innerText()).includes('owner@example.test'));assert.equal(await superPage.locator('#admin-cerere-data img').count(),0);assert.equal(await superPage.evaluate(()=>window.clubXss),undefined);assert.ok(!(await superPage.locator('#modal-cereri-baze-admin').innerText()).includes(password));
    assert.deepEqual(await superPage.locator('[data-court-price-index]').evaluateAll(inputs=>inputs.map(i=>i.value)),['120','80','90','100','110']);
    assert.equal(await superPage.locator('#admin-cerere-state option[value="acceptata"]').count(),0);assert.equal(await superPage.locator('#admin-cerere-state option[value="respinsa"]').count(),0);
    await superPage.locator('[data-court-price-index="0"]').fill('130');await superPage.locator('#admin-cerere-note').fill('Date verificate, acceptăm publicarea.');
    await superPage.locator('#admin-cerere-approve').click();await superPage.locator('#admin-cerere-confirm').waitFor({state:'visible'});assert.ok((await superPage.locator('#admin-cerere-confirm-prices').innerText()).includes('130'));
    await fit(superPage,'#modal-cereri-baze-admin .modal-continut','admin-accept');assert.deepEqual(await protectedState(),pendingBusiness);
    pass('only superadmin reviews safely rendered contacts/private photos and confirms explicit approval prices without exposing passwords');
    await superPage.locator('#admin-cerere-confirm-submit').click();await superPage.waitForFunction(()=>document.getElementById('admin-cerere-decision-status').textContent.includes('Bază publicată'));
    const approved=(await rows()).find(r=>r.id===first.id);assert.equal(approved.stare,'acceptata');assert.equal(approved.approved_base_id,first.reserved_base_id);assert.equal(approved.approved_court_ids.length,5);
    const created=await root(async()=>({base:(await pg.query('select * from public.baze_sportive where id=$1',[approved.approved_base_id])).rows[0],courts:(await pg.query('select * from public.terenuri where baza_sportiva_id=$1 order by id',[approved.approved_base_id])).rows,role:(await pg.query('select * from public.users_admin where user_id=$1',[fixture.accounts.get('owner@example.test').id])).rows[0],grants:(await pg.query('select * from public.baze_sportive_admini where user_id=$1',[fixture.accounts.get('owner@example.test').id])).rows}));
    assert.equal(created.base.este_activa,true);assert.equal(created.courts.length,5);assert.deepEqual(created.courts.map(c=>Number(c.pret)),[130,80,90,100,110]);assert.equal(created.role.is_super,false);assert.deepEqual(created.role.terenuri.split(',').sort(),created.courts.map(c=>c.nume).sort());assert.deepEqual(created.grants.map(g=>g.baza_id),[created.base.id]);assert.equal(fixture.objects.get('poze_baze_sportive/'+created.base.poza).body.equals(png),true);assert.equal(await superPage.locator('#admin-cerere-decision').isVisible(),false);
    pass('acceptance runs actual SQL to publish the active base, five priced courts, photo copy and exact ordinary-admin scope atomically');
    const duplicate=await superPage.evaluate(async({id,prices,expected})=>{const session=(await db.auth.getSession()).data.session;const response=await fetch(`${supabaseUrl}/functions/v1/club-applications`,{method:'POST',headers:{'content-type':'application/json',apikey:supabaseKey,authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'approve',request_id:id,prices,expected_updated_at:expected,note:'Do not duplicate'})});return {status:response.status,body:await response.json()};},{id:first.id,prices:[130,80,90,100,110],expected:first.updated_at});
    assert.equal(duplicate.status,200);assert.equal(duplicate.body.base_id,created.base.id);assert.equal((await root(()=>pg.query('select id from public.terenuri where baza_sportiva_id=$1',[created.base.id]))).rows.length,5);
    pass('a retried acceptance returns the existing published base without duplicating courts or expanding scope');

    await applicant.goto(base,{waitUntil:'networkidle'});
    // The earlier rejected admin.html attempt retains normal Auth, so the
    // already signed-in owner opens the public profile without authenticating again.
    await applicant.locator('#btn-top-cont').click();await applicant.locator('#modal-profil').waitFor({state:'visible'});
    await applicant.locator('#btn-administreaza-baza').waitFor({state:'visible'});await applicant.locator('#btn-administreaza-baza').click();
    await applicant.locator('#base-admin-workspace').waitFor({state:'visible'});assert.equal(await applicant.locator('#btn-cereri-baze-admin').isVisible(),false);await applicant.locator('#btn-baze-admin').waitFor({state:'visible'});
    const scoped=await applicant.evaluate(async({baseId,priorBase})=>({own:await db.from('baze_sportive').update({descriere:'Actualizat de proprietar'}).eq('id',baseId).select('id'),other:await db.from('baze_sportive').update({descriere:'Intrus'}).eq('id',priorBase).select('id'),court:await db.from('terenuri').update({pret:1}).eq('nume','Court A').select('id'),requests:await db.from('cereri_baze_sportive').select('*')}),{baseId:created.base.id,priorBase});
    assert.equal(scoped.own.data?.length,1);assert.equal(scoped.other.data?.length||0,0);assert.equal(scoped.court.data?.length||0,0);assert.equal(scoped.requests.data?.length||0,0);
    pass('the accepted applicant signs in with the chosen password and can edit only their base, with no superadmin or unrelated court access');
    const visitor=await pageFor();await visitor.goto(new URL(`index.html?baza=${created.base.id}`,base).href,{waitUntil:'networkidle'});await visitor.locator('#modal-baze-sportive').waitFor({state:'visible'});await visitor.waitForFunction(()=>document.querySelectorAll('[data-base-court]').length===5);assert.equal(await visitor.locator('[data-base-court]').count(),5);assert.ok((await visitor.locator('#baze-sportive-continut').innerText()).includes('Club nou'));await visitor.waitForFunction(()=>[...document.querySelectorAll('#baze-sportive-continut img')].some(image=>image.naturalWidth>0&&image.src.includes('/poze_baze_sportive/')));
    pass('the published base, its five reservable courts and submitted photo are visible to signed-out public visitors');

    await superPage.locator('#admin-cerere-back').click();await superPage.locator(`[data-club-request-id="${retryRequest.id}"]`).click();await superPage.locator('#admin-cerere-note').fill('Nu corespunde criteriilor.');await superPage.locator('#admin-cerere-reject').click();await superPage.locator('#admin-cerere-confirm').waitFor({state:'visible'});await fit(superPage,'#modal-cereri-baze-admin .modal-continut','admin-reject');
    const beforeReject=await protectedState();await superPage.locator('#admin-cerere-confirm-submit').click();await superPage.waitForFunction(()=>document.getElementById('admin-cerere-decision-status').textContent.includes('Cerere respinsă'));
    assert.equal((await rows()).find(r=>r.id===retryRequest.id).stare,'respinsa');assert.deepEqual(await protectedState(),beforeReject);assert.equal((await root(()=>pg.query('select * from public.users_admin where user_id=$1',[uid(2)]))).rows.length,0);
    pass('explicit confirmed rejection records the decision and note without creating a base, courts or any admin role');

    // A request saved under an existing client lets the test revoke superadmin
    // live in PostgreSQL immediately before confirmation, exercising fresh RLS.
    await fill(publicPage,{name:'Cerere pentru revocare',email:'alice@example.test',secret:'fixture-password'});await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);const third=(await rows()).find(r=>![first.id,retryRequest.id].includes(r.id));assert.ok(third);
    await superPage.locator('#admin-cerere-back').click();await superPage.locator('#admin-cereri-refresh').click();await superPage.locator(`[data-club-request-id="${third.id}"]`).click();await superPage.locator('#admin-cerere-approve').click();await superPage.locator('#admin-cerere-confirm').waitFor({state:'visible'});
    await root(()=>pg.query("update public.users_admin set is_super=false,terenuri='Court A' where user_id=$1",[uid(4)]));const afterDemotion=await protectedState(),edgeBefore=edgeWrites().length;await superPage.locator('#admin-cerere-confirm-submit').click();await superPage.locator('#btn-cereri-baze-admin').waitFor({state:'hidden'});
    assert.equal(edgeWrites().length,edgeBefore);assert.equal((await rows()).find(r=>r.id===third.id).approved_base_id,null);assert.deepEqual(await protectedState(),afterDemotion);assert.equal(await superPage.locator('#admin-cerere-data').innerText(),'');assert.equal(await superPage.locator('#admin-cerere-photo').getAttribute('src'),null);
    const revoked=await fixture.serial(()=>edgeHandler(new Request(`https://${host}/functions/v1/club-applications`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+fixture.token(uid(4))},body:JSON.stringify({action:'approve',request_id:third.id,prices:[120],expected_updated_at:third.updated_at,note:'Revoked JWT must not publish'})})));assert.equal(revoked.status,403);assert.deepEqual(await protectedState(),afterDemotion);
    await root(()=>pg.query("update public.users_admin set is_super=true,terenuri='ALL' where user_id=$1",[uid(4)]));
    pass('revoking superadmin blocks UI confirmation and a still-valid JWT at the Edge endpoint, and clears cached private details');
    const after=await protectedState();for(const [table,oldRows]of Object.entries(beforeBusiness))for(const oldRow of oldRows)assert.ok(after[table].some(row=>JSON.stringify(row)===JSON.stringify(oldRow)),`Existing ${table} row preserved`);
    assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.path.startsWith('/auth/')||r.path.startsWith('/rest/')||r.path.startsWith('/storage/')||r.path.startsWith('/functions/')));assert.ok(requests.filter(r=>r.path.startsWith('/auth/v1/admin')).every(r=>r.source==='edge'&&r.service));
    pass('all previous reservations, roles, profiles, courts and bases remain intact; no browser exceptions or hosted writes occur');
    console.log(`${checks} club-request browser checks passed`);
  }finally{if(browser)await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
