/* Create a court only inside an explicitly permitted base; the RPC enforces scope. */
(() => {
    'use strict';

    const sports = ['Fotbal', 'Baschet', 'Tenis', 'Volei', 'Tenis Picior'];
    const byId = id => document.getElementById(id);
    let modal;
    let form;
    let current = null;
    let operation = null;
    let formGeneration = 0;
    let identityGeneration = 0;
    let observedUserId;
    let role = null;

    const sameId = (left, right) => String(left ?? '') === String(right ?? '');
    const hours = () => Array.isArray(window.bookingHourOptions)
        ? window.bookingHourOptions : Array.from({ length: 14 }, (_, index) => `${String(index + 9).padStart(2, '0')}:00`);
    const open = () => modal?.style.display === 'flex';

    function element(tag, attributes = {}, text) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function status(message = '', kind = '') {
        const target = byId('owner-court-status');
        if (!target) return;
        target.textContent = message;
        target.dataset.kind = kind;
    }

    function controls() {
        if (!form) return;
        const busy = !!operation;
        form.querySelectorAll('input, select, button[type="submit"]').forEach(node => { node.disabled = busy; });
        byId('owner-court-submit').textContent = busy ? 'Se adaugă terenul…' : 'Adaugă terenul';
        form.setAttribute('aria-busy', String(busy));
    }

    function close({ restoreFocus = true } = {}) {
        const previousFocus = current?.previousFocus;
        formGeneration++;
        operation?.controller.abort();
        operation?.client?.auth.stopAutoRefresh();
        operation = null;
        current = null;
        if (modal) modal.style.display = 'none';
        if (form) form.reset();
        status();
        controls();
        if (restoreFocus && previousFocus?.isConnected && previousFocus.getClientRects().length) {
            previousFocus.focus({ preventScroll: true });
        }
    }

    function contextCurrent(snapshot) {
        return current === snapshot.context && formGeneration === snapshot.generation
            && identityGeneration === snapshot.identityGeneration && operation === snapshot && open()
            && !snapshot.controller.signal.aborted;
    }

    function check(snapshot) {
        if (!contextCurrent(snapshot)) throw new Error('Contextul de administrare s-a schimbat.');
    }

    function allowedScope(data, context) {
        return data?.can_manage === true && data.is_super !== true
            && Array.isArray(data.bases)
            && data.bases.some(base => sameId(base.id, context.base.id) && base.can_edit_details === true);
    }

    async function boundClient(snapshot) {
        const { data: identity, error: identityError } = await db.auth.getUser();
        check(snapshot);
        if (identityError || identity?.user?.id !== snapshot.context.userId) {
            throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
        }
        const { data, error } = await db.auth.getSession();
        check(snapshot);
        const session = data?.session;
        if (error || session?.user?.id !== snapshot.context.userId || !session.access_token || !session.refresh_token) {
            throw new Error('Sesiunea a expirat. Conectează-te din nou.');
        }
        const client = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        snapshot.client = client;
        const { error: sessionError } = await client.auth.setSession({
            access_token: session.access_token, refresh_token: session.refresh_token
        });
        check(snapshot);
        if (sessionError) throw new Error('Sesiunea nu poate fi verificată. Conectează-te din nou.');
        const verified = await client.auth.getUser();
        check(snapshot);
        if (verified.error || verified.data?.user?.id !== snapshot.context.userId) {
            throw new Error('Identitatea contului nu poate fi verificată.');
        }
        return client;
    }

    async function save(event) {
        event.preventDefault();
        if (!current || operation || !open()) return;
        const name = byId('owner-court-name').value.trim();
        const sport = byId('owner-court-sport').value;
        const rawPrice = byId('owner-court-price').value.trim();
        const price = Number(rawPrice);
        const selectedHours = Array.from(byId('owner-court-hours').querySelectorAll('input:checked'), input => input.value);
        if (name.length < 2 || name.length > 120 || /[,\u0000-\u001f\u007f-\u009f]/u.test(name)) {
            status('Numele trebuie să aibă 2–120 de caractere, fără virgulă sau caractere de control.', 'error');
            byId('owner-court-name').focus();
            return;
        }
        if (!sports.includes(sport)) return status('Alege unul dintre sporturile disponibile.', 'error');
        if (!rawPrice || !Number.isInteger(price) || price < 0 || price > 100000) {
            status('Introdu un tarif întreg între 0 și 100000 lei pe oră.', 'error');
            byId('owner-court-price').focus();
            return;
        }
        if (new Set(selectedHours).size !== selectedHours.length || selectedHours.some(hour => !hours().includes(hour))) {
            return status('Programul conține ore nevalide. Redeschide formularul.', 'error');
        }
        const snapshot = {
            context: current, generation: formGeneration, identityGeneration,
            controller: new AbortController(), client: null
        };
        operation = snapshot;
        controls();
        status('Se verifică accesul la baza sportivă…');
        try {
            const client = await boundClient(snapshot);
            const scope = await client.rpc('get_admin_access').abortSignal(snapshot.controller.signal);
            check(snapshot);
            if (scope.error || !allowedScope(scope.data, snapshot.context)) {
                throw new Error('Nu mai ai permisiunea de a adăuga terenuri în această bază sportivă.');
            }
            status('Se adaugă terenul…');
            const result = await client.rpc('create_managed_court', {
                p_base_id: snapshot.context.base.id,
                p_name: name,
                p_sport: sport,
                p_price: price,
                p_hours: hours().filter(hour => selectedHours.includes(hour))
            }).abortSignal(snapshot.controller.signal);
            check(snapshot);
            if (result.error) throw result.error;
            const court = result.data;
            if (!court || !String(court.id ?? '') || !sameId(court.baza_sportiva_id, snapshot.context.base.id)
                || court.nume !== name) {
                throw new Error('Răspunsul salvării nu poate fi confirmat. Reîncarcă terenurile înainte de a încerca din nou.');
            }
            const saved = { court, baseId: snapshot.context.base.id, userId: snapshot.context.userId };
            const savedIdentity = identityGeneration;
            close({ restoreFocus: false });
            const refreshed = await window.refreshSpotivityAdminAccess?.({ force: true });
            const session = await db.auth.getSession();
            if (savedIdentity !== identityGeneration || session.error || session.data?.session?.user?.id !== saved.userId
                || refreshed !== true) return;
            window.dispatchEvent(new CustomEvent('spotivity:owner-court-created', { detail: saved }));
        } catch (error) {
            if (!contextCurrent(snapshot)) return;
            status(error?.message || 'Terenul nu a putut fi adăugat. Verifică datele și încearcă din nou.', 'error');
        } finally {
            snapshot.client?.auth.stopAutoRefresh();
            if (operation === snapshot) {
                operation = null;
                controls();
            }
        }
    }

    function ensureModal() {
        if (modal?.isConnected) return true;
        const workspace = byId('base-admin-workspace');
        if (!workspace) return false;
        modal = element('div', { id: 'modal-owner-add-court', class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'owner-court-title' });
        modal.style.display = 'none';
        const panel = element('section', { class: 'modal-continut owner-court-panel', tabindex: '-1' });
        const header = element('div', { class: 'modal-antet owner-court-header' });
        header.append(element('h2', { id: 'owner-court-title', class: 'titlu-modal' }, 'Adaugă un teren'));
        const closeButton = element('button', { id: 'owner-court-close', type: 'button', class: 'buton-inchidere', 'aria-label': 'Închide' }, '×');
        closeButton.addEventListener('click', () => close());
        header.append(closeButton);
        panel.append(header, element('p', { id: 'owner-court-base', class: 'owner-court-base' }));
        form = element('form', { id: 'owner-court-form', novalidate: '' });
        const fields = element('div', { class: 'owner-court-fields' });
        const field = (label, input) => {
            const group = element('div', { class: 'grup-input' });
            group.append(element('label', { for: input.id }, label), input);
            return group;
        };
        fields.append(field('Numele terenului', element('input', {
            id: 'owner-court-name', type: 'text', required: '', minlength: '2', maxlength: '120', autocomplete: 'off', placeholder: 'Ex: Teren Fotbal 2'
        })));
        const sportSelect = element('select', { id: 'owner-court-sport', required: '' });
        sports.forEach(sport => sportSelect.append(new Option(sport === 'Tenis Picior' ? 'Tenis de picior' : sport, sport)));
        fields.append(field('Sport', sportSelect));
        fields.append(field('Tarif pe oră (lei)', element('input', {
            id: 'owner-court-price', type: 'number', inputmode: 'numeric', min: '0', max: '100000', step: '1', required: '', placeholder: 'Ex: 100'
        })));
        const hourField = element('fieldset', { id: 'owner-court-hours' });
        hourField.append(element('legend', {}, 'Ore rezervabile'));
        hourField.append(element('p', { class: 'owner-court-hint' }, 'Bifează orele de început. Ora 22:00 acoperă intervalul 22:00–23:00. Fără bife, rezervările noi sunt oprite.'));
        const hourGrid = element('div', { class: 'owner-court-hours-grid' });
        hours().forEach(hour => {
            const label = element('label');
            const input = element('input', { type: 'checkbox', value: hour, name: 'owner-court-hour' });
            label.append(input, element('span', {}, hour));
            hourGrid.append(label);
        });
        hourField.append(hourGrid);
        fields.append(hourField);
        form.append(fields, element('p', { id: 'owner-court-status', role: 'status', 'aria-live': 'polite' }));
        form.append(element('button', { id: 'owner-court-submit', type: 'submit', class: 'buton-rezervare' }, 'Adaugă terenul'));
        form.append(element('p', { class: 'owner-court-hint' }, 'Terenul va fi publicat în baza selectată. Fotografia și celelalte setări se pot modifica după adăugare.'));
        form.addEventListener('submit', save);
        panel.append(form);
        modal.append(panel);
        workspace.append(modal);
        // Existing workspace keyboard handling may close the modal directly.
        new MutationObserver(() => {
            if (current && !open()) close({ restoreFocus: false });
        }).observe(modal, { attributes: true, attributeFilter: ['style'] });
        return true;
    }

    window.openSpotivityOwnerCourtCreate = function({ base, sport, userId } = {}) {
        if (!base?.id || base.can_edit_details !== true || !userId || !ensureModal()) return false;
        if (role && (role.userId !== userId || role.isSuper === true || !sameId(role.selectedBaseId, base.id)
            || !Array.isArray(role.baseAccess) || !role.baseAccess.some(item => sameId(item.id, base.id) && item.can_edit_details === true))) return false;
        close({ restoreFocus: false });
        observedUserId = userId;
        current = { base: { id: base.id, nume: String(base.nume || 'Baza sportivă') }, userId, previousFocus: document.activeElement };
        byId('owner-court-base').textContent = `Baza sportivă: ${current.base.nume}`;
        byId('owner-court-sport').value = sports.includes(sport) ? sport : 'Fotbal';
        const defaults = hours().filter(hour => Number(hour.slice(0, 2)) >= 12);
        byId('owner-court-hours').querySelectorAll('input').forEach(input => { input.checked = defaults.includes(input.value); });
        status();
        controls();
        modal.style.display = 'flex';
        byId('owner-court-name').focus({ preventScroll: true });
        return true;
    };

    window.addEventListener('spotivity:admin-clear', () => {
        role = null;
        close({ restoreFocus: false });
    });
    window.addEventListener('spotivity:admin-role', event => {
        role = event.detail || null;
        if (!current) return;
        if (!role || role.userId !== current.userId || role.isSuper === true
            || !sameId(role.selectedBaseId, current.base.id) || !Array.isArray(role.baseAccess)
            || !role.baseAccess.some(base => sameId(base.id, current.base.id) && base.can_edit_details === true)) {
            close({ restoreFocus: false });
        }
    });
    function changedIdentity(id, signedOut = false) {
        if (observedUserId === undefined) { observedUserId = id; return; }
        if (observedUserId === id && !signedOut) return;
        observedUserId = id;
        identityGeneration++;
        close({ restoreFocus: false });
    }
    window.addEventListener('spotivity:profile-user', event => changedIdentity(event.detail?.user?.id || null));
    db.auth.onAuthStateChange((event, session) => changedIdentity(session?.user?.id || null, event === 'SIGNED_OUT'));
})();
