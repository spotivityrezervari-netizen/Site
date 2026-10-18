// Disposable transport adapter for the real booking Edge handlers and PostgreSQL
// RPCs. Auth lookups and Make delivery stay local; no hosted request is allowed.
const assert = require('node:assert/strict');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');

const ident = value => { assert.match(value, /^[a-z_][a-z_0-9]*$/); return `"${value}"`; };
const serviceKey = 'fixture-booking-server-service-key';
const anonKey = 'fixture-booking-public-anon-key';
const cancelSecret = 'fixture-booking-stable-cancellation-secret';
const makeURL = 'https://hook.eu2.make.com/fixturebookingmail12345';
const reply = (status, data) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});

async function createBookingWorkflowFixture({pg, host, resolveUser, records = []}) {
  const {createHandler} = await import(pathToFileURL(join(__dirname, '../functions/booking-workflow/handler.ts')).href);
  const signatures = new Map();
  const mail = [];
  let notificationHandler;
  const transport = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
    if (request.url === makeURL) {
      // The actual notification worker constructs the message; replace only the
      // external Make delivery transport. Never print its private payload.
      mail.push(await request.json());
      return reply(200, {accepted: true});
    }
    assert.equal(url.hostname, host, 'A booking fixture may not reach hosted services');
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer /i, '');
    const service = bearer === serviceKey;
    const subject = service ? null : resolveUser(bearer);
    const record = {source: 'booking-edge', path: url.pathname, method: request.method, service, userId: subject, status: null};
    records.push(record);
    const response = (status, value) => {record.status = status; return reply(status, value);};
    try {
      await pg.exec('reset role');
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [subject || '']);
      if (url.pathname === '/auth/v1/user') {
        if (!subject) return response(401, {code: 'bad_jwt', message: 'Invalid fixture session'});
        const user = (await pg.query('select * from auth.users where id=$1', [subject])).rows[0];
        return user ? response(200, {...user, user_metadata: user.raw_user_meta_data}) : response(401, {message: 'Unknown fixture user'});
      }
      if (url.pathname === '/functions/v1/booking-notifications') {
        assert.equal(service, true, 'Only the service may dispatch notifications');
        if (!notificationHandler) {
          const worker = await import(pathToFileURL(join(__dirname, '../functions/booking-notifications/handler.ts')).href);
          notificationHandler = worker.createHandler({url: `https://${host}`, anonKey, serviceKey, cancellationSecret: cancelSecret}, {fetch: transport});
        }
        return notificationHandler(request);
      }
      assert.ok(url.pathname.startsWith('/rest/v1/rpc/'), `Unexpected booking Edge path ${url.pathname}`);
      const name = url.pathname.split('/').pop();
      assert.ok(['create_booking_group', 'create_guest_booking_group', 'attach_cancellation_token',
        'get_booking_notification_config', 'booking_notification_status', 'claim_booking_notifications',
        'finish_booking_notification', 'get_booking_group_delivery', 'preview_booking_cancellation',
        'cancel_booking_group_by_token', 'cancel_owned_booking_group'].includes(name), name);
      if (!signatures.has(name)) {
        const signature = (await pg.query(`select p.proargnames names,p.proretset returns_set,
          array(select format_type(t,null) from unnest(p.proargtypes) t) types
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname=$1`, [name])).rows;
        assert.equal(signature.length, 1, `Exactly one SQL signature is required for ${name}`);
        const fields = new Map((signature[0].names || []).map((key, index) => [key, signature[0].types[index]]));
        fields.returnsSet = signature[0].returns_set;
        signatures.set(name, fields);
      }
      const body = await request.json(), fields = Object.keys(body), signature = signatures.get(name);
      for (const field of fields) {assert.match(field, /^p_[a-z_]+$/); assert.ok(signature.has(field), field);}
      await pg.exec(`set role ${service ? 'service_role' : subject ? 'authenticated' : 'anon'}`);
      const result = await pg.query(`select public.${ident(name)}(${fields.map((key, index) =>
        `${ident(key)} => $${index + 1}::${signature.get(key)}`).join(',')}) value`, fields.map(key => body[key]));
      return response(200, signature.returnsSet ? result.rows.map(row => row.value) : result.rows[0].value);
    } catch (error) {
      record.code = error.code;
      return response(error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400,
        {code: error.code || 'FIXTURE', message: error.message});
    }
  };
  await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
  await pg.query('select public.configure_booking_notifications($1,$1,true)', [makeURL]);
  const handler = createHandler({url: `https://${host}`, anonKey, serviceKey, cancelSecret}, {fetch: transport});
  return {handler, transport, mail, async browserRoute(route) {
    const req = route.request();
    const response = await handler(new Request(req.url(), {method: req.method(), headers: req.headers(),
      ...(['GET', 'HEAD'].includes(req.method()) ? {} : {body: req.postDataBuffer()})}));
    if (!req.failure()) await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer())});
  }};
}
module.exports = {createBookingWorkflowFixture};
