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
  for (const value of ['Baza Sportului', 'Terenul unu', 'Fotbal', 'Cluj-Napoca', '25 octombrie 2026', '18:00 – 20:00', '240', 'booking-123']) {
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
    assert.match(rendered.html, kind === 'booking_created_owner' ? /Deschide în Panoul de Administrare/ : /Administrează rezervările/);
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
  assert.equal((rendered.html.match(/<img /g)||[]).length, 1);
  assert.ok(rendered.html.includes('assets/imagini/avatar2.png'));
  assert.ok(!rendered.html.includes('<img src=x'));
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

function links(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
}

test('client model has secure view/cancel actions, maps, calendar and a real Romanian deadline', async () => {
  const { renderTransactionalMail } = await template;
  const id = '734cd157-5baa-4d5f-93d7-6bb6e8155b59';
  const cancel = `${SITE}#anulare-rezervare=${id}&token=client-only-opaque`;
  const mail = renderTransactionalMail(input('booking_created_client', {
    booking: { ...booking, id, dayISO: '2026-10-20', hours: ['15:00–16:00', '16:00–17:00'], cancellationDeadlineISO: '2026-10-20T12:00:00Z', mapsURL: 'https://www.google.com/maps/search/?api=1&query=Complex+XYZ', paymentMethods: 'cash_card' },
    cancellationURL: cancel,
  }));
  for (const text of ['Confirmare oficială a rezervării tale', `#SPT-${id}`, '15:00 – 17:00', '15:00, 20 octombrie 2026', 'cash sau cu cardul', 'Adaugă în Calendar', 'Vezi rezervarea', 'Chat cu baza sportivă', '15 minute', 'spotivity.rezervari@gmail.com']) assert.ok(mail.text.includes(text), text);
  const urls = links(mail.html);
  const calendar = new URL(urls.find(url => url.startsWith('https://calendar.google.com/')));
  assert.equal(calendar.searchParams.get('dates'), '20261020T150000/20261020T170000');
  assert.equal(calendar.searchParams.get('ctz'), 'Europe/Bucharest');
  assert.equal(calendar.searchParams.has('add'), false, 'No client email becomes a calendar attendee');
  assert.ok(!calendar.href.includes('client-only-opaque'));
  assert.ok(!calendar.href.includes('ana%40'));
  assert.ok(urls.includes('https://www.google.com/maps/search/?api=1&query=Complex+XYZ'));
  assert.ok(urls.includes(`${SITE}#token=client-only-opaque&rezervare=${id}`));
  assert.ok(urls.includes(cancel));
  for (const url of urls.filter(url => url.includes('client-only-opaque'))) assert.ok(url.startsWith(SITE) && (url.includes('rezervare=') || url.includes('anulare-rezervare=')));
  assert.ok(!urls.some(url => url.includes('spotivity-action=chat') && url.includes('token=')));
});

test('calendar handles midnight and date rollover without combining nonconsecutive intervals', async () => {
  const { renderTransactionalMail } = await template;
  for (const [dayISO, expectedEnd] of [['2026-12-31', '20270101T000000'], ['2028-02-29', '20280301T000000'], ['2026-10-25', '20261026T000000']]) {
    const mail = renderTransactionalMail(input('booking_created_client', { booking: { ...booking, dayISO, hours: ['23:00–00:00'] } }));
    const url = new URL(links(mail.html).find(url => url.startsWith('https://calendar.google.com/')));
    assert.equal(url.searchParams.get('dates'), `${dayISO.replaceAll('-', '')}T230000/${expectedEnd}`);
    assert.ok(mail.text.includes('23:00 – 24:00'));
  }
  const mail = renderTransactionalMail(input('booking_created_client', { booking: { ...booking, hours: ['15:00–16:00', '18:00–19:00'] } }));
  assert.ok(mail.text.includes('15:00–16:00, 18:00–19:00'));
  assert.ok(!links(mail.html).some(url => url.startsWith('https://calendar.google.com/')), 'Do not create a continuous calendar slot across a gap');
});

test('owner contact shortcuts and app actions do not contain the client cancellation capability', async () => {
  const { renderTransactionalMail } = await template;
  const mail = renderTransactionalMail(input('booking_created_owner'));
  const urls = links(mail.html);
  assert.ok(urls.includes('tel:+40721123456'));
  assert.ok(urls.includes('mailto:ana%40example.test'));
  for (const action of ['admin','reservation','chat']) assert.ok(urls.some(url => url.includes(`spotivity-action=${action}`) && url.includes('booking=booking-123')));
  assert.ok(!urls.some(url => url.includes('token=') || url.includes('anulare-rezervare') || url.startsWith('https://calendar.google.com/')));
  const unsafe = renderTransactionalMail(input('booking_created_owner', { booking: { ...booking, customerPhone: '+40721" onclick="bad()', customerEmail: 'x@example.test?subject=attack\r\nBcc:evil@example.test' } }));
  assert.ok(!links(unsafe.html).some(url => url.startsWith('tel:')));
  assert.ok(!links(unsafe.html).some(url => url.startsWith('mailto:') && url !== 'mailto:spotivity.rezervari@gmail.com'));
});

test('maps only links approved HTTPS Google Maps hosts and never creates a misleading arbitrary link', async () => {
  const { renderTransactionalMail } = await template;
  for (const url of ['https://maps.app.goo.gl/exampleMap9', 'https://maps.google.ro/?q=test', 'https://google.ro/maps?q=test', 'https://goo.gl/maps/exampleMap9']) {
    assert.ok(links(renderTransactionalMail(input('booking_created_owner', { booking: { ...booking, mapsURL: url } })).html).includes(url));
  }
  for (const url of ['javascript:alert(1)', 'https://evil.example/maps', 'https://google.com.evil.example/maps', 'https://google.com/not-maps', 'https://user:password@google.com/maps', 'http://google.com/maps']) {
    const mail = renderTransactionalMail(input('booking_created_owner', { booking: { ...booking, mapsURL: url } }));
    assert.ok(!links(mail.html).includes(url));
    assert.ok(!mail.html.includes(url), 'Unsafe map is neither linked nor printed');
  }
});

test('welcome email uses the first name, support contact and functional account/site actions without booking data', async () => {
  const { renderTransactionalMail } = await template;
  const mail = renderTransactionalMail({ kind: 'account_welcome', recipient: { email: 'ana@example.test', name: 'Ana Exemplu' }, firstName: 'Ana' });
  for (const text of ['Contul tău este înregistrat. Hai la sport!', 'Salut, Ana!', 'Alege un teren', 'Accesează contul', 'Ne vedem pe teren', 'spotivity.rezervari@gmail.com', 'Dacă nu ai creat tu contul']) assert.ok(mail.text.includes(text), text);
  const urls = links(mail.html);
  assert.ok(urls.includes(SITE)); assert.ok(urls.includes(`${SITE}#spotivity-action=account`));
  assert.ok(!mail.html.includes('Cod rezervare'));
  assert.ok(!mail.text.includes('token='));
  const escaped = renderTransactionalMail({ kind: 'account_welcome', recipient: { email: 'ana@example.test' }, firstName: '<img src=x onerror="bad()">' });
  assert.equal((escaped.html.match(/<img /g) || []).length, 1, 'Only the trusted logo image is present');
  assert.ok(escaped.html.includes('&lt;img src=x onerror=&quot;bad()&quot;&gt;'));
  assert.throws(() => renderTransactionalMail({ kind: 'account_welcome', recipient: { email: 'ana@example.test' }, cancellationURL: CANCEL }), TypeError);
});

test('payment copy follows the confirmed default and explicit alternatives; missing deadlines never invent a cutoff', async () => {
  const { renderTransactionalMail } = await template;
  const mail = renderTransactionalMail(input());
  assert.ok(mail.text.includes('cash sau cu cardul'));
  assert.ok(!renderTransactionalMail(input('booking_created_client', { booking: { ...booking, paymentMethods: 'at_location' } })).text.includes('cash sau cu cardul'));
  assert.ok(!mail.text.includes('Termen de anulare comunicat'));
  assert.ok(mail.text.includes('Poți anula orele nefinalizate din rezervare'));
  assert.ok(!mail.text.includes('înainte de începerea rezervării'));
  assert.ok(mail.text.includes('Anulările cu mai puțin de o oră înainte sunt înregistrate pentru verificare'));
  assert.ok(!mail.text.includes('restricționat'));
  assert.ok(mail.text.includes('Rezervările finalizate nu pot fi anulate'));
  assert.throws(() => renderTransactionalMail(input('booking_created_client', { booking: { ...booking, cancellationDeadlineISO: 'whenever' } })), TypeError);
});
