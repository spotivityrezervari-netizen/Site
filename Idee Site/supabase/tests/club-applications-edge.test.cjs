const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const factory = import(pathToFileURL(path.join(__dirname, '../functions/club-applications/handler.ts')).href);
const APP = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER = 'bbbbbbbb-2222-4222-8222-222222222222';
const SUPER = 'cccccccc-3333-4333-8333-333333333333';
const BASE = 'dddddddd-4444-4444-8444-444444444444';
const SECRET = 'supabase-service-role-never-public';
const PASSWORD = 'a-private-password';
const TOKEN = 'real-user-access-token-verified-by-auth';
const TIME = Date.parse('2026-10-17T12:00:00Z');
const PNG = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,1]);
const PRIVATE = `${USER}/${APP}/${APP}.png`;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function input(overrides = {}) { return { action: 'submit', request_id: APP, nume_baza: 'Baza nouă', nume_contact: 'Nume Contact', email: 'owner@example.test', telefon: '+40 721 123 456', oras: 'Cluj-Napoca', adresa: 'Strada Sportului 10', link_maps: 'https://maps.app.goo.gl/Abc123', terenuri: [{ nume: 'Teren unu', sport: 'Fotbal' }, { nume: 'Teren doi', sport: 'Tenis Picior' }], prices: [100, 80], descriere: 'O bază pentru sport.\nDouă terenuri.', password: PASSWORD, ...overrides }; }
function submission(data = input(), photo) {
  const form = new FormData(); form.set('payload', JSON.stringify(data));
  if (photo) form.set('photo', photo);
  return new Request('https://edge.example.test/club-applications', { method: 'POST', headers: { Origin: 'https://spotivityrezervari-netizen.github.io' }, body: form });
}
function review(action = 'approve', overrides = {}, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json', Origin: 'https://spotivityrezervari-netizen.github.io' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('https://edge.example.test/club-applications', { method: 'POST', headers, body: JSON.stringify({ action, request_id: APP, prices: [100,80], expected_updated_at: '2026-10-17T11:00:00Z', note: 'Verificat', ...overrides }) });
}
async function fixture(overrides = {}) {
  const calls = [];
  let activePhoto = null;
  const user = { id: USER, email: 'owner@example.test', created_at: '2026-10-17T12:00:00Z', email_confirmed_at: '2026-10-17T12:00:00Z', identities: [{ user_id: USER }] };
  const row = { id: APP, solicitant_user_id: USER, stare: 'noua', poza_path: PRIVATE, reserved_base_id: BASE, approved_base_id: null, terenuri: input().terenuri, ...overrides.row };
  const fetch = async (url, options = {}) => {
    const endpoint = new URL(url); const headers = new Headers(options.headers); const method = options.method ?? 'GET';
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    const call = { path: endpoint.pathname, search: endpoint.search, method, headers, body };
    calls.push(call);
    if (overrides.fetch) { const response = await overrides.fetch(call, calls); if (response !== undefined) return response; }
    if (endpoint.pathname === '/auth/v1/token') return json({ user, access_token: 'never-return-this-token', refresh_token: 'never-return-refresh' });
    if (endpoint.pathname === '/auth/v1/signup') return json({ user });
    if (endpoint.pathname === `/auth/v1/admin/users/${USER}`) return json(user);
    if (endpoint.pathname === '/auth/v1/user') return json({ id: SUPER, email: 'super@example.test', user_metadata: { is_super: true } });
    if (endpoint.pathname === '/rest/v1/users_admin') return json([{ user_id: SUPER, is_super: true }]);
    if (endpoint.pathname === '/rest/v1/cereri_baze_sportive') return json([row]);
    if (endpoint.pathname === '/rest/v1/baze_sportive') return json(endpoint.searchParams.get('poza') === `eq.${activePhoto}` ? [{ id: BASE }] : []);
    if (endpoint.pathname === '/rest/v1/rpc/submit_club_application') return json(APP);
    if (endpoint.pathname === '/rest/v1/rpc/approve_club_request') { activePhoto = body.p_photo_path; return json({ request_id: APP, base_id: BASE, court_ids: [1,2], status: 'acceptata' }); }
    if (endpoint.pathname === '/rest/v1/rpc/reject_club_request') return json({ request_id: APP, status: 'respinsa' });
    if (endpoint.pathname === '/storage/v1/object/copy') return json({ Key: `${PUBLIC_BUCKET}/${body.destinationKey}` });
    if (endpoint.pathname.startsWith('/storage/v1/object/') && method === 'GET') return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
    if (endpoint.pathname.startsWith('/storage/v1/object/') && ['POST','DELETE'].includes(method)) return json({ Key: PRIVATE });
    assert.fail(`Unexpected upstream call: ${method} ${url}`);
  };
  const { createHandler } = await factory;
  return { handler: createHandler({ url: 'https://project.supabase.co', anonKey: 'anon-public-key', serviceKey: SECRET }, { fetch, now: () => TIME }), calls, user, row };
}
const PUBLIC_BUCKET = 'poze_baze_sportive';

