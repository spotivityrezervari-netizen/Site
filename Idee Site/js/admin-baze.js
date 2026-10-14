/* Base presentation permissions are separate from court-management permissions. */
(() => {
    'use strict';
    let role = null;
    let generation = 0;
    let requestGeneration = 0;
    let editorGeneration = 0;
    let bases = [];
    let courts = [];
    let admins = [];
    let grants = [];
    let editingId = null;
    let saving = false;
    let lastFocus = null;
    const byId = id => document.getElementById(id);
    const esc = value => window.escapeHtml(String(value ?? ''));
    const sameRole = captured => captured === generation && role !== null;

    function status(message, error = false) {
        const node = byId('admin-baza-status');
        node.textContent = message;
        node.classList.toggle('is-error', error);
    }

    function setSaving(value) {
        saving = value;
        byId('btn-salveaza-baza').disabled = value;
        byId('btn-salveaza-baza').textContent = value ? 'Se salvează…' : role?.isSuper ? 'Salvează baza' : 'Salvează descrierea';
        byId('btn-inapoi-baze').disabled = value;
    }

    function baseOptions() {
        const select = byId('teren-baza');
        const previous = select.value;
        select.replaceChildren(new Option('Fără bază sportivă', ''));
        if (role?.isSuper) {
            for (const base of bases) select.add(new Option(`${base.nume} · ${base.oras}`, base.id));
        }
        if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    }

    function clear() {
        role = null;
        generation++;
        requestGeneration++;
        editorGeneration++;
        bases = []; courts = []; admins = []; grants = [];
        editingId = null;
        saving = false;
        lastFocus = null;
        byId('btn-baze-admin').hidden = true;
        byId('modal-baze-admin').style.display = 'none';
        byId('admin-baze-list').replaceChildren();
        byId('baza-terenuri').replaceChildren();
        byId('baza-admini').replaceChildren();
        byId('admin-baza-form').reset();
        byId('admin-baza-form').hidden = true;
        byId('admin-baze-directory').hidden = false;
        status('');
        setSaving(false);
        baseOptions();
    }

    function renderDirectory() {
        byId('btn-baza-noua').hidden = !role?.isSuper;
        byId('admin-baze-access-hint').textContent = role?.isSuper ? 'Descrieri, terenuri și permisiuni' : 'Descrierile bazelor la care ai acces';
        byId('admin-baze-list').innerHTML = bases.length ? bases.map(base => `
            <button type="button" class="admin-base-card" data-edit-base="${esc(base.id)}">
                <strong>${esc(base.nume)}</strong>
                <span>${esc(base.oras)}</span>
                <small>${role.isSuper ? `${courts.filter(court => court.baza_sportiva_id === base.id).length} terenuri · ${base.este_activa ? 'Activă' : 'Ascunsă'}` : 'Editează descrierea'}</small>
            </button>`).join('') : '<p class="admin-baze-help">Nu ai încă baze sportive de administrat.</p>';
        byId('btn-baze-admin').hidden = !role?.isSuper && bases.length === 0;
        baseOptions();
    }

    async function refresh() {
        if (!role) return false;
        const captured = generation;
        const request = ++requestGeneration;
        try {
            const reads = [
                db.from('baze_sportive').select('*').order('nume'),
                db.from('baze_sportive_admini').select('baza_id,user_id')
            ];
            if (role.isSuper) {
                reads.push(db.from('terenuri').select('id,nume,sport,oras,baza_sportiva_id').order('nume'));
                reads.push(db.from('users_admin').select('user_id,nume_admin,is_super').order('nume_admin'));
            }
            const results = await Promise.all(reads);
            if (!sameRole(captured) || request !== requestGeneration) return false;
            if (results.some(result => result.error)) throw new Error('Bazele sportive nu pot fi încărcate. Încearcă din nou.');
            grants = results[1].data || [];
            bases = (results[0].data || []).filter(base => role.isSuper || grants.some(grant => grant.baza_id === base.id && grant.user_id === role.userId));
            courts = role.isSuper ? results[2].data || [] : [];
            admins = role.isSuper ? results[3].data || [] : [];
            renderDirectory();
            return true;
        } catch (error) {
            if (sameRole(captured) && request === requestGeneration) status(error.message || 'Bazele nu pot fi încărcate.', true);
            return false;
        }
    }

    function showDirectory() {
        editorGeneration++;
        editingId = null;
        byId('admin-baza-form').hidden = true;
        byId('admin-baze-directory').hidden = false;
        byId('admin-baze-title').textContent = 'Setări baze sportive';
        setSaving(false);
    }

    function showEditor(id) {
        if (!role || saving) return;
        const base = id ? bases.find(item => item.id === id) : null;
        if ((id && !base) || (!id && !role.isSuper)) return;
        editorGeneration++;
        editingId = id || null;
        byId('admin-baza-form').reset();
        byId('admin-baze-directory').hidden = true;
        byId('admin-baza-form').hidden = false;
        byId('admin-baze-title').textContent = base ? `Setări ${base.nume}` : 'Adaugă bază sportivă';
        byId('baza-nume').value = base?.nume || '';
        byId('baza-oras').value = base?.oras || '';
        byId('baza-descriere').value = base?.descriere || '';
        byId('baza-descriere').setAttribute('aria-label', `Descriere ${base?.nume || 'bază sportivă'}`);
        byId('baza-activa').checked = base?.este_activa !== false;
        for (const field of ['baza-nume', 'baza-oras', 'baza-activa']) byId(field).disabled = !role.isSuper;
        for (const section of ['admin-baza-structura', 'admin-baza-terenuri-section', 'admin-baza-admini-section']) byId(section).hidden = !role.isSuper;
        byId('baza-terenuri').replaceChildren();
        byId('baza-admini').replaceChildren();
        if (role.isSuper) {
            const available = courts.filter(court => !court.baza_sportiva_id || court.baza_sportiva_id === id);
            byId('baza-terenuri').innerHTML = available.length ? available.map(court => `
                <label class="admin-baza-check"><input type="checkbox" data-base-court-id="${esc(court.id)}" ${id && court.baza_sportiva_id === id ? 'checked' : ''}>
                    ${adminSportIconMarkup(court.sport)}<span>${esc(court.nume)}<small>${esc(court.sport)} · ${esc(court.oras || '')}</small></span>
                </label>`).join('') : '<p class="admin-baze-help">Nu sunt terenuri disponibile. Poți crea unul din „Adaugă Teren” și selecta această bază.</p>';
            const eligible = admins.filter(admin => admin.is_super !== true);
            byId('baza-admini').innerHTML = eligible.length ? eligible.map(admin => `
                <label class="admin-baza-check"><input type="checkbox" data-base-admin-id="${esc(admin.user_id)}" ${grants.some(grant => grant.baza_id === id && grant.user_id === admin.user_id) ? 'checked' : ''}>
                    <span>${esc(admin.nume_admin || 'Admin')}</span>
                </label>`).join('') : '<p class="admin-baze-help">Nu există alți administratori. Adaugă un angajat din panoul principal.</p>';
        }
        window.applySportAppearance?.(byId('admin-baza-form'));
        status('');
        setSaving(false);
        byId('admin-baza-form').closest('.modal-continut').scrollTop = 0;
        byId(role.isSuper ? 'baza-nume' : 'baza-descriere').focus({ preventScroll: true });
    }

    async function open() {
        if (!role) return;
        lastFocus = document.activeElement;
        showDirectory();
        const editor = editorGeneration;
        byId('modal-baze-admin').style.display = 'flex';
        status('Se încarcă bazele sportive…');
        const ok = await refresh();
        if (ok && editor === editorGeneration && byId('modal-baze-admin').style.display === 'flex') {
            status('');
            byId('btn-inchide-baze-admin').focus({ preventScroll: true });
        }
    }

    function close() {
        editorGeneration++;
        byId('modal-baze-admin').style.display = 'none';
        if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    }

    async function save(event) {
        event.preventDefault();
        if (!role || saving || byId('admin-baza-form').hidden) return;
        const captured = generation;
        const editor = editorGeneration;
        const sameEditor = () => sameRole(captured) && editor === editorGeneration && byId('modal-baze-admin').style.display === 'flex';
        const description = byId('baza-descriere').value.trim();
        if (description.length > 2000) return status('Descrierea poate avea cel mult 2.000 de caractere.', true);
        const name = byId('baza-nume').value.trim();
        const city = byId('baza-oras').value.trim();
        if (role.isSuper && (!name || !city)) return status('Completează numele bazei și orașul.', true);
        if (!role.isSuper && !editingId) return;
        setSaving(true);
        status('');
        try {
            let result;
            if (role.isSuper) {
                result = await db.rpc('save_sports_base', {
                    p_id: editingId,
                    p_nume: name,
                    p_oras: city,
                    p_descriere: description,
                    p_este_activa: byId('baza-activa').checked,
                    p_court_ids: Array.from(byId('baza-terenuri').querySelectorAll('input:checked'), input => input.dataset.baseCourtId),
                    p_admin_ids: Array.from(byId('baza-admini').querySelectorAll('input:checked'), input => input.dataset.baseAdminId)
                });
            } else {
                result = await db.from('baze_sportive').update({ descriere: description }).eq('id', editingId).select('id');
            }
            if (!sameEditor()) return;
            if (result.error) throw new Error('Salvarea a eșuat. Verifică permisiunile și reîncarcă baza înainte de a încerca din nou.');
            if (!result.data || (!role.isSuper && result.data.length !== 1)) throw new Error('Baza nu mai poate fi modificată. Permisiunea poate fi retrasă; reîncarcă lista.');
            const success = role.isSuper ? 'Baza sportivă a fost salvată.' : 'Descrierea a fost salvată.';
            showDirectory();
            status(success);
            await refresh();
        } catch (error) {
            if (sameEditor()) status(error.message || 'Salvarea nu a reușit.', true);
        } finally {
            if (sameRole(captured) && (editor === editorGeneration || byId('admin-baza-form').hidden)) setSaving(false);
        }
    }

    window.refreshAdminBases = refresh;
    window.refreshAdminBaseOptions = refresh;
    window.addEventListener('spotivity:admin-role', event => {
        clear();
        role = { ...event.detail };
        byId('btn-baze-admin').hidden = !role.isSuper;
        refresh();
    });
    window.addEventListener('spotivity:admin-clear', clear);
    window.addEventListener('spotivity:sport-appearance', () => window.applySportAppearance?.());

    document.addEventListener('DOMContentLoaded', () => {
        byId('btn-baze-admin').addEventListener('click', open);
        byId('btn-baza-noua').addEventListener('click', () => showEditor(null));
        byId('btn-inapoi-baze').addEventListener('click', () => { showDirectory(); status(''); refresh(); });
        byId('btn-inchide-baze-admin').addEventListener('click', close);
        byId('admin-baza-form').addEventListener('submit', save);
        byId('admin-baze-list').addEventListener('click', event => {
            const button = event.target.closest('[data-edit-base]');
            if (button) showEditor(button.dataset.editBase);
        });
        byId('modal-baze-admin').addEventListener('click', event => {
            if (event.target === byId('modal-baze-admin')) close();
        });
        byId('modal-baze-admin').addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(byId('modal-baze-admin').querySelectorAll('button, input, textarea, select')).filter(element => !element.disabled && element.getClientRects().length);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
    });
})();
