// Hash gateway-provided network identity before persisting a limiter bucket.
// Forwarded headers are trusted only at the Supabase gateway boundary; the SQL
// limiter also applies a global cap, so rotating/spoofing subjects cannot remove it.
function canonicalIP(value: string | null): string | null {
  if (!value) return null;
  const ip = value.trim();
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(ip)) {
    return ip.split('.').every(part => Number(part) <= 255) ? ip : null;
  }
  if (!ip.includes(':') || /[^0-9a-f:.]/i.test(ip)) return null;
  try { return new URL(`http://[${ip}]/`).hostname.toLowerCase(); } catch { return null; }
}

export async function publicRateSubject(request: Request): Promise<string> {
  // The gateway appends its peer to X-Forwarded-For. Never key on a freely
  // supplied leading entry or on arbitrary header text.
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1) ?? null;
  const ip = canonicalIP(request.headers.get('cf-connecting-ip')) ?? canonicalIP(forwarded) ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`spotivity-public-rate:v1:${ip}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
