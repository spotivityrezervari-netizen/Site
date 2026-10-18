/**
 * Transport-neutral Romanian transactional email templates.
 *
 * Callers must obtain the booking/contact details from trusted server records,
 * authorize recipients, and create any cancellation token separately. This
 * module does not fetch, send mail, create tokens, log data, or accept credentials.
 * `dayISO` is a calendar date (YYYY-MM-DD), not a UTC timestamp. `hours` contains
 * already formatted local hour/range labels, e.g. ["18:00–19:00", "19:00–20:00"].
 * Supply a cancellationURL only for booking_created_client. Visiting that URL
 * should show a confirmation page; a GET request must not cancel the booking.
 */
export const TRANSACTIONAL_SITE_URL = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';

export type MailRecipient = { email: string; name?: string };
export type BookingMailDetails = {
  id: string | number;
  courtName: string;
  sport: string;
  baseName: string;
  city: string;
  dayISO: string;
  hours: readonly string[];
  remainingHours?: readonly string[];
  amountRON: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};
export type ChatMailDetails = { courtName: string; customerName: string; preview: string };
type CommonInput = { recipient: MailRecipient; siteURL?: string };
export type TransactionalMailInput = CommonInput & (
  | { kind: 'booking_created_client'; booking: BookingMailDetails; cancellationURL: string }
  | { kind: 'booking_created_owner' | 'booking_cancelled_client' | 'booking_cancelled_owner'; booking: BookingMailDetails; cancellationURL?: never }
  | { kind: 'chat_owner'; chat: ChatMailDetails; cancellationURL?: never }
);
export type RenderedTransactionalMail = { to: MailRecipient; subject: string; html: string; text: string };

const BRAND = 'Spotivity';
const PRODUCTION_ORIGIN = 'https://spotivityrezervari-netizen.github.io';
const PRODUCTION_PATH = '/Site/Idee Site/';
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const escapeHTML = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const line = (value: unknown): string => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

/** Accept only absolute HTTPS links within this app, including opaque query tokens. */
export function validateTransactionalURL(value: string): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Invalid transactional email URL');
  let url: URL;
  let decodedPath: string;
  try { url = new URL(value); decodedPath = decodeURIComponent(url.pathname); }
  catch { throw new TypeError('Invalid transactional email URL'); }
  if (url.protocol !== 'https:' || url.origin !== PRODUCTION_ORIGIN || url.username || url.password || !decodedPath.startsWith(PRODUCTION_PATH) || /[\\\u0000-\u001f\u007f]/.test(decodedPath) || decodedPath.split('/').some(part => part === '.' || part === '..')) {
    throw new TypeError('Transactional email links must stay inside the production app');
  }
  return url.href;
}

function recipient(value: MailRecipient): MailRecipient {
  if (!value || typeof value.email !== 'string' || value.email.length > 254 || !/^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/.test(value.email)) throw new TypeError('Invalid email recipient');
  const name = line(value.name);
  return name ? { email: value.email, name } : { email: value.email };
}

function romanianDay(value: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Booking day must be YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new TypeError('Invalid booking day');
  return new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' }).format(date);
}

function bookingRows(booking: BookingMailDetails, owner: boolean): [string, string][] {
  if (!booking || !Array.isArray(booking.hours) || !booking.hours.length || booking.hours.length > 24 || booking.hours.some(hour => typeof hour !== 'string' || !line(hour)) || !Number.isFinite(booking.amountRON) || booking.amountRON < 0) throw new TypeError('Invalid booking details');
  const rows: [string, string][] = [
    ['Baza sportivă', line(booking.baseName)], ['Teren', line(booking.courtName)],
    ['Sport', line(booking.sport)], ['Oraș', line(booking.city)],
    ['Data', romanianDay(booking.dayISO)], ['Ore', booking.hours.map(line).join(', ')],
    ['Total', new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'RON', maximumFractionDigits: 2 }).format(booking.amountRON)],
  ];
  if (owner) rows.push(['Client', line(booking.customerName)], ['Email client', line(booking.customerEmail)], ['Telefon client', line(booking.customerPhone)]);
  rows.push(['Referință rezervare', line(booking.id)]);
  return rows.filter(([, value]) => value !== '');
}