test('anonymous submit proves existing credentials, stores only explicit application fields and returns no session', async () => {
  const { handler, calls } = await fixture();
  const response = await handler(submission()); const body = await response.json();
  assert.equal(response.status, 201); assert.deepEqual(body, { request_id: APP, status: 'noua', email_confirmation_required: false });
  assert.equal(calls[0].path, '/auth/v1/token'); assert.equal(calls[0].body.password, PASSWORD);
  assert.equal(calls.filter(c => c.path === '/auth/v1/signup').length, 0);
  assert.ok(!calls.some(c => c.path === '/auth/v1/user' || c.method === 'PUT' || c.method === 'PATCH'), 'Applying with an existing account must not overwrite its profile or Auth metadata');
  const rpc = calls.find(c => c.path.endsWith('submit_club_application'));
  assert.equal(rpc.headers.get('Authorization'), `Bearer ${SECRET}`); assert.equal(rpc.body.p_applicant_user_id, USER);
  assert.deepEqual(rpc.body.p_prices, [100,80]); assert.equal(rpc.body.p_terenuri[1].sport, 'Tenis Picior');
  for (const call of calls.filter(c => !c.path.startsWith('/auth/'))) assert.ok(!JSON.stringify(call.body).includes(PASSWORD));
  assert.ok(!JSON.stringify(body).includes(SECRET)); assert.ok(!JSON.stringify(body).includes(USER));
  assert.ok(!JSON.stringify(body).includes('token')); assert.ok(!calls.some(c => /users_admin|admin_baze|terenuri|baze_sportive$/.test(c.path)));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://spotivityrezervari-netizen.github.io');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});

test('new account uses normal signup and authoritative fresh Auth row without admin create/reset or config change', async () => {
  const { handler, calls } = await fixture({ fetch: c => c.path === '/auth/v1/token' ? json({ code: 'invalid_credentials' }, 400) : undefined });
  assert.equal((await handler(submission())).status, 201);
  const signup = calls.find(c => c.path === '/auth/v1/signup');
  assert.deepEqual(signup.body, { email: 'owner@example.test', password: PASSWORD, data: { nume: 'Nume Contact', telefon: '+40 721 123 456' } });
  assert.equal(signup.headers.get('apikey'), 'anon-public-key');
  assert.equal(calls.filter(c => c.path.startsWith('/auth/v1/admin/users')).length, 1);
  assert.ok(calls.filter(c => c.path.startsWith('/auth/v1/admin/users')).every(c => c.method === 'GET'));
  assert.ok(!calls.some(c => /config|settings|generate_link/.test(c.path)));
});

test('new unconfirmed account remains a private pending application with explicit confirmation flag', async () => {
  const { handler, calls } = await fixture({ fetch: c => {
    if (c.path === '/auth/v1/token') return json({ code: 'invalid_credentials' }, 400);
    if (c.path.startsWith('/auth/v1/admin/users/')) return json({ id: USER, email: 'owner@example.test', created_at: '2026-10-17T12:00:00Z', email_confirmed_at: null, identities: [{ user_id: USER }] });
  } });
  const response = await handler(submission()); assert.equal(response.status, 201); assert.equal((await response.json()).email_confirmation_required, true);
  assert.ok(!calls.some(c => c.path === '/rest/v1/users_admin' || c.path === '/rest/v1/baze_sportive'));
});

test('obfuscated existing signup cannot attach an application without knowing existing password', async () => {
  const { handler, calls } = await fixture({ fetch: c => {
    if (c.path === '/auth/v1/token') return json({ code: 'invalid_credentials' }, 400);
    if (c.path === '/auth/v1/signup') return json({ id: USER, email: 'owner@example.test', identities: [] });
  } });
  const response = await handler(submission()); assert.equal(response.status, 401); assert.equal((await response.json()).code, 'invalid_credentials');
  assert.ok(!calls.some(c => c.path.startsWith('/storage/') || c.path.startsWith('/rest/')));
});

test('even a plausible signup object is rejected if authoritative Auth row was not freshly created', async () => {
  const { handler, calls } = await fixture({ fetch: c => {
    if (c.path === '/auth/v1/token') return json({ code: 'invalid_credentials' }, 400);
    if (c.path.startsWith('/auth/v1/admin/users/')) return json({ id: USER, email: 'owner@example.test', created_at: '2025-01-01T00:00:00Z', identities: [{ user_id: USER }] });
  } });
  const response = await handler(submission()); assert.equal(response.status, 401); assert.ok(!calls.some(c => c.path.startsWith('/rest/')));
});

test('existing unconfirmed email does not trigger signup retry or password replacement', async () => {
  const { handler, calls } = await fixture({ fetch: c => c.path === '/auth/v1/token' ? json({ code: 'email_not_confirmed' }, 400) : undefined });
  const response = await handler(submission()); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'email_confirmation_required');
  assert.equal(calls.length, 1);
});

test('untrusted image, password byte limits, wrong sport and missing court prices fail before Auth', async t => {
  const cases = [
    ['SVG disguised as PNG', input(), new File(['<svg/>'], 'photo.png', { type: 'image/png' })],
    ['MIME mismatch', input(), new File([PNG], 'photo.jpg', { type: 'image/jpeg' })],
    ['password UTF-8 limit', input({ password: '🔑'.repeat(19) })],
    ['unknown sport', input({ terenuri: [{ nume: 'Teren unu', sport: 'Bowling' }], prices: [10] })],
    ['missing prices', input({ prices: [10] })],
    ['fractional price', input({ prices: [10.5,80] })],
    ['untrusted maps host', input({ link_maps: 'https://google.com.evil.test/maps' })],
    ['control characters', input({ oras: 'Cluj\nInjected' })],
  ];
  for (const [label, value, file] of cases) await t.test(label, async () => {
    const { handler, calls } = await fixture(); const response = await handler(submission(value, file));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'invalid_input'); assert.equal(calls.length, 0);
  });
});

