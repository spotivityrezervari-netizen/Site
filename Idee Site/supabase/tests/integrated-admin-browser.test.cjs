// Real Chromium + pinned/SRI Supabase SDK + actual PostgreSQL grants, RLS and
// approval functions. Hosted Supabase requests are intercepted and never sent.
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
let checks=0;

async function profile(page){
  if(await page.locator('#modal-profil').isVisible())return;
  if(await page.locator('#btn-top-cont').isVisible())await page.locator('#btn-top-cont').click();
  else{if(!await page.locator('#home-mobile-menu').isVisible())await page.locator('#btn-mobile-menu').click();await page.locator('#home-mobile-menu [data-profile-target]').click();}
}
async function login(page,email){
  await profile(page);await page.locator('#modal-auth').waitFor({state:'visible'});
  await page.locator('#login-email').fill(email);await page.locator('#login-parola').fill('fixture-password');
  await page.locator('#btn-executa-login').click();await page.locator('#modal-auth').waitFor({state:'hidden'});
  await profile(page);await page.locator('#modal-profil').waitFor({state:'visible'});
  await page.waitForLoadState('networkidle');
}
async function selectBase(page,id,court){
  await page.locator('#base-admin-select').selectOption(id);
  await page.waitForFunction(expected=>document.querySelector('#manual-teren option')?.value===expected
    &&document.querySelector('#tabel-teren option')?.value===expected
    &&document.querySelector('#container-meniu-terenuri .admin-court-card .admin-card-name')?.textContent===expected,court);
}
async function fits(page,selector,label){
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:width<768?844:1000});
    const root=page.locator(selector);await root.waitFor({state:'visible'});
    const dimensions=await root.evaluate(node=>{
      const box=node.getBoundingClientRect();
      return {viewport:innerWidth,page:document.documentElement.scrollWidth,left:box.left,right:box.right,
        controls:[...node.querySelectorAll('input,select,textarea,button')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden')
          .map(n=>({id:n.id,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right}))
          .filter(n=>n.left<box.left-1||n.right>box.right+1)};
    });
    assert.ok(dimensions.page<=width+1&&dimensions.left>=-1&&dimensions.right<=width+1,`${label} at ${width}: ${JSON.stringify(dimensions)}`);
    assert.deepEqual(dimensions.controls,[],`${label} controls at ${width}`);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,`integrated-${label}-${width}.png`)});
  }
}

