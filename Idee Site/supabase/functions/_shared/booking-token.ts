// The raw token is sent only to the booking client's email. Database rows store
// its SHA-256 digest; deriving it again lets queued mail retry without plaintext
// cancellation credentials in the outbox, browser storage, or application logs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');

export async function deriveBookingCancellationToken(secret: string, bookingId: string): Promise<string> {
  if (!secret || !UUID.test(bookingId)) throw new TypeError('Invalid cancellation token parameters');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`spotivity-booking-cancel:v1:${bookingId.toLowerCase()}`)));
}

export async function hashCancellationToken(token: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new TypeError('Invalid cancellation token');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}
