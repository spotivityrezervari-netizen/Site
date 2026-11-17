// The production module and pinned SDK run in Chromium with every HTTP request
// intercepted. No hosted accounts, messages, realtime connections or email.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {join}=require('node:path');
const {chromium}=require('playwright');
const source=join(__dirname,'../../js');
const tag=readFileSync(join(source,'../index.html'),'utf8').match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
assert.ok(tag);
const sdk=process.env.SPOTIVITY_SUPABASE_SDK_FILE
 ?readFileSync(process.env.SPOTIVITY_SUPABASE_SDK_FILE)
 :execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',tag[1]],{maxBuffer:2*1024*1024});
assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),tag[2]);

async function withChat(fn){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 const held=[],inserts=[],errors=[];
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname!=='chat-project.test')return route.abort();
   const reply=data=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
   if(request.method()==='POST'){
    inserts.push(request.postDataJSON());
    const result=await new Promise(resolve=>held.push(resolve));
    if(result==='offline')return route.abort('failed');
    return reply([]);
   }
   let data=[];
   if(url.pathname.endsWith('/rezervari')){
    data=['Court A','Court B'].map((teren,i)=>({id:String(i+1),teren,data_str:'2099-01-03',ora:'12:00',timestamp_start:Date.now()+86400000}));
    const court=url.searchParams.get('teren');if(court)data=data.filter(row=>court==='eq.'+row.teren);
   }
   if(url.pathname.endsWith('/terenuri'))data=['Court A','Court B'].map((nume,i)=>({id:i+1,nume,are_chat:true}));
   const offset=Number(url.searchParams.get('offset')||0);return reply(data.slice(offset,offset+500));
  });
  await page.setContent(`<div id="modal-chat-client" style="display:flex"><div class="modal-chat-box"></div></div>
   <button id="btn-vezi-chat"></button><button id="inchide-chat-client"></button>
   <input id="chat-client-input"><button id="chat-client-btn-trimite"></button>
   <div id="chat-client-avertisment"></div><div id="bulina-chat-client"></div>
   <div id="chat-client-lista-terenuri"></div><div id="chat-client-teren-titlu"></div>
   <div id="chat-client-mesaje"></div><div id="modal-profil"></div>`);
  await page.addScriptTag({content:sdk.toString()});
  await page.addScriptTag({path:join(source,'security.js')});
  await page.addScriptTag({path:join(source,'modules/public-chat.js')});
  await page.evaluate(()=>{
   window.pendingChatWrites=0;
   const db=supabase.createClient('https://chat-project.test','public-fixture-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(input,options)=>{
     const writing=options?.method==='POST';if(writing)pendingChatWrites++;
     try{return await fetch(input,options)}finally{if(writing)pendingChatWrites--}
    }}
   });
   // Deliver the same postgres_changes callback without a network subscription.
   db.channel=()=>({on(kind,filter,callback){window.chatRealtime=callback;return this},subscribe(){return this}});
   db.removeChannel=async()=>{};
   window.permissionChecks=0;window.esteRezervareTrecuta=()=>{permissionChecks++;return false};
   window.alerts=[];window.alert=message=>alerts.push(message);
   window.chatState={user:{id:'first-client',email:'first@example.test'}};
   window.chat=SpotivityModules.publicChat({db,state:chatState,services:{bookings:{invalidate(){}},history:{invalidate(){}}}});
   chat.mount();
  });
  await page.waitForFunction(()=>window.chatRealtime);
  await page.evaluate(()=>chat.selectCourt('Court A'));
  const input=page.locator('#chat-client-input'),send=page.locator('#chat-client-btn-trimite');
  const refresh=async()=>{
   const checks=await page.evaluate(()=>permissionChecks);
   await page.evaluate(()=>chatRealtime({new:{expeditor:'admin',citit:true}}));
   await page.waitForFunction(checks=>permissionChecks>checks,checks);
  };
  const start=async text=>{
   await input.fill(text);await send.click();
   await page.waitForFunction(()=>document.querySelector('#chat-client-input').disabled);
   // Await entry into the intercepted SDK insert, not just the permission read.
   await waitUntil(()=>held.length>0);
  };
  await fn({page,input,send,inserts,held,refresh,start});
  assert.deepEqual(errors,[]);
 }finally{held.splice(0).forEach(resolve=>resolve());await browser.close()}
}
async function waitUntil(predicate){
 const until=Date.now()+5000;
 while(!predicate()){
  if(Date.now()>until)throw new Error('Timed out waiting for intercepted insert');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
}

test('realtime permission refresh keeps a pending client message locked and Enter cannot insert a duplicate',()=>withChat(async({page,input,send,inserts,held,refresh,start})=>{
 await start('Exactly one message');
 await refresh();
 assert.equal(await input.isDisabled(),true);assert.equal(await send.isDisabled(),true);
 // A key event on the disabled field must not schedule another SDK write.
 await input.dispatchEvent('keydown',{key:'Enter'});
 await refresh();assert.equal(inserts.length,1);
 held.shift()();
 await page.waitForFunction(()=>!document.querySelector('#chat-client-input').disabled);
 assert.equal(await input.inputValue(),'');assert.equal(inserts.length,1);
 assert.equal(inserts[0][0].mesaj,'Exactly one message');
}));

test('an actual SDK network error restores the composer and preserves the failed client draft',()=>withChat(async({page,input,send,held,refresh,start})=>{
 await start('Keep this failed message');await refresh();
 held.shift()('offline');
 await page.waitForFunction(()=>!document.querySelector('#chat-client-input').disabled);
 assert.equal(await input.inputValue(),'Keep this failed message');assert.equal(await send.isDisabled(),false);
 assert.equal((await page.evaluate(()=>alerts)).length,1);
}));

test('returning to a pending court keeps it locked until the older request settles',()=>withChat(async({page,input,send,held,refresh,start})=>{
 await start('Message from first view');
 await page.evaluate(()=>chat.selectCourt('Court B'));
 await input.fill('Draft for Court B');await refresh();
 assert.equal(await input.inputValue(),'Draft for Court B');assert.equal(await input.isDisabled(),false);
 await page.evaluate(()=>chat.selectCourt('Court A'));
 assert.equal(await input.isDisabled(),true);assert.equal(await send.isDisabled(),true);
 held.shift()();
 await page.waitForFunction(()=>!document.querySelector('#chat-client-input').disabled);
 assert.equal(await send.isDisabled(),false);
}));

test('a background refresh and another court send completion preserve the active draft',()=>withChat(async({page,input,held,refresh,start})=>{
 await start('Pending message for Court A');
 await page.evaluate(()=>chat.selectCourt('Court B'));
 await input.fill('Unsent Court B draft');await refresh();
 held.shift()();
 await page.waitForFunction(()=>pendingChatWrites===0);
 assert.equal(await input.inputValue(),'Unsent Court B draft');assert.equal(await input.isDisabled(),false);
 assert.equal(await page.locator('#chat-client-teren-titlu').innerText(),'Conversație cu Admin (Court B)');
}));

test('an old account send completion cannot change the new account composer or private draft',()=>withChat(async({page,input,held,start})=>{
 await start('Private first account message');
 await page.evaluate(()=>{
  chatState.user={id:'second-client',email:'second@example.test'};chat.clearIdentity();
 });
 assert.equal(await input.inputValue(),'');
 await page.evaluate(()=>chat.selectCourt('Court A'));
 await input.fill('Second account draft');
 held.shift()('offline');
 await page.waitForFunction(()=>pendingChatWrites===0);
 assert.equal(await input.inputValue(),'Second account draft');assert.equal(await input.isDisabled(),false);
 assert.deepEqual(await page.evaluate(()=>alerts),[]);
}));