(async()=>{
  const fixture=await createFixture();let browser;
  const {pg,root,requests}=fixture;
  const ids={first:uid(701),second:uid(702),other:uid(703)};
  try{
    const {createHandler}=await import(pathToFileURL(join(__dirname,'../functions/club-applications/handler.ts')).href);
    const edge=createHandler({url:`https://${host}`,anonKey:fixture.anonKey,serviceKey:fixture.serviceKey},{fetch:fixture.transport});fixture.setHandler(edge);
    const seeded=await root(async()=>{
      for(const [id,name]of [[ids.first,'Baza Nord'],[ids.second,'Baza Sud'],[ids.other,'Baza Străină']])await pg.query("insert into public.baze_sportive(id,nume,oras,descriere) values($1,$2,'Cluj-Napoca','Descriere existentă')",[id,name]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1,oras='Cluj-Napoca',poza='assets/imagini/avatar2.png' where nume='Court A'",[ids.first]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1,oras='Cluj-Napoca',poza='assets/imagini/avatar2.png' where nume='Court B'",[ids.second]);
      await pg.query("update public.terenuri set baza_sportiva_id=$1 where nume='Hidden Court'",[ids.other]);
      await pg.query("insert into public.terenuri(nume,sport,pret,oras,baza_sportiva_id,poza) values('Court Excluded','Fotbal',90,'Cluj-Napoca',$1,'assets/imagini/avatar2.png')",[ids.first]);
      await pg.query("update public.users_admin set terenuri=' Court A , Court B ' where user_id=$1",[uid(3)]);
      for(const id of [ids.first,ids.second])await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[id,uid(3)]);
      // A formerly allocated court has been removed; the independent base
      // presentation grant remains valid without conferring another court.
      await pg.query("insert into public.terenuri(nume,sport,pret) values('Removed allocation','Fotbal',90)");
      await pg.query("insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Editor bază','bob@example.test',false,'Removed allocation')");
      await pg.query("delete from public.terenuri where nume='Removed allocation'");
      await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[ids.other,uid(2)]);
      const tomorrow=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text d")).rows[0].d;
      const courtA=(await pg.query("select * from public.terenuri where nume='Court A'")).rows[0];
      const bookings=[];
      for(const [court,client,hour]of [['Court A','alice@example.test','12:00'],['Court B','bob@example.test','13:00'],['Court Excluded','Unrelated guest','14:00']])bookings.push((await pg.query("insert into public.rezervari(email_client,teren,data_str,ora,stare,pret_total) values($1,$2,$3,$4,'activa','100 RON') returning *",[client,court,tomorrow,hour])).rows[0]);
      const past=(await pg.query("insert into public.rezervari(email_client,teren,data_str,ora,stare,pret_total) values('Archived guest','Court A','2020-01-01','12:00','activa','100 RON') returning *")).rows[0];
      const recentDay=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date-2)::text d")).rows[0].d;
      await pg.query("insert into public.rezervari(email_client,teren,data_str,ora,stare,pret_total) values('Completed guest','Court A',$1,'12:00','activa','100 RON')",[recentDay]);
      const guestName='<img src=x onerror=alert(1)> Visitor';
      await pg.query("select public.create_guest_booking_group($1,$2,$3::date,ARRAY['20:00']::text[],false,$4,'bob@example.test','+40733123456')",[uid(9701),String(courtA.id),tomorrow,guestName]);
      for(const [court,email,text]of [['Court A','alice@example.test','Mesaj Nord'],['Court B','bob@example.test','Mesaj Sud'],['Court Excluded','Unrelated guest','Mesaj privat străin']])await pg.query("insert into public.mesaje_chat(email_client,teren,expeditor,mesaj,citit) values($1,$2,'client',$3,false)",[email,court,text]);
      return {tomorrow,courtA,bookings,past,guestName};
    });
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;if(proxy){const u=new URL(proxy);launch.proxy={server:u.origin,bypass:'127.0.0.1,localhost'};}
    browser=await chromium.launch(launch);
    const html=readFileSync(join(__dirname,'../../index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(sdkTag);
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    const errors=[],navigations=[];
    const pageFor=async()=>{
      const context=await browser.newContext({timezoneId:'Europe/Bucharest'});
      await context.route(sdkTag[1],r=>r.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
      await context.route(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),fixture.browserRoute);
      await context.routeWebSocket(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),ws=>ws.close());
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',d=>d.accept());
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations.push(frame.url());});return page;
    };
    const pass=label=>{checks++;console.log('PASS',label);};
    const passwords=()=>requests.filter(r=>r.source==='browser'&&r.path==='/auth/v1/token').length;
    const raw=async(page,code,args)=>page.evaluate(code,args);
    const publicPage=await pageFor();await publicPage.goto(base,{waitUntil:'networkidle'});
    assert.equal(await publicPage.locator('#btn-administreaza-baza').isVisible(),false);
    const anon=await raw(publicPage,async()=>({access:await db.rpc('get_admin_access'),court:await db.from('terenuri').update({pret:1}).eq('nume','Court A').select('id')}));
    assert.ok(anon.access.error);assert.equal(anon.court.data?.length||0,0);
    pass('anonymous visitors have no management entry and direct API calls cannot obtain grants or change courts');

    const normal=await pageFor();await normal.goto(base,{waitUntil:'networkidle'});await login(normal,'alice@example.test');
    assert.equal(await normal.locator('#btn-administreaza-baza').isVisible(),false);
    assert.equal((await raw(normal,async()=>(await db.rpc('get_admin_access')).data)).can_manage,false);
    const normalAPI=await raw(normal,async({baseId})=>({court:await db.from('terenuri').update({pret:1}).eq('nume','Court A').select('id'),base:await db.from('baze_sportive').update({descriere:'Intrus'}).eq('id',baseId).select('id'),roles:await db.from('users_admin').update({is_super:true}).select('id'),requests:await db.from('cereri_baze_sportive').select('*')}),{baseId:ids.first});
    for(const item of Object.values(normalAPI))assert.equal(item.data?.length||0,0);
    pass('a normal signed-in account has no admin access, cannot promote itself or edit bases/courts through direct API calls');

    const admin=await pageFor();await admin.goto(base,{waitUntil:'networkidle'});await login(admin,'admin@example.test');
    await admin.locator('#btn-administreaza-baza').waitFor({state:'visible'});assert.equal(await admin.locator('#btn-administreaza-baza').innerText(),'Administrează baza sportivă');
    const token=await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),logins=passwords(),navigationCount=navigations.length;
    await admin.locator('#btn-administreaza-baza').click();await admin.locator('#base-admin-workspace').waitFor({state:'visible'});await admin.waitForLoadState('networkidle');
    assert.equal(passwords(),logins);assert.equal(navigations.length,navigationCount);assert.equal(await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),token);
    assert.equal(new URL(admin.url()).pathname,new URL(base).pathname);assert.equal(await admin.locator('iframe').count(),0);
    assert.equal(await admin.locator('#base-admin-workspace #btn-cereri-baze-admin').isVisible(),false);
    assert.equal(await admin.locator('#base-admin-workspace .super-admin-only:visible').count(),0);
    pass('the profile opens the integrated workspace with the same Auth session, page and theme, without global superadmin tools');

    const bases=await admin.locator('#base-admin-select option').evaluateAll(options=>options.map(o=>({id:o.value,name:o.textContent})));
    assert.deepEqual(bases.map(b=>b.id).sort(),[ids.first,ids.second].sort());
    await selectBase(admin,ids.first,'Court A');
    await admin.waitForFunction(()=>document.querySelector('#manual-teren option')?.value==='Court A');
    assert.deepEqual(await admin.locator('#manual-teren option').allTextContents(),['Court A']);assert.deepEqual(await admin.locator('#tabel-teren option').allTextContents(),['Court A']);
    assert.deepEqual(await admin.locator('#container-meniu-terenuri .admin-court-card .admin-card-name').allTextContents(),['Court A']);
    await fits(admin,'#base-admin-workspace','workspace');
    await selectBase(admin,ids.second,'Court B');
    assert.deepEqual(await admin.locator('#manual-teren option').allTextContents(),['Court B']);assert.deepEqual(await admin.locator('#tabel-teren option').allTextContents(),['Court B']);
    await selectBase(admin,ids.first,'Court A');
    pass('multiple permitted bases can be selected, and each selection shows only the granted courts, including on phones and desktop');

    const attacks=await raw(admin,async({other,first})=>({
      otherCourt:await db.from('terenuri').update({pret:1}).eq('nume','Court Excluded').select('id'),
      otherBase:await db.from('baze_sportive').update({descriere:'Intrus'}).eq('id',other).select('id'),
      promote:await db.from('users_admin').update({is_super:true}).select('id'),
      grant:await db.from('baze_sportive_admini').insert({baza_id:other,user_id:(await db.auth.getUser()).data.user.id}).select('baza_id'),
      relink:await db.from('terenuri').update({baza_sportiva_id:other}).eq('nume','Court A').select('id'),
      rename:await db.from('terenuri').update({nume:'Escaped grant'}).eq('nume','Court A').select('id'),
      global:await db.rpc('save_sports_base',{p_id:first,p_nume:'Global intrusion',p_oras:'Cluj',p_descriere:'',p_este_activa:true,p_court_ids:[],p_admin_ids:[]}),
      requests:await db.from('cereri_baze_sportive').select('*'),
      bookings:await db.from('rezervari').select('teren'),chat:await db.from('mesaje_chat').select('teren')
    }),{other:ids.other,first:ids.first});
    for(const key of ['otherCourt','otherBase','promote','grant','relink','rename'])assert.equal(attacks[key].data?.length||0,0,key);
    assert.ok(attacks.global.error);assert.equal(attacks.requests.data?.length||0,0);
    for(const key of ['bookings','chat'])assert.ok(attacks[key].data.every(row=>['Court A','Court B'].includes(row.teren)),key);
    pass('server policies reject cross-court/base writes, role grants, court relinking/renaming and global operations even with direct SDK requests');

    const png=readFileSync(join(__dirname,'../../assets/imagini/avatar2.png'));
    await admin.locator('#container-meniu-terenuri .admin-court-card').click();const settings=`#modal-setari-${seeded.courtA.id}`;await admin.locator(settings).waitFor({state:'visible'});
    await fits(admin,`${settings} .modal-continut`,'court-settings');
    await admin.locator(`#pret-${seeded.courtA.id}`).fill('135');
    const hours=admin.locator(`#ore-rezervabile-${seeded.courtA.id} input[value="09:00"]`);await hours.uncheck();
    await admin.locator(`#poza-${seeded.courtA.id}`).setInputFiles({name:'court.png',mimeType:'image/png',buffer:png});
    await admin.locator(`#btn-save-${seeded.courtA.id}`).click();await admin.locator(settings).waitFor({state:'hidden'});
    const saved=(await root(()=>pg.query("select * from public.terenuri where nume='Court A'"))).rows[0];assert.equal(Number(saved.pret),135);assert.ok(!saved.ore_rezervabile.includes('09:00'));
    assert.ok(saved.poza.includes('/poze_terenuri/'+uid(3)+'/'));assert.ok([...fixture.objects.keys()].some(path=>path.startsWith('poze_terenuri/'+uid(3)+'/')));
    pass('existing court settings save tariffs and reservable hours inside the integrated workspace');

    await admin.locator('#base-admin-edit-base').click();await admin.locator('#admin-baza-form').waitFor({state:'visible'});
    await admin.locator('#baza-descriere').fill('Descriere actualizată în site');await admin.locator('#btn-salveaza-baza').click();await admin.waitForLoadState('networkidle');
    assert.equal((await root(()=>pg.query('select descriere from public.baze_sportive where id=$1',[ids.first]))).rows[0].descriere,'Descriere actualizată în site');
    await admin.locator('#admin-baza-form').waitFor({state:'hidden'});await admin.locator(`[data-edit-base="${ids.first}"]`).click();
    await admin.locator('#baza-poza-file').setInputFiles({name:'integrated.png',mimeType:'image/png',buffer:png});await admin.waitForFunction(()=>!document.getElementById('btn-baza-poza-save').disabled);
    const beforePhotoLogins=passwords();await admin.locator('#btn-baza-poza-save').click();await admin.waitForFunction(()=>document.getElementById('admin-baza-photo-status').textContent.includes('salvată'));
    const photo=(await root(()=>pg.query('select poza from public.baze_sportive where id=$1',[ids.first]))).rows[0].poza;
    assert.match(photo,new RegExp(`^${ids.first}/`));assert.ok(fixture.objects.get('poze_baze_sportive/'+photo).body.equals(png));assert.equal(passwords(),beforePhotoLogins);
    await fits(admin,'#modal-baze-admin .modal-continut','base-settings');await admin.locator('#btn-inchide-baze-admin').click();
    pass('base descriptions and photographs use the existing editors and the current session without another password');
    assert.equal(await admin.locator('#base-admin-base-name').innerText(),'Baza Nord');
    assert.equal(await admin.locator('#base-admin-base-description').innerText(),'Descriere actualizată în site');
    assert.match(await admin.locator('#base-admin-base-photo img').getAttribute('src'),new RegExp(photo.replaceAll('/','\\/')));
    await root(async()=>{
      await pg.query("insert into public.terenuri(nume,sport,pret,oras,baza_sportiva_id,poza) values('Court A2','Fotbal',110,'Cluj-Napoca',$1,'assets/imagini/avatar2.png'),('Court Tennis','Tenis',120,'Cluj-Napoca',$1,'assets/imagini/avatar2.png')",[ids.first]);
      await pg.query("update public.users_admin set terenuri='Court A,Court A2,Court Tennis,Court B' where user_id=$1",[uid(3)]);
    });
    await admin.evaluate(()=>window.refreshSpotivityAdminAccess({force:true}));await admin.waitForLoadState('networkidle');
    assert.deepEqual(await admin.locator('[data-admin-sport] h3').allTextContents(),['Fotbal','Tenis']);
    assert.deepEqual(await admin.locator('[data-admin-sport="Fotbal"] .base-admin-court-copy h4').allTextContents(),['Court A','Court A2']);
    assert.deepEqual(await admin.locator('[data-admin-sport="Tenis"] .base-admin-court-copy h4').allTextContents(),['Court Tennis']);
    await admin.locator('[data-admin-program="Fotbal"]').click();await admin.waitForLoadState('networkidle');
    assert.deepEqual(await admin.locator('#tabel-teren option').allTextContents(),['Court A','Court A2']);
    assert.equal(await admin.locator('#modal-tabel-program .program-titlu').innerText(),'Program Fotbal');
    for(const date of ['0001-01-01','1900-01-01','2020-01-01','9999-12-31']){
      await admin.locator('#tabel-data').fill(date);await admin.evaluate(()=>window.incarcaTabelProgram());await admin.waitForLoadState('networkidle');
      assert.equal(await admin.locator('#tabel-data').inputValue(),date);
      const text=await admin.locator('#tabel-corp-program').innerText();assert.ok(!text.includes('Se Încarcă'),date+': '+JSON.stringify({text,errors}));
      if(date==='2020-01-01'){assert.ok(text.includes('Archived guest'));assert.equal(await admin.locator('#tabel-corp-program .program-anulare').count(),0);}
    }
    await admin.keyboard.press('Escape');await admin.locator('[data-admin-program="Tenis"]').click();await admin.waitForLoadState('networkidle');
    assert.deepEqual(await admin.locator('#tabel-teren option').allTextContents(),['Court Tennis']);
    await admin.keyboard.press('Escape');await fits(admin,'#base-admin-workspace','sport-groups');
    pass('the selected base has direct editing and a live photo, sports list their courts immediately, and each sport opens its scoped schedule for any supported year');


    await admin.locator('#sectiune-dashboard .admin-menu-card').filter({hasText:'Rezervare Manuală'}).click();
    assert.equal(await admin.locator('#modal-terenuri').isVisible(),false,'Admin menu cards must not trigger the public sport picker');
    await admin.locator('#manual-client').fill('Invitat integrat');await admin.locator('#manual-data').fill(seeded.tomorrow);await admin.locator('#manual-ora').selectOption('15:00');await admin.locator('#manual-pret').fill('135 RON');
    await fits(admin,'#modal-rezervare-manuala .modal-continut','manual-booking');await admin.locator('#btn-rezervare-manuala').click();await admin.waitForFunction(()=>!document.getElementById('btn-rezervare-manuala').disabled);
    const manual=(await root(()=>pg.query("select * from public.rezervari where email_client='Invitat integrat'"))).rows;assert.equal(manual.length,1);assert.equal(manual[0].teren,'Court A');assert.equal(manual[0].client_user_id,null);
    await admin.keyboard.press('Escape');await admin.locator('#sectiune-dashboard .admin-menu-card').filter({hasText:'Program & Active'}).click();await admin.locator('#tabel-data').fill(seeded.tomorrow);await admin.evaluate(()=>window.incarcaTabelProgram());await admin.waitForLoadState('networkidle');
    assert.ok((await admin.locator('#tabel-corp-program').innerText()).includes('Invitat integrat'));
    const guestSlot=admin.locator('#tabel-corp-program tr').filter({hasText:'20:00'});
    assert.ok((await guestSlot.innerText()).includes(seeded.guestName));assert.ok((await guestSlot.innerText()).includes('+40733123456'));
    assert.ok(!(await guestSlot.innerText()).includes('Nume: Bob'));assert.equal(await guestSlot.locator('.btn-tabel-chat,img').count(),0);
    await fits(admin,'#modal-tabel-program .modal-continut','schedule');await admin.keyboard.press('Escape');
    pass('manual and guest bookings retain null ownership, guest name/phone are escaped and shown without borrowing an equal-email Auth profile or chat identity');

    await admin.locator('#sectiune-dashboard .admin-menu-card').filter({hasText:'Rezervări'}).click();await admin.locator('#btn-istoric').click();await admin.waitForFunction(()=>document.getElementById('container-istoric').textContent.includes('Completed guest'));
    const history=admin.locator('#container-istoric');assert.ok(!(await history.innerText()).includes('Archived guest'));assert.ok(!(await history.innerText()).includes('Court B'));assert.ok(!(await history.innerText()).includes('Court Excluded'));
    const completed=history.locator('.admin-history-card').filter({hasText:'Completed guest'});assert.ok((await completed.innerText()).includes('FINALIZATĂ'));assert.equal(await completed.locator('button').count(),0);
    const guestCard=history.locator('.admin-history-card').filter({hasText:seeded.guestName});
    assert.ok((await guestCard.innerText()).includes('+40733123456'));assert.ok(!(await guestCard.innerText()).includes('Nume: Bob'));assert.equal(await guestCard.locator('img').count(),0);
    const deniedCancel=await raw(admin,async id=>db.from('rezervari').update({stare:'anulata'}).eq('id',id).select('id'),seeded.past.id);assert.match(deniedCancel.error?.message||'',/Completed bookings cannot be cancelled/);
    assert.equal((await root(()=>pg.query('select stare from public.rezervari where id=$1',[seeded.past.id]))).rows[0].stare,'activa');
    const future=history.locator('.admin-history-card').filter({hasText:'Invitat integrat'});await future.locator('button').click();await admin.waitForFunction(()=>[...document.querySelectorAll('#container-istoric .admin-history-card')].some(card=>card.textContent.includes('Invitat integrat')&&card.textContent.includes('ANULATĂ')));
    assert.equal((await root(()=>pg.query('select stare from public.rezervari where id=$1',[manual[0].id]))).rows[0].stare,'anulata');
    await fits(admin,'#modal-istoric .modal-continut','history');await admin.keyboard.press('Escape');
    pass('history hides completed bookings older than 30 days without deleting them, respects the selected base, and keeps completed cancellations blocked in both UI and API');

    await admin.locator('#btn-vezi-chat-admin').click();await admin.locator('#chat-admin-lista-conversații .card-conversatie').waitFor({state:'visible'});
    assert.ok((await admin.locator('#chat-admin-lista-conversații').innerText()).includes('Mesaj Nord'));assert.ok(!(await admin.locator('#chat-admin-lista-conversații').innerText()).includes('Mesaj Sud'));
    await admin.locator('#chat-admin-lista-conversații .card-conversatie').click();await admin.locator('#chat-admin-input').fill('Răspuns din site');await admin.locator('#chat-admin-btn-trimite').click();await admin.waitForFunction(()=>!document.getElementById('chat-admin-input').disabled&&document.getElementById('chat-admin-input').value==='');
    const sent=(await root(()=>pg.query("select * from public.mesaje_chat where mesaj='Răspuns din site'"))).rows;assert.equal(sent.length,1);assert.equal(sent[0].teren,'Court A');assert.equal(sent[0].expeditor,'admin');
    // Realtime transport is deliberately offline in this disposable fixture;
    // reopening exercises the supported fresh SQL load of the sent message.
    await admin.keyboard.press('Escape');await admin.locator('#btn-vezi-chat-admin').click();await admin.locator('#chat-admin-lista-conversații .card-conversatie').click();await admin.waitForFunction(()=>document.getElementById('chat-admin-mesaje').textContent.includes('Răspuns din site'));
    await fits(admin,'#modal-chat-admin .modal-chat-box','chat');await admin.keyboard.press('Escape');
    pass('the existing chat filters conversations to the selected court and sends messages through actual RLS');

    await admin.keyboard.press('Escape');
    await admin.locator('#base-admin-workspace').waitFor({state:'hidden'});await admin.locator('#modal-profil').waitFor({state:'visible'});
    const beforeReopen=passwords();await admin.locator('#btn-administreaza-baza').click();await admin.locator('#base-admin-workspace').waitFor({state:'visible'});assert.equal(passwords(),beforeReopen);
    pass('Escape closes a nested screen first, returns to the profile from the workspace, and reopening keeps the signed-in session');

    const baseEditor=await pageFor();await baseEditor.goto(base,{waitUntil:'networkidle'});await login(baseEditor,'bob@example.test');await baseEditor.locator('#btn-administreaza-baza').click();await baseEditor.waitForLoadState('networkidle');
    assert.equal(await baseEditor.locator('#manual-teren option').count(),0);assert.equal(await baseEditor.locator('#container-meniu-terenuri .admin-court-card').count(),0);
    const editorAccess=await raw(baseEditor,async()=>(await db.rpc('get_admin_access')).data);assert.equal(editorAccess.can_manage,true);assert.deepEqual(editorAccess.courts,[]);assert.deepEqual(editorAccess.bases.map(b=>b.id),[ids.other]);
    const editorAttack=await raw(baseEditor,async()=>db.from('terenuri').update({pret:1}).eq('nume','Hidden Court').select('id'));assert.equal(editorAttack.data?.length||0,0);
    pass('description/photo-only grants open base settings without inventing court-management privileges');
    await root(()=>pg.query('delete from public.baze_sportive_admini where user_id=$1',[uid(2)]));await baseEditor.evaluate(()=>window.dispatchEvent(new Event('focus')));await baseEditor.locator('#base-admin-workspace').waitFor({state:'hidden'});
    const stale=await raw(baseEditor,async()=>({role:await db.from('users_admin').select('user_id'),access:await db.rpc('get_admin_access')}));
    assert.equal(stale.role.data.length,1);assert.equal(stale.access.data.can_manage,false);assert.equal(await baseEditor.locator('#btn-administreaza-baza').isVisible(),false);
    pass('a leftover administrator row with no real court or base grant does not expose the management entry');

    const restricted=await pageFor();await restricted.goto(base,{waitUntil:'networkidle'});await login(restricted,'admin@example.test');await restricted.locator('#btn-administreaza-baza').click();await restricted.locator('#base-admin-workspace').waitFor({state:'visible'});await restricted.waitForLoadState('networkidle');
    assert.equal(await restricted.locator('#base-admin-workspace.base-admin-super').count(),0);
    assert.equal(await restricted.locator('#sectiune-dashboard .super-admin-only:visible').count(),0);assert.equal(await restricted.locator('#btn-cereri-baze-admin').isVisible(),false);
    const restrictedAccess=await raw(restricted,async()=>({access:await db.rpc('get_admin_access'),applications:await db.from('cereri_baze_sportive').select('*'),court:await db.from('terenuri').update({pret:1}).eq('nume','Court Excluded').select('id')}));
    assert.equal(restrictedAccess.access.data.is_super,false);assert.equal(restrictedAccess.applications.data?.length||0,0);assert.equal(restrictedAccess.court.data?.length||0,0);
    const superPage=await pageFor();await superPage.goto(base,{waitUntil:'networkidle'});await login(superPage,'super@example.test');
    await superPage.locator('#btn-administreaza-baza').waitFor({state:'visible'});
    assert.equal(await superPage.locator('#btn-administreaza-baza').innerText(),'Deschide panoul de admin');
    const superLogins=passwords(),superURL=superPage.url(),superToken=await superPage.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),superPages=superPage.context().pages().length;
    await superPage.locator('#btn-administreaza-baza').click();await superPage.locator('#base-admin-workspace.base-admin-super').waitFor({state:'visible'});await superPage.waitForLoadState('networkidle');
    await superPage.locator('#btn-cereri-baze-admin').waitFor({state:'visible'});
    assert.equal(await superPage.locator('#base-admin-select').isVisible(),false);
    assert.equal(await superPage.locator('#base-admin-base-card').isVisible(),false);
    assert.equal(await superPage.locator('#btn-baze-admin').isVisible(),true);
    assert.equal(await superPage.locator('iframe').count(),0);assert.equal(superPage.context().pages().length,superPages);assert.equal(superPage.url(),superURL);
    assert.equal(passwords(),superLogins);assert.equal(await superPage.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),superToken);
    const globalAccess=await raw(superPage,async()=>(await db.rpc('get_admin_access')).data);assert.equal(globalAccess.is_super,true);assert.ok(globalAccess.courts.some(c=>c.nume==='Court Excluded'));
    await fits(superPage,'#base-admin-workspace','superadmin-dashboard');
    pass('superadmin opens the complete global dashboard from the primary site session with no navigation, new window, iframe or second password');

    await superPage.locator('#container-meniu-terenuri .admin-city-card').filter({hasText:'Cluj-Napoca'}).click();
    await superPage.locator('.sub-pagina-oras').filter({hasText:'Setări Cluj-Napoca'}).waitFor({state:'visible'});
    const excludedCourt=(await root(()=>pg.query("select * from public.terenuri where nume='Court Excluded'"))).rows[0];
    await superPage.locator('.sub-pagina-oras:visible .admin-court-card').filter({hasText:'Court Excluded'}).click();
    await superPage.locator(`#pret-${excludedCourt.id}`).fill('95');await superPage.locator(`#btn-save-${excludedCourt.id}`).click();await superPage.waitForLoadState('networkidle');
    assert.equal(Number((await root(()=>pg.query('select pret from public.terenuri where id=$1',[excludedCourt.id]))).rows[0].pret),95);
    assert.ok(await superPage.locator('#container-meniu-terenuri .admin-city-card').count());
    await superPage.locator('#sectiune-dashboard .admin-menu-card').filter({hasText:'Program & Active'}).click();await superPage.waitForLoadState('networkidle');
    assert.ok((await superPage.locator('#tabel-teren option').allTextContents()).includes('Court Excluded'));assert.ok((await superPage.locator('#tabel-teren option').allTextContents()).includes('Court B'));
    await superPage.keyboard.press('Escape');
    await superPage.locator('#sectiune-dashboard .admin-menu-card').filter({hasText:'Rezervări'}).click();await superPage.locator('#btn-istoric').click();await superPage.waitForFunction(()=>document.getElementById('container-istoric').textContent.includes('Court Excluded'));
    assert.ok((await superPage.locator('#container-istoric').innerText()).includes('Court Excluded'));assert.ok((await superPage.locator('#container-istoric').innerText()).includes('Court B'));
    await superPage.keyboard.press('Escape');await superPage.locator('#btn-vezi-chat-admin').click();await superPage.waitForFunction(()=>document.getElementById('chat-admin-lista-conversații').textContent.includes('Mesaj privat străin'));
    assert.ok((await superPage.locator('#chat-admin-lista-conversații').innerText()).includes('Mesaj privat străin'));assert.ok((await superPage.locator('#chat-admin-lista-conversații').innerText()).includes('Mesaj Sud'));
    await superPage.keyboard.press('Escape');
    pass('same-page superadmin preserves global city/court editing, the full schedule, all booking contact details and global chat');

    await root(()=>pg.query("insert into auth.users(id,email,email_confirmed_at) values($1,'employee@example.test',now())",[uid(77)]));
    await superPage.locator('#sectiune-dashboard .super-admin-only').filter({hasText:'Creare Angajat'}).click();
    await superPage.locator('#super-nume').fill('Angajat nou');await superPage.locator('#super-email').fill('employee@example.test');
    await superPage.locator('.check-teren-alocat[value="Court A2"]').check();
    await fits(superPage,'#modal-creeaza-cont .modal-continut','superadmin-allocation');
    await superPage.locator('#creeaza-supervisor-btn').click();await superPage.locator('#modal-creeaza-cont').waitFor({state:'hidden'});
    const employee=(await root(()=>pg.query('select is_super,terenuri from public.users_admin where user_id=$1',[uid(77)]))).rows[0];assert.equal(employee.is_super,false);assert.equal(employee.terenuri,'Court A2');
    pass('the integrated global allocation form assigns an existing Auth account only the explicitly selected courts');

    await superPage.locator('#btn-baze-admin').click();await superPage.locator('#btn-baza-noua').click();
    await superPage.locator('#baza-nume').fill('Baza nouă superadmin');await superPage.locator('#baza-oras').fill('Oradea');await superPage.locator('#baza-descriere').fill('Creată în site, cu panoul complet');await superPage.locator('#baza-activa').check();
    await fits(superPage,'#modal-baze-admin .modal-continut','superadmin-base');
    await superPage.locator('#btn-salveaza-baza').click();await superPage.locator('#admin-baza-form').waitFor({state:'hidden'});await superPage.waitForLoadState('networkidle');
    const createdBase=(await root(()=>pg.query("select * from public.baze_sportive where nume='Baza nouă superadmin'"))).rows[0];assert.ok(createdBase);
    await superPage.locator(`[data-edit-base="${createdBase.id}"]`).click();
    assert.equal(await superPage.locator('#admin-baza-structura').isVisible(),true);assert.equal(await superPage.locator('#admin-baza-terenuri-section').isVisible(),true);assert.equal(await superPage.locator('#admin-baza-admini-section').isVisible(),true);
    await superPage.locator('#baza-poza-file').setInputFiles({name:'super-base.png',mimeType:'image/png',buffer:png});await superPage.waitForFunction(()=>!document.getElementById('btn-baza-poza-save').disabled);
    await superPage.locator('#btn-baza-poza-save').click();await superPage.waitForFunction(()=>document.getElementById('admin-baza-photo-status').textContent.includes('salvată'));
    const superBasePhoto=(await root(()=>pg.query('select poza from public.baze_sportive where id=$1',[createdBase.id]))).rows[0].poza;assert.match(superBasePhoto,new RegExp('^'+createdBase.id+'/'));assert.ok(fixture.objects.get('poze_baze_sportive/'+superBasePhoto).body.equals(png));
    await superPage.locator(`[data-base-admin-id="${uid(77)}"]`).check();await superPage.locator('#btn-salveaza-baza').click();await superPage.locator('#admin-baza-form').waitFor({state:'hidden'});
    assert.equal((await root(()=>pg.query('select count(*)::int n from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[createdBase.id,uid(77)]))).rows[0].n,1);
    await superPage.locator('#btn-inchide-baze-admin').click();
    pass('global base creation and permission management retain the complete existing forms and include freshly created bases');

    await superPage.locator('#sectiune-dashboard .super-admin-only').filter({hasText:'Adaugă Teren'}).click();
    await superPage.locator('#teren-nume').fill('Teren temporar complet');await superPage.locator('#teren-sport').selectOption('Baschet');await superPage.locator('#teren-oras').fill('Oradea');await superPage.locator('#teren-baza').selectOption(createdBase.id);await superPage.locator('#teren-pret').fill('180');await superPage.locator('#teren-locatie').fill('https://maps.app.goo.gl/TemporaryCourt');
    await superPage.locator('#teren-poza').setInputFiles({name:'global-court.png',mimeType:'image/png',buffer:png});
    await fits(superPage,'#modal-adauga-teren .modal-continut','superadmin-create-court');
    await superPage.locator('#btn-adauga-teren').click();await superPage.locator('#modal-adauga-teren').waitFor({state:'hidden'});await superPage.waitForLoadState('networkidle');
    const temporary=(await root(()=>pg.query("select * from public.terenuri where nume='Teren temporar complet'"))).rows[0];assert.equal(temporary.baza_sportiva_id,createdBase.id);assert.equal(Number(temporary.pret),180);assert.match(temporary.poza,new RegExp('/poze_terenuri/'+uid(4)+'/'));
    await superPage.locator('#container-meniu-terenuri .admin-city-card').filter({hasText:'Oradea'}).click();await superPage.locator('.sub-pagina-oras:visible .admin-court-card').filter({hasText:'Teren temporar complet'}).click();
    await superPage.locator(`#modal-setari-${temporary.id} button`).filter({hasText:'Șterge Terenul'}).click();await superPage.locator(`#modal-setari-${temporary.id}`).waitFor({state:'hidden'});await superPage.waitForFunction(id=>!document.getElementById('modal-setari-'+id),temporary.id);
    assert.equal((await root(()=>pg.query('select count(*)::int n from public.terenuri where id=$1',[temporary.id]))).rows[0].n,0);assert.equal(await superPage.locator(`#modal-setari-${temporary.id}`).count(),0);
    assert.equal(await superPage.locator('#container-meniu-terenuri .admin-city-card').filter({hasText:'Oradea'}).count(),0);
    pass('same-page superadmin creates a court with its base, tariff and photograph, then deletes it with both confirmations and an immediately refreshed dashboard');

    const appId='10000000-0000-4000-8000-000000000001',form=new FormData();form.set('payload',JSON.stringify({action:'submit',request_id:appId,nume_baza:'Baza aprobată automat',nume_contact:'Alice Contact',email:'alice@example.test',telefon:'+40722123456',oras:'Cluj-Napoca',adresa:'Strada Sportului 12',link_maps:'https://maps.app.goo.gl/FixtureClub',terenuri:[{nume:'Teren nou',sport:'Fotbal'}],prices:[150],descriere:'Cerere reală în baza izolată',password:'fixture-password'}));
    const response=await fixture.serial(()=>edge(new Request(`https://${host}/functions/v1/club-applications`,{method:'POST',body:form})));assert.equal(response.status,201,await response.text());
    const normalToken=await normal.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),beforeApprovalLogins=passwords();
    await superPage.locator('#btn-cereri-baze-admin').click();await superPage.locator(`[data-club-request-id="${appId}"]`).click();await superPage.locator('#admin-cerere-detail').waitFor({state:'visible'});await fits(superPage,'#modal-cereri-baze-admin .modal-continut','superadmin-request');await superPage.locator('#admin-cerere-approve').click();await superPage.locator('#admin-cerere-confirm-submit').click();await superPage.waitForFunction(()=>document.getElementById('admin-cerere-decision-status').textContent.includes('Bază publicată'));
    // Normal focus/profile lifecycle refreshes the already signed-in applicant.
    await normal.evaluate(()=>window.dispatchEvent(new Event('focus')));await normal.locator('#btn-administreaza-baza').waitFor({state:'visible'});
    await normal.locator('#btn-administreaza-baza').click();await normal.waitForLoadState('networkidle');
    assert.equal(passwords(),beforeApprovalLogins);assert.equal(await normal.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),normalToken);
    const approved=(await fixture.rows()).find(r=>r.id===appId);assert.equal(approved.stare,'acceptata');assert.equal(await normal.locator('#base-admin-select').inputValue(),approved.approved_base_id);
    const approvedAccess=await raw(normal,async()=>(await db.rpc('get_admin_access')).data);assert.equal(approvedAccess.is_super,false);assert.equal(approvedAccess.courts.length,1);assert.equal(approvedAccess.bases.length,1);
    const approvalAttack=await raw(normal,async()=>db.from('terenuri').update({pret:1}).eq('nume','Court A').select('id'));assert.equal(approvalAttack.data?.length||0,0);
    pass('real superadmin approval automatically unlocks the signed-in applicant with the existing session and exactly the approved base/courts');

    await admin.locator(`[data-admin-court="${seeded.courtA.id}"]`).click();await admin.locator(`#poza-${seeded.courtA.id}`).setInputFiles({name:'must-not-upload.png',mimeType:'image/png',buffer:png});
    const uploadGate=fixture.pauseNext('/auth/v1/user','GET');await admin.locator(`#btn-save-${seeded.courtA.id}`).click();await uploadGate.entered;
    const beforeStaleWrites=requests.filter(r=>r.source==='browser'&&(r.path.startsWith('/storage/v1/object/')&&r.method==='POST'||r.path==='/rest/v1/terenuri'&&r.method==='PATCH')).length;
    await root(()=>pg.query('delete from public.users_admin where user_id=$1',[uid(3)]));
    await admin.evaluate(()=>window.dispatchEvent(new Event('focus')));await admin.locator('#base-admin-workspace').waitFor({state:'hidden'});assert.equal(await admin.locator('#btn-administreaza-baza').isVisible(),false);
    uploadGate.release();await admin.waitForFunction(()=>document.getElementById('manual-teren').options.length===0);await admin.waitForLoadState('networkidle');
    assert.equal(requests.filter(r=>r.source==='browser'&&(r.path.startsWith('/storage/v1/object/')&&r.method==='POST'||r.path==='/rest/v1/terenuri'&&r.method==='PATCH')).length,beforeStaleWrites);
    pass('revocation during a pending court-photo Auth check prevents the stale upload and court update');
    const revoked=await raw(admin,async()=>({access:await db.rpc('get_admin_access'),court:await db.from('terenuri').update({pret:1}).eq('nume','Court A').select('id'),bookings:await db.from('rezervari').select('*'),chat:await db.from('mesaje_chat').select('*')}));
    assert.equal(revoked.access.data.can_manage,false);assert.equal(revoked.court.data?.length||0,0);assert.equal(revoked.bookings.data?.length||0,0);assert.equal(revoked.chat.data?.length||0,0);
    assert.equal(await admin.locator('#container-istoric').innerText(),'');assert.equal(await admin.locator('#chat-admin-lista-conversații').innerText(),'');assert.equal(await admin.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),token);
    pass('revoking grants closes and clears the workspace, and the same still-valid JWT immediately loses server-side access');
    if(await superPage.locator('#modal-cereri-baze-admin').isVisible())await superPage.locator('#admin-cereri-close').click();
    await superPage.locator('#btn-cereri-baze-admin').click();await superPage.locator(`[data-club-request-id="${appId}"]`).click();await superPage.locator('#admin-cerere-detail').waitFor({state:'visible'});
    await root(()=>pg.query("update public.users_admin set is_super=false,terenuri='Court B' where user_id=$1",[uid(4)]));
    await superPage.evaluate(()=>window.dispatchEvent(new Event('focus')));await superPage.waitForFunction(()=>!document.getElementById('base-admin-workspace').classList.contains('base-admin-super'));
    await superPage.waitForLoadState('networkidle');assert.equal(await superPage.locator('#btn-administreaza-baza').innerText(),'Administrează baza sportivă');
    assert.equal(await superPage.locator('#btn-cereri-baze-admin').isVisible(),false);assert.equal(await superPage.locator('#admin-cerere-data').innerText(),'');assert.equal(await superPage.locator('#admin-cerere-photo').getAttribute('src'),null);
    assert.equal(await superPage.locator('#modal-cereri-baze-admin').isVisible(),false);assert.equal(await superPage.locator('#btn-baze-admin').isVisible(),false);
    assert.equal(await superPage.locator('#sectiune-dashboard .super-admin-only:visible').count(),0);
    const afterDemotion=await raw(superPage,async()=>({access:await db.rpc('get_admin_access'),private:await db.from('cereri_baze_sportive').select('*'),court:await db.from('terenuri').update({pret:1}).eq('nume','Court Excluded').select('id')}));
    assert.equal(afterDemotion.access.data.is_super,false);assert.equal(afterDemotion.private.data?.length||0,0);assert.equal(afterDemotion.court.data?.length||0,0);
    assert.equal(await superPage.evaluate(async()=>(await db.auth.getSession()).data.session.access_token),superToken);
    pass('demoting superadmin in the same active session removes every global tool and clears private application data while server RLS immediately limits the account to its remaining court');
    assert.deepEqual(errors,[]);assert.ok(!requests.some(r=>r.source==='browser'&&r.service));
    assert.equal((await root(()=>pg.query("select count(*)::int n from public.terenuri where nume in ('Court A','Court B','Hidden Court','Court Excluded')"))).rows[0].n,4);
    console.log(`${checks} integrated admin browser checks passed`);
  }finally{if(browser)await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
