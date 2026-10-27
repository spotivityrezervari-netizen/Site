/** Romanian transactional email templates. Rendering never sends mail or creates credentials. */
export const TRANSACTIONAL_SITE_URL = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
export const TRANSACTIONAL_SUPPORT_EMAIL = 'spotivity.rezervari@gmail.com';
export type MailRecipient = { email: string; name?: string };
export type BookingMailDetails = {
  id: string | number; courtName: string; sport: string; baseName: string; city: string;
  dayISO: string; hours: readonly string[]; remainingHours?: readonly string[];
  amountRON: number; customerName: string; customerEmail: string; customerPhone: string;
  mapsURL?: string; cancellationDeadlineISO?: string; paymentMethods?: 'cash_card' | 'at_location';
};
export type ChatMailDetails = { courtName: string; customerName: string; preview: string; baseName?: string; messageID?: string };
type CommonInput = { recipient: MailRecipient; siteURL?: string };
export type TransactionalMailInput = CommonInput & (
  | { kind: 'booking_created_client'; booking: BookingMailDetails; cancellationURL: string }
  | { kind: 'booking_created_owner' | 'booking_cancelled_client' | 'booking_cancelled_owner'; booking: BookingMailDetails; cancellationURL?: never }
  | { kind: 'chat_owner' | 'chat_client'; chat: ChatMailDetails; cancellationURL?: never }
  | { kind: 'account_welcome'; firstName?: string; cancellationURL?: never }
);
export type RenderedTransactionalMail = { to: MailRecipient; subject: string; html: string; text: string };
type Row = { label: string; value: string; href?: string };
type Action = { label: string; href: string; secondary?: boolean };
const BRAND = 'Spotivity';
const PRODUCTION_ORIGIN = 'https://spotivityrezervari-netizen.github.io';
const PRODUCTION_PATH = '/Site/Idee Site/';
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const escapeHTML = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const line = (value: unknown): string => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const emailValid = (email: unknown): email is string => typeof email === 'string' && email.length <= 254 && /^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/.test(email);
/** App links stay on the production origin/path, including client-only opaque capabilities. */
export function validateTransactionalURL(value: string): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Invalid transactional email URL');
  let url: URL, decodedPath: string;
  try { url = new URL(value); decodedPath = decodeURIComponent(url.pathname); }
  catch { throw new TypeError('Invalid transactional email URL'); }
  if (url.protocol !== 'https:' || url.origin !== PRODUCTION_ORIGIN || url.username || url.password || !decodedPath.startsWith(PRODUCTION_PATH) || /[\\\u0000-\u001f\u007f]/.test(decodedPath) || decodedPath.split('/').some(part => part === '.' || part === '..')) throw new TypeError('Transactional email links must stay inside the production app');
  return url.href;
}
function recipient(value: MailRecipient): MailRecipient {
  if (!value || !emailValid(value.email)) throw new TypeError('Invalid email recipient');
  const name = line(value.name); return name ? { email: value.email, name } : { email: value.email };
}
function romanianDay(value: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Booking day must be YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number), date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new TypeError('Invalid booking day');
  return new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' }).format(date);
}
function deadlineLabel(value: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError('Invalid cancellation deadline');
  const date = new Date(value);
  const day = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' }).format(date);
  const time = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Bucharest' }).format(date);
  return `${time}, ${day} (ora României)`;
}
function appAction(siteURL: string, action: string, booking?: BookingMailDetails): string {
  const url = new URL(siteURL); url.search = ''; url.hash = '';
  const hash = new URLSearchParams({ 'spotivity-action': action });
  if (booking) hash.set('booking', String(booking.id));
  url.hash = hash.toString(); return validateTransactionalURL(url.href);
}
function clientChatAction(siteURL: string, messageID?: string): string {
  if (typeof messageID !== 'string' || !/^(?:[1-9]\d{0,19}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(messageID)) return appAction(siteURL, 'account');
  const url = new URL(siteURL); url.search = ''; url.hash = '';
  url.hash = new URLSearchParams({ 'spotivity-action': 'chat', message: messageID }).toString();
  return validateTransactionalURL(url.href);
}
function mapsLink(value?: string): string | undefined {
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    const host = url.hostname, path = url.pathname;
    const google = /^(?:www\.)?google\.(?:com|ro)$/.test(host) && /^\/maps(?:\/|$)/.test(path);
    const maps = /^maps\.google\.(?:com|ro)$/.test(host);
    const short = host === 'maps.app.goo.gl' && /^\/[A-Za-z0-9_-]+\/?$/.test(path);
    const legacy = host === 'goo.gl' && /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(path);
    return google || maps || short || legacy ? url.href : undefined;
  } catch { return undefined; }
}
function phoneLink(value: string): string | undefined {
  if (!/^[+\d\s().-]+$/.test(value)) return undefined;
  const number = value.replace(/[\s().-]/g, '');
  return /^\+?\d{7,15}$/.test(number) ? `tel:${number}` : undefined;
}
function emailLink(value: string): string | undefined { return emailValid(value) ? `mailto:${encodeURIComponent(value)}` : undefined; }
function parsedHours(hours: readonly string[]): { start: number; end: number }[] | null {
  const result: { start: number; end: number }[] = [];
  for (const value of hours) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([01]\d|2[0-3]|24):([0-5]\d)$/.exec(value);
    if (!match) return null;
    const start = Number(match[1]) * 60 + Number(match[2]);
    let end = Number(match[3]) * 60 + Number(match[4]);
    if (end === 0 && start > 0) end = 1440;
    if (end <= start || end > 1440 || (match[3] === '24' && match[4] !== '00')) return null;
    result.push({ start, end });
  }
  return result.sort((a, b) => a.start - b.start);
}
const hourLabel = (value: number): string => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
function interval(hours: readonly string[]): string {
  const spans = parsedHours(hours);
  if (!spans?.length || spans.some((span, index) => index > 0 && span.start !== spans[index - 1].end)) return hours.map(line).join(', ');
  return `${hourLabel(spans[0].start)} – ${hourLabel(spans.at(-1)!.end)}`;
}
/** Google Calendar receives local wall-clock times and the explicit Bucharest zone, never client/contact/cancellation data. */
function calendarLink(booking: BookingMailDetails, siteURL: string): string | undefined {
  const hours = parsedHours(booking.hours);
  if (!hours?.length || hours.some((hour, i) => i > 0 && hour.start !== hours[i - 1].end)) return undefined;
  const start = `${booking.dayISO.replace(/-/g, '')}T${hourLabel(hours[0].start).replace(':', '')}00`;
  let endDay = booking.dayISO, endMinutes = hours.at(-1)!.end;
  if (endMinutes === 1440) {
    const date = new Date(`${booking.dayISO}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
    endDay = date.toISOString().slice(0, 10); endMinutes = 0;
  }
  const end = `${endDay.replace(/-/g, '')}T${hourLabel(endMinutes).replace(':', '')}00`;
  const url = new URL('https://calendar.google.com/calendar/render');
  url.search = new URLSearchParams({ action: 'TEMPLATE', text: `${booking.sport} · ${booking.courtName}`, dates: `${start}/${end}`, ctz: 'Europe/Bucharest', location: [booking.baseName, booking.city].map(line).filter(Boolean).join(', '), details: `Rezervare Spotivity. Plata se face la locație.\n${new URL(siteURL).origin}${PRODUCTION_PATH}` }).toString();
  return url.href;
}
function rowsHTML(rows: Row[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${rows.filter(row => row.value).map(({ label, value, href }) => `<tr><td style="width:34%;vertical-align:top;padding:11px 12px 11px 0;border-bottom:1px solid #e5e9e2;color:#607064;font-size:13px;line-height:1.5;word-break:break-word">${escapeHTML(label)}</td><td style="vertical-align:top;padding:11px 0;border-bottom:1px solid #e5e9e2;color:#172b20;font-size:14px;font-weight:600;line-height:1.5;overflow-wrap:anywhere;word-break:break-word">${href ? `<a href="${escapeHTML(href)}" style="color:#315b40;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(value)}</a>` : escapeHTML(value)}</td></tr>`).join('')}</table>`;
}
function actionsHTML(actions: Action[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px">${actions.map(({ label, href, secondary }) => `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${secondary ? '#eef2eb' : '#d8b66a'}" style="border-radius:10px;background:${secondary ? '#eef2eb' : '#d8b66a'};border:1px solid ${secondary ? '#cad5c8' : '#d8b66a'}"><a href="${escapeHTML(href)}" style="display:block;padding:15px 16px;color:#172b20;font-size:14px;font-weight:700;line-height:1.4;text-align:center;text-decoration:none;overflow-wrap:anywhere">${escapeHTML(label)}</a></td></tr></table></td></tr>`).join('')}</table>`;
}
function section(title: string): string { return `<h2 style="margin:26px 0 8px;font-size:12px;letter-spacing:1px;line-height:1.5;color:#5b6b5d;font-weight:700;text-transform:uppercase">${escapeHTML(title)}</h2>`; }
function paragraph(value: string): string { return `<p style="margin:0 0 15px;font-size:14px;line-height:1.75;color:#304936;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(value)}</p>`; }
function note(value: string): string { return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="padding:16px;background:#f5f3eb;border-left:3px solid #d8b66a;border-radius:6px;font-size:13px;line-height:1.7;color:#44513e;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(value)}</td></tr></table>`; }

/** Complete HTML and plaintext alternatives for the separate Make transport. */
export function renderTransactionalMail(input: TransactionalMailInput): RenderedTransactionalMail {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid transactional email input');
  const to = recipient(input.recipient), siteURL = validateTransactionalURL(input.siteURL ?? TRANSACTIONAL_SITE_URL);
  if (input.kind !== 'booking_created_client' && 'cancellationURL' in input && input.cancellationURL !== undefined) throw new TypeError('Cancellation links are for the booking client only');
  let subject = '', title = '', introduction = '', content = '', after = '', footer = 'E-mail generat automat de platforma Spotivity.';
  let actions: Action[] = [], rows: Row[] = [], notes: string[] = [];
  const firstName = input.kind === 'account_welcome' ? line(input.firstName || to.name?.split(/\s+/)[0]) : to.name;
  const greeting = firstName ? `Salut, ${firstName}!` : 'Salut!';
  if (input.kind === 'account_welcome') {
    subject = 'Bine ai venit pe Spotivity!'; title = 'Contul tău este înregistrat. Hai la sport!';
    introduction = 'Bine ai venit pe Spotivity! Caută un teren pentru sportul tău preferat, alege un interval disponibil, rezervă online și primește confirmarea rezervării.';
    actions = [{ label: 'Alege un teren', href: siteURL }];
    content = actionsHTML(actions) + paragraph('În contul tău poți vedea rezervările și detaliile lor, ca să ai toate informațiile la îndemână înainte de fiecare meci.') + actionsHTML([{ label: 'Accesează contul', href: appAction(siteURL, 'account'), secondary: true }]) + `<p style="margin:18px 0 0;font-size:14px;line-height:1.75;color:#304936">Ne vedem pe teren,<br>Echipa Spotivity</p>`;
    after = 'În contul tău poți vedea rezervările și detaliile lor, ca să ai toate informațiile la îndemână înainte de fiecare meci.\nAccesează contul: ' + appAction(siteURL, 'account') + '\n\nNe vedem pe teren,\nEchipa Spotivity';
    footer = 'Ai primit acest email deoarece a fost creat un cont Spotivity cu această adresă. Dacă nu ai creat tu contul, contactează-ne la ' + TRANSACTIONAL_SUPPORT_EMAIL + '.';
  } else if (input.kind === 'chat_owner' || input.kind === 'chat_client') {
    if (!input.chat || typeof input.chat.preview !== 'string') throw new TypeError('Invalid chat details');
    const client = input.kind === 'chat_client';
    const base = line(input.chat.baseName) || line(input.chat.courtName);
    title = client ? 'Ai un mesaj nou de la baza sportivă' : 'Ai un mesaj nou';
    subject = client ? `Mesaj nou de la ${base} · ${BRAND}` : `Mesaj nou pentru ${line(input.chat.courtName)} · ${BRAND}`;
    introduction = client ? `${base} ți-a trimis un mesaj despre ${line(input.chat.courtName)}. Deschide conversația din contul tău pentru a vedea detaliile și a răspunde.` : `${line(input.chat.customerName) || 'Un client'} ți-a trimis un mesaj. Deschide conversația din cont pentru a răspunde.`;
    rows = [...(client ? [{ label: 'Baza sportivă', value: base }] : []), { label: 'Teren', value: line(input.chat.courtName) }, { label: 'Mesaj', value: line(input.chat.preview).slice(0, 600) }];
    actions = [{ label: client ? 'Deschide conversația' : 'Deschide conversațiile', href: client ? clientChatAction(siteURL, input.chat.messageID) : appAction(siteURL, 'admin') }];
    after = client ? 'Pentru a continua conversația, folosește chatul din Spotivity. Ne vedem pe teren!' : '';
    content = (client ? section('Detalii mesaj') : '') + rowsHTML(rows) + actionsHTML(actions) + (client ? paragraph(after) : '');
  } else {
    const booking = input.booking;
    if (!booking || !Array.isArray(booking.hours) || !booking.hours.length || booking.hours.length > 24 || booking.hours.some(hour => typeof hour !== 'string' || !line(hour)) || !Number.isFinite(booking.amountRON) || booking.amountRON < 0) throw new TypeError('Invalid booking details');
    const owner = input.kind === 'booking_created_owner' || input.kind === 'booking_cancelled_owner';
    const created = input.kind === 'booking_created_client' || input.kind === 'booking_created_owner';
    rows = [
      { label: 'Locație', value: line(booking.baseName) || line(booking.courtName), href: mapsLink(booking.mapsURL) },
      { label: 'Teren', value: line(booking.courtName) }, { label: 'Sport', value: line(booking.sport) },
      { label: 'Oraș', value: line(booking.city) }, { label: 'Data', value: romanianDay(booking.dayISO) },
      { label: created ? 'Interval orar' : 'Ore', value: created ? interval(booking.hours) : booking.hours.map(line).join(', ') },
    ];
    const money = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(booking.amountRON) + ' lei';
    const payment = booking.paymentMethods === 'at_location' ? 'Plata se face la locație. Pentru metodele de plată disponibile, contactează baza sportivă.' : 'Plata se face la recepție, cash sau cu cardul.';
    const amountLabel = owner ? 'De încasat la locație' : 'Total de achitat la locație';
    const amountHTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="padding:18px;background:#eef3eb;border-radius:10px"><p style="margin:0 0 7px;font-size:12px;letter-spacing:.4px;color:#536454;font-weight:700;text-transform:uppercase">${escapeHTML(amountLabel)}</p><p style="margin:0;color:#172b20;font-size:27px;font-weight:700;line-height:1.2">${escapeHTML(money)}</p></td></tr></table>`;
    let contacts: Row[] = [];
    if (owner) contacts = [{ label: 'Nume client', value: line(booking.customerName) }, { label: 'Telefon', value: line(booking.customerPhone), href: phoneLink(booking.customerPhone) }, { label: 'E-mail', value: line(booking.customerEmail), href: emailLink(booking.customerEmail) }];
    switch (input.kind) {
      case 'booking_created_client': {
        title = 'Confirmare oficială a rezervării tale'; subject = `Rezervare confirmată: ${line(booking.courtName)} · ${BRAND}`;
        introduction = `Rezervarea ta la ${line(booking.baseName) || line(booking.courtName)} a fost înregistrată cu succes. Mai jos găsești toate detaliile pentru următorul meci.`;
        const cancel = validateTransactionalURL(input.cancellationURL), view = new URL(cancel), hash = new URLSearchParams(view.hash.slice(1));
        let viewURL = appAction(siteURL, 'reservation', booking);
        if (hash.has('anulare-rezervare') && hash.has('token')) { hash.set('rezervare', hash.get('anulare-rezervare')!); hash.delete('anulare-rezervare'); view.hash = hash.toString(); viewURL = validateTransactionalURL(view.href); }
        const calendar = calendarLink(booking, siteURL);
        actions = [...(calendar ? [{ label: 'Adaugă în Calendar', href: calendar }] : []), { label: 'Vezi rezervarea', href: viewURL, secondary: true }];
        notes.push('Te rugăm să ajungi cu 15 minute înainte de începerea orei rezervate, pentru a avea timp să te echipezi.');
        notes.push('Poți anula orele nefinalizate din rezervare. Rezervările finalizate nu pot fi anulate.');
        if (booking.cancellationDeadlineISO) notes.push(`Termen de anulare comunicat pentru această rezervare: ${deadlineLabel(booking.cancellationDeadlineISO)}.`);
        notes.push('Anulările cu mai puțin de o oră înainte sunt înregistrate pentru verificare.');
        after = 'Pentru anulare, deschide linkul și confirmă acțiunea. Păstrează linkul privat: oferă acces la anularea acestei rezervări.\nAnulează rezervarea: ' + cancel + '\n\nÎți mulțumim că ai ales Spotivity!\nAi întrebări legate de rezervarea ta?\nChat cu baza sportivă: ' + appAction(siteURL, 'chat', booking);
        content = section('Detalii rezervare') + rowsHTML(rows) + amountHTML + paragraph(payment) + actionsHTML(actions) + notes.map(note).join('') + `<p style="margin:16px 0 22px;font-size:13px;line-height:1.6"><a href="${escapeHTML(cancel)}" style="color:#315b40;text-decoration:underline">Anulează rezervarea</a> — deschide linkul și confirmă acțiunea. Păstrează acest link privat.</p>` + paragraph('Îți mulțumim că ai ales Spotivity!') + section('Ai întrebări legate de rezervarea ta?') + actionsHTML([{ label: 'Chat cu baza sportivă', href: appAction(siteURL, 'chat', booking), secondary: true }]);
        break;
      }
      case 'booking_created_owner':
        title = 'Rezervare nouă'; subject = `Rezervare nouă: ${line(booking.courtName)} · ${BRAND}`;
        introduction = 'A fost înregistrată o nouă rezervare pentru baza ta sportivă.';
        actions = [{ label: 'Deschide în Panoul de Administrare', href: appAction(siteURL, 'admin', booking) }, { label: 'Gestionează rezervarea', href: appAction(siteURL, 'reservation', booking), secondary: true }, { label: 'Chat cu clientul', href: appAction(siteURL, 'chat', booking), secondary: true }];
        after = 'Rezervarea este confirmată și apare în calendarul bazei.';
        content = section('Detalii rezervare') + rowsHTML(rows) + section('Detalii client') + rowsHTML(contacts) + amountHTML + paragraph(payment) + note(after) + actionsHTML(actions);
        break;
      case 'booking_cancelled_client':
      case 'booking_cancelled_owner': {
        title = booking.remainingHours?.length ? (owner ? 'O rezervare a fost anulată parțial' : 'O parte din rezervare a fost anulată') : owner ? 'O rezervare a fost anulată' : 'Rezervarea ta a fost anulată';
        subject = `Rezervare anulată: ${line(booking.courtName)} · ${BRAND}`;
        introduction = booking.remainingHours?.length ? `Orele afișate mai jos au fost anulate. Orele păstrate în rezervare: ${booking.remainingHours.map(line).join(', ')}.` : owner ? 'Anularea rezervării de mai jos a fost înregistrată. Intervalele eliberate pot fi rezervate din nou.' : `Anularea rezervării tale la ${line(booking.baseName) || line(booking.courtName)} a fost înregistrată cu succes. Mai jos găsești detaliile orelor anulate.`;
        rows.push({ label: 'Valoarea orelor anulate', value: money });
        actions = owner ? [{ label: 'Administrează rezervările', href: appAction(siteURL, 'admin', booking) }] : [{ label: 'Găsește un teren', href: siteURL }, { label: 'Accesează contul', href: appAction(siteURL, 'account'), secondary: true }];
        after = owner ? '' : booking.remainingHours?.length ? 'Au fost eliberate numai orele anulate. Restul rezervării tale rămâne neschimbat. Îți mulțumim că ai ales Spotivity!' : 'Orele anulate au fost eliberate. Când ești pregătit pentru următorul meci, poți alege un alt teren pe Spotivity. Ne vedem pe teren!';
        content = (owner ? '' : section('Detalii anulare')) + rowsHTML(rows) + (owner ? section('Detalii client') + rowsHTML(contacts) : note(booking.remainingHours?.length ? 'Orele păstrate în rezervare rămân confirmate. Valoarea de mai sus descrie numai orele anulate.' : 'Rezervarea este anulată. Valoarea de mai sus descrie orele anulate și nu reprezintă o solicitare de plată.')) + actionsHTML(actions) + (after ? paragraph(after) : '');
        break;
      }
      default: throw new TypeError('Unsupported transactional email kind');
    }
    rows = [...rows, ...contacts];
    if (created) rows.push({ label: amountLabel, value: money }, { label: 'Plată', value: payment });
  }
  subject = line(subject);
  const support = `Ai nevoie de ajutor? Scrie-ne la ${TRANSACTIONAL_SUPPORT_EMAIL}.`;
  const text = [BRAND, title, '', greeting, introduction, '', ...rows.filter(row => row.value).map(({ label, value, href }) => `${label}: ${value}${href ? ` (${href})` : ''}`), '', ...actions.map(({ label, href }) => `${label}: ${href}`), '', ...notes, after, '', support, '', footer, `Site: ${siteURL}`].filter((part, i, parts) => part !== '' || (i > 0 && parts[i - 1] !== '')).join('\n');
  const logoURL = new URL('assets/imagini/avatar2.png', siteURL).href;
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHTML(subject)}</title></head><body style="margin:0;padding:0;background:#edf2eb;color:#172b20;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#edf2eb;font-size:1px;line-height:1px">${escapeHTML(title)}</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#edf2eb" style="background:#edf2eb"><tr><td align="center" style="padding:24px 12px"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden"><tr><td bgcolor="#101a14" style="padding:23px 24px;background:#101a14"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:13px"><img src="${escapeHTML(logoURL)}" width="46" height="46" alt="" style="display:block;width:46px;height:46px;border:0"></td><td style="font-size:24px;line-height:1.2;font-weight:700;color:#d8b66a">Spotivity</td></tr></table></td></tr><tr><td style="padding:27px 24px"><h1 style="margin:0 0 21px;font-size:25px;line-height:1.3;color:#172b20;font-weight:700;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(title)}</h1>${paragraph(greeting)}${paragraph(introduction)}${content}<p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#536454;overflow-wrap:anywhere">Ai nevoie de ajutor? Scrie-ne la <a href="mailto:${TRANSACTIONAL_SUPPORT_EMAIL}" style="color:#315b40;text-decoration:underline;word-break:break-word">${TRANSACTIONAL_SUPPORT_EMAIL}</a>.</p></td></tr><tr><td bgcolor="#f5f7f2" style="padding:20px 24px;background:#f5f7f2;font-size:11px;line-height:1.7;color:#667262;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(footer)}<br><a href="${escapeHTML(siteURL)}" style="color:#315b40;text-decoration:underline">Deschide Spotivity</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { to, subject, html, text };
}
