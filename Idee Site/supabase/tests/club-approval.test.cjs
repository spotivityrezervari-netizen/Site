// Disposable PostgreSQL fixture. This suite never writes to hosted Supabase.
const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const file = name => readFileSync(join(__dirname, '..', name), 'utf8');
const integerIds = process.env.SPOTIVITY_TEST_INTEGER_IDS === '1';
const signatures = {
  submit: 'public.submit_club_application(uuid,uuid,text,text,text,text,text,text,text,jsonb,text,text,jsonb)',
  legacy: 'public.submit_club_request(uuid,text,text,text,text,text,text,text,jsonb,text,text)',
  approve: 'public.approve_club_request(uuid,jsonb,text,timestamp with time zone,text)',
  reject: 'public.reject_club_request(uuid,text,timestamp with time zone)'
};
const emails = {1:'alice@example.test',2:'bob@example.test',3:'admin@example.test',4:'super@example.test'};
let passed = 0;

(async () => {
  const pg = new PGlite();
  try {
    let schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    if (integerIds) {
      schema = schema.replaceAll('id uuid primary key default gen_random_uuid()', 'id bigint generated always as identity primary key');
      schema = schema.replace('pret numeric, pret_minge numeric', 'pret integer, pret_minge integer');
    } else {
      schema = schema.replace('create table public.terenuri (\n  id bigint generated always as identity primary key', 'create table public.terenuri (\n  id uuid primary key default gen_random_uuid()');
    }
    // Hosted Supabase supports both the individual sub setting and JSON claims.
    schema = schema.replace("nullif(current_setting('request.jwt.claim.sub',true),'')::uuid", "coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid");
    await pg.exec(schema);
    const as = async (role, person, sql, params = []) => {
      const claims=JSON.stringify({sub:person?uid(person):null,role});
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${person ? uid(person) : ''}',false); select set_config('request.jwt.claims','${claims}',false); select set_config('request.jwt.claim.role','${role}',false); set role ${role}`);
      return pg.query(sql, params);
    };
    const root = (sql, params = []) => as('postgres', null, sql, params);
    const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
    const json = value => value == null ? null : JSON.stringify(value);
    const request = (person, id, changes = {}) => ({
      id:uid(id), person, nume_baza:`Club ${person}`, nume_contact:'Ana Pop', email:emails[person],
      telefon:'+40 712 345 678', oras:'Cluj-Napoca', adresa:'Strada Sportului 3',
      link_maps:'https://maps.app.goo.gl/Abc123',
      terenuri:[{nume:'Fotbal 1',sport:'Fotbal'},{nume:'Picior 1',sport:'Tenis Picior'}],
      descriere:'Două terenuri pentru comunitate.', poza_path:null, prices:[120,90], ...changes
    });
    const submit = (value, role = 'service_role', actor = null) => as(role, actor,
      'select public.submit_club_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb) id',
      [uid(value.person),value.id,value.nume_baza,value.nume_contact,value.email,value.telefon,value.oras,value.adresa,value.link_maps,json(value.terenuri),value.descriere,value.poza_path,json(value.prices)]);
    const approve = (id, prices = [120,90], options = {}) => as(options.role || 'authenticated', options.actor === undefined ? 4 : options.actor,
      'select public.approve_club_request($1,$2::jsonb,$3,$4::timestamptz,$5) result',
      [id,json(prices),options.photo || null,options.expected || null,options.note === undefined ? null : options.note]).then(result=>result.rows[0].result);
    const reject = (id, options = {}) => as(options.role || 'authenticated', options.actor === undefined ? 4 : options.actor,
      'select public.reject_club_request($1,$2,$3::timestamptz) result',
      [id,options.note || '',options.expected || null]).then(result=>result.rows[0].result);
    const row = id => root('select * from public.cereri_baze_sportive where id=$1',[id]).then(result=>result.rows[0]);
    const all = (person, role = 'authenticated') => as(role,person,'select * from public.cereri_baze_sportive order by created_at,id').then(result=>result.rows);
    const table = name => root(`select to_jsonb(t) row from ${name} t order by to_jsonb(t)::text`).then(result=>result.rows);
    const businessTables = ['auth.users','public.clienti','public.users_admin','public.terenuri','public.rezervari','public.mesaje_chat','public.rezervari_disponibilitate','public.site_sporturi','public.baze_sportive','public.baze_sportive_admini','storage.objects','storage.buckets'];
    const business = async () => {
      const state = {};
      for (const name of businessTables) state[name] = await table(name);
      return state;
    };
    const definitions = async () => ({
      policies:(await root("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename <> 'cereri_baze_sportive' order by schemaname,tablename,policyname")).rows,
      triggers:(await root("select oid::text,tgname,tgenabled::text,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgname <> 'spotivity_club_request_review' order by oid")).rows,
      guards:(await root("select p.oid::text,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='spotivity_private' and p.proname not like '%club%' order by p.oid")).rows
    });
    const stored = (bucket, path, metadata = {size:2048,mimetype:'image/png'}) => root(
      'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[bucket,path,json(metadata)]);
    const publicPhoto = (requestRow, attempt = 909091) => `${requestRow.reserved_base_id}/${uid(attempt)}.png`;
    const privatePhoto = value => `${uid(value.person)}/${value.id}/${uid(9999)}.png`;

    const migration = file('012_club_approval.sql');
    await check('012 refuses an unsecured fixture before creating approval columns', async () => {
      await assert.rejects(()=>pg.exec(migration),/Apply migrations|before 012/i); await pg.exec('rollback');
      assert.equal((await root("select to_regclass('public.cereri_baze_sportive')::text name")).rows[0].name,null);
    });
    for (const name of ['001_security.sql','003_court_hours.sql','004_admin_scope_hardening.sql','005_sport_appearance.sql','006_sports_bases.sql','007_completed_booking_cancellation.sql','008_profile_edit.sql','009_base_photos.sql','010_foot_tennis.sql']) await pg.exec(file(name));
    await check('012 requires migration 011 and refuses partially registered predecessors', async () => {
      await assert.rejects(()=>pg.exec(migration),/Apply migrations|011 before 012/i); await pg.exec('rollback');
      await pg.exec(file('011_club_requests.sql'));
      for (const version of [1,3,4,5,6,7,8,9,10,11]) {
        const saved=(await root('delete from spotivity_private.migrations where version=$1 returning *',[version])).rows[0];
        await assert.rejects(()=>pg.exec(migration),/Apply migrations|before 012/i); await pg.exec('rollback');
        await root('insert into spotivity_private.migrations(version,applied_at) values($1,$2)',[saved.version,saved.applied_at]);
      }
    });
    for (const person of [5,6,8,9,10,11,12]) {
      emails[person]=`applicant${person}@example.test`;
      await root('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[uid(person),emails[person],person===5?null:new Date().toISOString()]);
    }
    // These are existing unrelated allocations, not resources created by approval.
    const preexistingBase=uid(50);
    await root('insert into public.baze_sportive(id,nume,oras) values($1,$2,$3)',[preexistingBase,'Existing Base','Oradea']);
    await root('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)',[preexistingBase,uid(3)]);
    await root('update public.terenuri set baza_sportiva_id=$1 where nume=$2',[preexistingBase,'Court A']);
    const before = await business();
    const oldDefinitions = await definitions();
    await pg.exec(migration);
    await check('012 preserves business data, old RLS policies, guard definitions and triggers', async () => {
      assert.deepEqual(await business(),before);
      assert.deepEqual(await definitions(),oldDefinitions);
      assert.equal((await root('select count(*)::int count from spotivity_private.migrations where version=12')).rows[0].count,1);
    });

    await check('only server submission and current database superadmin approval RPCs are executable', async () => {
      for (const role of ['anon','authenticated','service_role']) {
        for (const action of ['submit','approve','reject']) {
          const expected=action==='submit'?role==='service_role':role==='authenticated';
          assert.equal((await root('select has_function_privilege($1,$2,$3) ok',[role,signatures[action],'EXECUTE'])).rows[0].ok,expected,`${role} ${action}`);
        }
      }
      for (const role of ['anon','authenticated']) assert.equal((await root('select has_function_privilege($1,$2,$3) ok',[role,signatures.legacy,'EXECUTE'])).rows[0].ok,false);
      for (const role of ['anon','authenticated']) await assert.rejects(()=>submit(request(1,90),role,role==='authenticated'?1:null),/permission denied/);
    });
    await check('server submission requires the actual applicant email and never trusts metadata roles', async () => {
      for (const value of [request(999,91,{email:'missing@example.test'}),request(1,91,{email:emails[2]}),request(1,91,{email:'different@example.test'})]) await assert.rejects(()=>submit(value),/email|account|Auth/i);
      await root('update auth.users set raw_user_meta_data=$2::jsonb where id=$1',[uid(1),json({is_super:true,role:'superadmin'})]);
      await assert.rejects(()=>approve(uid(91),[120,90],{actor:1}),/superadmin|permission/i);
      await root("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1",[uid(1)]);
      assert.deepEqual(await all(1),[]);
    });
    const first=request(1,100,{nume_baza:'Club, Nord',terenuri:[{nume:'Fotbal, 1',sport:'Fotbal'},{nume:'Picior, Nord',sport:'Tenis Picior'}],descriere:'x'.repeat(2300)});
    await check('pending submission retains requested prices with zero court, role or base access', async () => {
      const initial=await business();
      assert.equal((await submit(first)).rows[0].id,first.id);
      const pending=await row(first.id);
      assert.equal(pending.stare,'noua');assert.ok(pending.reserved_base_id);
      assert.equal(pending.approved_base_id,null);assert.deepEqual(pending.approved_court_ids,null);
      assert.deepEqual(pending.preturi_solicitate,[120,90]);
      assert.deepEqual(await business(),initial);
      assert.deepEqual((await as('authenticated',1,'select * from public.users_admin')).rows,[]);
      assert.equal((await as('authenticated',1,'update public.terenuri set pret=50 returning id')).rows.length,0);
      assert.deepEqual(await all(1),[]);assert.deepEqual(await all(3),[]);
      await assert.rejects(()=>all(null,'anon'),/permission denied/);
    });
    await check('submission retries are idempotent, restore Auth claims and reject changed prices or another applicant', async () => {
      const original=await row(first.id);
      assert.equal((await submit(first,'service_role',4)).rows[0].id,first.id);
      const claims=(await pg.query("select current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claims',true)::jsonb claims")).rows[0];assert.equal(claims.subject,uid(4));assert.deepEqual(claims.claims,{sub:uid(4),role:'service_role'});
      assert.deepEqual(await row(first.id),original);
      await assert.rejects(()=>submit({...first,prices:[121,90]}),/different|already|price/i);
      await assert.rejects(()=>submit({...first,person:2,email:emails[2]}),/unavailable|already/i);
    });
    await check('trusted submission temporarily clears both Auth claim sources and restores them on failure', async () => {
      const value=request(12,1201);assert.equal((await submit(value,'service_role',1)).rows[0].id,value.id);
      assert.deepEqual((await pg.query("select current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claims',true)::jsonb claims")).rows[0],{subject:uid(1),claims:{sub:uid(1),role:'service_role'}});
      await assert.rejects(()=>submit({...value,oras:'Oradea'},'service_role',2),/different|already/i);
      assert.deepEqual((await pg.query("select current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claims',true)::jsonb claims")).rows[0],{subject:uid(2),claims:{sub:uid(2),role:'service_role'}});
    });
    await check('proposed prices require whole-RON numbers and reject missing, negative or wrong-length arrays', async () => {
      for (const prices of [null,[1.5,90],['120',90],[-1,90],[100001,90],[],[100],{},true,[null,90]]) await assert.rejects(()=>submit(request(6,601,{prices})),/price|RON|tarif/i);
      assert.equal((await root('select spotivity_private.club_application_prices_valid($1::jsonb,null) valid',[json([120,90])])).rows[0].valid,false);
      assert.equal((await submit(request(6,601,{prices:[0,100000]}))).rows[0].id,uid(601));
      assert.deepEqual((await row(uid(601))).preturi_solicitate,[0,100000]);
    });
    await check('global court-name collisions keep the existing court and generate a distinct safe scoped name', async () => {
      const value=request(6,601,{prices:[0,100000]});
      const collision=`${value.nume_baza} — Fotbal 1 [${value.id.replaceAll('-','').slice(0,8)}-1]`;
      await root('insert into public.terenuri(nume,sport,pret,optiune_minge,este_activ) values($1,$2,$3,false,true)',[collision,'Fotbal',777]);
      const before=(await root('select * from public.terenuri where nume=$1',[collision])).rows[0];
      const result=await approve(value.id,[0,100000]);
      const courts=(await root('select * from public.terenuri where baza_sportiva_id=$1',[result.base_id])).rows;
      assert.equal(courts.length,2);assert.equal(new Set(courts.map(court=>court.nume)).size,2);assert.ok(courts.every(court=>court.nume!==collision&&!court.nume.includes(',')));
      assert.deepEqual((await root('select * from public.terenuri where nume=$1',[collision])).rows[0],before);
      const scope=(await root('select terenuri from public.users_admin where user_id=$1',[uid(6)])).rows[0].terenuri.split(',');
      assert.ok(!scope.includes(collision));assert.deepEqual(scope.sort(),courts.map(court=>court.nume).sort());
    });
    await check('anonymous, ordinary admins, applicants and service role cannot approve or reject', async () => {
      const snapshot=await business();
      for (const actor of [1,2,3]) {
        await assert.rejects(()=>approve(first.id,[120,90],{actor}),/superadmin|permission/i);
        await assert.rejects(()=>reject(first.id,{actor}),/superadmin|permission/i);
      }
      for (const role of ['anon','service_role']) {
        await assert.rejects(()=>approve(first.id,[120,90],{role,actor:null}),/permission denied/);
        await assert.rejects(()=>reject(first.id,{role,actor:null}),/permission denied/);
      }
      assert.deepEqual(await business(),snapshot);
    });
    await check('direct acceptance cannot bypass atomic publication and submitted columns remain immutable', async () => {
      await assert.rejects(()=>as('authenticated',4,"update public.cereri_baze_sportive set stare='acceptata' where id=$1",[first.id]),/approv|accept|RPC|action/i);
      assert.equal((await row(first.id)).stare,'noua');
      for (const field of ['reserved_base_id','approved_base_id','approved_court_ids','preturi_solicitate','email','solicitant_user_id']) assert.equal((await root('select has_column_privilege($1,$2,$3,$4) ok',['authenticated','public.cereri_baze_sportive',field,'UPDATE'])).rows[0].ok,false);
      await root('grant update on public.cereri_baze_sportive to authenticated');
      for (const [field,value] of [['reserved_base_id',uid(999)],['email','changed@example.test']]) await assert.rejects(()=>as('authenticated',4,`update public.cereri_baze_sportive set ${field}=$1 where id=$2`,[value,first.id]),/immutable|controlled|submitted/i);
      await root('revoke update on public.cereri_baze_sportive from authenticated');
      await root('grant update(stare,nota_interna) on public.cereri_baze_sportive to authenticated');
    });
    await check('approval validates prices and the current review version before writing any business rows', async () => {
      const snapshot=await business();
      for (const prices of [null,[],[100],['100',90],[1.25,90],[-1,90],[100001,90],[100,90,80],{},[null,90]]) await assert.rejects(()=>approve(first.id,prices),/price|RON|tarif/i);
      await assert.rejects(()=>approve(first.id,[100,90],{expected:'2000-01-01T00:00:00Z'}),/changed|stale|refresh|version/i);
      await assert.rejects(()=>approve(first.id,[100,90],{photo:`${uid(999)}/${first.id}.png`}),/photo|image|poza/i);
      assert.deepEqual(await business(),snapshot);
    });
    let firstApproval;
    await check('acceptance atomically publishes an active base and courts and grants only its applicant access', async () => {
      const pending=await row(first.id);
      firstApproval=await approve(first.id,[125,95],{expected:pending.updated_at,note:'Baza a fost verificată.'});
      assert.equal(firstApproval.request_id,first.id);assert.equal(firstApproval.status,'acceptata');assert.equal(firstApproval.base_id,pending.reserved_base_id);assert.equal(firstApproval.court_ids.length,2);
      const accepted=await row(first.id);assert.equal(accepted.stare,'acceptata');assert.equal(accepted.approved_base_id,firstApproval.base_id);assert.deepEqual(accepted.approved_court_ids,firstApproval.court_ids);assert.equal(accepted.reviewer_user_id,uid(4));assert.ok(accepted.reviewed_at);assert.equal(accepted.nota_interna,'Baza a fost verificată.');
      const base=(await root('select * from public.baze_sportive where id=$1',[firstApproval.base_id])).rows[0];
      assert.equal(base.nume,first.nume_baza);assert.equal(base.oras,first.oras);assert.equal(base.este_activa,true);assert.equal(base.descriere,'x'.repeat(2000));assert.equal(base.poza,null);
      const courts=(await root('select * from public.terenuri where baza_sportiva_id=$1 order by sport',[firstApproval.base_id])).rows;
      assert.equal(courts.length,2);assert.deepEqual(courts.map(court=>court.sport),['Fotbal','Tenis Picior']);
      assert.deepEqual(courts.map(court=>Number(court.pret)),[125,95]);
      for (const court of courts) {
        assert.equal(court.este_activ,true);assert.equal(court.oras,first.oras);assert.equal(court.locatie,first.link_maps);assert.equal(court.optiune_minge,false);assert.ok(court.pret_minge==null||Number(court.pret_minge)===0);assert.ok(!court.nume.includes(','));
      }
      const account=(await root('select * from public.users_admin where user_id=$1',[uid(1)])).rows[0];
      assert.equal(account.is_super,false);assert.equal(account.email,emails[1]);
      assert.deepEqual(account.terenuri.split(',').sort(),courts.map(court=>court.nume).sort());
      assert.equal((await root('select * from public.baze_sportive_admini where baza_id=$1 and user_id=$2',[base.id,uid(1)])).rows.length,1);
      assert.equal((await as('anon',null,'select * from public.baze_sportive where id=$1',[base.id])).rows.length,1);
      assert.equal((await as('anon',null,'select * from public.terenuri where baza_sportiva_id=$1',[base.id])).rows.length,2);
      assert.equal((await as('authenticated',1,'update public.terenuri set pret=126 where baza_sportiva_id=$1 returning id',[base.id])).rows.length,2);
      assert.equal((await as('authenticated',1,"update public.terenuri set pret=1 where nume='Court A' returning id")).rows.length,0);
      assert.equal((await as('authenticated',1,'update public.baze_sportive set descriere=$1 where id=$2 returning id',['Description by owner',base.id])).rows.length,1);
      assert.equal((await as('authenticated',1,'update public.baze_sportive set descriere=$1 where id=$2 returning id',['Intrusion',preexistingBase])).rows.length,0);
      assert.deepEqual(await all(1),[]);
    });
    await check('acceptance retries create no duplicates and cannot reject or reset the published request', async () => {
      const snapshot=await business();const accepted=await row(first.id);
      const retry=await approve(first.id,[999,999],{expected:'2000-01-01T00:00:00Z'});
      assert.deepEqual(retry,firstApproval);assert.deepEqual(await business(),snapshot);assert.deepEqual(await row(first.id),accepted);
      await assert.rejects(()=>reject(first.id),/already|published|accept|approved/i);
      await assert.rejects(()=>as('authenticated',4,"update public.cereri_baze_sportive set stare='noua' where id=$1",[first.id]),/published|terminal|accept|approved|review/i);
    });
    await check('unconfirmed Auth applicants remain pending and have no administrative role', async () => {
      const value=request(5,500);await submit(value);
      const snapshot=await business();await assert.rejects(()=>approve(value.id),/confirm/i);
      assert.deepEqual(await business(),snapshot);assert.equal((await row(value.id)).stare,'noua');
      assert.equal((await root('select * from public.users_admin where user_id=$1',[uid(5)])).rows.length,0);
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(5)]);
      assert.equal((await approve(value.id)).status,'acceptata');
    });
    await check('approval of an existing ordinary admin preserves old courts and base permissions', async () => {
      const value=request(3,300);const old=(await root('select * from public.users_admin where user_id=$1',[uid(3)])).rows[0];
      await submit(value);const accepted=await approve(value.id);
      const current=(await root('select * from public.users_admin where user_id=$1',[uid(3)])).rows[0];
      assert.equal(current.id,old.id);assert.equal(current.user_id,old.user_id);assert.equal(current.is_super,false);assert.equal(current.nume_admin,old.nume_admin);assert.ok(current.terenuri.split(',').includes('Court A'));
      assert.equal((await as('authenticated',3,"update public.terenuri set pret=111 where nume='Court A' returning id")).rows.length,1);
      assert.equal((await as('authenticated',3,'update public.terenuri set pret=111 where baza_sportiva_id=$1 returning id',[accepted.base_id])).rows.length,2);
      assert.equal((await root('select * from public.baze_sportive_admini where user_id=$1',[uid(3)])).rows.length,2);
    });
    await check('approval never demotes an existing superadmin or replaces ALL court scope', async () => {
      const value=request(4,400);const old=(await root('select * from public.users_admin where user_id=$1',[uid(4)])).rows[0];
      await submit(value);await approve(value.id);
      assert.deepEqual((await root('select * from public.users_admin where user_id=$1',[uid(4)])).rows[0],old);
    });
    await check('rejection records the reviewing superadmin and creates no base, court or role', async () => {
      const value=request(2,200);await submit(value);const snapshot=await business();
      const rejected=await reject(value.id,{note:'Documentația trebuie completată.',expected:(await row(value.id)).updated_at});
      assert.equal(rejected.request_id,value.id);assert.equal(rejected.status,'respinsa');
      const current=await row(value.id);assert.equal(current.stare,'respinsa');assert.equal(current.reviewer_user_id,uid(4));assert.equal(current.nota_interna,'Documentația trebuie completată.');assert.ok(current.reviewed_at);
      assert.deepEqual(await business(),snapshot);
      assert.equal((await reject(value.id)).status,'respinsa');
      await assert.rejects(()=>approve(value.id),/reject|respins|terminal|Reopen/i);
      assert.equal((await root('select * from public.users_admin where user_id=$1',[uid(2)])).rows.length,0);
    });
    await check('rejection detects stale reviews and invalid notes without mutating the request', async () => {
      const value=request(2,201);await submit(value);const pending=await row(value.id);const snapshot=await business();
      await assert.rejects(()=>reject(value.id,{expected:'2000-01-01T00:00:00Z'}),/changed|stale|Reload/i);
      await assert.rejects(()=>reject(value.id,{note:'x'.repeat(2001)}),/note|2000/i);
      await assert.rejects(()=>approve(value.id,[120,90],{note:'x'.repeat(2001)}),/note|2000/i);
      assert.deepEqual(await row(value.id),pending);assert.deepEqual(await business(),snapshot);
    });
    await check('an applicant email change prevents approval of an application for the previous address', async () => {
      await root('update auth.users set email=$1 where id=$2',['bob.changed@example.test',uid(2)]);
      const snapshot=await business();await assert.rejects(()=>approve(uid(201)),/email|account/i);
      assert.deepEqual(await business(),snapshot);assert.equal((await row(uid(201))).stare,'noua');
      await root('update auth.users set email=$1 where id=$2',[emails[2],uid(2)]);
    });
    await check('legacy accepted status with no publication metadata can be provisioned or rejected safely', async () => {
      const provision=request(8,800), decline=request(8,801);await submit(provision);await submit(decline);
      await root("update public.cereri_baze_sportive set stare='acceptata' where id in ($1,$2)",[provision.id,decline.id]);
      assert.equal((await approve(provision.id)).status,'acceptata');
      const snapshot=await business();assert.equal((await reject(decline.id)).status,'respinsa');assert.deepEqual(await business(),snapshot);
    });
    await check('publication requires a copied photo under its reserved base with a per-attempt UUID and valid raster metadata', async () => {
      const value=request(10,1000);value.poza_path=privatePhoto(value);await stored('cereri_baze_sportive',value.poza_path);await submit(value);
      const pending=await row(value.id);const path=publicPhoto(pending);const snapshot=await business();
      await assert.rejects(()=>approve(value.id),/photo|image|poza/i);
      await assert.rejects(()=>approve(value.id,[120,90],{photo:path}),/photo|image|poza/i);
      assert.deepEqual(await business(),snapshot);
      for (const metadata of [null,{}, {size:0,mimetype:'image/png'},{size:5242881,mimetype:'image/png'},{size:32,mimetype:'image/svg+xml'},{size:'invalid',mimetype:'image/png'},{size:32,mimetype:'image/jpeg'}]) {
        await stored('poze_baze_sportive',path,metadata);const withObject=await business();
        await assert.rejects(()=>approve(value.id,[120,90],{photo:path}),/photo|image|poza|metadata|raster|5 MB/i);
        assert.deepEqual(await business(),withObject);await root('delete from storage.objects where bucket_id=$1 and name=$2',['poze_baze_sportive',path]);
      }
      await stored('poze_baze_sportive',path);
      await assert.rejects(()=>approve(value.id,[120,90],{photo:`${uid(999)}/${value.id}.png`}),/photo|image|poza/i);
      for (const invalid of [`${pending.reserved_base_id}/not-a-uuid.png`,`${pending.reserved_base_id}/${uid(909091)}/extra.png`,`${pending.reserved_base_id}/${uid(909091)}.svg`]) await assert.rejects(()=>approve(value.id,[120,90],{photo:invalid}),/photo|image|poza/i);
      const accepted=await approve(value.id,[120,90],{photo:path});
      assert.equal((await root('select poza from public.baze_sportive where id=$1',[accepted.base_id])).rows[0].poza,path);
      assert.equal((await as('anon',null,'select * from storage.objects where bucket_id=$1 and name=$2',['poze_baze_sportive',path])).rows.length,1);
      assert.equal((await as('authenticated',10,'select * from storage.objects where bucket_id=$1 and name=$2',['cereri_baze_sportive',value.poza_path])).rows.length,0);
      assert.equal((await as('authenticated',4,'select * from storage.objects where bucket_id=$1 and name=$2',['cereri_baze_sportive',value.poza_path])).rows.length,1);
    });
    await check('repeated approval with a different valid staged copy preserves the first photo and creates no duplicate courts', async () => {
      const application=await row(uid(1000));
      const originalPhoto=publicPhoto(application);
      const otherPhoto=publicPhoto(application,909092);
      assert.notEqual(originalPhoto,otherPhoto);
      assert.notEqual(originalPhoto.split('/')[1].split('.')[0],application.id);
      await stored('poze_baze_sportive',otherPhoto);
      const snapshot=await business();const published=await row(application.id);
      const retried=await approve(application.id,[120,90],{photo:otherPhoto});
      assert.equal(retried.base_id,application.approved_base_id);
      assert.deepEqual(retried.court_ids,application.approved_court_ids);
      assert.equal(retried.status,'acceptata');
      assert.equal((await root('select poza from public.baze_sportive where id=$1',[application.approved_base_id])).rows[0].poza,originalPhoto);
      assert.deepEqual(await business(),snapshot);assert.deepEqual(await row(application.id),published);
    });
    await check('an approval failure rolls back created courts, base, role, permissions and request status together', async () => {
      const value=request(11,1100);await submit(value);
      await root("create function public.fixture_fail_approval() returns trigger language plpgsql as $$ begin if new.user_id='00000000-0000-0000-0000-000000000011' then raise exception 'fixture injected approval failure'; end if; return new; end $$");
      await root('create trigger fixture_fail_approval before insert on public.baze_sportive_admini for each row execute function public.fixture_fail_approval()');
      const snapshot=await business();const pending=await row(value.id);
      await assert.rejects(()=>approve(value.id),/fixture injected approval failure/);
      assert.deepEqual(await business(),snapshot);assert.deepEqual(await row(value.id),pending);
      await root('drop trigger fixture_fail_approval on public.baze_sportive_admini');await root('drop function public.fixture_fail_approval()');
      assert.equal((await approve(value.id)).status,'acceptata');
    });
    await check('daily submission quota remains per real account and retries do not consume quota', async () => {
      const firstDaily=request(9,900);for (const n of [900,901,902,903,904]) await submit(request(9,n));
      await assert.rejects(()=>submit(request(9,905)),/five sports-base applications/i);
      assert.equal((await submit(firstDaily)).rows[0].id,firstDaily.id);
      assert.equal((await submit(request(12,1200))).rows[0].id,uid(1200));
    });
    await check('superadmin demotion immediately revokes review and request visibility', async () => {
      const pending=uid(1200);await root("update public.users_admin set is_super=false,terenuri='Court A' where user_id=$1",[uid(4)]);
      assert.deepEqual(await all(4),[]);
      await assert.rejects(()=>approve(pending),/superadmin|permission/i);await assert.rejects(()=>reject(pending),/superadmin|permission/i);
      await root("update public.users_admin set is_super=true,terenuri='ALL' where user_id=$1",[uid(4)]);
    });
    await check('reviewer Auth confirmation is rechecked before either approval or rejection', async () => {
      await root('update auth.users set email_confirmed_at=null where id=$1',[uid(4)]);
      const snapshot=await business();const pending=await row(uid(1200));
      await assert.rejects(()=>approve(uid(1200)),/authenticated superadmin|confirm/i);
      await assert.rejects(()=>reject(uid(1200)),/authenticated superadmin|confirm/i);
      assert.deepEqual(await business(),snapshot);assert.deepEqual(await row(uid(1200)),pending);
      await root('update auth.users set email_confirmed_at=statement_timestamp() where id=$1',[uid(4)]);
    });
    await check('completed reservation cancellation remains blocked for owner, ordinary admin and superadmin', async () => {
      await root("insert into public.rezervari(email_client,client_user_id,sport,teren,data_str,ora,pret_total,stare) values($1,$2,'Fotbal','Court A',$3,'12:00','100 RON','activa')",[emails[1],uid(1),new Date(Date.now()-3*86400000).toISOString().slice(0,10)]);
      const booking=(await root("select id from public.rezervari where stare='activa' and teren='Court A' order by created_at desc limit 1")).rows[0];
      for (const person of [1,3,4]) await assert.rejects(()=>as('authenticated',person,"update public.rezervari set stare='anulata' where id=$1",[booking.id]),/Completed bookings cannot be cancelled/);
      assert.equal((await root('select stare from public.rezervari where id=$1',[booking.id])).rows[0].stare,'activa');
    });
    await check('deleting a published base never permits reapproval, rejection or direct terminal-history reset', async () => {
      const result=await approve(uid(1200));
      await root('delete from public.baze_sportive where id=$1',[result.base_id]);
      const history=await row(uid(1200));assert.equal(history.approved_base_id,null);assert.deepEqual(history.approved_court_ids,result.court_ids);
      const snapshot=await business();
      await assert.rejects(()=>approve(uid(1200)),/already|approved|published|history|deleted/i);
      await assert.rejects(()=>reject(uid(1200)),/already|approved|published|history|deleted/i);
      await assert.rejects(()=>as('authenticated',4,"update public.cereri_baze_sportive set stare='respinsa' where id=$1",[uid(1200)]),/already|approved|published|history|deleted/i);
      assert.deepEqual(await business(),snapshot);assert.deepEqual(await row(uid(1200)),history);
    });
    await check('rerunning migration preserves applications, publication metadata, business data and guard states', async () => {
      const snapshot=await business();const applications=await table('public.cereri_baze_sportive');const guards=await definitions();
      await pg.exec(migration);
      assert.deepEqual(await business(),snapshot);assert.deepEqual(await table('public.cereri_baze_sportive'),applications);assert.deepEqual(await definitions(),guards);
      assert.equal((await root('select count(*)::int count from spotivity_private.migrations where version=12')).rows[0].count,1);
    });
    console.log(`PASS ${passed} club approval checks (${integerIds?'integer IDs/prices':'UUID court IDs/numeric prices'})`);
  } finally { await pg.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
