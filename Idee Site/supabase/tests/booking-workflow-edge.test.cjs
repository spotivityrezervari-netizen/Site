const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const factory = import(pathToFileURL(path.join(__dirname, '../functions/booking-workflow/handler.ts')).href);
const tokens = import(pathToFileURL(path.join(__dirname, '../functions/_shared/booking-token.ts')).href);
const BOOKING = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER = 'bbbbbbbb-2222-4222-8222-222222222222';
const COURT = 'cccccccc-3333-4333-8333-333333333333';
const SECRET = 'server-service-role-never-exposed';
const CANCEL_SECRET = 'independent-stable-cancellation-secret';
const TOKEN = 'user-access-jwt-validated-by-auth';
const RAW = createHmac('sha256', CANCEL_SECRET).update(`spotivity-booking-cancel:v1:${BOOKING}`).digest('hex');
const HASH = createHash('sha256').update(RAW).digest('hex');
const RESULT = { booking_id: BOOKING, reservation_ids: ['1', '2'], court_id: '10', court_name: 'Teren principal', sport: 'Fotbal', day: '2026-10-25', hours: ['14:00', '15:00'], total: 215, state: 'activa' };
const ORIGIN = 'https://spotivityrezervari-netizen.github.io';
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function createInput(overrides = {}) { return { action: 'create_guest', request_id: BOOKING, court_id: '10', day: '2026-10-25', hours: ['14:00', '15:00'], with_ball: true, contact_name: 'Ion Popescu', email: 'client@example.test', phone: '+40 721 123 456', ...overrides }; }
function request(input = createInput(), authorization, headers = {}) {
  return new Request('https://edge.test/booking-workflow', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}), ...headers }, body: JSON.stringify(input) });
}
async function fixture(overrides = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const endpoint = new URL(url); const headers = new Headers(options.headers);
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    const call = { path: endpoint.pathname, method: options.method ?? 'GET', headers, body, signal: options.signal };
    calls.push(call);
    if (overrides.fetch) { const response = await overrides.fetch(call, calls); if (response !== undefined) return response; }
    if (call.path === '/auth/v1/user') return json({ id: USER, email: 'authenticated@example.test' });
    if (call.path.endsWith('/booking_notification_status')) return json({ ready: true });
    if (call.path.endsWith('/create_booking_group') || call.path.endsWith('/create_guest_booking_group')) return json(RESULT);
    if (call.path.endsWith('/attach_cancellation_token')) return json(true);
    if (call.path.endsWith('/preview_booking_cancellation')) return json({ ...RESULT, cancellable_hours: ['14:00', '15:00'], can_cancel: true });
    if (call.path.endsWith('/cancel_booking_group_by_token') || call.path.endsWith('/cancel_owned_booking_group')) return json({ ...RESULT, state: 'anulata', cancelled_count: 2 });
    if (call.path === '/functions/v1/booking-notifications') return json({ status: 'submitted', submitted: 2 });
    assert.fail(`Unexpected transport: ${call.method} ${url}`);
  };
  const { createHandler } = await factory;
  return { calls, handler: createHandler({ url: 'https://project.supabase.co', anonKey: 'anon-key-public', serviceKey: SECRET, cancelSecret: CANCEL_SECRET, ...overrides.config }, { fetch, now: () => 1800000000000 }) };
}

test('cancellation HMAC is versioned, deterministic, booking-specific and stored only as SHA256 digest', async () => {
  const { deriveBookingCancellationToken, hashCancellationToken } = await tokens;
  assert.equal(await deriveBookingCancellationToken(CANCEL_SECRET, BOOKING), RAW);
  assert.equal(await deriveBookingCancellationToken(CANCEL_SECRET, BOOKING.toUpperCase()), RAW);
  assert.equal(await hashCancellationToken(RAW), HASH);
  assert.notEqual(await deriveBookingCancellationToken('another-server-secret', BOOKING), RAW);
  assert.notEqual(await deriveBookingCancellationToken(CANCEL_SECRET, USER), RAW);
  await assert.rejects(() => deriveBookingCancellationToken('', BOOKING), TypeError);
  await assert.rejects(() => deriveBookingCancellationToken(SECRET, 'not-an-id'), TypeError);
  await assert.rejects(() => hashCancellationToken('short'), TypeError);
});

