/* Superadmin: approve or reject courts in sports that are new to a base (migration 044).
   The RPCs re-check the superadmin role; this screen only lists and forwards decisions. */
(() => {
    'use strict';
    const table = 'cereri_teren_sport_nou';
    const fields = 'id,created_at,solicitant_email,baza_id,nume_teren,sport,pret,ore_rezervabile,mesaj,poza,stare,motiv_decizie,decis_la,baze_sportive(nume,oras)';
    // Only photos from the project's public court bucket are shown (migration 045 checks this too).
    const photoPrefix = () => `${String(window.supabaseUrl || (typeof supabaseUrl === 'string' ? supabaseUrl : '')).replace(/\/+$/, '')}/storage/v1/object/public/poze_terenuri/`;
    const trustedPhoto = url => typeof url === 'string' && url.length <= 500 && photoPrefix().length > 40 && url.startsWith(photoPrefix());
    const photoObject = url => trustedPhoto(url) ? decodeURIComponent(url.slice(photoPrefix().length).split(/[?#]/)[0]) : '';
    const states = { in_asteptare: 'În așteptare', aprobata: 'Aprobată', respinsa: 'Respinsă' };
    const byId = id => document.getElementById(id);
    let role = null;
    let generation = 0;
    let busy = false;
    let lastFocus = null;

    const sportLabel = sport => sport === 'Tenis Picior' ? 'Tenis de picior' : String(sport || '');
    const isOpen = () => byId('modal-cereri-sport-admin')?.style.display === 'flex';
    function el(tag, text, className = '') {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = String(text ?? '');
        if (className) node.className = className;
        return node;
    }
    function date(value) {
        const parsed = new Date(value);
        return value && Number.isFinite(parsed.getTime())
            ? parsed.toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bucharest' }) : '—';
    }
    function status(text = '', error = false) {
        const node = byId('admin-sport-cereri-status');
        if (!node) return;
        node.textContent = text;
        node.classList.toggle('is-error', error);
    }

    function ensureModal() {
        if (byId('modal-cereri-sport-admin')) return;
        const modal = el('div', undefined, 'modal');
        modal.id = 'modal-cereri-sport-admin';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'admin-sport-cereri-title');
        modal.style.display = 'none';
        const panel = el('section', undefined, 'modal-continut admin-sport-requests-panel');
        const header = el('div', undefined, 'modal-antet admin-sport-requests-header');
        const title = el('h2', 'Cereri pentru sporturi noi', 'titlu-modal');
        title.id = 'admin-sport-cereri-title';
        const closeButton = el('button', '×', 'buton-inchidere');
        closeButton.type = 'button';
        closeButton.id = 'admin-sport-cereri-close';
        closeButton.setAttribute('aria-label', 'Închide');
        closeButton.addEventListener('click', () => close());
        header.append(title, closeButton);
        const toolbar = el('div', undefined, 'admin-sport-requests-toolbar');
        const filter = el('select');
        filter.id = 'admin-sport-cereri-filter';
        filter.setAttribute('aria-label', 'Filtrează cererile');
        filter.append(new Option('În așteptare', 'in_asteptare'), new Option('Toate', ''));
        filter.addEventListener('change', () => load());
        const refresh = el('button', 'Reîncarcă', 'admin-sport-requests-refresh');
        refresh.type = 'button';
        refresh.addEventListener('click', () => load());
        toolbar.append(filter, refresh);
        const help = el('p', 'Un administrator a cerut un teren într-un sport pe care baza lui nu îl are încă. La aprobare, terenul se publică în bază și îi este alocat lui.', 'admin-sport-requests-help');
        const state = el('p', '', 'admin-sport-requests-status');
        state.id = 'admin-sport-cereri-status';
        state.setAttribute('role', 'status');
        const list = el('div', undefined, 'admin-sport-requests-list');
        list.id = 'admin-sport-cereri-list';
        panel.append(header, help, toolbar, state, list);
        modal.append(panel);
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        document.body.append(modal);
    }

    async function refreshCount() {
        if (!role?.isSuper) return;
        const token = generation;
        const badge = byId('admin-sport-cereri-badge');
        let count = 0, error = null;
        // A network failure only hides the badge; it must not surface as an unhandled error.
        try { ({ count, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('stare', 'in_asteptare')); }
        catch (failure) { error = failure; }
        if (token !== generation || !badge) return;
        badge.textContent = String(count || 0);
        badge.setAttribute('aria-label', `${count || 0} cereri în așteptare`);
        badge.hidden = !!error || !(count > 0);
    }

    // A small copy of the public court card (same classes as the homepage), so the
    // superadmin sees how the court will look on the site after approval.
    function preview(record) {
        const wrap = el('div', undefined, 'admin-sport-request-preview');
        wrap.append(el('span', 'Cum va arăta pe site', 'admin-sport-request-preview-label'));
        const cardNode = el('div', undefined, 'home-court-card');
        cardNode.setAttribute('aria-hidden', 'true');
        const image = el('img', undefined, 'home-court-photo');
        image.alt = '';
        image.width = 240; image.height = 160;
        image.src = trustedPhoto(record.poza) ? record.poza
            : (window.appAssetUrl?.('assets/imagini/spotivity-256.webp') || 'assets/imagini/spotivity-256.webp');
        const info = el('span', undefined, 'home-court-details');
        const city = record.baze_sportive?.oras || '';
        info.append(el('strong', record.nume_teren), el('span', [sportLabel(record.sport), city].filter(Boolean).join(' · '), 'home-court-meta'),
            el('span', `${new Intl.NumberFormat('ro-RO').format(Number(record.pret))} Lei/oră`, 'home-court-price'));
        cardNode.append(image, info);
        wrap.append(cardNode);
        if (trustedPhoto(record.poza)) {
            const link = el('a', 'Deschide fotografia mărită', 'admin-sport-request-photo-link');
            link.href = record.poza;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            wrap.append(link);
        } else wrap.append(el('span', 'Fără fotografie: pe site se va afișa sigla Spotivity.', 'admin-sport-request-preview-note'));
        return wrap;
    }

    function card(record) {
        const item = el('article', undefined, 'admin-sport-request');
        item.dataset.state = record.stare;
        const head = el('div', undefined, 'admin-sport-request-head');
        head.append(el('strong', `${record.nume_teren} · ${sportLabel(record.sport)}`), el('span', states[record.stare] || record.stare, 'admin-sport-request-state'));
        const base = record.baze_sportive;
        const details = el('dl', undefined, 'admin-sport-request-details');
        const add = (label, value) => { details.append(el('dt', label), el('dd', value)); };
        add('Baza sportivă', base ? `${base.nume}${base.oras ? `, ${base.oras}` : ''}` : '—');
        add('Solicitant', record.solicitant_email);
        add('Tarif', `${record.pret} Lei/oră`);
        add('Ore rezervabile', Array.isArray(record.ore_rezervabile) && record.ore_rezervabile.length ? record.ore_rezervabile.join(', ') : 'niciuna');
        add('Trimisă la', date(record.created_at));
        if (record.mesaj) add('Mesaj', record.mesaj);
        if (record.stare !== 'in_asteptare') {
            add('Decisă la', date(record.decis_la));
            if (record.motiv_decizie) add(record.stare === 'respinsa' ? 'Motiv' : 'Notă', record.motiv_decizie);
        }
        item.append(head, preview(record), details);
        if (record.stare === 'in_asteptare') {
            const reason = el('textarea', undefined, 'admin-sport-request-reason');
            reason.maxLength = 1000;
            reason.rows = 2;
            reason.placeholder = 'Motiv sau notă (opțional; administratorul vede motivul respingerii)';
            reason.setAttribute('aria-label', `Motiv pentru ${record.nume_teren}`);
            const actions = el('div', undefined, 'admin-sport-request-actions');
            const approve = el('button', 'Aprobă și publică terenul', 'admin-sport-request-approve');
            approve.type = 'button';
            const reject = el('button', 'Respinge', 'admin-sport-request-reject');
            reject.type = 'button';
            approve.addEventListener('click', () => decide(record, true, reason.value));
            reject.addEventListener('click', () => decide(record, false, reason.value));
            actions.append(approve, reject);
            item.append(reason, actions);
        }
        return item;
    }

    async function load() {
        if (!role?.isSuper) return;
        const token = ++generation;
        const list = byId('admin-sport-cereri-list');
        list.setAttribute('aria-busy', 'true');
        status('Se încarcă cererile…');
        let query = db.from(table).select(fields).order('created_at', { ascending: false }).limit(100);
        const filter = byId('admin-sport-cereri-filter').value;
        if (filter) query = query.eq('stare', filter);
        const { data, error } = await query;
        if (token !== generation) return;
        list.removeAttribute('aria-busy');
        if (error) {
            list.replaceChildren();
            status('Cererile nu au putut fi încărcate. Încearcă din nou.', true);
            return;
        }
        list.replaceChildren(...(data || []).map(card));
        status(data?.length ? '' : (filter ? 'Nu există cereri în așteptare.' : 'Nu există cereri.'));
        refreshCount();
    }

    async function decide(record, approve, reason) {
        if (busy || !role?.isSuper) return;
        const text = String(reason || '').trim();
        busy = true;
        byId('admin-sport-cereri-list').querySelectorAll('button, textarea').forEach(node => { node.disabled = true; });
        status(approve ? 'Se aprobă cererea și se publică terenul…' : 'Se respinge cererea…');
        const { error } = approve
            ? await db.rpc('approve_new_sport_court_request', { p_request_id: record.id, p_note: text || null })
            : await db.rpc('reject_new_sport_court_request', { p_request_id: record.id, p_reason: text || null });
        busy = false;
        if (error) {
            status(error.message || 'Decizia nu a putut fi salvată.', true);
            byId('admin-sport-cereri-list').querySelectorAll('button, textarea').forEach(node => { node.disabled = false; });
            return;
        }
        // A rejected request's photo is not used anywhere; remove it (the database refuses if it is referenced).
        if (!approve && photoObject(record.poza)) await db.storage.from('poze_terenuri').remove([photoObject(record.poza)]).catch(() => {});
        await load();
        // Refreshing admin access here would close this dialog, so the court lists update on the next panel load.
        status(approve ? `Aprobat: terenul „${record.nume_teren}” a fost publicat pe site. În lista ta de terenuri apare după reîncărcarea panoului.` : `Cererea pentru „${record.nume_teren}” a fost respinsă.`);
    }

    function open() {
        if (!role?.isSuper) return;
        ensureModal();
        lastFocus = document.activeElement;
        byId('modal-cereri-sport-admin').style.display = 'flex';
        byId('admin-sport-cereri-close').focus();
        load();
    }
    function close() {
        const modal = byId('modal-cereri-sport-admin');
        if (modal) modal.style.display = 'none';
        if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
        lastFocus = null;
    }
    function clear() {
        generation++;
        role = null;
        const button = byId('btn-cereri-sport-admin');
        if (button) button.hidden = true;
        const badge = byId('admin-sport-cereri-badge');
        if (badge) badge.hidden = true;
        if (isOpen()) close();
        byId('admin-sport-cereri-list')?.replaceChildren();
    }

    window.addEventListener('spotivity:admin-role', event => {
        clear();
        const detail = event.detail;
        if (detail?.isSuper !== true || typeof detail.userId !== 'string') return;
        role = { userId: detail.userId, isSuper: true };
        const button = byId('btn-cereri-sport-admin');
        if (button) button.hidden = false;
        refreshCount().catch(() => {});
    });
    window.addEventListener('spotivity:admin-clear', clear);
    db.auth.onAuthStateChange((event, session) => {
        if (role && (event === 'SIGNED_OUT' || session?.user?.id !== role.userId)) clear();
    });
    document.addEventListener('DOMContentLoaded', () => {
        byId('btn-cereri-sport-admin')?.addEventListener('click', open);
    });
})();
