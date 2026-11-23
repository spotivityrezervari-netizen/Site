// Real PostgreSQL, disposable state only. 051: analytics for any period and
// any court; each administrator only for their own courts.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const migration=readFileSync(join(directory,'051_analytics_range.sql'),'utf8');

test('analytics for a chosen period and court (051)',async t=>{
 const pg=new PGlite();
 try{
  await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
  await pg.exec("alter table auth.users add column created_at timestamptz not null default now(),add column last_sign_in_at timestamptz,add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
  await pg.exec("insert into auth.users(id,email,email_confirmed_at,created_at) values('00000000-0000-0000-0000-000000000006','old@example.test',now(),now()-interval '90 days')");
  for(const file of readdirSync(directory).filter(name=>/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))>=1&&Number(name.slice(0,3))<=50).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
  const root=async(sql,args=[])=>{await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false)");return pg.query(sql,args);};
  const as=async(person,sql,args=[])=>{await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(person)]);await pg.exec('set role authenticated');return pg.query(sql,args);};
  const courts=Object.fromEntries((await root('select nume,id::text id,pret from public.terenuri')).rows.map(row=>[row.nume,row]));
  const today=(await root("select ((statement_timestamp()at time zone'Europe/Bucharest')::date)::text d")).rows[0].d;
  const day=async n=>(await root('select ($1::date+$2::integer)::text d',[today,n])).rows[0].d;
  let seq=60000;
  const book=async(court,owner,email,dayOffset,hours)=>{
   const id=uid(seq++),c=courts[court];
   await root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5::uuid,$6,$7,$8,$9)',
    [id,c.id,await day(dayOffset),hours,owner?uid(owner):null,'Fixture customer',email,owner?null:'+40711111111',c.pret*hours.length]);
   return id;
  };
  await pg.exec(migration);await pg.exec(migration);
  assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=51')).rows[0].n,1);

  // Court A: one booking made today, one made 10 days ago. Court B: one today.
  await book('Court A',1,'alice@example.test',2,['18:00']);
  const older=await book('Court A',2,'bob@example.test',3,['13:00']);
  await root("update spotivity_private.booking_groups set created_at=now()-interval '10 days' where id=$1",[older]);
  await book('Court B',null,'guest@example.test',1,['20:00']);
  const range=(person,from,to,court=null)=>as(person,'select public.admin_analytics_range($1::date,$2::date,$3) v',[from,to,court]).then(r=>r.rows[0].v);

  await t.test('only administrators, and only for their own courts',async()=>{
   await assert.rejects(()=>range(1,today,today),/Administrators only/);
   await assert.rejects(()=>range(3,today,today,'Court B'),/Court not allowed/);
   const yesterday=await day(-1);
   await assert.rejects(()=>range(3,today,yesterday),/invalid_range/);
   for(const role of ['anon','authenticated'])
    assert.equal((await root("select has_function_privilege($1,'spotivity_private.analytics_events(timestamptz)','execute') v",[role])).rows[0].v,false);
  });

  await t.test('a day, a week with the week before, and the day series',async()=>{
   const one=await range(3,today,today);
   assert.equal(one.totals.bookings.n,1,'Only the booking made today on Court A');
   assert.equal(one.totals.bookings.p,0,'Yesterday');
   assert.deepEqual(one.court_options.map(c=>c.court),['Court A'],'The administrator picks only their court');
   const week=await range(3,await day(-6),today);
   assert.equal(week.totals.bookings.n,1);
   assert.equal(week.totals.bookings.p,1,'The booking 10 days ago is in the week before');
   assert.deepEqual(week.previous,{from:await day(-13),to:await day(-7)});
   assert.equal(week.bucket,'day');
   assert.equal(week.buckets.length,7);
   assert.deepEqual(week.totals.bookings.series,[0,0,0,0,0,0,1]);
   assert.equal(week.users,null,'Accounts are for the superadmin only');
   assert.equal((await range(3,await day(-29),today)).totals.bookings.n,2);
  });

  await t.test('the superadmin sees all courts or one, and the accounts',async()=>{
   const all=await range(4,today,today);
   assert.equal(all.totals.bookings.n,2);
   assert.ok(all.court_options.length>=3);
   const b=await range(4,today,today,'Court B');
   assert.equal(b.totals.bookings.n,1);
   assert.deepEqual(b.courts.map(c=>c.court),['Court B']);
   assert.equal(b.court,'Court B');
   assert.ok(all.users.n>=4,'Accounts created today');
   assert.equal(typeof all.active_users.n,'number');
  });

  await t.test('"Total" starts at the first activity and groups long ranges by month',async()=>{
   const mine=await range(3,null,null);
   assert.equal(mine.from,'2026-01-01','The legacy fixture booking on Court A (schema.sql) is the first activity');
   assert.equal(mine.previous,null);
   assert.equal(mine.totals.bookings.n,3);
   assert.equal(mine.bucket,'month');
   const everything=await range(4,null,null);
   assert.equal(everything.from,'2026-01-01');
   assert.equal(everything.bucket,'month');
   assert.equal(everything.totals.bookings.series.reduce((a,b)=>a+b,0),4);
   assert.equal(everything.buckets[0],'2026-01-01');
   assert.equal(everything.users.series.reduce((a,b)=>a+b,0),everything.users.n);
  });
 }finally{await pg.close();}
});