test('guest booking never creates/signs into an Auth account and never returns contact/token/service credentials', async () => {
  const { calls, handler } = await fixture();
  const response = await handler(request()); const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body, { ...RESULT, notification_status: 'submitted' });
  assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/booking_notification_status', '/rest/v1/rpc/create_guest_booking_group', '/rest/v1/rpc/attach_cancellation_token', '/functions/v1/booking-notifications']);
  const create = calls[1];
  assert.deepEqual(create.body, { p_request_id: BOOKING, p_court_id: '10', p_day: '2026-10-25', p_hours: ['14:00', '15:00'], p_with_ball: true, p_contact_name: 'Ion Popescu', p_email: 'client@example.test', p_phone: '+40 721 123 456' });
  assert.equal(create.headers.get('authorization'), `Bearer ${SECRET}`);
  assert.deepEqual(calls[2].body, { p_booking_id: BOOKING, p_token_hash: HASH });
  assert.deepEqual(calls[3].body, { action: 'dispatch', booking_id: BOOKING });
  const serialized = JSON.stringify(body);
  for (const privateValue of [SECRET, RAW, HASH, 'client@example.test', 'Ion Popescu', '+40 721 123 456']) assert.ok(!serialized.includes(privateValue));
  assert.ok(calls.every(call => call.signal instanceof AbortSignal));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('authenticated creation verifies actual Auth user and preserves its JWT for SQL ownership checks', async () => {
  const { calls, handler } = await fixture();
  const response = await handler(request(createInput({ action: 'create', court_id: COURT, hours: ['15:00', '14:00'], email: 'forged@example.test', contact_name: 'forged', phone: '123456789' }), TOKEN));
  assert.equal(response.status, 201);
  assert.equal(calls[0].path, '/auth/v1/user');
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  const create = calls.find(call => call.path.endsWith('/create_booking_group'));
  assert.equal(create.headers.get('apikey'), 'anon-key-public');
  assert.equal(create.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.deepEqual(create.body, { p_request_id: BOOKING, p_court_id: COURT, p_day: '2026-10-25', p_hours: ['14:00', '15:00'], p_with_ball: true });
  assert.ok(!calls.some(call => call.path.endsWith('/booking_notification_status')));
});

test('missing/revoked/service-role credentials cannot impersonate an authenticated booking owner', async t => {
  for (const credential of [undefined, 'short', SECRET, 'anon-key-public']) await t.test(String(credential), async () => {
    const { handler, calls } = await fixture(); const response = await handler(request(createInput({ action: 'create' }), credential));
    assert.equal(response.status, 401); assert.equal((await response.json()).code, 'unauthenticated'); assert.equal(calls.length, 0);
  });
  const { handler, calls } = await fixture({ fetch: call => call.path === '/auth/v1/user' ? json({ error: 'jwt expired' }, 401) : undefined });
  assert.equal((await handler(request(createInput({ action: 'create' }), TOKEN))).status, 401);
  assert.equal(calls.length, 1);
});

test('missing notification configuration blocks guest creation before any mutation', async t => {
  const cases = [json({ ready: false }), json({ ready: 'true' }), json({ message: 'private configuration detail' }, 503)];
  for (let index = 0; index < cases.length; index++) await t.test(String(index), async () => {
    const { handler, calls } = await fixture({ fetch: call => call.path.endsWith('/booking_notification_status') ? cases[index] : undefined });
    const response = await handler(request());
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'guest_unavailable');
    assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/booking_notification_status']);
  });
});

test('missing independent cancellation secret blocks creation before writes, while existing email links still work', async () => {
  const { handler, calls } = await fixture({ config: { cancelSecret: '' } });
  assert.equal((await handler(request())).status, 503); assert.equal(calls.length, 0);
  const preview = await handler(request({ action: 'preview_cancel', booking_id: BOOKING, token: RAW }));
  assert.equal(preview.status, 200); assert.equal(calls.length, 1);
});

test('service-role credential rotation does not change the cancellation token digest', async () => {
  const rotated = 'rotated-service-role-server-key';
  const { handler, calls } = await fixture({ config: { serviceKey: rotated } });
  assert.equal((await handler(request())).status, 201);
  const attachment = calls.find(call => call.path.endsWith('/attach_cancellation_token'));
  assert.equal(attachment.headers.get('authorization'), `Bearer ${rotated}`);
  assert.equal(attachment.body.p_token_hash, HASH);
});

test('invalid guest fields, invalid calendar dates, password and nonconsecutive hours fail before any service call', async t => {
  const cases = [
    ['password', { password: 'do-not-create-an-account' }, 'invalid_input'],
    ['missing contact', { contact_name: '' }, 'invalid_input'],
    ['email', { email: 'malformed' }, 'invalid_input'],
    ['email control injection', { email: 'a@example.test\r\nCC:b@example.test' }, 'invalid_input'],
    ['phone too short', { phone: '12345' }, 'invalid_input'],
    ['phone alpha', { phone: 'seven1234567' }, 'invalid_input'],
    ['court injection', { court_id: '1&select=*' }, 'invalid_input'],
    ['court number type', { court_id: 10 }, 'invalid_input'],
    ['request UUID', { request_id: 'random' }, 'invalid_input'],
    ['invalid date', { day: '2026-02-30' }, 'invalid_input'],
    ['boolean required', { with_ball: 'false' }, 'invalid_input'],
    ['hour gaps', { hours: ['14:00', '16:00'] }, 'invalid_hours'],
    ['hour duplicates', { hours: ['14:00', '14:00'] }, 'invalid_hours'],
    ['midnight wrap', { hours: ['22:00', '00:00'] }, 'invalid_hours'],
    ['subhour', { hours: ['14:30'] }, 'invalid_hours'],
    ['empty hours', { hours: [] }, 'invalid_hours'],
  ];
  for (const [label, value, expected] of cases) await t.test(label, async () => {
    const { calls, handler } = await fixture(); const response = await handler(request(createInput(value)));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, expected); assert.equal(calls.length, 0);
  });
});

