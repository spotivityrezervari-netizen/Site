// Reservations use one server transaction for all consecutive hourly slots.
// Contact details and cancellation secrets stay in memory, never in storage.
(() => {
    'use strict';
    const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const pendingOwn = new Map();
    let guestAttempt = null;
    let guestDialog = null;
    let cancelLink = null;
    const initial = new URL(window.location.href);
    const fragment = new URLSearchParams(initial.hash.slice(1));
    if (fragment.has('anulare-rezervare')) {
        cancelLink = { booking_id: fragment.get('anulare-rezervare'), token: fragment.get('token') };
        fragment.delete('anulare-rezervare');
        fragment.delete('token');
        initial.hash = fragment.toString();
        window.history.replaceState(window.history.state, '', initial.pathname + initial.search + initial.hash);
    }

    class WorkflowError extends Error {
        constructor(message, code, unknown = false) {
            super(message); this.code = code; this.unknown = unknown;
        }
    }
    const errors = {
        booking_limit: 'Ai deja o rezervare la acest sport în ziua aleasă, indiferent de teren sau oraș. Poți selecta mai multe ore consecutive într-o singură rezervare.',
        slot_unavailable: 'Una dintre ore nu mai este disponibilă. Alege alte ore.',
        invalid_hours: 'Selectează numai ore consecutive, pe același teren.',
        invalid_contact: 'Verifică numele, adresa de email și numărul de telefon.',
        invalid_token: 'Linkul de anulare este invalid sau a expirat.',
        booking_ended: 'O rezervare finalizată nu mai poate fi anulată.',
        forbidden: 'Nu ai permisiunea să modifici această rezervare.',
        unauthorized: 'Sesiunea a expirat. Conectează-te din nou.',
        rate_limit: 'Ai trimis prea multe cereri. Încearcă din nou puțin mai târziu.',
        service_unavailable: 'Serviciul de rezervări nu este disponibil momentan. Încearcă din nou.',
        guest_unavailable: 'Rezervarea fără cont nu este disponibilă până la activarea emailurilor de confirmare. Nu a fost creată nicio rezervare. Poți rezerva dintr-un cont sau poți contacta baza.'
    };
    errors.completed_booking = errors.booking_ended;
    errors.invalid_cancellation = errors.invalid_token;
    errors.unauthenticated = errors.unauthorized;
    async function post(payload, token) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        try {
            const response = await fetch(`${supabaseUrl}/functions/v1/booking-workflow`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey,
                    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify(payload), signal: controller.signal, referrerPolicy: 'no-referrer'
            });
            let data = null;
            try { data = await response.json(); } catch (_) { /* A lost acknowledgement is retryable with the same request UUID. */ }
            if (!response.ok || !data || data.error) {
                const code = typeof data?.code === 'string' ? data.code : 'service_unavailable';
                const unknown = (response.status >= 500 || !data) && code !== 'guest_unavailable';
                throw new WorkflowError(errors[code] || 'Cererea nu a putut fi finalizată. Verifică datele și încearcă din nou.', code, unknown);
            }
            if (!UUID.test(String(data.booking_id || ''))) {
                throw new WorkflowError('Răspunsul nu confirmă rezervarea. Apasă din nou pentru a verifica aceeași cerere, fără a crea o dublură.', 'unknown_response', true);
            }
            return data;
        } catch (error) {
            if (error instanceof WorkflowError) throw error;
            throw new WorkflowError('Nu am putut confirma răspunsul serverului. Apasă din nou pentru a verifica aceeași rezervare, fără a crea o dublură.', 'unknown_response', true);
        } finally { clearTimeout(timer); }
    }
    function normalizeSelection(selection) {
        const hours = [...new Set(selection.hours || [])].sort();
        if (!hours.length || hours.some((hour, i) => !/^\d{2}:00$/.test(hour)
            || (i > 0 && Number(hour.slice(0, 2)) !== Number(hours[i - 1].slice(0, 2)) + 1))) {
            throw new WorkflowError(errors.invalid_hours, 'invalid_hours');
        }
        return { court_id: String(selection.court_id), day: String(selection.day), hours,
            with_ball: selection.with_ball === true };
    }
    function summaryText(selection) {
        const hours = selection.hours || [];
        const end = hours.length ? `${String(Number(hours[hours.length - 1].slice(0, 2)) + 1).padStart(2, '0')}:00` : '';
        const day = /^\d{4}-\d{2}-\d{2}$/.test(selection.day || '')
            ? `${selection.day.slice(8, 10)}.${selection.day.slice(5, 7)}.${selection.day.slice(0, 4)}` : selection.day || '';
        return `${selection.court_name || selection.court || ''}${day ? ` · ${day}` : ''}${hours.length ? ` · ${hours[0]}–${end}` : ''}`.replace(/^ · /, '');
    }
    function mountDialog(id, title) {
        const previous = document.activeElement;
        const modal = document.createElement('div');
        modal.id = id; modal.className = 'modal workflow-modal'; modal.style.display = 'flex';
        modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', `${id}-title`);
        const content = document.createElement('div'); content.className = 'modal-continut workflow-panel';
        const close = document.createElement('button'); close.type = 'button'; close.className = 'buton-inchidere workflow-close';
        close.setAttribute('aria-label', 'Închide'); close.textContent = '×';
        const heading = document.createElement('h2'); heading.id = `${id}-title`; heading.className = 'titlu-modal'; heading.textContent = title;
        content.append(close, heading); modal.append(content); document.body.append(modal); document.body.classList.add('fara-scroll');
        let dismiss = () => {};
        close.addEventListener('click', () => dismiss());
        const keyboard = event => {
            if (event.key === 'Escape') { event.stopImmediatePropagation(); dismiss(); }
            if (event.key !== 'Tab') return;
            const elements = [...content.querySelectorAll('button,input,a[href]')].filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
            if (!elements.length) return;
            if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1].focus(); }
            else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0].focus(); }
        };
        document.addEventListener('keydown', keyboard, true);
        return { modal, content, close,
            onDismiss(fn) { dismiss = fn; },
            remove() {
                document.removeEventListener('keydown', keyboard, true); modal.remove();
                if (![...document.querySelectorAll('.modal')].some(el => ['flex', 'block'].includes(el.style.display))) document.body.classList.remove('fara-scroll');
                if (previous?.isConnected) previous.focus();
            }
        };
    }
    function statusNode() {
        const status = document.createElement('p'); status.className = 'workflow-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        return status;
    }
    function notificationText(result) {
        return result.notification_status === 'submitted'
            ? 'Rezervarea este confirmată. Datele și linkul de anulare au fost trimise serviciului de email.'
            : result.notification_status === 'queued'
                ? 'Rezervarea este confirmată. Emailul cu datele și linkul de anulare este în curs de trimitere.'
                : 'Rezervarea este confirmată. Trimiterea emailului nu este configurată momentan. Contactează baza pentru anulare.';
    }
    function createGuest(selection, display = {}) {
        if (guestDialog) return Promise.resolve(null);
        const normalized = normalizeSelection(selection);
        if (!guestAttempt) guestAttempt = { selection: normalized, display: { ...display }, payload: null, uncertain: false };
        const attempt = guestAttempt;
        const dialog = mountDialog('modal-rezervare-vizitator', 'Rezervă fără cont');
        guestDialog = dialog;
        const summary = document.createElement('p'); summary.className = 'workflow-summary';
        summary.textContent = summaryText({ ...attempt.selection, ...attempt.display });
        const intro = document.createElement('p'); intro.className = 'workflow-copy';
        intro.textContent = 'Nu se creează un cont. Primești pe email datele rezervării și un link pentru anulare.';
        const form = document.createElement('form'); form.className = 'workflow-form';
        for (const field of [
            ['contact_name', 'Nume și prenume', 'text', 'name', 120],
            ['email', 'Email', 'email', 'email', 254],
            ['phone', 'Număr de telefon', 'tel', 'tel', 50]
        ]) {
            const label = document.createElement('label'); label.htmlFor = `guest-${field[0]}`; label.textContent = field[1];
            const input = document.createElement('input'); input.id = `guest-${field[0]}`; input.name = field[0]; input.type = field[2];
            input.autocomplete = field[3]; input.maxLength = field[4]; input.required = true;
            if (field[0] === 'contact_name') input.minLength = 2;
            if (attempt.payload) input.value = attempt.payload[field[0]];
            form.append(label, input);
        }
        const policy = document.createElement('p'); policy.className = 'workflow-copy';
        policy.textContent = 'Poți avea o singură rezervare pe zi la același sport, în orice oraș. Aceasta poate include mai multe ore consecutive. Rezervările finalizate nu pot fi anulate.';
        const status = statusNode();
        const actions = document.createElement('div'); actions.className = 'workflow-actions';
        const submit = document.createElement('button'); submit.type = 'submit'; submit.id = 'guest-booking-submit'; submit.className = 'buton-rezervare'; submit.textContent = attempt.payload ? 'Verifică aceeași rezervare' : 'Confirmă rezervarea';
        const back = document.createElement('button'); back.type = 'button'; back.className = 'workflow-secondary'; back.textContent = 'Înapoi la ore';
        const signin = document.createElement('button'); signin.type = 'button'; signin.id = 'guest-booking-signin'; signin.className = 'workflow-secondary'; signin.textContent = 'Am deja cont';
        actions.append(submit, back, signin); form.append(policy, status, actions); dialog.content.append(summary, intro, form);
        let busy = false;
        const freeze = () => {
            form.querySelectorAll('input').forEach(input => { input.disabled = !!attempt.payload || busy; });
            submit.disabled = busy; back.disabled = busy; dialog.close.disabled = busy;
            signin.hidden = attempt.uncertain; signin.disabled = busy;
        };
        if (attempt.payload) status.textContent = 'Verificăm rezervarea trimisă anterior, cu aceleași date și ore. Nu se creează o dublură.';
        freeze();
        return new Promise(resolve => {
            const finish = result => {
                dialog.remove(); guestDialog = null;
                // Contact details survive only an uncertain response, for an idempotent retry.
                if (result || !attempt.payload) guestAttempt = null;
                resolve(result);
            };
            dialog.onDismiss(() => { if (!busy) finish(null); }); back.onclick = () => { if (!busy) finish(null); };
            signin.onclick = () => {
                if (busy || attempt.uncertain) return;
                finish(null);
                window.dispatchEvent(new Event('spotivity:booking-signin'));
            };
            form.addEventListener('submit', async event => {
                event.preventDefault(); if (busy || !form.reportValidity()) return;
                if (!attempt.payload) {
                    const contact = Object.fromEntries(new FormData(form));
                    const phone = String(contact.phone || '').trim();
                    if (!/^\+?[0-9 ().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) {
                        status.textContent = errors.invalid_contact; form.elements.phone.focus(); return;
                    }
                    attempt.payload = { action: 'create_guest', request_id: crypto.randomUUID(), ...attempt.selection,
                        contact_name: String(contact.contact_name).trim(), email: String(contact.email).trim().toLowerCase(), phone };
                }
                const priorUncertain = attempt.uncertain;
                busy = true; status.textContent = 'Se confirmă rezervarea…'; freeze();
                try {
                    const result = await post(attempt.payload);
                    busy = false; finish(result);
                } catch (error) {
                    busy = false;
                    attempt.uncertain = priorUncertain || error.unknown;
                    if (!attempt.uncertain) attempt.payload = null;
                    const message = attempt.uncertain && error.code === 'guest_unavailable'
                        ? 'Serviciul de email nu este disponibil momentan. Încearcă din nou mai târziu.' : error.message;
                    status.textContent = attempt.uncertain
                        ? `${message} Păstrăm aceleași date pentru verificarea rezervării anterioare, fără a crea o dublură.` : message;
                    submit.textContent = attempt.uncertain ? 'Verifică aceeași rezervare' : 'Confirmă rezervarea'; freeze();
                }
            });
            setTimeout(() => (attempt.payload ? submit : form.elements.contact_name).focus(), 0);
        });
    }
    async function createOwn(selection, user) {
        const normalized = normalizeSelection(selection);
        const { data, error } = await db.auth.getSession();
        if (error || !user?.id || data?.session?.user?.id !== user.id || !data.session.access_token) throw new WorkflowError(errors.unauthorized, 'unauthorized');
        let pending = pendingOwn.get(user.id);
        if (pending && JSON.stringify(pending.selection) !== JSON.stringify(normalized)) {
            throw new WorkflowError('Răspunsul pentru rezervarea anterioară nu este confirmat. Selectează aceleași ore și apasă din nou pentru a o verifica.', 'pending_booking', true);
        }
        if (!pending) {
            pending = { selection: normalized, payload: { action: 'create', request_id: crypto.randomUUID(), ...normalized }, uncertain: false };
            pendingOwn.set(user.id, pending);
        }
        const priorUncertain = pending.uncertain;
        try {
            const result = await post(pending.payload, data.session.access_token);
            pendingOwn.delete(user.id); return result;
        } catch (error) {
            pending.uncertain = priorUncertain || error.unknown;
            if (!pending.uncertain) pendingOwn.delete(user.id);
            throw error;
        }
    }
    async function cancelOwned(bookingId, userId) {
        const { data, error } = await db.auth.getSession();
        if (error || data?.session?.user?.id !== userId || !data.session.access_token) throw new WorkflowError(errors.unauthorized, 'unauthorized');
        return post({ action: 'cancel_owned', booking_id: bookingId }, data.session.access_token);
    }
    async function openCancellation() {
        if (!cancelLink) return;
        const link = cancelLink; cancelLink = null;
        const dialog = mountDialog('modal-anulare-rezervare-email', 'Anulare rezervare');
        const status = statusNode(); const summary = document.createElement('p'); summary.className = 'workflow-summary';
        const actions = document.createElement('div'); actions.className = 'workflow-actions';
        const confirm = document.createElement('button'); confirm.type = 'button'; confirm.id = 'email-booking-cancel-confirm'; confirm.className = 'workflow-danger'; confirm.textContent = 'Confirmă anularea'; confirm.hidden = true;
        const back = document.createElement('button'); back.type = 'button'; back.className = 'workflow-secondary'; back.textContent = 'Închide';
        actions.append(confirm, back); dialog.content.append(summary, status, actions);
        let busy = false;
        const close = () => { if (!busy) { link.token = ''; dialog.remove(); } };
        dialog.onDismiss(close); back.onclick = close;
        if (!UUID.test(link.booking_id || '') || !/^[0-9a-f]{64}$/i.test(link.token || '')) { status.textContent = errors.invalid_token; link.token = ''; return; }
        status.textContent = 'Se verifică rezervarea…';
        let preview = null;
        try {
            preview = await post({ action: 'preview_cancel', ...link });
            if (!dialog.modal.isConnected) return;
            summary.textContent = summaryText(preview);
            if (preview.state === 'anulata' || preview.state === 'cancelled') { status.textContent = 'Rezervarea este deja anulată.'; link.token = ''; }
            else if (preview.can_cancel === false || (preview.day && preview.hours?.length && window.bookingEnded?.(preview.day, preview.hours[preview.hours.length - 1]))) {
                status.textContent = errors.booking_ended; link.token = '';
            } else { status.textContent = 'Vrei să anulezi această rezervare? Orele vor deveni disponibile din nou.'; confirm.hidden = false; }
        } catch (error) { if (dialog.modal.isConnected) status.textContent = error.message; }
        confirm.onclick = async () => {
            if (busy || !link.token || !preview) return;
            busy = true; confirm.disabled = true; back.disabled = true; dialog.close.disabled = true; status.textContent = 'Se anulează…';
            try {
                await post({ action: 'cancel', ...link });
                status.textContent = 'Rezervarea a fost anulată pentru orele nefinalizate. Istoricul este păstrat.'; confirm.hidden = true; link.token = '';
                window.dispatchEvent(new Event('spotivity:booking-cancelled'));
            } catch (error) { status.textContent = error.message; }
            finally { busy = false; confirm.disabled = false; back.disabled = false; dialog.close.disabled = false; }
        };
        setTimeout(() => back.focus(), 0);
    }
    window.SpotivityBooking = Object.freeze({
        create(selection, { user, ...display } = {}) { return user?.id ? createOwn(selection, user) : createGuest(selection, display); },
        cancelOwned, normalizeSelection, notificationText,
        pendingSelection(userId) {
            const pending = userId ? pendingOwn.get(userId) : guestAttempt?.payload && guestAttempt;
            return pending ? { ...pending.selection, hours: [...pending.selection.hours] } : null;
        }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openCancellation, { once: true });
    else openCancellation();
})();