test('body byte bound checks actual streamed bytes even without content-length', async () => {
  const { handler, calls } = await fixture();
  const request = new Request('https://edge.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); controller.close(); } }), duplex: 'half' });
  assert.equal((await handler(request)).status, 413); assert.equal(calls.length, 0);
});

test('private photo upload never overwrites and duplicate retries compare immutable bytes', async () => {
  const { handler, calls } = await fixture({ fetch: c => c.path === `/storage/v1/object/cereri_baze_sportive/${PRIVATE}` && c.method === 'POST' ? json({ error: 'Bad Request', code: 'Duplicate' }, 400) : undefined });
  assert.equal((await handler(submission(input(), new File([PNG], 'photo.png', { type: 'image/png' })))).status, 201);
  const upload = calls.find(c => c.method === 'POST' && c.path.includes(PRIVATE));
  assert.equal(upload.headers.get('x-upsert'), 'false');
  assert.equal(calls.filter(c => c.method === 'GET' && c.path.includes(PRIVATE)).length, 1);
  assert.equal(calls.find(c => c.path.endsWith('submit_club_application')).body.p_poza_path, PRIVATE);
});

test('different duplicate photo returns conflict and cannot change existing submission', async () => {
  const { handler, calls } = await fixture({ fetch: c => {
    if (c.path.includes(PRIVATE) && c.method === 'POST') return json({ code: 'Duplicate' }, 400);
    if (c.path.includes(PRIVATE) && c.method === 'GET') return new Response(new Uint8Array([...PNG,5]));
  } });
  const response = await handler(submission(input(), new File([PNG], 'photo.png', { type: 'image/png' })));
  assert.equal(response.status, 409); assert.ok(!calls.some(c => c.path.endsWith('submit_club_application')));
});

test('pending private photo is retained on submission transport failure, avoiding uncertain deletion', async () => {
  const { handler, calls } = await fixture({ fetch: c => { if (c.path.endsWith('submit_club_application')) throw new Error('secret upstream failure'); } });
  const response = await handler(submission(input(), new File([PNG], 'photo.png', { type: 'image/png' })));
  assert.equal(response.status, 503); assert.ok(!JSON.stringify(await response.json()).includes('secret upstream')); assert.ok(!calls.some(c => c.method === 'DELETE'));
});

test('approval requires validated Auth session and current database superadmin before reading any private request or image', async t => {
  for (const scenario of ['missing JWT', 'invalid JWT', 'normal admin']) await t.test(scenario, async () => {
    const { handler, calls } = await fixture({ fetch: c => {
      if (scenario === 'invalid JWT' && c.path === '/auth/v1/user') return json({ error: 'invalid token' }, 401);
      if (scenario === 'normal admin' && c.path === '/rest/v1/users_admin') return json([{ user_id: SUPER, is_super: false }]);
    } });
    const response = await handler(review('approve', {}, scenario === 'missing JWT' ? null : TOKEN));
    assert.ok([401,403].includes(response.status)); assert.equal((await response.json()).code, 'forbidden');
    assert.ok(!calls.some(c => c.path.startsWith('/storage/') || c.path === '/rest/v1/cereri_baze_sportive' || c.path.startsWith('/rest/v1/rpc/')));
  });
});

test('acceptance publishes photo only after superadmin verification and creates business data exclusively through user-JWT transaction', async () => {
  const { handler, calls } = await fixture(); const response = await handler(review());
  assert.equal(response.status, 200); assert.equal((await response.json()).base_id, BASE);
  const copyIndex = calls.findIndex(c => c.path === '/storage/v1/object/copy');
  const roleIndex = calls.findIndex(c => c.path === '/rest/v1/users_admin');
  const approveIndex = calls.findIndex(c => c.path.endsWith('approve_club_request'));
  assert.ok(roleIndex < copyIndex && copyIndex < approveIndex);
  const publicPath = calls[copyIndex].body.destinationKey;
  assert.match(publicPath, new RegExp(`^${BASE}/[0-9a-f-]{36}\\.png$`)); assert.notEqual(publicPath, `${BASE}/${APP}.png`);
  assert.equal(calls[copyIndex].headers.get('Authorization'), `Bearer ${SECRET}`);
  assert.deepEqual(calls[copyIndex].body, { bucketId: 'cereri_baze_sportive', sourceKey: PRIVATE, destinationBucket: PUBLIC_BUCKET, destinationKey: publicPath });
  assert.equal(calls[approveIndex].headers.get('Authorization'), `Bearer ${TOKEN}`);
  assert.deepEqual(calls[approveIndex].body, { p_request_id: APP, p_prices: [100,80], p_photo_path: publicPath, p_expected_updated_at: '2026-10-17T11:00:00Z', p_nota: 'Verificat' });
  assert.ok(!calls.some(c => c.method === 'DELETE'));
  assert.ok(!calls.some(c => c.method !== 'GET' && /\/rest\/v1\/(baze_sportive|terenuri|users_admin|admin_baze_sportive)$/.test(c.path)));
});

test('accepted retry does not recopy photos or create duplicate courts', async () => {
  const { handler, calls } = await fixture({ row: { stare: 'acceptata', approved_base_id: BASE } });
  assert.equal((await handler(review())).status, 200);
  assert.ok(!calls.some(c => c.path.startsWith('/storage/')));
  assert.equal(calls.find(c => c.path.endsWith('approve_club_request')).body.p_photo_path, null);
});

test('an explicit empty acceptance note clears the previous note while an omitted note preserves it', async () => {
  for (const [overrides, expected] of [[{ note: '' }, ''], [{ note: undefined }, null]]) {
    const { handler, calls } = await fixture({ row: { poza_path: null } });
    assert.equal((await handler(review('approve', overrides))).status, 200);
    assert.equal(calls.find(c => c.path.endsWith('approve_club_request')).body.p_nota, expected);
  }
});

test('legacy migration 011 random photo filenames remain approvable without changing their owner or request directory', async () => {
  const legacy = `${USER}/${APP}/eeeeeeee-5555-4555-8555-555555555555.png`;
  const { handler, calls } = await fixture({ row: { poza_path: legacy } });
  assert.equal((await handler(review())).status, 200);
  const copy = calls.find(c => c.path.endsWith('/object/copy'));
  assert.equal(copy.body.sourceKey, legacy); assert.match(copy.body.destinationKey, new RegExp(`^${BASE}/[0-9a-f-]{36}\\.png$`));
});

test('public stage collision allocates another fresh UUID and never reuses an existing staged file', async () => {
  let copies = 0;
  const { handler, calls } = await fixture({ fetch: c => c.path.endsWith('/object/copy') && ++copies === 1 ? json({ code: 'Duplicate' }, 400) : undefined });
  assert.equal((await handler(review())).status, 200);
  const paths = calls.filter(c => c.path.endsWith('/object/copy')).map(c => c.body.destinationKey);
  assert.equal(paths.length, 2); assert.notEqual(paths[0], paths[1]);
  assert.ok(!calls.some(c => c.method === 'GET' && c.path.startsWith('/storage/v1/object/poze_baze_sportive/')));
  assert.ok(!calls.some(c => c.method === 'DELETE'));
});

test('definite SQL failure cleans only newly copied, provably unreferenced public photo', async () => {
  const { handler, calls } = await fixture({ fetch: c => c.path.endsWith('approve_club_request') ? json({ code: '40001', message: 'Request changed' }, 400) : undefined });
  const response = await handler(review()); assert.equal(response.status, 409);
  const cleanup = calls.find(c => c.method === 'DELETE');
  const ownPath = calls.find(c => c.path.endsWith('/object/copy')).body.destinationKey;
  assert.equal(cleanup.path, '/storage/v1/object/poze_baze_sportive'); assert.deepEqual(cleanup.body, { prefixes: [ownPath] });
  assert.equal(calls.find(c => c.path === '/rest/v1/baze_sportive').search, `?select=id&poza=eq.${encodeURIComponent(ownPath)}`);
  assert.ok(calls.findIndex(c => c.path === '/rest/v1/baze_sportive') < calls.findIndex(c => c.method === 'DELETE'));
});

test('failed approval cannot delete another concurrently pending approval photo', { timeout: 5000 }, async () => {
  let rpcCount = 0; let secondEntered; let cleaned;
  const secondRpc = new Promise(resolve => { secondEntered = resolve; });
  const firstCleaned = new Promise(resolve => { cleaned = resolve; });
  const { handler, calls } = await fixture({ fetch: async c => {
    if (c.path.endsWith('approve_club_request')) {
      if (++rpcCount === 1) { await secondRpc; return json({ code: '40001', message: 'Request changed' }, 400); }
      secondEntered(); await firstCleaned;
    }
    if (c.method === 'DELETE') cleaned();
  } });
  const responses = await Promise.all([handler(review()), handler(review())]);
  assert.deepEqual(responses.map(r => r.status), [409,200]);
  const staged = calls.filter(c => c.path.endsWith('/object/copy')).map(c => c.body.destinationKey);
  assert.equal(staged.length, 2); assert.notEqual(staged[0], staged[1]);
  const deleted = calls.filter(c => c.method === 'DELETE').flatMap(c => c.body.prefixes);
  assert.deepEqual(deleted, [staged[0]]); assert.ok(!deleted.includes(staged[1]));
});

test('an idempotent winner response cleans only the losing invocation own unreferenced stage', async () => {
  let rpcCount = 0;
  const { handler, calls } = await fixture({ fetch: c => {
    if (c.path.endsWith('approve_club_request') && ++rpcCount === 2) return json({ request_id: APP, base_id: BASE, court_ids: [1,2], status: 'acceptata' });
  } });
  assert.equal((await handler(review())).status, 200);
  assert.equal((await handler(review())).status, 200);
  const staged = calls.filter(c => c.path.endsWith('/object/copy')).map(c => c.body.destinationKey);
  assert.equal(staged.length, 2); assert.notEqual(staged[0], staged[1]);
  assert.deepEqual(calls.filter(c => c.method === 'DELETE').flatMap(c => c.body.prefixes), [staged[1]]);
});

test('approval transport uncertainty or a referenced staged copy never deletes accepted base media', async t => {
  for (const mode of ['uncertain transport', 'referenced image']) await t.test(mode, async () => {
    const { handler, calls } = await fixture({ fetch: c => {
      if (c.path.endsWith('approve_club_request')) { if (mode === 'uncertain transport') throw new Error('network timeout'); return json({ code: '40001' }, 400); }
      if (c.path === '/rest/v1/baze_sportive') return json([{ id: BASE }]);
    } });
    assert.ok([409,503].includes((await handler(review())).status)); assert.ok(!calls.some(c => c.method === 'DELETE'));
  });
});

test('rejection uses user-JWT SQL transaction and never publishes applicant media', async () => {
  const { handler, calls } = await fixture();
  const response = await handler(review('reject')); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'respinsa');
  assert.ok(!calls.some(c => c.path.startsWith('/storage/')));
  const reject = calls.find(c => c.path.endsWith('reject_club_request')); assert.equal(reject.headers.get('Authorization'), `Bearer ${TOKEN}`);
  assert.deepEqual(reject.body, { p_request_id: APP, p_nota: 'Verificat', p_expected_updated_at: '2026-10-17T11:00:00Z' });
});

test('CORS supports public form preflight, rejects other origins and restricts methods', async () => {
  const { handler, calls } = await fixture();
  const local = await handler(new Request('https://edge.test', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8038' } }));
  assert.equal(local.status, 204); assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8038');
  const evil = await handler(new Request('https://edge.test', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }));
  assert.equal(evil.status, 403); assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await handler(new Request('https://edge.test'))).status, 405); assert.equal(calls.length, 0);
});
