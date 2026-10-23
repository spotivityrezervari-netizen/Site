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
const ownerCourtNames=page=>page.locator('#owner-home-sports .owner-court-card .home-court-name').allTextContents();
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
          const box=item.getBoundingClientRect();return {id:item.id,action:item.dataset.ownerAction,left:box.left,right:box.right,width:box.width,height:box.height,scrollingRow:!!item.closest('.home-courts-strip')};
        // Compact client-style court rows deliberately scroll within the page.
        }).filter(item=>!item.scrollingRow&&(item.left<rect.left-1||item.right>rect.right+1))};
    });
    assert.ok(dimensions.page<=width+1&&dimensions.left>=-1&&dimensions.right<=width+1,`${label} ${width}: ${JSON.stringify(dimensions)}`);
    assert.deepEqual(dimensions.controls,[],`${label} controls ${width}`);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,`owner-${label}-${width}.png`)});
  }
}
async function sharedHomeLayout(owner,client){
  for(const width of [390,1440]){
    await owner.setViewportSize({width,height:width<768?844:1000});await client.setViewportSize({width,height:width<768?844:1000});
    const clientCard=client.locator('.home-courts-strip .home-court-card').filter({hasText:'Court A'}).first();await clientCard.waitFor({state:'visible'});
    const reference=await clientCard.evaluate(node=>({width:node.getBoundingClientRect().width,photoHeight:node.querySelector('.home-court-photo').getBoundingClientRect().height}));
    const sections=await owner.locator('.owner-sport-section').evaluateAll(nodes=>nodes.map(section=>{
      const strip=section.querySelector('.home-courts-strip'),cards=[...strip.children],plus=cards[0],court=cards.find(node=>node.matches('.owner-court-card'));
      return {sport:section.dataset.ownerSport,hero:section.classList.contains('home-sport-hero'),copy:!!section.querySelector('.home-hero-copy .home-sport-heading'),
        art:!!section.querySelector('.home-hero-art img[data-sport-background]'),heroHeight:section.getBoundingClientRect().height,
        direction:getComputedStyle(strip).flexDirection,overflow:getComputedStyle(strip).overflowX,stripWidth:strip.clientWidth,scrollWidth:strip.scrollWidth,
        plusFirst:plus.matches('.owner-add-court-card.home-court-card[data-owner-action="create"]'),plusCount:cards.filter(node=>node.matches('[data-owner-action="create"]')).length,
        cards:cards.map(node=>({shared:node.classList.contains('home-court-card'),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),
        photoHeight:court?.querySelector('.home-court-photo')?.getBoundingClientRect().height};
    }));
    assert.equal(sections.length,2);
    for(const section of sections){
      assert.ok(section.hero&&section.copy&&section.art&&section.heroHeight>350,`Large shared sport hero at ${width}: ${JSON.stringify(section)}`);
      assert.equal(section.direction,'row');assert.ok(['auto','scroll'].includes(section.overflow));
      assert.equal(section.plusFirst,true);assert.equal(section.plusCount,1);
      for(const card of section.cards){assert.equal(card.shared,true);assert.ok(Math.abs(card.width-reference.width)<1,`Client and owner card width at ${width}: ${JSON.stringify(section)}`);assert.ok(Math.abs(card.height-section.cards[0].height)<1,'The PLUS card has the same height as the court cards');}
      assert.ok(Math.abs(section.photoHeight-reference.photoHeight)<1,`Shared client card image dimensions at ${width}`);
      if(width===390)assert.ok(section.scrollWidth>section.stripWidth,'Phone court rows scroll horizontally');
    }
    if(screenshotDir)await owner.screenshot({path:join(screenshotDir,`owner-client-home-${width}.png`),fullPage:true});
  }
}
async function ownerTouchScrolling(page){
  await page.setViewportSize({width:390,height:844});
  const touch=await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  async function swipe(from,to){
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    for(let step=1;step<=10;step++){
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*step/10,y:from.y+(to.y-from.y)*step/10}]});
      await page.waitForTimeout(20);
    }
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(400);
  }
  for(const hero of await page.locator('#owner-home .owner-sport-section').all()){
    for(const distance of [-140,140]){
      await hero.evaluate(node=>scrollTo({top:scrollY+node.getBoundingClientRect().top+150,behavior:'instant'}));
      await page.waitForTimeout(850);
      assert.equal(await hero.evaluate(node=>document.elementFromPoint(190,200)===node.querySelector('.home-hero-art')),true,
        'A swipe starts on the photograph, without a clipping layer intercepting it');
      const before=await page.evaluate(()=>scrollY);
      await swipe({x:190,y:200},{x:190,y:200+distance});
      const after=await page.evaluate(()=>scrollY);
      assert.ok(distance<0?after>before+60:after<before-60,`Owner background swipe ${distance}: ${before} → ${after}`);
    }
  }
  const strip=page.locator('#owner-home .home-courts-strip').first();
  await strip.evaluate(node=>{node.scrollLeft=0;scrollTo({top:scrollY+node.getBoundingClientRect().top-120,behavior:'instant'});});
  await page.waitForTimeout(400);
  const before=await strip.evaluate(node=>({x:node.scrollLeft,y:scrollY,max:node.scrollWidth-node.clientWidth}));
  await swipe({x:280,y:170},{x:100,y:170});
  const after=await strip.evaluate(node=>({x:node.scrollLeft,y:scrollY}));
  assert.ok(before.max>10&&after.x>before.x+Math.min(60,before.max/2),
    `Court rows still accept native horizontal swipes: ${JSON.stringify({before,after})}`);
  assert.ok(Math.abs(after.y-before.y)<2,'A horizontal court swipe does not move the page vertically');
  await touch.detach();
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
    assert.deepEqual((await ownerCourtNames(admin)).sort(),['Court A','Court B']);
    assert.doesNotMatch(await admin.locator('#owner-home').innerText(),/Court Excluded|Hidden Court|Baza Străină/);
    assert.deepEqual(await admin.locator('.owner-sport-section').evaluateAll(nodes=>nodes.map(node=>node.dataset.ownerSport)).then(values=>values.sort()),['Fotbal','Tenis']);
    await sharedHomeLayout(admin,client);
    assert.equal(await admin.locator('#owner-home-nav .home-brand img').isVisible(),true);
    assert.equal(await admin.locator('#owner-home-nav-search.home-nav-search').isVisible(),true);
    await admin.locator('#owner-home-nav-search-input').fill('Court');await admin.locator('#owner-home-nav-search-input').press('Enter');
    await visible(admin,'#owner-home-dialog[data-owner-dialog="search"]');
    const searchInput=admin.locator('#owner-home-search-input'),searchNames=()=>admin.locator('#owner-home-search-results .home-court-name').allTextContents();
    for(const [query,names]of [['Court',['Court A','Court B']],['Cluj-Napoca',['Court A','Court B']],['Fotbal',['Court A']],['Tenis',['Court B']],['Court Excluded',[]],['Hidden Court',[]]]){
      await searchInput.fill(query);
      await admin.waitForFunction(({query,names})=>document.getElementById('owner-home-search-input')?.value===query&&JSON.stringify([...document.querySelectorAll('#owner-home-search-results .home-court-name')].map(node=>node.textContent).sort())===JSON.stringify(names),{query,names}).catch(async error=>{throw new Error(`Owner search ${JSON.stringify(query)}: ${JSON.stringify(await searchNames())}; ${error.message}`);});
      assert.deepEqual((await searchNames()).sort(),names);
      assert.doesNotMatch(await admin.locator('#owner-home-search-results').innerText(),/Court Excluded|Hidden Court|Baza Străină/);
    }
    assert.equal(await admin.locator('#modal-cautare-terenuri').isVisible(),false);
    await admin.keyboard.press('Escape');await admin.locator('#owner-home-dialog').waitFor({state:'hidden'});
    pass('ordinary managers get the client hero and compact rows with a first PLUS card, only allocated sports/courts, and owner-scoped name/city/sport search');
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
    await ownerTouchScrolling(admin);
    pass('owner backgrounds accept native vertical swipes in both directions after closing the drawer, while court rows still swipe horizontally');
    const addSport=()=>admin.locator('#owner-home-add-sport');
    assert.equal(await addSport().innerText(),'Adaugă teren în alt sport');
    for(const width of [390,1440]){
      await admin.setViewportSize({width,height:width<768?844:1000});
      await addSport().scrollIntoViewIfNeeded();
      if(screenshotDir)await admin.screenshot({path:join(screenshotDir,`owner-add-sport-main-${width}.png`)});
      await openOwnerMenu(admin);
      assert.equal(await admin.locator('#owner-home-menu-add-sport').innerText(),'Adaugă teren în alt sport');
      if(screenshotDir)await admin.screenshot({path:join(screenshotDir,`owner-add-sport-menu-${width}.png`)});
      await admin.keyboard.press('Escape');
    }
    await openOwnerMenu(admin);await admin.locator('#owner-home-menu-add-sport').click();
    await visible(admin,'#owner-home-dialog[data-owner-dialog="base-choice"]');
    assert.equal(await menu.isVisible(),false);
    assert.doesNotMatch(await admin.locator('#owner-home-dialog').innerText(),/undefined|de \?/);
    assert.deepEqual((await admin.locator('#owner-home-dialog [data-owner-base-choice]').evaluateAll(nodes=>nodes.map(node=>node.dataset.ownerBaseChoice))).sort(),[ids.first,ids.second].sort());
    await admin.keyboard.press('Escape');
    assert.equal(await admin.locator('#owner-home-menu-toggle').evaluate(node=>node===document.activeElement),true,'Cancelling the drawer-to-base chooser returns keyboard focus to the visible menu toggle');
    await openOwnerMenu(admin);await admin.locator('#owner-home-menu-add-sport').click();
    await admin.locator(`#owner-home-dialog [data-owner-base-choice="${ids.second}"]`).click();await visible(admin,'#modal-owner-add-court');
    assert.match(await admin.locator('#owner-court-base').innerText(),/Baza Sud/);
    assert.equal(await admin.locator('#owner-court-sport').inputValue(),'');
    assert.equal(await admin.locator('#owner-court-sport option:checked').innerText(),'Alege sportul');
    assert.deepEqual(await admin.locator('#owner-court-sport option:not(:disabled)').evaluateAll(nodes=>nodes.map(node=>node.value)),['Fotbal','Baschet','Tenis','Volei','Tenis Picior']);
    await admin.keyboard.press('Escape');await home(admin);
    pass('both main and drawer expose the other-sport action; the drawer asks for a permitted base and an explicit sport while Escape restores visible focus');
    await root(()=>pg.query('delete from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[ids.second,uid(3)]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    await addSport().click();await visible(admin,'#modal-owner-add-court');
    assert.equal(await admin.locator('#owner-home-dialog').isVisible(),false);
    assert.match(await admin.locator('#owner-court-base').innerText(),/Baza Nord/);
    assert.equal(await admin.locator('#owner-court-sport').inputValue(),'');
    await admin.keyboard.press('Escape');await home(admin);
    await root(()=>pg.query('delete from public.baze_sportive_admini where user_id=$1',[uid(3)]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    assert.equal(await addSport().count(),0);
    await openOwnerMenu(admin);assert.equal(await admin.locator('#owner-home-menu-add-sport').count(),0);await admin.keyboard.press('Escape');
    assert.deepEqual((await ownerCourtNames(admin)).sort(),['Court A','Court B']);
    for(const plus of await admin.locator('.owner-add-court-card').all())assert.equal(await plus.isDisabled(),true);
    await root(async()=>{for(const id of [ids.first,ids.second])await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[id,uid(3)]);});
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    pass('one editable base opens creation directly, while court-only access hides both other-sport entries and disables the per-sport PLUS cards');
    assert.equal(await admin.locator('#owner-home-profile').count(),0);
    assert.equal(await admin.locator('#owner-home-nav .home-profile-button,#owner-home-nav [data-owner-action="profile"]').count(),0);
    assert.equal(await admin.locator('#btn-editeaza-profil').isVisible(),false);
    assert.equal(await admin.evaluate(()=>window.openSpotivityOwnerHomeAction('profile')),false);
    assert.equal(await admin.locator('#modal-profil').isVisible(),false);
    pass('ordinary managers have no profile entry in the header or drawer and cannot open it through the owner dispatcher');
    const beforeEntry={logins:passwords(),navigation:navigations.length,pages:admin.context().pages().length};
    await ownerAction(admin,'administration');await visible(admin,'#owner-home');await admin.waitForLoadState('networkidle');
    assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);assert.equal(await admin.locator('#modal-profil').isVisible(),false);
    assert.deepEqual((await ownerCourtNames(admin)).sort(),['Court A','Court B']);
    await ownerAction(admin,'site');await visible(admin,'#admin-site-preview');
    await admin.locator('#btn-top-cont').click();await visible(admin,'#modal-profil');
    assert.equal(await admin.locator('#btn-administreaza-baza').getAttribute('aria-controls'),'owner-home');
    await admin.locator('#btn-administreaza-baza').click();await visible(admin,'#owner-home');await admin.waitForLoadState('networkidle');
    assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);assert.equal(await admin.locator('#modal-profil').isVisible(),false);
    assert.equal(await admin.locator('#admin-site-preview').isVisible(),false);
    assert.equal(passwords(),beforeEntry.logins);assert.equal(navigations.length,beforeEntry.navigation);assert.equal(admin.context().pages().length,beforeEntry.pages);
    assert.equal(await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),token);assert.equal(await admin.locator('iframe').count(),0);
    await home(admin);
    pass('Administrare baze de date opens the new scoped owner homepage in the same tab and session without exposing the legacy panel');
    const card=id=>admin.locator(`.owner-court-card[data-owner-court-id="${id}"]`);
    await card(seeded.a.id).click();await visible(admin,`#modal-setari-${seeded.a.id}`);
    assert.equal(await admin.locator(`#pret-${seeded.a.id}`).inputValue(),'100');
    const settingsDialog=admin.locator(`#modal-setari-${seeded.a.id}`);
    assert.equal(await settingsDialog.getAttribute('role'),'dialog');assert.equal(await settingsDialog.getAttribute('aria-modal'),'true');
    const settingsHeading=await settingsDialog.getAttribute('aria-labelledby');
    assert.ok(settingsHeading);assert.match(await admin.locator(`#${settingsHeading}`).innerText(),/Court A/);
    assert.equal(await admin.locator('#modal-terenuri').isVisible(),false);await admin.keyboard.press('Escape');await home(admin);
    assert.equal(await card(seeded.a.id).evaluate(node=>node===document.activeElement),true,'Closing quick settings restores focus to the original court card');
    pass('a court card opens an accessible existing settings dialog for that exact court and restores focus after Escape');
    await admin.locator('.owner-sport-section[data-owner-sport="Fotbal"] [data-owner-action="program"]').click();await visible(admin,'#modal-tabel-program');await admin.waitForLoadState('networkidle');
    assert.deepEqual(await admin.locator('#tabel-teren option').allTextContents(),['Court A']);
    assert.equal(await admin.locator('#modal-tabel-program .program-titlu').innerText(),'Program Fotbal');
    await admin.locator('#tabel-data').fill('2034-06-15');await admin.evaluate(()=>window.incarcaTabelProgram());await admin.waitForLoadState('networkidle');
    assert.ok(!(await admin.locator('#tabel-corp-program').innerText()).includes('Se Încarcă'));await admin.keyboard.press('Escape');await home(admin);
    pass('each sport schedule uses the existing scoped calendar and accepts dates in any supported year');
    await ownerAction(admin,'manual');await visible(admin,'#modal-rezervare-manuala');
    assert.deepEqual((await admin.locator('#manual-teren option').allTextContents()).sort(),['Court A','Court B']);
    await admin.locator('#manual-teren').selectOption('Court B');
    assert.equal(await admin.locator('#manual-teren').inputValue(),'Court B');
    await admin.locator('#manual-client').fill('Invitat owner home');await admin.locator('#manual-data').fill(seeded.tomorrow);await admin.locator('#manual-ora').selectOption('15:00');await admin.locator('#manual-pret').fill('200 RON');
    await admin.locator('#btn-rezervare-manuala').click();await admin.waitForFunction(()=>!document.getElementById('btn-rezervare-manuala').disabled);
    const booking=(await root(()=>pg.query("select * from public.rezervari where email_client='Invitat owner home'"))).rows;
    assert.equal(booking.length,1);assert.equal(booking[0].teren,'Court B');assert.equal(booking[0].client_user_id,null);
    await admin.keyboard.press('Escape');await home(admin);
    pass('the manual reservation menu retains all allocated courts and books the explicitly selected court through the existing workflow');
    await ownerAction(admin,'chat');await visible(admin,'#modal-chat-admin');
    await admin.waitForFunction(()=>['Mesaj Nord','Mesaj Sud'].every(text=>document.querySelector('#chat-admin-lista-conversații')?.textContent.includes(text)));
    const chat=await admin.locator('#chat-admin-lista-conversații').innerText();assert.ok(chat.includes('Mesaj Nord')&&chat.includes('Mesaj Sud')&&!chat.includes('Mesaj privat străin'));
    await admin.keyboard.press('Escape');await home(admin);
    pass('the chat menu retains conversations for all allocated courts and excludes unrelated conversations');
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
    const footballPlus=()=>admin.locator('.owner-sport-section[data-owner-sport="Fotbal"] .owner-add-court-card[data-owner-action="create"]');
    assert.equal(await footballPlus().getAttribute('data-owner-base-id'),null);
    assert.equal(await footballPlus().getAttribute('data-owner-sport'),'Fotbal');
    await addSport().click();await visible(admin,'#owner-home-dialog[data-owner-dialog="base-choice"]');
    await admin.locator(`#owner-home-dialog [data-owner-base-choice="${ids.first}"]`).click();await visible(admin,'#modal-owner-add-court');
    assert.match(await admin.locator('#owner-court-base').innerText(),/Baza Nord/);assert.equal(await admin.locator('#owner-court-sport').inputValue(),'');
    await fits(admin,'#modal-owner-add-court .modal-continut','create-court');
    assert.equal(await admin.locator('.owner-sport-section[data-owner-sport="Baschet"]').count(),0);
    await admin.locator('#owner-court-name').fill('Court Owner New');await admin.locator('#owner-court-price').fill('180');
    const unselectedCount=createRequests().length;
    await admin.locator('#owner-court-submit').click();
    assert.equal(createRequests().length,unselectedCount,'Choosing a sport is required before any creation request');
    assert.match(await admin.locator('#owner-court-status').innerText(),/Alege.*sport/i);
    await admin.locator('#owner-court-sport').selectOption('Baschet');
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
    const newSport=admin.locator('.owner-sport-section[data-owner-sport="Baschet"]');
    assert.equal(await newSport.locator('.home-courts-strip > :first-child').getAttribute('data-owner-action'),'create');
    assert.equal(await newSport.locator('.owner-court-card .home-court-name').innerText(),'Court Owner New');
    const allocations=(await root(()=>pg.query('select * from public.users_admin where user_id=$1',[uid(3)]))).rows[0];assert.ok(allocations.terenuri.split(',').map(value=>value.trim()).includes('Court Owner New'));assert.equal(allocations.is_super,false);
    const preserved=await root(async()=>({courts:(await pg.query("select to_jsonb(t) value from public.terenuri t where nume<>'Court Owner New' order by id")).rows,otherAdmin:(await pg.query('select to_jsonb(t) value from public.users_admin t where user_id<>$1 order by id',[uid(3)])).rows}));
    assert.deepEqual(preserved,beforeCreate);
    pass('the main other-sport action creates a first basketball court through the real scoped RPC, adds its sport with PLUS first, and preserves existing data');
    const deniedCreate=await admin.evaluate(async baseId=>db.rpc('create_managed_court',{p_base_id:baseId,p_name:'Cross Base Attack',p_sport:'Fotbal',p_price:1,p_hours:['12:00']}),ids.other);
    assert.ok(deniedCreate.error);assert.equal((await root(()=>pg.query("select count(*)::int total from public.terenuri where nume='Cross Base Attack'"))).rows[0].total,0);
    pass('a direct creation request cannot add or allocate a court in another base');

    await root(()=>pg.query("update public.terenuri set sport='Fotbal' where id=$1",[seeded.b.id]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    assert.equal(await footballPlus().count(),1,'A sport shared by two permitted bases keeps one first PLUS card');
    assert.equal(await footballPlus().getAttribute('data-owner-base-id'),null,'A shared sport must not choose a base implicitly');
    const ambiguousCount=createRequests().length;
    await footballPlus().click();await visible(admin,'#owner-home-dialog[data-owner-dialog="base-choice"]');
    const choices=admin.locator('#owner-home-dialog [data-owner-base-choice]');
    assert.deepEqual((await choices.evaluateAll(nodes=>nodes.map(node=>node.dataset.ownerBaseChoice))).sort(),[ids.first,ids.second].sort());
    assert.deepEqual(await choices.evaluateAll(nodes=>nodes.map(node=>node.dataset.ownerSport)),['Fotbal','Fotbal']);
    assert.equal(createRequests().length,ambiguousCount);assert.equal(await admin.locator('#modal-owner-add-court').isVisible(),false);
    await admin.locator(`#owner-home-dialog [data-owner-base-choice="${ids.second}"]`).click();await visible(admin,'#modal-owner-add-court');
    assert.match(await admin.locator('#owner-court-base').innerText(),/Baza Sud/);assert.equal(await admin.locator('#owner-court-sport').inputValue(),'Fotbal');
    assert.equal(await admin.locator('#owner-home-dialog').isVisible(),false);
    await admin.keyboard.press('Escape');await home(admin);
    assert.equal(await admin.evaluate(()=>window.openSpotivityOwnerHomeAction('create',{sport:'Fotbal'})),false);
    assert.equal(createRequests().length,ambiguousCount);assert.equal(await admin.locator('#base-admin-workspace').isVisible(),false);
    await root(()=>pg.query('update public.terenuri set sport=$2 where id=$1',[seeded.b.id,seeded.b.sport]));
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    pass('a shared sport PLUS asks for an authorized base, passes the chosen base and sport explicitly, and rejects an ambiguous direct add action');

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
