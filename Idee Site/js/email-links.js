// Email links carry an opaque booking/message reference, never an identity or authority.
// The server resolves that reference again for the currently confirmed account.
(() => {
    'use strict';
    const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const messageID = value => typeof value === 'string' && (UUID.test(value) || /^[1-9]\d{0,19}$/.test(value));
    const supported = new Set(['reservation', 'chat', 'admin', 'account']);
    const oauthIntentKey = 'spotivity.email-link.oauth';
    let request = null;
    function validRequest(value) {
        return value && supported.has(value.action) && (!value.booking || UUID.test(value.booking))
            && (!value.message || (value.action === 'chat' && messageID(value.message) && !value.booking))
            && (value.action !== 'reservation' || UUID.test(value.booking || ''))
            && (value.action !== 'chat' || !!(value.booking || value.message));
    }
    function readLink() {
        const url = new URL(location.href), params = new URLSearchParams(url.hash.slice(1));
        if (!params.has('spotivity-action')) return;
        const action = params.get('spotivity-action'), booking = params.get('booking'), message = params.get('message');
        params.delete('spotivity-action'); params.delete('booking'); params.delete('message');
        url.hash = params.toString();
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        request = validRequest({ action, booking, message })
            ? { action, booking: booking?.toLowerCase() || null, message: message?.toLowerCase() || null }
            : { action: 'invalid' };
    }
    readLink();
    // A full Google redirect may resume only this tab's short-lived explicit
    // login intent. It stores no guest capability, Auth token or contact data.
    try {
        const saved = JSON.parse(sessionStorage.getItem(oauthIntentKey) || 'null');
        sessionStorage.removeItem(oauthIntentKey);
        const startedAt = Number(sessionStorage.getItem('spotivity.google-oauth.started-at'));
        if (!request && validRequest(saved) && saved.startedAt === startedAt
            && startedAt > 0 && Date.now() >= startedAt && Date.now() - startedAt <= 15 * 60 * 1000) {
            request = { action: saved.action, booking: saved.booking?.toLowerCase() || null, message: saved.message?.toLowerCase() || null };
        }
    } catch { /* Blocked storage never prevents ordinary login. */ }
    window.saveSpotivityEmailIntent = startedAt => {
        try {
            if (validRequest(request) && Number.isFinite(Number(startedAt))) sessionStorage.setItem(oauthIntentKey,
                JSON.stringify({ action: request.action, booking: request.booking, message: request.message, startedAt: Number(startedAt) }));
            else sessionStorage.removeItem(oauthIntentKey);
        } catch { /* OAuth can continue even when tab storage is unavailable. */ }
    };
    const modules = window.SpotivityModules ||= {};
    modules.emailLinks = function({ db, state, services }) {
        let busy = false, generation = 0, mounted = false, currentDialog = null;
        const hidePublicDialogs = () => {
            for (const id of ['modal-profil', 'modal-auth', 'modal-lista-rezervari', 'modal-chat-client']) {
                const node = document.getElementById(id); if (node) node.style.display = 'none';
            }
        };
        function dialog(title) {
            currentDialog?.remove();
            const previous = document.activeElement;
            const modal = document.createElement('div'); modal.id = 'modal-email-booking';
            modal.className = 'modal workflow-modal'; modal.style.display = 'flex';
            modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'email-booking-title');
            const panel = document.createElement('div'); panel.className = 'modal-continut workflow-panel';
            const close = document.createElement('button'); close.type = 'button'; close.className = 'buton-inchidere workflow-close';
            close.textContent = '×'; close.setAttribute('aria-label', 'Închide');
            const heading = document.createElement('h2'); heading.id = 'email-booking-title'; heading.className = 'titlu-modal'; heading.textContent = title;
            const status = document.createElement('p'); status.className = 'workflow-status'; status.setAttribute('role', 'status');
            panel.append(close, heading, status); modal.append(panel); document.body.append(modal);
            const remove = () => { modal.remove(); document.removeEventListener('keydown', keyboard, true); if (currentDialog?.modal === modal) currentDialog = null; window.syncSpotivityModalScroll?.(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
            const keyboard = event => {
                if (event.key === 'Escape') { event.stopImmediatePropagation(); remove(); }
                if (event.key !== 'Tab') return;
                const controls = [...panel.querySelectorAll('button,a[href],input')].filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
                if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
                else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
            };
            close.addEventListener('click', remove); document.addEventListener('keydown', keyboard, true);
            currentDialog = { modal, panel, status, remove };
            window.syncSpotivityModalScroll?.(); close.focus();
            return currentDialog;
        }
        function button(actions, label, handler, primary = false) {
            const node = document.createElement('button'); node.type = 'button';
            node.className = primary ? 'buton-rezervare' : 'workflow-secondary'; node.textContent = label;
            node.addEventListener('click', async () => {
                if (node.disabled) return; node.disabled = true;
                try { await handler(); }
                catch { if (currentDialog) currentDialog.status.textContent = 'Acțiunea nu poate fi deschisă momentan. Încearcă din nou.'; }
                finally { node.disabled = false; }
            }); actions.append(node); return node;
        }
        async function openAdmin(context, action) {
            if (!context.is_owner || !await window.refreshSpotivityAdminAccess?.({ force: true })) return false;
            if (document.body.classList.contains('base-admin-owner')) {
                return window.openSpotivityOwnerHomeAction?.(action, { courtId: context.court_id });
            }
            await window.openSpotivityAdminWorkspace?.();
            if (action === 'chat') document.getElementById('btn-vezi-chat-admin')?.click();
            if (action === 'program') {
                window.initializeazaTabel?.([context.court_name]);
                document.getElementById('modal-tabel-program').style.display = 'flex';
            }
            return !document.getElementById('base-admin-workspace')?.hidden;
        }
        async function openChat(context) {
            if (context.is_owner) {
                if (!await openAdmin(context, 'chat')) return false;
                window.deschideChatDinTabel?.(context.customer_email, context.court_name, context.customer_name);
                return true;
            }
            return services.chat.openCourt(context.court_name);
        }
        async function showReservation(context, owner, captured) {
            hidePublicDialogs();
            const view = dialog(context.is_owner ? 'Detalii rezervare' : 'Rezervarea ta');
            view.modal.dataset.bookingId = context.booking_id;
            view.status.textContent = context.status === 'anulata' || context.status === 'cancelled' ? 'Rezervarea este anulată.' : 'Detaliile rezervării tale.';
            const detail = document.createElement('div'); detail.className = 'workflow-summary';
            const hours = Array.isArray(context.hours) ? context.hours : [];
            const end = hours.length && /^\d{2}:00$/.test(hours.at(-1)) ? `${String(Number(hours.at(-1).slice(0, 2)) + 1).padStart(2, '0')}:00` : '';
            for (const [label, value] of [['Cod rezervare', `SPT-${context.booking_id}`], ['Baza sportivă', context.base_name], ['Teren', context.court_name], ['Sport', context.sport], ['Data', context.day], ['Interval orar', end ? `${hours[0]}–${end}` : hours.join(', ')], ['Total de achitat la locație', Number.isFinite(Number(context.total)) ? `${Number(context.total).toLocaleString('ro-RO')} lei` : ''], ...(context.is_owner ? [['Client', context.customer_name], ['Telefon', context.customer_phone], ['Email', context.customer_email]] : [])]) {
                if (value == null || value === '') continue;
                const row = document.createElement('p'); row.style.cssText = 'margin:8px 0;overflow-wrap:anywhere';
                const strong = document.createElement('strong'); strong.textContent = `${label}: `;
                row.append(strong, document.createTextNode(String(value))); detail.append(row);
            }
            view.panel.insertBefore(detail, view.status);
            const actions = document.createElement('div'); actions.className = 'workflow-actions'; view.panel.append(actions);
            const current = () => state.user?.id === owner && generation === captured && view.modal.isConnected;
            button(actions, context.is_owner ? 'Chat cu clientul' : 'Chat cu baza sportivă', async () => {
                if (!current()) return;
                if (await openChat(context) && current()) view.remove();
                else if (current()) view.status.textContent = 'Chatul nu este disponibil pentru această rezervare.';
            });
            if (context.is_owner) button(actions, 'Deschide programul', async () => {
                if (!current() || !await openAdmin(context, 'program') || !current()) return;
                const day = document.getElementById('tabel-data'); if (day) day.value = context.day;
                await window.incarcaTabelProgram?.(); if (current()) view.remove();
            }, true);
            else if (context.can_cancel === true) button(actions, 'Anulează rezervarea', async () => {
                if (!current() || !confirm('Confirmi anularea rezervării?')) return;
                await window.SpotivityBooking.cancelOwned(context.booking_id, owner);
                if (current()) { view.status.textContent = 'Rezervarea a fost anulată. Istoricul este păstrat.'; actions.replaceChildren(); window.dispatchEvent(new Event('spotivity:booking-cancelled')); }
            });
        }
        async function process() {
            if (!mounted || busy || !request) return;
            if (request.action === 'invalid') { request = null; dialog('Link de rezervare').status.textContent = 'Linkul din email nu este valid.'; return; }
            if (!state.user) {
                const prompt = document.getElementById('modal-auth'); if (prompt) prompt.style.display = 'flex';
                return;
            }
            busy = true;
            const captured = generation, owner = state.user.id, link = request;
            const current = () => generation === captured && state.user?.id === owner && request === link;
            try {
                if (link.action === 'account') { request = null; await window.openSpotivityProfile?.(); return; }
                if (link.action === 'admin' && !link.booking) {
                    if (!await window.refreshSpotivityAdminAccess?.({ force: true }) || !current()) throw new Error('forbidden');
                    if (document.body.classList.contains('base-admin-owner')) await window.openSpotivityOwnerHomeAction('administration');
                    else await window.openSpotivityAdminWorkspace?.();
                    if (current()) request = null;
                    return;
                }
                const messageLink = link.action === 'chat' && !!link.message;
                const { data, error } = messageLink
                    ? await db.rpc('get_email_chat_context', { p_message_id: link.message })
                    : await db.rpc('get_email_booking_context', { p_booking_id: link.booking });
                if (!current()) return;
                if (error || !data || (messageLink ? data.message_id !== link.message : data.booking_id !== link.booking)
                    || typeof data.court_name !== 'string') throw new Error('forbidden');
                if (link.action === 'reservation') { await showReservation(data, owner, captured); }
                else if (link.action === 'chat') {
                    hidePublicDialogs();
                    if (!await openChat(data)) throw new Error('chat_unavailable');
                } else if (link.action === 'admin') {
                    if (!data.is_owner || !await openAdmin(data, 'administration')) throw new Error('forbidden');
                }
                if (current()) request = null;
            } catch (error) {
                if (!current()) return;
                request = null; hidePublicDialogs();
                dialog(link.message ? 'Conversație' : 'Link de rezervare').status.textContent = error.message === 'chat_unavailable'
                    ? 'Chatul nu este disponibil pentru această rezervare.'
                    : link.message
                        ? 'Conversația nu este disponibilă pentru acest cont. Conectează-te cu contul care a primit mesajul sau contactează baza sportivă.'
                        : 'Rezervarea nu este disponibilă pentru acest cont. Conectează-te cu adresa folosită pentru rezervare sau contactează baza sportivă.';
            } finally { busy = false; if (request && generation !== captured) setTimeout(process, 0); }
        }
        function mount() {
            mounted = true;
            window.addEventListener('hashchange', () => { readLink(); generation++; currentDialog?.remove(); setTimeout(process, 0); });
            window.addEventListener('spotivity:profile-user', () => { generation++; currentDialog?.remove(); setTimeout(process, 0); });
            process();
        }
        return { mount };
    };
})();
