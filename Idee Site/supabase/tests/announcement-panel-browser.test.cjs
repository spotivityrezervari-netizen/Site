// Production UI + real disposable PostgreSQL RPCs. All external traffic is blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {readFileSync,mkdirSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {fixture,uid,clientKey}=require('./announcement-panel.test.cjs');
const root=resolve(__dirname,'../..');
const out=process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
(async()=>{
 const f=await fixture();let browser,server;
 try{
  server=createServer((req,res)=>{
   const path=new URL(req.url,'http://local').pathname;
   if(path==='/ui'){res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head>${['style','theme','admin','admin-theme','base-admin','admin-announcements'].map(n=>`<link rel="stylesheet" href="/css/${n}.css">`).join('')}</head><body class="pagina-publica"><div id="base-admin-workspace" class="base-admin-workspace"><div class="base-admin-panel"><div class="base-admin-tools"></div></div></div></body></html>`);return;}
   if(!/^\/css\/[a-z-]+\.css$/.test(path)){res.writeHead(404);res.end();return;}
   res.setHeader('content-type','text/css');res.end(readFileSync(join(root,path)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  const image=readFileSync(join(root,'assets/imagini/TenisVFinal.jpg'));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin===base)return route.continue();
   if(url.origin==='https://ndubcdwohqzgxpuiowye.supabase.co'&&url.pathname.startsWith('/storage/v1/object/public/announcement_images/'))return route.fulfill({status:200,contentType:'image/jpeg',body:image});
   return route.abort();
  });
  let person=4,deferred=false,pendingResolve;
  const types={admin_announcement_preview:['uuid','text','text','text','text'],admin_announcement_send:['uuid','integer','text'],admin_announcement_history:['timestamptz','uuid'],admin_announcement_cancel:['uuid']};
  const args={admin_announcement_preview:['p_campaign_id','p_audience','p_subject','p_message','p_image_path'],admin_announcement_send:['p_campaign_id','p_expected_count','p_fingerprint'],admin_announcement_history:['p_before','p_before_id'],admin_announcement_cancel:['p_campaign_id']};
  await page.exposeFunction('panelRPC',async(name,input)=>{
   assert.ok(types[name]);calls.push({name,args:input,person});
   if(deferred&&name==='admin_announcement_history'){deferred=false;return new Promise(resolve=>pendingResolve=resolve);}
   try{
    const result=await f.as(person,`select public.${name}(${types[name].map((t,i)=>'$'+(i+1)+'::'+t).join(',')}) v`,args[name].map(k=>input[k]??null));
    return {data:result.rows[0].v,error:null};
   }catch(e){return {data:null,error:{code:e.code,message:'Fixture RPC refused'}};}
  });
  await page.exposeFunction('panelUpload',async(path,size,mime)=>{
   try{await f.as(person,"insert into storage.objects(bucket_id,name,metadata)values('announcement_images',$1,$2::jsonb)",[path,JSON.stringify({size,mimetype:mime})]);return {data:{path},error:null};}
   catch(e){return {data:null,error:{statusCode:e.code==='23505'?409:400}};}
  });
  await page.goto(base+'/ui');
  await page.addScriptTag({path:join(root,'js/admin-announcements.js')});
  await page.evaluate(()=>createAnnouncementPanel({rpc:(name,args)=>panelRPC(name,args),storage:{from:()=>({upload:(path,file)=>panelUpload(path,file.size,file.type)})}}));
  const role=async(superadmin=true,user=4)=>page.evaluate(({superadmin,id})=>dispatchEvent(new CustomEvent('spotivity:admin-role',{detail:{isSuper:superadmin,userId:id}})),{superadmin,id:uid(user)});
  assert.equal(await page.locator('#btn-admin-announcements').isVisible(),false);
  await role(false,3);assert.equal(await page.locator('#btn-admin-announcements').isVisible(),false);assert.equal(calls.length,0);
  await role();await page.locator('#btn-admin-announcements').click();
  await page.waitForFunction(()=>document.querySelector('#ann-transport').textContent.includes('indisponibilă'));
  await page.locator('#ann-subject').fill('<img src=x onerror="window.attacked=true">');
  await page.locator('#ann-message').fill('Anunț pentru clienți.\nText cu diacritice și <script> literal.');
  await page.locator('#ann-preview').click();await page.locator('#ann-review').waitFor({state:'visible'});
  assert.match(await page.locator('#ann-count').innerText(),/^2 clienți/);assert.equal(await page.locator('#ann-send').isEnabled(),false);
  assert.equal(await page.locator('#ann-email-subject img').count(),0);assert.equal(await page.evaluate(()=>window.attacked),undefined);
  assert.equal((await f.root('select count(*) n from net.test_requests')).rows[0].n,0);
  console.log('PASS only superadmin sees composer; plain text safely rendered; preview queues no email');
  await f.root('update spotivity_private.announcement_panel_config set ready=true');
  await f.root("update spotivity_private.notification_config set ready=true,booking_webhook_url='https://hook.eu1.make.com/fixtureWebhook123456789'");
  await page.locator('#ann-message').fill('Anunț cu imagine pentru clienți.\nA doua linie.');
  assert.equal(await page.locator('#ann-review').isVisible(),false);
  await page.locator('#ann-image').setInputFiles(join(root,'assets/imagini/TenisVFinal.jpg'));
  await page.locator('#ann-preview').click();await page.locator('#ann-review').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#ann-transport').textContent.includes('disponibilă.'));
  await page.locator('#ann-email-image').evaluate(img=>img.decode());
  for(const width of[320,390,768,1280]){
   await page.setViewportSize({width,height:844});
   await page.locator('#ann-review').scrollIntoViewIfNeeded();
   const geometry=await page.locator('.announcements-panel').evaluate(panel=>{
    const p=panel.getBoundingClientRect(),i=panel.querySelector('#ann-email-image').getBoundingClientRect();
    return{left:p.left,right:p.right,page:document.documentElement.scrollWidth,viewport:innerWidth,imgWidth:i.width,imgHeight:i.height};
   });
   assert.ok(geometry.left>=-1&&geometry.right<=width+1&&geometry.page<=width+1,JSON.stringify(geometry));
   assert.ok(Math.abs(geometry.imgWidth/geometry.imgHeight-1920/1311)<.01,JSON.stringify(geometry));
   if(out){mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,`announcement-panel-${width}.png`)});}
  }
  assert.equal(await page.locator('#ann-send').isEnabled(),false);await page.locator('#ann-confirm').check();assert.equal(await page.locator('#ann-send').isEnabled(),true);
  await page.locator('#ann-send').click();await page.waitForFunction(()=>document.querySelector('#ann-status').textContent.includes('pus în coadă'));
  assert.equal((await f.root('select count(*) n from net.test_requests')).rows[0].n,1);
  assert.equal(calls.filter(c=>c.name==='admin_announcement_send').length,1);
  console.log('PASS responsive JPEG preserves proportions at320/390/768/1280px; explicit confirmation queues one immutable campaign');
  const campaign=(await f.history()).campaigns[0];const pending=(await f.pending(campaign)).recipients;
  await f.claim(campaign,pending[0].recipient_id,clientKey);
  await page.locator('#ann-refresh').click();await page.waitForFunction(()=>document.querySelector('#ann-history-list').textContent.includes('rezultat incert: 1'));
  assert.equal((await f.pending(campaign)).recipients.length,1);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Oprește destinatarii rămași'}).first().click();
  await page.waitForFunction(()=>document.querySelector('#ann-history-list').textContent.includes('Oprit.'));
  assert.equal((await f.pending(campaign)).recipients.length,0);
  console.log('PASS history distinguishes uncertain acceptance and cancellation never resets a claimed recipient');
  // Actual SQL role changes remain authoritative, even if a stale UI event claims superadmin.
  await page.locator('#ann-close').click();person=3;await role(true,3);await page.locator('#btn-admin-announcements').click();
  await page.waitForFunction(()=>document.querySelector('#modal-admin-announcements').style.display==='none');
  assert.equal(await page.locator('#btn-admin-announcements').isVisible(),false);assert.equal(await page.locator('#ann-email-message').textContent(),'');
  person=4;await role();await page.locator('#btn-admin-announcements').click();await page.waitForFunction(()=>document.querySelector('#ann-transport').textContent.includes('disponibilă.'));
  deferred=true;await page.locator('#ann-refresh').click();await page.waitForTimeout(30);assert.ok(pendingResolve);
  await page.evaluate(()=>dispatchEvent(new Event('spotivity:admin-clear')));pendingResolve({data:{ready:true,campaigns:[campaign]},error:null});await page.waitForTimeout(50);
  assert.equal(await page.locator('#modal-admin-announcements').isVisible(),false);assert.equal(await page.locator('#ann-history-list').textContent(),'');
  assert.equal(await page.locator('#ann-subject').inputValue(),'');assert.deepEqual(errors,[]);
  console.log('PASS authoritative SQL access refusal and late private responses are cleared on role loss/logout; no external requests or real emails');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await f.pg.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
