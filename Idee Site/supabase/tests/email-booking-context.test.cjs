// Read-only email-link RPC security, exercised only in disposable PostgreSQL.
// This test imports no hosted credentials and never sends email or HTTP traffic.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createFixture,uid}=require('./club-request-fixture.cjs');
const sql=name=>readFileSync(join(__dirname,'..',name),'utf8');

test('email booking context preserves ownership, cancellation protection and trusted notification data',async t=>{
 const fixture=await createFixture(),{pg}=fixture;
 const as=async(role,person,query,params=[])=>fixture.serial(async()=>{
  await pg.exec('reset role');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[person?uid(person):'']);
  await pg.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:person?uid(person):null})]);
  await pg.exec(`set role ${role}`);
  return pg.query(query,params);
 });
 const root=(query,params=[])=>as('postgres',null,query,params);
 const context=(person,id)=>as('authenticated',person,'select public.get_email_booking_context($1) value',[id]).then(r=>r.rows[0].value);
 const denied=error=>error.code==='42501';
 const state=async()=>{
  const result={};
  for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.baze_sportive','public.baze_sportive_admini','spotivity_private.booking_groups','spotivity_private.notification_outbox'])result[table]=(await root(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows;
  return result;
 };
 try{
  await root("alter table auth.users add column created_at timestamptz not null default '2000-01-01T00:00:00Z'");
  await fixture.root(()=>pg.exec(sql('021_account_welcome.sql')));
  const courts=(await root('select id::text id,nume from public.terenuri')).rows;
  const a=courts.find(c=>c.nume==='Court A').id,b=courts.find(c=>c.nume==='Court B').id;
  await root("update public.clienti set telefon=case when user_id=$1 then '0712345678' else '0799999999' end",[uid(1)]);
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+2)::text booking_day")).rows[0].booking_day;
  const nextDay=(await root('select ($1::date+1)::text booking_day',[day])).rows[0].booking_day;
  const create=(person,id,court,date,hours)=>as('authenticated',person,'select public.create_booking_group($1,$2,$3::date,$4::text[],false) value',[uid(id),court,date,hours]);
  await create(1,2201,a,day,['12:00','13:00']);
  await create(2,2202,b,day,['15:00']);
  await create(1,2203,b,nextDay,['16:00']);
  // Trusted fixture maintenance moves a group into history, exercising persisted
  // instants rather than changing a clock or bypassing a browser permission.
  await root("update spotivity_private.booking_groups set booking_day='2000-01-01' where id=$1",[uid(2203)]);
  await root("update public.rezervari set data_str='2000-01-01' where booking_group_id=$1",[uid(2203)]);
  await as('service_role',null,'select public.create_guest_booking_group($1,$2,$3::date,$4::text[],false,$5,$6,$7)',[uid(2204),a,nextDay,['18:00'],'Guest using Alice contact','alice@example.test','0722222233']);
  const before=await state();
  await fixture.root(()=>pg.exec(sql('022_email_booking_context.sql')));

  await t.test('migration preserves every existing business row and registers exactly once',async()=>{
   assert.deepEqual(await state(),before);
   assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=22')).rows[0].n,1);
   await fixture.root(()=>pg.exec(sql('022_email_booking_context.sql')));
   assert.deepEqual(await state(),before);
  });
  await t.test('only the verified booking client receives its private context and cancellable hours',async()=>{
   const c=await context(1,uid(2201));
   assert.equal(c.booking_id,uid(2201));assert.equal(c.court_id,a);assert.equal(c.court_name,'Court A');
   assert.equal(c.customer_email,'alice@example.test');assert.equal(c.sport,'Fotbal');assert.equal(c.total,200);
   assert.deepEqual(c.hours,['12:00','13:00']);assert.equal(c.can_cancel,true);assert.equal(c.is_owner,false);
   assert.deepEqual(c.cancellable_hours,['12:00','13:00']);assert.ok(!JSON.stringify(c).includes('token'));
  });
  await t.test('another client and guessed booking UUID return the same authorization failure',async()=>{
   let unrelated,unknown;
   try{await context(2,uid(2201));}catch(error){unrelated=error;}
   try{await context(2,uid(999999));}catch(error){unknown=error;}
   assert.ok(unrelated&&unknown);assert.equal(unrelated.code,'42501');assert.equal(unknown.code,'42501');
   assert.equal(unrelated.message,unknown.message);
  });
  await t.test('ordinary owner can view only its allocated court and cannot inherit client cancellation rights',async()=>{
   const c=await context(3,uid(2201));
   assert.equal(c.is_owner,true);assert.equal(c.can_cancel,false);assert.deepEqual(c.cancellable_hours,[]);
   assert.equal(c.customer_email,'alice@example.test');
   await assert.rejects(()=>context(3,uid(2202)),denied);
  });
  await t.test('superadmin can inspect both courts without becoming the booking client',async()=>{
   for(const id of [2201,2202]){
    const c=await context(4,uid(id));assert.equal(c.booking_id,uid(id));assert.equal(c.is_owner,true);
    assert.equal(c.can_cancel,false);assert.deepEqual(c.cancellable_hours,[]);
   }
  });
  await t.test('guest contact matching a verified client email never creates Auth ownership',async()=>{
   await assert.rejects(()=>context(1,uid(2204)),denied);
   assert.equal((await context(3,uid(2204))).customer_email,'alice@example.test');
  });
  await t.test('anonymous/service callers and unconfirmed accounts cannot use the authenticated RPC',async()=>{
   for(const role of ['anon','service_role'])await assert.rejects(()=>as(role,null,'select public.get_email_booking_context($1)',[uid(2201)]),denied);
   await root('update auth.users set email_confirmed_at=null where id=$1',[uid(1)]);
   await assert.rejects(()=>context(1,uid(2201)),denied);
   await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(1)]);
  });
  await t.test('completed booking context reports no cancellable hours and cannot cancel or rewrite history',async()=>{
   const snapshot=await state(),c=await context(1,uid(2203));
   assert.equal(c.can_cancel,false);assert.deepEqual(c.cancellable_hours,[]);assert.equal(c.day,'2000-01-01');
   await assert.rejects(()=>as('authenticated',1,'select public.cancel_owned_booking_group($1)',[uid(2203)]),denied);
   assert.deepEqual(await state(),snapshot);
  });
  await t.test('Maps payload uses only the current trusted court location and omits unapproved URLs',async()=>{
   const id=(await root("select id from spotivity_private.notification_outbox where booking_id=$1 and kind='booking_created_client'",[uid(2201)])).rows[0].id;
   const payload=()=>root('select spotivity_private.notification_payload($1) value',[id]).then(r=>r.rows[0].value);
   const previous=(await root('select spotivity_private.notification_payload_v21($1) value',[id])).rows[0].value;
   const valid='https://www.google.com/maps/search/?api=1&query=Club+Nord';
   await root('update public.terenuri set locatie=$1 where id::text=$2',[valid,a]);
   assert.deepEqual(await payload(),{...previous,booking:{...previous.booking,mapsURL:valid}});
   for(const location of ['https://evil.example/maps','http://google.com/maps','javascript:alert(1)',null]){
    await root('update public.terenuri set locatie=$1 where id::text=$2',[location,a]);
    assert.deepEqual(await payload(),previous);
   }
  });
  await t.test('welcome and chat payloads pass through the wrapper without changes or booking metadata',async()=>{
   await root("insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data) values($1,'welcome-context@example.test',statement_timestamp(),statement_timestamp(),'{\"given_name\":\"Ana\",\"full_name\":\"Ana Exemplu\"}')",[uid(2250)]);
   const welcome=(await root("select id from spotivity_private.notification_outbox where kind='account_welcome' and recipient_user_id=$1",[uid(2250)])).rows[0].id;
   await as('authenticated',1,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj,citit) values('alice@example.test','Court A','client','Mesaj de test',false)");
   const chat=(await root("select id from spotivity_private.notification_outbox where kind='chat_owner' order by created_at desc limit 1")).rows[0].id;
   for(const id of [welcome,chat]){
    const wrapper=(await root('select spotivity_private.notification_payload($1) value',[id])).rows[0].value;
    const previous=(await root('select spotivity_private.notification_payload_v21($1) value',[id])).rows[0].value;
    assert.deepEqual(wrapper,previous);assert.equal(wrapper.booking_id,null);assert.equal(wrapper.booking,undefined);
   }
  });
  await t.test('revocation immediately removes owner access while retaining the original client rights',async()=>{
   await root("update public.users_admin set terenuri='Court B' where user_id=$1",[uid(3)]);
   await assert.rejects(()=>context(3,uid(2201)),denied);
   assert.equal((await context(1,uid(2201))).can_cancel,true);
  });
 }finally{await fixture.close();}
});
