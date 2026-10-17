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
    let photoSaving = false;
    let photoDraft = null;
    let photoSelection = 0;
    let photoOperation = null;
    let lastFocus = null;
    const photoBucket = 'poze_baze_sportive';
    const photoTypes = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/avif': ['avif'], 'image/gif': ['gif'] };
    const photoPathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|avif|gif)$/i;
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
        byId('btn-salveaza-baza').disabled = value || photoSaving;
        byId('btn-salveaza-baza').textContent = value ? 'Se salvează…' : role?.isSuper ? 'Salvează baza' : 'Salvează descrierea';
        byId('btn-inapoi-baze').disabled = value || photoSaving;
        renderPhotoControls();
    }

    function photoStatus(message, error = false) {
        const node = byId('admin-baza-photo-status');
        if (!node) return;
        node.textContent = message;
        node.classList.toggle('is-error', error);
    }

    const currentBase = () => bases.find(base => base.id === editingId);
    const canEditPhoto = () => !!role && !!editingId && !!currentBase()
        && (role.isSuper || role.baseAccess?.some(base => base.id === editingId && base.can_edit_details === true)
            || grants.some(grant => grant.baza_id === editingId && grant.user_id === role.userId));

    function discardPhotoDraft() {
        photoSelection++;
        if (photoDraft?.url) URL.revokeObjectURL(photoDraft.url);
        photoDraft = null;
        const input = byId('baza-poza-file');
        if (input) input.value = '';
    }

    function cancelPhotoOperation() {
        photoOperation?.controller.abort();
        photoOperation = null;
        photoSaving = false;
        discardPhotoDraft();
    }

    function photoUrl(path) {
        if (typeof path !== 'string' || !photoPathPattern.test(path) || path.split('/')[0] !== editingId) return '';
        const publicUrl = db.storage.from(photoBucket).getPublicUrl(path)?.data?.publicUrl;
        const safe = window.safeUrl(publicUrl);
        if (!safe) return '';
        try { return new URL(safe).origin === new URL(supabaseUrl).origin ? safe : ''; }
        catch (_) { return ''; }
    }

    function renderPhotoControls() {
        const input = byId('baza-poza-file');
        if (!input) return;
        const busy = saving || photoSaving;
        const allowed = canEditPhoto();
        input.disabled = busy || !allowed;
        byId('btn-baza-poza-save').disabled = busy || !allowed || !photoDraft?.ready;
        byId('btn-baza-poza-save').textContent = photoSaving ? 'Se salvează fotografia…' : 'Salvează fotografia';
        byId('btn-baza-poza-clear').hidden = !photoDraft;
        byId('btn-baza-poza-clear').disabled = busy;
        byId('btn-baza-poza-remove').hidden = !currentBase()?.poza;
        byId('btn-baza-poza-remove').disabled = busy || !allowed;
        byId('baza-poza-selection').textContent = photoDraft
            ? `${photoDraft.file.name} · ${(photoDraft.file.size / 1024 / 1024).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} MB${photoDraft.ready ? ' · Fotografie nesalvată' : ' · Se verifică imaginea…'}` : '';
        byId('baza-poza-hint').textContent = !editingId
            ? 'Salvează mai întâi baza sportivă, apoi redeschide setările pentru a adăuga fotografia.'
            : 'JPG, PNG, WebP, AVIF sau GIF, maximum 5 MB. Fotografia se salvează separat de celelalte date ale bazei.';
        byId('admin-baza-photo-section').setAttribute('aria-busy', String(photoSaving));
    }

    function renderPhoto() {
        const image = byId('baza-poza-preview');
        if (!image) return;
        const base = currentBase();
        const source = photoDraft?.ready ? photoDraft.url : photoUrl(base?.poza);
        image.hidden = !source;
        byId('baza-poza-empty').hidden = !!source;
        byId('baza-poza-empty').textContent = 'Baza nu are încă o fotografie.';
        if (source) {
            image.alt = `${photoDraft?.ready ? 'Previzualizarea fotografiei selectate' : 'Fotografia bazei'}${base?.nume ? ` · ${base.nume}` : ''}`;
            image.src = source;
        } else image.removeAttribute('src');
        renderPhotoControls();
    }

    async function choosePhoto() {
        if (saving || photoSaving || !canEditPhoto()) return;
        const file = byId('baza-poza-file').files?.[0];
        discardPhotoDraft();
        photoStatus('');
        if (!file) return renderPhoto();
        const extension = file.name.split('.').pop()?.toLowerCase();
        const accepted = Object.prototype.hasOwnProperty.call(photoTypes, file.type) ? photoTypes[file.type] : null;
        if (!accepted || !accepted.includes(extension)) {
            photoStatus('Alege o imagine JPG, PNG, WebP, AVIF sau GIF. Fișierele SVG nu sunt acceptate.', true);
            return renderPhoto();
        }
        if (!file.size || file.size > 5 * 1024 * 1024) {
            photoStatus('Fotografia trebuie să aibă cel mult 5 MB și să nu fie goală.', true);
            return renderPhoto();
        }
        const captured = generation;
        const editor = editorGeneration;
        const selection = photoSelection;
        const draft = { file, extension: accepted[0], url: URL.createObjectURL(file), ready: false };
        photoDraft = draft;
        renderPhotoControls();
        try {
            const image = new Image();
            image.src = draft.url;
            await image.decode();
            if (!sameRole(captured) || editor !== editorGeneration || selection !== photoSelection || photoDraft !== draft) return;
            if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
            draft.ready = true;
            renderPhoto();
        } catch (_) {
            if (!sameRole(captured) || editor !== editorGeneration || selection !== photoSelection || photoDraft !== draft) return;
            discardPhotoDraft();
            photoStatus('Fișierul nu poate fi afișat ca imagine. Alege o altă fotografie.', true);
            renderPhoto();
        }
    }

    const samePhotoContext = context => photoOperation === context && sameRole(context.generation)
        && context.editor === editorGeneration && role.userId === context.userId && editingId === context.baseId
        && !context.controller.signal.aborted && byId('modal-baze-admin').style.display === 'flex';
    const checkPhotoContext = context => { if (!samePhotoContext(context)) throw new Error('Photo context changed'); };

    async function photoClient(context) {
        checkPhotoContext(context);
        const { data: identity, error: identityError } = await db.auth.getUser();
        checkPhotoContext(context);
        if (identityError || identity?.user?.id !== context.userId) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
        const { data, error } = await db.auth.getSession();
        checkPhotoContext(context);
        const session = data?.session;
        if (error || session?.user?.id !== context.userId || !session.access_token || !session.refresh_token) throw new Error('Sesiunea a expirat. Conectează-te din nou.');
        // Bind both Storage and the base UPDATE to this verified account, even if another tab switches accounts.
        const client = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        context.client = client;
        const { error: bindError } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
        checkPhotoContext(context);
        if (bindError) throw new Error('Sesiunea a expirat. Conectează-te din nou.');
        const { data: verified, error: verifiedError } = await client.auth.getUser();
        checkPhotoContext(context);
        if (verifiedError || verified?.user?.id !== context.userId) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
        return client;
    }

    async function removeObject(client, path, baseId) {
        if (!path || !photoPathPattern.test(path) || path.split('/')[0] !== baseId) return false;
        try {
            const { error } = await client.storage.from(photoBucket).remove([path]);
            return !error;
        } catch (_) { return false; }
    }

    async function savePhoto(remove = false) {
        if (saving || photoSaving || !canEditPhoto() || (!remove && !photoDraft?.ready)) return;
        const base = currentBase();
        if (remove && !base.poza) return;
        const draft = photoDraft;
        const context = { generation, editor: editorGeneration, baseId: editingId, userId: role.userId, controller: new AbortController(), client: null };
        photoOperation = context;
        photoSaving = true;
        setSaving(saving);
        photoStatus(remove ? 'Se elimină fotografia…' : 'Se încarcă fotografia…');
        let uploadedPath = null;
        let metadataSaved = false;
        let metadataAttempted = false;
        try {
            const client = await photoClient(context);
            checkPhotoContext(context);
            let nextPath = null;
            if (!remove) {
                nextPath = `${context.baseId}/${crypto.randomUUID()}.${draft.extension}`;
                uploadedPath = nextPath;
                const { data, error } = await client.storage.from(photoBucket).upload(nextPath, draft.file, {
                    contentType: draft.file.type, upsert: false, cacheControl: '3600'
                });
                checkPhotoContext(context);
                if (error || data?.path !== nextPath) throw new Error('Fotografia nu a putut fi încărcată. Verifică permisiunile și încearcă din nou.');
            }
            checkPhotoContext(context);
            metadataAttempted = true;
            let update = client.from('baze_sportive').update({ poza: nextPath }).eq('id', context.baseId).select('id,poza');
            if (typeof update.abortSignal === 'function') update = update.abortSignal(context.controller.signal);
            const result = await update;
            checkPhotoContext(context);
            if (result.error || !Array.isArray(result.data) || result.data.length !== 1
                || result.data[0].id !== context.baseId || result.data[0].poza !== nextPath) {
                throw new Error('Salvarea fotografiei nu a putut fi confirmată. Reîncarcă baza și verifică permisiunile înainte să încerci din nou.');
            }
            metadataSaved = true;
            bases = bases.map(item => item.id === context.baseId ? { ...item, poza: nextPath } : item);
            discardPhotoDraft();
            renderPhoto();
            let cleaned = true;
            if (base.poza && base.poza !== nextPath) {
                cleaned = await removeObject(client, base.poza, context.baseId);
                checkPhotoContext(context);
            }
            photoStatus(cleaned ? remove ? 'Fotografia a fost eliminată.' : 'Fotografia a fost salvată.'
                : `${remove ? 'Fotografia nu mai este afișată pe site.' : 'Fotografia a fost salvată.'} Imaginea anterioară nu a putut fi eliminată. Verifică permisiunile înainte să încerci din nou.`, !cleaned);
        } catch (error) {
            let cleanupFailed = false;
            if (uploadedPath && !metadataSaved && context.client) {
                // A lost UPDATE response may hide a committed change. Check the reference before deleting the new object.
                let canCleanup = !metadataAttempted;
                if (metadataAttempted) {
                    try {
                        const result = await context.client.from('baze_sportive').select('id,poza').eq('id', context.baseId).maybeSingle();
                        canCleanup = !result.error && result.data?.id === context.baseId && result.data.poza !== uploadedPath;
                    } catch (_) { canCleanup = false; }
                }
                if (canCleanup) cleanupFailed = !await removeObject(context.client, uploadedPath, context.baseId);
                else cleanupFailed = true;
            }
            if (samePhotoContext(context)) photoStatus(`${error.message || 'Fotografia nu a putut fi salvată.'}${cleanupFailed ? ' Fișierul nou nu a putut fi curățat automat. Reîncarcă baza înainte de a încerca din nou.' : ''}`, true);
        } finally {
            context.client?.auth.stopAutoRefresh();
            if (samePhotoContext(context)) {
                photoOperation = null;
                photoSaving = false;
                setSaving(saving);
                renderPhotoControls();
            }
        }
    }

    function baseOptions() {
        const select = byId('teren-baza');
        if (!select) return;
        const previous = select.value;
        select.replaceChildren(new Option('Fără bază sportivă', ''));
        if (role?.isSuper) {
            for (const base of bases) select.add(new Option(`${base.nume} · ${base.oras}`, base.id));
        }
        if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    }

    function clear() {
        cancelPhotoOperation();
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
        photoStatus('');
        renderPhoto();
        setSaving(false);
        baseOptions();
    }

    function renderDirectory() {
        byId('btn-baza-noua').hidden = !role?.isSuper;
        byId('admin-baze-access-hint').textContent = role?.isSuper ? 'Descrieri, fotografii, terenuri și permisiuni' : 'Descrierile și fotografiile bazelor la care ai acces';
        byId('admin-baze-list').innerHTML = bases.length ? bases.map(base => `
            <button type="button" class="admin-base-card" data-edit-base="${esc(base.id)}">
                <strong>${esc(base.nume)}</strong>
                <span>${esc(base.oras)}</span>
                <small>${role.isSuper ? `${courts.filter(court => court.baza_sportiva_id === base.id).length} terenuri · ${base.este_activa ? 'Activă' : 'Ascunsă'}` : 'Editează descrierea și fotografia'}</small>
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
            bases = (results[0].data || []).filter(base => {
                if (role.selectedBaseId && base.id !== role.selectedBaseId) return false;
                if (role.baseAccess) return role.baseAccess.some(allowed => allowed.id === base.id && allowed.can_edit_details === true);
                return role.isSuper || grants.some(grant => grant.baza_id === base.id && grant.user_id === role.userId);
            });
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
        cancelPhotoOperation();
        editorGeneration++;
        editingId = null;
        byId('admin-baza-form').hidden = true;
        byId('admin-baze-directory').hidden = false;
        byId('admin-baze-title').textContent = 'Setări baze sportive';
        setSaving(false);
        renderPhoto();
    }

    function showEditor(id) {
        if (!role || saving || photoSaving) return;
        const base = id ? bases.find(item => item.id === id) : null;
        if ((id && !base) || (!id && !role.isSuper)) return;
        editorGeneration++;
        cancelPhotoOperation();
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
        photoStatus('');
        setSaving(false);
        renderPhoto();
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
        cancelPhotoOperation();
        renderPhoto();
        byId('modal-baze-admin').style.display = 'none';
        if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    }

    async function save(event) {
        event.preventDefault();
        if (!role || saving || photoSaving || byId('admin-baza-form').hidden) return;
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
        new MutationObserver(() => {
            if (byId('modal-baze-admin').style.display !== 'flex' && (photoDraft || photoOperation)) {
                editorGeneration++;
                cancelPhotoOperation();
                renderPhoto();
            }
        }).observe(byId('modal-baze-admin'), { attributes: true, attributeFilter: ['style'] });
        byId('btn-baze-admin').addEventListener('click', open);
        byId('btn-baza-noua').addEventListener('click', () => showEditor(null));
        byId('btn-inapoi-baze').addEventListener('click', () => { showDirectory(); status(''); refresh(); });
        byId('btn-inchide-baze-admin').addEventListener('click', close);
        byId('admin-baza-form').addEventListener('submit', save);
        byId('baza-poza-file').addEventListener('change', choosePhoto);
        byId('btn-baza-poza-save').addEventListener('click', () => savePhoto(false));
        byId('btn-baza-poza-remove').addEventListener('click', () => savePhoto(true));
        byId('btn-baza-poza-clear').addEventListener('click', () => {
            if (saving || photoSaving) return;
            discardPhotoDraft();
            photoStatus('');
            renderPhoto();
        });
        byId('baza-poza-preview').addEventListener('error', () => {
            byId('baza-poza-preview').hidden = true;
            byId('baza-poza-empty').hidden = false;
            byId('baza-poza-empty').textContent = 'Fotografia nu a putut fi afișată. Poți alege o altă imagine.';
        });
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
