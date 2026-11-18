/* Free replacement for Supabase "leaked password protection" (a Pro feature):
   checks a NEW password against Have I Been Pwned with k-anonymity. Only the
   first 5 characters of the password's SHA-1 hash leave the browser; the
   password itself is never sent. Fails open: if the service is slow or down,
   the password is accepted so nobody is blocked by a third party. */
(() => {
    'use strict';
    const endpoint = 'https://api.pwnedpasswords.com/range/';

    window.spotivityPasswordLeaked = async function(password, { timeout = 4000 } = {}) {
        if (typeof password !== 'string' || !password || !window.crypto?.subtle || typeof fetch !== 'function') return false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
            const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
            const prefix = hash.slice(0, 5), suffix = hash.slice(5);
            // Add-Padding hides how many results the prefix really has; padded rows have count 0.
            const response = await fetch(endpoint + prefix, {
                headers: { 'Add-Padding': 'true' }, signal: controller.signal,
                cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
            });
            if (!response.ok) return false;
            const text = await response.text();
            return text.split('\n').some(line => {
                const [candidate, count] = line.trim().split(':');
                return candidate === suffix && Number(count) > 0;
            });
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    };
    window.spotivityLeakedPasswordMessage = 'Această parolă a apărut în scurgeri de date publice și nu este sigură. Alege o altă parolă.';
})();
