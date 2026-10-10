// Real Supabase JS SDK + Chromium + PostgreSQL RLS fixture.
// Every request to the hosted project is intercepted; no live data is read or written.
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8002/';
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
    await pg.exec("update public.terenuri set poza='assets/imagini/avatar2.png'");
    const tomorrow=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text as d")).rows[0].d;
    let queue=Promise.resolve();
    const serial = fn => { const run=queue.then(fn); queue=run.catch(()=>{}); return run; };
    const requests=[];
    let logoutCount=0;
    const api = async route => serial(async () => {
      const request=route.request(), url=new URL(request.url());
      const person=tokens.get((request.headers().authorization || '').replace(/^Bearer /,''));
      const reply=(status,data) => route.fulfill({status,contentType:'application/json',body:data===undefined ? '' : JSON.stringify(data)});
      requests.push({path:url.pathname,method:request.method(),person,search:url.search});
      try {
        await pg.exec('reset role');
        await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[person ? uid(person) : '']);
        if (url.pathname.startsWith('/auth/v1/')) {
          if (url.pathname.endsWith('/logout')) { logoutCount++; return reply(204); }
          if (url.pathname.endsWith('/signup')) {
            const body=request.postDataJSON();
            assert.equal(body.password,' test-password. ');
            const result=await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3) returning *',[uid(5),body.email,body.data]);
            return reply(200,{...result.rows[0],app_metadata:{provider:'email'},user_metadata:body.data,identities:[]});
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
    const chooseSlot = async () => {
      await page.locator('.card-sport[data-sport="Fotbal"]').click();
      await page.locator('#filtru-data').fill(tomorrow);
      await page.locator('#filtru-data').dispatchEvent('change');
      await page.locator('.btn-teren').first().click();
      await page.locator('.btn-ora').filter({hasText:/^12:00$/}).click();
    };
    await chooseSlot();
    assert.ok(requests.some(r=>r.path.endsWith('/rezervari_disponibilitate') && !r.person));
    assert.ok(!requests.some(r=>r.path.endsWith('/rezervari') && !r.person));
    pass('public booking screen uses only the safe availability table');
    await page.locator('#buton-confirma').click();
    await page.locator('#modal-auth').waitFor({state:'visible'});
    await page.locator('#login-email').fill('alice@example.test');
    await page.locator('#login-parola').fill(' test-password. ');
    await page.locator('#btn-executa-login').click();
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    await chooseSlot();
    await page.locator('.btn-ora').filter({hasText:/^13:00$/}).click();
    await page.locator('#container-minge label').click();
    assert.equal(await page.locator('#checkbox-minge').isChecked(),true);
    await page.locator('#buton-confirma').click();
    await page.locator('#modal-rezervare').waitFor({state:'hidden'});
    await serial(async () => {
      await pg.exec('reset role');
      const rows=(await pg.query("select * from public.rezervari where stare='activa' order by ora")).rows;
      assert.equal(rows.length,2);assert.equal(rows[0].data_str,tomorrow);
      assert.equal(rows[0].pret_total,'115 RON (+Minge)');assert.equal(rows[1].pret_total,'100 RON');
      assert.ok(rows.every(r=>r.client_user_id===uid(1)));
    });
    pass('real SDK login and two-hour booking work with RLS and server pricing');
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
