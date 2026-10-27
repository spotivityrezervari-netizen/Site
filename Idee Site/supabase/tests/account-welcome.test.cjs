// Disposable PostgreSQL only: no live Auth accounts, Make calls or email sends.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=name=>readFileSync(join(__dirname,'..',name),'utf8');

test('confirmed-account welcome jobs preserve existing notifications and security',async t=>{
  const pg=new PGlite();
  try{
    let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
    if(process.env.SPOTIVITY_TEST_UUID_IDS==='1')schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    await pg.exec(schema);
    // Real Supabase Auth exposes these trusted timestamps; the minimal fixture
    // predates welcome emails. Existing fixture users are deliberately old.
    await pg.exec("alter table auth.users add column created_at timestamptz not null default statement_timestamp()-interval '1 year'; alter table auth.users alter column created_at set default statement_timestamp(); alter table auth.users add column deleted_at timestamptz");
    for(const file of readdirSync(join(__dirname,'..')).filter(name=>/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))>=1&&Number(name.slice(0,3))<=20&&!name.startsWith('002_')).sort())await pg.exec(sql(file));
    const as=async(role,person,query,params=[])=>{
      await pg.exec('reset role');
      await pg.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[person?uid(person):'',JSON.stringify({sub:person?uid(person):null,role})]);
      await pg.exec(`set role ${role}`);return pg.query(query,params);
    };
    const root=(query,params=[])=>as('postgres',null,query,params);
    const service=(query,params=[])=>as('service_role',null,query,params);
    const jobs=id=>root("select * from spotivity_private.notification_outbox where kind='account_welcome' and ($1::uuid is null or recipient_user_id=$1) order by id",[id||null]).then(r=>r.rows);
    const add=(n,email,confirmed=false,meta={})=>root('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,case when $3 then statement_timestamp() else null end,$4::jsonb)',[uid(n),email,confirmed,JSON.stringify(meta)]);
    const claim=()=>service("select * from public.claim_booking_notifications(20,120,null,array['account_welcome'])").then(r=>r.rows.map(row=>row.claim_booking_notifications));
    const payload=id=>root('select spotivity_private.notification_payload($1) p',[id]).then(r=>r.rows[0].p);
    const finish=job=>service("select public.finish_booking_notification($1,$2,'submitted') ok",[job.notification_id,job.lease_token]).then(r=>r.rows[0].ok);
    await add(10,'old-unconfirmed@example.test',false,{full_name:'Old Pending'});
    const snapshot=async()=> (await root("select jsonb_build_object('auth',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),'profiles',(select jsonb_agg(to_jsonb(c) order by id) from public.clienti c),'courts',(select jsonb_agg(to_jsonb(t) order by id::text) from public.terenuri t),'bookings',(select jsonb_agg(to_jsonb(r) order by id) from public.rezervari r),'roles',(select jsonb_agg(to_jsonb(a) order by id) from public.users_admin a)) s")).rows[0].s;

    await t.test('activation preserves Auth/business rows and does not backfill old verified or unverified accounts',async()=>{
      const before=await snapshot();await pg.exec(sql('021_account_welcome.sql'));
      assert.deepEqual(await snapshot(),before);assert.equal((await jobs()).length,0);
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(10)]);
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(1)]);
      assert.equal((await jobs()).length,0);
      assert.deepEqual((await service('select public.booking_notification_status() state')).rows[0].state,{ready:false});
    });
    await t.test('an unconfirmed new password account queues one welcome only after first verification',async()=>{
      await add(11,'new-client@example.test',false,{nume:'Ana Maria Pop'});
      assert.equal((await jobs(uid(11))).length,0);
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(11)]);
      let outbox=await jobs(uid(11));assert.equal(outbox.length,1);
      assert.equal(outbox[0].event_key,uid(11));assert.equal(outbox[0].recipient_key,'account');
      assert.equal(outbox[0].booking_id,null);assert.equal(outbox[0].chat_id,null);
      assert.ok(!JSON.stringify(outbox).includes('new-client@example.test'));
      assert.ok(!JSON.stringify(outbox).includes('Ana Maria'));
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(11)]);
      await root("update auth.users set email='changed@example.test',email_confirmed_at=statement_timestamp() where id=$1",[uid(11)]);
      assert.equal((await jobs(uid(11))).length,1);
      const current=await payload(outbox[0].id);
      assert.equal(current.recipient.email,'changed@example.test');
      assert.deepEqual(current.account,{firstName:'Ana'});
      assert.equal(current.recipient.name,'Ana Maria Pop');
      assert.equal(current.kind,'account_welcome');assert.equal(current.booking_id,null);
      assert.equal(current.booking,undefined);assert.equal(current.chat,undefined);
    });
    await t.test('a confirmed Google account queues once with a trusted given-name greeting',async()=>{
      await add(12,'google-client@example.test',true,{full_name:'Maria Test',given_name:'Maria',provider:'google'});
      const outbox=await jobs(uid(12));assert.equal(outbox.length,1);
      const data=await payload(outbox[0].id);assert.equal(data.recipient.email,'google-client@example.test');
      assert.deepEqual(data.account,{firstName:'Maria'});
      await root("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1",[uid(12)]);
      assert.equal((await jobs(uid(12))).length,1);
    });
    await t.test('signup transaction rollback rolls back its welcome and registration together',async()=>{
      await root('begin');
      await pg.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'rollback@example.test',statement_timestamp(),'{\"full_name\":\"Rollback Client\"}')",[uid(13)]);
      assert.equal((await pg.query("select count(*)::int n from spotivity_private.notification_outbox where recipient_user_id=$1",[uid(13)])).rows[0].n,1);
      await pg.exec('rollback');
      assert.equal((await root('select count(*)::int n from auth.users where id=$1',[uid(13)])).rows[0].n,0);
      assert.equal((await jobs(uid(13))).length,0);
    });
    await t.test('queued welcomes resolve only current verified active Auth recipients and skip deleted users',async()=>{
      await add(14,'removed@example.test',true,{first_name:'Removed'});
      let job=(await jobs(uid(14)))[0];await root('delete from auth.users where id=$1',[uid(14)]);
      assert.equal(await payload(job.id),null);
      await add(15,'soft-deleted@example.test',true,{first_name:'Deleted'});
      job=(await jobs(uid(15)))[0];await root('update auth.users set deleted_at=statement_timestamp() where id=$1',[uid(15)]);
      assert.equal(await payload(job.id),null);
      await add(16,'no-longer-verified@example.test',true,{});
      job=(await jobs(uid(16)))[0];await root('update auth.users set email_confirmed_at=null where id=$1',[uid(16)]);
      assert.equal(await payload(job.id),null);
      await root("update auth.users set email_confirmed_at=statement_timestamp(),email='reactivated@example.test' where id=$1",[uid(16)]);
      assert.equal((await jobs(uid(16))).length,1);
      assert.equal((await payload(job.id)).recipient.email,'reactivated@example.test');
      await root('update auth.users set deleted_at=statement_timestamp() where id=$1',[uid(16)]);
    });
    await t.test('only service can claim/finish welcome jobs and private helper/config data remains inaccessible',async()=>{
      for(const role of ['anon','authenticated','service_role']){
        for(const query of [
          'select * from spotivity_private.account_welcome_config',
          'select * from spotivity_private.notification_outbox',
          `select spotivity_private.notification_payload('${uid(99)}')`,
          `select spotivity_private.notification_payload_v16('${uid(99)}')`
        ])await assert.rejects(()=>as(role,role==='authenticated'?1:null,query),/permission denied/);
        if(role!=='service_role')await assert.rejects(()=>as(role,role==='authenticated'?1:null,"select * from public.claim_booking_notifications(10,120,null,array['account_welcome'])"),/permission denied/);
      }
      const state=(await root("select relrowsecurity from pg_class where oid='spotivity_private.account_welcome_config'::regclass")).rows[0];assert.equal(state.relrowsecurity,true);
      await assert.rejects(()=>root("insert into spotivity_private.notification_outbox(kind,event_key,recipient_key) values('account_welcome','bad','bad')"),/check constraint/);
      const claimed=await claim();assert.equal(claimed.length,2);
      assert.ok(claimed.every(job=>job.kind==='account_welcome'&&job.account&&job.booking_id===null));
      assert.deepEqual(claimed.map(job=>job.recipient.email).sort(),['changed@example.test','google-client@example.test']);
      assert.equal((await claim()).length,0);
      const first=claimed[0];
      assert.equal((await service("select public.finish_booking_notification($1,$2,'submitted') ok",[first.notification_id,uid(9999)])).rows[0].ok,false);
      for(const job of claimed)assert.equal(await finish(job),true);
      assert.equal((await claim()).length,0);
      assert.ok((await jobs()).filter(job=>[uid(11),uid(12)].includes(job.recipient_user_id)).every(job=>job.status==='submitted'));
      assert.ok((await jobs()).filter(job=>[uid(14),uid(15),uid(16)].includes(job.recipient_user_id)).every(job=>job.status==='skipped'));
    });
    await t.test('new welcome support leaves grouped booking client/owner payloads and leases intact',async()=>{
      const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
      const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+2)::text booking_day")).rows[0].booking_day;
      await service('select public.create_guest_booking_group($1,$2,$3,$4::text[],false,$5,$6,$7)',[uid(50),court,day,['15:00','16:00'],'Guest','guest@example.test','+40 721 123 456']);
      const rows=(await service("select * from public.claim_booking_notifications(20,120,$1,array['booking_created_client','booking_created_owner'])",[uid(50)])).rows.map(r=>r.claim_booking_notifications);
      assert.equal(rows.length,2);assert.ok(rows.every(job=>job.booking.id===uid(50)&&job.booking.hours.length===2));
      assert.equal(rows.find(job=>job.kind==='booking_created_owner').recipient.email,'admin@example.test');
      assert.equal(rows.find(job=>job.kind==='booking_created_client').recipient.email,'guest@example.test');
      assert.ok(rows.every(job=>job.account===undefined));
      for(const job of rows)assert.equal(await finish(job),true);
    });
    await t.test('rerunning migration preserves activation boundary, queued/submitted jobs and old-account exclusion',async()=>{
      const before=(await root('select * from spotivity_private.notification_outbox order by id')).rows;
      const activated=(await root('select activated_at::text at from spotivity_private.account_welcome_config')).rows[0].at;
      await root('select 1');await pg.exec(sql('021_account_welcome.sql'));
      assert.deepEqual((await root('select * from spotivity_private.notification_outbox order by id')).rows,before);
      assert.equal((await root('select activated_at::text at from spotivity_private.account_welcome_config')).rows[0].at,activated);
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(10)]);
      assert.equal((await jobs(uid(10))).length,0);
      await add(17,'after-reapply@example.test',true,{name:'After Reapply'});
      assert.equal((await jobs(uid(17))).length,1);
    });
  }finally{await pg.close();}
});
