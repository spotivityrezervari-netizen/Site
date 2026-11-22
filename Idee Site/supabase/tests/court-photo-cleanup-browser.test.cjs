// Exact court editor in Chromium, native File inputs and real PostgreSQL RLS.
// The provider adapter is local; no hosted Auth, database or Storage is called.
const {chromium}=require('playwright');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const backend='https://fixture.supabase.test';
const imageURL=path=>backend+'/storage/v1/object/public/poze_terenuri/'+path;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUL8AAAAASUVORK5CYII=','base64');
const source=readFileSync(join(__dirname,'../../js/modules/admin-courts.js'),'utf8');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 try{
  for(const scenario of ['failed-update','failed-create','auth-switch','lost-ack','replacement','shared-reference','corrupt-update','corrupt-create','decode-auth-switch']){
   const pg=new PGlite(),context=await browser.newContext();
   try{
    await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
    for(const file of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','039_court_photo_cleanup.sql'])await pg.exec(readFileSync(join(__dirname,'..',file),'utf8'));
    const as=async(person,sql,args=[])=>{
     await pg.exec(`reset role;select set_config('request.jwt.claim.sub','${person?uid(person):''}',false);set role ${person?'authenticated':'postgres'}`);
     return pg.query(sql,args);
    };
    const court=(await as(null,"select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
    const old=uid(3)+'/previous.png',shared=scenario==='shared-reference',create=scenario.endsWith('create'),corrupt=scenario.startsWith('corrupt-');
    if(['replacement','shared-reference','corrupt-update','decode-auth-switch'].includes(scenario)){
     await as(null,'insert into storage.objects(bucket_id,name)values($1,$2)',['poze_terenuri',old]);
     await as(null,"update public.terenuri set poza=$1 where nume='Court A'",[imageURL(old)]);
     if(shared)await as(null,"update public.terenuri set poza=$1 where nume='Hidden Court'",[imageURL(old)]);
    }
    const owner=uid(create?4:3),records=[],errors=[];
    let failedCleanup=scenario==='failed-update'?1:0;
    const page=await context.newPage();
    await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
    await page.goto('https://court-editor.example.test/');
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeBinding('__photoBackend',async(_,input)=>{
     const person=Number(input.actor.split('-').at(-1));records.push({op:input.op,actor:input.actor,path:input.path});
     if(input.op==='upload'){
      assert.ok(input.size>0);assert.equal(input.type,'image/png');
      await as(person,'insert into storage.objects(bucket_id,name)values($1,$2)',['poze_terenuri',input.path]);
      return{error:null};
     }
     if(input.op==='remove'){
      if(failedCleanup-- >0)return{data:null,error:{message:'Fixture cleanup unavailable'}};
      const result=await as(person,'delete from storage.objects where bucket_id=$1 and name=any($2::text[])returning name',['poze_terenuri',input.paths]);
      return{data:result.rows,error:null};
     }
     if(input.op==='select'){
      assert.ok(['id','poza'].includes(input.column));assert.ok(['id','poza'].includes(input.filter[0]));
      const result=await as(person,`select ${input.column} from public.terenuri where ${input.filter[0]}=$1`,[input.filter[1]]);
      return{data:result.rows[0]||null,error:null};
     }
     if(scenario.startsWith('failed-'))return{data:null,error:{message:'Fixture rejected save',code:'23514'}};
     const data=input.patch,keys=Object.keys(data);
     const allowed=['oras','pret','optiune_minge','pret_minge','este_activ','are_chat','ore_rezervabile','poza','nume','sport','locatie','baza_sportiva_id'];
     assert.ok(keys.every(key=>allowed.includes(key)));
     if(input.op==='update')await as(person,'update public.terenuri set '+keys.map((key,i)=>'"'+key+'"=$'+(i+1)).join(',')+' where id=$'+(keys.length+1),[...keys.map(key=>data[key]),input.filter[1]]);
     else if(input.op==='insert')await as(person,'insert into public.terenuri('+keys.map(key=>'"'+key+'"').join(',')+')values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(key=>data[key]));
     else throw new Error('Unknown fixture action');
     return scenario==='lost-ack'?{error:{message:'Fixture acknowledgement lost'}}:{error:null};
    });
    await page.evaluate(({court,owner,scenario,backend,create})=>{
     document.body.innerHTML=`<button id="btn-save-${court}">Save</button><input id="pret-${court}" value="100"><input id="oras-${court}" value="Reghin"><input id="minge-${court}" type="checkbox"><input id="pret-minge-${court}" value="0"><input id="activ-${court}" type="checkbox" checked><input id="are-chat-${court}" type="checkbox" checked><input id="poza-${court}" type="file"><div id="ore-rezervabile-${court}"><input class="ora-rezervabila" type="checkbox" value="09:00" checked></div><button id="btn-adauga-teren">Create</button><input id="teren-nume" value="New Court"><input id="teren-sport" value="Fotbal"><input id="teren-oras" value="Reghin"><input id="teren-pret" value="100"><input id="teren-minge" type="checkbox"><input id="teren-pret-minge" value="0"><input id="teren-locatie" value="https://maps.example.test/new"><input id="teren-poza" type="file"><input id="teren-baza" value=""><div id="modal-adauga-teren"></div>`;
     window.photoState={authGeneration:1,account:{user_id:owner,is_super:create}};
     window.photoAlerts=[];window.alert=message=>photoAlerts.push(message);window.confirm=()=>true;
     window.photoObjectURLs={created:[],revoked:[]};
     const createObjectURL=URL.createObjectURL.bind(URL),revokeObjectURL=URL.revokeObjectURL.bind(URL);
     URL.createObjectURL=file=>{const url=createObjectURL(file);photoObjectURLs.created.push(url);return url;};
     URL.revokeObjectURL=url=>{photoObjectURLs.revoked.push(url);revokeObjectURL(url);};
     if(scenario==='decode-auth-switch'){
      const decode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=async function(){await decode.call(this);photoDecodeStarted=true;await new Promise(resolve=>window.photoFinishDecode=resolve);};
      window.photoDecodeStarted=false;
     }
     window.supabaseUrl=backend;window.supabaseKey='fixture-public-key';window.bookingHourOptions=['09:00'];window.refreshSpotivityAdminAccess=async()=>{};
     function client(initial){
      let actor=initial;
      const query=()=>{
       let op='select',column='*',patch,filter;
       const execute=()=>__photoBackend({op,column,patch,filter,actor});
       return{select(value){column=value;return this},update(value){op='update';patch=value;return this},insert(value){op='insert';patch=value[0];return this},eq(name,value){filter=[name,value];return this},maybeSingle:execute,then(resolve,reject){return execute().then(resolve,reject)}};
      };
      return{auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getSession:async()=>({data:{session:{user:{id:actor},access_token:'fixture:'+actor,refresh_token:'fixture-refresh'}},error:null}),setSession:async session=>{actor=session.access_token.slice(8);return{data:{user:{id:actor},session},error:null}}},from:query,
       storage:{from:()=>({
        upload:async(path,file)=>{
         if(!(file instanceof File))throw new Error('Native File expected');
         const result=await __photoBackend({op:'upload',actor,path,type:file.type,size:file.size});
         if(scenario==='auth-switch'){photoState.authGeneration++;photoState.account={user_id:'00000000-0000-0000-0000-000000000002',is_super:false};}
         return result;
        },getPublicUrl:path=>({data:{publicUrl:backend+'/storage/v1/object/public/poze_terenuri/'+path}}),remove:paths=>__photoBackend({op:'remove',actor,paths})
       })}};
     }
     window.createClient=()=>client(null);window.photoDB=client(owner);
     window.photoContext={db:photoDB,state:photoState,captureContext:()=>{const version=photoState.authGeneration,id=photoState.account.user_id;return()=>version===photoState.authGeneration&&id===photoState.account.user_id;}};
    },{court,owner,scenario,backend,create});
    await page.addScriptTag({content:source});await page.evaluate(()=>SpotivityModules.adminCourts(photoContext));
    const input=page.locator(create?'#teren-poza':'#poza-'+court);
    await input.setInputFiles({name:'court.png',mimeType:'image/png',buffer:corrupt?Buffer.from('not an image'):png});
    if(create){
     await page.locator('#btn-adauga-teren').click();await page.waitForFunction(()=>!document.getElementById('btn-adauga-teren').disabled&&photoAlerts.length===1);
    }else if(scenario==='decode-auth-switch'){
     await page.evaluate(court=>{window.photoPendingSave=salveazaSetariTeren(court,'Court A');},court);
     await page.waitForFunction(()=>photoDecodeStarted);
     await page.evaluate(()=>{photoState.authGeneration++;photoState.account={user_id:'00000000-0000-0000-0000-000000000002',is_super:false};photoFinishDecode();});
     await page.evaluate(()=>photoPendingSave);
    }else await page.evaluate(court=>salveazaSetariTeren(court,'Court A'),court);
    let objects=(await as(null,"select name from storage.objects where bucket_id='poze_terenuri' order by name")).rows.map(row=>row.name);
    if(scenario==='failed-update'){
     assert.equal(objects.length,1,'Failed cleanup keeps a retry record instead of hiding the DB error');
     await page.evaluate(court=>salveazaSetariTeren(court,'Court A'),court);
     objects=(await as(null,"select name from storage.objects where bucket_id='poze_terenuri'")).rows.map(row=>row.name);assert.deepEqual(objects,[]);
     assert.ok((await page.evaluate(()=>photoAlerts)).every(message=>message.includes('Fixture rejected save')));
    }else if(corrupt||scenario==='decode-auth-switch'){
     assert.ok(!records.some(row=>['upload','update','insert','remove'].includes(row.op)),'An undecodable image or stale identity must not mutate Storage or court metadata');
     const saved=(await as(null,'select poza from public.terenuri where id::text=$1',[court])).rows[0].poza;
     assert.equal(saved,create?null:imageURL(old));
     assert.deepEqual(objects,create?[]:[old]);
     if(corrupt)assert.match((await page.evaluate(()=>photoAlerts)).join(' '),/nu poate fi afișat ca imagine/);
     else assert.deepEqual(await page.evaluate(()=>photoAlerts),[]);
     if(create)assert.equal((await as(null,"select count(*)::int total from public.terenuri where nume='New Court'")).rows[0].total,0);
    }else if(['failed-create','auth-switch'].includes(scenario))assert.deepEqual(objects,[]);
    else{
     const saved=(await as(null,'select poza from public.terenuri where id::text=$1',[court])).rows[0].poza;
     assert.ok(objects.some(path=>imageURL(path)===saved));
     assert.equal(objects.includes(old),shared,'Only unreferenced previous photo may be removed');
     assert.equal(objects.length,shared?2:1);
    }
    if(scenario==='auth-switch'){
     assert.equal(await page.evaluate(()=>photoState.account.user_id),uid(2));assert.deepEqual(await page.evaluate(()=>photoAlerts),[]);
     assert.equal(records.find(row=>row.op==='remove').actor,owner,'Cleanup remains bound to the original Auth identity');
     assert.ok(!records.some(row=>row.op==='update'));
    }
    const urls=await page.evaluate(()=>photoObjectURLs);assert.ok(urls.created.length>0);assert.deepEqual(urls.revoked,urls.created,'Every validation releases its temporary object URL');
    assert.deepEqual(errors,[]);console.log('PASS actual court editor '+scenario);
   }finally{await context.close();await pg.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
