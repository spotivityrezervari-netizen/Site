// This module has no runtime dependencies. Auth remains Supabase Auth; passwords
// are only sent to its normal signup/password endpoints and are never persisted.
type Config = { url: string; anonKey: string; serviceKey: string };
type Dependencies = { fetch?: typeof fetch; now?: () => number };
type Json = Record<string, any>;

const MAX_PHOTO = 5 * 1024 * 1024;
const MAX_BODY = MAX_PHOTO + 65536;
const PRIVATE_BUCKET = 'cereri_baze_sportive';
const PUBLIC_BUCKET = 'poze_baze_sportive';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPORTS = new Set(['Fotbal', 'Baschet', 'Tenis', 'Volei', 'Tenis Picior']);
const MAPS = /^https:\/\/((www\.)?google\.(com|ro)\/maps([/?#][^\s]*)?|maps\.google\.(com|ro)\/[^\s]*|maps\.app\.goo\.gl\/[A-Za-z0-9_-]+([?][^\s]*)?|goo\.gl\/maps\/[A-Za-z0-9_-]+([?][^\s]*)?)$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const MULTILINE_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const invalid = (message = 'Verifică datele completate.') => new ApiError(400, 'invalid_input', message);
const unavailable = () => new ApiError(503, 'service_unavailable', 'Serviciul nu este disponibil momentan. Reîncearcă folosind aceeași cerere.');
function object(value: unknown): value is Json { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, min: number, max: number, multiline = false): string {
  if (typeof value !== 'string') throw invalid();
  const normalized = value.trim();
  if ([...normalized].length < min || [...normalized].length > max || (multiline ? MULTILINE_CONTROL : CONTROL).test(normalized)) throw invalid();
  return normalized;
}
function optionalText(value: unknown, max: number, multiline = false): string | null {
  return value === null || value === undefined || value === '' ? null : text(value, 0, max, multiline) || null;
}
function prices(value: unknown, length?: number): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || (length !== undefined && value.length !== length) || value.some(p => !Number.isInteger(p) || p < 0 || p > 100000)) throw invalid('Completează un preț întreg între 0 și 100000 pentru fiecare teren.');
  return value;
}
function submitInput(input: Json): Json {
  if (typeof input.request_id !== 'string' || !UUID.test(input.request_id)) throw invalid();
  const email = text(input.email, 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Adresa de email nu este validă.');
  const phone = text(input.telefon, 7, 50);
  if (!/^\+?[0-9 ().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) throw invalid('Numărul de telefon nu este valid.');
  const maps = text(input.link_maps, 10, 2048);
  if (!MAPS.test(maps)) throw invalid('Folosește un link Google Maps HTTPS.');
  if (!Array.isArray(input.terenuri) || input.terenuri.length < 1 || input.terenuri.length > 20) throw invalid();
  const courts = input.terenuri.map(court => {
    if (!object(court) || Object.keys(court).some(k => !['nume', 'sport'].includes(k)) || !SPORTS.has(court.sport)) throw invalid();
    return { nume: text(court.nume, 2, 160), sport: court.sport };
  });
  if (typeof input.password !== 'string' || [...input.password].length < 6 || new TextEncoder().encode(input.password).length > 72 || /[\x00\r\n]/.test(input.password)) throw invalid('Parola trebuie să aibă cel puțin 6 caractere și cel mult 72 de octeți.');
  return { request_id: input.request_id.toLowerCase(), nume_baza: text(input.nume_baza, 2, 160), nume_contact: text(input.nume_contact, 2, 160), email, telefon: phone, oras: text(input.oras, 2, 120), adresa: optionalText(input.adresa, 300), link_maps: maps, terenuri: courts, prices: prices(input.prices, courts.length), descriere: optionalText(input.descriere, 3000, true), password: input.password };
}
function imageType(bytes: Uint8Array, declared: string): { mime: string; ext: string } {
  const at = (offset: number, word: string) => word.split('').every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  let found;
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) found = { mime: 'image/png', ext: 'png' };
  else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) found = { mime: 'image/jpeg', ext: 'jpg' };
  else if (bytes.length >= 12 && at(0, 'RIFF') && at(8, 'WEBP')) found = { mime: 'image/webp', ext: 'webp' };
  else if (bytes.length >= 6 && (at(0, 'GIF87a') || at(0, 'GIF89a'))) found = { mime: 'image/gif', ext: 'gif' };
  else if (bytes.length >= 16 && at(4, 'ftyp') && [8,16,20,24,28].some(offset => at(offset, 'avif') || at(offset, 'avis'))) found = { mime: 'image/avif', ext: 'avif' };
  if (!found || declared.toLowerCase() !== found.mime) throw invalid('Fotografia trebuie să fie JPEG, PNG, WebP, AVIF sau GIF, cu formatul corect.');
  return found;
}
async function boundedBody(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new ApiError(413, 'invalid_input', 'Fișierul sau formularul este prea mare.');
  if (!request.body) throw invalid();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > max) { await reader.cancel(); throw new ApiError(413, 'invalid_input', 'Fișierul sau formularul este prea mare.'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
function duplicate(response: Response, data: Json): boolean { return response.status === 409 || /duplicate|already exists/i.test([data?.error, data?.code, data?.message].join(' ')); }
async function digest(bytes: Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2,'0')).join(''); }
function allowedOrigin(origin: string | null): boolean {
  if (!origin || origin === 'https://spotivityrezervari-netizen.github.io') return true;
  try { const url = new URL(origin); return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.origin === origin; } catch { return false; }
}

export function createHandler(config: Config, dependencies: Dependencies = {}) {
  const transport = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const base = config.url.replace(/\/$/, '');
  const limits = new Map<string, { start: number; count: number }>();
  const service = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` };
  const anon = { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` };
  async function call(path: string, headers: Record<string,string>, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try { return await transport(base + path, { ...options, headers: { ...headers, ...options.headers }, signal: controller.signal }); }
    catch { throw unavailable(); } finally { clearTimeout(timer); }
  }
  async function readJson(response: Response): Promise<Json> { try { return await response.json(); } catch { throw unavailable(); } }
  async function jsonCall(path: string, headers: Record<string,string>, body?: unknown): Promise<{ response: Response; data: any }> {
    const response = await call(path, headers, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, data: await readJson(response) };
  }
  function upstream(response: Response, data: Json): ApiError {
    if (response.status === 429 || /five .*24 hours|rate.limit|too many/i.test(String(data?.message ?? data?.msg ?? ''))) return new ApiError(429, 'rate_limit', 'Prea multe încercări. Reîncearcă mai târziu.');
    if (response.status >= 500) return unavailable();
    if (data?.code === '42501' || response.status === 403) return new ApiError(403, 'forbidden', 'Nu ai permisiunea pentru această operațiune.');
    if (/confirm/i.test(String(data?.message ?? data?.msg ?? ''))) return new ApiError(409, 'email_confirmation_required', 'Adresa de email trebuie confirmată înainte de acceptarea cererii.');
    if (response.status === 409 || ['23505','40001'].includes(data?.code) || /already|modified|changed|different|unavailable|stale|actualizat|conflict/i.test(String(data?.message ?? ''))) return new ApiError(409, 'conflict', 'Cererea a fost modificată sau identificatorul este deja folosit. Reîncarcă lista.');
    return invalid('Operațiunea nu a fost finalizată. Verifică datele și reîncearcă.');
  }
  async function applicant(email: string, password: string, contact: { nume: string; telefon: string }): Promise<Json> {
    const login = await jsonCall('/auth/v1/token?grant_type=password', anon, { email, password });
    if (login.response.ok && UUID.test(login.data?.user?.id ?? '') && login.data.user.email?.toLowerCase() === email) return login.data.user;
    if (login.response.status === 429 || login.response.status >= 500) throw upstream(login.response, login.data);
    if (login.data?.code === 'email_not_confirmed' || login.data?.error_code === 'email_not_confirmed') throw new ApiError(409, 'email_confirmation_required', 'Confirmă adresa de email înainte de a retrimite cererea.');
    // Use normal signup, preserving the project's email confirmation settings.
    // Existing confirmed addresses produce an obfuscated Auth user: a service
    // lookup and fresh account timestamp prevent attaching that fake identity.
    const started = now();
    const signup = await jsonCall('/auth/v1/signup', anon, { email, password, data: contact });
    if (!signup.response.ok) {
      if (signup.response.status === 429 || signup.response.status >= 500) throw upstream(signup.response, signup.data);
      throw new ApiError(401, 'invalid_credentials', 'Pentru un cont existent, folosește parola lui. Verifică și confirmarea adresei de email.');
    }
    const candidate = signup.data?.user ?? signup.data;
    if (!UUID.test(candidate?.id ?? '') || !Array.isArray(candidate.identities) || candidate.identities.length === 0) throw new ApiError(401, 'invalid_credentials', 'Pentru un cont existent, folosește parola lui.');
    const lookup = await jsonCall(`/auth/v1/admin/users/${candidate.id}`, service);
    const real = lookup.data?.user ?? lookup.data;
    const created = Date.parse(real?.created_at);
    if (!lookup.response.ok || real?.id !== candidate.id || real?.email?.toLowerCase() !== email || !Number.isFinite(created) || created < started - 1000 || created > now() + 60000) throw new ApiError(401, 'invalid_credentials', 'Pentru un cont existent, folosește parola lui.');
    return real;
  }
  async function uploadPrivate(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    const response = await call(`/storage/v1/object/${PRIVATE_BUCKET}/${path}`, service, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes });
    if (response.ok) return;
    const data = await readJson(response);
    if (!duplicate(response, data)) throw upstream(response, data);
    const existing = await call(`/storage/v1/object/${PRIVATE_BUCKET}/${path}`, service);
    if (!existing.ok || await digest(new Uint8Array(await existing.arrayBuffer())) !== await digest(bytes)) throw new ApiError(409, 'conflict', 'Cererea are deja o altă fotografie. Folosește un identificator nou.');
  }
  async function requireSuper(request: Request): Promise<Record<string,string>> {
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer [^\s]{16,10000}$/i.test(authorization)) throw new ApiError(401, 'forbidden', 'Autentifică-te ca superadmin.');
    const headers = { apikey: config.anonKey, Authorization: authorization };
    const auth = await jsonCall('/auth/v1/user', headers);
    if (!auth.response.ok || !UUID.test(auth.data?.id ?? '')) throw new ApiError(401, 'forbidden', 'Sesiunea nu mai este validă. Autentifică-te din nou.');
    const role = await jsonCall(`/rest/v1/users_admin?select=user_id,is_super&user_id=eq.${auth.data.id}`, headers);
    if (!role.response.ok) throw upstream(role.response, role.data);
    if (!Array.isArray(role.data) || role.data.length !== 1 || role.data[0].is_super !== true) throw new ApiError(403, 'forbidden', 'Doar superadminul poate accepta sau respinge cereri.');
    return headers;
  }
  async function cleanupCopy(path: string): Promise<void> {
    // A failed transport can hide a committed transaction. Only delete when a
    // successful service read proves no base references the staged object.
    try {
      const bases = await jsonCall(`/rest/v1/baze_sportive?select=id&poza=eq.${encodeURIComponent(path)}`, service);
      if (!bases.response.ok || !Array.isArray(bases.data) || bases.data.length !== 0) return;
      await call(`/storage/v1/object/${PUBLIC_BUCKET}`, service, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) });
    } catch { /* An uncertain cleanup must never remove an accepted base photo. */ }
  }
  async function publishPhoto(row: Json): Promise<{ path: string; created: boolean } | null> {
    if (!row.poza_path) return null;
    // Migration 011 used a random UUID filename. New Edge submissions use the
    // request UUID, but legacy private photos must remain approvable as well.
    const parts = typeof row.poza_path === 'string' ? row.poza_path.split('/') : [];
    const filename = parts[2]?.match(/^([0-9a-f-]{36})\.(jpg|jpeg|png|webp|avif|gif)$/);
    if (!UUID.test(row.reserved_base_id ?? '') || !UUID.test(row.solicitant_user_id ?? '') || parts.length !== 3 || parts[0] !== row.solicitant_user_id || parts[1] !== row.id || !filename || !UUID.test(filename[1])) throw invalid('Fotografia cererii nu este validă.');
    const ext = row.poza_path.split('.').pop();
    const source = await call(`/storage/v1/object/${PRIVATE_BUCKET}/${row.poza_path}`, service);
    if (!source.ok) throw upstream(source, await readJson(source));
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_PHOTO) throw invalid('Fotografia cererii nu este validă.');
    imageType(bytes, source.headers.get('content-type')?.split(';')[0] ?? '');
    // Each invocation owns its staged object. Reusing a deterministic path can
    // let one failed transaction delete a concurrent approval's pending photo.
    // UUID collisions must allocate a fresh path, never reuse or overwrite it.
    for (let attempt = 0; attempt < 3; attempt++) {
      const path = `${row.reserved_base_id}/${crypto.randomUUID()}.${ext}`;
      const copied = await jsonCall('/storage/v1/object/copy', service, { bucketId: PRIVATE_BUCKET, sourceKey: row.poza_path, destinationBucket: PUBLIC_BUCKET, destinationKey: path });
      if (copied.response.ok) return { path, created: true };
      if (!duplicate(copied.response, copied.data)) throw upstream(copied.response, copied.data);
    }
    throw new ApiError(409, 'conflict', 'Fotografia nu a putut fi pregătită. Reîncearcă acceptarea.');
  }
  return async function handler(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const cors: Record<string,string> = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' };
    if (origin && allowedOrigin(origin)) cors['Access-Control-Allow-Origin'] = origin;
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    try {
      if (!allowedOrigin(origin)) throw new ApiError(403, 'forbidden', 'Origine nepermisă.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return reply({ error: 'Folosește POST.', code: 'invalid_input' }, 405);
      if (!config.url || !config.anonKey || !config.serviceKey) throw unavailable();
      const contentType = request.headers.get('content-type') ?? '';
      let input: Json; let photo: File | null = null;
      if (/^multipart\/form-data;/i.test(contentType)) {
        const raw = await boundedBody(request, MAX_BODY);
        let form: FormData; try { form = await new Response(raw, { headers: { 'Content-Type': contentType } }).formData(); } catch { throw invalid(); }
        if (Array.from(form.keys()).some(k => !['payload','photo'].includes(k)) || form.getAll('payload').length !== 1 || form.getAll('photo').length > 1) throw invalid();
        const payload = form.get('payload');
        if (typeof payload !== 'string' || new TextEncoder().encode(payload).length > 32768) throw invalid();
        try { input = JSON.parse(payload); } catch { throw invalid(); }
        const file = form.get('photo');
        if (file !== null && !(file instanceof File)) throw invalid();
        if (file instanceof File && file.size) photo = file;
        if (!object(input) || input.action !== 'submit') throw invalid();
      } else if (/^application\/json(?:;|$)/i.test(contentType)) {
        const raw = await boundedBody(request, 65536);
        try { input = JSON.parse(new TextDecoder().decode(raw)); } catch { throw invalid(); }
        if (!object(input) || !['approve','reject'].includes(input.action)) throw invalid();
      } else throw invalid('Formatul formularului nu este valid.');
      if (input.action === 'submit') {
        const data = submitInput(input);
        let photoBytes: Uint8Array | null = null; let format: { mime: string; ext: string } | null = null;
        if (photo) { if (photo.size > MAX_PHOTO) throw invalid('Fotografia poate avea cel mult 5 MB.'); photoBytes = new Uint8Array(await photo.arrayBuffer()); format = imageType(photoBytes, photo.type); }
        const client = (request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim().slice(0,128);
        const period = limits.get(client); const current = now();
        if (period && current - period.start < 600000) { if (++period.count > 20) throw new ApiError(429, 'rate_limit', 'Prea multe încercări. Reîncearcă mai târziu.'); }
        else { if (limits.size > 10000) limits.clear(); limits.set(client, { start: current, count: 1 }); }
        const user = await applicant(data.email, data.password, { nume: data.nume_contact, telefon: data.telefon });
        const photoPath = photoBytes && format ? `${user.id}/${data.request_id}/${data.request_id}.${format.ext}` : null;
        if (photoPath && photoBytes && format) await uploadPrivate(photoPath, photoBytes, format.mime);
        // Explicit fields ensure the password cannot enter application storage.
        const args = { p_applicant_user_id: user.id, p_request_id: data.request_id, p_nume_baza: data.nume_baza, p_nume_contact: data.nume_contact, p_email: data.email, p_telefon: data.telefon, p_oras: data.oras, p_adresa: data.adresa, p_link_maps: data.link_maps, p_terenuri: data.terenuri, p_descriere: data.descriere, p_poza_path: photoPath, p_prices: data.prices };
        const submitted = await jsonCall('/rest/v1/rpc/submit_club_application', service, args);
        if (!submitted.response.ok) throw upstream(submitted.response, submitted.data);
        if (submitted.data !== data.request_id) throw unavailable();
        return reply({ request_id: data.request_id, status: 'noua', email_confirmation_required: !user.email_confirmed_at }, 201);
      }
      if (!UUID.test(input.request_id ?? '')) throw invalid();
      const expected = optionalText(input.expected_updated_at, 100);
      if (expected !== null && !Number.isFinite(Date.parse(expected))) throw invalid();
      const note = input.note === undefined || input.note === null ? null : text(input.note, 0, 2000, true);
      const reviewPrices = input.action === 'approve' ? prices(input.prices) : null;
      const headers = await requireSuper(request);
      const result = await jsonCall(`/rest/v1/cereri_baze_sportive?select=id,solicitant_user_id,stare,poza_path,reserved_base_id,approved_base_id,terenuri&id=eq.${input.request_id}`, headers);
      if (!result.response.ok) throw upstream(result.response, result.data);
      if (!Array.isArray(result.data) || result.data.length !== 1) throw new ApiError(404, 'invalid_input', 'Cererea nu mai este disponibilă.');
      const row = result.data[0];
      if (input.action === 'reject') {
        const rejected = await jsonCall('/rest/v1/rpc/reject_club_request', headers, { p_request_id: input.request_id, p_nota: note ?? '', p_expected_updated_at: expected });
        if (!rejected.response.ok) throw upstream(rejected.response, rejected.data);
        return reply(rejected.data);
      }
      if (!Array.isArray(row.terenuri) || reviewPrices?.length !== row.terenuri.length) throw invalid('Completează prețul fiecărui teren.');
      const published = row.stare === 'acceptata' && row.approved_base_id ? null : await publishPhoto(row);
      let approved: { response: Response; data: any };
      try { approved = await jsonCall('/rest/v1/rpc/approve_club_request', headers, { p_request_id: input.request_id, p_prices: reviewPrices, p_photo_path: published?.path ?? null, p_expected_updated_at: expected, p_nota: note }); }
      catch (error) { /* Unknown commit outcome: retain this invocation's photo. */ throw error; }
      if (!approved.response.ok) {
        if (published?.created && approved.response.status < 500) await cleanupCopy(published.path);
        throw upstream(approved.response, approved.data);
      }
      // Another approval may have committed between our initial read and RPC.
      // Its photo has a different UUID; remove only our own unreferenced copy.
      if (published?.created) await cleanupCopy(published.path);
      return reply(approved.data);
    } catch (error) {
      // Never include Auth/upstream bodies, stack traces, secrets or passwords.
      const safe = error instanceof ApiError ? error : unavailable();
      return reply({ error: safe.message, code: safe.code }, safe.status);
    }
  };
}
