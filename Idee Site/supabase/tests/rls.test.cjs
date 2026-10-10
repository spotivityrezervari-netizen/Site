// Uses real PostgreSQL (PGlite) in memory. Install PGlite outside the repository.
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname,'schema.sql'),'utf8');
    if (process.env.SPOTIVITY_TEST_INTEGER_IDS === '1') schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
    await pg.exec(schema);
    await pg.exec(readFileSync(join(__dirname,'../000_preflight.sql'),'utf8'));
    const migration = readFileSync(join(__dirname,'../001_security.sql'),'utf8');
    await pg.exec(migration);
    await pg.exec(migration); // Repeatability and old-policy removal matter.
    const as = async (role, person, sql, params = []) => {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); set role ${role};`);
      return pg.query(sql, params);
    };
    const root = sql => as('postgres', null, sql);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS',name); };
    const denied = async fn => { await assert.rejects(fn); };
    const tomorrow = (await root("select ((now() at time zone 'Europe/Bucharest')::date + 1)::text as booking_date")).rows[0].booking_date;
    const booking = (person, court, hour, extras='') => as('authenticated', person,
      `insert into public.rezervari(email_client,teren,data_str,ora,pret_total,stare${extras ? ',cu_minge' : ''})
       values ('${person===1 ? 'alice' : 'bob'}@example.test','${court}','${tomorrow}','${hour}','0 RON','activa'${extras}) returning *`);
    await check('legacy dates and owner IDs are migrated', async () => {
      const r = (await root('select data_str,client_user_id from public.rezervari')).rows[0];
      assert.equal(r.data_str,'2026-01-05'); assert.equal(r.client_user_id,uid(1));
    });
    await check('anonymous sees only active courts', async () => {
      assert.equal((await as('anon',null,'select * from public.terenuri')).rows.length,2);
    });
    for (const table of ['clienti','users_admin','rezervari','mesaje_chat']) {
      await check(`anonymous cannot read ${table}`, () => denied(() => as('anon',null,`select * from public.${table}`)));
    }
    await check('own profile only', async () => {
      assert.deepEqual((await as('authenticated',1,'select email from public.clienti')).rows.map(x=>x.email),['alice@example.test']);
    });
    await check('client cannot self-promote or insert roles', () => denied(() => as('authenticated',1,
      "insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Hacker','alice@example.test',true,'ALL')")));
    await check('admin cannot self-promote or read other roles', async () => {
      const result = await as('authenticated',3,"update public.users_admin set is_super=true where email='admin@example.test' returning *");
      assert.equal(result.rows.length,0);
      assert.equal((await as('authenticated',3,'select * from public.users_admin')).rows.length,1);
    });
    await check('client cannot alter profile identity', () => denied(() => as('authenticated',1,
      "update public.clienti set user_id='00000000-0000-0000-0000-000000000002' where user_id=auth.uid()")));
    await check('client may change own name and phone', async () => {
      assert.equal((await as('authenticated',1,"update public.clienti set nume='Alice Updated',telefon='333' returning nume")).rows[0].nume,'Alice Updated');
    });
    await check('server controls booking price and identity', async () => {
      const r=(await booking(1,'Court A','12:00',',true')).rows[0];
      assert.equal(r.pret_total,'115 RON (+Minge)'); assert.equal(r.client_user_id,uid(1));
    });
    await check('cross-client booking spoof denied', () => denied(() => as('authenticated',1,
      `insert into public.rezervari(email_client,teren,data_str,ora,stare) values('bob@example.test','Court A','${tomorrow}','13:00','activa')`)));
    await check('inactive court denied', () => denied(() => booking(1,'Hidden Court','13:00')));
    await check('duplicate active slot denied atomically', () => denied(() => booking(2,'Court A','12:00')));
    await check('ball rental disabled on court', () => denied(() => booking(2,'Court B','12:00',',true')));
    await check('public availability exposes no personal columns', async () => {
      const rows=(await as('anon',null,'select * from public.rezervari_disponibilitate')).rows;
      assert.equal(rows.length,1); assert.deepEqual(Object.keys(rows[0]).sort(),['data_str','id','ora','teren']);
    });
    await check('clients cannot alter public availability', () => denied(() => as('authenticated',1,
      "delete from public.rezervari_disponibilitate")));
    await check('clients cannot read each other bookings', async () => {
      assert.equal((await as('authenticated',2,'select * from public.rezervari')).rows.length,0);
    });
    await booking(2,'Court B','14:00');
    await check('admin sees only assigned court bookings and customers', async () => {
      const rows=(await as('authenticated',3,'select teren from public.rezervari')).rows;
      assert.ok(rows.every(x=>x.teren==='Court A'));
      assert.deepEqual((await as('authenticated',3,'select email from public.clienti')).rows.map(x=>x.email),['alice@example.test']);
    });
    await check('admin updates assigned court settings', async () => {
      assert.equal((await as('authenticated',3,"update public.terenuri set pret=120 where nume='Court A' returning pret")).rows.length,1);
      assert.equal((await as('authenticated',3,"update public.terenuri set pret=1 where nume='Court B' returning pret")).rows.length,0);
    });
    await check('ordinary admin cannot create or delete courts', async () => {
      await denied(() => as('authenticated',3,"insert into public.terenuri(nume,sport,pret) values('Unauthorized','Fotbal',1)"));
      assert.equal((await as('authenticated',3,"delete from public.terenuri where nume='Court A' returning *")).rows.length,0);
    });
    await check('client cannot change cost or reactivate booking', async () => {
      await denied(() => as('authenticated',1,"update public.rezervari set pret_total='1 RON' where stare='activa'"));
      await as('authenticated',1,"update public.rezervari set stare='anulata' where stare='activa'");
      await denied(() => as('authenticated',1,"update public.rezervari set stare='activa' where data_str='"+tomorrow+"'"));
      assert.equal((await as('anon',null,"select * from public.rezervari_disponibilitate where teren='Court A'")).rows.length,0);
    });
    await check('cancellation frees slot for a new booking', async () => { await booking(1,'Court A','12:00'); });
    await check('past and far-future client booking denied', async () => {
      for (const day of ['2000-01-01','2100-01-01']) await denied(() => as('authenticated',1,
        `insert into public.rezervari(email_client,teren,data_str,ora,stare) values('alice@example.test','Court A','${day}','15:00','activa')`));
    });
    for (const [label, offset, hour] of [
      ['just before the start', "interval '1 minute'", '16:00'],
      ['during the booked hour', "-interval '30 minutes'", '17:00'],
      ['after the booking has ended', "-interval '2 hours'", '18:00']
    ]) await check(`client can cancel ${label}, without changing booking details`, async () => {
      await root('select 1');
      await pg.exec(`insert into public.rezervari(email_client,client_user_id,teren,data_str,ora,stare) values
        ('alice@example.test','${uid(1)}','Court A','${tomorrow}','${hour}','activa');
        alter table public.rezervari disable trigger spotivity_booking_guard;
        update public.rezervari set starts_at=now()+${offset} where ora='${hour}';
        alter table public.rezervari enable trigger spotivity_booking_guard;`);
      const before=(await root(`select * from public.rezervari where ora='${hour}'`)).rows[0];
      const changed=(await as('authenticated',1,
        `update public.rezervari set stare='anulata' where ora='${hour}' returning *`)).rows;
      assert.equal(changed.length,1);
      assert.deepEqual(changed[0],{...before,stare:'anulata'});
      assert.equal((await as('anon',null,
        `select * from public.rezervari_disponibilitate where ora='${hour}'`)).rows.length,0);
    });
    await check('unlimited cancellation still cannot cancel another client booking', async () => {
      const rows=(await as('authenticated',1,
        "update public.rezervari set stare='anulata' where email_client='bob@example.test' returning *")).rows;
      assert.equal(rows.length,0);
      assert.equal((await as('authenticated',2,
        "select stare from public.rezervari where teren='Court B' and ora='14:00'")).rows[0].stare,'activa');
    });
    await check('client sends only own chat with a booking', async () => {
      await as('authenticated',1,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('alice@example.test','Court A','client','Hello')");
      await denied(() => as('authenticated',2,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('bob@example.test','Court A','client','No booking')"));
      await denied(() => as('authenticated',1,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('alice@example.test','Court A','admin','Spoof')"));
    });
    await check('chat enabled enforced server-side', async () => {
      await as('authenticated',3,"update public.terenuri set are_chat=false where nume='Court A'");
      await denied(() => as('authenticated',1,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('alice@example.test','Court A','client','Disabled')"));
      await as('authenticated',3,"update public.terenuri set are_chat=true where nume='Court A'");
    });
    await check('chat recipient may mark read but cannot rewrite messages', async () => {
      await as('authenticated',3,"update public.mesaje_chat set citit=true where expeditor='client'");
      await denied(() => as('authenticated',3,"update public.mesaje_chat set mesaj='Rewritten'"));
      await as('authenticated',3,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('alice@example.test','Court A','admin','Reply')");
      await as('authenticated',1,"update public.mesaje_chat set citit=true where expeditor='admin'");
      assert.equal((await as('authenticated',2,'select * from public.mesaje_chat')).rows.length,0);
    });
    await check('unassigned admin cannot send or delete another court chat', async () => {
      await denied(() => as('authenticated',3,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('bob@example.test','Court B','admin','Unauthorized')"));
      assert.equal((await as('authenticated',2,'delete from public.mesaje_chat returning *')).rows.length,0);
    });
    await check('storage restrictive guards defeat old allow-all policies', async () => {
      await denied(() => as('anon',null,"insert into storage.objects(bucket_id,name) values('poze_terenuri','evil.png')"));
      await denied(() => as('authenticated',1,`insert into storage.objects(bucket_id,name) values('poze_terenuri','${uid(1)}/evil.png')`));
      await as('authenticated',3,`insert into storage.objects(bucket_id,name) values('poze_terenuri','${uid(3)}/court.png')`);
      await denied(() => as('authenticated',3,`insert into storage.objects(bucket_id,name) values('poze_terenuri','${uid(4)}/evil.png')`));
      assert.equal((await as('authenticated',1,"delete from storage.objects returning *")).rows.length,0);
      await as('authenticated',3,`delete from storage.objects where name='${uid(3)}/court.png'`);
    });
    await check('superadmin manages all application tables and roles', async () => {
      assert.equal((await as('authenticated',4,'select * from public.clienti')).rows.length,2);
      await as('authenticated',4,"insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Bob Admin','bob@example.test',false,'Court B')");
      assert.equal((await as('authenticated',2,'select * from public.users_admin')).rows[0].user_id,uid(2));
      await as('authenticated',4,"update public.users_admin set is_super=true where email='bob@example.test'");
      await as('authenticated',4,"delete from public.users_admin where email='bob@example.test'");
      await as('authenticated',4,"insert into public.terenuri(nume,sport,pret) values('New Court','Tenis',50)");
      await as('authenticated',4,"delete from public.terenuri where nume='New Court'");
    });
    await check('roles require existing confirmed Auth accounts', () => denied(() => as('authenticated',4,
      "insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Missing','missing@example.test',true,'ALL')")));
    await check('changing a booking key keeps the public projection consistent', async () => {
      const before=(await root("select id::text from public.rezervari where teren='Court A' and ora='12:00' and stare='activa'")).rows[0].id;
      const expression=process.env.SPOTIVITY_TEST_INTEGER_IDS==='1' ? 'default' : 'gen_random_uuid()';
      const after=(await as('authenticated',4,`update public.rezervari set id=${expression} where id::text=$1 returning id::text`,[before])).rows[0].id;
      assert.equal((await as('anon',null,'select * from public.rezervari_disponibilitate where id=$1',[before])).rows.length,0);
      assert.equal((await as('anon',null,'select * from public.rezervari_disponibilitate where id=$1',[after])).rows.length,1);
    });
    await check('unconfirmed signup creates private profile, never an admin', async () => {
      await root(`insert into auth.users(id,email,raw_user_meta_data) values('${uid(5)}','new@example.test','{"nume":"New","telefon":"444","is_super":true}')`);
      const row=(await root(`select * from public.clienti where user_id='${uid(5)}'`)).rows[0];
      assert.equal(row.nume,'New'); assert.equal(row.telefon,'444');
      assert.equal((await root(`select * from public.users_admin where user_id='${uid(5)}'`)).rows.length,0);
      await denied(() => as('authenticated',5,`insert into public.rezervari(email_client,teren,data_str,ora,stare) values('new@example.test','Court A','${tomorrow}','19:00','activa')`));
    });
    await check('Auth email change preserves ownership and synchronizes contact fields', async () => {
      await root("update auth.users set email='alice-new@example.test' where email='alice@example.test'");
      assert.ok((await as('authenticated',1,'select email_client from public.rezervari')).rows.every(x=>x.email_client==='alice-new@example.test'));
      assert.equal((await as('authenticated',1,'select email from public.clienti')).rows[0].email,'alice-new@example.test');
      assert.equal((await as('authenticated',2,'select * from public.rezervari')).rows.length,1);
    });
    await check('superadmin rename preserves bookings, chats, and assigned scopes', async () => {
      await as('authenticated',4,"update public.terenuri set nume='Court Renamed' where nume='Court A'");
      assert.ok((await as('authenticated',3,'select teren from public.rezervari')).rows.every(x=>x.teren==='Court Renamed'));
      assert.equal((await as('authenticated',3,'select terenuri from public.users_admin')).rows[0].terenuri,'Court Renamed');
      assert.ok((await as('authenticated',1,'select teren from public.mesaje_chat')).rows.every(x=>x.teren==='Court Renamed'));
      await denied(() => as('authenticated',3,"update public.terenuri set nume='Hacked' where nume='Court Renamed'"));
    });
    await check('Auth email change cannot remove an ordinary admin role', async () => {
      await root("update auth.users set email='admin-new@example.test' where email='admin@example.test'");
      assert.equal((await as('authenticated',3,'select email from public.users_admin')).rows[0].email,'admin-new@example.test');
    });
    await check('revoking admin permissions takes effect without refreshing JWT', async () => {
      await as('authenticated',4,"delete from public.users_admin where email='admin-new@example.test'");
      assert.equal((await as('authenticated',3,'select * from public.rezervari')).rows.length,0);
      await denied(() => as('authenticated',3,`insert into storage.objects(bucket_id,name) values('poze_terenuri','${uid(3)}/denied.png')`));
    });
    await check('private trigger functions cannot be called by clients', () => denied(() => as('authenticated',1,
      "select spotivity_private.booking_instant('2026-01-01','12:00')")));
    await check('reused email and migration rerun never transfer deleted-user bookings', async () => {
      await root(`delete from auth.users where id='${uid(1)}'`);
      await root(`insert into auth.users(id,email,email_confirmed_at) values('${uid(6)}','alice-new@example.test',now())`);
      await root('select 1');
      await pg.exec(migration);
      assert.equal((await as('authenticated',6,'select * from public.rezervari')).rows.length,0);
      assert.equal((await as('authenticated',6,'select * from public.mesaje_chat')).rows.length,0);
    });
    for (const [label, setup] of [
      ['duplicate profile emails', "insert into public.clienti(nume,email) values('Duplicate','ALICE@example.test')"],
      ['unbound privileged roles', "insert into public.users_admin(nume_admin,email,is_super,terenuri) values('Unknown','missing@example.test',true,'ALL')"],
      ['duplicate active bookings', "insert into public.rezervari(teren,data_str,ora,stare) values('Court A','2026-01-01','12:00','activa'),('Court A','2026-01-01','12:00','activa')"],
      ['ambiguous legacy year', "update public.rezervari set data_str='Mar, 05.01'"],
      ['public definer RPCs', "create function public.unsafe_rpc() returns text language sql security definer as $$ select 'unsafe' $$"],
      ['owner-run public views', "create view public.unsafe_view as select * from public.clienti; grant select on public.unsafe_view to anon"],
    ]) {
      await check(`unsafe legacy migration aborts atomically: ${label}`, async () => {
        const isolated = new PGlite();
        try {
          await isolated.exec(schema); await isolated.exec(setup);
          await denied(()=>isolated.exec(migration));
          await isolated.exec('rollback');
          assert.equal((await isolated.query("select column_name from information_schema.columns where table_schema='public' and table_name='clienti' and column_name='user_id'")).rows.length,0);
        } finally {await isolated.close();}
      });
    }
    console.log(`\n${passed} PostgreSQL security checks passed; no live project was modified.`);
  } finally { await pg.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
