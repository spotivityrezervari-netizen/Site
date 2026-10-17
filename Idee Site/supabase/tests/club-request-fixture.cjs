// Disposable HTTP/Auth/Storage adapter for the real club-applications Edge
// handler and real browser SDK. SQL permissions and approval effects run in
// PostgreSQL; only external transport and email delivery are replaced.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync, readdirSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const serviceKey = 'fixture-server-service-key';
const anonKey = 'fixture-public-anon-key';
const ident = value => {assert.match(value,/^[a-zA-Z_][a-zA-Z0-9_]*$/);return `"${value}"`;};
const jsonResponse = (status,data,extra={}) => new Response(data===undefined?null:JSON.stringify(data),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-expose-headers':'X-Supabase-Api-Version,Content-Range','x-supabase-api-version':'2024-01-01',...extra}});

async function createFixture() {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
  const migrations = ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql',...readdirSync(join(__dirname,'..')).filter(name=>/^01[1-9]_.*\.sql$/.test(name)).sort()];
  assert.ok(migrations.length>=11);
  for(const name of migrations) await pg.exec(readFileSync(join(__dirname,'..',name),'utf8'));
  // Bucket configuration is read internally by the Storage transport, while object RLS remains real.
  await pg.exec('grant select on storage.buckets to anon,authenticated,service_role');
  const tokens=new Map(),accounts=new Map(),objects=new Map(),signed=new Map(),requests=[],createdAt=new Map();
  for(const [n,email] of [[1,'alice@example.test'],[2,'bob@example.test'],[3,'admin@example.test'],[4,'super@example.test']])accounts.set(email,{id:uid(n),password:'fixture-password'});
  let userSequence=20,objectSequence=200,signSequence=0,handler=null,queue=Promise.resolve(),gate=null;
  const state={loseNextAcknowledgement:false};
  const serial=fn=>{const promise=queue.then(fn);queue=promise.catch(()=>{});return promise;};
  const root=fn=>serial(async()=>{await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");return fn();});
  const token=id=>{const payload=Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url'),value=`eyJhbGciOiJIUzI1NiJ9.${payload}.${Buffer.from('fixture-'+id).toString('base64url')}`;tokens.set(value,id);return value;};
  const user=row=>({...row,created_at:createdAt.get(row.id)||'2026-01-01T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:row.raw_user_meta_data,identities:[{id:row.id,user_id:row.id,provider:'email'}]});
  const getUser=async id=>user((await pg.query('select * from auth.users where id=$1',[id])).rows[0]);
  const session=async account=>({access_token:token(account.id),refresh_token:'fixture-refresh-'+account.id,expires_in:3600,token_type:'bearer',user:await getUser(account.id)});
  const pauseNext=(path,method)=>{let enter,release,timer;const entered=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(`Expected ${method} ${path}`)),15000);enter=()=>{clearTimeout(timer);resolve();};});const wait=new Promise(resolve=>release=resolve);gate={path,method,enter,wait};return {entered,release};};
  const rpc=async(path,body)=>{
    const name=path.split('/').pop();assert.ok(['get_admin_access','save_sports_base','submit_club_application','submit_club_request','approve_club_request','reject_club_request'].includes(name),name);
    const keys=Object.keys(body);for(const key of keys)assert.match(key,/^p_[a-z_]+$/);
    const jsonKeys=new Set(['p_terenuri','p_prices']);
    const casts={p_id:'::uuid',p_admin_ids:'::uuid[]',p_court_ids:'::text[]',p_este_activa:'::boolean'};
    const result=await pg.query(`select public.${ident(name)}(${keys.map((key,i)=>`${key} => $${i+1}${casts[key]||(jsonKeys.has(key)?'::jsonb':key.endsWith('_id')?'::uuid':key==='p_expected_updated_at'?'::timestamptz':'')}`).join(',')}) value`,keys.map(key=>jsonKeys.has(key)?JSON.stringify(body[key]):body[key]));
    return result.rows[0].value;
  };
  const transport=async(input,init={},source='edge')=>{
    const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);
    assert.equal(url.hostname,host,'No fixture request may reach hosted services');
    const credential=(request.headers.get('authorization')||'').replace(/^Bearer /,''),id=tokens.get(credential),service=credential===serviceKey;
    const record={source,path:url.pathname,search:url.search,method:request.method,userId:id,service,status:null};requests.push(record);
    const reply=(status,data,headers)=>{record.status=status;return jsonResponse(status,data,headers);};
    try {
      await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
      if(url.pathname.startsWith('/auth/v1/')){
        if(url.pathname.endsWith('/logout'))return reply(204);
        if(url.pathname.endsWith('/token')){
          const body=await request.json(),account=accounts.get(String(body.email||'').toLowerCase());
          if(!account||account.password!==body.password)return reply(400,{code:'invalid_credentials',msg:'Invalid login credentials',error_description:'Invalid login credentials'});
          const row=(await pg.query('select email_confirmed_at from auth.users where id=$1',[account.id])).rows[0];
          if(!row?.email_confirmed_at)return reply(400,{code:'email_not_confirmed',msg:'Email not confirmed',error_description:'Email not confirmed'});
          return reply(200,await session(account));
        }
        if(url.pathname.endsWith('/signup')){
          const body=await request.json(),email=String(body.email||'').toLowerCase();
          if(accounts.has(email))return reply(422,{code:'user_already_exists',msg:'User already registered'});
          const account={id:uid(++userSequence),password:body.password};accounts.set(email,account);createdAt.set(account.id,new Date().toISOString());
          await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[account.id,email,JSON.stringify(body.data||{})]);
          return reply(200,await getUser(account.id));
        }
        if(url.pathname==='/auth/v1/admin/users'){
          assert.equal(service,true,'Auth admin access is server-only');
          if(request.method==='GET')return reply(200,{users:(await pg.query('select * from auth.users order by id')).rows.map(user),aud:'authenticated'});
          const body=await request.json(),email=String(body.email).toLowerCase();
          if(accounts.has(email))return reply(422,{code:'email_exists',msg:'A user with this email address has already been registered'});
          const account={id:uid(++userSequence),password:body.password};accounts.set(email,account);createdAt.set(account.id,new Date().toISOString());
          await pg.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4::jsonb)',[account.id,email,body.email_confirm?new Date().toISOString():null,JSON.stringify(body.user_metadata||{})]);
          return reply(200,await getUser(account.id));
        }
        const adminMatch=url.pathname.match(/^\/auth\/v1\/admin\/users\/([a-f0-9-]+)$/);
        if(adminMatch){assert.equal(service,true);if(request.method==='DELETE'){await pg.query('delete from auth.users where id=$1',[adminMatch[1]]);return reply(200,{});}return reply(200,await getUser(adminMatch[1]));}
        if(url.pathname.endsWith('/user')&&id)return reply(200,await getUser(id));
        return reply(401,{code:'bad_jwt',message:'Invalid fixture session'});
      }
      await pg.exec(`set role ${service?'service_role':id?'authenticated':'anon'}`);
      if(url.pathname.startsWith('/rest/v1/rpc/')){const body=await request.json();record.body=body;return reply(200,await rpc(url.pathname,body));}
      if(url.pathname.startsWith('/storage/v1/object/sign/')){
        const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/'.length));
        if(request.method==='POST'){
          const [bucket,...parts]=key.split('/'),path=parts.join('/');
          if(!(await pg.query('select 1 from storage.objects where bucket_id=$1 and name=$2',[bucket,path])).rows.length||!objects.has(key))return reply(404,{message:'Object is private or absent'});
          const ticket='fixture-private-'+(++signSequence);signed.set(ticket,key);return reply(200,{signedURL:`/object/sign/${key}?token=${ticket}`});
        }
        const photo=signed.get(url.searchParams.get('token'))===key&&objects.get(key);if(!photo)return reply(403,{message:'Invalid signature'});
        record.status=200;return new Response(photo.body,{headers:{'content-type':photo.mime,'access-control-allow-origin':'*'}});
      }
      if(url.pathname==='/storage/v1/object/copy'){
        assert.equal(service,true,'Only service may copy a private application image');const body=await request.json();record.body=body;
        const src=body.bucketId+'/'+body.sourceKey,destination=(body.destinationBucket||body.bucketId)+'/'+body.destinationKey,photo=objects.get(src);if(!photo)return reply(404,{message:'Source absent'});if(objects.has(destination))return reply(409,{statusCode:'409',message:'The resource already exists'});
        await pg.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb) on conflict do nothing',[body.destinationBucket||body.bucketId,body.destinationKey,JSON.stringify({size:photo.body.length,mimetype:photo.mime})]);objects.set(destination,photo);return reply(200,{Key:destination});
      }
      if(url.pathname.startsWith('/storage/v1/object/')){
        let tail=decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length)),publicRead=false;
        if(tail.startsWith('public/')){publicRead=true;tail=tail.slice(7);}
        const [bucket,...parts]=tail.split('/'),path=parts.join('/'),key=bucket+'/'+path;record.objectPath=path;
        if(request.method==='GET'){
          if(publicRead){const policy=(await pg.query('select public from storage.buckets where id=$1',[bucket])).rows[0];if(!policy?.public)return reply(403,{message:'Private bucket'});}
          else if(!(await pg.query('select 1 from storage.objects where bucket_id=$1 and name=$2',[bucket,path])).rows.length)return reply(404,{message:'Object is private or absent'});
          const photo=objects.get(key);if(!photo)return reply(404,{message:'Object absent'});record.status=200;return new Response(photo.body,{headers:{'content-type':photo.mime,'access-control-allow-origin':'*'}});
        }
        if(request.method==='POST'&&path){
          const policy=(await pg.query('select file_size_limit,allowed_mime_types from storage.buckets where id=$1',[bucket])).rows[0];if(!policy)return reply(404,{message:'Bucket absent'});
          let mime=(request.headers.get('content-type')||'').split(';')[0],bytes;
          if(mime==='multipart/form-data'){const form=await request.formData(),file=[...form.values()].find(value=>typeof value==='object'&&'arrayBuffer'in value);assert.ok(file);mime=file.type;bytes=Buffer.from(await file.arrayBuffer());}
          else bytes=Buffer.from(await request.arrayBuffer());
          if(bytes.length>Number(policy.file_size_limit))return reply(413,{message:'Image exceeds bucket limit'});
          if(!policy.allowed_mime_types.includes(mime))return reply(415,{message:'Image MIME is not permitted'});
          const existing=(await pg.query('select id from storage.objects where bucket_id=$1 and name=$2',[bucket,path])).rows;
          if(existing.length){if(request.headers.get('x-upsert')!=='true')return reply(409,{statusCode:'409',message:'The resource already exists'});await pg.query('update storage.objects set metadata=$3::jsonb where bucket_id=$1 and name=$2',[bucket,path,JSON.stringify({size:bytes.length,mimetype:mime})]);}
          else await pg.query('insert into storage.objects(id,bucket_id,name,metadata) values($1,$2,$3,$4::jsonb)',[uid(++objectSequence),bucket,path,JSON.stringify({size:bytes.length,mimetype:mime})]);
          objects.set(key,{body:bytes,mime});record.size=bytes.length;record.mime=mime;return reply(200,{Key:key,Id:uid(objectSequence)});
        }
        if(request.method==='DELETE'&&!path){const body=await request.json(),removed=[];for(const name of body.prefixes){const matches=(await pg.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,name])).rows;for(const row of matches){objects.delete(bucket+'/'+row.name);removed.push(row);}}return reply(200,removed);}
        return reply(405,{message:'Unexpected Storage method'});
      }
      const table=url.pathname.split('/').pop();assert.ok(['clienti','users_admin','terenuri','rezervari','rezervari_disponibilitate','mesaje_chat','site_sporturi','baze_sportive','baze_sportive_admini','cereri_baze_sportive'].includes(table),`Unexpected table ${table}`);
      const params=[],conditions=[];
      for(const [field,value]of url.searchParams){
        if(['select','order','limit','offset','columns'].includes(field))continue;
        if(field==='or'){const terms=value.slice(1,-1).split(',').map(term=>{const [,col,operand]=term.match(/^([a-z_]+)\.eq\.(.*)$/)||[];assert.ok(col);params.push(operand);return `${ident(col)}=$${params.length}`;});conditions.push('('+terms.join(' or ')+')');continue;}
        if(value==='is.null'||value==='not.is.null')conditions.push(`${ident(field)} is ${value==='not.is.null'?'not ':''}null`);
        else if(value.startsWith('in.('))conditions.push(`${ident(field)} in (${value.slice(4,-1).split(',').map(v=>{params.push(v.replace(/^"|"$/g,''));return `$${params.length}`;}).join(',')})`);
        else{const match=value.match(/^(eq|neq|ilike|lt|lte|gt|gte)\.(.*)$/s);assert.ok(match,value);const bool=['is_super','este_activ','este_activa','are_chat','optiune_minge','citit'].includes(field)&&['true','false'].includes(match[2]);params.push(bool?match[2]==='true':match[2]);conditions.push(`${ident(field)} ${{eq:'=',neq:'<>',ilike:'ilike',lt:'<',lte:'<=',gt:'>',gte:'>='}[match[1]]} $${params.length}`);}
      }
      const where=conditions.length?' where '+conditions.join(' and '):'';let query;
      if(['GET','HEAD'].includes(request.method)){
        const columns=(url.searchParams.get('select')||'*').split(',').map(c=>c==='*'?'*':ident(c)).join(',');query=`select ${columns} from public.${ident(table)}${where}`;
        if(url.searchParams.has('order'))query+=' order by '+url.searchParams.get('order').split(',').map(o=>{const[col,dir]=o.split('.');return ident(col)+(dir==='desc'?' desc':' asc');}).join(',');
        if(url.searchParams.has('limit')){params.push(Number(url.searchParams.get('limit')));query+=` limit $${params.length}`;}
        if(url.searchParams.has('offset')){params.push(Number(url.searchParams.get('offset')));query+=` offset $${params.length}`;}
      }else if(request.method==='POST'){
        const body=await request.json();record.body=body;const rows=Array.isArray(body)?body:[body],fields=Object.keys(rows[0]);
        const values=rows.map(row=>'('+fields.map(field=>{params.push(row[field]);return `$${params.length}`;}).join(',')+')');
        query=`insert into public.${ident(table)}(${fields.map(ident).join(',')}) values ${values.join(',')} returning *`;
      }else if(request.method==='PATCH'){
        const body=await request.json();record.body=body;query=`update public.${ident(table)} set ${Object.entries(body).map(([key,value])=>{params.push(value);return `${ident(key)}=$${params.length}`;}).join(',')}${where} returning *`;
      }else if(request.method==='DELETE')query=`delete from public.${ident(table)}${where} returning *`;
      else return reply(405,{message:'Unexpected table mutation'});
      const result=await pg.query(query,params),single=(request.headers.get('accept')||'').includes('vnd.pgrst.object');
      if(single&&result.rows.length!==1)return reply(406,{code:'PGRST116',message:'Expected exactly one row'});
      return reply(request.method==='POST'?201:200,request.method==='HEAD'?undefined:single?result.rows[0]:result.rows,{'content-range':`0-${Math.max(0,result.rows.length-1)}/${result.rows.length}`});
    }catch(error){record.error=error.message;const status=error.code==='42501'?403:['23505','40001'].includes(error.code)?409:error.code?400:500;return reply(status,{code:error.code||'FIXTURE',message:error.message});}
  };
  const browserRoute=async route=>{
    const req=route.request(),url=new URL(req.url());
    if(gate&&gate.path===url.pathname&&gate.method===req.method()){const pending=gate;gate=null;pending.enter();await pending.wait;}
    const init={method:req.method(),headers:req.headers(),...(['GET','HEAD'].includes(req.method())?{}:{body:req.postDataBuffer()})};
    await serial(async()=>{
      let response;
      if(url.pathname==='/functions/v1/club-applications'){
        assert.ok(handler,'Real Edge handler must be configured');
        const record={source:'browser',path:url.pathname,method:req.method(),status:null};requests.push(record);
        response=await handler(new Request(req.url(),init));record.status=response.status;if(!response.ok)record.error=await response.clone().text();
        if(state.loseNextAcknowledgement&&response.ok){state.loseNextAcknowledgement=false;record.status='lost-after-commit';return route.abort('failed');}
      }else response=await transport(new Request(req.url(),init),{},'browser');
      if(req.failure())return;
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
  };
  return {pg,root,serial,transport,browserRoute,accounts,objects,requests,state,pauseNext,tokens,token,uid,host,serviceKey,anonKey,setHandler:value=>handler=value,
    rows:()=>root(async()=>(await pg.query('select * from public.cereri_baze_sportive order by created_at,id')).rows),
    protectedState:()=>root(async()=>{const result={};for(const table of ['clienti','users_admin','terenuri','rezervari','mesaje_chat','baze_sportive','baze_sportive_admini'])result[table]=(await pg.query(`select to_jsonb(t) value from public.${ident(table)} t order by to_jsonb(t)::text`)).rows;return result;}),
    confirm:email=>root(()=>pg.query('update auth.users set email_confirmed_at=now() where email=$1',[email])),
    close:()=>pg.close()};
}
module.exports={createFixture,uid,host};
