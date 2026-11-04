// Disposable PostgreSQL only: production is never contacted or modified.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const migration=readFileSync(join(directory,'027_booking_integrity_and_rate_limits.sql'),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const pg=new PGlite();await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01'");
 for(const file of readdirSync(directory).filter(file=>/^(001|00[3-9]|01[0-9]|02[0-6])_.*\.sql$/.test(file)).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
 const as=async(role,person,sql,params=[])=>{
  await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[person?uid(person):'',JSON.stringify({role,sub:person?uid(person):null})]);await pg.exec(`set role ${role}`);return pg.query(sql,params);
 };
 const root=(q,p=[])=>as('postgres',null,q,p),service=(q,p=[])=>as('service_role',null,q,p);
 const snapshot=async()=>{const state={};for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','storage.objects','spotivity_private.booking_groups','spotivity_private.notification_outbox','spotivity_private.late_cancellation_events'])state[table]=(await root(`select to_jsonb(r) value from ${table} r order by to_jsonb(r)::text`)).rows;return state;};
 const apply=async()=>{await root('select 1');await pg.exec(migration);};
 return {pg,as,root,service,snapshot,apply};
}

test('027 restores production booking protections without changing business rows or RLS',async t=>{
 const f=await fixture(),{pg,as,root,service,apply}=f;
 try{
  const before=await f.snapshot(),policies=(await root('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  await apply();assert.deepEqual(await f.snapshot(),before);assert.deepEqual((await root('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+3)::text d")).rows[0].d;
  const court=(await root("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
  const book=(person,id,hours,total)=>as('authenticated',person,'select public.create_booking_group($1,$2,$3::date,$4::text[],false,$5::numeric) value',[uid(id),court,day,hours,total]).then(r=>r.rows[0].value);
  const guest=(id,email,phone,hours)=>service('select public.create_guest_booking_group($1,$2,$3::date,$4::text[],false,$5,$6,$7,100) value',[uid(id),court,day,hours,'Unverified Guest',email,phone]).then(r=>r.rows[0].value);
  await t.test('price changes reject a new request atomically and a committed retry returns its original booking',async()=>{
   await root("update public.terenuri set pret=250 where id::text=$1",[court]);
   await assert.rejects(()=>book(2,2701,['12:00'],100),e=>e.code==='P0001'&&e.message==='PRICE_CHANGED');
   assert.equal((await root('select count(*)::integer n from spotivity_private.booking_groups where id=$1',[uid(2701)])).rows[0].n,0);
   const committed=await book(2,2701,['12:00'],250);assert.equal(committed.total,250);
   await root('update public.terenuri set pret=300 where id::text=$1',[court]);
   assert.deepEqual(await book(2,2701,['12:00'],300),committed,'A lost acknowledgement must never cause a second booking or reject a committed one');
   await assert.rejects(()=>book(2,2701,['13:00'],300),e=>e.code==='23505');
   await root('update public.terenuri set pret=100 where id::text=$1',[court]);
  });
  await t.test('unverified guest contacts cannot consume a registered identity quota',async()=>{
   await as('authenticated',1,"update public.clienti set telefon='0712345678' where user_id=auth.uid()");
   await guest(2702,'alice@example.test','0712345678',['14:00']);
   assert.equal((await book(1,2703,['15:00'],100)).state,'activa');
   await assert.rejects(()=>book(1,2704,['16:00'],100),/one active booking/);
   await assert.rejects(()=>guest(2705,'alice@example.test','0733333333',['16:00']),/one active booking/);
  });
  await t.test('direct customer cancellation records one event and account/guest email matches stay separate',async()=>{
   // Advance only this saved fixture slot into its late-cancellation window;
   // avoid making the test depend on the host hour or allowed opening hours.
   await root('alter table public.rezervari disable trigger spotivity_booking_guard');
   await root("update public.rezervari set starts_at=statement_timestamp()+interval '30 minutes' where booking_group_id=$1",[uid(2703)]);
   await root('alter table public.rezervari enable trigger spotivity_booking_guard');
   const changed=await as('authenticated',1,"update public.rezervari set stare='anulata' where booking_group_id=$1 returning id",[uid(2703)]);assert.equal(changed.rows.length,1);
   assert.equal((await root('select count(*)::integer n from spotivity_private.late_cancellation_events where booking_id=$1',[uid(2703)])).rows[0].n,1);
   // Seed a separate guest audit snapshot for the identity-aggregation case;
   // the existing late-cancellations suite covers the token cancellation path.
   await root("insert into spotivity_private.late_cancellation_events(booking_id,customer_email,customer_name,customer_phone,court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds) select id,contact_email,contact_name,contact_phone,court_name,booking_day,statement_timestamp()+interval '30 minutes',statement_timestamp(),1800 from spotivity_private.booking_groups where id=$1",[uid(2702)]);
   const review=(await as('authenticated',4,'select public.list_late_cancellations() value')).rows[0].value;
   const alice=review.customers.filter(row=>row.email==='alice@example.test');assert.equal(alice.length,2);assert.deepEqual(alice.map(row=>row.identity_kind).sort(),['account','guest']);assert.ok(alice.every(row=>row.count===1));
  });
  await t.test('one backwards-compatible RPC signature remains and private capabilities stay inaccessible',async()=>{
   for(const name of ['create_booking_group','create_guest_booking_group'])assert.equal((await root("select count(*)::integer n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[name])).rows[0].n,1);
   for(const role of ['anon','authenticated']){
    await assert.rejects(()=>as(role,role==='authenticated'?1:null,"select public.consume_public_rate_limit('booking_guest',$1,10,600)",[hash('client')]),e=>e.code==='42501');
    await assert.rejects(()=>as(role,role==='authenticated'?1:null,'select * from spotivity_private.public_rate_limits'),e=>e.code==='42501');
   }
   await assert.rejects(()=>service('select * from spotivity_private.public_rate_limits'),e=>e.code==='42501');
   const after=await f.snapshot();await apply();assert.deepEqual(await f.snapshot(),after);
  });
 }finally{await pg.close();}
});

test('shared persistent budgets survive migration refresh, bound global state and validate policies',async()=>{
 const {pg,root,service,apply}=await fixture();
 try{
  await apply();
  const consume=(scope,subject,limit)=>service('select public.consume_public_rate_limit($1,$2,$3,600) allowed',[scope,hash(subject),limit]).then(r=>r.rows[0].allowed);
  for(let i=0;i<10;i++)assert.equal(await consume('booking_guest','ip-one',10),true);
  assert.equal(await consume('booking_guest','ip-one',10),false);
  const counterBefore=(await root('select * from spotivity_private.public_rate_limits order by scope,subject_hash')).rows;
  // Production already had these signatures/counters before the numbered
  // migration. Restore its exact reviewed internal body (including its former
  // price-on-retry check), then verify the upgrade path preserves all state.
  await root('select 1');
  await pg.exec(readFileSync(join(__dirname,'fixtures/pre-027-booking-internal.sql'),'utf8'));
  await root('delete from spotivity_private.migrations where version=27');
  const liveBefore=(await root("select md5(prosrc) digest from pg_proc where oid='spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text,numeric)'::regprocedure")).rows[0].digest;
  await apply();
  assert.notEqual((await root("select md5(prosrc) digest from pg_proc where oid='spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text,numeric)'::regprocedure")).rows[0].digest,liveBefore,'The reviewed production body is reconciled, not silently skipped');
  assert.deepEqual((await root('select * from spotivity_private.public_rate_limits order by scope,subject_hash')).rows,counterBefore);
  assert.equal(await consume('booking_guest','ip-one',10),false,'Restart/refresh must not reset the budget');
  assert.equal(await consume('club_application','ip-one',20),true);
  for(const [scope,limit]of [['booking_guest',11],['unknown',10]])await assert.rejects(()=>consume(scope,'invalid',limit),e=>e.code==='22023');
  await assert.rejects(()=>service("select public.consume_public_rate_limit('booking_guest','bad',10,600)"),e=>e.code==='22023');
  // Pin filling and consuming the current minute to one statement timestamp.
  await root(`do $test$ declare before_count integer; begin
    insert into spotivity_private.public_rate_limits(scope,subject_hash,window_start,window_seconds,expires_at,requests)
      values('_global',repeat('0',64),to_timestamp(floor(extract(epoch from statement_timestamp())/60)*60),60,statement_timestamp()+interval '1 minute',600)
      on conflict(scope,subject_hash,window_start,window_seconds) do update set requests=600;
    select count(*) into before_count from spotivity_private.public_rate_limits;
    if public.consume_public_rate_limit('booking_guest',repeat('b',64),10,600) then raise exception 'Global budget must block'; end if;
    if (select count(*) from spotivity_private.public_rate_limits)<>before_count then raise exception 'Exhausted global budget must not allocate a subject'; end if;
  end $test$`);
 }finally{await pg.close();}
});
