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
    let ownerView = false;
    let sitePreview = false;
    let panelOpen = false;
    let quickMode = false;
    let ownerCourts = [];
    let homeLoading = false;
    let homeError = '';
    let adminContextKey = '';
    let quickOrigin = null;
    let navigationRequest = 0;
    let administrationScroll = 0;
    let catalogWasInert = null;
    let catalogAriaHidden = null;
    const ungrouped = '__ungrouped__';

    const publicDialogs = ['modal-terenuri', 'modal-rezervare', 'modal-cautare-terenuri',
        'modal-baze-sportive', 'modal-club-registration'];

    function externalModal() {
        return Array.from(document.querySelectorAll('.modal')).reverse().find(modal =>
            !modal.closest('#base-admin-workspace') && modal.getClientRects().length
            && ['flex', 'block'].includes(modal.style.display));
    }

    function syncAccountOverlay() {
        const workspace = byId('base-admin-workspace');
        const overlay = ownerView && !workspace.hidden ? externalModal() : null;
        workspace.inert = !!overlay;
        const home = byId('owner-home');
        if (home) home.inert = !!(ownerView && (!workspace.hidden || externalModal()));
        document.body.classList.toggle('base-admin-account-open', !!overlay);
    }

    function renderOwnerHome() {
        const detail = {
            userId, access, courts: ownerCourts,
            active: ownerView && !sitePreview && !panelOpen,
            loading: homeLoading, error: homeError
        };
        window.renderSpotivityOwnerHome?.(detail);
        syncAccountOverlay();
    }

    function closePublicSurfaces() {
        // Controllers restore their own inert regions and cancel pending reads.
        window.closeSpotivityHomeMenu?.(false);
        const basesDialog = byId('modal-baze-sportive');
        if (basesDialog && ['flex', 'block'].includes(basesDialog.style.display)) window.closeSportsBases?.(false);
        window.closeCourtSearch?.(false);
        window.closeSpotivityPublicCourts?.();
        publicDialogs.forEach(id => { const modal = byId(id); if (modal) modal.style.display = 'none'; });
    }

    function setOwnerView(enabled) {
        const catalog = byId('spotivity-top');
        const managementHome = enabled && !sitePreview;
        if (managementHome) closePublicSurfaces();
        if (managementHome && catalogWasInert === null && catalog) {
            catalogWasInert = catalog.inert;
            catalogAriaHidden = catalog.getAttribute('aria-hidden');
        }
        ownerView = enabled;
        document.body.classList.toggle('base-admin-owner', managementHome);
        if (catalog) {
            if (managementHome) {
                catalog.inert = true;
                catalog.setAttribute('aria-hidden', 'true');
            } else if (catalogWasInert !== null) {
                catalog.inert = catalogWasInert;
                if (catalogAriaHidden === null) catalog.removeAttribute('aria-hidden');
                else catalog.setAttribute('aria-hidden', catalogAriaHidden);
                catalogWasInert = null;
                catalogAriaHidden = null;
            }
        }
        syncAccountOverlay();
    }

    function accessNotice(message = '', retry = false) {
        let notice = byId('base-admin-status');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'base-admin-status';
            notice.className = 'base-admin-status';
            notice.setAttribute('role', 'status');
            const text = document.createElement('p'); text.id = 'base-admin-status-text';
            const button = document.createElement('button');
            button.type = 'button'; button.id = 'base-admin-retry-access'; button.className = 'btn-cont';
            button.textContent = 'Încearcă din nou';
            button.addEventListener('click', () => window.refreshSpotivityAdminAccess({ force: true }));
            notice.append(text, button);
            document.querySelector('.base-admin-heading').after(notice);
        }
        notice.hidden = !message;
        byId('base-admin-status-text').textContent = message;
        byId('base-admin-retry-access').hidden = !retry;
    }

    function showWorkspace({ account = false, focus = false, quick = false } = {}) {
        if (sitePreview) return;
        const workspace = byId('base-admin-workspace');
        quickMode = quick;
        workspace.classList.toggle('owner-home-modal', quick);
        workspace.hidden = false;
        document.body.classList.add('base-admin-open');
        if (account) {
            byId('modal-profil').style.display = 'none';
            byId('modal-auth').style.display = 'none';
        }
        renderOwnerHome();
        syncAccountOverlay();
        if (focus && !workspace.inert) byId('btn-inchide-administrare').focus({ preventScroll: true });
    }

    function viewSite() {
        if (!userId || (!ownerView && !access?.can_manage)) return;
        navigationRequest++;
        administrationScroll = byId('base-admin-workspace').scrollTop;
        panelOpen = false;
        sitePreview = true;
        close();
        setOwnerView(ownerView);
        renderRole();
        renderOwnerHome();
        byId('btn-return-to-administration').disabled = false;
        window.scrollTo({ top: 0, behavior: 'instant' });
        byId('btn-return-to-administration').focus({ preventScroll: true });
        Promise.resolve(window.refreshSpotivityPublicCatalog?.()).catch(() => {});
    }

    function returnOwnerHome() {
        navigationRequest++;
        panelOpen = false;
        sitePreview = false;
        close();
        closePublicSurfaces();
        byId('modal-profil').style.display = 'none';
        byId('modal-auth').style.display = 'none';
        setOwnerView(ownerView);
        renderRole();
        renderOwnerHome();
        byId('owner-home')?.querySelector('button')?.focus({ preventScroll: true });
    }

    async function enterManagement({ workspace = false } = {}) {
        const owner = userId;
        if (!owner) return;
        const captured = generation;
        const navigation = ++navigationRequest;
        const button = byId('btn-return-to-administration');
        button.disabled = true;
        try {
            const verified = await window.refreshSpotivityAdminAccess({ force: true });
            if (generation !== captured || userId !== owner || navigation !== navigationRequest) return;
            // On a temporary outage an established owner may reopen only the
            // cleared retry shell. Revoked or stale scopes never reopen it.
            if (!verified && (!ownerView || access !== null)) return;
            if (ownerView && !workspace) {
                returnOwnerHome();
                window.scrollTo({ top: 0, behavior: 'instant' });
                return;
            }
            sitePreview = false;
            panelOpen = true;
            if (!ownerView) closePublicSurfaces();
            setOwnerView(ownerView);
            renderRole();
            if (verified && adminContextKey !== `${selectedBaseId}|${signature}`) await renderSelection();
            if (generation !== captured || userId !== owner || navigation !== navigationRequest) return;
            showWorkspace({ account: true, focus: true });
            byId('base-admin-workspace').scrollTop = administrationScroll;
        } finally {
            if (navigation === navigationRequest) button.disabled = false;
        }
    }

    // Shared widget integrations retain an explicit, freshly authorized panel
    // entry. The owner's navigation labels always use the new homepage.
    window.openSpotivityAdminWorkspace = () => enterManagement({ workspace: true });

    function renderRole() {
        const isSuper = access?.is_super === true;
        byId('base-admin-workspace').classList.toggle('base-admin-super', isSuper);
        const label = isSuper ? 'Deschide panoul de admin' : 'Administrare baze de date';
        byId('btn-administreaza-baza').textContent = label;
        byId('btn-administreaza-baza').setAttribute('aria-controls', ownerView ? 'owner-home' : 'base-admin-workspace');
        byId('base-admin-title').textContent = isSuper ? 'Panoul de administrare' : 'Administrează baza sportivă';
        byId('base-admin-select').closest('.base-admin-selector').hidden = isSuper || !access;
        const backLabel = ownerView ? 'Înapoi la terenurile mele' : 'Vezi site-ul';
        byId('btn-inchide-administrare').textContent = backLabel;
        byId('btn-inchide-administrare').setAttribute('aria-label', backLabel);
        byId('btn-inchide-administrare').setAttribute('aria-controls', ownerView ? 'owner-home' : 'spotivity-top');
        byId('btn-return-to-administration').textContent = ownerView ? 'Înapoi la terenurile mele' : 'Înapoi la administrare';
        byId('btn-editeaza-profil').hidden = ownerView;
        byId('admin-site-preview').hidden = !sitePreview || !userId || (!ownerView && !access?.can_manage);
        const logout = byId('btn-deconectare-administrare');
        if (logout) logout.hidden = !ownerView;
    }

    function close() {
        const workspace = byId('base-admin-workspace');
        workspace.hidden = true;
        workspace.inert = false;
        workspace.classList.remove('owner-home-modal');
        quickMode = false;
        workspace.querySelectorAll('.modal').forEach(modal => { modal.style.display = 'none'; });
        document.body.classList.remove('base-admin-open');
        document.body.classList.remove('base-admin-account-open');
    }

    function finishQuickView() {
        close();
        renderOwnerHome();
        const origin = quickOrigin;
        quickOrigin = null;
        if (origin?.isConnected && origin.getClientRects().length && !origin.closest('[hidden]')) origin.focus({ preventScroll: true });
        else byId('owner-home-menu-toggle')?.focus({ preventScroll: true });
    }

    function clear({ preserveOwner = false } = {}) {
        if (!preserveOwner) {
            sitePreview = false;
            navigationRequest++;
            administrationScroll = 0;
            panelOpen = false;
            byId('btn-return-to-administration').disabled = false;
        }
        access = null;
        ownerCourts = [];
        quickOrigin = null;
        adminContextKey = '';
        homeLoading = false;
        homeError = preserveOwner ? 'Accesul nu poate fi verificat momentan. Reîncearcă pentru a încărca terenurile tale.' : '';
        signature = '';
        selectedBaseId = null;
        setOwnerView(preserveOwner);
        renderRole();
        byId('btn-administreaza-baza').hidden = !preserveOwner;
        byId('base-admin-select').replaceChildren();
        byId('base-admin-access-hint').textContent = '';
        renderBaseCard();
        window.clearSpotivityAdmin?.();
        if (preserveOwner) {
            accessNotice('Accesul la baza sportivă nu poate fi verificat momentan. Datele administrative au fost închise. Poți reîncerca sau te poți deconecta.', true);
            if (panelOpen) showWorkspace();
            else close();
        } else {
            accessNotice();
            close();
        }
        renderOwnerHome();
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
        byId('base-admin-base-avatar')?.replaceChildren();
        byId('base-admin-edit-base').hidden = !base?.can_edit_details;
        if (!base) {
            byId('base-admin-base-name').textContent = '';
            byId('base-admin-base-description').textContent = '';
            return;
        }
        byId('base-admin-base-name').textContent = base.nume;
        byId('base-admin-base-description').textContent = base.descriere || 'Adaugă o descriere și fotografia bazei tale sportive.';
        const image = window.createSportsBasePhoto?.(base, 'base-admin-base-image');
        if (image) byId('base-admin-base-photo').append(image);
        else {
            const fallback = document.createElement('span');
            fallback.textContent = 'Fotografia bazei';
            byId('base-admin-base-photo').append(fallback);
        }
        const avatar = window.createSportsBaseAvatar?.(base, 'base-admin-avatar-image');
        const avatarSlot = byId('base-admin-base-avatar');
        if (avatarSlot) {
            if (avatar) avatarSlot.append(avatar);
            else {
                const initials = document.createElement('span');
                initials.className = 'base-admin-avatar-initials';
                initials.textContent = String(base.nume || 'Bază sportivă').trim().split(/\s+/).slice(0, 2)
                    .map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase('ro-RO');
                initials.setAttribute('aria-label', base.nume || 'Bază sportivă');
                avatarSlot.append(initials);
            }
        }
    }

    async function renderSelection({ allCourts = false, courtId = null } = {}) {
        if (!access?.can_manage || !userId) return false;
        const renderingUser = userId;
        const renderingGeneration = generation;
        const renderingBase = selectedBaseId;
        const renderingSignature = signature;
        const base = access.bases.find(item => item.id === selectedBaseId);
        const courts = courtId != null ? access.courts.filter(court => String(court.id) === String(courtId))
            : access.is_super || allCourts ? access.courts : access.courts.filter(court => selectedBaseId === ungrouped
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
        if (userId !== renderingUser || generation !== renderingGeneration
            || selectedBaseId !== renderingBase || signature !== renderingSignature) return false;
        adminContextKey = courtId != null ? `court:${courtId}|${renderingSignature}`
            : `${allCourts ? 'all:' : ''}${renderingBase}|${renderingSignature}`;
        return true;
    }

    window.openSpotivityOwnerHomeAction = async function(action, options = {}) {
        if (!ownerView || !userId || action === 'profile') return false;
        window.closeSpotivityOwnerHomeMenu?.(false);
        if (action === 'site') { viewSite(); return true; }
        if (action === 'administration') { await enterManagement(); return true; }
        if (action === 'logout') { byId('btn-deconectare-administrare').click(); return true; }
        const owner = userId;
        const captured = generation;
        const navigation = ++navigationRequest;
        const origin = document.activeElement;
        const current = () => userId === owner && generation === captured && navigation === navigationRequest && ownerView;
        const verified = await window.refreshSpotivityAdminAccess({ force: action === 'retry' });
        if (!current() || !verified) return false;
        if (action === 'retry') return true;
        const court = options.courtId == null ? null : ownerCourts.find(item => String(item.id) === String(options.courtId));
        if (options.courtId != null && !court) return false;
        const baseId = options.baseId || court?.baza_sportiva_id || (action === 'create' ? null : selectedBaseId);
        const base = access.bases.find(item => String(item.id) === String(baseId));
        if ((action === 'base' || action === 'create') && !base?.can_edit_details) return false;
        if (base) {
            selectedBaseId = base.id;
            byId('base-admin-select').value = base.id;
        }
        const chatCourtId = action === 'chat' ? court?.id : null;
        const key = chatCourtId != null ? `court:${chatCourtId}|${signature}` : `all:${selectedBaseId}|${signature}`;
        if (adminContextKey !== key && !await renderSelection({ allCourts: true, courtId: chatCourtId })) return false;
        if (!current()) return false;
        byId('modal-profil').style.display = 'none';
        byId('modal-auth').style.display = 'none';
        panelOpen = false;
        quickOrigin = origin;
        showWorkspace({ quick: true });
        let target;
        if (action === 'court' && court) {
            target = byId(`modal-setari-${court.id}`);
            if (target) target.style.display = 'flex';
        } else if (action === 'manual' && ownerCourts.length) {
            if (court) byId('manual-teren').value = court.nume;
            target = byId('modal-rezervare-manuala');
            target.style.display = 'flex';
            await window.actualizeazaOreManualAdmin();
        } else if (action === 'chat' && ownerCourts.length) {
            byId('btn-vezi-chat-admin').click();
            target = byId('modal-chat-admin');
        } else if (action === 'program' && ownerCourts.length) {
            if (court) {
                window.initializeazaTabel([court.nume]);
                byId('modal-tabel-program').style.display = 'flex';
            } else window.deschideProgramAdmin(options.sport || '');
            target = byId('modal-tabel-program');
        } else if (action === 'history' && ownerCourts.length) {
            target = byId('modal-istoric'); target.style.display = 'flex';
        } else if (action === 'base') {
            target = byId('modal-baze-admin');
            await window.openSpotivityBaseEditor(base.id);
        } else if (action === 'create') {
            window.openSpotivityOwnerCourtCreate({ base, sport: options.sport || court?.sport || '', userId: owner });
            target = byId('modal-owner-add-court');
        }
        if (!current()) return false;
        if (!target || !['flex', 'block'].includes(target.style.display)) {
            close(); renderOwnerHome(); return false;
        }
        if (!target.matches('[role="dialog"]') && !target.querySelector('[role="dialog"]')) {
            target.setAttribute('role', 'dialog');
            target.setAttribute('aria-modal', 'true');
            const heading = target.querySelector('h1, h2, h3');
            if (heading) {
                heading.id ||= `${target.id}-heading`;
                target.setAttribute('aria-labelledby', heading.id);
            } else target.setAttribute('aria-label', 'Administrarea terenurilor');
        }
        target.querySelector('button, input, select, [tabindex]')?.focus({ preventScroll: true });
        return true;
    };

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
                clear({ preserveOwner: ownerView });
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
            const enteringOwner = !ownerView && !next.is_super;
            if (changed && quickMode) {
                close();
                adminContextKey = '';
                window.clearSpotivityAdmin?.();
            }
            access = next;
            signature = nextSignature;
            setOwnerView(!next.is_super);
            renderRole();
            byId('btn-administreaza-baza').hidden = false;
            if (ownerView) {
                homeError = '';
                if (enteringOwner) {
                    panelOpen = false;
                    byId('modal-profil').style.display = 'none';
                    byId('modal-auth').style.display = 'none';
                    close();
                }
                if (changed || force) {
                    homeLoading = true;
                    // Remove stale cards before reading the freshly authorized IDs.
                    ownerCourts = [];
                    renderOwnerHome();
                    const ids = next.courts.map(court => court.id);
                    const hydrated = [];
                    for (let start = 0; start < ids.length; start += 100) {
                        const { data: rows, error: courtError } = await db.from('terenuri')
                            .select('*').in('id', ids.slice(start, start + 100)).order('id');
                        if (generation !== captured || userId !== owner || request !== currentRequest) return false;
                        if (courtError) throw courtError;
                        const allowed = new Set(ids.map(String));
                        hydrated.push(...(rows || []).filter(court => allowed.has(String(court.id))));
                    }
                    ownerCourts = hydrated;
                    homeLoading = false;
                }
            }
            if (changed || force) {
                const options = access.bases.map(base => ({ value: base.id, label: `${base.nume} · ${base.oras || ''}` }));
                if (access.courts.some(court => !court.baza_sportiva_id)) options.push({ value: ungrouped, label: 'Terenuri fără bază sportivă' });
                if (access.is_super) selectedBaseId = null;
                else if (!options.some(option => option.value === selectedBaseId)) selectedBaseId = options[0]?.value || null;
                byId('base-admin-select').replaceChildren(...options.map(option => new Option(option.label, option.value)));
                byId('base-admin-select').value = selectedBaseId;
                byId('base-admin-select').disabled = options.length < 2;
                // The existing panel is initialized on demand. Background access
                // refreshes must not clear forms opened over the owner's home.
                if (!ownerView || panelOpen) await renderSelection();
            }
            if (generation === captured && userId === owner && request === currentRequest) {
                accessNotice();
                renderOwnerHome();
                syncAccountOverlay();
            }
            return generation === captured && userId === owner && request === currentRequest && access?.can_manage === true;
        })().catch(() => {
            if (generation === captured && userId === owner && request === currentRequest) clear({ preserveOwner: ownerView });
            return false;
        });
        refreshing = operation;
        try { return await operation; }
        finally { if (refreshing === operation) refreshing = null; }
    };

    document.addEventListener('DOMContentLoaded', () => {
        byId('btn-administreaza-baza').addEventListener('click', enterManagement);
        byId('btn-return-to-administration').addEventListener('click', () => ownerView ? returnOwnerHome() : enterManagement());
        byId('btn-inchide-administrare').addEventListener('click', () => ownerView ? returnOwnerHome() : viewSite());
        let logout = byId('btn-deconectare-administrare');
        if (!logout) {
            logout = document.createElement('button');
            logout.type = 'button'; logout.id = 'btn-deconectare-administrare'; logout.className = 'btn-cont';
            logout.textContent = 'Deconectare'; logout.hidden = true;
            byId('btn-inchide-administrare').after(logout);
        }
        logout.addEventListener('click', async () => {
            if (!userId || logout.disabled) return;
            const owner = userId;
            logout.disabled = true;
            try {
                const { error } = await db.auth.signOut();
                if (error) throw error;
                if (userId === owner) changeUser(null);
                if (!userId) byId('modal-profil').style.display = 'none';
            } catch {
                if (userId === owner) accessNotice('Deconectarea a eșuat. Încearcă din nou.', true);
            } finally { logout.disabled = false; }
        });
        byId('base-admin-edit-base').addEventListener('click', () => {
            const base = access?.bases.find(item => item.id === selectedBaseId && item.can_edit_details);
            if (base) window.openSpotivityBaseEditor?.(base.id);
        });
        window.addEventListener('spotivity:base-updated', event => {
            if (!access || !event.detail?.id) return;
            access.bases = access.bases.map(base => base.id === event.detail.id ? { ...base, ...event.detail } : base);
            signature = JSON.stringify(access);
            renderBaseCard();
            renderOwnerHome();
        });
        window.addEventListener('spotivity:owner-court-created', event => {
            if (event.detail?.userId === userId && ownerView) returnOwnerHome();
        });
        byId('inchide-profil').addEventListener('click', () => { navigationRequest++; });
        byId('base-admin-select').addEventListener('change', async event => {
            selectedBaseId = event.target.value;
            await renderSelection();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && ownerView) navigationRequest++;
            if (byId('base-admin-workspace').hidden) return;
            if (ownerView && externalModal()) return;
            if (event.key === 'Escape') {
                // Closing nested screens keeps the management workspace available.
                const openModal = Array.from(byId('base-admin-workspace').querySelectorAll('.modal'))
                    .some(modal => modal.style.display === 'flex' || modal.style.display === 'block');
                event.preventDefault();
                event.stopPropagation();
                if (openModal) {
                    byId('base-admin-workspace').querySelectorAll('.modal').forEach(modal => { modal.style.display = 'none'; });
                    if (quickMode) finishQuickView();
                    else byId('btn-inchide-administrare').focus({ preventScroll: true });
                } else if (Array.from(byId('base-admin-workspace').querySelectorAll('.sub-pagina-oras')).some(page => page.style.display === 'block')) {
                    window.inchideSubPaginaOras?.();
                    byId('btn-inchide-administrare').focus({ preventScroll: true });
                } else if (ownerView) returnOwnerHome();
                else viewSite();
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
        new MutationObserver(mutations => {
            if (!ownerView) return;
            if (quickMode && !Array.from(byId('base-admin-workspace').querySelectorAll('.modal'))
                .some(modal => ['flex', 'block'].includes(modal.style.display))) {
                finishQuickView();
            }
            const hadOverlay = byId('base-admin-workspace').inert;
            syncAccountOverlay();
            if (hadOverlay && !byId('base-admin-workspace').hidden && !byId('base-admin-workspace').inert && !quickMode) byId('btn-inchide-administrare').focus({ preventScroll: true });
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden'] });
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
