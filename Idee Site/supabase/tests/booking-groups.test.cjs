// Disposable local PostgreSQL tests only. Never run against a hosted project.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=name=>readFileSync(join(__dirname,'..',name),'utf8');
const integerIds=process.env.SPOTIVITY_TEST_INTEGER_IDS==='1';
const hash=value=>createHash('sha256').update(value).digest('hex');
let passed=0;

(async()=>{const pg=new PGlite();try{
  let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
  if(integerIds)schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
  else schema=schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key','create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
  await pg.exec(schema);
  const as=async(role,person,sql,params=[])=>{
    await pg.exec(`reset role;select set_config('request.jwt.claim.sub','${person?uid(person):''}',false);select set_config('request.jwt.claims','${person?JSON.stringify({sub:uid(person),role}):''}',false);set role ${role}`);
    return pg.query(sql,params);
  };
  const root=(sql,params=[])=>as('postgres',null,sql,params);
  const service=(sql,params=[])=>as('service_role',null,sql,params);
  const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
  const snapshot=async()=>{
    const state={};
    for(const table of ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.baze_sportive','public.baze_sportive_admini','public.cereri_baze_sportive','storage.objects']){
      state[table]=(await root(`select to_jsonb(t)-array['booking_group_id','guest_name','guest_phone'] value from ${table} t order by (to_jsonb(t)-array['booking_group_id','guest_name','guest_phone'])::text`)).rows;
    }
    return state;
  };
  await check('014 refuses an unsecured or incomplete schema',async()=>{
    await assert.rejects(()=>pg.exec(file('014_booking_groups.sql')),/Apply migrations/);await pg.exec('rollback');
  });
  for(const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql'])await pg.exec(file(name));
  const before=await snapshot();
  await pg.exec(file('014_booking_groups.sql'));
  await check('014 preserves every existing business row and registers once',async()=>{
    assert.deepEqual(await snapshot(),before);
    assert.equal((await root('select count(*)::integer count from spotivity_private.migrations where version=14')).rows[0].count,1);
    await root('select 1');await pg.exec(file('014_booking_groups.sql'));assert.deepEqual(await snapshot(),before);
  });
  await check('private metadata and service RPCs are inaccessible to browser roles',async()=>{
    for(const role of ['anon','authenticated']){
      await assert.rejects(()=>as(role,role==='authenticated'?1:null,'select * from spotivity_private.booking_groups'),/permission denied/);
      for(const signature of ['public.create_guest_booking_group(uuid,text,date,text[],boolean,text,text,text)','public.get_booking_group_delivery(uuid)','public.attach_cancellation_token(uuid,text)','public.preview_booking_cancellation(uuid,text)','public.cancel_booking_group_by_token(uuid,text)']){
        assert.equal((await root('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed,false,`${role}: ${signature}`);
      }
    }
    for(const role of ['anon','service_role'])assert.equal((await root("select has_function_privilege($1,'public.create_booking_group(uuid,text,date,text[],boolean)','execute') allowed",[role])).rows[0].allowed,false);
  });
  const day=(await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+2)::text as booking_date")).rows[0].booking_date;
  const dayAfter=(await root('select ($1::date+1)::text as booking_date',[day])).rows[0].booking_date;
  const courts=(await root('select id::text,nume from public.terenuri')).rows;
  const courtA=courts.find(c=>c.nume==='Court A').id,courtB=courts.find(c=>c.nume==='Court B').id;
  await root("update public.terenuri set oras='Cluj' where nume='Court A'");
  await root("insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,oras,este_activ) values('Other City Football','Fotbal',80,10,true,'Brasov',true)");
  const otherCourt=(await root("select id::text from public.terenuri where nume='Other City Football'")).rows[0].id;
  await as('authenticated',1,"update public.clienti set telefon='0712345678' where user_id=$1",[uid(1)]);
  await as('authenticated',2,"update public.clienti set telefon='0799999999' where user_id=$1",[uid(2)]);
  const create=(person,id,court=courtA,hours=['12:00'],date=day,ball=false)=>as('authenticated',person,
    'select public.create_booking_group($1,$2,$3::date,$4::text[],$5) value',[uid(id),court,date,hours,ball]).then(r=>r.rows[0].value);
  const guest=(id,{court=courtA,hours=['16:00'],date=day,name='Guest',email='guest@example.test',phone='0722222222',ball=false}={})=>service(
    'select public.create_guest_booking_group($1,$2,$3::date,$4::text[],$5,$6,$7,$8) value',[uid(id),court,date,hours,ball,name,email,phone]).then(r=>r.rows[0].value);
  const rows=id=>root('select * from public.rezervari where booking_group_id=$1 order by ora',[uid(id)]).then(r=>r.rows);
  const countGroups=()=>root('select count(*)::integer count from spotivity_private.booking_groups').then(r=>r.rows[0].count);
  const cancelOwned=(person,id)=>as('authenticated',person,'select public.cancel_owned_booking_group($1) value',[uid(id)]).then(r=>r.rows[0].value);
  let first;
  await check('one atomic booking accepts consecutive hours, canonical prices and one ball surcharge',async()=>{
    first=await create(1,101,courtA,['14:00','12:00','13:00'],day,true);
    assert.equal(first.booking_id,uid(101));assert.equal(first.total,315);assert.equal(first.state,'activa');
    assert.deepEqual(first.hours,['12:00','13:00','14:00']);assert.equal(first.reservation_ids.length,3);
    const saved=await rows(101);assert.deepEqual(saved.map(r=>r.pret_total),['115 RON (+Minge)','100 RON','100 RON']);
    assert.ok(saved.every(r=>r.client_user_id===uid(1)&&r.sport==='Fotbal'&&r.email_client==='alice@example.test'));
    assert.equal((await root('select sealed,status from spotivity_private.booking_groups where id=$1',[uid(101)])).rows[0].sealed,true);
  });
  await check('retry is idempotent and response contains no contact information or token digest',async()=>{
    assert.deepEqual(await create(1,101,courtA,['12:00','13:00','14:00'],day,true),first);
    assert.equal((await rows(101)).length,3);
    for(const key of ['email','phone','contact_name','owner_auth_id','cancellation_token_hash'])assert.equal(first[key],undefined);
    await assert.rejects(()=>create(1,101,courtA,['12:00'],day,true),/identifier was already used/);
    await assert.rejects(()=>create(2,101,courtA,['12:00','13:00','14:00'],day,true),/identifier was already used/);
  });
  await check('a second booking is blocked across courts and cities for the same sport and day',async()=>{
    await assert.rejects(()=>create(1,102,otherCourt,['18:00']),/one active booking per sport and day/);
    assert.equal((await rows(102)).length,0);
    await assert.rejects(()=>guest(103,{court:otherCourt,hours:['18:00'],email:' ALICE@EXAMPLE.TEST ',phone:'0733333333'}),/one active booking per sport and day/);
    await assert.rejects(()=>guest(104,{court:otherCourt,hours:['18:00'],email:'alternate@example.test',phone:'0712 345 678'}),/one active booking per sport and day/);
    await assert.rejects(()=>guest(107,{court:otherCourt,hours:['18:00'],email:'international@example.test',phone:'+40 (712) 345 678'}),/one active booking per sport and day/);
    await assert.rejects(()=>guest(108,{court:otherCourt,hours:['18:00'],email:'prefix@example.test',phone:'0040 712 345 678'}),/one active booking per sport and day/);
  });
  await check('the same person may book another sport or another day',async()=>{
    assert.equal((await create(1,105,courtB,['12:00'])).sport,'Tenis');
    assert.equal((await create(1,106,courtA,['12:00'],dayAfter)).day,dayAfter);
  });
  await check('nonconsecutive, duplicate, unsupported, past and far-future hours create nothing',async()=>{
    const before=await countGroups();
    for(const hours of [['12:00','14:00'],['12:00','12:00'],['08:00'],[],[null]])await assert.rejects(()=>create(2,110,courtA,hours));
    await assert.rejects(()=>create(2,110,courtA,['12:00'],'2020-01-01'));
    const tooFar=(await root('select ($1::date+20)::text as booking_date',[day])).rows[0].booking_date;
    await assert.rejects(()=>create(2,110,courtA,['12:00'],tooFar));
    assert.equal(await countGroups(),before);
  });
  await check('slot conflicts roll back the entire group and all earlier inserted hours',async()=>{
    await assert.rejects(()=>create(2,111,courtA,['11:00','12:00']),/unavailable/);
    await assert.rejects(()=>create(2,111,courtA,['14:00','15:00']),/duplicate key/);
    assert.equal((await rows(111)).length,0);
    assert.equal((await root('select id from spotivity_private.booking_groups where id=$1',[uid(111)])).rows.length,0);
  });
  await check('clients cannot bypass grouping or append hours using a known group UUID',async()=>{
    await assert.rejects(()=>as('authenticated',2,"insert into public.rezervari(email_client,teren,data_str,ora,stare) values('bob@example.test','Court A',$1,'18:00','activa')",[day]),/Use create_booking_group/);
    await assert.rejects(()=>as('authenticated',1,"insert into public.rezervari(email_client,teren,data_str,ora,stare,booking_group_id) values('alice@example.test','Court A',$1,'18:00','activa',$2)",[day,uid(101)]),/original atomic request/);
    await assert.rejects(()=>as('authenticated',1,"update public.rezervari set booking_group_id=null where booking_group_id=$1",[uid(101)]));
    assert.equal((await rows(101)).length,3);
  });
  await check('staff manual and blocked slots retain their existing permissions',async()=>{
    const inserted=(await as('authenticated',3,"insert into public.rezervari(email_client,sport,teren,data_str,ora,stare,pret_total) values('Teren Blocat','Blocat','Court A',$1,'21:00','activa','0 RON') returning *",[day])).rows[0];
    assert.equal(inserted.client_user_id,null);assert.equal(inserted.booking_group_id,null);
    await assert.rejects(()=>as('authenticated',3,"insert into public.rezervari(email_client,sport,teren,data_str,ora,stare) values('Teren Blocat','Blocat','Court B',$1,'21:00','activa')",[day]));
  });
  let guestResult;
  await check('a guest booking creates no Auth account or client profile and carries explicit guest contact',async()=>{
    const before=(await root('select (select count(*) from auth.users)::integer users,(select count(*) from public.clienti)::integer profiles')).rows[0];
    guestResult=await guest(120,{hours:['16:00','17:00'],name:'Guest <visitor>',email:' GUEST@EXAMPLE.TEST ',phone:'+40 722 222 222'});
    assert.equal(guestResult.total,200);
    const saved=await rows(120);assert.ok(saved.every(r=>r.client_user_id===null&&r.guest_name==='Guest <visitor>'&&r.guest_phone==='+40 722 222 222'&&r.email_client==='guest@example.test'));
    assert.deepEqual((await root('select (select count(*) from auth.users)::integer users,(select count(*) from public.clienti)::integer profiles')).rows[0],before);
    assert.deepEqual(await guest(120,{hours:['16:00','17:00'],name:'Guest <visitor>',email:'guest@example.test',phone:'+40 722 222 222'}),guestResult);
  });
  await check('guest and registered identities share the email and phone quota',async()=>{
    await assert.rejects(()=>guest(121,{court:otherCourt,hours:['18:00'],email:'guest@example.test',phone:'0744444444'}),/one active booking/);
    await assert.rejects(()=>guest(122,{court:otherCourt,hours:['18:00'],email:'different@example.test',phone:'+40722222222'}),/one active booking/);
    await guest(123,{court:otherCourt,hours:['18:00'],email:'bob@example.test',phone:'0799999999'});
    await assert.rejects(()=>create(2,124,courtA,['18:00']),/one active booking/);
    assert.ok((await rows(123)).every(r=>r.client_user_id===null));
  });
  await check('guest contact is immutable and is not visible to unrelated clients',async()=>{
    assert.equal((await as('authenticated',1,'select id from public.rezervari where booking_group_id=$1',[uid(120)])).rows.length,0);
    assert.equal((await as('anon',null,'select * from public.rezervari_disponibilitate where data_str=$1',[day])).rows.some(r=>'guest_phone'in r),false);
    await assert.rejects(()=>as('authenticated',3,"update public.rezervari set guest_phone='0755555555' where booking_group_id=$1",[uid(120)]),/immutable/);
    const visible=(await as('authenticated',3,'select guest_name,guest_phone from public.rezervari where booking_group_id=$1',[uid(120)])).rows;
    assert.equal(visible.length,2);assert.equal(visible[0].guest_phone,'+40 722 222 222');
  });
  await check('guest input validation happens before any reservation or identity is created',async()=>{
    const before=await countGroups();
    for(const changes of [{email:'bad'},{phone:'12'},{phone:'1234567\n'},{name:'bad\nname'},{hours:['16:00','18:00']}])await assert.rejects(()=>guest(125,{court:otherCourt,hours:['12:00'],...changes}));
    assert.equal(await countGroups(),before);
  });
  await check('guest RPC clears and restores both subject claim formats, including failures',async()=>{
    await as('service_role',1,'select public.create_guest_booking_group($1,$2,$3::date,$4::text[],false,$5,$6,$7)',[uid(126),otherCourt,dayAfter,['12:00'],'Claim guest','claims@example.test','0766666666']);
    let claims=(await pg.query("select current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claims',true)::jsonb claims")).rows[0];assert.equal(claims.subject,uid(1));assert.equal(claims.claims.sub,uid(1));
    await assert.rejects(()=>as('service_role',1,"select public.create_guest_booking_group($1,$2,$3::date,array['12:00'],false,'Bad','bad','123')",[uid(127),otherCourt,dayAfter]));
    claims=(await pg.query("select current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claims',true)::jsonb claims")).rows[0];assert.equal(claims.subject,uid(1));assert.equal(claims.claims.sub,uid(1));
  });
  await check('cancellation digests attach idempotently and cannot be replaced or exposed',async()=>{
    await service('select public.attach_cancellation_token($1,$2)',[uid(120),hash('opaque-fixture')]);
    await service('select public.attach_cancellation_token($1,$2)',[uid(120),hash('opaque-fixture')]);
    await assert.rejects(()=>service('select public.attach_cancellation_token($1,$2)',[uid(120),hash('other')]),/cannot be replaced/);
    await assert.rejects(()=>service('select public.attach_cancellation_token($1,$2)',[uid(120),'raw-token']),/digest/);
    const delivery=(await service('select public.get_booking_group_delivery($1) value',[uid(120)])).rows[0].value;
    assert.equal(delivery.email,'guest@example.test');assert.equal(delivery.slots.length,2);assert.equal(delivery.cancellation_token_hash,undefined);
    const persisted=(await root('select cancellation_token_hash from spotivity_private.booking_groups where id=$1',[uid(120)])).rows[0].cancellation_token_hash;
    assert.equal(persisted,hash('opaque-fixture'));assert.notEqual(persisted,'opaque-fixture');
  });
  await check('email preview changes nothing and invalid tokens cannot cancel',async()=>{
    const original=await rows(120);
    const preview=(await service('select public.preview_booking_cancellation($1,$2) value',[uid(120),hash('opaque-fixture')])).rows[0].value;
    assert.deepEqual(preview.cancellable_hours,['16:00','17:00']);assert.equal(preview.email,undefined);
    assert.deepEqual(await rows(120),original);
    for(const fn of ['preview_booking_cancellation','cancel_booking_group_by_token'])await assert.rejects(()=>service(`select public.${fn}($1,$2)`,[uid(120),hash('invalid')]),/Invalid cancellation link/);
    assert.deepEqual(await rows(120),original);
  });
  await check('token cancellation frees all unfinished hours, is idempotent and releases the active quota',async()=>{
    const cancelled=(await service('select public.cancel_booking_group_by_token($1,$2) value',[uid(120),hash('opaque-fixture')])).rows[0].value;
    assert.equal(cancelled.state,'anulata');assert.equal(cancelled.cancelled_count,2);
    assert.ok((await rows(120)).every(r=>r.stare==='anulata'));
    assert.equal((await root('select status from spotivity_private.booking_groups where id=$1',[uid(120)])).rows[0].status,'anulata');
    assert.equal((await service('select public.cancel_booking_group_by_token($1,$2) value',[uid(120),hash('opaque-fixture')])).rows[0].value.state,'anulata');
    assert.equal((await guest(128,{court:otherCourt,hours:['16:00'],email:'guest@example.test',phone:'+40722222222'})).state,'activa');
  });
  await check('only the actual Auth owner can cancel a group and retries do not resurrect it',async()=>{
    for(const person of [2,3,4])await assert.rejects(()=>cancelOwned(person,101),/Only the booking owner/);
    const cancelled=await cancelOwned(1,101);assert.equal(cancelled.state,'anulata');assert.equal(cancelled.cancelled_count,3);
    assert.equal((await create(1,101,courtA,['12:00','13:00','14:00'],day,true)).state,'anulata');
    assert.equal((await create(1,130,otherCourt,['20:00'])).state,'activa');
  });
  await check('grouped bookings cannot be moved to evade day or sport limits',async()=>{
    await assert.rejects(()=>as('authenticated',4,'update public.rezervari set data_str=$2 where booking_group_id=$1',[uid(130),dayAfter]),/immutable/);
  });
  await check('existing active legacy bookings still block new groups without rewriting their data',async()=>{
    const legacy=(await root("insert into public.rezervari(email_client,client_user_id,sport,teren,data_str,ora,stare) values('alice@example.test',$1,'Tenis','Court B',$2,'12:00','activa') returning *",[uid(1),dayAfter])).rows[0];
    await assert.rejects(()=>create(1,131,courtB,['13:00'],dayAfter),/one active booking/);
    assert.deepEqual((await root('select * from public.rezervari where id=$1',[legacy.id])).rows[0],legacy);
  });
  await check('cancellation preserves completed hours, permits remaining hours and retains their quota',async()=>{
    const group=await create(2,140,courtB,['18:00','19:00'],dayAfter);
    await root('alter table public.rezervari disable trigger spotivity_booking_guard');
    await root('alter table public.rezervari disable trigger spotivity_booking_quota_guard');
    try{await root("update public.rezervari set starts_at=statement_timestamp()-interval '2 hours' where booking_group_id=$1 and ora='18:00'",[group.booking_id]);}
    finally{await root('alter table public.rezervari enable trigger spotivity_booking_guard');await root('alter table public.rezervari enable trigger spotivity_booking_quota_guard');}
    const before=await rows(140),cancelled=await cancelOwned(2,140);
    assert.equal(cancelled.state,'partial');assert.equal(cancelled.cancelled_count,1);
    const after=await rows(140);assert.deepEqual(after[0],before[0]);assert.equal(after[1].stare,'anulata');
    await assert.rejects(()=>cancelOwned(2,140),/Completed bookings cannot be cancelled/);
    await assert.rejects(()=>create(2,141,courtB,['20:00'],dayAfter),/one active booking/);
    for(const person of [2,4])await assert.rejects(()=>as('authenticated',person,"update public.rezervari set stare='anulata' where id=$1",[after[0].id]),/Completed bookings/);
  });
  await check('no retention job or destructive statement was introduced',async()=>{
    assert.doesNotMatch(file('014_booking_groups.sql'),/delete\s+from\s+public\.rezervari\b/i);
    assert.equal((await root('select count(*)::integer count from public.rezervari where booking_group_id=$1',[uid(140)])).rows[0].count,2);
  });
  await check('durable guest rate limits count cancellations, share phone identities and exempt stable retries',async()=>{
    for(let n=0;n<9;n++)await root("insert into spotivity_private.booking_groups(id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status) values($1,'Rate guest','rate@example.test','0788888888',$2,'Other City Football','Fotbal',$3::date,array['12:00'],false,80,true,'anulata')",[uid(200+n),otherCourt,day]);
    const tenth=await guest(210,{court:otherCourt,hours:['13:00'],date:dayAfter,email:'rate@example.test',phone:'0788888888'});
    await service('select public.attach_cancellation_token($1,$2)',[tenth.booking_id,hash('rate-token')]);
    await service('select public.cancel_booking_group_by_token($1,$2)',[tenth.booking_id,hash('rate-token')]);
    await assert.rejects(()=>guest(211,{court:otherCourt,hours:['13:00'],date:dayAfter,email:'rate@example.test',phone:'0777777777'}),/Guest booking rate limit/);
    await assert.rejects(()=>guest(212,{court:otherCourt,hours:['13:00'],date:dayAfter,email:'different-rate@example.test',phone:'0788888888'}),/Guest booking rate limit/);
    await assert.rejects(()=>guest(213,{court:otherCourt,hours:['13:00'],date:dayAfter,email:'international-rate@example.test',phone:'+40 788 888 888'}),/Guest booking rate limit/);
    assert.equal((await guest(210,{court:otherCourt,hours:['13:00'],date:dayAfter,email:'rate@example.test',phone:'0788888888'})).state,'anulata');
    assert.equal((await rows(211)).length,0);assert.equal((await rows(212)).length,0);
  });
  console.log(`\n${passed} booking-group checks passed (${integerIds?'integer':'UUID'} reservation IDs).`);
}finally{await pg.close()}})().catch(error=>{console.error(error);process.exitCode=1});
