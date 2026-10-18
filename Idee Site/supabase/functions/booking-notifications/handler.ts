import { renderTransactionalMail, TRANSACTIONAL_SITE_URL } from '../_shared/transactional-mail.ts';
import type { TransactionalMailInput } from '../_shared/transactional-mail.ts';
import { deriveBookingCancellationToken, hashCancellationToken } from '../_shared/booking-token.ts';

export type NotificationWorkerConfig = {
  url: string; anonKey?: string; serviceKey: string;
  cancellationSecret?: string;
  bookingMakeWebhookURL?: string; chatMakeWebhookURL?: string;
  makeWebhookURL?: string; notificationsReady?: boolean;
};
type Dependencies = { fetch?: typeof fetch; now?: () => number; timeoutMs?: number };
type Json = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_KINDS = ['booking_created_client','booking_created_owner','booking_cancelled_client','booking_cancelled_owner'];
const MAKE = /^https:\/\/hook\.(?:(?:eu|us)[0-9]+\.)?(?:make|integromat)\.com\/[A-Za-z0-9_-]{10,}\/?$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const object = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

function equalSecret(actual: string, expected: string): boolean {
  const a = new TextEncoder().encode(actual); const b = new TextEncoder().encode(expected);
  let mismatch = a.length ^ b.length;
  // Never decide authorization by trusting decoded JWT claims. Only the server
  // secret supplied by the runtime can dispatch notifications.
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0 && expected.length > 0;
}

/**
 * Service-only asynchronous dispatcher. A stable notification_id must be used
 * by Make's persistent deduplication store before its email module sends mail.
 * A 2xx webhook response means submitted to Make, not delivered to a mailbox.
 */
