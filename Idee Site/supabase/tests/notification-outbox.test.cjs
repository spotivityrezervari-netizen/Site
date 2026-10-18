// Disposable PostgreSQL fixture only. This suite has no hosted credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sql = name => readFileSync(join(__dirname, '..', name), 'utf8');
const MAKE = 'https://hook.eu2.make.com/abcdefghijk123456789';

test('notification outbox permissions, transactional events and retry leases', async t => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (process.env.SPOTIVITY_TEST_UUID_IDS === '1') schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    await pg.exec(schema);
    const as = async (role, person, query, params = []) => {
      const claims = JSON.stringify({ role, sub: person ? uid(person) : null });
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); select set_config('request.jwt.claims','${claims}',false); select set_config('request.jwt.claim.role','${role}',false); set role ${role}`);
      return pg.query(query, params);
    };
    const root = (query, params = []) => as('postgres', null, query, params);
    const service = (query, params = []) => as('service_role', null, query, params);
    for (const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql','011_club_requests.sql','012_club_approval.sql','013_admin_integration.sql','014_booking_groups.sql']) await pg.exec(sql(name));
    const court = (await root("select id::text id from public.terenuri where nume='Court A'")).rows[0].id;
    const day = (await root("select ((statement_timestamp() at time zone 'Europe/Bucharest')::date+2)::text booking_day")).rows[0].booking_day;
    let nextID = 1000;
    const create = async (hours = ['12:00','13:00','14:00']) => {
      const id = uid(nextID++);
      await service('select public.create_guest_booking_group($1,$2,$3,$4::text[],false,$5,$6,$7)', [id,court,day,hours,'Guest Client',`guest${nextID}@example.test`,`+40 72${String(nextID).padStart(7,'0')}`]);
      return id;
    };
    const clear = () => root('delete from spotivity_private.notification_outbox');
    const jobs = () => root('select * from spotivity_private.notification_outbox order by kind,id').then(result => result.rows);
    const claim = (booking = null, kinds = null) => service('select * from public.claim_booking_notifications(20,120,$1,$2::text[])', [booking,kinds]).then(result => result.rows.map(row => row.claim_booking_notifications));
    const finish = (job, outcome = 'submitted', error = null) => service('select public.finish_booking_notification($1,$2,$3,$4,60) ok', [job.notification_id,job.lease_token,outcome,error]).then(result => result.rows[0].ok);

    await t.test('migration preserves existing business rows and does not backfill old bookings', async () => {
      const before = (await root("select jsonb_build_object('courts',(select jsonb_agg(t order by t.id::text) from public.terenuri t),'bookings',(select jsonb_agg(r order by r.id::text) from public.rezervari r),'admins',(select jsonb_agg(a order by a.id::text) from public.users_admin a),'profiles',(select jsonb_agg(c order by c.id::text) from public.clienti c)) snapshot")).rows[0].snapshot;
      await pg.exec(sql('016_notification_outbox.sql'));
      const after = (await root("select jsonb_build_object('courts',(select jsonb_agg(t order by t.id::text) from public.terenuri t),'bookings',(select jsonb_agg(r order by r.id::text) from public.rezervari r),'admins',(select jsonb_agg(a order by a.id::text) from public.users_admin a),'profiles',(select jsonb_agg(c order by c.id::text) from public.clienti c)) snapshot")).rows[0].snapshot;
      assert.deepEqual(after,before); assert.equal((await jobs()).length,0);
      assert.deepEqual((await service('select public.booking_notification_status() state')).rows[0].state,{ready:false});
    });
    await t.test('anonymous and authenticated users cannot read jobs/configuration or execute dispatch RPCs', async () => {
      for (const role of ['anon','authenticated']) {
        for (const query of ['select * from spotivity_private.notification_outbox','select * from spotivity_private.notification_config','select public.get_booking_notification_config()','select public.booking_notification_status()','select * from public.claim_booking_notifications()','select public.configure_booking_notifications(null,null,false)']) {
          await assert.rejects(() => as(role,role==='authenticated'?4:null,query), /permission denied/);
        }
      }
      for (const name of ['notification_outbox','notification_config']) {
        const state = (await root('select relrowsecurity from pg_class where oid=$1::regclass',[`spotivity_private.${name}`])).rows[0];
        assert.equal(state.relrowsecurity,true);
      }
      await assert.rejects(() => service('select * from spotivity_private.notification_outbox'),/permission denied/);
    });
    await t.test('service configuration stays private, validates Make URLs and gates guest booking availability', async () => {
      for (const bad of ['http://hook.eu2.make.com/abcdefghijk123456789','https://evil.example/abcdefghijk123456789','https://hook.eu2.make.com/abc?token=secret']) await assert.rejects(() => service('select public.configure_booking_notifications($1,null,true)',[bad]),/valid HTTPS Make/);
      assert.deepEqual((await service('select public.configure_booking_notifications($1,$1,true) state',[MAKE])).rows[0].state,{ready:true});
      assert.equal((await service('select public.get_booking_notification_config() config')).rows[0].config.booking_webhook_url,MAKE);
      await service('select public.configure_booking_notifications($1,$1,false)',[MAKE]);
    });
    await t.test('one atomic three-hour booking creates one job per client/allocated owner, with no token or per-hour duplicates', async () => {
      const id = await create(); const outbox = await jobs();
      assert.equal(outbox.length,2); assert.deepEqual(outbox.map(job=>job.kind).sort(),['booking_created_client','booking_created_owner']);
      assert.ok(outbox.every(job=>job.booking_id===id));
      assert.equal(outbox.find(job=>job.kind.endsWith('_owner')).recipient_user_id,uid(3));
      assert.ok(!JSON.stringify(outbox).includes('guest1001@example.test'));
      assert.ok(!JSON.stringify(outbox).includes('token_hash'));
      await service('select public.create_guest_booking_group($1,$2,$3,$4::text[],false,$5,$6,$7)',[id,court,day,['12:00','13:00','14:00'],'Guest Client','guest1001@example.test','+40 720001001']);
      assert.equal((await jobs()).length,2);
      await clear();
    });
    await t.test('outbox event creation rolls back with its booking transaction', async () => {
      await root('begin');
      await pg.query('select spotivity_private.create_booking_group_internal($1,$2,$3,$4::text[],false,null,$5,$6,$7)',[uid(9000),court,day,['15:00'],'Rollback','rollback@example.test','+40 721 123 457']);
      assert.equal((await pg.query('select count(*)::int n from spotivity_private.notification_outbox')).rows[0].n,2);
      await pg.exec('rollback');
      assert.equal((await jobs()).length,0);
      assert.equal((await root('select count(*)::int n from spotivity_private.booking_groups where id=$1',[uid(9000)])).rows[0].n,0);
    });
    await t.test('leases isolate concurrent claims, refresh real recipient details and require the matching lease to finish', async () => {
      const id = await create(['16:00','17:00']);
      const first = await claim(id); assert.equal(first.length,2);
      assert.equal((await claim(id)).length,0);
      const client = first.find(job=>job.kind==='booking_created_client');
      const owner = first.find(job=>job.kind==='booking_created_owner');
      assert.equal(client.recipient.email,'guest1002@example.test');
      assert.equal(owner.recipient.email,'admin@example.test');
      assert.deepEqual(client.booking.hours,['16:00','17:00']);
      assert.equal(client.booking.customerPhone,'+40 720001002');
      assert.equal(await finish({...client,lease_token:uid(999999)}),false);
      assert.equal(await finish(client),true); assert.equal(await finish(client),false);
      assert.equal(await finish(owner,'retry','delivery_uncertain'),true);
      await root("update spotivity_private.notification_outbox set available_at=now()-interval '1 second' where id=$1",[owner.notification_id]);
      const retry=(await claim(id))[0];
      assert.equal(retry.notification_id,owner.notification_id); assert.notEqual(retry.lease_token,owner.lease_token); assert.equal(retry.attempt,2);
      assert.equal(await finish(owner),false); assert.equal(await finish(retry),true);
      assert.ok((await jobs()).every(job=>job.status==='submitted'));
      await clear();
    });
    await t.test('expired worker leases recover with stable job IDs and a fresh lease', async () => {
      const id=await create(['18:00']); const first=await claim(id);
      await root("update spotivity_private.notification_outbox set leased_until=now()-interval '1 second' where booking_id=$1",[id]);
      const second=await claim(id); assert.deepEqual(second.map(job=>job.notification_id).sort(),first.map(job=>job.notification_id).sort());
      assert.ok(second.every(job=>job.attempt===2));
      assert.ok(second.every(job=>job.lease_token!==first.find(old=>old.notification_id===job.notification_id).lease_token));
      await clear();
    });
    await t.test('revoked allocation cannot receive private booking/contact data, and the superadmin is only an unallocated-court fallback', async () => {
      const id=await create(['19:00']);
      await root("update public.users_admin set terenuri='Court B' where user_id=$1",[uid(3)]);
      const claimed=await claim(id); assert.equal(claimed.length,1); assert.equal(claimed[0].kind,'booking_created_client');
      assert.equal((await jobs()).find(job=>job.kind==='booking_created_owner').status,'skipped');
      await clear();
      const fallback=await create(['20:00']);
      assert.equal((await jobs()).find(job=>job.kind==='booking_created_owner').recipient_user_id,uid(4));
      assert.equal((await claim(fallback)).find(job=>job.kind==='booking_created_owner').recipient.email,'super@example.test');
      await root("update public.users_admin set terenuri='Court A' where user_id=$1",[uid(3)]);
      await clear();
    });
    await t.test('a multi-hour cancellation is one statement event per recipient with the final cancelled hours', async () => {
      const id=uid(1000);
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1",[id]);
      const outbox=await jobs(); assert.equal(outbox.length,2);
      assert.deepEqual(outbox.map(job=>job.kind).sort(),['booking_cancelled_client','booking_cancelled_owner']);
      assert.ok(outbox.every(job=>job.event_key.startsWith(id+':')));
      const payloads=await claim(id);
      assert.ok(payloads.every(job=>JSON.stringify(job.booking.hours)===JSON.stringify(['12:00','13:00','14:00'])));
      assert.ok(payloads.every(job=>job.booking.amountRON===300));
      assert.ok(payloads.every(job=>job.booking.remainingHours.length===0));
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1",[id]);
      assert.equal((await jobs()).length,2); await clear();
    });
    await t.test('partial cancellations describe only changed hours and preserve remaining hours', async () => {
      const id=uid(1001);
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='16:00'",[id]);
      const payload=await claim(id); assert.equal(payload.length,2);
      assert.ok(payload.every(job=>JSON.stringify(job.booking.hours)===JSON.stringify(['16:00'])));
      assert.ok(payload.every(job=>JSON.stringify(job.booking.remainingHours)===JSON.stringify(['17:00'])));
      assert.ok(payload.every(job=>job.booking.amountRON===100));
      for(const job of payload) await finish(job);
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='17:00'",[id]);
      const second=await claim(id); assert.equal(second.length,2);
      assert.ok(second.every(job=>JSON.stringify(job.booking.hours)===JSON.stringify(['17:00'])));
      assert.ok(second.every(job=>job.booking.remainingHours.length===0));
      assert.equal((await jobs()).length,4); await clear();
    });
    await t.test('a partial cancellation before first dispatch retains the receipt for remaining hours', async () => {
      const id=await create(['16:00','17:00']);
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1 and ora='16:00'",[id]);
      const payload=await claim(id);assert.equal(payload.length,4);
      const receipt=payload.find(job=>job.kind==='booking_created_client');
      assert.ok(receipt);assert.deepEqual(receipt.booking.hours,['17:00']);assert.equal(receipt.booking.amountRON,100);
      const owner=payload.find(job=>job.kind==='booking_created_owner');
      assert.deepEqual(owner.booking.hours,['17:00']);assert.equal(owner.booking.amountRON,100);
      const cancelled=payload.find(job=>job.kind==='booking_cancelled_client');
      assert.deepEqual(cancelled.booking.hours,['16:00']);assert.deepEqual(cancelled.booking.remainingHours,['17:00']);
      await clear();
    });
    await t.test('a full cancellation before first dispatch skips stale creation receipts', async () => {
      const id=await create(['12:00','13:00']);
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1",[id]);
      const payload=await claim(id);assert.equal(payload.length,2);
      assert.ok(payload.every(job=>job.kind.startsWith('booking_cancelled_')));
      assert.ok((await jobs()).filter(job=>job.kind.startsWith('booking_created_')).every(job=>job.status==='skipped'));
      await clear();
    });
    await t.test('new client chats create owner jobs only; staff replies and read receipts do not enqueue mail', async () => {
      // A current authenticated booking grants Alice access to this chat. The
      // historical cancelled reservation must not be enough to open one.
      await as('authenticated',1,'select public.create_booking_group($1,$2,$3,$4::text[],false)',[uid(9001),court,day,['22:00']]);
      await clear();
      await as('authenticated',1,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('alice@example.test','Court A','client','Salut, aveți vestiar?')");
      let outbox=await jobs(); assert.equal(outbox.length,1); assert.equal(outbox[0].kind,'chat_owner');
      await as('authenticated',3,"insert into public.mesaje_chat(email_client,teren,expeditor,mesaj) values('alice@example.test','Court A','admin','Da, avem vestiar.')");
      await as('authenticated',3,"update public.mesaje_chat set citit=true where teren='Court A' and expeditor='client'");
      assert.equal((await jobs()).length,1);
      const payload=(await claim())[0]; assert.equal(payload.chat.preview,'Salut, aveți vestiar?'); assert.equal(payload.recipient.email,'admin@example.test');
      assert.equal(payload.chat.customerName,'Alice'); await clear();
    });
    await t.test('a court rename keeps cancellation notifications with its currently allocated owner', async () => {
      await root("update public.terenuri set nume='Renamed Court A' where id::text=$1",[court]);
      await root("update public.rezervari set stare='anulata' where booking_group_id=$1",[uid(9001)]);
      const outbox=await jobs();assert.equal(outbox.length,2);
      assert.equal(outbox.find(job=>job.kind==='booking_cancelled_owner').recipient_user_id,uid(3));
      const owner=(await claim(uid(9001))).find(job=>job.kind==='booking_cancelled_owner');
      assert.equal(owner.recipient.email,'admin@example.test');assert.equal(owner.booking.courtName,'Renamed Court A');
      await root("update public.terenuri set nume='Court A' where id::text=$1",[court]);await clear();
    });
    await t.test('retry/error inputs cannot persist credentials or arbitrary provider responses', async () => {
      const id=await create(['21:00']); const leased=(await claim(id))[0];
      await assert.rejects(()=>finish(leased,'retry','Bearer secret-sensitive-value'),/Invalid notification outcome/);
      await assert.rejects(()=>service('select public.claim_booking_notifications(200,120,null,null)'),/Invalid notification lease/);
      await root('update spotivity_private.notification_outbox set attempts=8,status=$1,available_at=now() where booking_id=$2',['retry',id]);
      assert.equal((await claim(id)).length,0); assert.ok((await jobs()).every(job=>job.status==='blocked'));
    });
    await t.test('migration is rerunnable without changing queued records or existing application data', async () => {
      const before=await jobs(); await root('select 1'); await pg.exec(sql('016_notification_outbox.sql')); assert.deepEqual(await jobs(),before);
    });
  } finally { await pg.close(); }
});
