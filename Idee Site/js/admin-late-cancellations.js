/* Current court-scoped administrator review; the RPC authorizes every read. */
(() => {
    'use strict';
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const date = value => {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime())
            ? new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bucharest' }).format(parsed)
            : 'Dată indisponibilă';
    };
    window.createLateCancellationReview = function(db) {
        const workspace = document.getElementById('base-admin-workspace');
        const tools = workspace?.querySelector('.base-admin-tools');
        if (!tools || document.getElementById('btn-late-cancellations')) return null;
        let role = null, generation = 0, request = 0, controller = null, previousFocus = null;
        const button = element('button', 'card-sport admin-menu-card admin-comun');
        button.id = 'btn-late-cancellations'; button.type = 'button'; button.hidden = true; button.style.display = 'none';
        button.append(element('h2', '', 'Abateri clienți'), element('span', 'admin-card-detail', 'Neprezentări și anulări târzii'));
        tools.append(button);
        const modal = element('div', 'modal late-cancellation-modal');
        modal.id = 'modal-late-cancellations'; modal.style.display = 'none';
        modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'late-cancellation-title');
        const panel = element('section', 'modal-continut late-cancellation-panel');
        const header = element('div', 'late-cancellation-heading');
        const title = element('h2', '', 'Neprezentări și anulări târzii'); title.id = 'late-cancellation-title';
        const closeButton = element('button', 'late-cancellation-close', 'Închide'); closeButton.type = 'button';
        header.append(title, closeButton);
        const intro = element('p', 'late-cancellation-intro', 'Clienți cu neprezentări confirmate de administratori sau anulări făcute cu mai puțin de o oră înainte ori în timpul unei ore nefinalizate. Anulările personalului sunt excluse.');
        const policy = element('p', 'late-cancellation-policy', 'Lista acoperă ultimele 30 de zile. Insigna arată totalul abaterilor de până acum pentru terenurile la care ai acces. O rezervare se numără cel mult o dată. De la 3 abateri poți decide manual o restricție temporară sau permanentă pentru rezervări. Nu se aplică restricții automate. Restricția nu închide contul și nu anulează rezervările existente.');
        const scope = element('p', 'late-cancellation-intro'); scope.id = 'late-cancellation-scope';
        const refresh = element('button', 'btn-cont late-cancellation-refresh', 'Reîncarcă'); refresh.type = 'button';
        const mark = element('button', 'btn-cont late-cancellation-mark', 'Marchează neprezentare'); mark.type = 'button'; mark.id = 'btn-mark-no-show';
        const actions = element('div', 'late-cancellation-actions'); actions.append(mark, refresh);
        const status = element('p', 'late-cancellation-status'); status.id = 'late-cancellation-status'; status.setAttribute('role', 'status');
        const list = element('div', 'late-cancellation-list'); list.id = 'late-cancellation-list';
        const restrictionTitle = element('h3', 'late-restriction-heading', 'Restricții active');
        const restrictionList = element('div', 'late-cancellation-list'); restrictionList.id = 'client-restriction-list';
        panel.append(header, intro, scope, policy, actions, status, list, restrictionTitle, restrictionList); modal.append(panel); workspace.append(modal);
        function close(restore = true) {
            request++; controller?.abort(); controller = null; refresh.disabled = false;
            modal.style.display = 'none'; list.replaceChildren(); restrictionList.replaceChildren(); status.textContent = '';
            window.syncSpotivityModalScroll?.();
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        function clear() {
            generation++; role = null; close(false); scope.textContent = ''; button.hidden = true; button.style.display = 'none';
        }
        function contact(parent, value, type) {
            if (!value) return;
            const line = element('p', 'late-cancellation-contact');
            let url = '';
            if (type === 'email' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) url = 'mailto:' + value;
            if (type === 'phone' && /^\+?[\d\s().-]{5,30}$/.test(value)) url = 'tel:' + value.replace(/[^+\d]/g, '');
            const content = url ? element('a', '', value) : element('span', '', value);
            if (url) content.href = url;
            line.append(content); parent.append(line);
        }
        async function restrictionAction(control, rpc, params) {
            const actor = role?.userId, version = generation;
            if (!actor || control.disabled) return;
            control.disabled = true; status.textContent = 'Se salvează restricția…';
            try {
                const { error } = await db.rpc(rpc, params);
                if (error) throw error;
                if (role?.userId === actor && generation === version && modal.style.display === 'flex') await load();
            } catch {
                if (role?.userId === actor && generation === version && modal.style.display === 'flex') status.textContent = 'Acțiunea a fost respinsă. Reîncarcă lista, verifică numărul abaterilor și accesul la terenuri, apoi încearcă din nou.';
            } finally { if (control.isConnected) control.disabled = false; }
        }
        function restrictionControls(card, customer, ready) {
            if (!ready || !Number.isSafeInteger(customer.total_count) || customer.total_count < 3 || !customer.events?.[0]?.booking_id) return;
            const form = element('div', 'late-restriction-controls');
            const durationLabel = element('label', 'late-restriction-field', 'Durata restricției');
            const duration = element('select', 'late-restriction-duration'); duration.setAttribute('aria-label', 'Durata restricției');
            for (const [value, label] of [['3', '3 zile'], ['7', '7 zile'], ['14', '14 zile'], ['30', '30 de zile'], ['permanent', 'Permanentă']]) {
                const option = element('option', '', label); option.value = value; duration.append(option);
            }
            duration.value = '7'; durationLabel.append(duration);
            const reasonLabel = element('label', 'late-restriction-field', 'Notă internă (opțional)');
            const reason = element('input', 'late-restriction-reason'); reason.type = 'text'; reason.maxLength = 300; reason.placeholder = 'Motivul deciziei'; reasonLabel.append(reason);
            const globalLabel = element('label', 'late-restriction-global');
            const global = element('input'); global.type = 'checkbox'; global.checked = role?.isSuper === true;
            if (role?.isSuper) globalLabel.append(global, document.createTextNode(' Aplică pe toate terenurile platformei'));
            const restrict = element('button', 'late-restriction-button', 'Restricționează rezervările'); restrict.type = 'button';
            restrict.addEventListener('click', () => {
                const permanent = duration.value === 'permanent', all = role?.isSuper === true && global.checked;
                const where = all ? 'pe toate terenurile platformei' : 'pe terenurile alocate în prezent';
                if (!confirm(`Restricționezi rezervările pentru ${customer.name || 'acest client'} ${where}, ${permanent ? 'permanent' : `pentru ${duration.value} zile`}? Rezervările existente și anularea lor rămân disponibile.`)) return;
                void restrictionAction(restrict, 'set_customer_booking_restriction', {
                    p_booking_id: customer.events[0].booking_id, p_days: permanent ? null : Number(duration.value),
                    p_permanent: permanent, p_global: all, p_reason: reason.value.trim()
                });
            });
            form.append(durationLabel, reasonLabel); if (role?.isSuper) form.append(globalLabel); form.append(restrict); card.append(form);
        }
        function renderRestrictions(data) {
            restrictionList.replaceChildren();
            if (!data) { restrictionList.append(element('p', 'late-cancellation-intro', 'Restricțiile nu au putut fi încărcate. Reîncarcă lista înainte de o decizie.')); return; }
            const rows = Array.isArray(data.restrictions) ? data.restrictions : [];
            if (!rows.length) restrictionList.append(element('p', 'late-cancellation-intro', 'Nu sunt restricții active în aria ta de administrare.'));
            for (const item of rows) {
                const card = element('article', 'late-cancellation-customer late-restriction-active');
                card.append(element('h4', '', item.name || 'Client'), element('p', 'late-cancellation-contact', item.email || ''),
                    element('p', 'late-cancellation-contact', `${item.court_name || 'Teren'} · ${item.permanent ? 'Permanentă' : `Până la ${date(item.expires_at)}`}`));
                if (item.reason) card.append(element('p', 'late-cancellation-intro', item.reason));
                const revoke = element('button', 'late-restriction-button', 'Ridică restricția'); revoke.type = 'button';
                revoke.addEventListener('click', () => {
                    if (confirm(`Ridici restricția pentru ${item.name || 'acest client'} — ${item.court_name || 'teren'}?`)) void restrictionAction(revoke, 'revoke_customer_booking_restriction', { p_restriction_id: item.restriction_id, p_reason: '' });
                });
                card.append(revoke); restrictionList.append(card);
            }
        }
        function render(data, restrictions) {
            list.replaceChildren();
            const customers = Array.isArray(data?.customers) ? data.customers : [];
            const combined = data?.combined_incidents === true;
            status.textContent = customers.length ? `${customers.length} ${customers.length === 1 ? 'client' : 'clienți'} cu anulări târzii în ultimele 30 de zile.` : 'Nu sunt înregistrate anulări târzii în ultimele 30 de zile.';
            if (combined) status.textContent = customers.length ? `${customers.length} ${customers.length === 1 ? 'client' : 'clienți'} cu abateri în ultimele 30 de zile.` : 'Nu sunt înregistrate abateri în ultimele 30 de zile.';
            for (const customer of customers) {
                const card = element('article', 'late-cancellation-customer');
                const heading = element('div', 'late-cancellation-customer-heading');
                const total = customer.total_count;
                const validTotal = Number.isSafeInteger(total) && total >= 0;
                const totalLabel = combined ? (validTotal ? `${total} ${total === 1 ? 'abatere' : 'abateri'} până acum` : 'Totalul abaterilor nu este disponibil') : validTotal
                    ? `${total} ${total === 1 ? 'anulare târzie' : (total % 100 >= 20 || total > 0 && total % 100 === 0 ? 'de anulări târzii' : 'anulări târzii')} până acum`
                    : 'Totalul anulărilor târzii nu este disponibil';
                const badge = element('span', 'late-cancellation-count', validTotal ? String(total) : '—');
                badge.setAttribute('role', 'img'); badge.setAttribute('aria-label', totalLabel); badge.title = totalLabel;
                heading.append(element('h3', '', customer.name || 'Client'), badge);
                card.append(heading);
                const recent = customer.count;
                card.append(element('p', 'late-cancellation-window-count', `${combined ? 'Abateri' : 'Anulări târzii'} în ultimele 30 de zile: ${Number.isSafeInteger(recent) && recent >= 0 ? recent : 'indisponibil'}.`));
                if (customer.frequent === true) card.append(element('p', 'late-cancellation-flag', combined ? 'Abateri repetate — de verificat' : 'Anulări repetate — de verificat'));
                contact(card, customer.email, 'email'); contact(card, customer.phone, 'phone');
                card.append(element('p', 'late-cancellation-last', `${combined ? 'Ultima abatere' : 'Ultima anulare'}: ${date(customer.last_cancelled_at)}`));
                const details = element('details', 'late-cancellation-events'); details.append(element('summary', '', 'Vezi rezervările'));
                const events = element('ul');
                for (const event of Array.isArray(customer.events) ? customer.events : []) {
                    const lead = Number(event.lead_minutes);
                    const description = Number.isFinite(lead) ? (lead < 0 ? 'după începerea orei' : `cu ${lead} minute înainte`) : 'interval indisponibil';
                    events.append(element('li', '', `${event.court_name || 'Teren'} · ${date(event.starts_at)} · ${event.kind === 'no_show' ? 'neprezentare înregistrată' : `anulată ${description}`}, la ${date(event.cancelled_at)}`));
                }
                details.append(events); card.append(details); restrictionControls(card, customer, !!restrictions); list.append(card);
            }
            renderRestrictions(restrictions);
        }
        async function load() {
            if (!role?.userId || modal.style.display !== 'flex') return;
            const currentGeneration = generation, currentRole = role.userId, currentRequest = ++request;
            controller?.abort(); controller = new AbortController();
            refresh.disabled = true; list.replaceChildren(); restrictionList.replaceChildren(); status.textContent = 'Se încarcă abaterile…';
            try {
                let query = db.rpc('list_late_cancellations', { p_days: 30 });
                if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
                const { data, error } = await query;
                if (generation !== currentGeneration || role?.userId !== currentRole || request !== currentRequest || modal.style.display !== 'flex') return;
                if (error) throw new Error('Abaterile nu au putut fi încărcate. Verifică accesul de administrator și încearcă din nou.');
                let restrictions = null;
                try {
                    let restrictionQuery = db.rpc('list_customer_booking_restrictions');
                    if (typeof restrictionQuery.abortSignal === 'function') restrictionQuery = restrictionQuery.abortSignal(controller.signal);
                    const response = await restrictionQuery;
                    if (!response.error && Array.isArray(response.data?.restrictions)
                        && typeof response.data.can_restrict_globally === 'boolean') restrictions = response.data;
                } catch { /* The incident list stays usable during a staged backend upgrade. */ }
                if (generation !== currentGeneration || role?.userId !== currentRole || request !== currentRequest || modal.style.display !== 'flex') return;
                render(data, restrictions);
            } catch (error) {
                if (generation === currentGeneration && request === currentRequest && modal.style.display === 'flex') status.textContent = error.name === 'AbortError' ? '' : error.message;
            } finally {
                if (request === currentRequest) refresh.disabled = false;
            }
        }
        function open() {
            if (!role?.userId) return false;
            previousFocus = document.activeElement; modal.style.display = 'flex'; window.syncSpotivityModalScroll?.(); closeButton.focus(); load();
            return true;
        }
        window.openLateCancellationReview = open;
        button.addEventListener('click', open);
        mark.addEventListener('click', () => {
            if (!role?.userId) return;
            const history = document.getElementById('modal-istoric');
            if (!history || typeof window.reincarcaIstoricAdmin !== 'function') return;
            close(false); history.style.display = 'flex';
            window.syncSpotivityModalScroll?.();
            void window.reincarcaIstoricAdmin();
            document.getElementById('btn-istoric')?.focus();
        });
        refresh.addEventListener('click', load); closeButton.addEventListener('click', () => close());
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const focusable = [...panel.querySelectorAll('button:not(:disabled),a[href],summary,input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(node => node.getClientRects().length);
                if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
                else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
            }
        });
        window.addEventListener('spotivity:admin-role', event => {
            clear();
            if (event.detail?.userId) {
                role = { isSuper: event.detail.isSuper === true, userId: event.detail.userId };
                scope.textContent = role.isSuper
                    ? 'Vezi neprezentările și anulările târzii de la toate terenurile.'
                    : 'Vezi numai abaterile de la terenurile alocate în prezent. Numărul și marcajele se calculează numai pentru aceste terenuri.';
                button.hidden = false; button.style.display = 'flex';
            }
        });
        window.addEventListener('spotivity:admin-clear', clear);
        window.addEventListener('spotivity:attendance-changed', () => { if (role?.userId && modal.style.display === 'flex') void load(); });
        return { open, close, clear };
    };
    // Deferred scripts already have the parsed workspace. Listen before the
    // admin bootstrap's DOMContentLoaded callback can emit the initial role.
    const start = () => { if (typeof db !== 'undefined') window.createLateCancellationReview(db); };
    if (document.getElementById('base-admin-workspace')) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
