// Real PostgreSQL, disposable state only. No hosted Auth/booking writes or mail.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const denied=e=>e.code==='42501';
async function fixture(){
 const pg=new PGlite();let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
 if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
 await pg.exec(schema);
 await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
 for(const file of readdirSync(directory).filter(name=>/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))>=1&&Number(name.slice(0,3))<=36).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
 const root=async(sql,args=[])=>{await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");return pg.query(sql,args);};
 const as=async(person,sql,args=[])=>{await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[person?uid(person):'']);await pg.exec('set role '+(person?'authenticated':'anon'));return pg.query(sql,args);};
 await root("update public.clienti set telefon=case when user_id=$1 then '+40711111111'else '+40722222222'end",[uid(1)]);
 const day=(await root("select ((statement_timestamp()at time zone'Europe/Bucharest')::date+1)::text d")).rows[0].d;
 const courts=(await root('select id::text id,nume,pret from public.terenuri')).rows;
 let seq=37000;
 const create=async({owner=1,email=owner===1?'alice@example.test':'bob@example.test',phone=owner===1?'+40711111111':'+40722222222',court='Court A',offset=0,hour='16:00'}={})=>{
  const id=uid(seq++),t=courts.find(t=>t.nume===court);await root('select 1');
  const d=(await root('select ($1::date+$2::integer)::text d',[day,offset])).rows[0].d;
  const query='select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5::uuid,$6,$7,$8,$9) v';
  return (await root(query,[id,t.id,d,[hour],owner?uid(owner):null,'Fixture customer',email,phone,t.pret])).rows[0].v;
 };
 const incident=async booking=>root(`insert into spotivity_private.booking_attendance(booking_id,status,revision,customer_user_id,customer_email,customer_name,customer_phone,court_name,booking_day,starts_at,marked_by)
  select id,'no_show',1,owner_auth_id,contact_email,contact_name,contact_phone,court_name,booking_day,statement_timestamp()-interval'2 hours',$2 from spotivity_private.booking_groups where id=$1`,[booking.booking_id,uid(3)]);
 const restrict=async(booking,person=3,{days=7,permanent=false,global=false,reason='Repeated incidents'}={})=>(await as(person,'select public.set_customer_booking_restriction($1,$2,$3,$4,$5)v',[booking.booking_id,days,permanent,global,reason])).rows[0].v;
 const list=async(person=3)=>(await as(person,'select public.list_customer_booking_restrictions()v')).rows[0].v;
 const revoke=async(id,person=3)=>(await as(person,'select public.revoke_customer_booking_restriction($1,$2)v',[id,'Reviewed'])).rows[0].v;
 return {pg,root,as,day,courts,create,incident,restrict,list,revoke};
}
test('manual booking restrictions are scoped, audited and enforced without cancelling reservations',async t=>{
 const f=await fixture(),{pg,root,as,create,incident,restrict,list,revoke}=f;
 try{
  const before=(await root('select (select count(*)from public.rezervari)::int bookings,(select count(*)from spotivity_private.notification_outbox)::int jobs')).rows[0];
  await pg.exec(readFileSync(join(directory,'037_client_restrictions.sql'),'utf8'));
  assert.deepEqual((await root('select (select count(*)from public.rezervari)::int bookings,(select count(*)from spotivity_private.notification_outbox)::int jobs')).rows[0],before);
  await pg.exec(readFileSync(join(directory,'037_client_restrictions.sql'),'utf8'));
  // 048 renames the guard's phone variable (it clashed with auth.users.phone).
  await pg.exec(readFileSync(join(directory,'048_fix_booking_restriction_phone.sql'),'utf8'));
  await pg.exec(readFileSync(join(directory,'048_fix_booking_restriction_phone.sql'),'utf8'));
  const alice=[];for(let offset=0;offset<3;offset++){const b=await create({offset});await incident(b);alice.push(b);}
  const bob=await create({owner:2,court:'Court B'});await incident(bob);
  const future=await create({offset:5,hour:'17:00'});
  await t.test('only verified administrators with at least3 visible incidents can act',async()=>{
   for(const person of [null,1,2]){await assert.rejects(()=>restrict(alice[0],person),denied);await assert.rejects(()=>list(person),denied);}
   await assert.rejects(()=>restrict(bob,3),denied);await assert.rejects(()=>restrict(bob,4),e=>e.code==='22023');
   await assert.rejects(()=>restrict(alice[0],3,{global:true}),denied);
   for(const days of [0,-1,366,null])await assert.rejects(()=>restrict(alice[0],3,{days}),e=>e.code==='22023');
   const permissions=(await root("select has_table_privilege('authenticated','spotivity_private.booking_restrictions','select')read,has_table_privilege('service_role','spotivity_private.booking_restrictions','insert')write")).rows[0];assert.equal(permissions.read,false);assert.equal(permissions.write,false);
   for(const role of ['anon','authenticated','service_role']){
    assert.equal((await root("select has_function_privilege($1,'public.set_customer_booking_restriction(uuid,integer,boolean,boolean,text)','execute')v",[role])).rows[0].v,role==='authenticated');
    assert.equal((await root("select has_table_privilege($1,'spotivity_private.booking_restriction_events','select')v",[role])).rows[0].v,false);
   }
  });
  let scoped;
  await t.test('ordinary admin restricts stable currently assigned court IDs only',async()=>{
   scoped=await restrict(alice[0]);assert.equal(scoped.scope,'assigned_courts');assert.equal(scoped.count,1);assert.equal((await list()).restrictions[0].court_id,f.courts.find(t=>t.nume==='Court A').id);
   await assert.rejects(()=>create({offset:3}),e=>denied(e)&&/BOOKING_RESTRICTED/.test(e.message));
   await create({court:'Court B',offset:3});
   await assert.rejects(()=>create({owner:null,email:'alice@example.test',phone:'+40733333333',offset:3,hour:'17:00'}),denied);
   await assert.rejects(()=>create({owner:null,email:'other@example.test',phone:'+40711111111',offset:3,hour:'17:00'}),denied);
   await create({owner:2,court:'Court A',offset:3,hour:'18:00'});
   // Exercise this guard independently of the other immutability triggers:
   // maintaining an existing row is allowed, moving it to a new slot is not.
   await root('create temporary table restriction_update_probe(like public.rezervari including defaults)');
   await root('insert into restriction_update_probe select * from public.rezervari where booking_group_id=$1',[future.booking_id]);
   await root('create trigger test_restriction_guard before update on restriction_update_probe for each row execute function spotivity_private.enforce_booking_restriction()');
   await root('update restriction_update_probe set pret_total=pret_total');
   await assert.rejects(()=>root("update restriction_update_probe set starts_at=starts_at+interval'1 day'"),e=>denied(e)&&/BOOKING_RESTRICTED/.test(e.message));
   await assert.rejects(()=>root("update restriction_update_probe set ora='18:00'"),e=>denied(e)&&/BOOKING_RESTRICTED/.test(e.message));
   await root('drop table restriction_update_probe');
   const d=(await root('select ($1::date+3)::text d',[f.day])).rows[0].d;
   await assert.rejects(()=>as(3,"insert into public.rezervari(sport,teren,data_str,ora,pret_total,email_client,stare)values('Fotbal','Court A',$1,'19:00','100 Lei','alice@example.test','activa')",[d]),denied);
   await as(3,"insert into public.rezervari(sport,teren,data_str,ora,pret_total,email_client,stare)values('Fotbal','Court A',$1,'20:00','0 Lei','Teren Blocat','activa')",[d]);
   const cancelled=(await as(1,'select public.cancel_owned_booking_group($1)v',[future.booking_id])).rows[0].v;assert.equal(cancelled.state,'anulata','Existing bookings remain cancellable');
  });
  await t.test('expiry, explicit lift and renewed decisions retain audit and do not retro-send mail',async()=>{
   await root("update spotivity_private.booking_restrictions set expires_at=statement_timestamp()-interval'1 second'where id=$1",[scoped.restriction_ids[0]]);assert.equal((await list()).restrictions.length,0);
   await create({offset:3});
   await restrict(alice[0]);assert.equal((await revoke(scoped.restriction_ids[0])).changed,true);assert.equal((await revoke(scoped.restriction_ids[0])).changed,false);
   await create({offset:4});
   const events=(await root('select action from spotivity_private.booking_restriction_events order by created_at,id')).rows;assert.equal(events.filter(e=>e.action==='restrict').length,2);assert.equal(events.filter(e=>e.action==='revoke').length,1);
  });
  let global;
  await t.test('only superadmin can apply or lift permanent platform-wide restrictions',async()=>{
   global=await restrict(alice[0],4,{permanent:true,days:null,global:true});assert.equal(global.permanent,true);assert.equal(global.expires_at,null);assert.equal((await list(4)).restrictions.some(r=>r.global),true);
   assert.equal((await list(3)).restrictions.some(r=>r.global),false);await assert.rejects(()=>revoke(global.restriction_ids[0],3),denied);
   await assert.rejects(()=>create({court:'Court B',offset:5}),denied);
   const futureCourt=(await root("insert into public.terenuri(nume,sport,pret,este_activ)values('Future court','Baschet',100,true)returning id::text id,nume,pret")).rows[0];f.courts.push(futureCourt);
   await assert.rejects(()=>create({court:'Future court',offset:5}),e=>denied(e)&&/BOOKING_RESTRICTED/.test(e.message),'Global restrictions cover courts created after the decision');
   await revoke(global.restriction_ids[0],4);
   await create({court:'Court B',offset:4});
  });
  await t.test('email changes and reassignment never transfer an account restriction',async()=>{
   await restrict(alice[0],4,{global:true});await root("update auth.users set email='alice-new@example.test'where id=$1",[uid(1)]);
   await root("insert into auth.users(id,email,email_confirmed_at)values($1,'alice@example.test',statement_timestamp())",[uid(6)]);
   await root("update public.clienti set telefon='+40766666666'where user_id=$1",[uid(6)]);
   await assert.rejects(()=>create({owner:1,email:'alice-new@example.test',court:'Court B',offset:5}),denied);
   await assert.rejects(()=>create({owner:null,email:'alice-new@example.test',phone:'+40733333333',court:'Court B',offset:5}),denied);
   await create({owner:6,email:'alice@example.test',phone:'+40766666666',offset:5,hour:'16:00'});
   await create({owner:null,email:'alice@example.test',phone:'+40788888888',court:'Court B',offset:5,hour:'18:00'});
   await revoke(global.restriction_ids[0],4);
  });
  await t.test('guest restrictions cannot punish a verified account sharing an unverified guest address',async()=>{
   const guest=[];for(let offset=0;offset<3;offset++){const b=await create({owner:null,email:'alice-new@example.test',phone:'+40799999999',offset,hour:'18:00'});await incident(b);guest.push(b);}
   const r=await restrict(guest[0],3,{permanent:true});
   await assert.rejects(()=>create({owner:null,email:'alice-new@example.test',phone:'+40700000000',offset:3,hour:'21:00'}),denied);
   await create({owner:1,email:'alice-new@example.test',phone:'+40711111111',court:'Court B',offset:5,hour:'16:00'});
   await revoke(r.restriction_ids[0]);
  });
  await t.test('loss of court allocation immediately removes read and revoke access',async()=>{
   const r=await restrict(alice[0]);await root("update public.users_admin set terenuri='Court B'where user_id=$1",[uid(3)]);
   assert.equal((await list()).restrictions.length,0);await assert.rejects(()=>revoke(r.restriction_ids[0]),denied);await assert.rejects(()=>restrict(alice[0]),denied);
   await root("update public.users_admin set terenuri='Court A'where user_id=$1",[uid(3)]);assert.ok((await list()).restrictions.length);await revoke(r.restriction_ids[0]);
  });
  await t.test('global review remains possible for historical incidents after all courts are retired',async()=>{
   await root('delete from public.terenuri');const r=await restrict(alice[0],4,{global:true});assert.equal(r.count,1);assert.equal((await list(4)).restrictions[0].global,true);await revoke(r.restriction_ids[0],4);
  });
 }finally{await pg.close();}
});
