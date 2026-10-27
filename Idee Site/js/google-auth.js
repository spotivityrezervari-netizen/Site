// Google uses the same Supabase client and session as password authentication.
// Capture callback markers before the SDK consumes them; never use a URL as identity.
(() => {
    'use strict';

    const intentKey = 'spotivity.google-oauth.started-at';
    const intentLifetime = 15 * 60 * 1000;
    const copy = {
        ro: {
            button: 'Continuă cu Google', divider: 'sau cu email',
            busy: 'Se deschide Google…',
            unavailable: 'Autentificarea cu Google nu este disponibilă momentan. Poți folosi emailul și parola.',
            failed: 'Autentificarea cu Google nu a reușit. Încearcă din nou sau folosește emailul și parola.',
            cancelled: 'Autentificarea cu Google a fost anulată. Poți încerca din nou.',
            invalidLink: 'Linkul de autentificare este invalid sau a expirat. Reîncearcă din browserul în care ai început autentificarea sau cere un link nou.',
            phone: 'Completează numărul de telefon din „Editează profilul”, pentru rezervări.'
        },
        hu: {
            button: 'Folytatás Google-fiókkal', divider: 'vagy e-mail-címmel',
            busy: 'A Google megnyitása…',
            unavailable: 'A Google-bejelentkezés jelenleg nem érhető el. Használd az e-mail-címedet és jelszavadat.',
            failed: 'A Google-bejelentkezés sikertelen. Próbáld újra, vagy használd az e-mail-címedet és jelszavadat.',
            cancelled: 'A Google-bejelentkezés megszakadt. Újra megpróbálhatod.',
            invalidLink: 'A bejelentkezési hivatkozás érvénytelen vagy lejárt. Próbáld meg abban a böngészőben, ahol elkezdted a bejelentkezést, vagy kérj új hivatkozást.',
            phone: 'A foglalásokhoz add meg a telefonszámodat a „Profil szerkesztése” résznél.'
        },
        en: {
            button: 'Continue with Google', divider: 'or with email',
            busy: 'Opening Google…',
            unavailable: 'Google sign-in is currently unavailable. You can use your email and password.',
            failed: 'Google sign-in failed. Try again or use your email and password.',
            cancelled: 'Google sign-in was cancelled. You can try again.',
            invalidLink: 'This sign-in link is invalid or has expired. Try the browser where you started signing in, or request a new link.',
            phone: 'Add your phone number in “Edit profile” for bookings.'
        }
    };

    function readIntent() {
        try {
            const value = sessionStorage.getItem(intentKey);
            const timestamp = Number(value);
            if (value && Number.isFinite(timestamp) && timestamp > 0
                && Date.now() >= timestamp && Date.now() - timestamp <= intentLifetime) return value;
            sessionStorage.removeItem(intentKey);
        } catch { /* A blocked storage area must not break password authentication. */ }
        return null;
    }

    function clearIntent(expected) {
        try {
            if (!expected || sessionStorage.getItem(intentKey) === expected) sessionStorage.removeItem(intentKey);
        } catch { /* Storage can be unavailable in private browsing. */ }
    }

    function captureCallback() {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(url.hash.slice(1));
        const recovery = url.searchParams.get('type') === 'recovery' || hash.get('type') === 'recovery';
        const hasError = url.searchParams.has('error') || url.searchParams.has('error_code')
            || hash.has('error') || hash.has('error_code');
        const errorCode = url.searchParams.get('error_code') || url.searchParams.get('error')
            || hash.get('error_code') || hash.get('error');
        return {
            recovery,
            queryCallback: url.searchParams.has('code') || url.searchParams.has('error') || url.searchParams.has('error_code'),
            hashCallback: hash.has('access_token') || hash.has('refresh_token') || hash.has('error') || hash.has('error_code'),
            hasCode: url.searchParams.has('code'),
            hasTokens: hash.has('access_token') || hash.has('refresh_token'),
            hasError,
            cancelled: errorCode === 'access_denied' || errorCode === 'user_cancelled' || errorCode === 'cancelled',
            intent: readIntent()
        };
    }

    const callback = captureCallback();

    function init() {
        const modal = document.getElementById('modal-auth');
        const options = document.getElementById('google-auth-options');
        const button = document.getElementById('btn-google-login');
        const label = document.getElementById('google-auth-label');
        const divider = document.getElementById('google-auth-divider');
        const status = document.getElementById('google-auth-status');
        const phoneNote = document.getElementById('google-contact-note');
        if (!modal || !options || !button || !label || !divider || !status
            || typeof db === 'undefined' || typeof supabaseUrl !== 'string' || typeof supabaseKey !== 'string') return;

        let enabled = false;
        let busy = false;
        let statusKey = '';
        let statusKind = 'error';
        let attempt = 0;
        let identityVersion = 0;
        let observedUserId;
        let callbackDismissed = false;
        let contactUserId = null;
        let profileUser = null;
        let availabilityGeneration = 0;
        let availabilityRequest = null;
        let availabilityController = null;

        const text = () => copy[window.lang] || copy.ro;
        const isOpen = () => !modal.hidden && modal.style.display !== 'none'
            && window.getComputedStyle(modal).display !== 'none';
        const isRecoveryCallback = () => callback.recovery
            || (typeof window.isSpotivityRecoveryCallback === 'function' && window.isSpotivityRecoveryCallback());

        function renderPhoneNote() {
            if (!phoneNote) return;
            const phone = typeof profileUser?.telefon === 'string' ? profileUser.telefon.trim() : '';
            const missing = !phone || phone === '-';
            phoneNote.hidden = !contactUserId || profileUser?.id !== contactUserId || !missing;
            phoneNote.textContent = phoneNote.hidden ? '' : text().phone;
        }

        function render() {
            options.hidden = !enabled;
            button.disabled = busy || !enabled;
            button.setAttribute('aria-busy', String(busy));
            label.textContent = text().button;
            divider.textContent = text().divider;
            status.hidden = !statusKey;
            status.textContent = statusKey ? text()[statusKey] : '';
            status.dataset.kind = statusKind;
            renderPhoneNote();
        }

        function setStatus(key, kind = 'error') {
            statusKey = key;
            statusKind = kind;
            render();
        }

        function cancelAttempt() {
            attempt += 1;
            busy = false;
            if (statusKey === 'busy') statusKey = '';
            render();
        }

        async function checkAvailability(force = false) {
            if (availabilityRequest && !force) return availabilityRequest;
            if (availabilityController) availabilityController.abort();
            const generation = ++availabilityGeneration;
            const controller = new AbortController();
            availabilityController = controller;
            const timeout = window.setTimeout(() => controller.abort(), 8000);
            const request = (async () => {
                let available = false;
                try {
                    const response = await fetch(new URL('/auth/v1/settings', supabaseUrl).href, {
                        method: 'GET', headers: { apikey: supabaseKey },
                        cache: 'no-store', signal: controller.signal
                    });
                    if (response.ok) {
                        const settings = await response.json();
                        available = settings?.external?.google === true;
                    }
                } catch { /* Keep the password forms usable when the provider cannot be checked. */ }
                finally { window.clearTimeout(timeout); }
                if (generation === availabilityGeneration) {
                    enabled = available;
                    availabilityRequest = null;
                    availabilityController = null;
                    render();
                }
                return generation === availabilityGeneration && available;
            })();
            availabilityRequest = request;
            return request;
        }

        function validAuthorizeUrl(value, redirectTo) {
            try {
                const url = new URL(value);
                const configured = new URL(supabaseUrl);
                if (url.origin !== configured.origin || url.pathname !== '/auth/v1/authorize'
                    || url.username || url.password || url.hash
                    || url.searchParams.getAll('provider').length !== 1 || url.searchParams.get('provider') !== 'google'
                    || url.searchParams.getAll('redirect_to').length !== 1
                    || url.searchParams.get('redirect_to') !== redirectTo) return null;
                return url;
            } catch { return null; }
        }

        button.addEventListener('click', async () => {
            if (busy || !enabled || !isOpen()) return;
            const currentAttempt = ++attempt;
            const version = identityVersion;
            const stillCurrent = () => attempt === currentAttempt && identityVersion === version && isOpen();
            let navigating = false;
            busy = true;
            setStatus('busy', 'info');
            try {
                const before = await db.auth.getSession();
                if (!stillCurrent()) return;
                if (before.error) throw new Error('session');
                const userId = before.data?.session?.user?.id || null;
                const available = await checkAvailability(true);
                if (!stillCurrent()) return;
                if (!available) { setStatus('unavailable'); return; }
                const redirectTo = typeof window.siteHomeUrl === 'function'
                    ? window.siteHomeUrl() : new URL('./', window.location.href).href;
                const result = await db.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } }
                });
                if (!stillCurrent()) return;
                const authorizeUrl = !result.error && validAuthorizeUrl(result.data?.url, redirectTo);
                if (!authorizeUrl) throw new Error('authorize');
                const current = await db.auth.getSession();
                if (!stillCurrent() || current.error || (current.data?.session?.user?.id || null) !== userId) return;
                // Store only the time of this tab's explicit action, immediately before navigation.
                const startedAt = String(Date.now());
                try { sessionStorage.setItem(intentKey, startedAt); } catch { /* OAuth itself can still continue. */ }
                window.saveSpotivityEmailIntent?.(startedAt);
                navigating = true;
                window.location.assign(authorizeUrl.href);
            } catch {
                navigating = false;
                if (stillCurrent()) setStatus('failed');
            } finally {
                if (currentAttempt === attempt) {
                    busy = navigating;
                    if (!navigating && statusKey === 'busy') statusKey = '';
                    render();
                }
            }
        });

        function scrubCallbackUrl() {
            if (isRecoveryCallback()) return;
            const url = new URL(window.location.href);
            if (callback.queryCallback) {
                for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
            }
            if (callback.hashCallback) {
                const hash = new URLSearchParams(url.hash.slice(1));
                for (const key of ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type',
                    'provider_token', 'provider_refresh_token', 'type', 'error', 'error_code', 'error_description']) hash.delete(key);
                url.hash = hash.toString();
            }
            if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
        }

        function showCallbackError(key) {
            if (callbackDismissed) return;
            setStatus(key);
            modal.style.display = 'flex';
        }

        async function finishCallback() {
            // The SDK must initialize/exchange the code before callback fields are removed.
            let restored;
            try { restored = await db.auth.getSession(); }
            catch { restored = { error: true }; }
            if (isRecoveryCallback()) return;
            const isReturn = callback.hasCode || callback.hasTokens || callback.hasError;
            if (!isReturn) return;
            scrubCallbackUrl();
            if (callback.hasError) {
                if (callback.intent) clearIntent(callback.intent);
                showCallbackError(callback.intent ? (callback.cancelled ? 'cancelled' : 'failed') : 'invalidLink');
                return;
            }
            if (!callback.intent) {
                if (restored.error || !restored.data?.session?.user?.id) showCallbackError('invalidLink');
                return;
            }
            clearIntent(callback.intent);
            if (restored.error || !restored.data?.session?.user?.id) {
                showCallbackError('failed');
                return;
            }
            const id = restored.data.session.user.id;
            const version = identityVersion;
            try {
                const verified = await db.auth.getUser();
                if (verified.error || verified.data?.user?.id !== id || identityVersion !== version) return;
                const user = verified.data.user;
                const google = user.app_metadata?.provider === 'google'
                    || user.app_metadata?.providers?.includes('google')
                    || user.identities?.some(identity => identity.provider === 'google');
                if (!google) return;
                const current = await db.auth.getSession();
                if (current.error || current.data?.session?.user?.id !== id || identityVersion !== version) return;
                contactUserId = id;
                profileUser = typeof window.getSpotivityProfileUser === 'function' ? window.getSpotivityProfileUser() : profileUser;
                // The existing editor keeps its explicit review/confirmation; this only supplies a reminder.
                renderPhoneNote();
            } catch { /* A contact reminder must never block a valid login. */ }
        }

        db.auth.onAuthStateChange((event, session) => {
            const id = session?.user?.id || null;
            if (observedUserId === undefined) observedUserId = id;
            else if (id !== observedUserId || event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY') {
                observedUserId = id;
                identityVersion += 1;
                contactUserId = null;
                profileUser = null;
                cancelAttempt();
                callbackDismissed = true;
            }
        });

        window.addEventListener('spotivity:profile-user', event => {
            profileUser = event.detail?.user || null;
            if (contactUserId && profileUser?.id !== contactUserId) contactUserId = null;
            renderPhoneNote();
        });
        window.addEventListener('spotivity:language', render);
        document.getElementById('inchide-auth')?.addEventListener('click', () => {
            callbackDismissed = true;
            cancelAttempt();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && (isOpen() || callback.hasError)) {
                callbackDismissed = true;
                cancelAttempt();
            }
        });
        let wasOpen = isOpen();
        new MutationObserver(() => {
            const open = isOpen();
            if (open && !wasOpen) void checkAvailability(true);
            else if (!open && wasOpen) {
                callbackDismissed = true;
                cancelAttempt();
            }
            wasOpen = open;
        }).observe(modal, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
        window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            clearIntent();
            callbackDismissed = true;
            cancelAttempt();
            void checkAvailability(true);
        });

        render();
        void checkAvailability();
        void finishCallback();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
