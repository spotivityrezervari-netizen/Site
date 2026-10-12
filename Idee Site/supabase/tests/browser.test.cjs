// Real Supabase JS SDK + Chromium + PostgreSQL RLS fixture.
// Every request to the hosted project is intercepted; no live data is read or written.
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const {readFileSync,mkdirSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8002/';
const screenshotDir = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir,{recursive:true});
const tokens = new Map();
const token = person => {
  const payload = Buffer.from(JSON.stringify({sub:uid(person),exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
  const value = `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture-${person}`;
  tokens.set(value,person); return value;
};
const ident = value => { assert.match(value,/^[a-zA-Z_][a-zA-Z0-9_]*$/); return `"${value}"`; };
let checks = 0;

(async () => {
  const pg = new PGlite();
  let browser;
  try {
    await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../001_security.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../003_court_hours.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../004_admin_scope_hardening.sql'),'utf8'));
    await pg.exec("update public.terenuri set poza='assets/imagini/avatar2.png'");
    const tomorrow=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text as d")).rows[0].d;
    let queue=Promise.resolve();
    const serial = fn => { const run=queue.then(fn); queue=run.catch(()=>{}); return run; };
    const requests=[];
    let logoutCount=0;
    let availabilityGate=null;
    let chatGate=null;
    const pauseChatPreflight=()=>{
      let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);
      chatGate={enter,wait};return{entered,release};
    };
    const pauseNextAvailability = () => {
      let enter,release;
      const entered=new Promise(resolve=>{enter=resolve});
      const wait=new Promise(resolve=>{release=resolve});
      availabilityGate={enter,wait};
      return {entered,release};
    };
    const api = async route => {
      const pendingRequest=route.request(), pendingUrl=new URL(pendingRequest.url());
      if (availabilityGate && pendingRequest.method()==='GET'
        && pendingUrl.pathname.endsWith('/rezervari_disponibilitate')
        && pendingUrl.searchParams.get('ora')?.startsWith('in.(')) {
        const gate=availabilityGate;
        availabilityGate=null;
        gate.enter();
        await gate.wait;
      }
      if (chatGate && pendingRequest.method()==='GET' && pendingUrl.pathname.endsWith('/rezervari')
        && pendingUrl.searchParams.get('teren')==='eq.Court A' && pendingUrl.searchParams.get('stare')==='eq.activa') {
        const gate=chatGate;chatGate=null;gate.enter();await gate.wait;
      }
      return serial(async () => {
      const request=route.request(), url=new URL(request.url());
      const person=tokens.get((request.headers().authorization || '').replace(/^Bearer /,''));
      const reply=(status,data) => route.fulfill({status,contentType:'application/json',body:data===undefined ? '' : JSON.stringify(data)});
      const recorded={path:url.pathname,method:request.method(),person,search:url.search};
      requests.push(recorded);
      try {
        await pg.exec('reset role');
        await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[person ? uid(person) : '']);
        if (url.pathname.startsWith('/auth/v1/')) {
          if (url.pathname.endsWith('/logout')) { logoutCount++; return reply(204); }
          if (url.pathname.endsWith('/signup')) {
            const body=request.postDataJSON();
            recorded.body=body;
            assert.equal(body.password,' test-password. ');
            const result=await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3) returning *',[uid(5),body.email,body.data]);
            return reply(200,{...result.rows[0],app_metadata:{provider:'email'},user_metadata:body.data,identities:[]});
          }
          if (url.pathname.endsWith('/recover')) {
            recorded.body=request.postDataJSON();
            return reply(200,{});
          }
          if (url.pathname.endsWith('/token')) {
            const body=request.postDataJSON();
            assert.equal(body.password,' test-password. ');
            const n=body.email==='admin@example.test' ? 3 : 1;
            const user=(await pg.query('select * from auth.users where id=$1',[uid(n)])).rows[0];
            return reply(200,{access_token:token(n),token_type:'bearer',refresh_token:`fixture-refresh-${n}`,expires_in:3600,user:{...user,app_metadata:{provider:'email'},user_metadata:user.raw_user_meta_data}});
          }
          if (url.pathname.endsWith('/user') && person) {
            const user=(await pg.query('select * from auth.users where id=$1',[uid(person)])).rows[0];
            return reply(200,{...user,app_metadata:{provider:'email'},user_metadata:user.raw_user_meta_data});
          }
          return reply(401,{message:'No fixture session'});
        }
        const table=url.pathname.split('/').pop();
        assert.ok(['clienti','users_admin','terenuri','rezervari','rezervari_disponibilitate','mesaje_chat'].includes(table));
        await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
        const params=[], conditions=[];
        for (const [field,value] of url.searchParams) {
          if (['select','order','limit','offset','columns'].includes(field)) continue;
          if (value.startsWith('in.(')) {
            const values=value.slice(4,-1).split(',').map(v=>v.replace(/^"|"$/g,''));
            const placeholders=values.map(v=>{params.push(v);return `$${params.length}`});
            conditions.push(`${ident(field)} in (${placeholders.join(',')})`);
          } else {
            const match=value.match(/^(eq|neq|ilike)\.(.*)$/s); assert.ok(match,value);
            params.push(match[2]); conditions.push(`${ident(field)} ${{eq:'=',neq:'<>',ilike:'ilike'}[match[1]]} $${params.length}`);
          }
        }
        const where=conditions.length ? ' where '+conditions.join(' and ') : '';
        let query;
        if (request.method()==='GET') {
          const columns=(url.searchParams.get('select') || '*').split(',').map(c=>c==='*' ? '*' : ident(c)).join(',');
          query=`select ${columns} from public.${ident(table)}${where}`;
          if (url.searchParams.has('order')) {
            query+=' order by '+url.searchParams.get('order').split(',').map(o=>{const [col,direction]=o.split('.');return ident(col)+(direction==='desc'?' desc':' asc')}).join(',');
          }
          if (url.searchParams.has('limit')) {params.push(Number(url.searchParams.get('limit')));query+=` limit $${params.length}`;}
        } else if (request.method()==='POST') {
          const body=request.postDataJSON(), rows=Array.isArray(body)?body:[body], fields=Object.keys(rows[0]);
          const values=rows.map(row=>'('+fields.map(field=>{params.push(row[field]);return `$${params.length}`}).join(',')+')');
          query=`insert into public.${ident(table)}(${fields.map(ident).join(',')}) values ${values.join(',')} returning *`;
        } else if (request.method()==='PATCH') {
          const sets=Object.entries(request.postDataJSON()).map(([field,value])=>{params.push(value);return `${ident(field)}=$${params.length}`});
          query=`update public.${ident(table)} set ${sets.join(',')}${where} returning *`;
        } else if (request.method()==='DELETE') query=`delete from public.${ident(table)}${where} returning *`;
        else return reply(405,{message:'Unsupported fixture method'});
        const result=await pg.query(query,params);
        const single=(request.headers().accept || '').includes('vnd.pgrst.object');
        if (single && result.rows.length!==1) return reply(406,{code:'PGRST116',message:'Expected exactly one row'});
        return reply(request.method()==='POST'?201:200,single ? result.rows[0] : result.rows);
      } catch (e) { console.error('Fixture API:',url.pathname,e.message); return reply(403,{code:e.code || 'FIXTURE',message:e.message}); }
      });
    };
    const options={executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true};
    const proxyUrl=process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxyUrl) { const u=new URL(proxyUrl);options.proxy={server:u.origin,bypass:'127.0.0.1,localhost'}; }
    browser=await chromium.launch(options);
    const contexts=[];
    const browserErrors=[];
    const pageFor = async () => {
      const context=await browser.newContext({timezoneId:'Europe/Bucharest'}); contexts.push(context);
      await context.route(url=>url.hostname===host,api);
      await context.routeWebSocket(url=>url.hostname===host,ws=>ws.close());
      const page=await context.newPage();
      page.on('dialog',async dialog=>{ await dialog.accept(); });
      page.on('pageerror',error=>{ browserErrors.push(error.message); console.error('Browser error:',error.message); });
      return page;
    };
    const pass = label => {checks++;console.log('PASS',label);};
    const page=await pageFor();
    await page.addInitScript(()=>localStorage.setItem('user_session',JSON.stringify({email:'super@example.test',id:'forged'})));
    await page.goto(base,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>typeof window.actualizeazaButonCont==='function');
    assert.match(await page.locator('#text-top-cont').innerText(),/Login/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('user_session')),null);
    pass('a forged localStorage profile grants no login or permissions');
    const chooseSlot = async (hour='12:00') => {
      await page.locator('.card-sport[data-sport="Fotbal"]').click();
      await page.locator('#filtru-data').fill(tomorrow);
      await page.locator('#filtru-data').dispatchEvent('change');
      await page.locator('.btn-teren').first().click();
      await page.locator('.btn-ora').filter({hasText:new RegExp(`^${hour}$`)}).click();
    };
    await chooseSlot();
    assert.ok(requests.some(r=>r.path.endsWith('/rezervari_disponibilitate') && !r.person));
    assert.ok(!requests.some(r=>r.path.endsWith('/rezervari') && !r.person));
    pass('public booking screen uses only the safe availability table');
    await page.locator('#buton-confirma').click();
    await page.locator('#modal-auth').waitFor({state:'visible'});
    assert.equal(await page.locator('#modal-rezervare').isVisible(),false);
    assert.equal(await page.locator('#modal-terenuri').isVisible(),false);
    assert.equal(await page.locator('#fundal-imagine-sport').evaluate(node=>node.style.opacity),'0');
    pass('guest booking transfers to login with both sport dialogs closed and homepage background reset');
    await page.locator('#login-email').fill('alice@example.test');
    await page.locator('#login-parola').fill(' test-password. ');
    await page.locator('#btn-executa-login').click();
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    await chooseSlot();
    const raceRequests=requests.length;
    const pendingAvailability=pauseNextAvailability();
    const gatedRequest=page.waitForRequest(request=>{
      const url=new URL(request.url());
      return url.pathname.endsWith('/rezervari_disponibilitate') && url.searchParams.get('ora')?.startsWith('in.(');
    });
    await page.locator('#buton-confirma').click();
    await gatedRequest;
    await pendingAvailability.entered;
    assert.equal(await page.locator('#buton-confirma').isDisabled(),true);
    await page.locator('#container-zile .btn-zi').nth(2).click();
    pendingAvailability.release();
    await page.locator('.btn-ora').filter({hasText:/^12:00$/}).click();
    await page.waitForFunction(()=>document.getElementById('buton-confirma').disabled===false);
    assert.match(await page.locator('#container-zile .btn-zi').nth(2).getAttribute('class'),/selectat/);
    assert.match(await page.locator('.btn-ora').filter({hasText:/^12:00$/}).getAttribute('class'),/selectat/);
    assert.equal(await page.locator('#modal-rezervare').isVisible(),true);
    assert.ok(!requests.slice(raceRequests).some(request=>request.path==='/rest/v1/rezervari' && request.method==='POST'));
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query("select count(*)::integer as n from public.rezervari where stare='activa'")).rows[0].n,0);
    });
    await page.locator('#inchide-rezervare').click();
    pass('changing the selected day during a delayed booking preflight aborts insertion without changing the new selection');
    await chooseSlot();
    await page.locator('.btn-ora').filter({hasText:/^13:00$/}).click();
    await page.locator('#container-minge label').click();
    assert.equal(await page.locator('#checkbox-minge').isChecked(),true);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+5000));
    await page.locator('#buton-confirma').click();
    await page.locator('#modal-rezervare').waitFor({state:'hidden'});
    assert.equal(await page.locator('#modal-terenuri').isVisible(),false);
    assert.equal(await page.locator('#fundal-imagine-sport').evaluate(node=>node.style.opacity),'0');
    const notice=page.locator('#notificare-rezervare');
    await notice.waitFor({state:'visible'});
    assert.equal(await notice.getAttribute('role'),'status');
    assert.equal(await page.locator('#notificare-rezervare-text').innerText(),'Rezervarea a fost realizată cu succes.');
    await serial(async () => {
      await pg.exec('reset role');
      const rows=(await pg.query("select * from public.rezervari where stare='activa' order by ora")).rows;
      assert.equal(rows.length,2);assert.equal(rows[0].data_str,tomorrow);
      assert.equal(rows[0].pret_total,'115 RON (+Minge)');assert.equal(rows[1].pret_total,'100 RON');
      assert.ok(rows.every(r=>r.client_user_id===uid(1)));
    });
    pass('real SDK login and two-hour booking work with RLS and server pricing');
    await page.clock.runFor(1999);
    assert.equal(await notice.isVisible(),true);
    await page.clock.runFor(1);
    await notice.waitFor({state:'hidden'});
    await page.clock.resume();
    pass('successful booking restores the homepage and shows an accessible notice for two seconds');
    await chooseSlot('15:00');
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false); update public.terenuri set este_activ=false where nume='Court A'");
    });
    const failedBookingResponse=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.hostname===host && url.pathname==='/rest/v1/rezervari' && response.request().method()==='POST';
    });
    await page.locator('#buton-confirma').click();
    assert.equal((await failedBookingResponse).status(),403);
    await page.waitForFunction(()=>!document.getElementById('buton-confirma').innerText.includes('Se procesează')
      && !document.getElementById('container-ore').innerText.includes('⏳'));
    assert.equal(await page.locator('#buton-confirma').isDisabled(),true);
    assert.equal(await notice.isVisible(),false);
    assert.equal(await page.locator('#modal-rezervare').isVisible(),true);
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      assert.equal((await pg.query("select * from public.rezervari where teren='Court A' and ora='15:00'")).rows.length,0);
      await pg.exec("update public.terenuri set este_activ=true where nume='Court A'");
    });
    await page.locator('#inchide-rezervare').click();
    pass('a booking rejected by PostgreSQL keeps the dialog open without displaying a success notice');
    const futureId=await serial(async () => {
      await pg.exec('reset role');
      return (await pg.query("select id from public.rezervari where stare='activa' and ora='13:00'")).rows[0].id;
    });
    await page.locator('#btn-top-cont').click();
    await page.locator('#btn-vezi-active').click();
    await page.locator(`.anulare-client[data-id="${futureId}"]`).click();
    await page.locator(`.anulare-client[data-id="${futureId}"]`).waitFor({state:'hidden'});
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query('select stare from public.rezervari where id=$1',[futureId])).rows[0].stare,'anulata');
      assert.equal((await pg.query('select * from public.rezervari_disponibilitate where id=$1',[String(futureId)])).rows.length,0);
    });
    pass('client can cancel an upcoming booking and the public slot is released');
    const pastId=await serial(async () => {
      await pg.exec('reset role');
      await pg.query("select set_config('request.jwt.claim.sub','',false)");
      return (await pg.query("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$1,'Court A','2000-01-01','16:00','activa') returning id",[uid(1)])).rows[0].id;
    });
    await page.locator('#inapoi-la-profil').click();
    await page.locator('#btn-vezi-istoric').click();
    await page.locator(`.anulare-client[data-id="${pastId}"]`).click();
    await page.locator(`.anulare-client[data-id="${pastId}"]`).waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.tipIstoricDeschis),'istoric');
    assert.equal(await page.locator('#titlu-lista-rezervari').innerText(),'Istoric Rezervări');
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query('select stare from public.rezervari where id=$1',[pastId])).rows[0].stare,'anulata');
    });
    pass('client can cancel a finished booking from history and stays in the history view');
    await page.locator('#inchide-istoric-client').click();
    await page.locator('#btn-top-cont').click();
    await page.locator('#btn-logout').click();
    await page.locator('#modal-profil').waitFor({state:'hidden'});
    assert.equal(logoutCount,1);
    pass('logout signs out of Supabase, not just the UI');
    await page.locator('#btn-top-cont').click();
    await page.locator('#login-email').fill(' alice@example.test ');
    const recoveryResponse=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.hostname===host && url.pathname==='/auth/v1/recover' && response.request().method()==='POST';
    });
    await page.locator('#btn-forgot-password').click();
    assert.equal((await recoveryResponse).status(),200);
    await page.waitForFunction(()=>document.getElementById('btn-forgot-password').style.pointerEvents==='auto');
    const recover=requests.find(r=>r.path==='/auth/v1/recover');
    assert.equal(recover.method,'POST');
    assert.equal(recover.body.email,'alice@example.test');
    assert.equal(new URLSearchParams(recover.search).get('redirect_to'),new URL('./',base).href);
    pass('password recovery sends the entered email and current site directory through the real SDK');
    await page.locator('#tab-register').click();
    await page.locator('#reg-nume').fill('New Client');
    await page.locator('#reg-email').fill('new@example.test');
    await page.locator('#reg-telefon').fill('444');
    await page.locator('#reg-parola').fill(' test-password. ');
    await page.locator('#btn-executa-register').click();
    await page.waitForFunction(()=>document.getElementById('btn-executa-register').disabled===false);
    await serial(async ()=>{
      await pg.exec('reset role');
      assert.equal((await pg.query('select nume from public.clienti where user_id=$1',[uid(5)])).rows[0].nume,'New Client');
    });
    assert.ok(!requests.some(r=>r.path.endsWith('/clienti') && r.method==='POST'));
    pass('signup passes metadata to Auth; the trigger creates an unconfirmed private profile');
    const signup=requests.find(r=>r.path==='/auth/v1/signup');
    assert.equal(signup.method,'POST');
    assert.equal(signup.body.email,'new@example.test');
    assert.equal(new URLSearchParams(signup.search).get('redirect_to'),new URL('./',base).href);
    pass('signup confirmation redirects to the current site directory through the real SDK');
    await serial(async () => {
      await pg.exec('reset role');
      await pg.query("update public.clienti set nume=$1 where user_id=$2",['<img src=x onerror="window.__xss=true">',uid(1)]);
      await pg.query("insert into public.mesaje_chat(email_client,client_user_id,teren,expeditor,mesaj) values('alice@example.test',$1,'Court A','client',$2)",[uid(1),'<img src=x onerror="window.__xss=true">']);
    });
    const admin=await pageFor();
    await admin.goto(new URL('admin.html',base).href,{waitUntil:'networkidle'});
    await admin.locator('#login-email-admin').fill('admin@example.test');
    await admin.locator('#login-parola').fill(' test-password. ');
    await admin.locator('#login-admin-btn').click();
    await admin.locator('#sectiune-dashboard').waitFor({state:'visible'});
    await admin.waitForFunction(()=>document.querySelector('[id^="modal-setari-"]')!==null);
    assert.equal(await admin.locator('[id^="modal-setari-"]').count(),1);
    assert.ok(requests.some(r=>r.path.endsWith('/users_admin') && r.search.includes('user_id=eq.')));
    pass('admin login uses the Auth UUID and exposes settings only for its allocated court');
    await admin.locator('[onclick*="modal-tabel-program"]').click();
    await admin.locator('#tabel-data').fill(tomorrow);
    await admin.locator('#tabel-data').dispatchEvent('change');
    await admin.locator('#select-stare-1400').selectOption('blocat');
    await admin.locator('#tabel-corp-program').getByText('Închis de Admin').waitFor();
    await serial(async () => {
      await pg.exec('reset role');
      const row=(await pg.query("select email_client,client_user_id from public.rezervari where teren='Court A' and ora='14:00'")).rows[0];
      assert.equal(row.email_client,'Teren Blocat');assert.equal(row.client_user_id,null);
    });
    await admin.keyboard.press('Escape');
    pass('allocated admin can block a free hour with RLS, without inventing a client identity');
    await admin.locator('#btn-vezi-chat-admin').click();
    await admin.locator('#chat-admin-lista-conversații .card-conversatie').first().click();
    await admin.locator('#chat-admin-mesaje .mesaj-bula').waitFor();
    assert.equal(await admin.evaluate(()=>window.__xss),undefined);
    assert.equal(await admin.locator('img[src="x"]').count(),0);
    assert.ok((await admin.locator('#chat-admin-mesaje').innerText()).includes('<img src=x'));
    pass('client names and chat messages render as text, without stored HTML execution');
    await admin.keyboard.press('Escape');
    await admin.locator('#container-meniu-terenuri .card-sport').first().click();
    await admin.locator('.card-sport[onclick*="modal-setari-"]').click();
    const settingsId=(await admin.locator('[id^="modal-setari-"]').getAttribute('id')).slice('modal-setari-'.length);
    const hourInputs=admin.locator(`#ore-rezervabile-${settingsId} input.ora-rezervabila`);
    const allHours=Array.from({length:14},(_,i)=>`${String(i+9).padStart(2,'0')}:00`);
    const enabledHours=['09:00','10:00','11:00'];
    assert.deepEqual(await hourInputs.evaluateAll(nodes=>nodes.map(node=>node.value)),allHours);
    assert.deepEqual(await hourInputs.evaluateAll(nodes=>nodes.filter(node=>node.checked).map(node=>node.value)),allHours.slice(3));
    for (const input of await hourInputs.all()) {
      await input.setChecked(enabledHours.includes(await input.getAttribute('value')));
    }
    await admin.locator(`#oras-${settingsId}`).fill('Test City');
    const settingsResponse=admin.waitForResponse(response=>new URL(response.url()).pathname==='/rest/v1/terenuri' && response.request().method()==='PATCH');
    const settingsReload=admin.waitForRequest(request=>new URL(request.url()).pathname==='/auth/v1/token' && request.method()==='POST');
    await admin.locator(`#btn-save-${settingsId}`).click();
    assert.equal((await settingsResponse).status(),200);
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      assert.deepEqual((await pg.query("select ore_rezervabile from public.terenuri where nume='Court A'")).rows[0].ore_rezervabile,enabledHours);
      assert.equal((await pg.query("select oras from public.terenuri where nume='Court A'")).rows[0].oras,'Test City');
    });
    await settingsReload;
    await admin.waitForFunction(()=>document.getElementById('login-admin-btn').disabled===false);
    await admin.keyboard.press('Escape');
    const cityBack=admin.locator('.sub-pagina-oras:visible [onclick*="inchideSubPaginaOras"]');
    if (await cityBack.count()) await cityBack.click();
    pass('allocated admin changes the court hours to 09:00, 10:00 and 11:00 through settings and the real SDK');
    const unallocatedUpdate=await admin.evaluate(async ()=>{
      const result=await db.from('terenuri').update({ore_rezervabile:['09:00']}).eq('nume','Court B').select('ore_rezervabile');
      return {data:result.data,error:result.error?.message || null};
    });
    assert.equal(unallocatedUpdate.error,null);
    assert.deepEqual(unallocatedUpdate.data,[]);
    await serial(async () => {
      await pg.exec('reset role');
      assert.deepEqual((await pg.query("select ore_rezervabile from public.terenuri where nume='Court B'")).rows[0].ore_rezervabile,allHours.slice(3));
    });
    assert.equal(await admin.locator('[id^="modal-setari-"]').count(),1);
    pass('changing hours preserves assigned-admin boundaries and leaves an unallocated court unchanged');
    await admin.locator('[onclick*="modal-rezervare-manuala"]').click();
    await admin.locator('#manual-teren').selectOption('Court A');
    await admin.waitForFunction(()=>document.querySelector('#manual-ora option[value="09:00"]')!==null);
    assert.deepEqual(await admin.locator('#manual-ora option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean)),enabledHours);
    assert.deepEqual(await admin.locator('#manual-teren option').evaluateAll(nodes=>nodes.map(node=>node.value)),['Court A']);
    const longManualName='ManualCustomer_'+ 'UnbrokenLongName'.repeat(10);
    await admin.locator('#manual-client').fill(longManualName);
    await admin.locator('#manual-data').fill(tomorrow);
    await admin.locator('#manual-ora').selectOption('09:00');
    await admin.locator('#manual-pret').fill('90 RON');
    const manualResponse=admin.waitForResponse(response=>new URL(response.url()).pathname==='/rest/v1/rezervari' && response.request().method()==='POST');
    await admin.locator('#btn-rezervare-manuala').click();
    assert.equal((await manualResponse).status(),201);
    await admin.waitForFunction(()=>!document.getElementById('btn-rezervare-manuala').innerText.includes('verifică'));
    await admin.locator('#modal-rezervare-manuala .buton-inchidere').click();
    await admin.locator('#modal-rezervare-manuala').waitFor({state:'hidden'});
    await admin.locator('[onclick*="modal-tabel-program"]').click();
    await admin.locator('#tabel-data').fill(tomorrow);
    await admin.locator('#tabel-data').dispatchEvent('change');
    await admin.locator('#tabel-corp-program tr[data-ora="09:00"]').getByText(longManualName,{exact:false}).waitFor();
    assert.deepEqual(await admin.locator('#tabel-corp-program tr[data-ora]').evaluateAll(nodes=>nodes.map(node=>node.dataset.ora)),['09:00','10:00','11:00','12:00','14:00']);
    assert.equal(await admin.locator('#tabel-corp-program tr[data-ora="12:00"] select').count(),0);
    assert.equal(await admin.locator('#tabel-corp-program tr[data-ora="14:00"] select').count(),0);
    await serial(async () => {
      await pg.exec('reset role');
      const manual=(await pg.query("select * from public.rezervari where teren='Court A' and data_str=$1 and ora='09:00'",[tomorrow])).rows[0];
      assert.equal(manual.email_client,longManualName);
      assert.equal(manual.client_user_id,null);
    });
    pass('manual hour choices match settings and the schedule retains occupied hours outside the new program');
    const configuredClient=await pageFor();
    await configuredClient.goto(base,{waitUntil:'networkidle'});
    await configuredClient.locator('#btn-top-cont').click();
    await configuredClient.locator('#login-email').fill('alice@example.test');
    await configuredClient.locator('#login-parola').fill(' test-password. ');
    await configuredClient.locator('#btn-executa-login').click();
    await configuredClient.locator('#modal-auth').waitFor({state:'hidden'});
    await configuredClient.locator('.card-sport[data-sport="Fotbal"]').click();
    await configuredClient.locator('#filtru-data').fill(tomorrow);
    await configuredClient.locator('#filtru-data').dispatchEvent('change');
    await configuredClient.locator('.btn-teren').first().click();
    await configuredClient.locator('.btn-ora').filter({hasText:/^10:00$/}).waitFor();
    assert.deepEqual(await configuredClient.locator('.btn-ora').evaluateAll(nodes=>nodes.map(node=>node.textContent.match(/^\d{2}:\d{2}/)?.[0])),enabledHours);
    assert.equal(await configuredClient.locator('.btn-ora').filter({hasText:/^09:00/}).isDisabled(),true);
    await configuredClient.locator('.btn-ora').filter({hasText:/^10:00$/}).click();
    await configuredClient.locator('#buton-confirma').click();
    await configuredClient.locator('#modal-rezervare').waitFor({state:'hidden'});
    await serial(async () => {
      await pg.exec('reset role');
      const reserved=(await pg.query("select * from public.rezervari where teren='Court A' and data_str=$1 and ora='10:00'",[tomorrow])).rows[0];
      assert.equal(reserved.client_user_id,uid(1));
      assert.equal(reserved.pret_total,'100 RON');
    });
    pass('public booking offers only configured hours and a real SDK booking at 10:00 passes server validation');
    const outsideHour=await serial(async () => {
      await pg.exec('reset role');
      return (await pg.query("select * from public.rezervari where teren='Court A' and data_str=$1 and ora='12:00' and stare='activa'",[tomorrow])).rows[0];
    });
    await configuredClient.locator('#btn-top-cont').click();
    await configuredClient.locator('#btn-vezi-active').click();
    await configuredClient.locator(`.anulare-client[data-id="${outsideHour.id}"]`).click();
    await configuredClient.locator(`.anulare-client[data-id="${outsideHour.id}"]`).waitFor({state:'hidden'});
    await serial(async () => {
      await pg.exec('reset role');
      assert.deepEqual((await pg.query('select * from public.rezervari where id=$1',[outsideHour.id])).rows[0],{...outsideHour,stare:'anulata'});
    });
    pass('a client still sees and cancels an existing booking outside the revised court hours');
    await admin.locator('.program-reincarca').click();
    await admin.locator('#tabel-corp-program tr[data-ora="09:00"]').getByText(longManualName,{exact:false}).waitFor();
    for (const width of [320,390]) {
      await admin.setViewportSize({width,height:844});
      const dimensions=await admin.evaluate(()=>{
        const modal=document.querySelector('.program-modal');
        const box=modal.getBoundingClientRect();
        const detail=document.querySelector('#tabel-corp-program tr[data-ora="09:00"] td:nth-child(3)');
        return {
          viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,left:box.left,right:box.right,
          controlHeights:[...modal.querySelectorAll('input,select,.program-reincarca')].map(node=>node.getBoundingClientRect().height).filter(height=>height>0),
          detailWidth:detail.clientWidth,detailScroll:detail.scrollWidth,
          tableWidth:modal.querySelector('.program-scroll').clientWidth,tableScroll:modal.querySelector('.program-scroll').scrollWidth,
        };
      });
      if (screenshotDir) await admin.screenshot({path:join(screenshotDir,`spotivity-hours-program-${width}.png`)});
      assert.ok(dimensions.pageWidth<=dimensions.viewport+1,JSON.stringify(dimensions));
      assert.ok(dimensions.left>=-1 && dimensions.right<=width+1,JSON.stringify(dimensions));
      assert.ok(dimensions.controlHeights.length>=2,JSON.stringify(dimensions));
      assert.ok(dimensions.controlHeights.every(height=>height>0 && height<=44.1),JSON.stringify(dimensions));
      assert.ok(dimensions.detailScroll<=dimensions.detailWidth+1,JSON.stringify(dimensions));
      assert.ok(dimensions.tableScroll<=dimensions.tableWidth+1,JSON.stringify(dimensions));
      pass(`admin schedule fits a ${width}px mobile viewport with compact controls and wrapped customer details`);
    }
    const subpathPage=await pageFor();
    const directory=new URL('./',base), nested=new URL('Site/Idee%20Site/',directory);
    await subpathPage.context().route(url=>url.origin===nested.origin && url.pathname.startsWith(nested.pathname),async route=>{
      const requested=new URL(route.request().url());
      requested.pathname=directory.pathname+requested.pathname.slice(nested.pathname.length);
      const response=await route.fetch({url:requested.href});
      await route.fulfill({response});
    });
    await subpathPage.goto(nested.href,{waitUntil:'networkidle'});
    await subpathPage.locator('#btn-top-cont').click();
    await subpathPage.locator('#login-email').fill('alice@example.test');
    const beforeRecovery=requests.length;
    const nestedRecovery=subpathPage.waitForResponse(response=>new URL(response.url()).pathname==='/auth/v1/recover' && response.request().method()==='POST');
    await subpathPage.locator('#btn-forgot-password').click();
    assert.equal((await nestedRecovery).status(),200);
    const nestedRequest=requests.slice(beforeRecovery).find(r=>r.path==='/auth/v1/recover' && r.method==='POST');
    assert.equal(nestedRequest.body.email,'alice@example.test');
    assert.equal(new URLSearchParams(nestedRequest.search).get('redirect_to'),nested.href);
    pass('password recovery preserves the GitHub Pages subdirectory in its real SDK redirect');
    await serial(async()=>{
      await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
      await pg.exec("update public.terenuri set are_chat=true where nume in ('Court A','Court B')");
      await pg.query("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$2,'Court B',$1,'14:00','activa')",[tomorrow,uid(1)]);
    });
    const chatPage=await pageFor();await chatPage.goto(base,{waitUntil:'networkidle'});
    await chatPage.evaluate(async()=>{await db.auth.signInWithPassword({email:'alice@example.test',password:' test-password. '})});
    await chatPage.waitForFunction(()=>document.getElementById('btn-top-cont').innerText.includes('Contul'));
    await chatPage.locator('#btn-top-cont').click();await chatPage.locator('#modal-profil').waitFor({state:'visible'});
    await chatPage.locator('#btn-vezi-chat').click();await chatPage.locator('#modal-chat-client').waitFor({state:'visible'});
    await chatPage.locator('#chat-client-lista-terenuri .card-conversatie').filter({hasText:'Court A'}).click();
    await chatPage.waitForFunction(()=>!document.getElementById('chat-client-input').disabled);
    const chatPause=pauseChatPreflight();await chatPage.locator('#chat-client-input').fill('Message intended for Court A');
    await chatPage.locator('#chat-client-btn-trimite').click();await chatPause.entered;
    await chatPage.locator('#chat-client-lista-terenuri .card-conversatie').filter({hasText:'Court B'}).click();
    chatPause.release();await chatPage.waitForLoadState('networkidle');
    await serial(async()=>{await pg.exec('reset role');assert.equal((await pg.query("select id from public.mesaje_chat where mesaj='Message intended for Court A'")).rows.length,0)});
    pass('switching the chat court during preflight never sends the previous draft to another court');
    await chatPage.locator('#chat-client-lista-terenuri .card-conversatie').filter({hasText:'Court A'}).click();
    await chatPage.waitForFunction(()=>!document.getElementById('chat-client-input').disabled);
    const logoutPause=pauseChatPreflight();await chatPage.locator('#chat-client-input').fill('Message cancelled by logout');
    await chatPage.locator('#chat-client-btn-trimite').click();await logoutPause.entered;
    await chatPage.evaluate(async()=>{await db.auth.signOut({scope:'local'})});
    await chatPage.locator('#modal-chat-client').waitFor({state:'hidden'});logoutPause.release();await chatPage.waitForLoadState('networkidle');
    assert.equal(await chatPage.locator('#chat-client-mesaje').innerText(),'');
    await serial(async()=>{await pg.exec('reset role');assert.equal((await pg.query("select id from public.mesaje_chat where mesaj='Message cancelled by logout'")).rows.length,0)});
    pass('logout during chat preflight clears private messages and aborts sending');
    // A sign-out from another tab must remove cached privileged data.
    await admin.evaluate(async()=>{await db.auth.signOut({scope:'local'})});
    await admin.locator('#sectiune-login').waitFor({state:'visible'});
    assert.ok(!(await admin.locator('#sectiune-dashboard').isVisible()));
    assert.equal(await admin.locator('#container-meniu-terenuri').innerText(),'');
    assert.equal(await admin.locator('#chat-admin-mesaje').innerText(),'');
    assert.equal(await admin.locator('[id^="modal-setari-"]').count(),0);
    pass('admin auth sign-out clears cached settings, program and private chat');
    const mobile=await pageFor();
    await mobile.setViewportSize({width:390,height:844});
    await mobile.goto(base,{waitUntil:'networkidle'});
    await mobile.locator('#btn-top-cont').click();
    await mobile.locator('#modal-auth').waitFor({state:'visible'});
    await mobile.keyboard.press('Escape');
    await mobile.locator('#modal-auth').waitFor({state:'hidden'});
    pass('mobile login dialog still opens and closes');
    assert.deepEqual(browserErrors,[]);
    for (const context of contexts) await context.close();
    console.log(`\n${checks} browser integration checks passed against isolated PostgreSQL.`);
  } finally {
    if (browser) await browser.close();
    await pg.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1});
