import { deriveBookingCancellationToken, hashCancellationToken } from '../_shared/booking-token.ts';

type Json = Record<string, any>;
type Config = { url: string; anonKey: string; serviceKey: string; cancelSecret?: string };
type Dependencies = { fetch?: typeof fetch; now?: () => number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\x00-\x1f\x7f]/;
const MAX_BODY = 32768;
const ACTIONS = new Set(['create', 'create_guest', 'preview_cancel', 'cancel', 'cancel_owned']);

class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const invalid = (message = 'Verifică datele rezervării.') => new ApiError(400, 'invalid_input', message);
const unavailable = () => new ApiError(503, 'service_unavailable', 'Serviciul nu este disponibil momentan. Reîncearcă folosind aceeași cerere.');
function object(value: unknown): value is Json { return !!value && typeof value === 'object' && !Array.isArray(value); }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw invalid(); return value.toLowerCase(); }
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw invalid();
  const normalized = value.trim();
  if ([...normalized].length < min || [...normalized].length > max || CONTROL.test(normalized)) throw invalid();
  return normalized;
}
function createInput(input: Json): Json {
  const requestId = uuid(input.request_id);
  const courtId = text(input.court_id, 1, 80);
  if (!UUID.test(courtId) && !/^[1-9][0-9]{0,18}$/.test(courtId)) throw invalid();
  const day = text(input.day, 10, 10);
  if (!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(day)) throw invalid();
  const parsed = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw invalid();
  if (!Array.isArray(input.hours) || input.hours.length < 1 || input.hours.length > 14 || input.hours.some(hour => typeof hour !== 'string' || !/^(09|1[0-9]|2[0-2]):00$/.test(hour))) throw new ApiError(400, 'invalid_hours', 'Alege ore consecutive pentru același teren.');
  const hours = [...input.hours].sort();
  if (hours.some((hour, index) => index > 0 && Number(hour.slice(0, 2)) !== Number(hours[index - 1].slice(0, 2)) + 1)) throw new ApiError(400, 'invalid_hours', 'Alege ore consecutive pentru același teren.');
  if (typeof input.with_ball !== 'boolean') throw invalid();
  const result: Json = { p_request_id: requestId, p_court_id: UUID.test(courtId) ? courtId.toLowerCase() : courtId, p_day: day, p_hours: hours, p_with_ball: input.with_ball };
  if (input.action === 'create_guest') {
    result.p_contact_name = text(input.contact_name, 1, 200);
    result.p_email = text(input.email, 3, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.p_email)) throw invalid('Adresa de email nu este validă.');
    result.p_phone = text(input.phone, 7, 50);
    const digits = result.p_phone.replace(/\D/g, '');
    if (!/^\+?[0-9 ().-]+$/.test(result.p_phone) || digits.length < 7 || digits.length > 15) throw invalid('Numărul de telefon nu este valid.');
  }
  return result;
}
function allowedOrigin(origin: string | null): boolean {
  if (!origin || origin === 'https://spotivity.ro' || origin === 'https://www.spotivity.ro'
    || origin === 'https://spotivityrezervari-netizen.github.io') return true;
  try { const url = new URL(origin); return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === origin; } catch { return false; }
}
async function boundedBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new ApiError(413, 'invalid_input', 'Cererea este prea mare.');
  if (!request.body) throw invalid();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > MAX_BODY) { await reader.cancel(); throw new ApiError(413, 'invalid_input', 'Cererea este prea mare.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Only these non-contact fields may leave the service. In particular, private
// delivery RPCs can never accidentally expose guest names, emails, or phones.
function publicBooking(value: unknown): Json {
  if (!object(value) || !UUID.test(value.booking_id ?? '') || typeof value.court_name !== 'string' || !Array.isArray(value.hours) || !Number.isFinite(Number(value.total))) throw unavailable();
  const result: Json = {};
  for (const key of ['booking_id', 'reservation_ids', 'court_id', 'court_name', 'sport', 'day', 'hours', 'total', 'state']) {
    if (Object.hasOwn(value, key)) result[key] = value[key];
  }
  if (Array.isArray(value.cancellable_hours)) { result.cancellable_hours = value.cancellable_hours; result.can_cancel = value.cancellable_hours.length > 0; }
  else if (typeof value.can_cancel === 'boolean') result.can_cancel = value.can_cancel;
  if (Number.isInteger(value.cancelled_count) && value.cancelled_count >= 0) result.cancelled_count = value.cancelled_count;
  return result;
}

export function createHandler(config: Config, dependencies: Dependencies = {}) {
  const transport = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const base = config.url.replace(/\/$/, '');
  const service = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` };
  const limits = new Map<string, { start: number; count: number }>();
  async function call(path: string, headers: Record<string, string>, body?: unknown): Promise<{ response: Response; data: any }> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await transport(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      let data: any; try { data = await response.json(); } catch { throw unavailable(); }
      return { response, data };
    } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
    finally { clearTimeout(timer); }
  }
  function upstream(response: Response, data: any): ApiError {
    // Inspect known SQL conditions, but never return SQL messages or details.
    const message = String(data?.message ?? '');
    if (response.status === 429 || /quota|rate.limit|too many|daily limit/i.test(message)) return new ApiError(429, 'rate_limit', 'Ai trimis prea multe cereri. Reîncearcă mai târziu.');
    if (response.status >= 500) return unavailable();
    if (/one active booking per sport|one booking per sport/i.test(message)) return new ApiError(409, 'booking_limit', 'Poți avea o singură rezervare la același sport în aceeași zi, indiferent de teren sau oraș. Alege mai multe ore consecutive într-o singură rezervare.');
    if (/completed bookings cannot be cancelled|completed.*cancel/i.test(message)) return new ApiError(409, 'completed_booking', 'Rezervările finalizate nu pot fi anulate.');
    if (/invalid cancellation link/i.test(message)) return new ApiError(403, 'invalid_cancellation', 'Linkul de anulare nu este valid.');
    if (/consecutive/i.test(message)) return new ApiError(400, 'invalid_hours', 'Alege ore consecutive pentru același teren.');
    if (data?.code === '23505' && /request identifier/i.test(message)) return new ApiError(409, 'conflict', 'Identificatorul cererii este deja folosit pentru alte date.');
    if (['23505', '23P01', '40001'].includes(data?.code) || /unavailable|already reserved|occupied|slot.*taken/i.test(message)) return new ApiError(409, 'slot_unavailable', 'Un interval ales nu mai este disponibil. Reîncarcă programul.');
    if (response.status === 401 || /confirmed account|sign in/i.test(message)) return new ApiError(401, 'unauthenticated', 'Autentifică-te din nou cu un cont confirmat.');
    if (response.status === 403 || data?.code === '42501') return new ApiError(403, 'forbidden', 'Nu ai permisiunea pentru această operațiune.');
    return invalid();
  }
  async function rpc(name: string, headers: Record<string, string>, args: Json): Promise<any> {
    const result = await call(`/rest/v1/rpc/${name}`, headers, args);
    if (!result.response.ok) throw upstream(result.response, result.data);
    return result.data;
  }
  async function requireUser(request: Request): Promise<Record<string, string>> {
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer [^\s]{16,10000}$/i.test(authorization) || authorization === `Bearer ${config.serviceKey}` || authorization === `Bearer ${config.anonKey}`) throw new ApiError(401, 'unauthenticated', 'Autentifică-te pentru această operațiune.');
    const headers = { apikey: config.anonKey, Authorization: authorization };
    const auth = await call('/auth/v1/user', headers);
    if (!auth.response.ok || !UUID.test(auth.data?.id ?? '')) throw new ApiError(401, 'unauthenticated', 'Sesiunea nu mai este validă. Autentifică-te din nou.');
    return headers;
  }
  function rateLimit(request: Request, action: string): void {
    const client = (request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim().slice(0, 128);
    const category = action === 'create_guest' ? 'guest' : action === 'create' ? 'account' : 'cancellation';
    const key = `${category}:${client}`; const current = now(); const period = limits.get(key);
    const allowed = category === 'guest' ? 10 : category === 'account' ? 30 : 60;
    if (period && current - period.start < 600000) { if (++period.count > allowed) throw new ApiError(429, 'rate_limit', 'Prea multe încercări. Reîncearcă mai târziu.'); }
    else { if (limits.size > 10000) limits.clear(); limits.set(key, { start: current, count: 1 }); }
  }
  async function dispatch(bookingId: string): Promise<string> {
    try {
      const result = await call('/functions/v1/booking-notifications', service, { action: 'dispatch', booking_id: bookingId });
      return result.response.ok && ['queued', 'submitted', 'pending_configuration'].includes(result.data?.status) ? result.data.status : 'queued';
    } catch { return 'queued'; }
  }
  async function prepareDelivery(bookingId: string): Promise<boolean> {
    try {
      const token = await deriveBookingCancellationToken(config.cancelSecret ?? '', bookingId);
      const attached = await rpc('attach_cancellation_token', service, { p_booking_id: bookingId, p_token_hash: await hashCancellationToken(token) });
      return attached === true;
    } catch { return false; }
  }

  return async function handler(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const cors: Record<string, string> = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin && allowedOrigin(origin)) cors['Access-Control-Allow-Origin'] = origin;
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    try {
      if (!allowedOrigin(origin)) throw new ApiError(403, 'forbidden', 'Origine nepermisă.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return reply({ error: 'Folosește POST.', code: 'invalid_input' }, 405);
      if (!config.url || !config.anonKey || !config.serviceKey) throw unavailable();
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw invalid();
      let input: Json;
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBody(request))); }
      catch (error) { if (error instanceof ApiError) throw error; throw invalid(); }
      if (!object(input) || !ACTIONS.has(input.action) || Object.hasOwn(input, 'password')) throw invalid();

      if (input.action === 'create' || input.action === 'create_guest') {
        const args = createInput(input);
        if (!config.cancelSecret) throw unavailable();
        rateLimit(request, input.action);
        let headers = service;
        if (input.action === 'create_guest') {
          let ready = false;
          try { const status = await rpc('booking_notification_status', service, {}); ready = status?.ready === true; } catch { /* Fail closed before creating a guest booking without an email path. */ }
          if (!ready) throw new ApiError(503, 'guest_unavailable', 'Rezervarea fără cont nu este disponibilă momentan. Folosește un cont sau reîncearcă mai târziu.');
        } else headers = await requireUser(request);
        const result = publicBooking(await rpc(input.action === 'create_guest' ? 'create_guest_booking_group' : 'create_booking_group', headers, args));
        // Creation is already committed. Delivery failures are retried from the
        // outbox and must never turn a successful booking into an apparent error.
        const prepared = await prepareDelivery(result.booking_id);
        result.notification_status = prepared ? await dispatch(result.booking_id) : 'queued';
        return reply(result, 201);
      }

      const bookingId = uuid(input.booking_id);
      let headers = service;
      let args: Json = { p_booking_id: bookingId };
      if (input.action === 'cancel_owned') headers = await requireUser(request);
      else {
        if (typeof input.token !== 'string' || !/^[0-9a-f]{64}$/.test(input.token)) throw new ApiError(403, 'invalid_cancellation', 'Linkul de anulare nu este valid.');
        args = { ...args, p_token_hash: await hashCancellationToken(input.token) };
      }
      rateLimit(request, input.action);
      const method = input.action === 'preview_cancel' ? 'preview_booking_cancellation' : input.action === 'cancel_owned' ? 'cancel_owned_booking_group' : 'cancel_booking_group_by_token';
      const result = publicBooking(await rpc(method, headers, args));
      if (input.action !== 'preview_cancel') result.notification_status = await dispatch(bookingId);
      return reply(result);
    } catch (error) {
      const failure = error instanceof ApiError ? error : unavailable();
      return reply({ error: failure.message, code: failure.code }, failure.status);
    }
  };
}
