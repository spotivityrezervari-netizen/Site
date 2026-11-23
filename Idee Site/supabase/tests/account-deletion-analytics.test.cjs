// Real PostgreSQL, disposable state only. No hosted Auth, bookings or mail.
// 050: clients delete their own account; the superadmin lists/deletes
// accounts and reads analytics (new accounts, cancellations, late
// cancellations, attendance, no-shows; 7 days, 30 days, all time).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const directory=join(__dirname,'..');
const migration=readFileSync(join(directory,'050_account_deletion_and_analytics.sql'),'utf8');

test('account deletion and superadmin analytics (050)',async t=>{
 const pg=new PGlite();
 try{
  await pg.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
  await pg.exec("alter table auth.users add column created_at timestamptz not null default now(),add column last_sign_in_at timestamptz,add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
  await pg.exec("insert into auth.users(id,email,email_confirmed_at,created_at) values('00000000-0000-0000-0000-000000000005','carol@example.test',now(),now()-interval '20 days'),('00000000-0000-0000-0000-000000000006','old@example.test',now(),now()-interval '90 days')");
  for(const file of readdirSync(directory).filter(name=>/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))>=1&&Number(name.slice(0,3))<=49).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
  const root=async(sql,args=[])=>{await pg.exec("reset role;select set_config('request.jwt.claim.sub','',false)");return pg.query(sql,args);};
  const as=async(person,sql,args=[])=>{await root('select 1');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(person)]);await pg.exec('set role authenticated');return pg.query(sql,args);};
  const courts=Object.fromEntries((await root('select nume,id::text id,pret from public.terenuri')).rows.map(row=>[row.nume,row]));
  const today=(await root("select ((statement_timestamp()at time zone'Europe/Bucharest')::date)::text d")).rows[0].d;
  let seq=50000;
  const book=async(court,owner,email,dayOffset,hours)=>{
   const id=uid(seq++),c=courts[court];
   const day=(await root('select ($1::date+$2::integer)::text d',[today,dayOffset])).rows[0].d;
   await root('select spotivity_private.create_booking_group_internal($1,$2,$3::date,$4::text[],false,$5::uuid,$6,$7,$8,$9)',
    [id,c.id,day,hours,owner?uid(owner):null,'Fixture customer',email,owner?null:'+40711111111',c.pret*hours.length]);
   return id;
  };

  await pg.exec(migration);await pg.exec(migration);
  assert.equal((await root('select count(*)::int n from spotivity_private.migrations where version=50')).rows[0].n,1);

  await t.test('only the superadmin can list accounts, delete others or read analytics',async()=>{
   await assert.rejects(()=>as(1,'select public.admin_analytics()'),/Administrators only/);
   for(const person of [1,3]){
    await assert.rejects(()=>as(person,"select public.admin_list_accounts('',10,0)"),/Superadmin only/);
    await assert.rejects(()=>as(person,'select public.admin_delete_account($1,$2)',[uid(2),'bob@example.test']),/Superadmin only/);
   }
   const list=(await as(4,"select public.admin_list_accounts('',100,0) v")).rows[0].v;
   assert.equal(list.total,6);
   const roles=Object.fromEntries(list.items.map(item=>[item.email,item.role]));
   assert.deepEqual([roles['alice@example.test'],roles['admin@example.test'],roles['super@example.test']],['client','admin','superadmin']);
   assert.equal((await as(4,"select public.admin_list_accounts('CAROL',10,0) v")).rows[0].v.total,1);
   for(const role of ['anon','authenticated','service_role'])
    assert.equal((await root("select has_table_privilege($1,'spotivity_private.booking_cancellation_log','select') v",[role])).rows[0].v,false);
  });

  // Alice: a future booking, a booking that already happened, and a chat message.
  const future=await book('Court A',1,'alice@example.test',2,['18:00','19:00']);
  const past=await book('Court A',1,'alice@example.test',3,['13:00']);
  await root("update public.rezervari set data_str=($1::date-5)::text where booking_group_id=$2",[today,past]);
  await root("update public.rezervari set starts_at=(data_str::date+ora::time) at time zone 'Europe/Bucharest' where booking_group_id=$1",[past]);

  await t.test('a client cannot delete an account with future bookings, nor without the confirmation word',async()=>{
   await assert.rejects(()=>as(1,"select public.delete_my_account('da')"),/confirmation/);
   await assert.rejects(()=>as(1,"select public.delete_my_account('STERGE')"),error=>error.code==='55000'&&/active_bookings:2/.test(error.message));
   assert.equal((await root('select count(*)::int n from auth.users where id=$1',[uid(1)])).rows[0].n,1);
  });

  await t.test('administrators cannot delete themselves',async()=>{
   await assert.rejects(()=>as(3,"select public.delete_my_account('STERGE')"),/admin_account/);
   await assert.rejects(()=>as(4,"select public.delete_my_account('STERGE')"),/admin_account/);
  });

  await t.test('cancelling is logged, then the client deletes the account and history stays',async()=>{
   await as(1,"update public.rezervari set stare='anulata' where booking_group_id=$1",[future]);
   assert.equal((await root('select count(*)::int n from spotivity_private.booking_cancellation_log')).rows[0].n,2);
   assert.deepEqual((await as(1,"select public.delete_my_account('STERGE') v")).rows[0].v,{deleted:true});
   assert.equal((await root('select count(*)::int n from auth.users where id=$1',[uid(1)])).rows[0].n,0);
   assert.equal((await root('select count(*)::int n from public.clienti where user_id=$1',[uid(1)])).rows[0].n,0);
   const kept=(await root('select count(*)::int n,count(client_user_id)::int linked from public.rezervari where booking_group_id in ($1,$2)',[future,past])).rows[0];
   assert.deepEqual(kept,{n:3,linked:0},'Bookings stay for statistics, without the account');
  });

  await t.test('the superadmin deletes a client but never itself or another superadmin',async()=>{
   await assert.rejects(()=>as(4,'select public.admin_delete_account($1,$2)',[uid(4),'super@example.test']),/own_account/);
   await assert.rejects(()=>as(4,'select public.admin_delete_account($1,$2)',[uid(2),'wrong@example.test']),/confirmation/);
   await root("insert into auth.users(id,email,email_confirmed_at) values($1,'super2@example.test',now())",[uid(7)]);
   await root("insert into public.users_admin(nume_admin,email,is_super,terenuri,user_id) values('Super 2','super2@example.test',true,'ALL',$1)",[uid(7)]);
   await assert.rejects(()=>as(4,'select public.admin_delete_account($1,$2)',[uid(7),'super2@example.test']),/superadmin_account/);
   const bobFuture=await book('Court B',2,'bob@example.test',1,['20:00']);
   await assert.rejects(()=>as(4,'select public.admin_delete_account($1,$2)',[uid(2),' BOB@example.test ']),/active_bookings:1/);
   await root("update public.rezervari set stare='anulata' where booking_group_id=$1",[bobFuture]);
   assert.equal((await as(4,'select public.admin_delete_account($1,$2) v',[uid(2),' BOB@example.test '])).rows[0].v.deleted,true);
   assert.equal((await root('select count(*)::int n from auth.users where id=$1',[uid(2)])).rows[0].n,0);
   assert.equal((await as(4,'select public.admin_delete_account($1,$2) v',[uid(3),'admin@example.test'])).rows[0].v.deleted,true,'An ordinary administrator can be deleted');
   assert.equal((await root('select count(*)::int n from public.users_admin where user_id=$1',[uid(3)])).rows[0].n,0);
  });

  await t.test('analytics count per court and in total, for 7 days, 30 days and all time',async()=>{
   // A guest booking that happened 3 days ago and was marked as a no-show.
   const noShow=await book('Court B',null,'guest@example.test',4,['14:00']);
   await root("update public.rezervari set data_str=($1::date-3)::text where booking_group_id=$2",[today,noShow]);
   await root("update public.rezervari set starts_at=(data_str::date+ora::time) at time zone 'Europe/Bucharest' where booking_group_id=$1",[noShow]);
   await root("insert into spotivity_private.booking_attendance(booking_id,status,revision,customer_email,court_name,booking_day,starts_at,marked_by,marked_at) select $1,'no_show',1,'guest@example.test','Court B',data_str::date,starts_at,$2,now() from public.rezervari where booking_group_id=$1",[noShow,uid(4)]);
   // An old cancellation from before the log existed falls back to older dates.
   await root("insert into spotivity_private.late_cancellation_events(booking_id,customer_name,customer_email,court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds,total_count,notification_event_key,incident_total_count) values($1,'X','x@example.test','Court A',current_date-40,now()-interval '40 days',now()-interval '40 days',600,1,'fixture-late',1)",[uid(59999)]);
   const data=(await as(4,'select public.admin_analytics() v')).rows[0].v;
   assert.deepEqual(data.users,{d7:2,d30:3,all:4},'super + super2 this week, carol 20 days ago, old 90 days ago; deleted accounts are gone');
   const court=name=>data.courts.find(row=>row.court===name).stats;
   assert.deepEqual(court('Court A').cancelled,{d7:1,d30:1,all:2},'Two cancelled hours of one booking count once; the January fixture cancellation only counts all time');
   assert.deepEqual(court('Court A').present,{d7:1,d30:1,all:1});
   assert.deepEqual(court('Court A').late,{d7:0,d30:0,all:1});
   assert.deepEqual(court('Court B').cancelled,{d7:1,d30:1,all:1});
   assert.deepEqual(court('Court B').no_show,{d7:1,d30:1,all:1});
   assert.deepEqual(court('Court B').present,{d7:0,d30:0,all:0});
   assert.deepEqual(data.totals.cancelled.all,court('Court A').cancelled.all+court('Court B').cancelled.all+court('Hidden Court').cancelled.all
    +data.courts.filter(row=>!['Court A','Court B','Hidden Court'].includes(row.court)).reduce((sum,row)=>sum+row.stats.cancelled.all,0));
   assert.equal(data.totals.no_show.d7,1);
   assert.equal(data.scope,'all');
   assert.ok(data.active_users,'The superadmin sees active accounts');
   assert.deepEqual(court('Court B').bookings,{d7:2,d30:2,all:2},"Bob's cancelled booking and the guest booking");
   assert.deepEqual(court('Court B').active_clients,{d7:2,d30:2,all:2},"Bob (account deleted, email kept on the booking) and the guest");
   assert.equal(data.totals.active_clients.all,3,'Alice (both courts/bookings count once), Bob and the guest');
  });

  await t.test('an ordinary administrator sees only their own courts and no account totals',async()=>{
   await root("insert into auth.users(id,email,email_confirmed_at) values($1,'manager2@example.test',now())",[uid(8)]);
   await root("insert into public.users_admin(nume_admin,email,is_super,terenuri,user_id) values('Manager 2','manager2@example.test',false,'Court B',$1)",[uid(8)]);
   const data=(await as(8,'select public.admin_analytics() v')).rows[0].v;
   assert.equal(data.scope,'own');
   assert.equal(data.users,null);assert.equal(data.active_users,null);
   assert.deepEqual(data.courts.map(row=>row.court),['Court B']);
   assert.deepEqual(data.totals.no_show,{d7:1,d30:1,all:1});
   assert.deepEqual(data.totals.cancelled,{d7:1,d30:1,all:1},'Court A cancellations are not counted');
   assert.deepEqual(data.totals.late,{d7:0,d30:0,all:0});
  });
 }finally{await pg.close();}
});
