const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const clientKey='clients-fixture-'+ 'c'.repeat(64),adminKey='admins-fixture-'+ 'a'.repeat(64);
async function fixture(){
 const pg=new PGlite();
 await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 for(const file of readdirSync(directory).filter(f=>/^(001|00[3-9]|01[0-9]|02[0-9])_.*\.sql$/.test(f)).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
 await pg.exec(`create schema supabase_functions;
 create function supabase_functions.http_request() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger "webhook-chat-nou" after insert on public.mesaje_chat for each row execute function supabase_functions.http_request();
 create trigger webhook_reervare_noua after insert on public.rezervari for each row execute function supabase_functions.http_request();`);
 await pg.exec(readFileSync(join(directory,'030_superadmin_announcement_panel.sql'),'utf8'));
 assert.equal((await pg.query("select count(*) n from pg_trigger where tgname in ('webhook-chat-nou','webhook_reervare_noua')")).rows[0].n,0,'Only obsolete raw-row webhook triggers are retired');
 const root=async(sql,params=[])=>{await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false),set_config('request.headers','{}',false)");return pg.query(sql,params);};
 const as=async(person,sql,params=[],key=null)=>{
  await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers',$2,false)",[person?uid(person):'',JSON.stringify(key?{'x-spotivity-announcement-key':key}:{})]);
  await pg.exec(`set role ${person?'authenticated':'anon'}`);return pg.query(sql,params);
 };
 const preview=async(id,audience='clients',image=null,person=4,subject='<Anunț> & Spotivity',message='Mesaj\nA doua linie')=>(await as(person,'select public.admin_announcement_preview($1,$2,$3,$4,$5) v',[uid(id),audience,subject,message,image])).rows[0].v;
 const send=async(c,person=4)=>(await as(person,'select public.admin_announcement_send($1,$2,$3) v',[c.campaign_id,c.count,c.fingerprint])).rows[0].v;
 const history=async(person=4)=>(await as(person,'select public.admin_announcement_history() v')).rows[0].v;
 const pending=async(c,key=clientKey)=>(await as(null,'select public.announcement_pending($1,$2) v',[c.audience,c.campaign_id],key)).rows[0].v;
 const claim=async(c,r,key=clientKey)=>(await as(null,'select public.announcement_claim($1,$2,$3) v',[c.audience,c.campaign_id,r],key)).rows[0].v;
 for(const [a,k]of [['clients',clientKey],['admins',adminKey]])await root("insert into spotivity_private.announcement_credentials(audience,token_hash,enabled)values($1,encode(sha256(convert_to($2,'UTF8')),'hex'),true)",[a,k]);
 await root('select 1');await pg.exec(`create schema net;create table net.test_requests(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$declare r bigint;begin insert into net.test_requests(body) values(body) returning id into r;return r;end$$;`);
 return {pg,root,as,preview,send,history,pending,claim};
}
module.exports={fixture,uid,clientKey,adminKey};
if(require.main===module)test('superadmin panel authorization, immutable images and queued delivery',async t=>{
 const f=await fixture(),{pg,root,as,preview,send,history,pending,claim}=f;
 const denied=e=>e.code==='42501';
 try{
  await t.test('clients, ordinary admins and anonymous callers cannot compose/read/send',async()=>{
   for(const person of [null,1,3]){await assert.rejects(()=>preview(3001,'clients',null,person),denied);await assert.rejects(()=>history(person),denied);}
   assert.equal((await root('select count(*) n from spotivity_private.announcement_campaigns')).rows[0].n,0);
  });
  let c;
  await t.test('preview is idempotent, excludes administrator profiles and sends no request',async()=>{
   c=await preview(3002);assert.equal(c.count,2);assert.equal(c.status,'preview');assert.equal(c.created_by,uid(4));
   assert.deepEqual(await preview(3002),c);
   assert.equal((await pending(c)).recipients.length,0);
   assert.equal((await root('select count(*) n from net.test_requests')).rows[0].n,0);
   await assert.rejects(()=>preview(3002,'admins'),e=>e.code==='22023');
   assert.equal((await preview(3003,'admins')).count,2);
  });
  await t.test('preview fails closed on external/foreign/missing/mismatched image paths',async()=>{
   for(const path of ['https://evil.example/image.png',`${uid(3)}/${uid(3004)}/${uid(9)}.png`,`${uid(4)}/${uid(3004)}/${uid(9)}.png`])await assert.rejects(()=>preview(3004,'clients',path),e=>e.code==='22023');
   const path=`${uid(4)}/${uid(3005)}/${uid(9)}.png`;
   await as(4,"insert into storage.objects(bucket_id,name,metadata)values('announcement_images',$1,'{\"size\":128,\"mimetype\":\"image/png\"}')",[path]);
   const p=await preview(3005,'clients',path);assert.equal(p.image_path,path);
   assert.match(p.image_url,/storage\/v1\/object\/public\/announcement_images\//);
   await assert.rejects(()=>as(4,"update storage.objects set metadata='{}' where bucket_id='announcement_images' and name=$1 returning name",[path]),denied);
   await assert.rejects(()=>as(4,"delete from storage.objects where bucket_id='announcement_images' and name=$1 returning name",[path]),denied);
   await assert.rejects(()=>as(3,"insert into storage.objects(bucket_id,name)values('announcement_images',$1)",[`${uid(3)}/${uid(3010)}/${uid(9)}.png`]),denied);
   await assert.rejects(()=>as(4,"insert into storage.objects(bucket_id,name)values('announcement_images',$1)",[`${uid(4)}/${uid(3005)}/${uid(10)}.png`]),denied);
  });
  await t.test('approval is atomic when transport unavailable; rejects wrong count/fingerprint',async()=>{
   await assert.rejects(()=>send(c),e=>e.code==='55000');assert.equal((await history()).campaigns.find(x=>x.campaign_id===c.campaign_id).status,'preview');
   await assert.rejects(()=>send({...c,count:9}),e=>e.code==='40001');await assert.rejects(()=>send({...c,fingerprint:'f'.repeat(64)}),e=>e.code==='40001');
   await root("update spotivity_private.announcement_panel_config set ready=true");await root("update spotivity_private.notification_config set ready=true,booking_webhook_url='https://hook.eu1.make.com/fixtureWebhook123456789'");
  });
  await t.test('approval queues only IDs; retry cannot duplicate a leased or sent recipient',async()=>{
   const approved=await send(c);assert.equal(approved.status,'approved');await send(c);
   const q=(await root('select body from net.test_requests')).rows;assert.equal(q.length,1);assert.deepEqual(q[0].body,{kind:'announcement_campaign_clients',campaign_id:c.campaign_id});
   await assert.rejects(()=>pending(c,adminKey),denied);
   const recipients=(await pending(c)).recipients;assert.equal(recipients.length,2);
   const mail=await claim(c,recipients[0].recipient_id);assert.equal(mail.send,true);assert.match(mail.html,/&lt;Anunț&gt; &amp; Spotivity/);assert.match(mail.html,/A doua linie/);
   assert.equal((await claim(c,recipients[0].recipient_id)).send,false);
   await as(null,'select public.announcement_finish($1,$2,$3,$4)',[c.audience,c.campaign_id,recipients[0].recipient_id,mail.lease_token],clientKey);
   assert.equal((await claim(c,recipients[0].recipient_id)).send,false);
   assert.equal((await pending(c)).recipients.length,1);
  });
  await t.test('recipient is rechecked for promotions and new account does not join frozen snapshot',async()=>{
   const p=await preview(3020);await send(p);const list=(await pending(p)).recipients;
   const recipient=(await root('select user_id from spotivity_private.announcement_recipients where id=$1',[list[0].recipient_id])).rows[0];
   await root("insert into public.users_admin(user_id,nume_admin,email,is_super,terenuri)select id,'Promoted',email,false,'Court A' from auth.users where id=$1",[recipient.user_id]);
   assert.equal((await claim(p,list[0].recipient_id)).send,false);
   await root('delete from public.users_admin where user_id=$1',[recipient.user_id]);
   const changed=await preview(3021);await root("insert into auth.users(id,email,email_confirmed_at)values($1,'new-client@example.test',statement_timestamp())",[uid(3050)]);
   await assert.rejects(()=>send(changed),e=>e.code==='40001');
   await root('delete from auth.users where id=$1',[uid(3050)]);
  });
  await t.test('uncertain recipient stays sending; cancellation stops only pending recipients',async()=>{
   const p=await preview(3030);await send(p);const list=(await pending(p)).recipients;
   await claim(p,list[0].recipient_id);
   const cancelled=(await as(4,'select public.admin_announcement_cancel($1) v',[p.campaign_id])).rows[0].v;
   assert.equal(cancelled.stage.sending,1);assert.equal(cancelled.stage.pending,0);assert.ok(cancelled.cancelled_at);
   assert.equal((await pending(p)).recipients.length,0);assert.equal((await claim(p,list[0].recipient_id)).send,false);
   await assert.rejects(()=>send(p),e=>e.code==='22023');
  });
  await t.test('image mail uses bounded responsive table and literal text; no arbitrary HTML injection',async()=>{
   const p=(await history()).campaigns.find(x=>x.image_path);await send(p);const list=(await pending(p)).recipients;
   const mail=await claim(p,list[0].recipient_id);assert.match(mail.html,/width="552"/);assert.match(mail.html,/width:100%;max-width:552px;height:auto/);assert.match(mail.html,/role="presentation"/);
   assert.ok(!mail.html.includes('<Anunț>'));assert.match(mail.html,/image\/|announcement_images\//);
  });
  await t.test('history paginates equal timestamps without exposing recipient addresses',async()=>{
   for(let i=3100;i<3125;i++)await preview(i);
   const first=await history();assert.equal(first.campaigns.length,21);const last=first.campaigns[19];
   const next=(await as(4,'select public.admin_announcement_history($1,$2) v',[last.created_at,last.campaign_id])).rows[0].v;
   assert.ok(next.campaigns.length>0);assert.ok(!next.campaigns.some(n=>first.campaigns.slice(0,20).some(o=>n.campaign_id===o.campaign_id)));
   assert.ok(!JSON.stringify(first).includes('@example.test'));
  });
  await t.test('demoted superadmin loses all RPC/storage access immediately',async()=>{
   await root('update public.users_admin set is_super=false,terenuri=$1 where user_id=$2',['Court A',uid(4)]);
   await assert.rejects(()=>history(),denied);await assert.rejects(()=>preview(3200),denied);await assert.rejects(()=>send(c),denied);
  });
 }finally{await pg.close();}
});
