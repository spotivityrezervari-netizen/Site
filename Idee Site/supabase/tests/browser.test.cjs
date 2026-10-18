// Real Supabase JS SDK + Chromium + PostgreSQL RLS fixture.
// Every request to the hosted project is intercepted; no live data is read or written.
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const {readFileSync,mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const {createBookingWorkflowFixture} = require('./booking-workflow-fixture.cjs');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const sports = ['Fotbal','Baschet','Tenis','Volei','Tenis Picior'];
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

async function openProfile(page) {
  const profile = page.locator('#btn-top-cont');
  if (await profile.isVisible()) {
    await profile.click();
    return;
  }
  const menu = page.locator('#home-mobile-menu');
  if (!await menu.isVisible()) await page.locator('#btn-mobile-menu').click();
  await menu.locator('[data-profile-target]').click();
}

(async () => {
  const pg = new PGlite();
  let browser;
  try {
    await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../001_security.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../003_court_hours.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../004_admin_scope_hardening.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../005_sport_appearance.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../006_sports_bases.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../007_completed_booking_cancellation.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../008_profile_edit.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../009_base_photos.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../010_foot_tennis.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../011_club_requests.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../012_club_approval.sql'),'utf8'));
    await pg.exec(readFileSync(join(__dirname,'../013_admin_integration.sql'),'utf8'));
    for (const file of ['014_booking_groups.sql', '015_profile_contact.sql', '016_notification_outbox.sql']) {
      await pg.exec(readFileSync(join(__dirname, '..', file), 'utf8'));
    }
    await pg.exec("update public.terenuri set poza='assets/imagini/avatar2.png'");
    const tomorrow=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text as d")).rows[0].d;
    let queue=Promise.resolve();
    const serial = fn => { const run=queue.then(fn); queue=run.catch(()=>{}); return run; };
    const requests=[];
    const bookingWorkflow = await createBookingWorkflowFixture({pg, host,
      resolveUser: bearer => {const person = tokens.get(bearer); return person ? uid(person) : null;}, records: requests});
    let logoutCount=0;
    let chatGate=null;
    const pauseChatPreflight=target=>{
      let enter,release,timeout;
      const entered=new Promise((resolve,reject)=>{
        timeout=setTimeout(()=>reject(new Error('Sender preflight did not reach the fixture gate')),10000);
        enter=()=>{clearTimeout(timeout);resolve();};
      });
      const wait=new Promise(resolve=>release=resolve);
      chatGate={enter,wait,target};return{entered,release};
    };
    const api = async route => {
      const pendingRequest=route.request(), pendingUrl=new URL(pendingRequest.url());
      if (chatGate && pendingRequest.method()==='GET' && pendingUrl.pathname.endsWith('/rezervari')
        && pendingRequest.frame().page()===chatGate.target
        && pendingRequest.headers()['x-spotivity-fixture-chat-send']==='1'
        && pendingUrl.searchParams.get('client_user_id')===`eq.${uid(1)}`
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
        if (url.pathname === '/functions/v1/booking-workflow') return bookingWorkflow.browserRoute(route);
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
            const n=body.email==='admin@example.test' ? 3 : body.email==='super@example.test' ? 4 : body.email==='bob@example.test' ? 2 : 1;
            const user=(await pg.query('select * from auth.users where id=$1',[uid(n)])).rows[0];
            return reply(200,{access_token:token(n),token_type:'bearer',refresh_token:`fixture-refresh-${n}`,expires_in:3600,user:{...user,app_metadata:{provider:'email'},user_metadata:user.raw_user_meta_data}});
          }
          if (url.pathname.endsWith('/user') && person) {
            const user=(await pg.query('select * from auth.users where id=$1',[uid(person)])).rows[0];
            return reply(200,{...user,app_metadata:{provider:'email'},user_metadata:user.raw_user_meta_data});
          }
          return reply(401,{message:'No fixture session'});
        }
        if (url.pathname==='/rest/v1/rpc/get_admin_access') {
          assert.equal(request.method(),'POST');
          await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
          return reply(200,(await pg.query('select public.get_admin_access() value')).rows[0].value);
        }
        if (url.pathname==='/rest/v1/rpc/save_sports_base') {
          assert.equal(request.method(),'POST');
          const body=request.postDataJSON(); recorded.body=body;
          await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
          const fields=['p_id','p_nume','p_oras','p_descriere','p_este_activa','p_court_ids','p_admin_ids'];
          const result=await pg.query('select public.save_sports_base($1::uuid,$2::text,$3::text,$4::text,$5::boolean,$6::text[],$7::uuid[]) as id',fields.map(field=>body[field]));
          return reply(200,result.rows[0].id);
        }
        const table=url.pathname.split('/').pop();
        assert.ok(['clienti','users_admin','terenuri','rezervari','rezervari_disponibilitate','mesaje_chat','site_sporturi','baze_sportive','baze_sportive_admini','cereri_baze_sportive'].includes(table));
        await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
        const params=[], conditions=[];
        for (const [field,value] of url.searchParams) {
          if (['select','order','limit','offset','columns'].includes(field)) continue;
          if (value==='is.null' || value==='not.is.null') {
            conditions.push(`${ident(field)} is ${value==='not.is.null'?'not ':''}null`);
          } else if (value.startsWith('in.(')) {
            const values=value.slice(4,-1).split(',').map(v=>v.replace(/^"|"$/g,''));
            const placeholders=values.map(v=>{params.push(v);return `$${params.length}`});
            conditions.push(`${ident(field)} in (${placeholders.join(',')})`);
          } else {
            const match=value.match(/^(eq|neq|ilike|gt|gte|lt|lte)\.(.*)$/s); assert.ok(match,value);
            const booleanField=['is_super','este_activ','este_activa','are_chat','optiune_minge','citit'].includes(field);
            params.push(booleanField && ['true','false'].includes(match[2]) ? match[2]==='true' : match[2]);
            conditions.push(`${ident(field)} ${{eq:'=',neq:'<>',ilike:'ilike',gt:'>',gte:'>=',lt:'<',lte:'<='}[match[1]]} $${params.length}`);
          }
        }
        const where=conditions.length ? ' where '+conditions.join(' and ') : '';
        if (request.method()==='HEAD') {
          const total=Number((await pg.query(`select count(*) total from public.${ident(table)}${where}`,params)).rows[0].total);
          return route.fulfill({status:200,headers:{'content-range':`*/${total}`,'access-control-expose-headers':'content-range'},body:''});
        }
        let query;
        if (request.method()==='GET') {
          const columns=(url.searchParams.get('select') || '*').split(',').map(c=>c==='*' ? '*' : ident(c)).join(',');
          query=`select ${columns} from public.${ident(table)}${where}`;
          if (url.searchParams.has('order')) {
            query+=' order by '+url.searchParams.get('order').split(',').map(o=>{const [col,direction]=o.split('.');return ident(col)+(direction==='desc'?' desc':' asc')}).join(',');
          }
          if (url.searchParams.has('limit')) {params.push(Number(url.searchParams.get('limit')));query+=` limit $${params.length}`;}
          if (url.searchParams.has('offset')) {params.push(Number(url.searchParams.get('offset')));query+=` offset $${params.length}`;}
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
    // Curl uses managed HTTPS trust; verify the pinned SRI before passing the
    // same SDK bytes to Chromium, which also enforces the page's integrity tag.
    const html=readFileSync(join(__dirname,'..','..','index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    assert.ok(sdkTag,'The application must pin Supabase SDK with SRI');
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2],'Downloaded SDK must match application SRI');
    const contexts=[];
    const browserErrors=[];
    const pageFor = async () => {
      const context=await browser.newContext({timezoneId:'Europe/Bucharest'}); contexts.push(context);
      await context.route(sdkTag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,
        headers:{'access-control-allow-origin':'*'}}));
      await context.route(url=>url.hostname===host,api);
      await context.routeWebSocket(url=>url.hostname===host,ws=>ws.close());
      const page=await context.newPage();
      page.on('dialog',async dialog=>{ await dialog.accept(); });
      page.on('pageerror',error=>{ browserErrors.push(error.message); console.error('Browser error:',error.message); });
      return page;
    };
    const pass = label => {checks++;console.log('PASS',label);};
    const openBaseAdmin = async target => {
      await target.goto(base,{waitUntil:'networkidle'});
      await openProfile(target);
      await target.locator('#login-email').fill('admin@example.test');
      await target.locator('#login-parola').fill(' test-password. ');
      await target.locator('#btn-executa-login').click();
      await target.locator('#modal-auth').waitFor({state:'hidden'});
      await openProfile(target);
      await target.locator('#btn-administreaza-baza').click();
      await target.locator('#base-admin-workspace').waitFor({state:'visible'});
      await target.locator('#sectiune-dashboard').waitFor({state:'visible'});
      assert.equal(new URL(target.url()).pathname,new URL(base).pathname,'Administration stays within the current site');
      assert.equal(await target.locator('#login-admin-btn').count(),0,'The integrated workspace reuses the current login');
    };
    const viewportWidths=[320,390,768,1440];
    const assertPngLoaded=async locator=>{
      const loaded=await locator.evaluate(async image=>{
        try {await image.decode();} catch {}
        return {src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth};
      });
      assert.match(loaded.src,/\.png(?:\?|$)/);
      assert.ok(loaded.complete && loaded.width>0,`Sport PNG did not load: ${JSON.stringify(loaded)}`);
    };
    const assertFits = async (target,selector,label) => {
      await target.waitForLoadState('networkidle');
      const dimensions=await target.evaluate(selector=>{
        const root=document.querySelector(selector),box=root.getBoundingClientRect();
        const visible=node=>node.getClientRects().length && getComputedStyle(node).visibility!=='hidden';
        // Court strips deliberately clip offscreen cards inside a bounded
        // horizontal scroller. Page and strip bounds remain mandatory checks.
        const inCourtStrip=node=>Boolean(node.closest('[data-home-courts]'))
          && getComputedStyle(node.closest('[data-home-courts]')).overflowX==='auto';
        const blocks=[root,...root.querySelectorAll('*')].filter(node=>visible(node)
          && !['INPUT','SELECT','TEXTAREA','IMG','SVG','PATH','OPTION'].includes(node.tagName)
          && !['inline','contents'].includes(getComputedStyle(node).display)
          && getComputedStyle(node).textOverflow!=='ellipsis'
          && !node.classList.contains('home-visually-hidden')
          && !(node.matches('[data-home-courts]') && getComputedStyle(node).overflowX==='auto'));
        return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,left:box.left,right:box.right,
          outsideControls:[...root.querySelectorAll('input,select,textarea,button')].filter(node=>visible(node) && !inCourtStrip(node)).map(node=>({node,rect:node.getBoundingClientRect()}))
            .filter(({rect})=>rect.left<box.left-1 || rect.right>box.right+1)
            .map(({node,rect})=>({id:node.id,tag:node.tagName,left:rect.left,right:rect.right})),
          overflow:blocks.filter(node=>node.clientWidth>0 && node.scrollWidth>node.clientWidth+1).map(node=>({
            tag:node.tagName,id:node.id,classes:String(node.className),width:node.clientWidth,scroll:node.scrollWidth
          })).slice(0,12)};
      },selector);
      if (screenshotDir && (dimensions.pageWidth>dimensions.viewport+1 || dimensions.left< -1
        || dimensions.right>dimensions.viewport+1 || dimensions.outsideControls.length || dimensions.overflow.length)) {
        await target.screenshot({path:join(screenshotDir,`layout-failure-${label.replace(/[^a-zA-Z0-9]+/g,'-').slice(0,120)}.png`)});
      }
      assert.ok(dimensions.pageWidth<=dimensions.viewport+1,`${label}: ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.left>=-1 && dimensions.right<=dimensions.viewport+1,`${label}: ${JSON.stringify(dimensions)}`);
      assert.deepEqual(dimensions.outsideControls,[],`${label}: ${JSON.stringify(dimensions)}`);
      assert.deepEqual(dimensions.overflow,[],`${label}: ${JSON.stringify(dimensions)}`);
    };
    const assertBackdrop = async (target,id) => {
      const result=await target.evaluate(id=>{
        const modal=document.getElementById(id),box=modal.getBoundingClientRect();
        const styles=[getComputedStyle(modal),getComputedStyle(modal,'::before'),getComputedStyle(modal,'::after')];
        const background=document.querySelector('.fundal-water'),backgroundBox=background.getBoundingClientRect();
        const fullBackgroundBlur=getComputedStyle(background).filter.includes('blur(')
          && backgroundBox.left<=1 && backgroundBox.top<=1 && backgroundBox.right>=innerWidth-1 && backgroundBox.bottom>=innerHeight-1;
        return {width:innerWidth,height:innerHeight,left:box.left,top:box.top,right:box.right,bottom:box.bottom,
          blurred:fullBackgroundBlur || styles.some(style=>[style.backdropFilter,style.webkitBackdropFilter].some(value=>value && value!=='none')),
          corners:[[0,0],[innerWidth-1,0],[0,innerHeight-1],[innerWidth-1,innerHeight-1]]
            .map(([x,y])=>Boolean(document.elementFromPoint(x,y)?.closest(`#${id}`)))};
      },id);
      assert.ok(result.left<=0 && result.top<=0 && result.right>=result.width && result.bottom>=result.height,JSON.stringify(result));
      assert.equal(result.blurred,true,JSON.stringify(result));
      assert.ok(result.corners.every(Boolean),JSON.stringify(result));
    };
    const assertCourtNames = async (target,names) => {
      // The input deliberately debounces for 150 ms; drain that queued render
      // before waiting for its network calls, rather than accepting an older list.
      await target.waitForTimeout(175);
      await target.waitForLoadState('networkidle');
      await target.waitForFunction(expected=>{
        const container=document.getElementById('container-dinamic-terenuri');
        const actual=[...container.querySelectorAll('.btn-teren h3')].map(node=>node.textContent).sort();
        const settledEmpty=container.textContent.trim() && container.textContent.trim()!==window.dict?.[window.lang]?.se_cauta;
        return JSON.stringify(actual)===JSON.stringify([...expected].sort()) && (expected.length || settledEmpty);
      },names);
      assert.deepEqual(await target.locator('#container-dinamic-terenuri .btn-teren h3').allTextContents(),names);
    };
    // These courts and reservations exist only in this disposable PostgreSQL fixture.
    const searchCourt='Ștrand Ștefănești <img src=x onerror="window.__courtXss=true">';
    const secondSearchCourt='Ștrand Sud';
    const followingDay=await serial(async()=>{
      await pg.exec('reset role');
      for (const [name,city] of [[searchCourt,'Târgu Mureș'],[secondSearchCourt,'București']]) {
        await pg.query("insert into public.terenuri(nume,sport,oras,pret,optiune_minge,este_activ,poza,ore_rezervabile) values($1,'Fotbal',$2,100,false,true,'assets/imagini/avatar2.png',$3)",[name,city,['12:00','13:00']]);
      }
      await pg.query("insert into public.rezervari(email_client,teren,data_str,ora,stare) values('Teren Blocat',$1,$2,'12:00','activa')",[searchCourt,tomorrow]);
      return (await pg.query("select ($1::date+1)::text as d",[tomorrow])).rows[0].d;
    });
    const searchPage=await pageFor();
    await searchPage.goto(base,{waitUntil:'networkidle'});
    assert.equal(await searchPage.evaluate(()=>typeof window.supabase?.createClient),'function','The pinned Supabase SDK must load with TLS and SRI verification before UI checks run.');
    await searchPage.locator('.card-sport[data-sport="Fotbal"]').click();
    await searchPage.locator('#filtru-nume').fill('sTrAnD StEfAnEsTi');
    await assertCourtNames(searchPage,[searchCourt]);
    assert.equal(await searchPage.evaluate(()=>window.__courtXss),undefined);
    assert.equal(await searchPage.locator('img[src="x"]').count(),0);
    await searchPage.locator('#filtru-nume').fill('<img src=x');
    await assertCourtNames(searchPage,[searchCourt]);
    await searchPage.locator('#filtru-nume').fill('no matching court');
    await assertCourtNames(searchPage,[]);
    assert.notEqual((await searchPage.locator('#container-dinamic-terenuri').innerText()).trim(),'0');
    pass('court-name search matches case and Romanian diacritics and renders literal HTML as safe text');
    await searchPage.locator('#filtru-nume').fill('strand');
    await searchPage.locator('#filtru-data').fill(tomorrow);
    await searchPage.locator('#filtru-data').dispatchEvent('change');
    await searchPage.locator('#filtru-ora').selectOption('12:00');
    await assertCourtNames(searchPage,[secondSearchCourt]);
    await searchPage.locator('#filtru-data').fill(followingDay);
    await searchPage.locator('#filtru-data').dispatchEvent('change');
    await assertCourtNames(searchPage,[searchCourt,secondSearchCourt]);
    await searchPage.locator('#filtru-nume').fill('');
    await assertCourtNames(searchPage,['Court A',searchCourt,secondSearchCourt]);
    assert.equal(await searchPage.locator('#filtru-data').inputValue(),followingDay);
    assert.equal(await searchPage.locator('#filtru-ora').inputValue(),'12:00');
    await searchPage.locator('#filtru-nume').fill('retained draft');
    await searchPage.locator('#inchide-terenuri').click();
    await searchPage.locator('#filtru-oras-global').selectOption('Târgu Mureș');
    await searchPage.locator('.card-sport[data-sport="Fotbal"]').click();
    assert.equal(await searchPage.locator('#filtru-nume').inputValue(),'');
    await assertCourtNames(searchPage,[searchCourt]);
    await searchPage.locator('#filtru-nume').fill('Sud');
    await assertCourtNames(searchPage,[]);
    await searchPage.locator('#filtru-nume').fill('');
    await assertCourtNames(searchPage,[searchCourt]);
    pass('name search combines city, date and hour availability, clears independently and resets on a newly opened chooser');
    for (const width of viewportWidths) {
      await searchPage.setViewportSize({width,height:844});
      await assertFits(searchPage,'#modal-terenuri .modal-continut',`public chooser ${width}px`);
      await assertBackdrop(searchPage,'modal-terenuri');
      const header=await searchPage.locator('#inchide-terenuri').evaluate(button=>{
        const title=document.getElementById('titlu-terenuri') || button.parentElement.querySelector('h2');
        const close=button.getBoundingClientRect(),heading=title.getBoundingClientRect();
        return {close:{left:close.left,top:close.top,right:close.right,bottom:close.bottom,width:close.width,height:close.height},
          heading:{left:heading.left,top:heading.top,right:heading.right,bottom:heading.bottom}};
      });
      assert.ok(header.close.width>=40 && header.close.height>=40,JSON.stringify(header));
      assert.ok(header.heading.right<=header.close.left+1 || header.heading.bottom<=header.close.top+1,JSON.stringify(header));
      if (screenshotDir) await searchPage.screenshot({path:join(screenshotDir,`spotivity-search-${width}.png`)});
      pass(`public court chooser and blurred backdrop fit the full ${width}px viewport`);
    }
    await serial(async()=>{
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      await pg.query('delete from public.rezervari where teren=$1',[searchCourt]);
      await pg.query('delete from public.terenuri where nume in ($1,$2)',[searchCourt,secondSearchCourt]);
    });
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
    await page.locator('#modal-rezervare-vizitator').waitFor({state:'visible'});
    assert.equal(await page.locator('#modal-auth').isVisible(),false);
    assert.equal(await page.locator('#modal-rezervare-vizitator input[type="password"]').count(),0);
    assert.equal(await page.locator('#modal-rezervare').isVisible(),true);
    await page.locator('#guest-contact_name').fill('Guest browser');
    await page.locator('#guest-email').fill('browser-guest@example.test');
    await page.locator('#guest-phone').fill('+40 733 222 111');
    await page.locator('#guest-booking-submit').click();
    await page.locator('#modal-rezervare-vizitator').waitFor({state:'hidden'});
    await page.locator('#modal-rezervare').waitFor({state:'hidden'});
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      assert.equal((await pg.query('select count(*)::int n from auth.users')).rows[0].n,4);
      assert.equal((await pg.query("select count(*)::int n from public.clienti where email='browser-guest@example.test'")).rows[0].n,0);
      const row=(await pg.query("select * from public.rezervari where email_client='browser-guest@example.test'")).rows[0];
      assert.equal(row.client_user_id,null);assert.equal(row.guest_name,'Guest browser');
      assert.equal(row.guest_phone,'+40 733 222 111');assert.equal(row.stare,'activa');
    });
    const guestMail=bookingWorkflow.mail.find(mail=>mail.kind==='booking_created_client' && mail.to.email==='browser-guest@example.test');
    assert.ok(guestMail,'Actual Edge worker must submit the guest confirmation to the local Make adapter');
    assert.match(guestMail.html,/Anulează rezervarea/);
    const cancellationURL=new URL(guestMail.text.match(/https:\/\/[^\s]+#anulare-rezervare=[^\s]+/)[0]);
    const guestCancellation=await pageFor();
    await guestCancellation.goto(new URL(cancellationURL.hash,base).href,{waitUntil:'networkidle'});
    await guestCancellation.locator('#email-booking-cancel-confirm').waitFor({state:'visible'});
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query("select stare from public.rezervari where email_client='browser-guest@example.test'")).rows[0].stare,'activa');
    });
    await guestCancellation.locator('#email-booking-cancel-confirm').click();
    await guestCancellation.locator('#modal-anulare-rezervare-email .workflow-status').getByText('Istoricul este păstrat.',{exact:false}).waitFor();
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query("select stare from public.rezervari where email_client='browser-guest@example.test'")).rows[0].stare,'anulata');
    });
    assert.ok(bookingWorkflow.mail.some(mail=>mail.kind==='booking_cancelled_client' && mail.to.email==='browser-guest@example.test'));
    await guestCancellation.close();
    pass('guest reserves through the real Edge/SQL without an account and cancels only after confirming the email link, preserving history');
    await openProfile(page);
    await page.locator('#modal-auth').waitFor({state:'visible'});
    await page.locator('#login-email').fill('alice@example.test');
    await page.locator('#login-parola').fill(' test-password. ');
    await page.locator('#btn-executa-login').click();
    await page.locator('#modal-auth').waitFor({state:'hidden'});
    await chooseSlot();
    await page.locator('.btn-ora').filter({hasText:/^14:00$/}).click();
    assert.match(await page.locator('.btn-ora').filter({hasText:/^12:00$/}).getAttribute('class'),/selectat/);
    assert.doesNotMatch(await page.locator('.btn-ora').filter({hasText:/^14:00$/}).getAttribute('class'),/selectat/);
    assert.match(await page.locator('#booking-consecutive-note').innerText(),/consecutive/);
    assert.equal(await page.locator('#modal-rezervare').isVisible(),true);
    await page.locator('#inchide-rezervare').click();
    pass('the picker prevents nonconsecutive hours and preserves the existing selection');
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
    await page.waitForFunction(()=>!document.body.classList.contains('fara-scroll'));
    assert.equal(await page.locator('.home-sport-hero').count(),sports.length);
    const notice=page.locator('#notificare-rezervare');
    await notice.waitFor({state:'visible'});
    assert.equal(await notice.getAttribute('role'),'status');
    assert.match(await page.locator('#notificare-rezervare-text').innerText(),/^Rezervarea este confirmată\./);
    await serial(async () => {
      await pg.exec('reset role');
      const rows=(await pg.query("select * from public.rezervari where stare='activa' order by ora")).rows;
      assert.equal(rows.length,2);assert.equal(rows[0].data_str,tomorrow);
      assert.equal(rows[0].pret_total,'115 RON (+Minge)');assert.equal(rows[1].pret_total,'100 RON');
      assert.ok(rows.every(r=>r.client_user_id===uid(1)));
    });
    assert.ok(bookingWorkflow.mail.some(mail=>mail.kind==='booking_created_client' && mail.to.email==='alice@example.test'));
    assert.ok(bookingWorkflow.mail.some(mail=>mail.kind==='booking_created_owner' && mail.record.customerEmail==='alice@example.test'));
    assert.match(await page.locator('#notificare-rezervare-text').innerText(),/trimise serviciului de email/);
    pass('real SDK login and two-hour booking work with RLS and server pricing');
    await page.clock.runFor(9999);
    assert.equal(await notice.isVisible(),true);
    await page.clock.runFor(1);
    await notice.waitFor({state:'hidden'});
    await page.clock.resume();
    pass('successful booking restores the homepage and keeps its email status notice readable for ten seconds');
    await chooseSlot('15:00');
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false); update public.terenuri set este_activ=false where nume='Court A'");
    });
    const failedBookingResponse=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.hostname===host && url.pathname==='/functions/v1/booking-workflow' && response.request().method()==='POST';
    });
    await page.locator('#buton-confirma').click();
    assert.equal((await failedBookingResponse).status(),409);
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
      return (await pg.query("select id from public.rezervari where stare='activa' and ora='12:00'")).rows[0].id;
    });
    await openProfile(page);
    await page.locator('#btn-vezi-active').click();
    await page.locator(`.anulare-client[data-id="${futureId}"]`).click();
    await page.locator(`.anulare-client[data-id="${futureId}"]`).waitFor({state:'hidden'});
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query('select stare from public.rezervari where id=$1',[futureId])).rows[0].stare,'anulata');
      assert.equal((await pg.query("select count(*)::int n from public.rezervari where booking_group_id=(select booking_group_id from public.rezervari where id=$1) and stare='activa'",[futureId])).rows[0].n,0);
      assert.equal((await pg.query('select * from public.rezervari_disponibilitate where id=$1',[String(futureId)])).rows.length,0);
    });
    pass('client cancels all consecutive hours as one booking and releases every public slot');
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      // A historical ungrouped row predates the subsequent hours configuration.
      await pg.query("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$1,'Court A',$2,'12:00','activa')",[uid(1),tomorrow]);
    });
    const pastId=await serial(async () => {
      await pg.exec('reset role');
      await pg.query("select set_config('request.jwt.claim.sub','',false)");
      return (await pg.query("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$1,'Court A',((now() at time zone 'Europe/Bucharest')::date-1)::text,'16:00','activa') returning id",[uid(1)])).rows[0].id;
    });
    await page.locator('#inapoi-la-profil').click();
    await page.locator('#btn-vezi-istoric').click();
    await page.waitForFunction(()=>document.getElementById('container-rezervari').textContent.includes('FINALIZED'));
    assert.equal(await page.locator(`.anulare-client[data-id="${pastId}"]`).count(),0);
    assert.match(await page.locator('#container-rezervari').innerText(),/FINALIZED/);
    const pastCancel=await page.evaluate(async id=>{
      const result=await db.from('rezervari').update({stare:'anulata'}).eq('id',id);
      return {error:result.error?.message};
    },pastId);
    assert.match(pastCancel.error,/finished|completed|finalizat|încheiat/i);
    assert.equal(await page.evaluate(()=>window.tipIstoricDeschis),'istoric');
    assert.equal(await page.locator('#titlu-lista-rezervari').innerText(),'Istoric Rezervări');
    await serial(async () => {
      await pg.exec('reset role');
      assert.equal((await pg.query('select stare from public.rezervari where id=$1',[pastId])).rows[0].stare,'activa');
    });
    pass('finished bookings remain in history without cancellation controls and direct API cancellation is denied');
    await page.locator('#inchide-istoric-client').click();
    await openProfile(page);
    await page.locator('#btn-logout').click();
    await page.locator('#modal-profil').waitFor({state:'hidden'});
    assert.equal(logoutCount,1);
    pass('logout signs out of Supabase, not just the UI');
    await openProfile(page);
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
      await pg.query('update public.users_admin set nume_admin=$1 where user_id=$2',['Manager_'+'UnbrokenRoleName'.repeat(8),uid(3)]);
    });
    const admin=await pageFor();
    await openBaseAdmin(admin);
    await admin.waitForFunction(()=>document.querySelector('[id^="modal-setari-"]')!==null);
    assert.equal(await admin.locator('[id^="modal-setari-"]').count(),1);
    assert.ok(requests.some(r=>r.path.endsWith('/rpc/get_admin_access') && r.person===3));
    pass('the integrated workspace reuses the Auth session and exposes settings only for its allocated court');
    await admin.locator('[data-admin-program="Fotbal"]').click();
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
    assert.equal(await admin.locator('.sub-pagina-oras').count(),0);
    assert.equal(await admin.locator('#container-meniu-terenuri .admin-court-card').count(),1);
    const allocatedCard=admin.locator('#container-meniu-terenuri .admin-court-card');
    assert.match(await allocatedCard.getAttribute('aria-label'),/Court A/);
    const allocatedIcon=admin.locator('[data-admin-sport="Fotbal"] .base-admin-sport-heading img');
    assert.equal(await allocatedIcon.count(),1);
    assert.match(await allocatedIcon.getAttribute('src'),/fotbalrealist\.png(?:\?|$)/);
    await assertPngLoaded(allocatedIcon);
    await allocatedCard.click();
    pass('ordinary admin opens its allocated court settings directly with the matching PNG sport icon');
    const settingsId=(await admin.locator('[id^="modal-setari-"]').getAttribute('id')).slice('modal-setari-'.length);
    assert.match(await admin.locator(`#modal-setari-${settingsId} .admin-settings-header img`).getAttribute('src'),/fotbalrealist\.png(?:\?|$)/);
    await assertPngLoaded(admin.locator(`#modal-setari-${settingsId} .admin-settings-header img`));
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
    const settingsReload=admin.waitForRequest(request=>new URL(request.url()).pathname==='/rest/v1/rpc/get_admin_access' && request.method()==='POST');
    await admin.locator(`#btn-save-${settingsId}`).click();
    assert.equal((await settingsResponse).status(),200);
    await serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      assert.deepEqual((await pg.query("select ore_rezervabile from public.terenuri where nume='Court A'")).rows[0].ore_rezervabile,enabledHours);
      assert.equal((await pg.query("select oras from public.terenuri where nume='Court A'")).rows[0].oras,'Test City');
    });
    await settingsReload;
    await admin.waitForFunction(id=>document.getElementById(`btn-save-${id}`)?.disabled===false,settingsId);
    // The integrated refresh may already have replaced and closed the editor.
    // Escape on the workspace itself intentionally returns to the profile.
    if (await admin.locator(`#modal-setari-${settingsId}`).isVisible()) await admin.keyboard.press('Escape');
    assert.equal(await admin.locator('#base-admin-workspace').isVisible(),true);
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
    await admin.locator('[data-admin-program="Fotbal"]').click();
    await admin.locator('#tabel-data').fill(tomorrow);
    await admin.locator('#tabel-data').dispatchEvent('change');
    await admin.locator('#tabel-corp-program tr[data-ora="09:00"]').getByText(longManualName,{exact:false}).waitFor();
    assert.deepEqual(await admin.locator('#tabel-corp-program tr[data-ora]').evaluateAll(nodes=>nodes.map(node=>node.dataset.ora)),['09:00','10:00','11:00','12:00','14:00']);
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
    await openProfile(configuredClient);
    await configuredClient.locator('#login-email').fill('bob@example.test');
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
      assert.equal(reserved.client_user_id,uid(2));
      assert.equal(reserved.pret_total,'100 RON');
    });
    pass('public booking offers only configured hours and a real SDK booking at 10:00 passes server validation');
    const outsideHour=await serial(async () => {
      await pg.exec('reset role');
      return (await pg.query("select * from public.rezervari where teren='Court A' and data_str=$1 and ora='12:00' and stare='activa'",[tomorrow])).rows[0];
    });
    await configuredClient.evaluate(()=>db.auth.signInWithPassword({email:'alice@example.test',password:' test-password. '}));
    await configuredClient.waitForFunction(()=>window.getSpotivityProfileUser()?.email==='alice@example.test');
    await openProfile(configuredClient);
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
    await admin.locator('#select-stare-1100').selectOption('ocupat');
    await admin.locator('#form-inline-1100').waitFor({state:'visible'});
    await admin.locator('#inline-nume-1100').fill(longManualName);
    for (const width of viewportWidths) {
      await admin.setViewportSize({width,height:844});
      await assertFits(admin,'#modal-tabel-program .modal-continut',`admin schedule including inline booking ${width}px`);
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
      const statusLabels=await admin.locator('.program-tabel select').evaluateAll(nodes=>nodes.map(node=>{
        const style=getComputedStyle(node),context=document.createElement('canvas').getContext('2d');
        context.font=style.font;
        const textWidth=Math.max(...[...node.options].map(option=>context.measureText(option.textContent).width));
        return {id:node.id,width:node.getBoundingClientRect().width,textWidth,
          required:textWidth+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)
            +parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth)+18};
      }));
      assert.ok(statusLabels.every(label=>label.required<=label.width+1),JSON.stringify({width,statusLabels}));
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
    await openProfile(subpathPage);
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
      await pg.query("insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values('alice@example.test',$2,'Court A',$1,'11:00','activa')",[tomorrow,uid(1)]);
    });
    const chatPage=await pageFor();await chatPage.goto(base,{waitUntil:'networkidle'});
    // Identify the sender's actual preflight without pausing concurrent permission refreshes.
    // This fixture-only metadata does not change filters, authentication, or application code.
    await chatPage.evaluate(()=>{
      const originalFrom=db.from.bind(db);
      db.from=(table,...args)=>{
        const query=originalFrom(table,...args);
        if (table==='rezervari' && new Error().stack?.includes('trimiteMesajClient')) {
          if (typeof query.headers?.set==='function') {
            query.headers=new Headers(query.headers);
            query.headers.set('x-spotivity-fixture-chat-send','1');
          } else query.headers={...query.headers,'x-spotivity-fixture-chat-send':'1'};
        }
        return query;
      };
    });
    const selectSettledClientCourt=async court=>{
      // A card opens the conversation and then refreshes its list; both paths recheck permission.
      // Wait for both actual responses before typing a draft that the list refresh would clear.
      let complete,count=0;
      const refreshed=new Promise((resolve,reject)=>{
        complete={resolve,reject};
      });
      const timeout=setTimeout(()=>complete.reject(new Error(`Chat selection did not finish refreshing ${court}`)),10000);
      const response=reply=>{
        const url=new URL(reply.url());
        if (reply.request().method()==='GET' && url.pathname.endsWith('/rezervari')
          && url.searchParams.get('select')==='*' && url.searchParams.get('teren')===`eq.${court}`
          && url.searchParams.get('stare')==='eq.activa' && ++count===2) complete.resolve();
      };
      chatPage.on('response',response);
      try {
        await chatPage.locator('#chat-client-lista-terenuri .card-conversatie').filter({hasText:court}).click();
        await refreshed;
        await chatPage.waitForLoadState('networkidle');
        await chatPage.waitForFunction(court=>document.getElementById('chat-client-teren-titlu').innerText.includes(court)
          && !document.getElementById('chat-client-input').disabled
          && !document.getElementById('chat-client-btn-trimite').disabled,court);
      } finally {clearTimeout(timeout);chatPage.off('response',response);}
    };
    await chatPage.evaluate(async()=>{await db.auth.signInWithPassword({email:'alice@example.test',password:' test-password. '})});
    await chatPage.waitForFunction(()=>document.getElementById('btn-top-cont').innerText.includes('Contul'));
    await openProfile(chatPage);await chatPage.locator('#modal-profil').waitFor({state:'visible'});
    await chatPage.locator('#btn-vezi-chat').click();await chatPage.locator('#modal-chat-client').waitFor({state:'visible'});
    await selectSettledClientCourt('Court A');
    const chatPause=pauseChatPreflight(chatPage);await chatPage.locator('#chat-client-input').fill('Message intended for Court A');
    await chatPage.locator('#chat-client-btn-trimite').click();await chatPause.entered;
    await serial(async()=>{await pg.exec('reset role');assert.equal((await pg.query("select id from public.mesaje_chat where mesaj='Message intended for Court A'")).rows.length,0)});
    await chatPage.locator('#chat-client-lista-terenuri .card-conversatie').filter({hasText:'Court B'}).click();
    await chatPage.locator('#chat-client-teren-titlu').getByText('Court B',{exact:false}).waitFor();
    chatPause.release();await chatPage.waitForLoadState('networkidle');
    await serial(async()=>{await pg.exec('reset role');assert.equal((await pg.query("select id from public.mesaje_chat where mesaj='Message intended for Court A'")).rows.length,0)});
    pass('switching the chat court during preflight never sends the previous draft to another court');
    await selectSettledClientCourt('Court A');
    const logoutPause=pauseChatPreflight(chatPage);await chatPage.locator('#chat-client-input').fill('Message cancelled by logout');
    await chatPage.locator('#chat-client-btn-trimite').click();await logoutPause.entered;
    await serial(async()=>{await pg.exec('reset role');assert.equal((await pg.query("select id from public.mesaje_chat where mesaj='Message cancelled by logout'")).rows.length,0)});
    await chatPage.evaluate(async()=>{await db.auth.signOut({scope:'local'})});
    await chatPage.locator('#modal-chat-client').waitFor({state:'hidden'});logoutPause.release();await chatPage.waitForLoadState('networkidle');
    assert.equal(await chatPage.locator('#chat-client-mesaje').innerText(),'');
    await serial(async()=>{await pg.exec('reset role');assert.equal((await pg.query("select id from public.mesaje_chat where mesaj='Message cancelled by logout'")).rows.length,0)});
    pass('logout during chat preflight clears private messages and aborts sending');
    await admin.keyboard.press('Escape');
    // Open each screen through the role's real navigation, without submitting mutations.
    const ordinaryScreens=['modal-rezervare-manuala','modal-tabel-program','modal-istoric','modal-chat-admin',`modal-setari-${settingsId}`];
    for (const width of viewportWidths) {
      await admin.setViewportSize({width,height:844});
      await assertFits(admin,'#sectiune-dashboard',`ordinary dashboard ${width}px`);
      assert.doesNotMatch(await admin.locator('#sectiune-dashboard').innerText(),/\p{Extended_Pictographic}/u);
      if (screenshotDir) await admin.screenshot({path:join(screenshotDir,`spotivity-admin-dashboard-${width}.png`)});
      for (const id of ordinaryScreens) {
        if (id==='modal-chat-admin') await admin.locator('#btn-vezi-chat-admin').click();
        else if (id==='modal-tabel-program') await admin.locator('[data-admin-program="Fotbal"]').click();
        else if (id.startsWith('modal-setari-')) await admin.locator(`[data-admin-court="${settingsId}"]`).click();
        else await admin.locator(`.card-sport[onclick*="${id}"]`).click();
        await admin.locator(`#${id}`).waitFor({state:'visible'});
        if (id==='modal-istoric') {
          await admin.locator('#btn-istoric').click();
          await admin.locator('#container-istoric').getByText(longManualName,{exact:false}).first().waitFor();
        }
        if (id==='modal-chat-admin') {
          const conversation=admin.locator('#chat-admin-lista-conversații .card-conversatie').first();
          // Reopening refreshes the message and client queries. An empty list
          // during that refresh does not mean a mobile conversation is open.
          await conversation.waitFor({state:'attached'});
          await admin.waitForLoadState('networkidle');
          if (!(await conversation.isVisible())) await admin.locator('#btn-inapoi-conversatie-admin').click();
          await assertFits(admin,'#modal-chat-admin .modal-continut',`admin chat conversation list ${width}px`);
          await conversation.click();
          await admin.locator('#chat-admin-mesaje .mesaj-bula').first().waitFor();
        }
        await assertFits(admin,`#${id} .modal-continut`,`${id} ordinary ${width}px`);
        await assertBackdrop(admin,id);
        assert.doesNotMatch(await admin.locator(`#${id}`).innerText(),/\p{Extended_Pictographic}/u);
        if (screenshotDir) await admin.screenshot({path:join(screenshotDir,`spotivity-admin-${id}-${width}.png`)});
        await admin.keyboard.press('Escape');
        await admin.locator(`#${id}`).waitFor({state:'hidden'});
      }
      pass(`ordinary admin dashboard, settings, manual booking, history and chat fit ${width}px without horizontal overflow or emojis`);
    }
    // A sign-out from another tab must remove cached privileged data.
    await admin.evaluate(async()=>{await db.auth.signOut({scope:'local'})});
    await admin.locator('#base-admin-workspace').waitFor({state:'hidden'});
    assert.equal(await admin.locator('#btn-administreaza-baza').isVisible(),false);
    assert.ok(!(await admin.locator('#sectiune-dashboard').isVisible()));
    assert.equal(await admin.locator('#container-meniu-terenuri').innerText(),'');
    assert.equal(await admin.locator('#chat-admin-mesaje').innerText(),'');
    assert.equal(await admin.locator('[id^="modal-setari-"]').count(),0);
    pass('admin auth sign-out clears cached settings, program and private chat');
    const longCity='Orașul_'+'UnbrokenCityName'.repeat(10);
    const longCourt='Terenul_'+'UnbrokenCourtName'.repeat(10);
    const superCourts=await serial(async()=>{
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      await pg.query('update public.users_admin set nume_admin=$1 where user_id=$2',['Super_'+'UnbrokenRoleName'.repeat(8),uid(4)]);
      await pg.query('update public.terenuri set oras=$1 where nume=$2',[longCity,'Court B']);
      for (const [name,sport] of [[longCourt,'Baschet'],['Picior Court','Tenis Picior']]) {
        await pg.query("insert into public.terenuri(nume,sport,oras,pret,pret_minge,optiune_minge,este_activ,poza) values($1,$2,$3,100,$4,false,true,'assets/imagini/avatar2.png')",[name,sport,longCity,sport==='Tenis Picior'?0:15]);
      }
      return (await pg.query('select id,nume,sport,oras,pret_minge from public.terenuri order by id')).rows;
    });
    const superAdmin=await pageFor();
    await superAdmin.goto(base,{waitUntil:'networkidle'});await openProfile(superAdmin);
    await superAdmin.locator('#modal-auth').waitFor({state:'visible'});
    for (const width of viewportWidths) {
      await superAdmin.setViewportSize({width,height:844});
      await assertFits(superAdmin,'#modal-auth .modal-continut',`site login for superadmin ${width}px`);
      assert.doesNotMatch(await superAdmin.locator('#modal-auth').innerText(),/\p{Extended_Pictographic}/u);
    }
    await superAdmin.locator('#login-email').fill('super@example.test');
    await superAdmin.locator('#login-parola').fill(' test-password. ');
    await superAdmin.locator('#btn-executa-login').click();await superAdmin.locator('#modal-auth').waitFor({state:'hidden'});
    await openProfile(superAdmin);await superAdmin.locator('#btn-administreaza-baza').waitFor({state:'visible'});
    assert.equal(await superAdmin.locator('#btn-administreaza-baza').innerText(),'Deschide panoul de admin');
    const superURL=superAdmin.url(),superPages=superAdmin.context().pages().length;
    await superAdmin.locator('#btn-administreaza-baza').click();
    await superAdmin.locator('#base-admin-workspace.base-admin-super').waitFor({state:'visible'});
    await superAdmin.locator('#sectiune-dashboard').waitFor({state:'visible'});
    assert.equal(superAdmin.url(),superURL);assert.equal(superAdmin.context().pages().length,superPages);assert.equal(await superAdmin.locator('iframe').count(),0);
    await superAdmin.waitForFunction(count=>document.querySelectorAll('[id^="modal-setari-"]').length===count,superCourts.length);
    assert.equal(await superAdmin.locator('#container-meniu-terenuri .admin-court-card').count(),0);
    const cities=superAdmin.locator('#container-meniu-terenuri .admin-city-card');
    assert.equal(await cities.count(),3);
    for (const cityCard of await cities.all()) {
      assert.match(await cityCard.innerText(),/^Setări\s/);
      await cityCard.click();
      const cityPage=superAdmin.locator('.sub-pagina-oras:visible');
      for (const courtCard of await cityPage.locator('.admin-court-card').all()) {
        const courtName=await courtCard.locator('.admin-card-name').innerText();
        const court=superCourts.find(court=>court.nume===courtName);
        assert.ok(court,courtName);
        const asset={Fotbal:'fotbalrealist',Baschet:'baschetrealist',Tenis:'tenisrealist',Volei:'voleirealist','Tenis Picior':'fotbalrealist'}[court.sport];
        assert.equal(await courtCard.locator('img').getAttribute('src'),`assets/imagini/${asset}.png`);
        await assertPngLoaded(courtCard.locator('img'));
        await courtCard.click();
        await superAdmin.locator(`#modal-setari-${court.id}`).waitFor({state:'visible'});
        assert.equal(await superAdmin.locator(`#modal-setari-${court.id} .admin-settings-header img`).getAttribute('src'),`assets/imagini/${asset}.png`);
        await assertPngLoaded(superAdmin.locator(`#modal-setari-${court.id} .admin-settings-header img`));
        assert.equal(await superAdmin.locator(`#pret-minge-${court.id}`).inputValue(),String(court.pret_minge ??15));
        await superAdmin.locator(`#modal-setari-${court.id} .buton-inchidere`).click();
      }
      await cityPage.locator('[onclick*="inchideSubPaginaOras"]').click();
    }
    pass('only superadmin navigates Setări city → allocated court settings with PNG icons for each sport, including foot tennis');
    for (const width of viewportWidths) {
      await superAdmin.setViewportSize({width,height:844});
      await assertFits(superAdmin,'#sectiune-dashboard',`superadmin dashboard ${width}px`);
      assert.doesNotMatch(await superAdmin.locator('#sectiune-dashboard').innerText(),/\p{Extended_Pictographic}/u);
      for (const cityCard of await cities.all()) {
        await cityCard.click();
        await assertFits(superAdmin,'.sub-pagina-oras[style*="display: block"]',`superadmin city page ${width}px`);
        assert.doesNotMatch(await superAdmin.locator('.sub-pagina-oras:visible').innerText(),/\p{Extended_Pictographic}/u);
        if (screenshotDir) {
          const cityPageId=await superAdmin.locator('.sub-pagina-oras:visible').getAttribute('id');
          await superAdmin.screenshot({path:join(screenshotDir,`spotivity-super-${cityPageId}-${width}.png`)});
        }
        for (const courtCard of await superAdmin.locator('.sub-pagina-oras:visible .admin-court-card').all()) {
          const courtName=await courtCard.locator('.admin-card-name').innerText();
          const court=superCourts.find(court=>court.nume===courtName);
          await courtCard.click();
          await assertFits(superAdmin,`#modal-setari-${court.id} .modal-continut`,`superadmin ${court.nume} settings ${width}px`);
          assert.doesNotMatch(await superAdmin.locator(`#modal-setari-${court.id}`).innerText(),/\p{Extended_Pictographic}/u);
          await superAdmin.locator(`#modal-setari-${court.id} .buton-inchidere`).click();
        }
        await superAdmin.locator('.sub-pagina-oras:visible [onclick*="inchideSubPaginaOras"]').click();
      }
      for (const id of ['modal-adauga-teren','modal-creeaza-cont']) {
        await superAdmin.locator(`.card-sport[onclick*="${id === 'modal-adauga-teren' ? 'deschideModalAdaugaTeren' : id}"]`).click();
        await superAdmin.locator(`#${id}`).waitFor({state:'visible'});
        if (id==='modal-adauga-teren') await superAdmin.locator('#container-lista-terenuri').getByText(longCourt,{exact:false}).waitFor();
        if (id==='modal-adauga-teren') {
          assert.deepEqual((await superAdmin.locator('#teren-sport option').evaluateAll(nodes=>nodes.map(node=>node.value))).sort(),[...sports].sort());
          assert.equal(await superAdmin.locator('#teren-sport option[value="Tenis Picior"]').innerText(),'Tenis de picior');
        }
        if (id==='modal-creeaza-cont') await superAdmin.locator('#container-checkbox-terenuri').getByText(longCourt,{exact:false}).waitFor();
        await assertFits(superAdmin,`#${id} .modal-continut`,`superadmin ${id} ${width}px`);
        assert.doesNotMatch(await superAdmin.locator(`#${id}`).innerText(),/\p{Extended_Pictographic}/u);
        if (screenshotDir) await superAdmin.screenshot({path:join(screenshotDir,`spotivity-super-${id}-${width}.png`)});
        await superAdmin.keyboard.press('Escape');
      }
      pass(`superadmin city pages, every court settings dialog, court management and employee allocation fit ${width}px with long names`);
    }
    const mobile=await pageFor();
    await mobile.goto(base,{waitUntil:'networkidle'});
    await mobile.evaluate(()=>window.spotivitySportAppearanceReady);
    assert.equal(await mobile.locator('.home-sport-hero').count(),sports.length);
    assert.equal(await mobile.locator('.card-sport[data-sport]').count(),sports.length);
    assert.equal(await mobile.locator('#home-brand img').getAttribute('src'),'assets/imagini/avatar2.png');
    await assertPngLoaded(mobile.locator('#home-brand img'));
    const appearanceRows=await serial(async()=>{
      await pg.exec('reset role');
      return (await pg.query('select sport,icona_url,fundal_url from public.site_sporturi order by ordine')).rows;
    });
    assert.equal(appearanceRows.length,sports.length);
    assert.deepEqual(appearanceRows.map(row=>row.sport),sports);
    for (const appearance of appearanceRows) {
      const hero=mobile.locator(`.home-sport-hero[data-home-sport="${appearance.sport}"]`);
      assert.equal(await hero.count(),1);
      await hero.scrollIntoViewIfNeeded();
      assert.equal(await hero.locator(`[data-sport-background="${appearance.sport}"]`).getAttribute('src'),appearance.fundal_url);
      assert.equal(await hero.locator('[data-sport-icon]').count(),0,'Sport headlines must be text only');
      await assertPngLoaded(hero.locator('[data-sport-background]'));

    }
    assert.ok(requests.some(request=>request.path==='/rest/v1/site_sporturi' && request.method==='GET' && !request.person));
    pass('all five sport sections have text-only headings and Supabase-configured realistic backgrounds with the avatar2 brand');
    await mobile.evaluate(()=>window.spotivityDiscoveryReady);
    const footCourt=superCourts.find(court=>court.sport==='Tenis Picior');
    assert.ok(footCourt);
    const footStrip=mobile.locator('[data-home-courts="Tenis Picior"]');
    assert.deepEqual(await footStrip.locator('[data-discovery-court]').evaluateAll(nodes=>nodes.map(node=>node.dataset.discoveryCourt)),[String(footCourt.id)]);
    assert.equal(await mobile.locator(`[data-home-courts="Fotbal"] [data-discovery-court="${footCourt.id}"]`).count(),0);
    await mobile.locator('#filtru-oras-global').selectOption('Test City');
    assert.equal(await footStrip.locator('[data-discovery-court]').count(),0);
    await mobile.locator('#filtru-oras-global').selectOption(longCity);
    assert.deepEqual(await footStrip.locator('[data-discovery-court]').evaluateAll(nodes=>nodes.map(node=>node.dataset.discoveryCourt)),[String(footCourt.id)]);
    assert.equal(await mobile.locator('[data-home-courts="Fotbal"] [data-discovery-court]').count(),0);
    await mobile.locator('#filtru-oras-global').selectOption('ALL');
    await mobile.locator('.card-sport[data-sport="Fotbal"]').click();
    await assertCourtNames(mobile,['Court A']);
    await mobile.locator('#inchide-terenuri').click();
    await mobile.locator('.card-sport[data-sport="Tenis Picior"]').click();
    assert.equal(await mobile.locator('#titlu-sport').innerText(),'Alege Terenul - Tenis de picior');
    await assertCourtNames(mobile,['Picior Court']);
    assert.match(await mobile.locator('#modal-terenuri .modal-continut').evaluate(node=>getComputedStyle(node).backgroundImage),/RealistTenispicior\.png/);
    await mobile.locator('#inchide-terenuri').click();
    pass('foot tennis is a separate city-filtered sport strip and court chooser, with no foot courts included under football');

    for (const [language,label] of [['hu','Lábtenisz'],['en','Foot tennis'],['ro','Tenis de picior']]) {
      await mobile.evaluate(language=>window.schimbaLimba(language),language);
      assert.equal(await mobile.locator('[data-home-sport="Tenis Picior"] .home-sport-heading').innerText(),label);
      assert.equal(await mobile.locator('.home-desktop-nav [data-sport-target="Tenis Picior"]').innerText(),label);
      assert.equal(await mobile.locator('#home-mobile-menu [data-sport-target="Tenis Picior"]').innerText(),label);
      for (const width of viewportWidths) {
        await mobile.setViewportSize({width,height:844});
        await assertFits(mobile,'#home-header',`${language} five-sport navigation ${width}px`);
        await assertFits(mobile,'[data-home-sport="Tenis Picior"] .home-hero-copy',`${language} foot-tennis title and action ${width}px`);
        if (screenshotDir) {
          await mobile.locator('[data-home-sport="Tenis Picior"]').scrollIntoViewIfNeeded();
          await mobile.locator('[data-home-sport="Tenis Picior"]').screenshot({path:join(screenshotDir,`spotivity-foot-tennis-${language}-${width}.png`)});
        }
      }
      await mobile.locator('.card-sport[data-sport="Tenis Picior"]').click();
      assert.equal(await mobile.locator('#titlu-sport').innerText(),`${await mobile.evaluate(()=>window.dict[window.lang].alege_terenul)} - ${label}`);
      await assertCourtNames(mobile,['Picior Court']);
      await mobile.locator('#inchide-terenuri').click();
    }
    pass('the fifth sport has distinct Romanian, Hungarian and English headings and navigation labels without changing its canonical court key');

    await mobile.evaluate(async()=>{
      const {error}=await db.auth.signInWithPassword({email:'alice@example.test',password:' test-password. '});
      if(error)throw error;
    });
    await mobile.waitForFunction(()=>window.getSpotivityProfileUser()?.email==='alice@example.test');
    await mobile.locator('.card-sport[data-sport="Tenis Picior"]').click();
    await mobile.locator('#filtru-data').fill(tomorrow);
    await mobile.locator('#filtru-data').dispatchEvent('change');
    await assertCourtNames(mobile,['Picior Court']);
    await mobile.locator('.btn-teren').click();
    await mobile.locator('.btn-ora').filter({hasText:/^12:00$/}).click();
    const footBookingResponse=mobile.waitForResponse(response=>new URL(response.url()).pathname==='/functions/v1/booking-workflow' && response.request().method()==='POST');
    await mobile.locator('#buton-confirma').click();
    assert.equal((await footBookingResponse).status(),201);
    await mobile.locator('#modal-rezervare').waitFor({state:'hidden'});
    await serial(async()=>{
      await pg.exec('reset role');
      const rows=(await pg.query("select sport,teren,client_user_id,pret_total from public.rezervari where teren='Picior Court' and data_str=$1 and ora='12:00' and stare='activa'",[tomorrow])).rows;
      assert.deepEqual(rows,[{sport:'Tenis Picior',teren:'Picior Court',client_user_id:uid(1),pret_total:'100 RON'}]);
    });
    await mobile.evaluate(()=>db.auth.signOut({scope:'local'}));
    await mobile.waitForFunction(()=>window.getSpotivityProfileUser()===null);
    await mobile.locator('#home-nav-search-input').fill('tenis de picior');
    await mobile.locator('#home-nav-search-input').press('Enter');
    await mobile.locator('#modal-cautare-terenuri').waitFor({state:'visible'});
    assert.deepEqual(await mobile.locator('#home-search-results [data-discovery-court]').evaluateAll(nodes=>nodes.map(node=>node.dataset.discoveryCourt)),[String(footCourt.id)]);
    await mobile.locator('#home-search-results [data-discovery-court]').click();
    await mobile.locator('#modal-rezervare').waitFor({state:'visible'});
    assert.equal(await mobile.locator('#rezervare-teren-selectat').innerText(),'Picior Court');
    assert.match(await mobile.locator('#modal-rezervare .modal-continut').evaluate(node=>getComputedStyle(node).backgroundImage),/RealistTenispicior\.png/);
    await mobile.keyboard.press('Escape');
    await mobile.locator('#home-nav-search-input').fill('');
    pass('a real SDK foot-tennis booking persists its canonical sport, server price and owner UUID, and global search opens the same independent reservation flow');
    for (const width of viewportWidths) {
      await mobile.setViewportSize({width,height:844});
      await mobile.evaluate(()=>window.scrollTo(0,0));
      await assertFits(mobile,'.home-main',`stacked homepage ${width}px`);
      await assertFits(mobile,'#home-city-region',`homepage city and language controls ${width}px`);
      const headerControls=await mobile.evaluate(()=>['home-brand','home-nav-search','btn-top-cont','btn-mobile-menu','filtru-oras-global','selector-limba'].map(id=>{
        const node=document.getElementById(id),box=node.getBoundingClientRect();
        return {id,left:box.left,right:box.right,top:box.top,bottom:box.bottom,visible:!!(box.width && box.height && getComputedStyle(node).visibility!=='hidden')};
      }).filter(control=>control.visible));
      if (screenshotDir) await mobile.screenshot({path:join(screenshotDir,`spotivity-public-header-${width}.png`)});
      assert.ok(headerControls.every(control=>control.left>=0 && control.right<=width+1),JSON.stringify({width,headerControls}));
      for (let i=0;i<headerControls.length;i++) for (let j=i+1;j<headerControls.length;j++) {
        const a=headerControls[i],b=headerControls[j];
        assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1,
          JSON.stringify({width,overlapping:[a,b]}));
      }
      assert.equal(await mobile.locator('#filtru-oras-global').isVisible(),true);
      assert.equal(await mobile.locator('#home-nav-search').isVisible(),true);
      const desktopNav=mobile.locator('.home-desktop-nav');
      const hamburger=mobile.locator('#btn-mobile-menu');
      if (await hamburger.isVisible()) {
        assert.equal(await desktopNav.isVisible(),false);
        assert.equal(await mobile.locator('#btn-top-cont').isVisible(),true);
        await hamburger.click();
        const menu=mobile.locator('#home-mobile-menu');
        await menu.waitFor({state:'visible'});
        assert.equal(await hamburger.getAttribute('aria-expanded'),'true');
        await assertFits(mobile,'#home-mobile-menu',`mobile sport menu ${width}px`);
        const bounds=await menu.evaluate(node=>{
          const box=node.getBoundingClientRect(),toggle=document.getElementById('btn-mobile-menu').getBoundingClientRect();
          return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:innerWidth,height:innerHeight,toggleBottom:toggle.bottom};
        });
        assert.ok(bounds.left<=0 && bounds.right>=bounds.width && bounds.top<=bounds.toggleBottom+1 && bounds.bottom>=bounds.height-1,JSON.stringify(bounds));
        assert.deepEqual(await menu.locator('[data-sport-target]').evaluateAll(nodes=>nodes.map(node=>node.dataset.sportTarget).sort()),[...sports].sort());
        assert.equal(await menu.locator('[data-profile-target]').count(),1);
        assert.equal(await menu.locator('button').first().evaluate(button=>button.hasAttribute('data-profile-target')),true,'Profile must be the first mobile menu action');
        await mobile.keyboard.press('Tab');
        assert.equal(await mobile.evaluate(()=>document.activeElement.id==='btn-mobile-menu' || !!document.activeElement.closest('#home-mobile-menu')),true);
        if (screenshotDir) await mobile.screenshot({path:join(screenshotDir,`spotivity-mobile-menu-${width}.png`)});
        await mobile.keyboard.press('Escape');
        await menu.waitFor({state:'hidden'});
        assert.equal(await hamburger.getAttribute('aria-expanded'),'false');
        assert.equal(await hamburger.evaluate(node=>document.activeElement===node),true);
        await hamburger.click();
        await menu.locator('[data-sport-target="Tenis"]').click();
        await menu.waitFor({state:'hidden'});
        await mobile.locator('#modal-terenuri').waitFor({state:'visible'});
        assert.ok((await mobile.locator('#titlu-sport').innerText()).includes('Tenis'));
        assert.equal(await mobile.locator('#filtru-nume').isVisible(),true);
        assert.equal(await mobile.locator('#filtru-data').isVisible(),true);
        assert.equal(await mobile.locator('#filtru-ora').isVisible(),true);
        await mobile.locator('#inchide-terenuri').click();
        await hamburger.click();
        await menu.locator('[data-sport-target="Tenis Picior"]').click();
        await menu.waitFor({state:'hidden'});
        assert.equal(await mobile.locator('#titlu-sport').innerText(),'Alege Terenul - Tenis de picior');
        await assertCourtNames(mobile,['Picior Court']);
        await mobile.locator('#inchide-terenuri').click();
        await hamburger.click();
        await menu.locator('[data-profile-target]').click();
        await menu.waitFor({state:'hidden'});
        await mobile.locator('#modal-auth').waitFor({state:'visible'});
        await mobile.keyboard.press('Escape');
      } else {
        assert.equal(await desktopNav.isVisible(),true);
        assert.equal(await mobile.locator('#btn-top-cont').isVisible(),true);
        assert.deepEqual(await desktopNav.locator('[data-sport-target]').evaluateAll(nodes=>nodes.map(node=>node.dataset.sportTarget).sort()),[...sports].sort());
        await desktopNav.locator('[data-sport-target="Tenis"]').click();
        await mobile.locator('#modal-terenuri').waitFor({state:'visible'});
        assert.ok((await mobile.locator('#titlu-sport').innerText()).includes('Tenis'));
        assert.equal(await mobile.locator('#filtru-nume').isVisible(),true);
        assert.equal(await mobile.locator('#filtru-data').isVisible(),true);
        assert.equal(await mobile.locator('#filtru-ora').isVisible(),true);
        await mobile.locator('#inchide-terenuri').click();
        await desktopNav.locator('[data-sport-target="Tenis Picior"]').click();
        assert.equal(await mobile.locator('#titlu-sport').innerText(),'Alege Terenul - Tenis de picior');
        await assertCourtNames(mobile,['Picior Court']);
        await mobile.locator('#inchide-terenuri').click();
      }
      pass(`homepage navigation and sport menu fit ${width}px, use the existing sport/profile dialogs and preserve all chooser filters`);
      const lowerSport=mobile.locator('.card-sport[data-sport="Baschet"]');
      await lowerSport.evaluate(node=>window.scrollTo({top:node.closest('.home-sport-hero').offsetTop,behavior:'instant'}));
      await lowerSport.scrollIntoViewIfNeeded();
      const originalScroll=await mobile.evaluate(()=>window.scrollY);
      assert.ok(originalScroll>0,`The stacked homepage must scroll to basketball at ${width}px`);
      await lowerSport.click();
      await mobile.locator('#modal-terenuri').waitFor({state:'visible'});
      await mobile.waitForFunction(()=>document.body.classList.contains('fara-scroll'));
      await assertBackdrop(mobile,'modal-terenuri');
      await mobile.mouse.wheel(0,300);
      await mobile.waitForTimeout(100);
      assert.ok(Math.abs((await mobile.evaluate(()=>window.scrollY))-originalScroll)<=1,`Background scroll moved while the chooser was open at ${width}px`);
      await mobile.keyboard.press('Escape');
      await mobile.locator('#modal-terenuri').waitFor({state:'hidden'});
      await mobile.waitForFunction(()=>!document.body.classList.contains('fara-scroll'));
      assert.ok(Math.abs((await mobile.evaluate(()=>window.scrollY))-originalScroll)<=1,`Closing the chooser changed the homepage scroll position at ${width}px`);
      assert.equal(await mobile.locator('#fundal-imagine-sport').evaluate(node=>node.style.opacity),'0');
      await mobile.mouse.move(width/2,600);
      await mobile.mouse.wheel(0,250);
      await mobile.waitForFunction(previous=>window.scrollY>previous,originalScroll,{timeout:3000});
      assert.ok((await mobile.evaluate(()=>window.scrollY))>originalScroll,`Closing the chooser must restore homepage scrolling at ${width}px`);
      pass(`stacked homepage scroll remains locked under the full blurred chooser and returns to its original position at ${width}px`);
      await mobile.evaluate(()=>window.scrollTo(0,0));
      await openProfile(mobile);
      await mobile.locator('#modal-auth').waitFor({state:'visible'});
      await mobile.locator('#tab-register').click();
      await assertFits(mobile,'#modal-auth .modal-continut',`public signup ${width}px`);
      await assertBackdrop(mobile,'modal-auth');
      const gaps=await mobile.locator('#form-register .grup-input').evaluateAll(nodes=>nodes.slice(1).map((node,i)=>node.getBoundingClientRect().top-nodes[i].getBoundingClientRect().bottom));
      assert.equal(gaps.length,3);
      assert.ok(gaps.every(gap=>gap>=18),JSON.stringify({width,gaps}));
      if (screenshotDir) await mobile.screenshot({path:join(screenshotDir,`spotivity-signup-${width}.png`)});
      await mobile.keyboard.press('Escape');
      await mobile.locator('#modal-auth').waitFor({state:'hidden'});
      pass(`signup has spaced fields and a full-viewport blurred backdrop at ${width}px; the dialog opens and closes`);
    }
    await serial(async()=>{
      await pg.exec('reset role');
      await pg.query("update public.site_sporturi set icona_url='assets/imagini/avatar2.png',fundal_url='assets/imagini/RealistVolei.png' where sport='Fotbal'");
    });
    const configuredAppearance=await pageFor();
    await configuredAppearance.goto(base,{waitUntil:'networkidle'});
    await configuredAppearance.evaluate(()=>window.spotivitySportAppearanceReady);
    assert.equal(await configuredAppearance.locator('.home-sport-hero [data-sport-icon]').count(),0);
    assert.equal(await configuredAppearance.locator('[data-sport-background="Fotbal"]').getAttribute('src'),'assets/imagini/RealistVolei.png');
    await configuredAppearance.locator('.card-sport[data-sport="Fotbal"]').click();
    await configuredAppearance.locator('#modal-terenuri').waitFor({state:'visible'});
    assert.match(await configuredAppearance.locator('#modal-terenuri .modal-continut').evaluate(node=>getComputedStyle(node).backgroundImage),/RealistVolei\.png/);
    assert.equal(await configuredAppearance.locator('#filtru-nume').isVisible(),true);
    pass('a configured sport appearance changes the homepage and its booking dialog through real public SDK reads');
    const unavailableAppearance=await pageFor();
    await unavailableAppearance.context().route(url=>url.hostname===host && url.pathname.endsWith('/site_sporturi'),route=>route.fulfill({
      status:503,contentType:'application/json',body:JSON.stringify({message:'Fixture public settings temporarily unavailable'})
    }));
    await unavailableAppearance.goto(base,{waitUntil:'networkidle'});
    await unavailableAppearance.evaluate(()=>window.spotivitySportAppearanceReady);
    assert.equal(await unavailableAppearance.locator('.home-sport-hero [data-sport-icon]').count(),0);
    assert.equal(await unavailableAppearance.locator('[data-sport-background="Fotbal"]').getAttribute('src'),'assets/imagini/RealistFotbal1.png');
    assert.equal(await unavailableAppearance.locator('[data-sport-background="Tenis Picior"]').getAttribute('src'),'assets/imagini/RealistTenispicior.png');
    await unavailableAppearance.locator('.card-sport[data-sport="Fotbal"]').click();
    await unavailableAppearance.locator('#modal-terenuri').waitFor({state:'visible'});
    await unavailableAppearance.locator('#filtru-nume').fill('Court A');
    await assertCourtNames(unavailableAppearance,['Court A']);
    pass('temporary appearance settings failure retains bundled realistic images and a working court chooser');
    // Sports-base tests use new records only inside this disposable database.
    // Keep them after the legacy workflow checks so prior city/count assertions
    // continue testing exactly the same booking and authorization contracts.
    const baseIds={a:uid(101),b:uid(102),empty:uid(103),hidden:uid(104),inactive:uid(105)};
    const unsafeBaseName='Baza A <img src=x onerror="window.__baseXss=true">';
    const unsafeDescription='Descriere <script>window.__baseXss=true</script> pentru baza A.';
    const baseCourts=await serial(async()=>{
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      for (const [id,name,city,description,active] of [
        [baseIds.a,unsafeBaseName,'Târgu Mureș',unsafeDescription,true],
        [baseIds.b,'Baza B','București','Două terenuri pentru sport.',true],
        [baseIds.empty,'Baza fără terenuri','Târgu Mureș','',true],
        [baseIds.hidden,'Baza cu teren ascuns','Târgu Mureș','',true],
        [baseIds.inactive,'Baza dezactivată','Târgu Mureș','',false]
      ]) await pg.query('insert into public.baze_sportive(id,nume,oras,descriere,este_activa) values($1,$2,$3,$4,$5)',[id,name,city,description,active]);
      const courts={};
      courts.a=(await pg.query("update public.terenuri set baza_sportiva_id=$1 where nume='Court A' returning id",[baseIds.a])).rows[0].id;
      for (const [key,name,sport,city,baseId,active] of [
        ['a2','Baza A Tenis','Tenis','Târgu Mureș',baseIds.a,true],
        ['b1','Baza B Baschet','Baschet','București',baseIds.b,true],
        ['b2','Baza B Volei','Volei','București',baseIds.b,true],
        ['hidden','Terenul ascuns al bazei','Tenis','Târgu Mureș',baseIds.hidden,false],
        ['inactive','Terenul bazei dezactivate','Volei','Târgu Mureș',baseIds.inactive,true]
      ]) courts[key]=(await pg.query("insert into public.terenuri(nume,sport,oras,pret,pret_minge,optiune_minge,este_activ,poza,baza_sportiva_id,ore_rezervabile) values($1,$2,$3,100,0,false,$4,'assets/imagini/avatar2.png',$5,$6) returning id",[name,sport,city,active,baseId,['09:00','10:00','11:00']])).rows[0].id;
      await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[baseIds.a,uid(3)]);
      return courts;
    });
    const basesPage=await pageFor();
    await basesPage.addInitScript(()=>{
      Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__sharedBaseUrl=value;}}});
    });
    await basesPage.goto(base,{waitUntil:'networkidle'});
    await basesPage.evaluate(()=>window.spotivityDiscoveryReady);
    assert.equal(await basesPage.locator('.home-nav [data-bases-target]').count(),0);
    assert.equal(await basesPage.locator('.home-explore-button').count(),0);
    for (const sport of sports) {
      assert.equal(await basesPage.locator(`[data-home-sport="${sport}"] .home-hero-actions button`).count(),1);
      assert.equal(await basesPage.locator(`[data-home-sport="${sport}"] .home-hero-actions button`).innerText(),'Rezervă un teren');
    }
    assert.deepEqual((await basesPage.locator('[data-home-base-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.homeBaseId))).sort(),[baseIds.a,baseIds.b]);
    assert.ok((await basesPage.locator('#home-bases-directory').innerText()).includes(unsafeBaseName));
    assert.equal(await basesPage.evaluate(()=>window.__baseXss),undefined);
    pass('homepage has one reservation action per sport, safe sports-base cards in a separate section and global search in navigation');
    await basesPage.locator('#filtru-oras-global').selectOption('Târgu Mureș');
    await basesPage.waitForFunction(()=>!document.querySelector('[data-home-courts="Baschet"] [data-discovery-court]'));
    const localIds=await basesPage.locator('.home-courts-strip [data-discovery-court]').evaluateAll(nodes=>nodes.map(node=>node.dataset.discoveryCourt));
    assert.ok(localIds.includes(String(baseCourts.a2)));
    assert.ok(!localIds.includes(String(baseCourts.b1)));
    assert.ok(!localIds.includes(String(baseCourts.hidden)));
    assert.deepEqual(await basesPage.locator('[data-home-base-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.homeBaseId)),[baseIds.a]);
    pass('compact sport strips and homepage bases follow the selected city and exclude inactive courts and empty/hidden bases');
    await basesPage.locator('#btn-home-search').click();
    await basesPage.locator('#modal-cautare-terenuri').waitFor({state:'visible'});
    assert.equal(await basesPage.locator('#home-search-input').evaluate(node=>node===document.activeElement),true);
    await basesPage.locator('#home-search-input').fill('bucuresti baschet');
    await basesPage.locator(`#home-search-results [data-discovery-court="${baseCourts.b1}"]`).waitFor();
    assert.equal(await basesPage.locator('#home-search-results [data-discovery-court]').count(),1);
    await basesPage.locator('#home-search-input').fill('Baza B Volei');
    await basesPage.locator(`#home-search-results [data-discovery-court="${baseCourts.b2}"]`).waitFor();
    await basesPage.locator('#home-search-input').fill('Terenul ascuns al bazei');
    assert.equal(await basesPage.locator('#home-search-results [data-discovery-court]').count(),0);
    assert.match(await basesPage.locator('#home-search-results').innerText(),/Nu am găsit/);
    await basesPage.locator('#home-search-input').fill('Baza B Baschet');
    await basesPage.locator(`#home-search-results [data-discovery-court="${baseCourts.b1}"]`).click();
    await basesPage.locator('#modal-rezervare').waitFor({state:'visible'});
    await basesPage.locator('#modal-cautare-terenuri').waitFor({state:'hidden'});
    assert.ok((await basesPage.locator('#modal-rezervare').innerText()).includes('Baza B Baschet'));
    assert.equal(await basesPage.locator('#filtru-oras-global').inputValue(),'Târgu Mureș');
    await basesPage.keyboard.press('Escape');
    pass('global search matches name, sport and city without diacritics across city filters, excludes inactive courts and opens the existing reservation form');
    await basesPage.locator(`[data-home-courts="Tenis"] [data-discovery-court="${baseCourts.a2}"]`).click();
    await basesPage.locator('#modal-rezervare').waitFor({state:'visible'});
    await basesPage.locator('#container-zile .btn-zi').nth(1).click();
    await basesPage.locator('.btn-ora').filter({hasText:/^09:00$/}).waitFor();
    assert.equal(await basesPage.locator('.btn-ora').count(),3);
    await basesPage.keyboard.press('Escape');
    pass('compact court cards reuse court-specific booking hours and the existing reservation dialog');
    for (const width of viewportWidths) {
      await basesPage.setViewportSize({width,height:844});
      await basesPage.evaluate(()=>window.scrollTo(0,0));
      assert.ok(await basesPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Discovery page overflow at ${width}px`);
      await assertFits(basesPage,'.home-nav',`global search navigation ${width}px`);
      await assertFits(basesPage,'#home-bases-section',`homepage sports bases ${width}px`);
      const strip=await basesPage.locator('[data-home-courts="Tenis"]').evaluate(node=>({overflow:getComputedStyle(node).overflowX,width:node.clientWidth,scroll:node.scrollWidth}));
      assert.equal(strip.overflow,'auto');
      if(width<768) {
        await basesPage.locator('#btn-mobile-menu').click();
        await basesPage.locator('#home-mobile-menu [data-search-target]').click();
        await basesPage.locator('#home-mobile-menu').waitFor({state:'hidden'});
      } else await basesPage.locator('#btn-home-search').click();
      await basesPage.locator('#home-search-input').fill('bucuresti');
      await basesPage.locator(`#home-search-results [data-discovery-court="${baseCourts.b1}"]`).waitFor();
      await assertFits(basesPage,'#modal-cautare-terenuri .modal-continut',`global search results ${width}px`);
      await assertBackdrop(basesPage,'modal-cautare-terenuri');
      await basesPage.keyboard.press('Escape');
      await basesPage.locator('#modal-cautare-terenuri').waitFor({state:'hidden'});
      if (screenshotDir) await basesPage.screenshot({path:join(screenshotDir,`spotivity-discovery-${width}.png`),fullPage:true});
    }
    pass('global search, compact horizontal court strips and sports-base section fit 320, 390, 768 and 1440 px with a keyboard-accessible mobile menu and modal');
    await basesPage.locator('#filtru-oras-global').selectOption('ALL');
    await basesPage.locator('#btn-home-baze').click();
    await basesPage.locator('#modal-baze-sportive').waitFor({state:'visible'});
    await basesPage.locator(`[data-base-id="${baseIds.a}"]`).waitFor();
    assert.deepEqual((await basesPage.locator('[data-base-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.baseId))).sort(),[baseIds.a,baseIds.b]);
    assert.equal(await basesPage.evaluate(()=>window.__baseXss),undefined);
    assert.equal(await basesPage.locator('img[src="x"]').count(),0);
    pass('public sports-base directory lists only active bases with active courts, and renders names as literal text');
    await basesPage.locator(`[data-base-id="${baseIds.a}"]`).click();
    await basesPage.locator(`[data-base-court="${baseCourts.a}"]`).waitFor();
    assert.equal(await basesPage.locator('[data-base-court]').count(),2);
    assert.ok((await basesPage.locator('#baze-sportive-continut').innerText()).includes(unsafeDescription));
    assert.equal(await basesPage.evaluate(()=>window.__baseXss),undefined);
    for (const width of viewportWidths) {
      await basesPage.setViewportSize({width,height:844});
      await assertFits(basesPage,'#modal-baze-sportive .modal-continut',`base detail ${width}px`);
      await assertBackdrop(basesPage,'modal-baze-sportive');
      if (screenshotDir) await basesPage.screenshot({path:join(screenshotDir,`spotivity-base-detail-${width}.png`)});
      await basesPage.locator('#baze-sportive-inapoi').click();
      await basesPage.locator(`[data-base-id="${baseIds.a}"]`).waitFor();
      await assertFits(basesPage,'#modal-baze-sportive .modal-continut',`base directory ${width}px`);
      await basesPage.locator(`[data-base-id="${baseIds.a}"]`).click();
      await basesPage.locator(`[data-base-court="${baseCourts.a}"]`).waitFor();
    }
    pass('sports-base descriptions and both courts fit 320, 390, 768 and 1440 px with a full blurred modal and no stored HTML execution');
    await basesPage.evaluate(()=>history.replaceState(null,'',location.pathname+'?tracking=private#access_token=must-not-share'));
    await basesPage.locator('#baze-sportive-share').click();
    await basesPage.waitForFunction(()=>Boolean(window.__sharedBaseUrl));
    const sharedUrl=new URL(await basesPage.evaluate(()=>window.__sharedBaseUrl));
    assert.equal(sharedUrl.search,`?baza=${baseIds.a}`);
    assert.equal(sharedUrl.hash,'');
    assert.equal(sharedUrl.origin,new URL(base).origin);
    assert.equal(sharedUrl.pathname,new URL(base).pathname);
    pass('copying a sports-base link includes only its public UUID and strips unrelated query parameters and authentication fragments');
    await basesPage.locator('#inchide-baze-sportive').click();
    await basesPage.evaluate(()=>history.replaceState(null,'',location.pathname));
    await basesPage.locator('#filtru-oras-global').selectOption('București');
    await basesPage.locator('#btn-home-baze').click();
    await basesPage.locator(`[data-base-id="${baseIds.b}"]`).waitFor();
    assert.equal(await basesPage.locator('[data-base-id]').count(),1);
    await basesPage.evaluate(id=>window.openSportsBases(id),baseIds.a);
    await basesPage.locator(`[data-base-court="${baseCourts.a}"]`).waitFor();
    pass('base directory follows the city filter while an explicit shared base opens independently of the selected city');
    await basesPage.locator(`[data-base-court="${baseCourts.a2}"]`).click();
    await basesPage.locator('#modal-rezervare').waitFor({state:'visible'});
    await basesPage.locator('#modal-baze-sportive').waitFor({state:'hidden'});
    await basesPage.locator('#container-zile .btn-zi').nth(1).click();
    await basesPage.locator('.btn-ora').filter({hasText:/^09:00$/}).waitFor();
    assert.equal(await basesPage.locator('.btn-ora').count(),3);
    assert.match(await basesPage.locator('#modal-rezervare .modal-continut').evaluate(node=>getComputedStyle(node).backgroundImage),/RealistTenis\.png/);
    assert.ok(requests.some(item=>item.path==='/rest/v1/terenuri' && new URLSearchParams(item.search).get('id')===`eq.${baseCourts.a2}`));
    await basesPage.locator('.btn-ora').filter({hasText:/^09:00$/}).click();
    await basesPage.locator('#buton-confirma').click();
    await basesPage.locator('#modal-rezervare-vizitator').waitFor({state:'visible'});
    assert.equal(await basesPage.locator('#modal-auth').isVisible(),false);
    assert.equal(await basesPage.locator('#modal-rezervare').isVisible(),true);
    await basesPage.keyboard.press('Escape');
    pass('a base court is rechecked through RLS and opens the original booking form with its real sport, hours and guest contact form');
    const deepLink=await pageFor();
    await deepLink.goto(new URL(`?baza=${baseIds.b}`,base).href,{waitUntil:'networkidle'});
    await deepLink.locator(`[data-base-court="${baseCourts.b1}"]`).waitFor();
    assert.equal(await deepLink.locator('[data-base-court]').count(),2);
    assert.equal(await deepLink.locator('#baze-sportive-titlu').innerText(),'Baza B');
    await deepLink.keyboard.press('Escape');
    await deepLink.locator('#modal-baze-sportive').waitFor({state:'hidden'});
    pass('a direct shared URL opens the correct base and Escape restores the homepage');
    const missingBase=await pageFor();
    await missingBase.goto(new URL(`?baza=${baseIds.inactive}`,base).href,{waitUntil:'networkidle'});
    await missingBase.locator('#modal-baze-sportive').waitFor({state:'visible'});
    assert.equal(await missingBase.locator('[data-base-court]').count(),0);
    assert.ok((await missingBase.locator('#baze-sportive-continut').innerText()).trim());
    assert.ok(!(await missingBase.locator('#baze-sportive-continut').innerText()).includes('Terenul bazei dezactivate'));
    await missingBase.keyboard.press('Escape');
    pass('an unavailable shared base gives a recoverable empty result without exposing its courts');
    const nativeShare=await pageFor();
    await nativeShare.addInitScript(()=>{
      Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__nativeShare=data;throw new DOMException('Cancelled','AbortError');}});
    });
    await nativeShare.goto(new URL(`?baza=${baseIds.b}`,base).href,{waitUntil:'networkidle'});
    await nativeShare.locator('#baze-sportive-share').click();
    await nativeShare.waitForFunction(()=>Boolean(window.__nativeShare));
    assert.equal(new URL((await nativeShare.evaluate(()=>window.__nativeShare)).url).search,`?baza=${baseIds.b}`);
    assert.equal(await nativeShare.locator('#modal-baze-sportive').isVisible(),true);
    assert.equal(await nativeShare.locator('[data-base-court]').count(),2);
    pass('native share cancellation preserves the current base without an exception');
    const unavailableBases=await pageFor();
    await unavailableBases.context().route(url=>url.hostname===host && url.pathname.endsWith('/baze_sportive'),route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Fixture base read unavailable'})}));
    await unavailableBases.goto(base,{waitUntil:'networkidle'});
    await unavailableBases.locator('#btn-home-baze').click();
    await unavailableBases.waitForLoadState('networkidle');
    assert.equal(await unavailableBases.locator('[data-base-id]').count(),0);
    assert.ok((await unavailableBases.locator('#baze-sportive-continut').innerText()).trim());
    await unavailableBases.keyboard.press('Escape');
    await unavailableBases.locator('.card-sport[data-sport="Tenis"]').click();
    await unavailableBases.locator('#modal-terenuri').waitFor({state:'visible'});
    await unavailableBases.locator('#filtru-nume').fill('Baza A Tenis');
    await assertCourtNames(unavailableBases,['Baza A Tenis']);
    pass('a failed base-directory read leaves a usable close action and the existing sport booking path working');

    // Superadmin changes go through the real SDK into one RLS-enforced RPC.
    await superAdmin.locator('#btn-baze-admin').click();
    await superAdmin.locator('#modal-baze-admin').waitFor({state:'visible'});
    await superAdmin.locator(`[data-edit-base="${baseIds.a}"]`).waitFor();
    assert.equal(await superAdmin.locator('[data-edit-base]').count(),5);
    await superAdmin.locator(`[data-edit-base="${baseIds.a}"]`).click();
    assert.equal(await superAdmin.locator('#baza-descriere').inputValue(),unsafeDescription);
    assert.equal(await superAdmin.evaluate(()=>window.__baseXss),undefined);
    for (const width of viewportWidths) {
      await superAdmin.setViewportSize({width,height:844});
      await assertFits(superAdmin,'#modal-baze-admin .modal-continut',`superadmin base editor ${width}px`);
      assert.doesNotMatch(await superAdmin.locator('#modal-baze-admin').innerText(),/\p{Extended_Pictographic}/u);
      if (screenshotDir) await superAdmin.screenshot({path:join(screenshotDir,`spotivity-super-base-editor-${width}.png`)});
    }
    pass('superadmin sees empty, inactive and public bases, with a safe editor that fits all four viewport widths');
    await superAdmin.locator('#btn-inapoi-baze').click();
    await superAdmin.locator('#btn-baza-noua').click();
    await superAdmin.locator('#baza-nume').fill('Baza creată din panou');
    await superAdmin.locator('#baza-oras').fill('Cluj-Napoca');
    await superAdmin.locator('#baza-descriere').fill('Descriere creată prin formular.');
    const unassignedCourtId=await serial(async()=>{
      await pg.exec('reset role');
      return (await pg.query("select id from public.terenuri where nume='Court B'")).rows[0].id;
    });
    await superAdmin.locator(`[data-base-court-id="${unassignedCourtId}"]`).check();
    await superAdmin.locator(`[data-base-admin-id="${uid(3)}"]`).check();
    const savedBaseResponse=superAdmin.waitForResponse(response=>new URL(response.url()).pathname==='/rest/v1/rpc/save_sports_base' && response.request().method()==='POST');
    await superAdmin.locator('#btn-salveaza-baza').click();
    assert.equal((await savedBaseResponse).status(),200);
    await superAdmin.waitForLoadState('networkidle');
    const createdBase=await serial(async()=>{
      await pg.exec('reset role');
      const row=(await pg.query("select * from public.baze_sportive where nume='Baza creată din panou'")).rows[0];
      assert.ok(row);
      assert.equal((await pg.query('select baza_sportiva_id from public.terenuri where id=$1',[unassignedCourtId])).rows[0].baza_sportiva_id,row.id);
      assert.equal((await pg.query('select user_id from public.baze_sportive_admini where baza_id=$1',[row.id])).rows[0].user_id,uid(3));
      return row;
    });
    assert.ok(requests.some(item=>item.path==='/rest/v1/rpc/save_sports_base' && item.person===4 && item.body.p_court_ids.includes(String(unassignedCourtId))));
    pass('superadmin creates a base, associates an existing court and grants description editing atomically through the authenticated SDK and PostgreSQL RLS');
    await superAdmin.keyboard.press('Escape');
    await superAdmin.locator('.card-sport[onclick*="deschideModalAdaugaTeren"]').click();
    await superAdmin.locator('#teren-baza').selectOption(createdBase.id);
    await superAdmin.locator('#teren-nume').fill('Teren creat direct în bază');
    await superAdmin.locator('#teren-sport').selectOption('Tenis Picior');
    await superAdmin.locator('#teren-oras').fill('Cluj-Napoca');
    await superAdmin.locator('#teren-pret').fill('100');
    await superAdmin.locator('#teren-locatie').fill('https://maps.google.com/');
    await superAdmin.locator('#btn-adauga-teren').click();
    await superAdmin.locator('#modal-adauga-teren').waitFor({state:'hidden'});
    await serial(async()=>{
      await pg.exec('reset role');
      const row=(await pg.query("select baza_sportiva_id,sport from public.terenuri where nume='Teren creat direct în bază'")).rows[0];
      assert.equal(row?.baza_sportiva_id,createdBase.id);
      assert.equal(row?.sport,'Tenis Picior');
    });
    pass('the existing add-court form creates a foot-tennis court with its canonical sport directly inside the selected sports base');
    const baseAdmin=await pageFor();
    await openBaseAdmin(baseAdmin);
    assert.deepEqual((await baseAdmin.locator('#base-admin-select option').evaluateAll(nodes=>nodes.map(node=>node.value))).sort(),[baseIds.a,createdBase.id].sort());
    await baseAdmin.locator('#base-admin-select').selectOption(createdBase.id);
    await baseAdmin.locator('#base-admin-edit-base').click();
    await baseAdmin.locator('#admin-baza-form').waitFor({state:'visible'});
    assert.deepEqual(await baseAdmin.locator('[data-edit-base]').evaluateAll(nodes=>nodes.map(node=>node.dataset.editBase)),[createdBase.id]);
    assert.equal(await baseAdmin.locator('#btn-baza-noua').isVisible(),false);
    assert.ok(!(await baseAdmin.locator('#baza-nume').isEditable()));
    assert.ok(!(await baseAdmin.locator('#baza-oras').isEditable()));
    assert.equal(await baseAdmin.locator('[data-base-court-id]:enabled').count(),0);
    assert.equal(await baseAdmin.locator('[data-base-admin-id]:enabled').count(),0);
    for (const width of viewportWidths) {
      await baseAdmin.setViewportSize({width,height:844});
      await assertFits(baseAdmin,'#modal-baze-admin .modal-continut',`ordinary admin base description ${width}px`);
      if (screenshotDir) await baseAdmin.screenshot({path:join(screenshotDir,`spotivity-admin-base-description-${width}.png`)});
    }
    await baseAdmin.locator('#baza-descriere').fill('Descriere actualizată de administratorul autorizat.');
    await baseAdmin.locator('#btn-salveaza-baza').click();
    await baseAdmin.locator('#admin-baze-directory').waitFor({state:'visible'});
    assert.equal(await baseAdmin.locator('#admin-baza-status').innerText(),'Descrierea a fost salvată.');
    await serial(async()=>{
      await pg.exec('reset role');
      assert.equal((await pg.query('select descriere from public.baze_sportive where id=$1',[createdBase.id])).rows[0].descriere,'Descriere actualizată de administratorul autorizat.');
      assert.equal((await pg.query('select terenuri from public.users_admin where user_id=$1',[uid(3)])).rows[0].terenuri.trim(),'Court A');
    });
    pass('an ordinary admin sees only explicitly permitted bases and can save the description without gaining another court allocation');
    const scopeResult=await baseAdmin.evaluate(async({baseId,courtId})=>{
      const structural=await db.from('baze_sportive').update({nume:'Attempted unauthorized rename'}).eq('id',baseId).select('id');
      const association=await db.from('terenuri').update({baza_sportiva_id:baseId}).eq('id',courtId).select('id');
      const otherBookings=await db.from('rezervari').select('id').eq('teren','Court B');
      return {structural:!!structural.error,association:!!association.error || association.data?.length===0,otherBookings:otherBookings.data};
    },{baseId:createdBase.id,courtId:baseCourts.a});
    assert.equal(scopeResult.structural,true);
    assert.equal(scopeResult.association,true);
    assert.deepEqual(scopeResult.otherBookings,[]);
    pass('base description permissions do not permit renaming the base, changing court membership or reading another court’s reservations');
    // Revoke in a separate trusted transaction while the editor is already open.
    await baseAdmin.locator(`[data-edit-base="${createdBase.id}"]`).click();
    await serial(async()=>{
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      await pg.query('delete from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[createdBase.id,uid(3)]);
    });
    await baseAdmin.locator('#baza-descriere').fill('Revoked edit must never save');
    await baseAdmin.locator('#btn-salveaza-baza').click();
    await baseAdmin.locator('#admin-baza-status.is-error').waitFor({state:'visible'});
    await serial(async()=>{
      await pg.exec('reset role');
      assert.equal((await pg.query('select descriere from public.baze_sportive where id=$1',[createdBase.id])).rows[0].descriere,'Descriere actualizată de administratorul autorizat.');
    });
    assert.ok((await baseAdmin.locator('#admin-baza-status').innerText()).trim());
    assert.doesNotMatch(await baseAdmin.locator('#admin-baza-status').innerText(),/^.*salvat[ăa]? cu succes.*$/i);
    pass('revoking a description grant while its editor is open prevents the save and never reports a false success');
    await baseAdmin.evaluate(async()=>{await db.auth.signOut({scope:'local'});});
    await baseAdmin.locator('#base-admin-workspace').waitFor({state:'hidden'});
    assert.equal(await baseAdmin.locator('#btn-administreaza-baza').isVisible(),false);
    assert.equal(await baseAdmin.locator('#modal-baze-admin').isVisible(),false);
    assert.equal(await baseAdmin.locator('#admin-baze-list').innerText(),'');
    assert.equal(await baseAdmin.locator('#baza-descriere').inputValue(),'');
    pass('sign-out closes the base editor and clears its cached private permissions and draft');

    assert.deepEqual(browserErrors,[]);
    for (const context of contexts) await context.close();
    console.log(`\n${checks} browser integration checks passed against isolated PostgreSQL.`);
  } finally {
    if (browser) await browser.close();
    await pg.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1});
