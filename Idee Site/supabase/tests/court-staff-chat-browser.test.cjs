// Full production UI/SDK against disposable PostgreSQL; every Supabase request is intercepted.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const {createFixture,uid,host}=require('./club-request-fixture.cjs');
const {servePublicArtifact}=require('./public-artifact-server.cjs');
const source=join(__dirname,'..');
(async()=>{
 const f=await createFixture(),site=await servePublicArtifact({directory:resolve(__dirname,'../../../dist')});let browser;
 try{
  for(const name of ['029_manual_announcement_campaigns.sql','030_superadmin_announcement_panel.sql','032_court_staff_chat.sql'])await f.root(()=>f.pg.exec(readFileSync(join(source,name),'utf8')));
  const day=await f.root(async()=>{
   await f.pg.query("update public.clienti set telefon='0712345678'");
   const d=(await f.pg.query("select ((now() at time zone 'Europe/Bucharest')::date+3)::text d")).rows[0].d;
   const court=(await f.pg.query("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
   await f.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(1)]);await f.pg.exec('set role authenticated');
   await f.pg.query('select public.create_booking_group($1,$2,$3::date,$4::text[],false,100)',[uid(32010),court,d,['12:00']]);
   await f.pg.query("insert into public.mesaje_chat(email_client,teren,expeditor,mesaj)values('alice@example.test','Court A','client','Mesaj privat pentru administratorul terenului')");
   return d;
  });
  const html=readFileSync(join(source,'../index.html'),'utf8');
  const tag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);assert.ok(tag);
  const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',tag[1]],{maxBuffer:2*1024*1024});
  assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),tag[2]);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
  const errors=[];let hold=false,enteredResolve,releaseResolve;
  async function pageFor(){
   const ctx=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Europe/Bucharest'});
   await ctx.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.url()===tag[1])return route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}});
    if(url.hostname===host){
     if(url.pathname==='/auth/v1/settings')return route.fulfill({status:200,contentType:'application/json',body:'{"external":{"google":false}}',headers:{'access-control-allow-origin':'*'}});
     if(hold&&request.method()==='GET'&&url.pathname==='/rest/v1/mesaje_chat'&&!url.searchParams.has('client_user_id')){
      hold=false;
      const response=await f.serial(()=>f.transport(new Request(request.url(),{method:request.method(),headers:request.headers()}),{},'browser'));
      enteredResolve();await new Promise(resolve=>releaseResolve=resolve);
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
     }
     return f.browserRoute(route);
    }
    if(url.origin===new URL(site.url).origin)return route.continue();
    return route.abort();
   });
   await ctx.routeWebSocket(url=>url.hostname===host,s=>s.close());
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(site.url,{waitUntil:'networkidle'});
   await page.evaluate(()=>{
    window.adminChatChannels=[];window.removedAdminChatChannels=[];
    const original=db.channel.bind(db),remove=db.removeChannel.bind(db);
    db.channel=(name,...rest)=>{if(name.startsWith('mesaje_chat_admin_'))adminChatChannels.push(name);return original(name,...rest);};
    db.removeChannel=channel=>{if(channel.topic.includes('mesaje_chat_admin_'))removedAdminChatChannels.push(channel.topic);return remove(channel);};
   });
   return page;
  }
  async function login(page,email){
   const result=await page.evaluate(async email=>{const r=await db.auth.signInWithPassword({email,password:'fixture-password'});return {error:r.error?.message};},email);assert.equal(result.error,undefined);
   await page.waitForFunction(email=>window.getSpotivityProfileUser?.()?.email===email,email);
   await page.waitForLoadState('networkidle');
  }
  const adminReads=()=>f.requests.filter(r=>r.path==='/rest/v1/mesaje_chat'&&r.method==='GET'&&!new URLSearchParams(r.search).has('client_user_id'));
  const sup=await pageFor();const baseline=adminReads().length;
  await login(sup,'super@example.test');await sup.evaluate(()=>openSpotivityAdminWorkspace());await sup.locator('#sectiune-dashboard').waitFor({state:'visible'});
  assert.equal(await sup.locator('#btn-vezi-chat-admin').isVisible(),false);assert.equal(await sup.evaluate(()=>adminChatChannels.length),0);
  await sup.evaluate(()=>{document.getElementById('btn-vezi-chat-admin').click();deschideChatDinTabel('alice@example.test','Court A','Alice');});
  assert.equal(await sup.locator('#modal-chat-admin').isVisible(),false);assert.equal(adminReads().length,baseline);
  await sup.evaluate(async d=>{initializeazaTabel(['Court A']);document.getElementById('tabel-data').value=d;await incarcaTabelProgram();},day);
  await sup.waitForFunction(()=>document.querySelector('#tabel-corp-program').textContent.includes('alice@example.test'));
  assert.equal(await sup.locator('.btn-tabel-chat').count(),0);
  console.log('PASS superadmin has no chat entry, administrative reads, realtime subscription or schedule chat links; booking controls remain');
  if(process.env.SPOTIVITY_TEST_SCREENSHOT_DIR){mkdirSync(process.env.SPOTIVITY_TEST_SCREENSHOT_DIR,{recursive:true});await sup.screenshot({path:join(process.env.SPOTIVITY_TEST_SCREENSHOT_DIR,'superadmin-no-chat.png')});}
  const staff=await pageFor();await login(staff,'admin@example.test');
  const opened=await staff.evaluate(()=>openSpotivityOwnerHomeAction('chat'));assert.equal(opened,true);
  await staff.locator('#modal-chat-admin').waitFor({state:'visible'});await staff.locator('#chat-admin-lista-conversații .card-conversatie').filter({hasText:'Court A'}).first().click();
  await staff.locator('#chat-admin-mesaje .mesaj-bula').waitFor();
  assert.match(await staff.locator('#chat-admin-mesaje').innerText(),/Mesaj privat/);assert.equal(await staff.evaluate(()=>canUseSpotivityAdminChat('Court A')),true);
  assert.equal(await staff.evaluate(()=>deschideChatDinTabel('bob@example.test','Court B','Bob')),false);
  await staff.locator('#chat-admin-input').fill('Răspuns autorizat');await staff.locator('#chat-admin-btn-trimite').click();
  await staff.waitForFunction(()=>document.querySelector('#chat-admin-input').value==='');
  const saved=await f.root(()=>f.pg.query("select count(*)::integer n from public.mesaje_chat where mesaj='Răspuns autorizat' and expeditor='admin'"));assert.equal(saved.rows[0].n,1);
  console.log('PASS allocated administrator reads/replies only for assigned courts using actual SDK and SQL RLS');
  await staff.locator('#chat-admin-input').fill('Draft care nu trebuie păstrat pentru superadmin');
  const entered=new Promise(resolve=>enteredResolve=resolve);hold=true;
  await staff.evaluate(()=>document.getElementById('btn-vezi-chat-admin').click());await entered;
  await f.root(()=>f.pg.query('update public.users_admin set is_super=true where user_id=$1',[uid(3)]));
  await staff.evaluate(()=>refreshSpotivityAdminAccess({force:true}));
  await staff.waitForFunction(()=>document.getElementById('btn-vezi-chat-admin').hidden);
  releaseResolve();await staff.waitForTimeout(150);
  assert.equal(await staff.locator('#modal-chat-admin').isVisible(),false);assert.equal(await staff.locator('#chat-admin-input').inputValue(),'');
  assert.equal(await staff.locator('#chat-admin-mesaje').textContent(),'');assert.equal(await staff.locator('#bulina-chat-admin').isVisible(),false);
  assert.ok(await staff.evaluate(()=>removedAdminChatChannels.length>0));assert.equal(await staff.evaluate(()=>canUseSpotivityAdminChat('Court A')),false);
  console.log('PASS promotion to superadmin clears drafts/badges, removes realtime and drops a delayed private response');
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await site.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
