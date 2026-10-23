/* The owner's home is rendered only from the verified administration scope.
 * It never queries or copies the public court catalogue. */
(() => {
    'use strict';
    let root;
    let state = { userId: null, access: null, courts: [], active: false };
    let generation = 0;
    let signature = '';
    let menuOpen = false;
    let previousFocus = null;
    const byId = id => document.getElementById(id);
    const knownSports = ['Fotbal', 'Baschet', 'Tenis', 'Volei', 'Tenis Picior'];
    const sportName = value => window.normalizeSportName?.(value) || String(value || 'Alte sporturi');
    const displaySport = sport => sport === 'Tenis Picior' ? 'Tenis de picior' : sport;
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const safeImage = value => window.safeUrl?.(value, true) || '';
    const editableBases = () => state.access?.bases?.filter(base => base.can_edit_details === true) || [];

    function icon(kind) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const paths = kind === 'profile' ? ['M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21v-2a8 8 0 0 1 16 0v2']
            : kind === 'plus' ? ['M12 5v14', 'M5 12h14']
                : kind === 'close' ? ['m6 6 12 12', 'M18 6 6 18']
                    : ['M4 6h16', 'M4 12h16', 'M4 18h16'];
        for (const d of paths) {
            const path = document.createElementNS(svg.namespaceURI, 'path');
            path.setAttribute('d', d);
            svg.append(path);
        }
        return svg;
    }

    function status(message = '') {
        const node = byId('owner-home-status');
        if (!node) return;
        node.hidden = !message;
        node.textContent = message;
    }

    function closeMenu(restoreFocus = true) {
        if (!root) return;
        const wasOpen = menuOpen;
        menuOpen = false;
        const menu = byId('owner-home-menu');
        if (menu) menu.hidden = true;
        byId('owner-home-menu-toggle')?.setAttribute('aria-expanded', 'false');
        const header = byId('owner-home-nav');
        const content = byId('owner-home-content');
        if (header) header.inert = false;
        if (content) content.inert = false;
        document.body.classList.remove('owner-home-menu-open');
        if (wasOpen && restoreFocus && previousFocus?.isConnected && !root.hidden) previousFocus.focus({ preventScroll: true });
        previousFocus = null;
    }

    function openMenu() {
        if (!root || root.hidden || !state.userId || !state.active) return;
        previousFocus = document.activeElement;
        menuOpen = true;
        byId('owner-home-menu').hidden = false;
        byId('owner-home-menu-toggle').setAttribute('aria-expanded', 'true');
        byId('owner-home-nav').inert = true;
        byId('owner-home-content').inert = true;
        document.body.classList.add('owner-home-menu-open');
        byId('owner-home-menu-close').focus({ preventScroll: true });
    }

    async function act(action, context, button) {
        if (!state.userId || !state.active || button.disabled
            || (!state.access?.can_manage && !['profile', 'retry', 'logout'].includes(action))) return;
        const captured = generation;
        closeMenu(false);
        status();
        button.disabled = true;
        try {
            if (typeof window.openSpotivityOwnerHomeAction !== 'function') throw new Error('Action unavailable');
            await window.openSpotivityOwnerHomeAction(action, context);
        } catch {
            if (generation === captured && state.active) status('Acțiunea nu poate fi deschisă momentan. Încearcă din nou.');
        } finally {
            if (generation === captured && button.isConnected) button.disabled = false;
        }
    }

    function actionButton(label, action, context = {}, className = '') {
        const button = element('button', className, label);
        button.type = 'button';
        button.dataset.ownerAction = action;
        if (context.courtId !== undefined && context.courtId !== null) button.dataset.ownerCourtId = String(context.courtId);
        if (context.baseId) button.dataset.ownerBaseId = String(context.baseId);
        if (context.sport) button.dataset.ownerSport = context.sport;
        button.addEventListener('click', () => void act(action, context, button));
        return button;
    }

    function makeShell() {
        closeMenu(false);
        root.replaceChildren();
        const header = element('header', 'owner-home-header');
        const nav = element('nav', 'owner-home-nav');
        nav.id = 'owner-home-nav';
        nav.setAttribute('aria-label', 'Navigare administrator');
        const brand = element('a', 'owner-home-brand');
        brand.href = '#owner-home';
        brand.setAttribute('aria-label', 'Spotivity · Terenurile tale');
        const logo = element('img');
        logo.src = 'assets/imagini/avatar2.png'; logo.alt = 'Spotivity'; logo.width = 36; logo.height = 36;
        brand.append(logo);
        const copy = element('div', 'owner-home-nav-copy');
        copy.append(element('span', '', 'Spațiul tău de administrare'), element('strong', '', 'Spotivity'));
        const profile = actionButton('', 'profile', {}, 'owner-home-profile');
        profile.id = 'owner-home-profile';
        profile.setAttribute('aria-label', 'Profilul meu');
        profile.append(icon('profile'), element('span', '', 'Profilul meu'));
        const menuToggle = element('button', 'owner-home-menu-toggle');
        menuToggle.type = 'button'; menuToggle.id = 'owner-home-menu-toggle';
        menuToggle.setAttribute('aria-label', 'Deschide meniul de administrare');
        menuToggle.setAttribute('aria-controls', 'owner-home-menu');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.append(icon('menu'));
        menuToggle.addEventListener('click', openMenu);
        nav.append(brand, copy, profile, menuToggle); header.append(nav);

        const content = element('main', 'owner-home-content');
        content.id = 'owner-home-content';
        const heading = element('div', 'owner-home-heading');
        heading.append(element('p', 'owner-home-eyebrow', 'Contul tău · Administrare'), element('h1', '', 'Terenurile tale'));
        const summary = element('p', 'owner-home-summary'); summary.id = 'owner-home-summary';
        heading.append(summary);
        const message = element('p', 'owner-home-status');
        message.id = 'owner-home-status'; message.setAttribute('role', 'status'); message.hidden = true;
        const bases = element('section', 'owner-home-bases');
        bases.id = 'owner-home-bases'; bases.setAttribute('aria-label', 'Bazele tale sportive');
        const sports = element('div', 'owner-home-sports'); sports.id = 'owner-home-sports';
        content.append(heading, message, bases, sports);

        const menu = element('div', 'owner-home-menu');
        menu.id = 'owner-home-menu'; menu.hidden = true;
        menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-modal', 'true'); menu.setAttribute('aria-labelledby', 'owner-home-menu-title');
        const menuPanel = element('section', 'owner-home-menu-panel');
        const menuHeader = element('div', 'owner-home-menu-header');
        const menuTitle = element('h2', '', 'Meniul tău'); menuTitle.id = 'owner-home-menu-title';
        const menuClose = element('button', 'owner-home-menu-close');
        menuClose.type = 'button'; menuClose.id = 'owner-home-menu-close'; menuClose.setAttribute('aria-label', 'Închide meniul');
        menuClose.append(icon('close')); menuClose.addEventListener('click', () => closeMenu());
        menuHeader.append(menuTitle, menuClose);
        const menuNav = element('nav', 'owner-home-menu-links'); menuNav.id = 'owner-home-menu-links';
        menuNav.setAttribute('aria-label', 'Acțiuni administrator');
        menuPanel.append(menuHeader, menuNav); menu.append(menuPanel);
        menu.addEventListener('click', event => { if (event.target === menu) closeMenu(); });
        root.append(header, content, menu);
    }

    function renderBases() {
        const wrapper = byId('owner-home-bases');
        const bases = Array.isArray(state.access?.bases) ? state.access.bases : [];
        wrapper.replaceChildren(); wrapper.hidden = !bases.length;
        for (const base of bases) {
            const card = element('article', 'owner-base-card');
            card.dataset.ownerBaseId = String(base.id);
            const photo = window.createSportsBasePhoto?.(base, 'owner-base-cover');
            if (photo) card.append(photo);
            const info = element('div', 'owner-base-info');
            const avatar = window.createSportsBaseAvatar?.(base, 'owner-base-avatar');
            if (avatar) info.append(avatar);
            const copy = element('div', 'owner-base-copy');
            copy.append(element('h2', '', base.nume || 'Bază sportivă'), element('p', '', base.oras || ''));
            info.append(copy);
            const actions = element('div', 'owner-base-actions');
            if (base.can_edit_details === true) {
                actions.append(actionButton('Editează baza sportivă', 'base', { baseId: base.id }, 'owner-button owner-button-secondary'));
                const add = actionButton('Adaugă teren', 'create', { baseId: base.id }, 'owner-button owner-button-primary');
                add.prepend(icon('plus'));
                actions.append(add);
            } else {
                actions.append(element('span', 'owner-base-permission', 'Acces la terenurile alocate'));
            }
            card.append(info, actions); wrapper.append(card);
        }
    }

    function courtCard(court, sport) {
        const base = state.access.bases?.find(item => String(item.id) === String(court.baza_sportiva_id));
        const context = { courtId: court.id, baseId: court.baza_sportiva_id || null, sport };
        const card = element('article', 'owner-court-card');
        card.dataset.ownerCourtId = String(court.id);
        if (context.baseId) card.dataset.ownerBaseId = String(context.baseId);
        const imageSlot = element('div', 'owner-court-image');
        const image = element('img');
        image.src = safeImage(court.poza) || 'assets/imagini/avatar2.png';
        image.alt = ''; image.width = 520; image.height = 300; image.loading = 'lazy'; image.decoding = 'async';
        image.addEventListener('error', () => { if (image.getAttribute('src') !== 'assets/imagini/avatar2.png') image.src = 'assets/imagini/avatar2.png'; });
        imageSlot.append(image);
        const visibility = element('span', court.este_activ === false ? 'owner-court-visibility is-hidden' : 'owner-court-visibility', court.este_activ === false ? 'Ascuns clienților' : 'Publicat');
        imageSlot.append(visibility);
        if (base?.can_edit_details === true) {
            const add = actionButton('', 'create', { baseId: base.id, sport }, 'owner-court-add');
            add.setAttribute('aria-label', `Adaugă un teren în ${base.nume || 'baza sportivă'}`);
            add.title = 'Adaugă un teren'; add.append(icon('plus')); imageSlot.append(add);
        }
        const body = element('div', 'owner-court-body');
        body.append(element('h3', '', court.nume || 'Teren'), element('p', 'owner-court-location', [base?.nume, court.oras || base?.oras].filter(Boolean).join(' · ')));
        if (Number.isFinite(Number(court.pret)) && court.pret !== null && court.pret !== undefined) body.append(element('p', 'owner-court-price', `${Number(court.pret).toLocaleString('ro-RO')} lei / oră`));
        const actions = element('div', 'owner-court-actions');
        actions.append(actionButton('Editează terenul', 'court', context, 'owner-button owner-button-primary'));
        const shortcuts = element('div', 'owner-court-shortcuts');
        shortcuts.append(actionButton('Rezervare manuală', 'manual', context, 'owner-button owner-button-secondary'));
        if (court.are_chat !== false) shortcuts.append(actionButton('Chat', 'chat', context, 'owner-button owner-button-secondary'));
        actions.append(shortcuts); body.append(actions); card.append(imageSlot, body);
        return card;
    }

    function renderSports() {
        const wrapper = byId('owner-home-sports'); wrapper.replaceChildren();
        const groups = new Map();
        for (const court of state.courts) {
            const sport = sportName(court.sport);
            if (!groups.has(sport)) groups.set(sport, []);
            groups.get(sport).push(court);
        }
        const sports = [...groups.keys()].sort((a, b) => {
            const aOrder = knownSports.includes(a) ? window.getSportAppearance?.(a)?.ordine || knownSports.indexOf(a) + 1 : 100;
            const bOrder = knownSports.includes(b) ? window.getSportAppearance?.(b)?.ordine || knownSports.indexOf(b) + 1 : 100;
            return aOrder - bOrder || a.localeCompare(b, 'ro');
        });
        for (const sport of sports) {
            const courts = groups.get(sport);
            const section = element('section', 'owner-sport-section'); section.dataset.ownerSport = sport;
            if (knownSports.includes(sport)) {
                const art = element('div', 'owner-sport-art'); art.setAttribute('aria-hidden', 'true');
                const image = element('img'); image.src = safeImage(window.getSportAppearance?.(sport)?.fundal_url) || '';
                image.alt = ''; image.dataset.sportBackground = sport; image.loading = 'lazy'; image.decoding = 'async';
                art.append(image); section.append(art);
            }
            const header = element('div', 'owner-sport-heading');
            const copy = element('div'); copy.append(element('p', 'owner-home-eyebrow', `${courts.length} ${courts.length === 1 ? 'teren administrat' : 'terenuri administrate'}`), element('h2', '', displaySport(sport)));
            header.append(copy);
            const bases = editableBases();
            const relevantBases = bases.filter(base => courts.some(court => String(court.baza_sportiva_id) === String(base.id)));
            const target = relevantBases.length === 1 ? relevantBases[0] : bases.length === 1 ? bases[0] : null;
            const sectionActions = element('div', 'owner-sport-actions');
            sectionActions.append(actionButton(`Program ${displaySport(sport)}`, 'program', { sport }, 'owner-button owner-button-secondary'));
            if (target) {
                const add = actionButton('Adaugă teren', 'create', { baseId: target.id, sport }, 'owner-button owner-button-secondary owner-sport-add');
                add.prepend(icon('plus')); sectionActions.append(add);
            }
            header.append(sectionActions);
            const grid = element('div', 'owner-courts-grid');
            courts.forEach(court => grid.append(courtCard(court, sport)));
            section.append(header, grid); wrapper.append(section);
        }
        if (!sports.length) {
            const empty = element('div', 'owner-home-empty');
            empty.append(element('h2', '', 'Încă nu ai terenuri alocate'), element('p', '', editableBases().length ? 'Adaugă primul teren în baza ta sportivă.' : 'Terenurile apar aici după ce primești acces la ele.'));
            wrapper.append(empty);
        }
        window.applySportAppearance?.(wrapper);
    }

    function renderMenu() {
        const nav = byId('owner-home-menu-links'); nav.replaceChildren();
        nav.append(actionButton('Profilul meu', 'profile'));
        const bases = editableBases();
        for (const base of bases) nav.append(actionButton(bases.length === 1 ? 'Editează baza sportivă' : `Editează · ${base.nume || 'Bază sportivă'}`, 'base', { baseId: base.id }));
        if (state.courts.length) {
            nav.append(actionButton('Rezervare manuală', 'manual'));
            if (state.courts.some(court => court.are_chat !== false)) nav.append(actionButton('Chat', 'chat'));
            nav.append(actionButton('Programul terenurilor', 'program'), actionButton('Istoricul rezervărilor', 'history'));
        }
        if (state.access?.can_manage) nav.append(actionButton('Administrare baze de date', 'administration'), actionButton('Vezi site-ul', 'site'));
        else nav.append(actionButton('Încearcă din nou', 'retry'));
        nav.append(actionButton('Deconectare', 'logout', {}, 'owner-menu-logout'));
    }

    function render() {
        root ||= byId('owner-home');
        if (!root) return;
        closeMenu(false);
        const available = state.active && !!state.userId;
        root.hidden = !available;
        if (!available) { root.replaceChildren(); return; }
        makeShell();
        const count = state.courts.length;
        byId('owner-home-summary').textContent = state.loading ? 'Se încarcă terenurile tale…' : `${count} ${count === 1 ? 'teren' : 'terenuri'} · Doar bazele și terenurile pe care le administrezi`;
        if (state.loading || !state.access?.can_manage) {
            byId('owner-home-content').setAttribute('aria-busy', 'true');
        } else {
            renderBases(); renderSports();
        }
        renderMenu();
        if (state.error) {
            status(typeof state.error === 'string' ? state.error : 'Terenurile nu pot fi încărcate momentan. Încearcă din nou.');
            byId('owner-home-status').append(actionButton('Încearcă din nou', 'retry', {}, 'owner-button owner-button-secondary'));
        }
    }

    function update(detail = {}) {
        const access = detail.access && typeof detail.access === 'object' ? detail.access : null;
        const allowed = new Set((Array.isArray(access?.courts) ? access.courts : []).map(court => String(court.id)));
        const courts = Array.isArray(detail.courts) ? detail.courts : Array.isArray(access?.courts) ? access.courts : [];
        const next = { userId: detail.userId || null, access, active: detail.active === true,
            loading: detail.loading === true, error: detail.error || null,
            courts: courts.filter(court => court && allowed.has(String(court.id))) };
        const nextSignature = JSON.stringify(next);
        if (signature === nextSignature) return;
        generation++;
        signature = nextSignature;
        state = next;
        render();
    }

    window.renderSpotivityOwnerHome = update;
    window.closeSpotivityOwnerHomeMenu = closeMenu;
    window.addEventListener('spotivity:owner-home', event => update(event.detail));
    window.addEventListener('spotivity:sport-appearance', () => { if (state.active && root) window.applySportAppearance?.(root); });
    document.addEventListener('keydown', event => {
        if (!menuOpen || root?.hidden) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...byId('owner-home-menu').querySelectorAll('button,a[href]')].filter(node => !node.disabled && node.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (!controls.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
    else render();
})();
