// Real Chromium + pinned/SRI Supabase SDK + disposable PostgreSQL/RLS.
// All hosted Auth/database/Storage requests are intercepted. Never writes live data.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const {createFixture,uid,host}=require('./club-request-fixture.cjs');
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:8105/';
const screenshotDir=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if(screenshotDir)mkdirSync(screenshotDir,{recursive:true});
let checks=0;
const pass=label=>{checks++;console.log('PASS',label);};
const visible=async(page,selector)=>page.locator(selector).waitFor({state:'visible'});
async function openOwnerMenu(page){
  if(!await page.locator('#owner-home-menu').isVisible())await page.locator('#owner-home-menu-toggle').click();
  await visible(page,'#owner-home-menu');
}
async function ownerAction(page,action){
  await openOwnerMenu(page);await page.locator(`#owner-home-menu [data-owner-action="${action}"]`).first().click();
  await page.locator('#owner-home-menu').waitFor({state:'hidden'});
}
async function login(page,email){
  await page.locator('#btn-top-cont').click();await visible(page,'#modal-auth');
  await page.locator('#login-email').fill(email);await page.locator('#login-parola').fill('fixture-password');
  await page.locator('#btn-executa-login').click();await page.locator('#modal-auth').waitFor({state:'hidden'});
  await page.waitForFunction(async expected=>typeof db!=='undefined'&&(await db.auth.getSession()).data.session?.user.email===expected,email);
  await page.waitForLoadState('networkidle');
}
async function home(page){
  if(await page.locator('#base-admin-workspace').isVisible())await page.locator('#btn-inchide-administrare').click();
  await visible(page,'#owner-home');
  await page.waitForLoadState('networkidle');
}
async function fits(page,selector,label){
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:width<768?844:1000});
    const root=page.locator(selector);await root.waitFor({state:'visible'});
    const dimensions=await root.evaluate(node=>{
      const rect=node.getBoundingClientRect();
      return {viewport:innerWidth,page:document.documentElement.scrollWidth,left:rect.left,right:rect.right,
        controls:[...node.querySelectorAll('button,input,select,textarea')].filter(item=>item.getClientRects().length&&getComputedStyle(item).visibility!=='hidden').map(item=>{
          const box=item.getBoundingClientRect();return {id:item.id,action:item.dataset.ownerAction,left:box.left,right:box.right,width:box.width,height:box.height};
        }).filter(item=>item.left<rect.left-1||item.right>rect.right+1)};
    });
    assert.ok(dimensions.page<=width+1&&dimensions.left>=-1&&dimensions.right<=width+1,`${label} ${width}: ${JSON.stringify(dimensions)}`);
    assert.deepEqual(dimensions.controls,[],`${label} controls ${width}`);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,`owner-${label}-${width}.png`)});
  }
}
(async()=>{
  const fixture=await createFixture();let browser;
  const {pg,root,requests}=fixture;
  const ids={first:uid(8101),second:uid(8102),other:uid(8103)};
  const contexts=[],errors=[],navigations=[];
  try{
    const seeded=await root(async()=>{
      for(const [id,name]of [[ids.first,'Baza Nord'],[ids.second,'Baza Sud'],[ids.other,'Baza Străină']])await pg.query("insert into public.baze_sportive(id,nume,oras,descriere) values($1,$2,'Cluj-Napoca','Descriere existentă')",[id,name]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1,oras='Cluj-Napoca',poza='assets/imagini/avatar2.png' where nume='Court A'",[ids.first]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1,oras='Cluj-Napoca',este_activ=false,poza='assets/imagini/avatar2.png' where nume='Court B'",[ids.second]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1 where nume='Hidden Court'",[ids.other]);
      await pg.query("insert into public.terenuri(nume,sport,pret,oras,baza_sportiva_id,poza) values('Court Excluded','Fotbal',90,'Cluj-Napoca',$1,'assets/imagini/avatar2.png')",[ids.first]);
      await pg.query("update public.users_admin set terenuri='Court A,Court B' where user_id=$1",[uid(3)]);
      for(const id of [ids.first,ids.second])await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[id,uid(3)]);
      const courts=(await pg.query('select * from public.terenuri')).rows;
      const tomorrow=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text d")).rows[0].d;
      await pg.query("insert into public.rezervari(email_client,teren,data_str,ora,stare,pret_total) values('alice@example.test','Court A',$1,'12:00','activa','100 RON'),('bob@example.test','Court B',$1,'13:00','activa','200 RON'),('Unrelated guest','Court Excluded',$1,'14:00','activa','90 RON')",[tomorrow]);
      const completed=(await pg.query("insert into public.rezervari(email_client,teren,data_str,ora,stare,pret_total) values('Completed guest','Court A','2020-01-01','12:00','activa','100 RON') returning *")).rows[0];
      for(const [court,email,message]of [['Court A','alice@example.test','Mesaj Nord'],['Court B','bob@example.test','Mesaj Sud'],['Court Excluded','Unrelated guest','Mesaj privat străin']])await pg.query("insert into public.mesaje_chat(email_client,teren,expeditor,mesaj,citit) values($1,$2,'client',$3,false)",[email,court,message]);
      return {courts,tomorrow,completed,a:courts.find(row=>row.nume==='Court A'),b:courts.find(row=>row.nume==='Court B'),foreign:courts.find(row=>row.nume==='Court Excluded')};
    });
    const html=readFileSync(join(__dirname,'../../index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(sdkTag);
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;if(proxy){const url=new URL(proxy);launch.proxy={server:url.origin,bypass:'127.0.0.1,localhost'};}
    browser=await chromium.launch(launch);
    async function pageFor(){
      const context=await browser.newContext({timezoneId:'Europe/Bucharest',viewport:{width:390,height:844}});contexts.push(context);
      const faults={access:false};
      await context.route(sdkTag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
      await context.route(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),async route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/rest/v1/rpc/get_admin_access'&&faults.access)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Fixture access temporarily unavailable'}),headers:{'access-control-allow-origin':'*'}});
        if(url.pathname==='/auth/v1/settings')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({external:{google:false}}),headers:{'access-control-allow-origin':'*'}});
        if(url.pathname==='/rest/v1/rpc/create_managed_court'){
          const request=route.request(),body=request.postDataJSON();
          const id=fixture.tokens.get((request.headers().authorization||'').replace(/^Bearer /,''));
          const record={source:'browser',path:url.pathname,method:request.method(),userId:id,body,status:null};requests.push(record);
          return fixture.serial(async()=>{
            let status=200,result;
            try{
              await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await pg.exec(`set role ${id?'authenticated':'anon'}`);
              result=(await pg.query('select public.create_managed_court(p_base_id=>$1::uuid,p_name=>$2,p_sport=>$3,p_price=>$4::integer,p_hours=>$5::text[]) value',[body.p_base_id,body.p_name,body.p_sport,body.p_price,body.p_hours])).rows[0].value;
            }catch(error){status=error.code==='42501'?403:error.code==='23505'?409:400;result={code:error.code,message:error.message};}
            record.status=status;
            return route.fulfill({status,contentType:'application/json',body:JSON.stringify(result),headers:{'access-control-allow-origin':'*','x-supabase-api-version':'2024-01-01'}});
          });
        }
        return fixture.browserRoute(route);
      });
      await context.routeWebSocket(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),socket=>socket.close());
      const page=await context.newPage();page.ownerFaults=faults;page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations.push(frame.url());});return page;
    }
    const passwords=()=>requests.filter(record=>record.source==='browser'&&record.path==='/auth/v1/token').length;
    const publicPage=await pageFor();await publicPage.goto(base,{waitUntil:'networkidle'});
    assert.equal(await publicPage.locator('#owner-home').isVisible(),false);assert.equal(await publicPage.locator('#spotivity-top').isVisible(),true);
    pass('anonymous visitors keep the public homepage without an owner menu or private courts');
    const client=await pageFor();await client.goto(base,{waitUntil:'networkidle'});await login(client,'alice@example.test');
    assert.equal(await client.locator('#owner-home').isVisible(),false);assert.equal(await client.locator('#spotivity-top').isVisible(),true);
    await client.locator('#btn-top-cont').click();await visible(client,'#modal-profil');assert.equal(await client.locator('#btn-editeaza-profil').isVisible(),true);await client.keyboard.press('Escape');
    pass('customers keep their public homepage and the existing profile editor');
    const admin=await pageFor();await admin.goto(base,{waitUntil:'networkidle'});await login(admin,'admin@example.test');await visible(admin,'#owner-home');
    assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);assert.equal(await admin.locator('#spotivity-top').isVisible(),false);
    const token=await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),logins=passwords();
    assert.deepEqual((await admin.locator('.owner-court-card h3,.owner-court-card h4').allTextContents()).sort(),['Court A','Court B']);
    assert.doesNotMatch(await admin.locator('#owner-home').innerText(),/Court Excluded|Hidden Court|Baza Străină/);
    assert.deepEqual(await admin.locator('.owner-sport-section').evaluateAll(nodes=>nodes.map(node=>node.dataset.ownerSport)).then(values=>values.sort()),['Fotbal','Tenis']);
    pass('ordinary managers land on an app-style homepage containing only their allocated courts, grouped by sport, including inactive courts');
    await admin.reload({waitUntil:'networkidle'});await visible(admin,'#owner-home');
    assert.equal(passwords(),logins);assert.equal(await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),token);
    assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);assert.equal(await admin.locator('#modal-profil').isVisible(),false);
    pass('restoring an owner session opens the scoped homepage without another login or the legacy panel');
    await fits(admin,'#owner-home','homepage');await openOwnerMenu(admin);await fits(admin,'#owner-home-menu','menu');
    const menu=admin.locator('#owner-home-menu');
    for(const action of ['administration','base','chat','manual'])assert.equal(await menu.locator(`[data-owner-action="${action}"]`).first().isVisible(),true,action);
    assert.equal(await menu.locator('[data-owner-action="profile"]').count(),0);
    assert.match(await menu.innerText(),/Administrare baze de date/);assert.doesNotMatch(await menu.innerText(),/Profilul meu|Editează (contul|profilul)/i);
    await admin.waitForFunction(()=>document.querySelector('#owner-home-menu')?.contains(document.activeElement));
    for(let i=0;i<18;i++){await admin.keyboard.press('Tab');assert.equal(await menu.evaluate(node=>node.contains(document.activeElement)),true,'Keyboard focus stays within the open owner drawer');}
    await admin.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    assert.equal(await admin.locator('#owner-home-menu-toggle').getAttribute('aria-expanded'),'false');
    assert.equal(await admin.locator('#owner-home-menu-toggle').evaluate(node=>node===document.activeElement),true);
    pass('the hamburger and owner drawer actions fit phones and desktop, and Escape closes the menu');
    assert.equal(await admin.locator('#owner-home-profile').count(),0);
    assert.equal(await admin.locator('#btn-editeaza-profil').isVisible(),false);
    assert.equal(await admin.evaluate(()=>window.openSpotivityOwnerHomeAction('profile')),false);
    assert.equal(await admin.locator('#modal-profil').isVisible(),false);
    pass('ordinary managers have no profile entry in the header or drawer and cannot open it through the owner dispatcher');
    const beforePanel={logins:passwords(),navigation:navigations.length,pages:admin.context().pages().length};
    await ownerAction(admin,'administration');await visible(admin,'#base-admin-workspace');
    assert.equal(await admin.locator('#owner-home').isVisible(),false);assert.equal(await admin.locator('#base-admin-workspace .super-admin-only:visible').count(),0);
    assert.equal(passwords(),beforePanel.logins);assert.equal(navigations.length,beforePanel.navigation);assert.equal(admin.context().pages().length,beforePanel.pages);
    assert.equal(await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),token);assert.equal(await admin.locator('iframe').count(),0);
    await home(admin);
    pass('Administrare baze de date opens the existing complete scoped panel in the same tab and session, then returns to the owner homepage');
    const card=id=>admin.locator(`.owner-court-card[data-owner-court-id="${id}"]`);
    await card(seeded.a.id).locator('[data-owner-action="court"]').click();await visible(admin,`#modal-setari-${seeded.a.id}`);
    assert.equal(await admin.locator(`#pret-${seeded.a.id}`).inputValue(),'100');
    const settingsDialog=admin.locator(`#modal-setari-${seeded.a.id}`);
    assert.equal(await settingsDialog.getAttribute('role'),'dialog');assert.equal(await settingsDialog.getAttribute('aria-modal'),'true');
    const settingsHeading=await settingsDialog.getAttribute('aria-labelledby');
    assert.ok(settingsHeading);assert.match(await admin.locator(`#${settingsHeading}`).innerText(),/Court A/);
    assert.equal(await admin.locator('#modal-terenuri').isVisible(),false);await admin.keyboard.press('Escape');await home(admin);
    assert.equal(await card(seeded.a.id).locator('[data-owner-action="court"]').evaluate(node=>node===document.activeElement),true,'Closing quick settings restores focus to the original court action');
    pass('a court card opens an accessible existing settings dialog for that exact court and restores focus after Escape');
    await admin.locator('.owner-sport-section[data-owner-sport="Fotbal"] [data-owner-action="program"]').click();await visible(admin,'#modal-tabel-program');await admin.waitForLoadState('networkidle');
    assert.deepEqual(await admin.locator('#tabel-teren option').allTextContents(),['Court A']);
    assert.equal(await admin.locator('#modal-tabel-program .program-titlu').innerText(),'Program Fotbal');
    await admin.locator('#tabel-data').fill('2034-06-15');await admin.evaluate(()=>window.incarcaTabelProgram());await admin.waitForLoadState('networkidle');
    assert.ok(!(await admin.locator('#tabel-corp-program').innerText()).includes('Se Încarcă'));await admin.keyboard.press('Escape');await home(admin);
    pass('each sport schedule uses the existing scoped calendar and accepts dates in any supported year');
    await card(seeded.a.id).locator('[data-owner-action="manual"]').click();await visible(admin,'#modal-rezervare-manuala');
    assert.equal(await admin.locator('#manual-teren').inputValue(),'Court A');
    assert.deepEqual((await admin.locator('#manual-teren option').allTextContents()).sort(),['Court A','Court B']);
    await admin.locator('#manual-client').fill('Invitat owner home');await admin.locator('#manual-data').fill(seeded.tomorrow);await admin.locator('#manual-ora').selectOption('15:00');await admin.locator('#manual-pret').fill('100 RON');
    await admin.locator('#btn-rezervare-manuala').click();await admin.waitForFunction(()=>!document.getElementById('btn-rezervare-manuala').disabled);
    const booking=(await root(()=>pg.query("select * from public.rezervari where email_client='Invitat owner home'"))).rows;
    assert.equal(booking.length,1);assert.equal(booking[0].teren,'Court A');assert.equal(booking[0].client_user_id,null);
    await admin.keyboard.press('Escape');await home(admin);
    pass('manual reservation shortcuts select the matching base/court and retain the existing booking workflow');
    await card(seeded.a.id).locator('[data-owner-action="chat"]').click();await visible(admin,'#modal-chat-admin');
    await admin.waitForFunction(()=>document.querySelector('#chat-admin-lista-conversații')?.textContent.includes('Mesaj Nord'));
    const chat=await admin.locator('#chat-admin-lista-conversații').innerText();assert.ok(!chat.includes('Mesaj Sud')&&!chat.includes('Mesaj privat străin'));
    await admin.keyboard.press('Escape');await home(admin);
    pass('chat shortcuts reopen the existing chat with the allocated court scope and no unrelated conversations');
    await ownerAction(admin,'base');await visible(admin,'#admin-baza-form');
    assert.equal(await admin.locator('#baza-nume').inputValue(),'Baza Nord');
    await admin.keyboard.press('Escape');await home(admin);
    pass('Editează baza sportivă uses the existing authorized base editor');
    const denied=await admin.evaluate(async({other,court,completed})=>({
      court:await db.from('terenuri').update({pret:1}).eq('id',court).select('id'),
      base:await db.from('baze_sportive').update({descriere:'Intrus'}).eq('id',other).select('id'),
      role:await db.from('users_admin').update({is_super:true}).select('id'),
      cancellation:await db.from('rezervari').update({stare:'anulata'}).eq('id',completed).select('id')
    }),{other:ids.other,court:seeded.foreign.id,completed:seeded.completed.id});
    for(const key of ['court','base','role'])assert.equal(denied[key].data?.length||0,0,key);
    assert.match(denied.cancellation.error?.message||'',/Completed bookings cannot be cancelled/);
    pass('the new homepage preserves RLS boundaries and the prohibition on cancelling completed reservations');
    const beforeCreate=await root(async()=>({courts:(await pg.query('select to_jsonb(t) value from public.terenuri t order by id')).rows,otherAdmin:(await pg.query('select to_jsonb(t) value from public.users_admin t where user_id<>$1 order by id',[uid(3)])).rows}));
    const createRequests=()=>requests.filter(record=>record.source==='browser'&&record.path==='/rest/v1/rpc/create_managed_court');
    assert.equal(await card(seeded.a.id).locator('[data-owner-action="create"]').isVisible(),true);
    await card(seeded.a.id).locator('[data-owner-action="create"]').click();await visible(admin,'#modal-owner-add-court');
    await fits(admin,'#modal-owner-add-court .modal-continut','create-court');
    await admin.locator('#owner-court-name').fill('Court Owner New');await admin.locator('#owner-court-sport').selectOption('Baschet');await admin.locator('#owner-court-price').fill('180');
    for(const checkbox of await admin.locator('#owner-court-hours input[type=checkbox]').all())await checkbox.uncheck();
    await admin.locator('#owner-court-hours input[value="09:00"]').check();await admin.locator('#owner-court-hours input[value="10:00"]').check();
    const createCount=createRequests().length;
    await admin.locator('#owner-court-submit').click();
    await admin.evaluate(()=>{document.querySelector('#owner-court-submit')?.click();});
    await admin.locator('#modal-owner-add-court').waitFor({state:'hidden'});await home(admin);
    await admin.waitForFunction(()=>document.querySelector('#owner-home')?.textContent.includes('Court Owner New'));
    assert.equal(createRequests().length,createCount+1);
    const created=(await root(()=>pg.query("select * from public.terenuri where nume='Court Owner New'"))).rows[0];
    assert.equal(created.baza_sportiva_id,ids.first);assert.equal(created.sport,'Baschet');assert.equal(Number(created.pret),180);assert.deepEqual(created.ore_rezervabile,['09:00','10:00']);
    const allocations=(await root(()=>pg.query('select * from public.users_admin where user_id=$1',[uid(3)]))).rows[0];assert.ok(allocations.terenuri.split(',').map(value=>value.trim()).includes('Court Owner New'));assert.equal(allocations.is_super,false);
    const preserved=await root(async()=>({courts:(await pg.query("select to_jsonb(t) value from public.terenuri t where nume<>'Court Owner New' order by id")).rows,otherAdmin:(await pg.query('select to_jsonb(t) value from public.users_admin t where user_id<>$1 order by id',[uid(3)])).rows}));
    assert.deepEqual(preserved,beforeCreate);
    pass('the plus action creates one court in the permitted base through the real RPC, grants only that new court, and preserves existing data');
    const deniedCreate=await admin.evaluate(async baseId=>db.rpc('create_managed_court',{p_base_id:baseId,p_name:'Cross Base Attack',p_sport:'Fotbal',p_price:1,p_hours:['12:00']}),ids.other);
    assert.ok(deniedCreate.error);assert.equal((await root(()=>pg.query("select count(*)::int total from public.terenuri where nume='Cross Base Attack'"))).rows[0].total,0);
    pass('a direct creation request cannot add or allocate a court in another base');

    await root(()=>pg.query("update public.terenuri set sport='Fotbal' where id=$1",[seeded.b.id]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    assert.equal(await admin.locator('.owner-sport-section[data-owner-sport="Fotbal"] .owner-sport-heading [data-owner-action="create"]').count(),0,'A sport shared by two permitted bases must not choose a base implicitly');
    assert.equal(await card(seeded.a.id).locator('[data-owner-action="create"]').getAttribute('data-owner-base-id'),ids.first);
    assert.equal(await card(seeded.b.id).locator('[data-owner-action="create"]').getAttribute('data-owner-base-id'),ids.second);
    const ambiguousCount=createRequests().length;
    assert.equal(await admin.evaluate(()=>window.openSpotivityOwnerHomeAction('create',{sport:'Fotbal'})),false);
    assert.equal(createRequests().length,ambiguousCount);assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);
    await root(()=>pg.query('update public.terenuri set sport=$2 where id=$1',[seeded.b.id,seeded.b.sport]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    pass('a sport shared by multiple bases keeps explicit per-court creation targets and rejects an ambiguous add action');

    const superadmin=await pageFor();await superadmin.goto(base,{waitUntil:'networkidle'});await login(superadmin,'super@example.test');
    assert.equal(await superadmin.locator('#owner-home').isVisible(),false);await superadmin.locator('#btn-top-cont').click();await visible(superadmin,'#modal-profil');await superadmin.locator('#btn-administreaza-baza').click();await visible(superadmin,'#base-admin-workspace');
    assert.equal(await superadmin.locator('#btn-cereri-baze-admin').isVisible(),true);
    pass('the superadmin retains global same-page administration and application review');
    const stale=await pageFor();await stale.goto(base,{waitUntil:'networkidle'});await login(stale,'admin@example.test');await visible(stale,'#owner-home');
    const pending=fixture.pauseNext('/rest/v1/rpc/get_admin_access','POST');
    await stale.evaluate(()=>{window.pendingOwnerAccess=window.refreshSpotivityAdminAccess({force:true});});await pending.entered;
    await stale.evaluate(async()=>{await db.auth.signInWithPassword({email:'alice@example.test',password:'fixture-password'});});
    await stale.locator('#owner-home').waitFor({state:'hidden'});pending.release();await stale.evaluate(()=>window.pendingOwnerAccess);await stale.waitForLoadState('networkidle');
    assert.equal(await stale.locator('#owner-home').isVisible(),false);assert.equal(await stale.locator('#base-admin-workspace').isVisible(),false);
    assert.equal(await stale.locator('.owner-court-card').count(),0);assert.equal(await stale.locator('#spotivity-top').isVisible(),true);
    pass('a delayed access response cannot restore owner cards or administrative UI after switching to a customer account');
    const outage=await pageFor();await outage.goto(base,{waitUntil:'networkidle'});await login(outage,'admin@example.test');await visible(outage,'#owner-home');
    outage.ownerFaults.access=true;await outage.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await outage.waitForLoadState('networkidle');
    assert.equal(await outage.locator('#owner-home').isVisible(),true);assert.equal(await outage.locator('.owner-court-card').count(),0);assert.equal(await outage.locator('#base-admin-workspace').isVisible(),false);
    assert.match(await outage.locator('#owner-home').innerText(),/verific|momentan|reîncerc|încerca/i);
    outage.ownerFaults.access=false;await outage.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await outage.waitForLoadState('networkidle');
    assert.equal(await outage.locator('#owner-home').isVisible(),true);assert.ok(await outage.locator('.owner-court-card').count()>=2);assert.equal(await outage.locator('#base-admin-workspace').isVisible(),false);
    pass('a temporary access outage clears private cards into a retry shell and a successful recheck restores only the owner homepage');
    await ownerAction(admin,'logout');await admin.locator('#owner-home').waitFor({state:'hidden'});await admin.waitForLoadState('networkidle');
    assert.equal(await admin.evaluate(async()=>(await db.auth.getSession()).data.session),null);assert.equal(await admin.locator('.owner-court-card').count(),0);assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);
    assert.equal(await admin.locator('#spotivity-top').isVisible(),true);
    pass('logout clears owner cards, the drawer and cached management controls while restoring the public homepage');
    const revoked=await pageFor();await revoked.goto(base,{waitUntil:'networkidle'});await login(revoked,'admin@example.test');await visible(revoked,'#owner-home');
    await root(async()=>{await pg.query('delete from public.baze_sportive_admini where user_id=$1',[uid(3)]);await pg.query('delete from public.users_admin where user_id=$1',[uid(3)]);});
    await revoked.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await revoked.waitForLoadState('networkidle');
    assert.equal(await revoked.locator('#owner-home').isVisible(),false);assert.equal(await revoked.locator('.owner-court-card').count(),0);assert.equal(await revoked.locator('#base-admin-workspace').isVisible(),false);
    assert.equal(await revoked.locator('#spotivity-top').isVisible(),true);
    pass('revoking the real server grants removes the owner homepage and private management data immediately');
    assert.deepEqual(errors,[],'No uncaught browser errors');
    console.log(`${checks} owner homepage browser checks passed.`);
  }finally{for(const context of contexts)await context.close().catch(()=>{});if(browser)await browser.close();await fixture.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
