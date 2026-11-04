// Disposable PostgreSQL only. No hosted credentials, Make runs or email sends.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const tokens={clients:'fixture-clients-'+ 'c'.repeat(64),admins:'fixture-admins-'+ 'a'.repeat(64)};
const signatures={preview:['text','uuid','text','text'],approve:['text','uuid','integer'],claim:['text','uuid','uuid'],finish:['text','uuid','uuid','uuid']};

async function fixture(){
 const pg=new PGlite();
 await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 const migrations=readdirSync(directory).filter(file=>/^(001|00[3-9]|01[0-9]|02[0-9])_.*\.sql$/.test(file)).sort();
 assert.ok(migrations.some(file=>file.startsWith('029_')),'Announcement migration must be present');
 const source=readFileSync(join(directory,migrations.find(file=>file.startsWith('029_'))),'utf8');
 for(const file of migrations.filter(file=>!file.startsWith('029_')))await pg.exec(readFileSync(join(directory,file),'utf8'));
 const root=async(sql,params=[])=>{await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false),set_config('request.headers','{}',false)");return pg.query(sql,params);};
 await root('select 1');
 const beforeMigration={};
 for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','storage.objects','spotivity_private.booking_groups','spotivity_private.notification_outbox'])beforeMigration[table]=(await root(`select to_jsonb(r) value from ${table} r order by to_jsonb(r)::text`)).rows;
 const beforePolicies=(await root('select * from pg_policies order by schemaname,tablename,policyname')).rows;
 await pg.exec(source);
 for(const audience of ['clients','admins'])await root("insert into spotivity_private.announcement_credentials(audience,token_hash,enabled) values($1,encode(sha256(convert_to($2,'UTF8')),'hex'),true)",[audience,tokens[audience]]);
 const authorize=async(role,token)=>{await root('select 1');await pg.query("select set_config('request.headers',$1,false)",[JSON.stringify(token?{'x-spotivity-announcement-key':token}:{})]);await pg.exec(`set role ${role}`);};
 const rpc=async(action,args,{token=tokens[args[0]],role='anon'}={})=>{
  await authorize(role,token);return (await pg.query(`select public.announcement_${action}(${signatures[action].map((type,index)=>`$${index+1}::${type}`).join(',')}) value`,args)).rows[0].value;
 };
 const snapshot=async()=>{const result={};for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','storage.objects','spotivity_private.booking_groups','spotivity_private.notification_outbox'])result[table]=(await root(`select to_jsonb(r) value from ${table} r order by to_jsonb(r)::text`)).rows;return result;};
 return {pg,root,rpc,authorize,snapshot,source,beforeMigration,beforePolicies};
}
const forbidden=error=>error.code==='42501';
const stale=error=>error.code==='40001';

// A single fixture keeps the source-of-truth role model identical across the
// audience, approval and delivery assertions. Each case uses a fresh campaign.
test('announcement campaigns separate audiences, require scoped capabilities and never automatically resend',async t=>{
 const f=await fixture(),{pg,root,rpc}=f;
 let campaign=2800;const next=()=>uid(++campaign);
 const preview=(audience,id,subject='Anunț Spotivity',message='Mesaj de test')=>rpc('preview',[audience,id,subject,message]);
 const approve=(audience,id,count)=>rpc('approve',[audience,id,count]);
 const claim=(audience,id,recipient)=>rpc('claim',[audience,id,recipient]);
 const finish=(audience,id,recipient,lease)=>rpc('finish',[audience,id,recipient,lease]);
 try{
  await t.test('first application preserves existing business rows and RLS policies',async()=>{
   assert.deepEqual(await f.snapshot(),f.beforeMigration);assert.deepEqual((await root('select * from pg_policies order by schemaname,tablename,policyname')).rows,f.beforePolicies);
  });

  await t.test('capability tokens are audience-bound and no API role receives private table access',async()=>{
   const id=next();
   for(const role of ['anon','authenticated','service_role']){
    for(const [action,rest]of [['preview',[id,'Subject','Message']],['approve',[id,0]],['claim',[id,uid(2998)]],['finish',[id,uid(2998),uid(2999)]]]){
     await assert.rejects(()=>rpc(action,['clients',...rest],{role,token:null}),forbidden);
     await assert.rejects(()=>rpc(action,['admins',...rest],{role,token:tokens.clients}),forbidden);
    }
    await f.authorize(role,tokens.clients);
    await assert.rejects(()=>pg.query('select * from spotivity_private.announcement_credentials'),forbidden);
   }
   await root("update spotivity_private.announcement_credentials set enabled=false where audience='clients'");
   await assert.rejects(()=>preview('clients',id),forbidden);
   await root("update spotivity_private.announcement_credentials set enabled=true where audience='clients'");
  });

  await t.test('clients exclude all overlapping admin profiles; admins include the superadmin; previews expose no addresses',async()=>{
   assert.equal((await root('select count(*)::integer n from public.clienti')).rows[0].n,4,'Both admins also have client profiles');
   const clients=await preview('clients',next()),admins=await preview('admins',next());
   assert.equal(clients.count,2);assert.equal(admins.count,2);
   assert.match(clients.fingerprint,/^[0-9a-f]{64}$/);
   assert.ok(!JSON.stringify(clients).includes('@example.test'));
   assert.ok(!JSON.stringify(admins).includes('@example.test'));
  });

  await t.test('unconfirmed, deleted, banned, anonymous accounts and unverified guest contacts are excluded',async()=>{
   for(const [n,email,confirmed,deleted,banned,anonymous]of [
    [2811,'unconfirmed@example.test',false,false,false,false],
    [2812,'deleted@example.test',true,true,false,false],
    [2813,'banned@example.test',true,false,true,false],
    [2814,'anonymous@example.test',true,false,false,true]
   ])await root("insert into auth.users(id,email,email_confirmed_at,deleted_at,banned_until,is_anonymous) values($1,$2,case when $3 then statement_timestamp() end,case when $4 then statement_timestamp() end,case when $5 then statement_timestamp()+interval '1 day' end,$6)",[uid(n),email,confirmed,deleted,banned,anonymous]);
   await root("insert into spotivity_private.booking_groups(id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed) values($1,'Guest','guest@example.test','0712345678','1','Court A','Fotbal',current_date,array['12:00'],false,100,true)",[uid(2815)]);
   assert.equal((await preview('clients',next())).count,2);
   await root('delete from spotivity_private.booking_groups where id=$1',[uid(2815)]);
   await root('delete from auth.users where id=any($1::uuid[])',[[2811,2812,2813,2814].map(uid)]);
  });

  await t.test('normalization deduplicates mailbox aliases and client delivery excludes admin mailboxes even under another UUID',async()=>{
   // Emulate a historical database without the profile-email unique index;
   // ordinary application writes retain that existing guard outside this test.
   await root('drop index public.spotivity_clienti_email');
   await root("insert into auth.users(id,email,email_confirmed_at)values($1,' ALICE@EXAMPLE.TEST ',statement_timestamp()),($2,' ADMIN@EXAMPLE.TEST ',statement_timestamp())",[uid(2821),uid(2822)]);
   assert.equal((await preview('clients',next())).count,2,'One Alice mailbox and no administrator mailbox');
   await root('delete from auth.users where id=any($1::uuid[])',[[uid(2821),uid(2822)]]);
   await root('create unique index spotivity_clienti_email on public.clienti(lower(btrim(email)))');
  });

  await t.test('a campaign freezes content and audience, and changes invalidate approval even when the count stays equal',async()=>{
   const id=next(),first=await preview('clients',id);
   assert.deepEqual(await preview('clients',id),first);
   await assert.rejects(()=>preview('clients',id,'Changed subject','Mesaj de test'),error=>error.code==='22023');
   await assert.rejects(()=>approve('clients',id,first.count+1),stale);
   await root("update auth.users set email='alice-current@example.test' where id=$1",[uid(1)]);
   await assert.rejects(()=>approve('clients',id,first.count),stale);
   await root("update auth.users set email='alice@example.test' where id=$1",[uid(1)]);
  });

  await t.test('preview alone cannot claim a recipient or authorize a delivery',async()=>{
   const id=next();await preview('clients',id);
   const recipient=(await root('select id::text id from spotivity_private.announcement_recipients where campaign_id=$1 order by id limit 1',[id])).rows[0].id;
   const result=await claim('clients',id,recipient);assert.equal(result.send,false);assert.equal(result.status,'not_approved');assert.equal(result.to_email,undefined);assert.equal(result.lease_token,undefined);
   assert.equal((await preview('clients',id)).stage.pending,2);
  });

  await t.test('claims escape HTML, return only approved identities and accept an exact lease acknowledgement once',async()=>{
   const id=next(),message='Prima linie\n<script>alert("x")</script> & text',p=await preview('clients',id,'Subiect <verificat>',message);
   const approved=await approve('clients',id,p.count);assert.equal(approved.recipients.length,2);
   assert.ok(approved.recipients.every(row=>Object.keys(row).length===1&&typeof row.recipient_id==='string'));
   const deliveries=[];
   for(const recipient of approved.recipients){
    const delivery=await claim('clients',id,recipient.recipient_id);assert.equal(delivery.send,true);deliveries.push(delivery);
    assert.equal(delivery.subject,'Subiect <verificat>');assert.ok(delivery.text.includes(message));assert.ok(!delivery.html.includes('<script>'));assert.match(delivery.html,/&lt;script&gt;/);assert.match(delivery.html,/Spotivity/);assert.match(delivery.html,/https:\/\/spotivityrezervari-netizen\.github\.io\/Site\/Idee%20Site\//);assert.ok(delivery.text.includes('spotivity.rezervari@gmail.com'));
    assert.equal((await claim('clients',id,recipient.recipient_id)).send,false,'A sending lease is never automatically reissued');
    await assert.rejects(()=>finish('clients',id,recipient.recipient_id,uid(2999)),forbidden);
    assert.equal((await finish('clients',id,recipient.recipient_id,delivery.lease_token)).sent,true);
    assert.equal((await finish('clients',id,recipient.recipient_id,delivery.lease_token)).sent,true,'Lost HTTP acknowledgement is safe to repeat');
    assert.equal((await claim('clients',id,recipient.recipient_id)).send,false,'A sent recipient is never sent again');
   }
   assert.deepEqual(deliveries.map(d=>d.to_email).sort(),['alice@example.test','bob@example.test']);
   await assert.rejects(()=>rpc('claim',['clients',id,approved.recipients[0].recipient_id],{token:tokens.admins}),forbidden);
   assert.equal((await preview('clients',id,'Subiect <verificat>',message)).stage.sent,2);
  });

  await t.test('role and email changes after approval are rechecked immediately before delivery',async()=>{
   const id=next(),p=await preview('clients',id),approved=await approve('clients',id,p.count);
   await root("insert into public.users_admin(nume_admin,email,user_id,is_super,terenuri)values('Temporary manager','alice@example.test',$1,false,'Court A')",[uid(1)]);
   await root("update auth.users set email='bob-new@example.test' where id=$1",[uid(2)]);
   for(const recipient of approved.recipients)assert.equal((await claim('clients',id,recipient.recipient_id)).send,false);
   await root('delete from public.users_admin where user_id=$1',[uid(1)]);
   await root("update auth.users set email='bob@example.test' where id=$1",[uid(2)]);
  });

  await t.test('new accounts are never silently added to an approved recipient snapshot',async()=>{
   const id=next(),p=await preview('clients',id),approved=await approve('clients',id,p.count);
   await root("insert into auth.users(id,email,email_confirmed_at)values($1,'later@example.test',statement_timestamp())",[uid(2831)]);
   const summary=await preview('clients',id);assert.equal(summary.count,2);assert.equal(summary.stale,true);
   assert.equal((await root('select count(*)::integer n from spotivity_private.announcement_recipients where campaign_id=$1',[id])).rows[0].n,approved.recipients.length);
   assert.equal((await root('select count(*)::integer n from spotivity_private.announcement_recipients where campaign_id=$1 and user_id=$2',[id,uid(2831)])).rows[0].n,0);
   await assert.rejects(()=>approve('clients',id,2),stale);
   await root('delete from auth.users where id=$1',[uid(2831)]);
  });

  await t.test('approval expires after 24 hours and cannot be silently renewed or delivered',async()=>{
   const draft=next(),p=await preview('clients',draft);
   await root("update spotivity_private.announcement_campaigns set created_at=statement_timestamp()-interval '25 hours' where id=$1",[draft]);
   await assert.rejects(()=>approve('clients',draft,p.count),error=>error.code==='22023');
   const id=next(),current=await preview('admins',id),approved=await approve('admins',id,current.count);
   await root("update spotivity_private.announcement_campaigns set approved_at=statement_timestamp()-interval '25 hours',approved_until=statement_timestamp()-interval '1 hour' where id=$1",[id]);
   for(const recipient of approved.recipients){const result=await claim('admins',id,recipient.recipient_id);assert.equal(result.send,false);assert.equal(result.status,'approval_expired');}
   await assert.rejects(()=>approve('admins',id,current.count),error=>error.code==='22023');
  });

  await t.test('post-approval disablement and removed admin roles cannot receive delivery',async()=>{
   const clientId=next(),clientPreview=await preview('clients',clientId),clients=await approve('clients',clientId,clientPreview.count);
   await root("update auth.users set banned_until=case when id=$1 then statement_timestamp()+interval '1 day' end,deleted_at=case when id=$2 then statement_timestamp() end where id=any($3::uuid[])",[uid(1),uid(2),[uid(1),uid(2)]]);
   for(const recipient of clients.recipients)assert.equal((await claim('clients',clientId,recipient.recipient_id)).send,false);
   await root('update auth.users set banned_until=null,deleted_at=null where id=any($1::uuid[])',[[uid(1),uid(2)]]);
   const adminId=next(),adminPreview=await preview('admins',adminId),admins=await approve('admins',adminId,adminPreview.count);
   const ordinaryRecipient=(await root('select id::text id from spotivity_private.announcement_recipients where campaign_id=$1 and user_id=$2',[adminId,uid(3)])).rows[0].id;
   const admin=(await root('select to_jsonb(a) value from public.users_admin a where user_id=$1',[uid(3)])).rows[0].value;
   await root('delete from public.users_admin where user_id=$1',[uid(3)]);
   assert.equal((await claim('admins',adminId,ordinaryRecipient)).send,false);
   await root('insert into public.users_admin(id,nume_admin,email,user_id,is_super,terenuri)values($1,$2,$3,$4,$5,$6)',[admin.id,admin.nume_admin,admin.email,admin.user_id,admin.is_super,admin.terenuri]);
   assert.equal(admins.recipients.length,2);
  });

  await t.test('overlapping claim attempts issue only one lease without sending any mail',async()=>{
   const id=next(),p=await preview('admins',id),approved=await approve('admins',id,p.count),recipient=approved.recipients[0].recipient_id;
   await f.authorize('anon',tokens.admins);
   const [a,b]=await Promise.all([pg.query('select public.announcement_claim($1,$2,$3) value',['admins',id,recipient]),pg.query('select public.announcement_claim($1,$2,$3) value',['admins',id,recipient])]);
   assert.equal([a.rows[0].value,b.rows[0].value].filter(row=>row.send).length,1);
  });

  await t.test('reapplying the migration preserves business data, policies, tokens and campaign progress',async()=>{
   const business=await f.snapshot(),policies=(await root('select * from pg_policies order by schemaname,tablename,policyname')).rows;
   const credentials=(await root('select * from spotivity_private.announcement_credentials order by audience')).rows;
   const campaigns=(await root('select * from spotivity_private.announcement_campaigns order by id')).rows,recipients=(await root('select * from spotivity_private.announcement_recipients order by id')).rows;
   await root('select 1');await pg.exec(f.source);
   assert.deepEqual(await f.snapshot(),business);assert.deepEqual((await root('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
   assert.deepEqual((await root('select * from spotivity_private.announcement_credentials order by audience')).rows,credentials);
   assert.deepEqual((await root('select * from spotivity_private.announcement_campaigns order by id')).rows,campaigns);assert.deepEqual((await root('select * from spotivity_private.announcement_recipients order by id')).rows,recipients);
   assert.equal((await root('select count(*)::integer n from spotivity_private.migrations where version=29')).rows[0].n,1);
  });
 }finally{await pg.close();}
});