function rowsHTML(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${rows.map(([label, value]) => `<tr><td style="width:35%;vertical-align:top;padding:10px 12px 10px 0;border-bottom:1px solid #dce4dc;color:#536454;font-size:14px">${escapeHTML(label)}</td><td style="vertical-align:top;padding:10px 0;border-bottom:1px solid #dce4dc;color:#172b20;font-size:15px;font-weight:600;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(value)}</td></tr>`).join('')}</table>`;
}

/** Render HTML and plaintext alternatives, ready for an independently configured mail transport. */
export function renderTransactionalMail(input: TransactionalMailInput): RenderedTransactionalMail {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid transactional email input');
  const to = recipient(input.recipient);
  const siteURL = validateTransactionalURL(input.siteURL ?? TRANSACTIONAL_SITE_URL);
  let title: string, introduction: string, subject: string, rows: [string, string][], buttonLabel: string, buttonURL: string;
  let after = '';
  if (input.kind === 'chat_owner') {
    if (!input.chat || typeof input.chat.preview !== 'string') throw new TypeError('Invalid chat details');
    title = 'Ai un mesaj nou';
    subject = `Mesaj nou pentru ${line(input.chat.courtName)} · ${BRAND}`;
    introduction = `${line(input.chat.customerName) || 'Un client'} ți-a trimis un mesaj. Deschide conversația din cont pentru a răspunde.`;
    rows = [['Teren', line(input.chat.courtName)], ['Mesaj', line(input.chat.preview).slice(0, 600)]];
    buttonLabel = 'Deschide conversațiile'; buttonURL = siteURL;
  } else {
    const owner = input.kind === 'booking_created_owner' || input.kind === 'booking_cancelled_owner';
    rows = bookingRows(input.booking, owner);
    switch (input.kind) {
      case 'booking_created_client':
        title = 'Rezervarea ta este confirmată';
        subject = `Rezervare confirmată: ${line(input.booking.courtName)} · ${BRAND}`;
        introduction = 'Mai jos găsești detaliile rezervării tale. Păstrează acest email pentru a le consulta oricând.';
        buttonLabel = 'Anulează rezervarea'; buttonURL = validateTransactionalURL(input.cancellationURL);
        after = 'Pentru anulare, deschide linkul și confirmă acțiunea. Păstrează linkul privat: oferă acces la anularea acestei rezervări.';
        break;
      case 'booking_created_owner':
        title = 'Ai primit o rezervare nouă';
        subject = `Rezervare nouă: ${line(input.booking.courtName)} · ${BRAND}`;
        introduction = 'Un client a rezervat terenul tău. Datele de contact și intervalele rezervate sunt mai jos.';
        buttonLabel = 'Administrează rezervările'; buttonURL = siteURL;
        break;
      case 'booking_cancelled_client':
        title = input.booking.remainingHours?.length ? 'O parte din rezervare a fost anulată' : 'Rezervarea ta a fost anulată';
        subject = `Rezervare anulată: ${line(input.booking.courtName)} · ${BRAND}`;
        introduction = input.booking.remainingHours?.length ? `Orele afișate mai jos au fost anulate. Orele păstrate în rezervare: ${input.booking.remainingHours.map(line).join(', ')}.` : 'Anularea rezervării de mai jos a fost înregistrată. Intervalele eliberate pot fi rezervate din nou.';
        buttonLabel = 'Găsește un teren'; buttonURL = siteURL;
        break;
      case 'booking_cancelled_owner':
        title = input.booking.remainingHours?.length ? 'O rezervare a fost anulată parțial' : 'O rezervare a fost anulată';
        subject = `Rezervare anulată: ${line(input.booking.courtName)} · ${BRAND}`;
        introduction = input.booking.remainingHours?.length ? `Orele afișate mai jos au fost anulate. Orele păstrate în rezervare: ${input.booking.remainingHours.map(line).join(', ')}.` : 'Rezervarea de mai jos a fost anulată. Intervalele eliberate pot fi rezervate din nou.';
        buttonLabel = 'Administrează rezervările'; buttonURL = siteURL;
        break;
      default: throw new TypeError('Unsupported transactional email kind');
    }
  }
  // An untyped caller cannot accidentally expose cancellation credentials to an owner.
  if (input.kind !== 'booking_created_client' && 'cancellationURL' in input && input.cancellationURL !== undefined) throw new TypeError('Cancellation links are for the booking client only');
  subject = line(subject);
  const greeting = to.name ? `Bună, ${to.name}!` : 'Bună!';
  const text = [BRAND, title, '', greeting, introduction, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `${buttonLabel}: ${buttonURL}`, after, '', `Acesta este un mesaj automat ${BRAND}.`, `Site: ${siteURL}`].filter((part, index, parts) => part !== '' || (index > 0 && parts[index - 1] !== '')).join('\n');
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(subject)}</title></head><body style="margin:0;padding:0;background:#edf2eb;color:#172b20;font-family:Arial,sans-serif"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#edf2eb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden"><tr><td style="padding:25px 24px;background:#101a14;color:#d8b66a;font-size:23px;font-weight:700">${BRAND}</td></tr><tr><td style="padding:28px 24px"><h1 style="margin:0 0 20px;font-size:25px;line-height:1.3;color:#172b20">${escapeHTML(title)}</h1><p style="margin:0 0 12px;line-height:1.6">${escapeHTML(greeting)}</p><p style="margin:0 0 22px;line-height:1.6">${escapeHTML(introduction)}</p>${rowsHTML(rows)}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 18px;width:100%"><tr><td align="center" style="border-radius:12px;background:#d8b66a"><a href="${escapeHTML(buttonURL)}" style="display:block;padding:16px 20px;color:#172b20;font-size:16px;font-weight:700;text-align:center;text-decoration:none;line-height:1.4">${escapeHTML(buttonLabel)}</a></td></tr></table>${after ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#536454">${escapeHTML(after)}</p>` : ''}<p style="font-size:12px;line-height:1.6;color:#536454;overflow-wrap:anywhere;word-break:break-word">Dacă butonul nu funcționează, copiază acest link în browser:<br><a href="${escapeHTML(buttonURL)}" style="color:#355b43;overflow-wrap:anywhere;word-break:break-word">${escapeHTML(buttonURL)}</a></p></td></tr><tr><td style="padding:20px 24px;background:#f5f7f2;font-size:12px;line-height:1.6;color:#536454">Acesta este un mesaj automat ${BRAND}.<br><a href="${escapeHTML(siteURL)}" style="color:#355b43">Deschide site-ul</a></td></tr></table></td></tr></table></body></html>`;
  return { to, subject, html, text };
}
