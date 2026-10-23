// Real Supabase SDK, Chromium and disposable PostgreSQL/RLS. All hosted
// Supabase HTTP/WebSocket traffic is intercepted; this test never writes live.
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const {readFileSync, mkdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const {createBookingWorkflowFixture} = require('./booking-workflow-fixture.cjs');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const host = 'ndubcdwohqzgxpuiowye.supabase.co';
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:8002/';
const bucket = 'poze_baze_sportive';
const screenshots = process.env.SPOTIVITY_TEST_SCREENSHOT_DIR;
if (screenshots) mkdirSync(screenshots, {recursive: true});
const tokens = new Map();
const token = person => {
  const payload = Buffer.from(JSON.stringify({sub: uid(person), exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated'})).toString('base64url');
  const value = `eyJhbGciOiJIUzI1NiJ9.${payload}.${Buffer.from(`fixture-${person}`).toString('base64url')}`;
  tokens.set(value, person); return value;
};
const ident = value => { assert.match(value, /^[a-zA-Z_][a-zA-Z0-9_]*$/); return `"${value}"`; };
const mimeFor = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif'};
let checks = 0;

(async () => {
  const pg = new PGlite();
  let browser;
  try {
    await pg.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
    for (const file of ['001_security.sql', '003_court_hours.sql', '004_admin_scope_hardening.sql',
      '005_sport_appearance.sql', '006_sports_bases.sql', '007_completed_booking_cancellation.sql', '008_profile_edit.sql', '009_base_photos.sql', '010_foot_tennis.sql', '011_club_requests.sql', '012_club_approval.sql', '013_admin_integration.sql', '014_booking_groups.sql', '015_profile_contact.sql', '016_notification_outbox.sql', '017_base_avatars.sql']) {
      await pg.exec(readFileSync(join(__dirname, '..', file), 'utf8'));
    }
    let queue = Promise.resolve();
    const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
    const root = fn => serial(async () => {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      return fn();
    });
    const baseA = uid(101), baseB = uid(102), hiddenBase = uid(103);
    await root(async () => {
      await pg.query("insert into public.baze_sportive(id,nume,oras,descriere,este_activa) values ($1,'Baza A','Reghin','Descriere publică A',true),($2,'Baza B','București','Descriere publică B',true),($3,'Baza ascunsă','Reghin','Private draft description',false)", [baseA, baseB, hiddenBase]);
      await pg.query('insert into public.baze_sportive_admini(baza_id,user_id) values($1,$2)', [baseA, uid(3)]);
      await pg.query("update public.terenuri set oras=case when nume='Court B' then 'București' else 'Reghin' end,poza='assets/imagini/avatar2.png',baza_sportiva_id=case when nume='Court A' then $1::uuid when nume='Court B' then $2::uuid else $3::uuid end", [baseA, baseB, hiddenBase]);
      for (let n = 1; n <= 8; n++) await pg.query("insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,poza,oras,este_activ,baza_sportiva_id) values($1,'Fotbal',100,15,true,'assets/imagini/avatar2.png','Reghin',true,$2)", [`Fixture Court ${n}`, baseA]);
    });
    const immutableState = () => root(async () => {
      const result = {};
      for (const table of ['clienti', 'users_admin', 'terenuri', 'rezervari', 'mesaje_chat', 'baze_sportive_admini']) {
        const order = table === 'baze_sportive_admini' ? 'baza_id,user_id' : 'id';
        result[table] = (await pg.query(`select * from public.${ident(table)} order by ${order}`)).rows;
      }
      return result;
    });
    const beforeBusiness = await immutableState();
    const requests = [], errors = [], objects = new Map();
    const bookingWorkflow = await createBookingWorkflowFixture({pg, host,
      resolveUser: bearer => {const person = tokens.get(bearer); return person ? uid(person) : null;}, records: requests});
    let objectSequence = 200, rejectNextPhotoMetadata = false;
    const user = row => ({...row, aud: 'authenticated', role: 'authenticated', app_metadata: {provider: 'email'}, user_metadata: row.raw_user_meta_data, identities: []});
    const api = async route => serial(async () => {
      const request = route.request(), url = new URL(request.url());
      const person = tokens.get((request.headers().authorization || '').replace(/^Bearer /, ''));
      const record = {path: url.pathname, method: request.method(), person};
      requests.push(record);
      const reply = (status, data) => {
        record.status = status;
        return route.fulfill({status, contentType: 'application/json', headers: {'access-control-allow-origin': '*',
          'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'X-Supabase-Api-Version'},
        body: data === undefined ? '' : JSON.stringify(data)});
      };
      try {
        if (url.pathname === '/functions/v1/booking-workflow') return bookingWorkflow.browserRoute(route);
        await pg.exec('reset role');
        await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [person ? uid(person) : '']);
        if (url.pathname.startsWith('/auth/v1/')) {
          if (url.pathname.endsWith('/logout')) return reply(204);
          if (url.pathname.endsWith('/token')) {
            const body = request.postDataJSON();
            const n = {'alice@example.test': 1, 'bob@example.test': 2, 'admin@example.test': 3, 'super@example.test': 4}[body.email];
            assert.ok(n); assert.equal(body.password, 'fixture-password');
            const row = (await pg.query('select * from auth.users where id=$1', [uid(n)])).rows[0];
            return reply(200, {access_token: token(n), refresh_token: `fixture-refresh-${n}`, expires_in: 3600, token_type: 'bearer', user: user(row)});
          }
          if (url.pathname.endsWith('/user') && person) return reply(200, user((await pg.query('select * from auth.users where id=$1', [uid(person)])).rows[0]));
          return reply(401, {message: 'No fixture session'});
        }
        if (url.pathname.startsWith('/storage/v1/object/public/')) {
          const key = decodeURIComponent(url.pathname.slice('/storage/v1/object/public/'.length));
          const photo = objects.get(key);
          const [bucketId, ...parts] = key.split('/');
          const publicBucket = (await pg.query('select public from storage.buckets where id=$1', [bucketId])).rows[0]?.public;
          const exists = (await pg.query('select 1 from storage.objects where bucket_id=$1 and name=$2', [bucketId, parts.join('/')])).rows.length;
          if (!publicBucket || !photo || !exists) return reply(404, {message: 'Image not found'});
          record.status = 200;
          return route.fulfill({status: 200, contentType: photo.mime, body: photo.body, headers: {'access-control-allow-origin': '*'}});
        }
        if (url.pathname.startsWith('/storage/v1/object/')) {
          const tail = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
          const [bucketId, ...parts] = tail.split('/');
          const path = parts.join('/');
          record.objectPath = path;
          if (request.method() === 'POST' && path) {
            const policy = (await pg.query('select file_size_limit,allowed_mime_types from storage.buckets where id=$1', [bucketId])).rows[0];
            if (!policy) return reply(404, {message: 'Bucket not found'});
            const contentType = request.headers()['content-type'] || '';
            let body = request.postDataBuffer(), mime = contentType.split(';')[0];
            if (contentType.startsWith('multipart/form-data')) {
              const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
              assert.ok(boundary, 'Multipart upload must include its boundary');
              const marker = Buffer.from('--' + (boundary[1] || boundary[2]));
              let position = 0, found = false;
              while ((position = body.indexOf(marker, position)) !== -1) {
                const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), position);
                if (headerEnd === -1) break;
                const headers = body.subarray(position, headerEnd).toString();
                const end = body.indexOf(Buffer.from('\r\n' + marker.toString()), headerEnd+4);
                if (end === -1) break;
                position = end+2;
                if (!headers.includes('filename=')) continue;
                mime = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream';
                body = body.subarray(headerEnd+4, end); found = true; break;
              }
              assert.ok(found, 'The SDK must send an actual uploaded file');
            }
            record.mime = mime; record.size = body.length;
            if (body.length > Number(policy.file_size_limit)) return reply(413, {statusCode: '413', error: 'EntityTooLarge', message: 'File exceeds the bucket size limit'});
            if (!policy.allowed_mime_types.includes(mime) || mimeFor[path.split('.').pop()] !== mime) return reply(415, {statusCode: '415', error: 'InvalidMimeType', message: 'Image type is not permitted'});
            const id = uid(++objectSequence);
            await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
            await pg.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)', [id, bucketId, path]);
            objects.set(bucketId+'/'+path, {body, mime});
            return reply(200, {Id: id, Key: bucketId+'/'+path});
          }
          if (request.method() === 'DELETE' && !path) {
            await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
            const paths = request.postDataJSON().prefixes; assert.ok(Array.isArray(paths));
            const removed = [];
            for (const name of paths) {
              const rows = (await pg.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id,name', [bucketId, name])).rows;
              for (const row of rows) { removed.push(row); objects.delete(bucketId+'/'+row.name); }
            }
            return reply(200, removed);
          }
          return reply(405, {message: 'Unexpected Storage fixture method'});
        }
        if (url.pathname === '/rest/v1/rpc/get_admin_access') {
          assert.equal(request.method(), 'POST');
          await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
          return reply(200, (await pg.query('select public.get_admin_access() value')).rows[0].value);
        }
        const table = url.pathname.split('/').pop();
        assert.ok(['clienti', 'users_admin', 'terenuri', 'rezervari', 'rezervari_disponibilitate', 'mesaje_chat', 'site_sporturi', 'baze_sportive', 'baze_sportive_admini', 'cereri_baze_sportive'].includes(table));
        await pg.exec(`set role ${person ? 'authenticated' : 'anon'}`);
        const params = [], conditions = [];
        for (const [field, value] of url.searchParams) {
          if (['select', 'order', 'limit', 'offset', 'columns'].includes(field)) continue;
          if (value === 'is.null' || value === 'not.is.null') conditions.push(`${ident(field)} is ${value === 'not.is.null' ? 'not ' : ''}null`);
          else if (value.startsWith('in.(')) {
            conditions.push(`${ident(field)} in (${value.slice(4, -1).split(',').map(v => {params.push(v.replace(/^"|"$/g, '')); return `$${params.length}`;}).join(',')})`);
          } else {
            const match = value.match(/^(eq|neq|ilike|gt|gte|lt|lte)\.(.*)$/s); assert.ok(match, value);
            const booleanField = ['is_super', 'este_activ', 'este_activa', 'are_chat', 'optiune_minge', 'citit'].includes(field);
            params.push(booleanField && ['true', 'false'].includes(match[2]) ? match[2] === 'true' : match[2]);
            conditions.push(`${ident(field)} ${{eq: '=', neq: '<>', ilike: 'ilike', gt: '>', gte: '>=', lt: '<', lte: '<='}[match[1]]} $${params.length}`);
          }
        }
        const where = conditions.length ? ' where ' + conditions.join(' and ') : '';
        if (request.method() === 'HEAD') {
          const total = Number((await pg.query(`select count(*) total from public.${ident(table)}${where}`, params)).rows[0].total);
          return route.fulfill({status: 200, headers: {'content-range': `*/${total}`, 'access-control-expose-headers': 'content-range'}, body: ''});
        }
        let query;
        if (request.method() === 'GET') {
          const columns = (url.searchParams.get('select') || '*').split(',').map(c => c === '*' ? '*' : ident(c)).join(',');
          query = `select ${columns} from public.${ident(table)}${where}`;
          if (url.searchParams.has('order')) query += ' order by ' + url.searchParams.get('order').split(',').map(o => {const [col, dir] = o.split('.'); return ident(col) + (dir === 'desc' ? ' desc' : ' asc');}).join(',');
          if (url.searchParams.has('limit')) { params.push(Number(url.searchParams.get('limit'))); query += ` limit $${params.length}`; }
          if (url.searchParams.has('offset')) { params.push(Number(url.searchParams.get('offset'))); query += ` offset $${params.length}`; }
        } else if (request.method() === 'PATCH') {
          const body = request.postDataJSON(); record.body = body;
          if (rejectNextPhotoMetadata && table === 'baze_sportive' && Object.hasOwn(body, 'poza')) {
            rejectNextPhotoMetadata = false; return reply(403, {code: '42501', message: 'Fixture rejected photo metadata'});
          }
          query = `update public.${ident(table)} set ${Object.entries(body).map(([key, value]) => {params.push(value); return `${ident(key)}=$${params.length}`;}).join(',')}${where} returning *`;
        } else return reply(405, {message: 'Unexpected fixture mutation'});
        const result = await pg.query(query, params);
        const single = (request.headers().accept || '').includes('vnd.pgrst.object');
        if (single && result.rows.length !== 1) return reply(406, {code: 'PGRST116', message: 'Expected exactly one row'});
        return reply(200, single ? result.rows[0] : result.rows);
      } catch (error) { return reply(403, {code: error.code || 'FIXTURE', message: error.message}); }
    });
    const launch = {executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true};
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxy) {
      const parsed = new URL(proxy); launch.proxy = {server: parsed.origin, bypass: '127.0.0.1,localhost'};
      if (parsed.username) launch.proxy.username = decodeURIComponent(parsed.username);
      if (parsed.password) launch.proxy.password = decodeURIComponent(parsed.password);
    }
    browser = await chromium.launch(launch);
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
    const sdkTag = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)"/);
    assert.ok(sdkTag, 'The application must pin the real SDK with SRI');
    // Curl inherits the managed TLS trust/proxy configuration. Verify its exact
    // bytes independently; the real page also retains browser SRI enforcement.
    const sdk = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sdkTag[1]], {maxBuffer: 2*1024*1024});
    assert.equal('sha384-'+createHash('sha384').update(sdk).digest('base64'), sdkTag[2]);
    const pageFor = async (options = {}) => {
      const context = await browser.newContext({timezoneId: 'Europe/Bucharest', ...options});
      await context.route(sdkTag[1], route => route.fulfill({status: 200, contentType: 'application/javascript', body: sdk, headers: {'access-control-allow-origin': '*'}}));
      await context.route(url => url.hostname === host || url.hostname.endsWith('.supabase.co'), api);
      await context.routeWebSocket(url => url.hostname === host || url.hostname.endsWith('.supabase.co'), ws => ws.close());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      return page;
    };
    const pass = label => {checks++; console.log('PASS', label);};
    const photoRow = id => root(async () => (await pg.query('select id,nume,oras,descriere,poza,este_activa from public.baze_sportive where id=$1', [id])).rows[0]);
    const storageRows = () => root(async () => (await pg.query('select bucket_id,name from storage.objects where bucket_id=$1 order by name', [bucket])).rows);
    const photoWrites = () => requests.filter(r => r.path.startsWith('/storage/v1/object/'+bucket) && r.method === 'POST');
    const waitPhoto = async page => {
      await page.waitForFunction(() => document.getElementById('admin-baza-photo-section').getAttribute('aria-busy') === 'false');
      await page.waitForLoadState('networkidle');
    };
    const png = readFileSync(join(__dirname, '..', '..', 'assets/imagini/avatar2.png'));
    const admin = await pageFor();
    await admin.goto(base, {waitUntil: 'networkidle'});
    await admin.locator('#btn-top-cont').click();
    await admin.locator('#login-email').fill('admin@example.test');
    await admin.locator('#login-parola').fill('fixture-password');
    await admin.locator('#btn-executa-login').click();
    await admin.locator('#modal-auth').waitFor({state: 'hidden'});
    await admin.locator('#owner-home').waitFor({state: 'visible'});
    assert.equal(await admin.locator('#base-admin-workspace').isVisible(), false);
    assert.equal(await admin.locator('#spotivity-top').isVisible(), false);
    assert.equal(await admin.locator('#spotivity-top').evaluate(node => node.inert), true);
    assert.equal(new URL(admin.url()).pathname, new URL(base).pathname);
    assert.equal(await admin.locator('#login-admin-btn').count(), 0);
    await admin.locator('#owner-home-menu-toggle').click();
    await admin.locator(`#owner-home-menu [data-owner-action="base"][data-owner-base-id="${baseA}"]`).click();
    await admin.locator('#admin-baza-form').waitFor({state: 'visible'});
    assert.equal(await admin.locator('[data-edit-base]').count(), 1);
    assert.equal(await admin.locator('[data-edit-base]').getAttribute('data-edit-base'), baseA);
    await admin.locator('#admin-baza-photo-section').waitFor({state: 'visible'});
    assert.equal(await admin.locator('#baza-nume').isDisabled(), true);
    assert.equal(await admin.locator('#admin-baza-admini-section').isVisible(), false);
    pass('ordinary admin sees photo settings only for the explicitly assigned base');

    for (const file of [{name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')},
      {name: 'wrong.jpg', mimeType: 'image/png', buffer: png}, {name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image')},
      {name: 'oversize.png', mimeType: 'image/png', buffer: Buffer.alloc(5242881)}]) {
      const count = photoWrites().length;
      await admin.locator('#baza-poza-file').setInputFiles(file);
      await admin.waitForFunction(() => document.getElementById('admin-baza-photo-status').textContent.trim().length > 0);
      assert.equal(await admin.locator('#btn-baza-poza-save').isDisabled(), true, file.name);
      assert.equal(photoWrites().length, count, file.name);
    }
    pass('SVG, mismatched extensions, undecodable files and files over 5 MiB fail before upload');

    await admin.locator('#baza-descriere').fill('Unsaved description must not be submitted by the photo button');
    await admin.locator('#baza-poza-file').setInputFiles({name: 'base.png', mimeType: 'image/png', buffer: png});
    await admin.waitForFunction(() => !document.getElementById('btn-baza-poza-save').disabled);
    assert.equal((await photoRow(baseA)).poza, null);
    assert.equal(photoWrites().length, 0);
    await admin.locator('#btn-baza-poza-save').click();
    await waitPhoto(admin);
    const firstPhoto = (await photoRow(baseA)).poza;
    assert.match(firstPhoto, new RegExp(`^${baseA}/[0-9a-f-]{36}\\.png$`));
    assert.equal(photoWrites().at(-1).status, 200);
    assert.equal(photoWrites().at(-1).person, 3);
    assert.equal(photoWrites().at(-1).mime, 'image/png');
    assert.equal(photoWrites().at(-1).size, png.length);
    assert.equal((await photoRow(baseA)).descriere, 'Descriere publică A');
    assert.equal(await admin.locator('#baza-poza-preview').evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.deepEqual(await storageRows(), [{bucket_id: bucket, name: firstPhoto}]);
    for (const width of [390, 1440]) {
      await admin.setViewportSize({width, height: width < 768 ? 844 : 1000});
      await admin.locator('#admin-baza-photo-section').scrollIntoViewIfNeeded();
      if (screenshots) await admin.screenshot({path: join(screenshots, `base-photo-admin-${width}.png`)});
      const bounds = await admin.locator('#admin-baza-photo-section').evaluate(section => {
        const box = section.getBoundingClientRect();
        return {left: box.left, right: box.right, width: innerWidth, scroll: section.scrollWidth, client: section.clientWidth};
      });
      assert.ok(bounds.left >= -1 && bounds.right <= bounds.width+1 && bounds.scroll <= bounds.client+1, JSON.stringify(bounds));
    }
    pass('assigned admin uploads a decoded image and separately saves its base-scoped path without saving an unrelated description draft');

    const forbidden = await admin.evaluate(async ({bucket, baseB, photo}) => {
      const upload = await db.storage.from(bucket).upload(baseB+'/00000000-0000-0000-0000-000000000999.png', new Blob([new Uint8Array([137,80,78,71])], {type: 'image/png'}));
      const metadata = await db.from('baze_sportive').update({poza: photo, descriere: 'Forbidden'}).eq('id', baseB).select('id');
      const structure = await db.from('baze_sportive').update({nume: 'Forbidden rename'}).eq('id', photo.split('/')[0]).select('id');
      return {uploadError: Boolean(upload.error), metadataRows: metadata.data, structureError: Boolean(structure.error)};
    }, {bucket, baseB, photo: firstPhoto});
    assert.equal(forbidden.uploadError, true);
    assert.deepEqual(forbidden.metadataRows, []);
    assert.equal(forbidden.structureError, true);
    assert.equal((await photoRow(baseB)).descriere, 'Descriere publică B');
    assert.equal((await photoRow(baseB)).poza, null);
    assert.equal((await photoRow(baseA)).nume, 'Baza A');
    pass('real Storage and table RLS reject another base upload, cross-base metadata and structural edits');

    const publicPage = await pageFor({viewport: {width: 390, height: 844}});
    await publicPage.goto(base, {waitUntil: 'networkidle'});
    const publicBaseImage = publicPage.locator(`[data-home-base-id="${baseA}"] img`);
    await publicBaseImage.scrollIntoViewIfNeeded();
    await publicBaseImage.evaluate(image => image.decode());
    assert.equal(await publicBaseImage.evaluate(image => image.naturalWidth > 0), true);
    assert.match(await publicBaseImage.getAttribute('src'), /storage\/v1\/object\/public\/poze_baze_sportive\//);
    assert.equal(await publicPage.locator(`[data-home-base-id="${hiddenBase}"]`).count(), 0);
    await publicPage.locator(`[data-home-base-id="${baseA}"]`).click();
    await publicPage.locator('#modal-baze-sportive').waitFor({state: 'visible'});
    await publicPage.locator('#modal-baze-sportive img:visible').first().evaluate(image => image.decode());
    assert.equal(await publicPage.locator('#baze-sportive-descriere').innerText(), 'Descriere publică A');
    assert.doesNotMatch(await publicPage.locator('#modal-baze-sportive').innerText(), /Private draft description/);
    await publicPage.locator('#inchide-baze-sportive').click();
    const publicAttack = await publicPage.evaluate(async ({bucket, photo, baseA}) => {
      const update = await db.from('baze_sportive').update({poza: null}).eq('id', baseA).select('id');
      const remove = await db.storage.from(bucket).remove([photo]);
      return {updateError: Boolean(update.error), updateRows: update.data, removeRows: remove.data};
    }, {bucket, photo: firstPhoto, baseA});
    assert.ok(publicAttack.updateError || publicAttack.updateRows?.length === 0);
    assert.equal((await photoRow(baseA)).poza, firstPhoto);
    assert.deepEqual(await storageRows(), [{bucket_id: bucket, name: firstPhoto}]);
    pass('public visitors see uploaded base photos and existing descriptions while hidden bases and public write attempts remain protected');

    rejectNextPhotoMetadata = true;
    await admin.locator('#baza-poza-file').setInputFiles({name: 'replacement.png', mimeType: 'image/png', buffer: png});
    await admin.waitForFunction(() => !document.getElementById('btn-baza-poza-save').disabled);
    await admin.locator('#btn-baza-poza-save').click();
    await waitPhoto(admin);
    assert.equal((await photoRow(baseA)).poza, firstPhoto);
    assert.deepEqual(await storageRows(), [{bucket_id: bucket, name: firstPhoto}]);
    assert.match(await admin.locator('#admin-baza-photo-status').innerText(), /nu|eșuat|permisi|eroare/i);
    pass('failed metadata acknowledgement preserves the existing photo and removes only the uncommitted upload');

    await admin.locator('#baza-poza-file').setInputFiles({name: 'replacement.png', mimeType: 'image/png', buffer: png});
    await admin.waitForFunction(() => !document.getElementById('btn-baza-poza-save').disabled);
    await admin.locator('#btn-baza-poza-save').click();
    await waitPhoto(admin);
    const replacement = (await photoRow(baseA)).poza;
    assert.notEqual(replacement, firstPhoto);
    assert.deepEqual(await storageRows(), [{bucket_id: bucket, name: replacement}]);
    await admin.locator('#btn-baza-poza-remove').click();
    await waitPhoto(admin);
    assert.equal((await photoRow(baseA)).poza, null);
    assert.deepEqual(await storageRows(), []);
    assert.equal((await photoRow(baseA)).descriere, 'Descriere publică A');
    assert.deepEqual(await immutableState(), beforeBusiness);
    pass('photo replacement and removal clean only their own storage objects and preserve descriptions, allocations, courts, clients and bookings');

    const homepage = await pageFor({viewport: {width: 390, height: 844}});
    await homepage.goto(base, {waitUntil: 'networkidle'});
    for (const width of [320, 390, 768, 1440]) {
      await homepage.setViewportSize({width, height: width < 768 ? 844 : 1000});
      await homepage.evaluate(() => window.scrollTo(0, 0));
      const dimensions = await homepage.evaluate(() => {
        const rect = id => {const r = document.getElementById(id).getBoundingClientRect(); return {left: r.left, right: r.right, width: r.width, height: r.height};};
        return {width: innerWidth, pageWidth: document.documentElement.scrollWidth, brand: rect('home-brand'), search: rect('home-nav-search'),
          input: rect('home-nav-search-input'), submit: rect('btn-home-search'), profile: rect('btn-top-cont'), menu: rect('btn-mobile-menu'),
          profileVisible: document.getElementById('btn-top-cont').getClientRects().length > 0};
      });
      assert.ok(dimensions.pageWidth <= width+1, JSON.stringify(dimensions));
      assert.ok(dimensions.search.left >= dimensions.brand.right+3 && dimensions.search.right <= width-8, JSON.stringify(dimensions));
      assert.ok(dimensions.input.width >= 100 && dimensions.input.height >= 40, JSON.stringify(dimensions));
      assert.ok(dimensions.submit.width >= 40 && dimensions.submit.height >= 40, JSON.stringify(dimensions));
      if (width < 768) {
        assert.equal(dimensions.profileVisible, true);
        assert.ok(dimensions.search.right <= dimensions.profile.left-3 && dimensions.profile.right <= dimensions.menu.left-3, JSON.stringify(dimensions));
        assert.ok(dimensions.profile.width >= 44 && dimensions.profile.height >= 44, JSON.stringify(dimensions));
        assert.ok(dimensions.search.left-dimensions.brand.right < 25 && dimensions.profile.left-dimensions.search.right < 25 && dimensions.menu.left-dimensions.profile.right < 25, JSON.stringify(dimensions));
      }
      await homepage.locator('#filtru-oras-global').selectOption('Reghin');
      await homepage.locator('#home-nav-search-input').fill('tenis bucuresti');
      assert.equal(await homepage.locator('#modal-cautare-terenuri').isVisible(), false);
      await homepage.locator('#home-nav-search-input').press('Enter');
      await homepage.locator('#modal-cautare-terenuri').waitFor({state: 'visible'});
      assert.equal(await homepage.locator('#home-search-input').inputValue(), 'tenis bucuresti');
      assert.deepEqual(await homepage.locator('#home-search-results [data-discovery-court] strong').allTextContents(), ['Court B']);
      await homepage.locator('#inchide-cautare-terenuri').click();
      const background = await homepage.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number));
      assert.ok(background.every(channel => channel < 70), `The homepage must retain its dark theme: ${background}`);
      if (screenshots) await homepage.screenshot({path: join(screenshots, `discovery-header-dark-${width}.png`)});
      pass(`header contains a usable search field at ${width}px and submits global city/sport queries with Enter`);
    }

    await homepage.setViewportSize({width: 390, height: 844});
    await homepage.locator('#btn-top-cont').click();
    await homepage.locator('#modal-auth').waitFor({state: 'visible'});
    await homepage.locator('#inchide-auth').click();
    await homepage.locator('#btn-mobile-menu').click();
    await homepage.locator('#home-mobile-menu [data-profile-target]').click();
    await homepage.locator('#modal-auth').waitFor({state: 'visible'});
    await homepage.locator('#inchide-auth').click();
    pass('mobile profile opens from both the header icon and the first drawer entry');

    const strip = homepage.locator('[data-home-courts="Fotbal"]');
    const visualPosition = () => strip.evaluate(node => node.getBoundingClientRect().left
      - node.querySelector('[data-discovery-court]').getBoundingClientRect().left);
    const waitMoving = start => homepage.waitForFunction(start => {
      const node = document.querySelector('[data-home-courts="Fotbal"]');
      return node.getBoundingClientRect().left-node.querySelector('[data-discovery-court]').getBoundingClientRect().left > start+4;
    }, start, {timeout: 12000});
    await strip.scrollIntoViewIfNeeded();
    await homepage.mouse.move(0, 0);
    assert.equal(await homepage.locator('[data-home-motion-toggle],.home-courts-motion-toggle').count(), 0,
      'The removed pause/resume buttons must not remain hidden in the DOM');
    assert.equal(await strip.locator('[data-discovery-court]').count(), 9, 'Autoplay must never duplicate cards or booking buttons');
    await waitMoving(await visualPosition());
    const framePositions = await strip.evaluate(node => new Promise(resolve => {
      const positions = [];
      const sample = () => {
        positions.push(node.querySelector('[data-discovery-court]').getBoundingClientRect().left);
        if (positions.length === 30) resolve(positions);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const steps = framePositions.slice(1).map((position, index) => Math.abs(position-framePositions[index]));
    assert.ok(steps.filter(step => step > .025 && Math.abs(step-Math.round(step)) > .025).length >= 6,
      `Slow autoplay must render actual fractional-pixel movement: ${JSON.stringify(steps)}`);

    await strip.hover();
    await homepage.waitForFunction(() => document.querySelector('[data-home-courts="Fotbal"]').dataset.autoScroll === 'paused');
    const hoveredPosition = await visualPosition();
    await homepage.waitForTimeout(400);
    assert.ok(Math.abs(await visualPosition()-hoveredPosition) < 1, 'Cards must stay still under the pointer');
    await strip.locator('[data-discovery-court]').first().focus();
    await homepage.mouse.move(0, 0);
    const focusedPosition = await visualPosition();
    await homepage.waitForTimeout(400);
    assert.ok(Math.abs(await visualPosition()-focusedPosition) < 1, 'Keyboard focus must keep its card still after hover ends');
    await strip.locator('[data-discovery-court]').first().evaluate(node => node.blur());
    await waitMoving(await visualPosition());

    await strip.hover();
    await homepage.mouse.wheel(250, 0);
    await homepage.mouse.move(0, 0);
    await homepage.waitForFunction(() => document.querySelector('[data-home-courts="Fotbal"]').dataset.autoScroll === 'paused');
    await homepage.waitForTimeout(250); // Allow the native wheel gesture to settle before measuring its grace period.
    const manualPosition = await visualPosition();
    await homepage.waitForTimeout(4500);
    assert.ok(Math.abs(await visualPosition()-manualPosition) < 1, 'Autoplay must leave time to read after manual scrolling');
    await waitMoving(manualPosition);

    // Dispatch trusted touch input through Chromium, rather than synthesizing
    // DOM events, so the browser's native horizontal gesture still works.
    const touch = await homepage.context().newCDPSession(homepage);
    await touch.send('Emulation.setTouchEmulationEnabled', {enabled: true});
    const bounds = await strip.boundingBox();
    const point = {x: bounds.x+Math.min(250, bounds.width-25), y: bounds.y+Math.min(100, bounds.height/2)};
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
    await homepage.waitForFunction(() => document.querySelector('[data-home-courts="Fotbal"]').dataset.autoScroll === 'paused');
    const heldPosition = await visualPosition();
    await homepage.waitForTimeout(350);
    assert.ok(Math.abs(await visualPosition()-heldPosition) < 1, 'Touch must stop autoplay before the drag');
    await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: point.x-100, y: point.y}]});
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await touch.send('Emulation.setTouchEmulationEnabled', {enabled: false});
    await touch.detach();
    assert.equal(await homepage.locator('#modal-rezervare').isVisible(), false, 'A horizontal touch drag must not open a booking');
    pass('cards move in fractional pixels without clones or controls, pause for hover/focus/touch/manual scrolling and resume after the interaction grace period');

    await homepage.locator('#home-nav-search-input').fill('Court');
    await homepage.locator('#btn-home-search').click();
    await homepage.locator('#modal-cautare-terenuri').waitFor({state: 'visible'});
    await homepage.waitForFunction(() => document.querySelector('[data-home-courts="Fotbal"]').dataset.autoScroll === 'paused');
    const modalScroll = await visualPosition();
    await homepage.waitForTimeout(400);
    assert.ok(Math.abs(await visualPosition()-modalScroll) < 1);
    await homepage.locator('#inchide-cautare-terenuri').click();
    await homepage.emulateMedia({reducedMotion: 'reduce'});
    await homepage.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches
      && document.querySelector('[data-home-courts="Fotbal"]').dataset.autoScroll === 'idle');
    assert.equal(await homepage.locator('[data-home-motion-toggle],.home-courts-motion-toggle').count(), 0);
    const reducedScroll = await strip.evaluate(node => node.scrollLeft);
    await homepage.waitForTimeout(400);
    assert.ok(Math.abs(await strip.evaluate(node => node.scrollLeft)-reducedScroll) < 1);
    // Native snap can legitimately return a tiny movement to the same card.
    // A full horizontal wheel gesture must still reach the next card.
    await strip.hover();
    await homepage.mouse.wheel(300, 0);
    await homepage.waitForFunction(start => document.querySelector('[data-home-courts="Fotbal"]').scrollLeft > start+10,
      reducedScroll, {timeout: 5000});
    await homepage.emulateMedia({reducedMotion: 'no-preference'});
    await homepage.waitForFunction(() => !matchMedia('(prefers-reduced-motion: reduce)').matches
      && document.querySelector('[data-home-courts="Fotbal"]').dataset.autoScroll !== 'idle');
    pass('autoplay stops behind dialogs and respects live reduced-motion changes while preserving manual scrolling');

    await homepage.locator('#home-nav-search-input').fill('Court B');
    await homepage.locator('#btn-home-search').click();
    await homepage.locator('#modal-cautare-terenuri').waitFor({state: 'visible'});
    assert.equal(await homepage.locator('#home-search-input').inputValue(), 'Court B', 'Clicking the header search button must submit the current query');
    await homepage.locator('#home-search-results [data-discovery-court]').filter({has: homepage.getByText('Court B', {exact: true})}).click();
    await homepage.locator('#modal-rezervare').waitFor({state: 'visible'});
    assert.match(await homepage.locator('#rezervare-teren-selectat').innerText(), /Court B/);
    await homepage.locator('#container-zile .btn-zi').nth(1).click();
    await homepage.locator('#container-ore .btn-ora:not(:disabled)').first().click();
    await homepage.waitForFunction(() => !document.getElementById('buton-confirma').disabled);
    for (const width of [390, 1440]) {
      await homepage.setViewportSize({width, height: width < 768 ? 844 : 1000});
      await homepage.locator('#buton-confirma').scrollIntoViewIfNeeded();
      if (screenshots) await homepage.screenshot({path: join(screenshots, `booking-confirm-dark-${width}.png`), animations: 'disabled'});
    }
    await homepage.locator('#inchide-rezervare').click();
    assert.deepEqual(await immutableState(), beforeBusiness);
    pass('global search still opens the existing court reservation, available day/hour selection and confirmation button without a booking write');

    await homepage.setViewportSize({width: 390, height: 844});
    await homepage.evaluate(async () => {
      const {error} = await db.auth.signInWithPassword({email: 'alice@example.test', password: 'fixture-password'});
      if (error) throw error;
    });
    await homepage.waitForFunction(() => window.getSpotivityProfileUser()?.email === 'alice@example.test');
    await homepage.locator('#btn-mobile-menu').click();
    await homepage.locator('#home-mobile-menu [data-profile-target]').click();
    await homepage.locator('#btn-editeaza-profil').click();
    await homepage.locator('#profil-edit-nume').fill('Alice Preview');
    await homepage.locator('#btn-profil-continua').click();
    await homepage.locator('#profil-edit-review').waitFor({state: 'visible'});
    assert.equal(await homepage.locator('#btn-profil-confirma').isEnabled(), true);
    for (const width of [390, 1440]) {
      await homepage.setViewportSize({width, height: width < 768 ? 844 : 1000});
      await homepage.locator('#btn-profil-confirma').scrollIntoViewIfNeeded();
      if (screenshots) await homepage.screenshot({path: join(screenshots, `profile-confirm-dark-${width}.png`), animations: 'disabled'});
      const appearance = await homepage.locator('#btn-profil-confirma').evaluate(button => {
        const style = getComputedStyle(button), panel = getComputedStyle(button.closest('.modal-continut'));
        const luminance = text => text.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
          const s = channel/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4;
        }).reduce((sum, value, index) => sum+value*[.2126, .7152, .0722][index], 0);
        const foreground = luminance(style.color);
        const colors = style.backgroundImage === 'none' ? [style.backgroundColor] : (style.backgroundImage.match(/rgba?\([^)]*\)/g) || []);
        return {panel: luminance(panel.backgroundColor), opacity: style.opacity, contrast: colors.map(color => {
          const background = luminance(color); return (Math.max(foreground, background)+.05)/(Math.min(foreground, background)+.05);
        })};
      });
      assert.ok(appearance.panel < .15, JSON.stringify(appearance));
      assert.equal(appearance.opacity, '1');
      assert.ok(appearance.contrast.length > 0 && appearance.contrast.every(value => value >= 4.5), JSON.stringify(appearance));
    }
    await homepage.locator('#btn-profil-anuleaza').click();
    assert.deepEqual(await immutableState(), beforeBusiness);
    pass('the profile confirmation remains readable on dark/gold mobile/desktop dialogs and cancelling leaves the profile unchanged');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(`Discovery media browser checks passed: ${checks}`);
  } finally {
    if (browser) await browser.close();
    await pg.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
