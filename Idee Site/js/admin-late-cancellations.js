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
        button.append(element('h2', '', 'Anulări târzii'), element('span', 'admin-card-detail', 'Monitorizarea anulărilor neconforme'));
        tools.append(button);
        const modal = element('div', 'modal late-cancellation-modal');
        modal.id = 'modal-late-cancellations'; modal.style.display = 'none';
        modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'late-cancellation-title');
        const panel = element('section', 'modal-continut late-cancellation-panel');
        const header = element('div', 'late-cancellation-heading');
        const title = element('h2', '', 'Anulări târzii'); title.id = 'late-cancellation-title';
        const closeButton = element('button', 'late-cancellation-close', 'Închide'); closeButton.type = 'button';
        header.append(title, closeButton);
        const intro = element('p', 'late-cancellation-intro', 'Clienți cu anulări efectuate cu mai puțin de o oră înainte sau în timpul unei ore încă nefinalizate. Sunt excluse anulările făcute de personal.');
        const policy = element('p', 'late-cancellation-policy', 'Perioadă: ultimele 30 de zile. De la 3 rezervări anulate târziu, clientul este marcat pentru verificare. Conturile nu sunt blocate automat.');
        const scope = element('p', 'late-cancellation-intro'); scope.id = 'late-cancellation-scope';
        const refresh = element('button', 'btn-cont late-cancellation-refresh', 'Reîncarcă'); refresh.type = 'button';
        const status = element('p', 'late-cancellation-status'); status.id = 'late-cancellation-status'; status.setAttribute('role', 'status');
        const list = element('div', 'late-cancellation-list'); list.id = 'late-cancellation-list';
        panel.append(header, intro, scope, policy, refresh, status, list); modal.append(panel); workspace.append(modal);
        function close(restore = true) {
            request++; controller?.abort(); controller = null; refresh.disabled = false;
            modal.style.display = 'none'; list.replaceChildren(); status.textContent = '';
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
        function render(data) {
            list.replaceChildren();
            const customers = Array.isArray(data?.customers) ? data.customers : [];
            status.textContent = customers.length ? `${customers.length} clienți cu anulări târzii în ultimele 30 de zile.` : 'Nu sunt înregistrate anulări târzii în ultimele 30 de zile.';
            for (const customer of customers) {
                const card = element('article', 'late-cancellation-customer');
                const heading = element('div', 'late-cancellation-customer-heading');
                heading.append(element('h3', '', customer.name || 'Client'), element('span', 'late-cancellation-count', `${Number(customer.count) || 0} anulări`));
                card.append(heading);
                if (customer.frequent === true) card.append(element('p', 'late-cancellation-flag', 'Anulări repetate — de verificat'));
                contact(card, customer.email, 'email'); contact(card, customer.phone, 'phone');
                card.append(element('p', 'late-cancellation-last', `Ultima anulare: ${date(customer.last_cancelled_at)}`));
                const details = element('details', 'late-cancellation-events'); details.append(element('summary', '', 'Vezi rezervările'));
                const events = element('ul');
                for (const event of Array.isArray(customer.events) ? customer.events : []) {
                    const lead = Number(event.lead_minutes);
                    const description = Number.isFinite(lead) ? (lead < 0 ? 'după începerea orei' : `cu ${lead} minute înainte`) : 'interval indisponibil';
                    events.append(element('li', '', `${event.court_name || 'Teren'} · ${date(event.starts_at)} · anulată ${description}, la ${date(event.cancelled_at)}`));
                }
                details.append(events); card.append(details); list.append(card);
            }
        }
        async function load() {
            if (!role?.userId || modal.style.display !== 'flex') return;
            const currentGeneration = generation, currentRole = role.userId, currentRequest = ++request;
            controller?.abort(); controller = new AbortController();
            refresh.disabled = true; list.replaceChildren(); status.textContent = 'Se încarcă anulările târzii…';
            try {
                let query = db.rpc('list_late_cancellations', { p_days: 30 });
                if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
                const { data, error } = await query;
                if (generation !== currentGeneration || role?.userId !== currentRole || request !== currentRequest || modal.style.display !== 'flex') return;
                if (error) throw new Error('Anulările nu au putut fi încărcate. Verifică accesul de administrator și încearcă din nou.');
                render(data);
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
        refresh.addEventListener('click', load); closeButton.addEventListener('click', () => close());
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const focusable = [...panel.querySelectorAll('button:not(:disabled),a[href],summary')].filter(node => node.getClientRects().length);
                if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
                else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
            }
        });
        window.addEventListener('spotivity:admin-role', event => {
            clear();
            if (event.detail?.userId) {
                role = { isSuper: event.detail.isSuper === true, userId: event.detail.userId };
                scope.textContent = role.isSuper
                    ? 'Vezi anulările târzii de la toate terenurile.'
                    : 'Vezi numai anulările de la terenurile alocate în prezent. Numărul anulărilor și marcajele se calculează numai pentru aceste terenuri.';
                button.hidden = false; button.style.display = 'flex';
            }
        });
        window.addEventListener('spotivity:admin-clear', clear);
        return { open, close, clear };
    };
    // Deferred scripts already have the parsed workspace. Listen before the
    // admin bootstrap's DOMContentLoaded callback can emit the initial role.
    const start = () => { if (typeof db !== 'undefined') window.createLateCancellationReview(db); };
    if (document.getElementById('base-admin-workspace')) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