export function createHandler(config: NotificationWorkerConfig, dependencies: Dependencies = {}) {
  const transport = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? 15000;
  const base = config.url.replace(/\/$/, '');
  const serviceHeaders = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' };
  async function timedFetch(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await transport(url, { ...options, signal: controller.signal, redirect: 'error' }); }
    finally { clearTimeout(timer); }
  }
  async function rpc(name: string, body: Json = {}): Promise<any> {
    const response = await timedFetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: serviceHeaders, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('database_unavailable');
    try { return await response.json(); } catch { throw new Error('database_unavailable'); }
  }
  async function settings(): Promise<{ ready: boolean; bookingURL: string | null; chatURL: string | null }> {
    const suppliedBooking = config.bookingMakeWebhookURL ?? config.makeWebhookURL;
    const suppliedChat = config.chatMakeWebhookURL ?? config.makeWebhookURL;
    let ready: boolean; let bookingURL: unknown; let chatURL: unknown;
    if (suppliedBooking || suppliedChat || config.notificationsReady !== undefined) {
      ready = config.notificationsReady !== false;
      bookingURL = suppliedBooking; chatURL = suppliedChat;
    } else {
      const stored = await rpc('get_booking_notification_config');
      ready = object(stored) && stored.ready === true;
      bookingURL = stored?.booking_webhook_url; chatURL = stored?.chat_webhook_url;
    }
    return {
      ready,
      bookingURL: typeof bookingURL === 'string' && MAKE.test(bookingURL) ? bookingURL : null,
      chatURL: typeof chatURL === 'string' && MAKE.test(chatURL) ? chatURL : null,
    };
  }
  async function finish(job: Json, outcome: string, error: string | null = null): Promise<boolean> {
    return (await rpc('finish_booking_notification', {
      p_notification_id: job.notification_id, p_lease_token: job.lease_token,
      p_outcome: outcome, p_error_code: error,
      p_retry_seconds: Math.min(86400, 60 * 2 ** Math.min(7, Math.max(0, Number(job.attempt ?? 1) - 1))),
    })) === true;
  }
  async function deliver(job: Json, webhookURL: string): Promise<'submitted' | 'queued' | 'blocked'> {
    if (!object(job) || !UUID.test(job.notification_id) || !UUID.test(job.lease_token)) return 'blocked';
    let rendered;
    let bookingID: string | null = null;
    try {
      const input: any = { kind: job.kind, recipient: job.recipient, siteURL: TRANSACTIONAL_SITE_URL };
      if (job.kind === 'chat_owner') input.chat = job.chat;
      else {
        if (!BOOKING_KINDS.includes(job.kind) || !UUID.test(job.booking_id) || !object(job.booking)) throw new TypeError('Invalid job');
        bookingID = job.booking_id;
        const localHour = (hour: unknown) => {
          if (typeof hour !== 'string') throw new TypeError('Invalid booking hour');
          if (!/^(?:[01][0-9]|2[0-3]):00$/.test(hour)) return hour;
          return `${hour}–${String((Number(hour.slice(0, 2)) + 1) % 24).padStart(2, '0')}:00`;
        };
        input.booking = { ...job.booking, hours: job.booking.hours?.map(localHour), remainingHours: job.booking.remainingHours?.map(localHour) };
        if (job.kind === 'booking_created_client') {
          const token = await deriveBookingCancellationToken(config.cancellationSecret ?? '', bookingID!);
          const tokenHash = await hashCancellationToken(token);
          // This idempotent attach also covers cron racing with the booking
          // function between its create RPC and its own token attachment RPC.
          if (await rpc('attach_cancellation_token', { p_booking_id: bookingID, p_token_hash: tokenHash }) !== true) throw new Error('database_unavailable');
          input.cancellationURL = `${TRANSACTIONAL_SITE_URL}#anulare-rezervare=${bookingID}&token=${token}`;
        }
      }
      rendered = renderTransactionalMail(input as TransactionalMailInput);
    } catch (error) {
      const permanent = error instanceof TypeError;
      try { await finish(job, permanent ? 'blocked' : 'retry', permanent ? 'invalid_template_input' : 'database_unavailable'); } catch { /* The lease makes an unacknowledged job recoverable. */ }
      return permanent ? 'blocked' : 'queued';
    }
    let response: Response;
    try {
      response = await timedFetch(webhookURL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Spotivity-Notification-Id': job.notification_id },
        body: JSON.stringify({
          notification_id: job.notification_id, kind: job.kind, booking_id: bookingID,
          to: rendered.to, subject: rendered.subject, html: rendered.html, text: rendered.text,
          // Records are normalized server data, never a browser-supplied request
          // object. No Auth/session credentials are included in the webhook.
          record: job.kind === 'chat_owner' ? job.chat : job.booking,
        }),
      });
    } catch {
      // The remote endpoint may have accepted the request before the connection
      // failed. Retry the SAME id, relying on Make's persistent deduplication.
      try { await finish(job, 'retry', 'delivery_uncertain'); } catch { /* lease recovery */ }
      return 'queued';
    }
    const accepted = response.ok;
    const temporary = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    const outcome = accepted ? 'submitted' : temporary ? 'retry' : 'blocked';
    const error = accepted ? null : temporary ? `make_http_${response.status}` : 'make_rejected';
    try {
      if (!await finish(job, outcome, error)) return 'queued';
    } catch { return 'queued'; }
    return accepted ? 'submitted' : temporary ? 'queued' : 'blocked';
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const bearer = request.headers.get('Authorization');
    if (!bearer?.startsWith('Bearer ') || !equalSecret(bearer.slice(7), config.serviceKey)) return json({ error: 'Service authorization required.' }, 401);
    if (!base.startsWith('https://') || !config.serviceKey) return json({ error: 'Notification service is unavailable.' }, 503);
    let input: Json;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 2048) return json({ error: 'Request too large.' }, 413);
      input = JSON.parse(raw);
      if (!object(input) || input.action !== 'dispatch' || (input.booking_id !== undefined && input.booking_id !== null && (typeof input.booking_id !== 'string' || !UUID.test(input.booking_id)))) return json({ error: 'Invalid dispatch request.' }, 400);
    } catch { return json({ error: 'Invalid dispatch request.' }, 400); }
    try {
      const configured = await settings();
      if (!configured.ready || (!configured.bookingURL && !configured.chatURL)) return json({ status: 'pending_configuration', submitted: 0, queued: 0, blocked: 0 });
      // Never substitute the database service key for the independent
      // cancellation secret. Leave jobs recoverable until it is provisioned.
      if (!config.cancellationSecret) return json({ status: 'pending_configuration', submitted: 0, queued: 0, blocked: 0 });
      const kinds = [...(configured.bookingURL ? BOOKING_KINDS : []), ...(configured.chatURL ? ['chat_owner'] : [])];
      const jobs = await rpc('claim_booking_notifications', { p_limit: 8, p_lease_seconds: 120, p_booking_id: input.booking_id ?? null, p_kinds: kinds });
      if (!Array.isArray(jobs)) throw new Error('database_unavailable');
      const outcomes: ('submitted' | 'queued' | 'blocked')[] = [];
      // At most four external calls at once, comfortably inside each job lease.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          const url = job.kind === 'chat_owner' ? configured.chatURL : configured.bookingURL;
          if (!url) { outcomes.push('queued'); continue; }
          outcomes.push(await deliver(job, url));
        }
      }));
      const submitted = outcomes.filter(value => value === 'submitted').length;
      const queued = outcomes.filter(value => value === 'queued').length;
      const blocked = outcomes.filter(value => value === 'blocked').length;
      return json({ status: queued || blocked ? 'queued' : submitted ? 'submitted' : 'queued', submitted, queued, blocked });
    } catch { return json({ status: 'queued', error: 'Notification service is temporarily unavailable.' }, 503); }
  };
}
