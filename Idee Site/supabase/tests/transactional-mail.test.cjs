const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const template = import(pathToFileURL(path.join(__dirname, '../functions/_shared/transactional-mail.ts')).href);
const SITE = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
const CANCEL = `${SITE}?cancel_booking=opaque-test-token&source=email`;
const booking = {
  id: 'booking-123', courtName: 'Terenul unu', sport: 'Fotbal', baseName: 'Baza Sportului',
  city: 'Cluj-Napoca', dayISO: '2026-10-25', hours: ['18:00–19:00', '19:00–20:00'],
  amountRON: 240, customerName: 'Ana Exemplu', customerEmail: 'ana@example.test', customerPhone: '+40 721 123 456',
};
function input(kind = 'booking_created_client', overrides = {}) {
  return { kind, recipient: { email: 'ana@example.test', name: 'Ana' }, booking, ...(kind === 'booking_created_client' ? { cancellationURL: CANCEL } : {}), ...overrides };
}

test('booking client confirmation has complete local date, multiple hours, amount and caller-provided cancellation link', async () => {
  const { renderTransactionalMail } = await template;
  const rendered = renderTransactionalMail(input());
  assert.deepEqual(rendered.to, { email: 'ana@example.test', name: 'Ana' });
  assert.match(rendered.subject, /Rezervare confirmată/);
  for (const value of ['Baza Sportului', 'Terenul unu', 'Fotbal', 'Cluj-Napoca', '25 octombrie 2026', '18:00–19:00, 19:00–20:00', '240', 'booking-123']) {
    assert.ok(rendered.text.includes(value), `missing ${value}`);
    assert.ok(rendered.html.includes(value), `missing HTML ${value}`);
  }
  assert.match(rendered.html, /href="[^\"]*cancel_booking=opaque-test-token&amp;source=email"/);
  assert.ok(rendered.text.includes(CANCEL));
  assert.match(rendered.text, /deschide linkul și confirmă acțiunea/);
  assert.match(rendered.html, /width=device-width/);
  assert.match(rendered.html, /max-width:600px/);
  assert.match(rendered.html, /#101a14/);
  assert.match(rendered.html, /#d8b66a/);
});

test('owner reservation emails include customer contact but no cancellation credential', async () => {
  const { renderTransactionalMail } = await template;
  for (const kind of ['booking_created_owner', 'booking_cancelled_owner']) {
    const rendered = renderTransactionalMail(input(kind, { recipient: { email: 'owner@example.test' } }));
    for (const value of [booking.customerName, booking.customerEmail, booking.customerPhone]) assert.ok(rendered.text.includes(value));
    assert.ok(!rendered.html.includes('opaque-test-token'));
    assert.ok(!rendered.text.includes('Anulează rezervarea'));
    assert.match(rendered.html, /Administrează rezervările/);
  }
});

test('cancellation confirmation has no stale cancellation button', async () => {
  const { renderTransactionalMail } = await template;
  const rendered = renderTransactionalMail(input('booking_cancelled_client'));
  assert.match(rendered.subject, /Rezervare anulată/);
  assert.match(rendered.text, /Anularea rezervării/);
  assert.ok(!rendered.html.includes('Anulează rezervarea'));
  assert.ok(!rendered.text.includes(booking.customerPhone));
  assert.match(rendered.text, /Găsește un teren/);
});

test('partial cancellation names cancelled hours and explicitly preserves the other booked hours', async () => {
  const { renderTransactionalMail } = await template;
  const rendered = renderTransactionalMail(input('booking_cancelled_client', { booking: { ...booking, hours: ['19:00–20:00'], remainingHours: ['18:00–19:00'], amountRON: 120 } }));
  assert.match(rendered.html,/O parte din rezervare a fost anulată/);
  assert.match(rendered.text,/Orele păstrate în rezervare: 18:00–19:00/);
  assert.match(rendered.text,/Ore: 19:00–20:00/);
});

test('chat email escapes previews and preserves readable plaintext without credentials', async () => {
  const { renderTransactionalMail } = await template;
  const rendered = renderTransactionalMail({ kind: 'chat_owner', recipient: { email: 'owner@example.test' }, chat: { courtName: '<Teren & "unu">', customerName: '<Ana>', preview: '<img src=x onerror="attack()"> & Salut!\nAș dori o informație.' }, password: 'must-not-be-rendered', access_token: 'secret-token-ignored' });
  assert.ok(rendered.html.includes('&lt;img src=x onerror=&quot;attack()&quot;&gt; &amp; Salut!'));
  assert.ok(!rendered.html.includes('<img'));
  assert.ok(rendered.text.includes('<img src=x onerror="attack()"> & Salut! Aș dori o informație.'));
  assert.match(rendered.text, /Deschide conversațiile/);
  assert.ok(!JSON.stringify(rendered).includes('must-not-be-rendered'));
  assert.ok(!JSON.stringify(rendered).includes('secret-token-ignored'));
});

test('all booking HTML fields and greeting are escaped and subject cannot inject mail headers', async () => {
  const { renderTransactionalMail } = await template;
  const payload = '<svg onload="attack()"> & \'q\'';
  const rendered = renderTransactionalMail(input('booking_created_owner', {
    recipient: { email: 'owner@example.test', name: payload },
    booking: { ...booking, courtName: `${payload}\r\nBcc: outsider@example.test`, customerName: payload, customerEmail: payload, customerPhone: payload, city: payload, baseName: payload, sport: payload, id: payload, hours: [payload] },
  }));
  assert.ok(!/[\r\n\u2028\u2029]/.test(rendered.subject));
  assert.ok(!rendered.html.includes('<svg'));
  assert.ok(rendered.html.includes('&lt;svg onload=&quot;attack()&quot;&gt; &amp; &#39;q&#39;'));
  assert.ok(rendered.text.includes(payload));
  assert.ok(rendered.html.includes('Bcc: outsider@example.test'));
});

test('email links reject outside origins, protocols, sibling paths and traversal', async () => {
  const { renderTransactionalMail, validateTransactionalURL } = await template;
  for (const bad of [
    'https://evil.example/Site/Idee%20Site/', 'http://spotivityrezervari-netizen.github.io/Site/Idee%20Site/',
    'javascript:alert(1)', '//spotivityrezervari-netizen.github.io/Site/Idee%20Site/',
    'https://spotivityrezervari-netizen.github.io.evil.example/Site/Idee%20Site/',
    'https://user:password@spotivityrezervari-netizen.github.io/Site/Idee%20Site/',
    'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site-evil/',
    `${SITE}../admin.html`, `${SITE}%2e%2e/admin.html`, `${SITE}%2f..%2fother`,
    `${SITE}%5c..%5cother`, `${SITE}%00other`, `${SITE}?token=x\r\nBcc:evil@example.test`,
  ]) {
    assert.throws(() => validateTransactionalURL(bad), TypeError, bad);
    assert.throws(() => renderTransactionalMail(input('booking_created_client', { cancellationURL: bad })), TypeError, bad);
    assert.throws(() => renderTransactionalMail(input('booking_created_owner', { siteURL: bad })), TypeError, bad);
  }
  assert.equal(validateTransactionalURL(`${SITE}index.html?mode=profile#chat`), `${SITE}index.html?mode=profile#chat`);
});

test('cancellation credential stays exclusive to client creation email and is never generated', async () => {
  const { renderTransactionalMail } = await template;
  assert.throws(() => renderTransactionalMail(input('booking_created_client', { cancellationURL: undefined })), TypeError);
  for (const kind of ['booking_created_owner', 'booking_cancelled_owner', 'booking_cancelled_client']) {
    assert.throws(() => renderTransactionalMail(input(kind, { cancellationURL: CANCEL })), TypeError);
  }
  assert.throws(() => renderTransactionalMail({ kind: 'chat_owner', recipient: { email: 'owner@example.test' }, chat: { courtName: 'Teren', customerName: 'Ana', preview: 'Salut' }, cancellationURL: CANCEL }), TypeError);
});

test('local calendar dates do not shift at daylight saving transitions or leap days', async () => {
  const { renderTransactionalMail } = await template;
  for (const [dayISO, expected] of [['2026-03-29', '29 martie 2026'], ['2026-10-25', '25 octombrie 2026'], ['2028-02-29', '29 februarie 2028'], ['2027-01-01', '1 ianuarie 2027']]) {
    assert.ok(renderTransactionalMail(input('booking_created_owner', { booking: { ...booking, dayISO } })).text.includes(expected));
  }
  for (const dayISO of ['2026-02-29', '2026-13-01', '2026-10-25T23:00:00Z', '2026-00-10', '2026-04-31']) {
    assert.throws(() => renderTransactionalMail(input('booking_created_owner', { booking: { ...booking, dayISO } })), TypeError);
  }
});

test('recipient and booking constraints prevent malformed mail delivery metadata', async () => {
  const { renderTransactionalMail } = await template;
  for (const email of ['x@example.test\r\nBcc:secret@example.test', 'Ana <ana@example.test>', 'no-at-sign', '']) {
    assert.throws(() => renderTransactionalMail(input('booking_created_owner', { recipient: { email } })), TypeError);
  }
  for (const change of [{ hours: [] }, { hours: [''] }, { amountRON: NaN }, { amountRON: -1 }, { amountRON: Infinity }]) {
    assert.throws(() => renderTransactionalMail(input('booking_created_owner', { booking: { ...booking, ...change } })), TypeError);
  }
  assert.throws(() => renderTransactionalMail(input('not-a-kind')), TypeError);
});
