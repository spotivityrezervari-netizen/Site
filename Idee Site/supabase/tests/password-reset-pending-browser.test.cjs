// Exercise the native Auth button and keyboard with an in-memory SDK transport.
// No Auth emails or hosted requests are sent.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<input id="login-email" value="client@example.test"><button id="btn-am-uitat-parola" type="button">Resetează parola</button>');
  await page.addScriptTag({content:readFileSync(join(__dirname,'../../js/modules/public-auth.js'),'utf8')});
  await page.evaluate(()=>{
   window.alerts=[];window.alert=message=>alerts.push(message);
   window.resetRequests=[];window.resetResolvers=[];
   window.siteHomeUrl=()=> 'https://booking.example.test/Site/';
   const db={auth:{resetPasswordForEmail(email,options){
    resetRequests.push({email,options});
    return new Promise((resolve,reject)=>resetResolvers.push({resolve,reject}));
   }}};
   window.SpotivityModules.publicAuth({db,state:{},services:{}}).mount();
  });
  const button=page.locator('#btn-am-uitat-parola');
  await button.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>resetRequests.length===1);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>resetRequests.length),1,'Keyboard retries must not send another recovery email while the first request is pending');
  assert.equal(await button.isDisabled(),true);
  await button.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>resetRequests.length),1,'A duplicate event must be ignored as well');
  assert.deepEqual(await page.evaluate(()=>resetRequests[0]),{email:'client@example.test',options:{redirectTo:'https://booking.example.test/Site/'}});
  await page.evaluate(()=>resetResolvers.shift().resolve({error:null}));
  await page.waitForFunction(()=>!document.getElementById('btn-am-uitat-parola').disabled&&alerts.length===1);
  assert.equal(await button.innerText(),'Resetează parola');
  assert.match(await page.evaluate(()=>alerts[0]),/link de resetare/);
  console.log('PASS keyboard and duplicate-event recovery requests are deduplicated only while pending');

  await button.click();await page.waitForFunction(()=>resetRequests.length===2);
  await page.evaluate(()=>resetResolvers.shift().resolve({error:{message:'Temporary Auth refusal'}}));
  await page.waitForFunction(()=>!document.getElementById('btn-am-uitat-parola').disabled&&alerts.length===2);
  assert.equal(await page.evaluate(()=>alerts[1]),'Eroare la trimitere: Temporary Auth refusal');
  await button.click();await page.waitForFunction(()=>resetRequests.length===3);
  await page.evaluate(()=>resetResolvers.shift().reject(new Error('Transport unavailable')));
  await page.waitForFunction(()=>!document.getElementById('btn-am-uitat-parola').disabled&&alerts.length===3);
  assert.equal(await page.evaluate(()=>alerts[2]),'Eroare la trimitere: Transport unavailable');
  assert.equal(await button.innerText(),'Resetează parola');
  await button.click();await page.waitForFunction(()=>resetRequests.length===4);
  await page.evaluate(()=>resetResolvers.shift().resolve({error:null}));
  await page.waitForFunction(()=>!document.getElementById('btn-am-uitat-parola').disabled&&alerts.length===4);
  assert.match(await page.evaluate(()=>alerts[3]),/link de resetare/);
  await page.locator('#login-email').fill('');await button.click();
  assert.equal(await page.evaluate(()=>resetRequests.length),4,'An empty email never reaches the SDK');
  assert.deepEqual(errors,[]);
  console.log('PASS SDK errors release the recovery button and allow a later successful attempt');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
