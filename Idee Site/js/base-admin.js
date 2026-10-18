/* Same-page facility management. Authority always comes from the authenticated server RPC. */
(() => {
    'use strict';
    const byId = id => document.getElementById(id);
    let userId = null;
    let generation = 0;
    let request = 0;
    let access = null;
    let signature = '';
    let selectedBaseId = null;
    let refreshing = null;
    let lastFocus = null;
    const ungrouped = '__ungrouped__';

    function renderRole() {
        const isSuper = access?.is_super === true;
        byId('base-admin-workspace').classList.toggle('base-admin-super', isSuper);
        const label = isSuper ? 'Deschide panoul de admin' : 'Administrează baza sportivă';
        byId('btn-administreaza-baza').textContent = label;
        byId('base-admin-title').textContent = isSuper ? 'Panoul de administrare' : 'Administrează baza sportivă';
        byId('base-admin-select').closest('.base-admin-selector').hidden = isSuper;
    }

    function close(returnToProfile = true) {
        const workspace = byId('base-admin-workspace');
        workspace.hidden = true;
        workspace.querySelectorAll('.modal').forEach(modal => { modal.style.display = 'none'; });
        document.body.classList.remove('base-admin-open');
        if (returnToProfile && userId) {
            byId('modal-profil').style.display = 'flex';
            (lastFocus || byId('btn-administreaza-baza')).focus({ preventScroll: true });
        }
    }

    function clear() {
        access = null;
        signature = '';
        selectedBaseId = null;
        renderRole();
        byId('btn-administreaza-baza').hidden = true;
        byId('base-admin-select').replaceChildren();
        byId('base-admin-access-hint').textContent = '';
        renderBaseCard();
        close(false);
        window.clearSpotivityAdmin?.();
    }

    function changeUser(nextUserId) {
        if (nextUserId === userId) return;
        userId = nextUserId;
        generation++;
        request++;
        refreshing = null;
        clear();
    }

    function renderBaseCard() {
        const base = !access?.is_super && access?.bases.find(item => item.id === selectedBaseId);
        byId('base-admin-base-card').hidden = !base;
        byId('base-admin-base-photo').replaceChildren();
        byId('base-admin-edit-base').hidden = !base?.can_edit_details;
        if (!base) return;
        byId('base-admin-base-name').textContent = base.nume;
        byId('base-admin-base-description').textContent = base.descriere || 'Adaugă o descriere și fotografia bazei tale sportive.';
        const image = window.createSportsBasePhoto?.(base, 'base-admin-base-image');
        if (image) byId('base-admin-base-photo').append(image);
        else {
            const fallback = document.createElement('span');
            fallback.textContent = 'Fotografia bazei';
            byId('base-admin-base-photo').append(fallback);
        }
    }

    async function renderSelection() {
        if (!access?.can_manage || !userId) return;
        const base = access.bases.find(item => item.id === selectedBaseId);
        const courts = access.is_super ? access.courts : access.courts.filter(court => selectedBaseId === ungrouped
            ? !court.baza_sportiva_id : court.baza_sportiva_id === selectedBaseId);
        byId('base-admin-access-hint').textContent = base
            ? `${base.nume} · ${base.oras || ''}${courts.length ? ` · ${courts.length} ${courts.length === 1 ? 'teren' : 'terenuri'} cu acces` : ' · Acces la prezentarea bazei'}${base.can_edit_details ? '' : ' · Fără permisiune de editare a prezentării'}`
            : 'Terenuri alocate fără o bază sportivă asociată.';
        renderBaseCard();
        const profile = window.getSpotivityProfileUser?.();
        // The server RPC supplies the real role; Auth metadata is never authority.
        await window.renderSpotivityAdmin({
            user_id: userId,
            nume_admin: access.nume_admin || profile?.nume || profile?.email || 'Administrator',
            is_super: access.is_super === true,
            terenuri: courts.map(court => court.nume).join(','),
            selectedBaseId,
            baseAccess: access.is_super ? null : access.bases
        });
    }

    window.refreshSpotivityAdminAccess = async function({ force = false } = {}) {
        if (!userId) return false;
        if (refreshing && !force) return refreshing;
        const captured = generation;
        const owner = userId;
        const currentRequest = ++request;
        const operation = (async () => {
            const { data, error } = await db.rpc('get_admin_access');
            if (generation !== captured || userId !== owner || request !== currentRequest) return false;
            if (error || !data || typeof data.can_manage !== 'boolean') {
                clear();
                return false;
            }
            const next = {
                is_super: data.is_super === true,
                nume_admin: typeof data.nume_admin === 'string' ? data.nume_admin : '',
                can_manage: data.can_manage === true,
                courts: Array.isArray(data.courts) ? data.courts : [],
                bases: Array.isArray(data.bases) ? data.bases : []
            };
            if (!next.can_manage || (!next.is_super && !next.courts.length && !next.bases.some(base => base.can_edit_details))) {
                clear();
                return false;
            }
            const nextSignature = JSON.stringify(next);
            const changed = nextSignature !== signature;
            access = next;
            signature = nextSignature;
            renderRole();
            byId('btn-administreaza-baza').hidden = false;
            if (changed || force) {
                const options = access.bases.map(base => ({ value: base.id, label: `${base.nume} · ${base.oras || ''}` }));
                if (access.courts.some(court => !court.baza_sportiva_id)) options.push({ value: ungrouped, label: 'Terenuri fără bază sportivă' });
                if (access.is_super) selectedBaseId = null;
                else if (!options.some(option => option.value === selectedBaseId)) selectedBaseId = options[0]?.value || null;
                byId('base-admin-select').replaceChildren(...options.map(option => new Option(option.label, option.value)));
                byId('base-admin-select').value = selectedBaseId;
                byId('base-admin-select').disabled = options.length < 2;
                await renderSelection();
            }
            return generation === captured && userId === owner && request === currentRequest && access?.can_manage === true;
        })().catch(() => {
            if (generation === captured && request === currentRequest) clear();
            return false;
        });
        refreshing = operation;
        try { return await operation; }
        finally { if (refreshing === operation) refreshing = null; }
    };

    document.addEventListener('DOMContentLoaded', () => {
        byId('btn-administreaza-baza').addEventListener('click', async event => {
            lastFocus = event.currentTarget;
            const owner = userId;
            if (!await window.refreshSpotivityAdminAccess({ force: true }) || !owner || userId !== owner || !access?.can_manage) return;
            byId('modal-profil').style.display = 'none';
            byId('base-admin-workspace').hidden = false;
            document.body.classList.add('base-admin-open');
            byId('btn-inchide-administrare').focus({ preventScroll: true });
        });
        byId('btn-inchide-administrare').addEventListener('click', () => close());
        byId('base-admin-edit-base').addEventListener('click', () => {
            const base = access?.bases.find(item => item.id === selectedBaseId && item.can_edit_details);
            if (base) window.openSpotivityBaseEditor?.(base.id);
        });
        window.addEventListener('spotivity:base-updated', event => {
            if (!access || !event.detail?.id) return;
            access.bases = access.bases.map(base => base.id === event.detail.id ? { ...base, ...event.detail } : base);
            signature = JSON.stringify(access);
            renderBaseCard();
        });
        byId('base-admin-select').addEventListener('change', async event => {
            selectedBaseId = event.target.value;
            await renderSelection();
        });
        document.addEventListener('keydown', event => {
            if (byId('base-admin-workspace').hidden) return;
            if (event.key === 'Escape') {
                // Closing nested screens keeps the management workspace available.
                const openModal = Array.from(byId('base-admin-workspace').querySelectorAll('.modal'))
                    .some(modal => modal.style.display === 'flex' || modal.style.display === 'block');
                event.preventDefault();
                event.stopPropagation();
                if (openModal) {
                    byId('base-admin-workspace').querySelectorAll('.modal').forEach(modal => { modal.style.display = 'none'; });
                    byId('btn-inchide-administrare').focus({ preventScroll: true });
                } else if (Array.from(byId('base-admin-workspace').querySelectorAll('.sub-pagina-oras')).some(page => page.style.display === 'block')) {
                    window.inchideSubPaginaOras?.();
                    byId('btn-inchide-administrare').focus({ preventScroll: true });
                } else close();
                return;
            }
            if (event.key !== 'Tab') return;
            const activeModal = Array.from(byId('base-admin-workspace').querySelectorAll('.modal')).reverse()
                .find(modal => modal.style.display === 'flex' || modal.style.display === 'block');
            const root = activeModal || byId('base-admin-workspace');
            const controls = Array.from(root.querySelectorAll('button, input, select, textarea, a[href]'))
                .filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
            const first = controls[0]; const last = controls[controls.length - 1];
            if (!controls.includes(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
                return;
            }
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }, true);
        // A fresh server check when opening the profile, after tab focus, and while active
        // exposes approvals and removes revoked access without a second login.
        new MutationObserver(() => {
            if (byId('modal-profil').style.display === 'flex') window.refreshSpotivityAdminAccess();
        }).observe(byId('modal-profil'), { attributes: true, attributeFilter: ['style'] });
        window.addEventListener('focus', () => window.refreshSpotivityAdminAccess());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) window.refreshSpotivityAdminAccess();
        });
        setInterval(() => { if (!document.hidden && userId) window.refreshSpotivityAdminAccess(); }, 30000);
        window.addEventListener('spotivity:profile-user', event => {
            changeUser(event.detail?.user?.id || null);
            if (userId) window.refreshSpotivityAdminAccess();
        });
        db.auth.onAuthStateChange((event, session) => {
            changeUser(session?.user?.id || null);
            if (userId) setTimeout(() => window.refreshSpotivityAdminAccess(), 0);
        });
    });
})();