test('actual streamed body limit applies without a content-length header', async () => {
  const { handler, calls } = await fixture();
  const oversized = new Request('https://edge.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32769)); controller.close(); } }), duplex: 'half' });
  assert.equal((await handler(oversized)).status, 413); assert.equal(calls.length, 0);
});

test('malformed JSON, arrays and non-JSON requests cause no writes', async () => {
  const { handler, calls } = await fixture();
  for (const [body, type] of [['{broken', 'application/json'], ['[]', 'application/json'], ['{}', 'text/plain']]) {
    const response = await handler(new Request('https://edge.test', { method: 'POST', headers: { 'Content-Type': type }, body }));
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('IP throttling blocks the eleventh guest attempt, with SQL still enforcing durable per-contact quota', async () => {
  const { handler, calls } = await fixture();
  for (let index = 0; index < 10; index++) assert.equal((await handler(request())).status, 201);
  const count = calls.length; const response = await handler(request());
  assert.equal(response.status, 429); assert.equal((await response.json()).code, 'rate_limit'); assert.equal(calls.length, count);
});

test('SQL errors map to stable safe codes without exposing constraints, contact details or SQL text', async t => {
  const cases = [
    ['23505', 'Only one active booking per sport and day is allowed, in all cities.', 'booking_limit', 409],
    ['23505', 'Booking request identifier was already used.', 'conflict', 409],
    ['23505', 'duplicate key value violates unique constraint rezervari_teren_ora', 'slot_unavailable', 409],
    ['22023', 'Court, date, hours or ball option are unavailable.', 'slot_unavailable', 409],
    ['22023', 'Choose consecutive hours on the same court.', 'invalid_hours', 400],
    ['P0001', 'Guest booking rate limit reached. Try again later.', 'rate_limit', 429],
    ['42501', 'A confirmed account is required.', 'unauthenticated', 401],
    ['42501', 'Completed bookings cannot be cancelled.', 'completed_booking', 409],
    ['42501', 'Invalid cancellation link.', 'invalid_cancellation', 403],
  ];
  for (const [code, message, expected, status] of cases) await t.test(expected, async () => {
    const { handler, calls } = await fixture({ fetch: call => call.path.endsWith('/create_guest_booking_group') ? json({ code, message, details: 'secret-query client@example.test', hint: SECRET }, 400) : undefined });
    const response = await handler(request()); const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, expected);
    assert.ok(!JSON.stringify(body).includes(SECRET)); assert.ok(!JSON.stringify(body).includes('secret-query')); assert.ok(!JSON.stringify(body).includes('client@example.test'));
    assert.ok(!calls.some(call => call.path.endsWith('/attach_cancellation_token') || call.path.includes('/functions/')));
  });
});

test('committed creation remains successful if token attachment or mail transport fails', async t => {
  for (const failPath of ['/rest/v1/rpc/attach_cancellation_token', '/functions/v1/booking-notifications']) await t.test(failPath, async () => {
    const { handler, calls } = await fixture({ fetch: call => { if (call.path === failPath) throw new TypeError('transport lost'); } });
    const response = await handler(request()); const body = await response.json();
    assert.equal(response.status, 201); assert.equal(body.booking_id, BOOKING); assert.equal(body.notification_status, 'queued');
    assert.equal(calls.filter(call => call.path.endsWith('/create_guest_booking_group')).length, 1);
  });
});

test('worker configuration status never gets mislabeled as an email delivery confirmation', async () => {
  const { handler } = await fixture({ fetch: call => call.path.includes('/functions/') ? json({ status: 'pending_configuration' }) : undefined });
  const body = await (await handler(request())).json();
  assert.equal(body.notification_status, 'pending_configuration'); assert.equal(body.email_sent, undefined);
});

test('same stable request UUID is passed through unchanged on retry and canceled state is never resurrected', async () => {
  let creates = 0;
  const { handler, calls } = await fixture({ fetch: call => {
    if (call.path.endsWith('/create_guest_booking_group')) return json({ ...RESULT, state: ++creates === 1 ? 'activa' : 'anulata' });
  } });
  assert.equal((await (await handler(request())).json()).state, 'activa');
  assert.equal((await (await handler(request())).json()).state, 'anulata');
  assert.deepEqual(calls.filter(call => call.path.endsWith('/create_guest_booking_group')).map(call => call.body.p_request_id), [BOOKING, BOOKING]);
});

test('cancellation preview hashes token, exposes only safe details and does not mutate or notify', async () => {
  const { handler, calls } = await fixture({ fetch: call => call.path.endsWith('/preview_booking_cancellation') ? json({ ...RESULT, cancellable_hours: ['15:00'], email: 'private@example.test', phone: '0712345678', owner_auth_id: USER, token_hash: HASH }) : undefined });
  const response = await handler(request({ action: 'preview_cancel', booking_id: BOOKING, token: RAW }));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.can_cancel, true); assert.deepEqual(body.cancellable_hours, ['15:00']);
  assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/preview_booking_cancellation']);
  assert.deepEqual(calls[0].body, { p_booking_id: BOOKING, p_token_hash: HASH });
  for (const key of ['email', 'phone', 'owner_auth_id', 'token_hash', 'token']) assert.equal(body[key], undefined);
});

test('email cancellation needs explicit POST and valid opaque token; token-based RPC uses service scope', async () => {
  const { handler, calls } = await fixture();
  const read = await handler(new Request(`https://edge.test/booking-workflow?booking_id=${BOOKING}&token=${RAW}`));
  assert.equal(read.status, 405); assert.equal(calls.length, 0);
  const invalid = await handler(request({ action: 'cancel', booking_id: BOOKING, token: 'wrong' }));
  assert.equal(invalid.status, 403); assert.equal(calls.length, 0);
  const response = await handler(request({ action: 'cancel', booking_id: BOOKING, token: RAW }));
  assert.equal(response.status, 200); assert.equal((await response.json()).state, 'anulata');
  assert.equal(calls[0].path, '/rest/v1/rpc/cancel_booking_group_by_token');
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${SECRET}`);
  assert.deepEqual(calls[0].body, { p_booking_id: BOOKING, p_token_hash: HASH });
  assert.equal(calls[1].path, '/functions/v1/booking-notifications');
});

test('owned cancellation checks actual user JWT and never substitutes service-role ownership', async () => {
  const { handler, calls } = await fixture();
  const response = await handler(request({ action: 'cancel_owned', booking_id: BOOKING }, TOKEN));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.slice(0, 2).map(call => call.path), ['/auth/v1/user', '/rest/v1/rpc/cancel_owned_booking_group']);
  assert.equal(calls[1].headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.deepEqual(calls[1].body, { p_booking_id: BOOKING });
});

test('completed cancellation is rejected and does not enqueue another notification', async () => {
  const { handler, calls } = await fixture({ fetch: call => call.path.endsWith('/cancel_booking_group_by_token') ? json({ code: '42501', message: 'Completed bookings cannot be cancelled.' }, 403) : undefined });
  const response = await handler(request({ action: 'cancel', booking_id: BOOKING, token: RAW }));
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'completed_booking'); assert.equal(calls.length, 1);
});

test('CORS permits only production and local development; preflight never touches upstream', async () => {
  const { handler, calls } = await fixture();
  const accepted = await handler(new Request('https://edge.test', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8123' } }));
  assert.equal(accepted.status, 204); assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8123');
  const rejected = await handler(request(createInput(), undefined, { Origin: 'https://spotivityrezervari-netizen.github.io.evil.test' }));
  assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null); assert.equal(calls.length, 0);
});
