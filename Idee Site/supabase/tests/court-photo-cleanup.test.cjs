// Exact admin module + real PostgreSQL RLS; all image bytes/Auth remain local.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {File}=require('node:buffer');
const vm=require('node:vm');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const base='https://fixture.supabase.test';
const photoURL=path=>base+'/storage/v1/object/public/poze_terenuri/'+path;
const photoFile=()=>new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUL8AAAAASUVORK5CYII=','base64')],'court.png',{type:'image/png'});
const sqlFile=name=>readFileSync(join(__dirname,'..',name),'utf8');
async function fixture(){
 const pg=new PGlite();let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
 await pg.exec(schema);for(const file of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','039_court_photo_cleanup.sql'])await pg.exec(sqlFile(file));
 const as=async(person,sql,args=[])=>{await pg.exec(`reset role;select set_config('request.jwt.claim.sub','${person?uid(person):''}',false);set role ${person?'authenticated':'postgres'}`);return pg.query(sql,args)};
 const court=(await as(null,"select id from public.terenuri where nume='Court A'")).rows[0].id;
 return{pg,as,court};
}
test('039 protects every referenced photo, including hidden/unallocated courts and superadmin',async()=>{
 const f=await fixture();try{
  const path=uid(3)+'/shared.png';await f.as(3,'insert into storage.objects(bucket_id,name)values($1,$2)',['poze_terenuri',path]);
  await f.as(null,"update public.terenuri set poza=$1 where nume in('Court A','Hidden Court')",[photoURL(path)]);
  assert.equal((await f.as(3,'delete from storage.objects where name=$1 returning name',[path])).rows.length,0);
  assert.equal((await f.as(4,'delete from storage.objects where name=$1 returning name',[path])).rows.length,0);
  await f.as(null,"update public.terenuri set poza=null where nume='Court A'");
  assert.equal((await f.as(3,'delete from storage.objects where name=$1 returning name',[path])).rows.length,0,'Hidden shared reference is protected');
  await f.as(null,"update public.terenuri set poza=$1 where nume='Hidden Court'",[base+'/storage/v1/render/image/public/poze_terenuri/'+encodeURIComponent(path)+'?width=400']);
  assert.equal((await f.as(4,'delete from storage.objects where name=$1 returning name',[path])).rows.length,0,'Encoded/render variant is protected');
  await f.as(null,"update public.terenuri set poza=null where nume='Hidden Court'");
  assert.equal((await f.as(3,'delete from storage.objects where name=$1 returning name',[path])).rows.length,1);
  const foreign=uid(1)+'/unused.png';await f.as(null,'insert into storage.objects(bucket_id,name)values($1,$2)',['poze_terenuri',foreign]);
  assert.equal((await f.as(3,'delete from storage.objects where name=$1 returning name',[foreign])).rows.length,0);
  assert.equal((await f.as(4,'delete from storage.objects where name=$1 returning name',[foreign])).rows.length,1,'Superadmin can clean reference-free legacy staff object');
  await f.as(null,'select 1');await f.pg.exec(sqlFile('039_court_photo_cleanup.sql'));
  assert.equal((await f.as(null,'select count(*)n from spotivity_private.migrations where version=39')).rows[0].n,1,'Reapplying does not duplicate metadata or delete objects');
 }finally{await f.pg.close()}
});
async function editor(f,options={}){
 const state={authGeneration:1,account:{user_id:uid(options.super?4:3),is_super:!!options.super}};
 const owner=state.account.user_id,files=new Set(),alerts=[],deleted=[],storage=new Map(),events=new Map();let counter=0;
 const elements=new Map(Object.entries({
  ['btn-save-'+f.court]:{},['pret-'+f.court]:{value:'100'},['oras-'+f.court]:{value:'Reghin'},['minge-'+f.court]:{checked:false},['pret-minge-'+f.court]:{value:'0'},['activ-'+f.court]:{checked:true},['are-chat-'+f.court]:{checked:true},['poza-'+f.court]:{files:[photoFile()]},['ore-rezervabile-'+f.court]:{querySelectorAll:()=>[{value:'09:00'}]},
  'btn-adauga-teren':{addEventListener:(_,handler)=>events.set('create',handler)},'teren-nume':{value:'New Court'},'teren-sport':{value:'Fotbal'},'teren-oras':{value:'Reghin'},'teren-pret':{value:'100'},'teren-minge':{checked:false},'teren-pret-minge':{value:'0'},'teren-locatie':{value:'https://maps.example.test/court'},'teren-poza':{files:[photoFile()]},'teren-baza':{value:''},'modal-adauga-teren':{style:{}}
 }));
 const person=id=>Number(id.split('-').at(-1));
 function client(initial){
  let who=initial;
  const query=()=>{
   let kind='select',selection='*',patch,rows,filter;
   const execute=async()=>{
    if(kind!=='select'&&options.rejectSave)return{data:null,error:{message:'Fixture DB rejected save',code:'23514'}};
    let result;
    if(kind==='select'){result=await f.as(person(who),'select '+selection+' from public.terenuri where '+filter[0]+'=$1',[filter[1]]);return{data:result.rows[0]||null,error:null}}
    if(kind==='update'){const keys=Object.keys(patch);result=await f.as(person(who),'update public.terenuri set '+keys.map((key,i)=>'"'+key+'"=$'+(i+1)).join(',')+' where id=$'+(keys.length+1),[...keys.map(key=>patch[key]),filter[1]])}
    if(kind==='insert'){const keys=Object.keys(rows[0]);result=await f.as(person(who),'insert into public.terenuri('+keys.map(key=>'"'+key+'"').join(',')+')values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',[...keys.map(key=>rows[0][key])])}
    return options.loseAck?{error:{message:'Network acknowledgement lost'}}:{error:null};
   };
   const chain={select(value){selection=value;return this},update(value){kind='update';patch=value;return this},insert(value){kind='insert';rows=value;return this},eq(name,value){filter=[name,value];return this},maybeSingle:execute,then(resolve,reject){return execute().then(resolve,reject)}};return chain;
  };
  return{auth:{getUser:async()=>({data:{user:{id:who}},error:null}),getSession:async()=>({data:{session:{user:{id:who},access_token:'fixture:'+who,refresh_token:'refresh'}},error:null}),setSession:async session=>{who=session.access_token.slice(8);return{data:{user:{id:who},session},error:null}}},
   from:()=>query(),storage:{from:()=>({upload:async path=>{await f.as(person(who),'insert into storage.objects(bucket_id,name)values($1,$2)',['poze_terenuri',path]);files.add(path);if(options.switchDuringUpload){state.authGeneration++;state.account={user_id:uid(2)};}return{error:null}},getPublicUrl:path=>({data:{publicUrl:photoURL(path)}}),remove:async paths=>{
    if(options.removeFails){options.removeFails--;return{error:{message:'Cleanup unavailable'}}}
    const removed=(await f.as(person(who),'delete from storage.objects where bucket_id=$1 and name=any($2::text[])returning name',['poze_terenuri',paths])).rows;for(const row of removed){files.delete(row.name);deleted.push(row.name)}return{data:removed,error:null}
   }})}};
 }
 const db=client(owner);const window={bookingHourOptions:['09:00'],addEventListener:(name,handler)=>events.set(name,handler),refreshSpotivityAdminAccess:async()=>{}};
 // Chromium covers actual decoding; this VM fixture isolates cleanup with a valid image.
 class Image{naturalWidth=1;naturalHeight=1;async decode(){}}
 const context=vm.createContext({window,document:{getElementById:id=>elements.get(id)||null},URL,Image,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},createClient:()=>client(null),supabaseUrl:base,supabaseKey:'public-fixture-key',crypto:{randomUUID:()=>uid(++counter+100)},alert:message=>alerts.push(message),confirm:()=>true});
 vm.runInContext(readFileSync(join(__dirname,'../../js/modules/admin-courts.js'),'utf8'),context);window.SpotivityModules.adminCourts({db,state,captureContext:()=>{const generation=state.authGeneration,id=state.account.user_id;return()=>generation===state.authGeneration&&id===state.account.user_id}});
 return{state,options,owner,window,files,deleted,alerts,storage,save:()=>window.salveazaSetariTeren(f.court,'Court A'),create:()=>events.get('create')(),async addPhoto(path,court='Court A'){await f.as(null,'insert into storage.objects(bucket_id,name)values($1,$2)',['poze_terenuri',path]);files.add(path);await f.as(null,'update public.terenuri set poza=$1 where nume=$2',[photoURL(path),court])}};
}
test('rejected update/create remove fresh files; cleanup failure retries without masking DB error',async()=>{
 for(const create of[false,true]){const f=await fixture();try{
  const e=await editor(f,{super:create,rejectSave:true,removeFails:1});await(create?e.create():e.save());assert.equal(e.files.size,1);assert.ok(e.alerts.at(-1).includes('Fixture DB rejected save'));
  await(create?e.create():e.save());assert.equal(e.files.size,0);assert.equal((await f.as(null,"select count(*)n from storage.objects where bucket_id='poze_terenuri'")).rows[0].n,0);assert.equal(e.alerts.length,2);
 }finally{await f.pg.close()}}
});
test('committed update with lost acknowledgement keeps its new photo',async()=>{
 const f=await fixture();try{const e=await editor(f,{loseAck:true});await e.save();assert.equal(e.files.size,1);const photo=(await f.as(null,'select poza from public.terenuri where id=$1',[f.court])).rows[0].poza;assert.equal(photo,photoURL([...e.files][0]));assert.equal(e.deleted.length,0)}finally{await f.pg.close()}
});
test('successful replacement removes only owned, unreferenced old photos',async()=>{
 const f=await fixture();try{const e=await editor(f);const old=uid(3)+'/previous.jpg';await e.addPhoto(old);await e.save();assert.ok(e.deleted.includes(old));assert.equal(e.files.size,1);
 const shared=uid(3)+'/shared.jpg';await e.addPhoto(shared);await f.as(null,"update public.terenuri set poza=$1 where nume='Hidden Court'",[photoURL(shared)]);await e.save();assert.ok(e.files.has(shared));assert.ok(!e.deleted.includes(shared));
 const foreign=uid(4)+'/foreign.jpg';await e.addPhoto(foreign);await e.save();assert.ok(e.files.has(foreign));assert.ok(!e.deleted.includes(foreign));
 }finally{await f.pg.close()}
});
test('Auth switch after upload compensates using the original operation identity',async()=>{
 const f=await fixture();try{const e=await editor(f,{switchDuringUpload:true});await e.save();assert.equal(e.state.account.user_id,uid(2));assert.equal(e.files.size,0);assert.equal(e.alerts.length,0);assert.equal((await f.as(null,'select poza from public.terenuri where id=$1',[f.court])).rows[0].poza,null)}finally{await f.pg.close()}
});
