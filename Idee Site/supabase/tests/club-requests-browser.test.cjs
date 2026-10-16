// Real pinned Supabase SDK + Chromium + disposable PostgreSQL/RLS. Every
// Supabase request is intercepted; this suite never writes to the hosted app.
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const {readFileSync, readdirSync, mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8002/';
const bucket = 'cereri_baze_sportive';
const screenshotDir = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, {recursive: true});
const tokens = new Map();
const token = person => {
  const payload = Buffer.from(JSON.stringify({sub: uid(person), exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated'})).toString('base64url');
  const value = `eyJhbGciOiJIUzI1NiJ9.${payload}.${Buffer.from(`fixture-${person}`).toString('base64url')}`;
  tokens.set(value, person); return value;
};
const ident = value => { assert.match(value, /^[a-zA-Z_][a-zA-Z0-9_]*$/); return `"${value}"`; };
const mimeFor = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', avif:'image/avif', gif:'image/gif'};
let checks = 0;

(async () => {
  const pg = new PGlite();
  let browser;
  try {
    await pg.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
    const migrations = ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql',
      '005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql',
      '008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql',
      readdirSync(join(__dirname,'..')).find(name => /^011_.*\.sql$/.test(name))];
    assert.ok(migrations.at(-1), 'The club-request migration must exist');
    for (const file of migrations) await pg.exec(readFileSync(join(__dirname,'..',file),'utf8'));
    let queue = Promise.resolve();
    const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
    const root = fn => serial(async () => { await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); return fn(); });
    const protectedState = () => root(async () => {
      const result = {};
      for (const table of ['clienti','users_admin','terenuri','rezervari','mesaje_chat','baze_sportive','baze_sportive_admini']) {
        result[table] = (await pg.query(`select to_jsonb(t) value from public.${ident(table)} t order by to_jsonb(t)::text`)).rows;
      }
      return result;
    });
    const beforeBusiness = await protectedState();
    const rows = () => root(async () => (await pg.query('select * from public.cereri_baze_sportive order by created_at,id')).rows);
    const objects = new Map(), signed = new Map(), requests = [], errors = [];
    let objectSequence = 200, signSequence = 0, gate = null, loseNextAcknowledgement = false, failNextIdentityVerification = false;
    const pauseNext = (path, method) => {
      let enter, release, timer;
      const entered = new Promise((resolve,reject) => { timer = setTimeout(() => reject(new Error(`Expected ${method} ${path} was not requested`)),15000); enter=()=>{clearTimeout(timer);resolve();}; });
      const wait = new Promise(resolve => release=resolve);
      gate = {path,method,enter,wait}; return {entered,release};
    };
    const authUser = row => ({...row,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:row.raw_user_meta_data,identities:[]});
    const api = async route => {
      const request = route.request(), url = new URL(request.url());
      const person = tokens.get((request.headers().authorization || '').replace(/^Bearer /,''));
      const record = {path:url.pathname,method:request.method(),person,search:url.search};
      requests.push(record);
      if (gate && gate.path === url.pathname && gate.method === request.method()) { const pending=gate;gate=null;pending.enter();await pending.wait; }
      return serial(async () => {
        const reply = (status,data) => {
          record.status=status;
          return request.failure() ? Promise.resolve() : route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','x-supabase-api-version':'2024-01-01','access-control-expose-headers':'X-Supabase-Api-Version'},body:data===undefined?'':JSON.stringify(data)});
        };
        try {
          await pg.exec('reset role');
          await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[person?uid(person):'']);
          if (url.pathname.startsWith('/auth/v1/')) {
            if (url.pathname.endsWith('/user') && failNextIdentityVerification) {
              failNextIdentityVerification=false;
              return reply(503,{code:'unexpected_failure',message:'Fixture identity verification temporarily unavailable'});
            }
            if (url.pathname.endsWith('/logout')) return reply(204);
            if (url.pathname.endsWith('/token')) {
              const body=request.postDataJSON(),n={'alice@example.test':1,'bob@example.test':2,'admin@example.test':3,'super@example.test':4}[body.email];
              assert.ok(n);assert.equal(body.password,'fixture-password');
              const row=(await pg.query('select * from auth.users where id=$1',[uid(n)])).rows[0];
              return reply(200,{access_token:token(n),refresh_token:`fixture-refresh-${n}`,expires_in:3600,token_type:'bearer',user:authUser(row)});
            }
            if (url.pathname.endsWith('/user') && person) return reply(200,authUser((await pg.query('select * from auth.users where id=$1',[uid(person)])).rows[0]));
            return reply(401,{message:'No fixture session'});
          }
          if (url.pathname.startsWith('/storage/v1/object/sign/')) {
            const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/'.length));
            if (request.method()==='POST') {
              await pg.exec(`set role ${person?'authenticated':'anon'}`);
              const [bucketId,...parts]=key.split('/');
              const allowed=(await pg.query('select 1 from storage.objects where bucket_id=$1 and name=$2',[bucketId,parts.join('/')])).rows.length;
              if (!allowed || !objects.has(key)) return reply(404,{message:'Object is private or absent'});
              const ticket=`fixture-private-${++signSequence}`;signed.set(ticket,key);
              return reply(200,{signedURL:`/object/sign/${key}?token=${ticket}`});
            }
            const keyForToken=signed.get(url.searchParams.get('token'));
            const photo=keyForToken===key&&objects.get(key);
            if (!photo) return reply(403,{message:'Invalid private image signature'});
            record.status=200;return route.fulfill({status:200,contentType:photo.mime,body:photo.body,headers:{'access-control-allow-origin':'*'}});
          }
          if (url.pathname.startsWith('/storage/v1/object/public/')) return reply(403,{message:'Club request images have no public URL'});
          if (url.pathname.startsWith('/storage/v1/object/')) {
            const tail=decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length)),[bucketId,...parts]=tail.split('/'),path=parts.join('/');
            record.objectPath=path;
            if (request.method()==='POST'&&path) {
              const policy=(await pg.query('select file_size_limit,allowed_mime_types from storage.buckets where id=$1',[bucketId])).rows[0];
              if (!policy) return reply(404,{message:'Bucket not found'});
              const contentType=request.headers()['content-type']||'';let body=request.postDataBuffer(),mime=contentType.split(';')[0];
              if (contentType.startsWith('multipart/form-data')) {
                const boundary=contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);assert.ok(boundary);
                const marker=Buffer.from('--'+(boundary[1]||boundary[2]));let position=0,found=false;
                while ((position=body.indexOf(marker,position))!==-1) {
                  const headerEnd=body.indexOf(Buffer.from('\r\n\r\n'),position);if(headerEnd===-1)break;
                  const headers=body.subarray(position,headerEnd).toString(),end=body.indexOf(Buffer.from('\r\n'+marker.toString()),headerEnd+4);if(end===-1)break;
                  position=end+2;if(!headers.includes('filename='))continue;
                  mime=headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]||'application/octet-stream';body=body.subarray(headerEnd+4,end);found=true;break;
                }
                assert.ok(found,'The real SDK must send an uploaded file');
              }
              if(body.length>Number(policy.file_size_limit))return reply(413,{message:'Image exceeds bucket limit'});
              if(!policy.allowed_mime_types.includes(mime)||mimeFor[path.split('.').pop()]!==mime)return reply(415,{message:'Image MIME is not permitted'});
              await pg.exec(`set role ${person?'authenticated':'anon'}`);
              const id=uid(++objectSequence);await pg.query('insert into storage.objects(id,bucket_id,name,metadata) values($1,$2,$3,$4::jsonb)',[id,bucketId,path,JSON.stringify({size:body.length,mimetype:mime})]);
              objects.set(bucketId+'/'+path,{body,mime});record.size=body.length;record.mime=mime;
              return reply(200,{Id:id,Key:bucketId+'/'+path});
            }
            if(request.method()==='DELETE'&&!path) {
              await pg.exec(`set role ${person?'authenticated':'anon'}`);const removed=[];
              for(const name of request.postDataJSON().prefixes) {
                const found=(await pg.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id,name',[bucketId,name])).rows;
                for(const row of found){removed.push(row);objects.delete(bucketId+'/'+row.name);}
              }
              return reply(200,removed);
            }
            return reply(405,{message:'Unexpected private Storage method'});
          }
          await pg.exec(`set role ${person?'authenticated':'anon'}`);
          if(url.pathname==='/rest/v1/rpc/submit_club_request') {
            assert.equal(request.method(),'POST');const body=request.postDataJSON();record.body=body;
            const keys=Object.keys(body),values=keys.map(key=>key==='p_terenuri'?JSON.stringify(body[key]):body[key]);
            for(const key of keys)assert.match(key,/^p_[a-z_]+$/);
            const result=(await pg.query(`select public.submit_club_request(${keys.map((key,i)=>`${key} => $${i+1}${key==='p_terenuri'?'::jsonb':key==='p_request_id'?'::uuid':''}`).join(',')}) id`,values)).rows[0].id;
            if(loseNextAcknowledgement){loseNextAcknowledgement=false;record.status='lost-after-commit';return route.abort('failed');}
            return reply(200,result);
          }
          const table=url.pathname.split('/').pop();
          assert.ok(['clienti','users_admin','terenuri','rezervari','rezervari_disponibilitate','mesaje_chat','site_sporturi','baze_sportive','baze_sportive_admini','cereri_baze_sportive'].includes(table),`Unexpected table ${table}`);
          const params=[],conditions=[];
          for(const [field,value]of url.searchParams) {
            if(['select','order','limit','offset','columns'].includes(field))continue;
            if(value==='is.null'||value==='not.is.null')conditions.push(`${ident(field)} is ${value==='not.is.null'?'not ':''}null`);
            else if(value.startsWith('in.('))conditions.push(`${ident(field)} in (${value.slice(4,-1).split(',').map(v=>{params.push(v.replace(/^"|"$/g,''));return `$${params.length}`;}).join(',')})`);
            else {const match=value.match(/^(eq|neq|ilike|lt|lte|gt|gte)\.(.*)$/s);assert.ok(match,value);params.push(match[2]);conditions.push(`${ident(field)} ${{eq:'=',neq:'<>',ilike:'ilike',lt:'<',lte:'<=',gt:'>',gte:'>='}[match[1]]} $${params.length}`);}
          }
          const where=conditions.length?' where '+conditions.join(' and '):'';let query;
          if(request.method()==='GET') {
            const columns=(url.searchParams.get('select')||'*').split(',').map(c=>c==='*'?'*':ident(c)).join(',');query=`select ${columns} from public.${ident(table)}${where}`;
            if(url.searchParams.has('order'))query+=' order by '+url.searchParams.get('order').split(',').map(o=>{const[col,dir]=o.split('.');return ident(col)+(dir==='desc'?' desc':' asc');}).join(',');
            if(url.searchParams.has('limit')){params.push(Number(url.searchParams.get('limit')));query+=` limit $${params.length}`;}
            if(url.searchParams.has('offset')){params.push(Number(url.searchParams.get('offset')));query+=` offset $${params.length}`;}
          } else if(request.method()==='PATCH') {
            const body=request.postDataJSON();record.body=body;query=`update public.${ident(table)} set ${Object.entries(body).map(([key,value])=>{params.push(value);return `${ident(key)}=$${params.length}`;}).join(',')}${where} returning *`;
          } else return reply(405,{message:'Unexpected table mutation'});
          const result=await pg.query(query,params),single=(request.headers().accept||'').includes('vnd.pgrst.object');
          if(single&&result.rows.length!==1)return reply(406,{code:'PGRST116',message:'Expected exactly one row'});
          return reply(200,single?result.rows[0]:result.rows);
        } catch(error){return reply(403,{code:error.code||'FIXTURE',message:error.message});}
      });
    };
    const launch={executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true};
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
    if(proxy){const parsed=new URL(proxy);launch.proxy={server:parsed.origin,bypass:'127.0.0.1,localhost'};if(parsed.username)launch.proxy.username=decodeURIComponent(parsed.username);if(parsed.password)launch.proxy.password=decodeURIComponent(parsed.password);}
    browser=await chromium.launch(launch);
    const html=readFileSync(join(__dirname,'..','..','index.html'),'utf8');
    const sdkTag=html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    assert.ok(sdkTag,'The application must pin the real SDK with SRI');
    const sdk=execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','30',sdkTag[1]],{maxBuffer:2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'),sdkTag[2]);
    const pageFor=async()=>{
      const context=await browser.newContext({timezoneId:'Europe/Bucharest'});
      await context.route(sdkTag[1],route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}}));
      await context.route(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),api);
      await context.routeWebSocket(url=>url.hostname===host||url.hostname.endsWith('.supabase.co'),ws=>ws.close());
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());return page;
    };
    const pass=label=>{checks++;console.log('PASS',label);};
    const login=async(page,person)=>{const email={1:'alice@example.test',2:'bob@example.test',3:'admin@example.test',4:'super@example.test'}[person];const error=await page.evaluate(async email=>(await db.auth.signInWithPassword({email,password:'fixture-password'})).error?.message,email);assert.equal(error,undefined);};
    const fill=async(page,name='Club nou')=>{
      await page.locator('#club-request-name').fill(name);
      await page.locator('#club-request-contact').fill('Persoană Contact');
      await page.locator('#club-request-city').fill('Reghin');
      await page.locator('#club-request-email').fill('contact@example.test');
      await page.locator('#club-request-phone').fill('+40 712 345 678');
      await page.locator('#club-request-address').fill('Strada Sportului 10');
      await page.locator('#club-request-maps').fill('https://maps.app.goo.gl/FixtureClub');
      await page.locator('[data-club-court-name]').first().fill('Teren principal');
      await page.locator('[data-club-court-sport]').first().selectOption('Fotbal');
      await page.locator('#club-request-consent').check();
    };
    const rpcWrites=()=>requests.filter(r=>r.path==='/rest/v1/rpc/submit_club_request'&&r.method==='POST');
    const uploads=()=>requests.filter(r=>r.path.startsWith('/storage/v1/object/'+bucket+'/')&&r.method==='POST');
    const waitSubmit=async page=>{await page.waitForFunction(()=>!document.getElementById('club-request-submit').disabled);await page.waitForLoadState('networkidle');};
    const fit=async(page,selector,label)=>{
      for(const width of [320,390,768,1440]){
        await page.setViewportSize({width,height:width<768?844:1000});await page.locator(selector).scrollIntoViewIfNeeded();
        const bounds=await page.locator(selector).evaluate(el=>({viewport:innerWidth,width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,body:document.documentElement.scrollWidth}));
        assert.ok(bounds.width<=bounds.viewport+1&&bounds.scroll<=bounds.client+1&&bounds.body<=bounds.viewport+1,`${label} fits ${width}: ${JSON.stringify(bounds)}`);
        if(screenshotDir)await page.screenshot({path:join(screenshotDir,`club-${label}-${width}.png`)});
      }
    };

    const publicPage=await pageFor();
    await publicPage.goto(base,{waitUntil:'networkidle'});
    await publicPage.locator('#btn-club-registration').click();
    await fill(publicPage);
    const beforeLogin=rpcWrites().length;
    await publicPage.locator('#club-request-submit').click();
    await publicPage.locator('#club-request-login').waitFor({state:'visible'});
    assert.equal(rpcWrites().length,beforeLogin);assert.equal(uploads().length,0);
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Club nou');
    pass('signed-out visitors keep the draft and must authenticate before any private upload or submission');

    await publicPage.locator('#club-request-login').click();
    await publicPage.locator('#login-email').fill('alice@example.test');
    await publicPage.locator('#login-parola').fill('fixture-password');
    await publicPage.locator('#btn-executa-login').click();
    await publicPage.locator('#modal-club-registration').waitFor({state:'visible'});
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Club nou');
    await publicPage.locator('#club-request-maps').fill('javascript:alert(1)');
    await publicPage.locator('#club-request-submit').click();
    assert.equal(rpcWrites().length,beforeLogin);
    await publicPage.locator('#club-request-maps').fill('https://maps.app.goo.gl/FixtureClub');
    await publicPage.locator('#club-request-consent').uncheck();
    await publicPage.locator('#club-request-submit').click();
    assert.equal(rpcWrites().length,beforeLogin);
    await publicPage.locator('#club-request-consent').check();
    const png=readFileSync(join(__dirname,'..','..','assets/imagini/avatar2.png'));
    for(const file of [{name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')},{name:'forged.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4])},{name:'huge.png',mimeType:'image/png',buffer:Buffer.alloc(5242881)}]){
      await publicPage.locator('#club-request-photo').setInputFiles(file);
      await publicPage.waitForFunction(()=>document.getElementById('club-request-photo').files.length===0);
      assert.equal(uploads().length,0,file.name);assert.equal(rpcWrites().length,beforeLogin,file.name);
    }
    pass('consent, safe Maps URLs, valid images and the 5 MiB limit are checked before any write');

    await publicPage.locator('#club-request-photo').setInputFiles({name:'club.png',mimeType:'image/png',buffer:png});
    await publicPage.waitForFunction(()=>document.getElementById('club-request-photo-image').naturalWidth>0);
    const sports=['Baschet','Tenis','Volei','Tenis Picior'];
    for(const sport of sports){await publicPage.locator('#club-request-add-court').click();await publicPage.locator('[data-club-court-name]').last().fill(`Teren ${sport}`);await publicPage.locator('[data-club-court-sport]').last().selectOption(sport);}
    await publicPage.locator('#club-request-description').fill('<img src=x onerror="window.clubXss=true"> & detalii');
    await fit(publicPage,'.club-registration-panel','public');
    pass('the responsive registration form supports separate courts for all five sports and a decoded photo preview');

    const pending=pauseNext('/rest/v1/rpc/submit_club_request','POST');
    await publicPage.locator('#club-registration-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await pending.entered;
    assert.equal(await publicPage.locator('#club-request-submit').isDisabled(),true);
    await publicPage.locator('#club-registration-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    assert.equal(rpcWrites().length,beforeLogin+1);pending.release();await waitSubmit(publicPage);
    const first=(await rows())[0];assert.ok(first);assert.equal(first.nume_baza,'Club nou');assert.equal(first.terenuri.length,5);assert.deepEqual(first.terenuri.map(c=>c.sport),['Fotbal',...sports]);
    assert.match(first.poza_path,new RegExp(`^${uid(1)}/${first.id}/[0-9a-f-]{36}\\.png$`));
    assert.equal(uploads().length,1);assert.equal(uploads()[0].size,png.length);
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'');
    assert.equal(await publicPage.locator('[data-club-court-name]').count(),1);
    pass('one authenticated multi-court request uploads once, suppresses duplicate submits, and clears its successful draft');

    const access=await publicPage.evaluate(async({id,path,bucket})=>{
      const read=await db.from('cereri_baze_sportive').select('*').eq('id',id);
      const signed=await db.storage.from(bucket).createSignedUrl(path,60);
      const edited=await db.from('cereri_baze_sportive').update({stare:'acceptata'}).eq('id',id).select();
      return {rows:read.data,error:read.error?.code,signedError:!!signed.error,edited:edited.data,editError:edited.error?.code};
    },{id:first.id,path:first.poza_path,bucket});
    assert.equal(access.rows?.length||0,0);assert.equal(access.signedError,true);assert.equal(access.edited?.length||0,0);
    pass('the submitting client cannot read submitted contact data or sign the attached private image');

    await fill(publicPage,'Cerere cu răspuns pierdut');
    await publicPage.locator('#club-request-photo').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:png});
    await publicPage.waitForFunction(()=>document.getElementById('club-request-photo-image').naturalWidth>0);
    loseNextAcknowledgement=true;await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Cerere cu răspuns pierdut');
    const afterLost=await rows();assert.equal(afterLost.length,2);
    const lost=rpcWrites().at(-1);assert.equal(lost.status,'lost-after-commit');
    const uploadCount=uploads().length;
    failNextIdentityVerification=true;
    const beforeIdentityFailure=rpcWrites().length;
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);
    assert.equal(rpcWrites().length,beforeIdentityFailure);
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Cerere cu răspuns pierdut');
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);
    assert.equal((await rows()).length,2);assert.equal(uploads().length,uploadCount);assert.equal(rpcWrites().at(-1).body.p_request_id,lost.body.p_request_id);
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'');
    pass('a lost acknowledgement followed by transient identity failure preserves the same request ID and photo without duplicates');

    // Reach the real server quota using disposable application rows, then
    // remove only these fixture rows so later private-list checks stay focused.
    const quotaIds=[uid(810),uid(811),uid(812)];
    await root(async()=>{
      for(const id of quotaIds)await pg.query(`insert into public.cereri_baze_sportive
        (id,solicitant_user_id,nume_baza,nume_contact,email,telefon,oras,link_maps,terenuri)
        select $1,solicitant_user_id,nume_baza,nume_contact,email,telefon,oras,link_maps,terenuri
        from public.cereri_baze_sportive where id=$2`,[id,first.id]);
    });
    await fill(publicPage,'Cerere peste limita zilnică');
    await publicPage.locator('#club-request-submit').click();await waitSubmit(publicPage);
    assert.equal(await publicPage.locator('#club-request-status').innerText(),'Ai atins limita de 5 cereri pe zi. Poți încerca din nou mâine.');
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'Cerere peste limita zilnică');
    assert.equal((await rows()).length,5);
    await root(()=>pg.query('delete from public.cereri_baze_sportive where id=any($1::uuid[])',[quotaIds]));
    assert.equal((await rows()).length,2);
    pass('the real per-account server quota is translated into a clear Romanian message while retaining the rejected draft');

    await fill(publicPage,'Cerere abandonată la deconectare');
    const authGate=pauseNext('/auth/v1/user','GET'),beforeStale=rpcWrites().length;
    await publicPage.locator('#club-request-submit').click();await authGate.entered;
    await publicPage.evaluate(async()=>db.auth.signOut());authGate.release();await publicPage.waitForLoadState('networkidle');
    assert.equal(rpcWrites().length,beforeStale);assert.equal(await publicPage.locator('#modal-club-registration').isVisible(),false);
    await login(publicPage,2);
    // Reload uses the actual SDK's new stored session; no former owner's draft
    // or in-flight data may be resurrected in the new account.
    await publicPage.reload({waitUntil:'networkidle'});await publicPage.locator('#btn-club-registration').click();
    assert.equal(await publicPage.locator('#club-request-name').inputValue(),'');
    assert.equal((await rows()).length,2);
    pass('logout during identity verification aborts submission and a different account receives no previous private draft');

    const ordinary=await pageFor();await ordinary.goto(new URL('admin.html',base).href,{waitUntil:'networkidle'});
    await ordinary.locator('#login-email-admin').fill('admin@example.test');await ordinary.locator('#login-parola').fill('fixture-password');await ordinary.locator('#login-admin-btn').click();
    await ordinary.locator('#sectiune-dashboard').waitFor({state:'visible'});
    assert.equal(await ordinary.locator('#btn-cereri-baze-admin').isVisible(),false);
    const ordinaryRead=await ordinary.evaluate(async path=>({rows:(await db.from('cereri_baze_sportive').select('*')).data,photo:(await db.storage.from('cereri_baze_sportive').createSignedUrl(path,60)).data}),first.poza_path);
    assert.equal(ordinaryRead.rows?.length||0,0);
    assert.equal(ordinaryRead.photo,null);
    pass('ordinary admins have no request-management entry and RLS exposes no applications');

    // A real Auth-FK deletion clears the owner reference but must not erase a
    // submitted image or prevent superadmins from reviewing the retained data.
    const retainedId=uid(900),retainedPath=`${uid(9)}/${retainedId}/${uid(901)}.png`;
    await root(async()=>{
      await pg.query("insert into auth.users(id,email,email_confirmed_at) values($1,'temporary@example.test',now())",[uid(9)]);
      await pg.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[bucket,retainedPath,JSON.stringify({size:png.length,mimetype:'image/png'})]);
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(9)]);
      await pg.exec('set role authenticated');
      await pg.query('select public.submit_club_request($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)',[
        retainedId,'Club cu cont șters','Persoană Contact','temporary@example.test','+40 712 345 678','Reghin','Strada Sportului 10',
        'https://maps.app.goo.gl/FixtureClub',JSON.stringify([{nume:'Teren păstrat',sport:'Fotbal'}]),'Date pentru verificare',retainedPath]);
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      await pg.query('delete from auth.users where id=$1',[uid(9)]);
    });
    objects.set(`${bucket}/${retainedPath}`,{body:png,mime:'image/png'});
    assert.equal((await rows()).find(row=>row.id===retainedId).solicitant_user_id,null);

    const superPage=await pageFor();await superPage.goto(new URL('admin.html',base).href,{waitUntil:'networkidle'});
    await superPage.locator('#login-email-admin').fill('super@example.test');await superPage.locator('#login-parola').fill('fixture-password');await superPage.locator('#login-admin-btn').click();
    await superPage.locator('#btn-cereri-baze-admin').waitFor({state:'visible'});await superPage.locator('#btn-cereri-baze-admin').click();
    await superPage.locator(`[data-club-request-id="${first.id}"]`).waitFor({state:'visible'});
    assert.equal(await superPage.locator('[data-club-request-id]').count(),3);
    const signsBefore=requests.filter(r=>r.path.startsWith('/storage/v1/object/sign/')&&r.method==='POST').length;
    await superPage.locator(`[data-club-request-id="${first.id}"]`).click();await superPage.locator('#admin-cerere-detail').waitFor({state:'visible'});
    await superPage.waitForFunction(()=>document.getElementById('admin-cerere-photo').naturalWidth>0);
    assert.ok((await superPage.locator('#admin-cerere-data').innerText()).includes('contact@example.test'));
    assert.ok((await superPage.locator('#admin-cerere-data').innerText()).includes('<img src=x'));
    assert.equal(await superPage.evaluate(()=>window.clubXss),undefined);
    assert.equal(await superPage.locator('#admin-cerere-data img').count(),0);
    assert.equal(requests.filter(r=>r.path.startsWith('/storage/v1/object/sign/')&&r.method==='POST').length,signsBefore+1);
    const maps=superPage.locator('#admin-cerere-data a[href^="https://maps."]');assert.equal(await maps.count(),1);assert.ok((await maps.getAttribute('rel')).includes('noopener'));
    await fit(superPage,'#modal-cereri-baze-admin .modal-continut','admin-detail');
    pass('only superadmin can inspect contacts, safe Maps links and signed private photos; submitted text is rendered without HTML');

    await superPage.locator('#admin-cerere-back').click();
    await superPage.locator(`[data-club-request-id="${retainedId}"]`).click();
    await superPage.waitForFunction(()=>document.getElementById('admin-cerere-photo').naturalWidth>0);
    assert.ok((await superPage.locator('#admin-cerere-data').innerText()).includes('temporary@example.test'));
    assert.ok((await superPage.locator('#admin-cerere-photo').getAttribute('src')).includes(retainedId));
    await superPage.locator('#admin-cerere-back').click();
    await superPage.locator(`[data-club-request-id="${first.id}"]`).click();
    await superPage.waitForFunction(()=>document.getElementById('admin-cerere-photo').naturalWidth>0);
    pass('superadmin can still inspect the retained private photo after its submitting Auth account is deleted');

    const stateOptions=await superPage.locator('#admin-cerere-state option').evaluateAll(options=>options.map(option=>option.value));
    assert.ok(stateOptions.includes('in_analiza'));await superPage.locator('#admin-cerere-state').selectOption('in_analiza');await superPage.locator('#admin-cerere-note').fill('Am verificat datele; sună pentru detalii.');
    await superPage.locator('#admin-cerere-save').click();await superPage.waitForFunction(()=>!document.getElementById('admin-cerere-save').disabled);await superPage.waitForLoadState('networkidle');
    const updated=(await rows()).find(row=>row.id===first.id);assert.equal(updated.stare,'in_analiza');assert.equal(updated.nota_interna,'Am verificat datele; sună pentru detalii.');
    const update=requests.filter(r=>r.path==='/rest/v1/cereri_baze_sportive'&&r.method==='PATCH').at(-1);assert.deepEqual(Object.keys(update.body).sort(),['nota_interna','stare']);
    await superPage.locator('#admin-cerere-back').click();assert.equal(await superPage.locator('#admin-cerere-photo').getAttribute('src'),null);
    await superPage.locator('#admin-cereri-filter').selectOption('in_analiza');await superPage.waitForLoadState('networkidle');
    await superPage.locator(`[data-club-request-id="${first.id}"]`).waitFor({state:'visible'});
    assert.equal(await superPage.locator('[data-club-request-id]').count(),1);
    await fit(superPage,'#modal-cereri-baze-admin .modal-continut','admin-list');
    pass('superadmin filters requests and changes only review status/internal notes without creating a base or court');

    await superPage.locator(`[data-club-request-id="${first.id}"]`).click();await superPage.waitForFunction(()=>document.getElementById('admin-cerere-photo').naturalWidth>0);
    await root(()=>pg.query("update public.users_admin set is_super=false,terenuri='Court A' where user_id=$1",[uid(4)]));
    const writesBeforeDemotion=requests.filter(r=>r.path==='/rest/v1/cereri_baze_sportive'&&r.method==='PATCH').length;
    await superPage.locator('#admin-cerere-note').fill('This must not be saved after demotion');await superPage.locator('#admin-cerere-save').click();await superPage.waitForLoadState('networkidle');
    await superPage.locator('#btn-cereri-baze-admin').waitFor({state:'hidden'});
    assert.equal(requests.filter(r=>r.path==='/rest/v1/cereri_baze_sportive'&&r.method==='PATCH').length,writesBeforeDemotion);
    assert.equal((await rows()).find(row=>row.id===first.id).nota_interna,updated.nota_interna);
    assert.equal(await superPage.locator('#admin-cerere-photo').getAttribute('src'),null);
    assert.equal(await superPage.locator('#admin-cerere-data').innerText(),'');
    assert.equal(await superPage.locator('#btn-cereri-baze-admin').isVisible(),false);
    await root(()=>pg.query("update public.users_admin set is_super=true,terenuri='ALL' where user_id=$1",[uid(4)]));
    pass('revoking superadmin privileges blocks review writes and clears cached private details and photo URLs');

    assert.deepEqual(await protectedState(),beforeBusiness,'Registration/review must preserve all existing account, court, booking, role and base data');
    assert.deepEqual(errors,[]);
    assert.ok(requests.every(r=>!r.path.includes('/auth/v1/admin')&&r.path!=='/auth/v1/signup'),'The suite never triggers email or account creation');
    pass('existing reservations, scoped permissions, courts and bases remain unchanged, without browser errors');
    console.log(`${checks} club-request browser checks passed`);
  } finally {if(browser)await browser.close();await pg.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
