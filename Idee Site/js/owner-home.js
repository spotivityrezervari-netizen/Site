/* Owner discovery uses only the verified administration scope supplied by the app.
 * Presentation and search never fetch or copy the public court catalogue. */
(() => {
    'use strict';
    let root;
    let state = { userId: null, access: null, courts: [], active: false };
    let generation = 0;
    let signature = '';
    let overlay = null;
    let previousFocus = null;
    const byId = id => document.getElementById(id);
    const knownSports = ['Fotbal', 'Baschet', 'Tenis', 'Volei', 'Tenis Picior'];
    const sportClasses = ['fotbal', 'baschet', 'tenis', 'volei', 'tenis-picior'];
    const sportImages = [
        { file: 'FotbalFinal.jpeg', width: 1600, height: 1020 },
        { file: 'BaschetFinal.jpeg', width: 1600, height: 1043 },
        { file: 'TenisFINAL.jpeg', width: 1000, height: 1333 },
        { file: 'RealistVolei.png', width: 1672, height: 941 },
        { file: 'RealistTenispicior.png', width: 1672, height: 941 }
    ];
    const sportName = value => window.normalizeSportName?.(value) || String(value || 'Alte sporturi').trim();
    const displaySport = sport => sport === 'Tenis Picior' ? 'Tenis de picior' : sport;
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ro-RO').trim();
    const validId = value => value !== null && value !== undefined && String(value).trim() !== '';
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const safeImage = value => window.safeUrl?.(value, true) || '';
    const editableBases = () => state.access?.bases?.filter(base => base.can_edit_details === true) || [];
    const ownBase = id => state.access?.bases?.find(base => String(base.id) === String(id));

    function icon(kind) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        if (kind === 'search') {
            const circle = document.createElementNS(svg.namespaceURI, 'circle');
            circle.setAttribute('cx', '10.5'); circle.setAttribute('cy', '10.5'); circle.setAttribute('r', '6.5');
            svg.append(circle);
        }
        const paths = kind === 'plus' ? ['M12 5v14', 'M5 12h14']
            : kind === 'search' ? ['m16 16 5 5'] : ['m6 6 12 12', 'M18 6 6 18'];
        for (const d of paths) {
            const path = document.createElementNS(svg.namespaceURI, 'path');
            path.setAttribute('d', d); svg.append(path);
        }
        return svg;
    }

    function status(message = '') {
        const node = byId('owner-home-status');
        if (!node) return;
        node.hidden = !message;
        node.textContent = message;
    }

    function closeOverlay(restoreFocus = true) {
        const wasOpen = overlay;
        overlay = null;
        if (byId('owner-home-menu')) byId('owner-home-menu').hidden = true;
        if (byId('owner-home-dialog')) byId('owner-home-dialog').hidden = true;
        byId('owner-home-menu-toggle')?.setAttribute('aria-expanded', 'false');
        if (byId('owner-home-nav')) byId('owner-home-nav').inert = false;
        if (byId('owner-home-content')) byId('owner-home-content').inert = false;
        document.body.classList.remove('owner-home-menu-open', 'owner-home-dialog-open');
        const focus = previousFocus;
        previousFocus = null;
        if (wasOpen && restoreFocus && focus?.isConnected && !root?.hidden) focus.focus({ preventScroll: true });
    }

    function openOverlay(kind, focus) {
        if (!root || root.hidden || !state.userId || !state.active) return;
        const origin = overlay ? previousFocus : document.activeElement;
        closeOverlay(false);
        previousFocus = origin;
        overlay = kind;
        const target = byId(kind === 'menu' ? 'owner-home-menu' : 'owner-home-dialog');
        target.hidden = false;
        byId('owner-home-nav').inert = true;
        byId('owner-home-content').inert = true;
        document.body.classList.add(kind === 'menu' ? 'owner-home-menu-open' : 'owner-home-dialog-open');
        if (kind === 'menu') byId('owner-home-menu-toggle').setAttribute('aria-expanded', 'true');
        (focus || target.querySelector('button,input'))?.focus({ preventScroll: true });
    }

    async function act(action, context, button) {
        if (!state.userId || !state.active || root?.hidden || button.disabled
            || (!state.access?.can_manage && !['retry', 'logout'].includes(action))) return;
        if (validId(context.courtId) && !state.courts.some(court => String(court.id) === String(context.courtId))) return;
        if (['create', 'base'].includes(action) && !editableBases().some(base => String(base.id) === String(context.baseId))) return;
        const captured = generation;
        const returnFocus = overlay ? previousFocus : button;
        closeOverlay(false);
        status();
        button.disabled = true;
        try {
            if (typeof window.openSpotivityOwnerHomeAction !== 'function') throw new Error('Action unavailable');
            const opened = await window.openSpotivityOwnerHomeAction(action, context);
            if (opened === false) throw new Error('Action unavailable');
        } catch {
            if (generation === captured && state.active) {
                status('Acțiunea nu poate fi deschisă momentan. Încearcă din nou.');
                if (!root.hidden && !root.inert) {
                    const target = returnFocus?.isConnected && !returnFocus.closest('[hidden]') ? returnFocus : byId('owner-home-menu-toggle');
                    target?.focus({ preventScroll: true });
                }
            }
        } finally {
            if (generation === captured && button.isConnected) button.disabled = false;
        }
    }

    function buttonWithContext(label, action, context = {}, className = '') {
        const button = element('button', className, label);
        button.type = 'button';
        button.dataset.ownerAction = action;
        if (validId(context.courtId)) button.dataset.ownerCourtId = String(context.courtId);
        if (validId(context.baseId)) button.dataset.ownerBaseId = String(context.baseId);
        if (context.sport) button.dataset.ownerSport = context.sport;
        return button;
    }

    function actionButton(label, action, context = {}, className = '') {
        const button = buttonWithContext(label, action, context, className);
        button.addEventListener('click', () => void act(action, context, button));
        return button;
    }

    function dialogShell(kind, title) {
        const dialog = byId('owner-home-dialog');
        dialog.replaceChildren();
        dialog.dataset.ownerDialog = kind;
        const panel = element('section', 'owner-home-dialog-panel');
        const header = element('div', 'owner-home-dialog-header');
        const heading = element('h2', '', title); heading.id = 'owner-home-dialog-title';
        const close = element('button', 'owner-home-menu-close');
        close.type = 'button'; close.setAttribute('aria-label', 'Închide'); close.append(icon('close'));
        close.addEventListener('click', () => closeOverlay());
        header.append(heading, close); panel.append(header); dialog.append(panel);
        return panel;
    }

    function requestCreation(sport, trigger) {
        const bases = editableBases();
        if (!bases.length || trigger.disabled) return;
        if (bases.length === 1) {
            void act('create', { baseId: bases[0].id, sport }, trigger);
            return;
        }
        const panel = dialogShell('base-choice', 'Alege baza sportivă');
        panel.append(element('p', 'owner-dialog-hint', sport
            ? `În ce bază vrei să adaugi un teren de ${displaySport(sport)}?`
            : 'În ce bază vrei să adaugi terenul?'));
        const choices = element('div', 'owner-home-base-choices');
        for (const base of bases) {
            const button = actionButton('', 'create', { baseId: base.id, sport }, 'owner-home-base-choice');
            button.dataset.ownerBaseChoice = String(base.id);
            button.append(element('strong', '', base.nume || 'Bază sportivă'));
            if (base.oras) button.append(element('span', '', base.oras));
            choices.append(button);
        }
        panel.append(choices);
        openOverlay('base-choice');
    }

    function newSportButton(id, className = '') {
        const button = buttonWithContext('Adaugă teren în alt sport', 'create', {}, className);
        button.id = id;
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () => requestCreation('', button));
        return button;
    }

    function openSearch() {
        if (!state.access?.can_manage || state.loading) return;
        const query = byId('owner-home-nav-search-input')?.value || '';
        const panel = dialogShell('search', 'Caută un teren');
        const label = element('label', 'owner-dialog-hint', 'Caută după nume, sport sau oraș în terenurile tale.');
        label.htmlFor = 'owner-home-search-input';
        const input = element('input', 'owner-home-search-input');
        input.id = 'owner-home-search-input'; input.type = 'search'; input.autocomplete = 'off';
        input.placeholder = 'Nume, sport sau oraș'; input.value = query;
        const feedback = element('p', 'owner-home-search-status');
        feedback.id = 'owner-home-search-status'; feedback.setAttribute('role', 'status');
        const results = element('div', 'home-search-results owner-home-search-results'); results.id = 'owner-home-search-results';
        const renderResults = () => {
            const tokens = normalize(input.value).split(/\s+/).filter(Boolean);
            const matches = state.courts.filter(court => {
                const base = ownBase(court.baza_sportiva_id);
                const text = normalize([court.nume, sportName(court.sport), displaySport(sportName(court.sport)), court.oras || base?.oras].join(' '));
                return tokens.every(token => text.includes(token));
            });
            results.replaceChildren(...matches.map(court => courtCard(court, sportName(court.sport))));
            feedback.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? 'teren găsit' : 'terenuri găsite'}` : 'Nu am găsit terenuri. Încearcă alt nume, sport sau oraș.';
            byId('owner-home-nav-search-input').value = input.value;
        };
        input.addEventListener('input', renderResults);
        panel.append(label, input, feedback, results);
        renderResults(); openOverlay('search', input);
    }

    function makeShell() {
        closeOverlay(false);
        root.replaceChildren();
        const header = element('header', 'home-header owner-home-header');
        const nav = element('nav', 'home-nav owner-home-nav'); nav.id = 'owner-home-nav';
        nav.setAttribute('aria-label', 'Navigare administrator');
        const brand = element('a', 'home-brand owner-home-brand');
        brand.href = '#owner-home'; brand.setAttribute('aria-label', 'Spotivity — pagina principală');
        const logo = element('img');
        logo.src = 'assets/imagini/avatar2.png'; logo.alt = 'Spotivity'; logo.width = 30; logo.height = 30;
        brand.append(logo);
        const search = element('form', 'home-nav-search'); search.id = 'owner-home-nav-search';
        search.setAttribute('role', 'search'); search.setAttribute('aria-label', 'Caută în terenurile tale');
        const input = element('input'); input.id = 'owner-home-nav-search-input'; input.type = 'search';
        input.autocomplete = 'off'; input.placeholder = 'Caută un teren'; input.setAttribute('aria-label', 'Caută un teren');
        const submit = element('button', 'home-search-button'); submit.id = 'owner-home-search-submit'; submit.type = 'submit';
        submit.setAttribute('aria-label', 'Caută un teren'); submit.setAttribute('aria-controls', 'owner-home-dialog'); submit.setAttribute('aria-haspopup', 'dialog');
        submit.append(icon('search')); search.append(input, submit);
        search.addEventListener('submit', event => { event.preventDefault(); openSearch(); });
        const menuToggle = element('button', 'home-menu-toggle owner-home-menu-toggle');
        menuToggle.type = 'button'; menuToggle.id = 'owner-home-menu-toggle';
        menuToggle.setAttribute('aria-label', 'Deschide meniul de administrare');
        menuToggle.setAttribute('aria-controls', 'owner-home-menu'); menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.append(element('span'), element('span'), element('span'));
        menuToggle.addEventListener('click', () => openOverlay('menu', byId('owner-home-menu-close')));
        nav.append(brand, search, menuToggle); header.append(nav);

        const content = element('main', 'home-main owner-home-content'); content.id = 'owner-home-content';
        const message = element('p', 'owner-home-status');
        message.id = 'owner-home-status'; message.setAttribute('role', 'status'); message.hidden = true;
        const sports = element('div', 'owner-home-sports'); sports.id = 'owner-home-sports';
        const bases = element('section', 'home-bases-section owner-home-bases');
        bases.id = 'owner-home-bases'; bases.setAttribute('aria-label', 'Bazele tale sportive');
        content.append(message, sports, bases);

        const menu = element('div', 'owner-home-menu'); menu.id = 'owner-home-menu'; menu.hidden = true;
        menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-modal', 'true'); menu.setAttribute('aria-labelledby', 'owner-home-menu-title');
        const menuPanel = element('section', 'owner-home-menu-panel');
        const menuHeader = element('div', 'owner-home-menu-header');
        const menuTitle = element('h2', '', 'Meniul tău'); menuTitle.id = 'owner-home-menu-title';
        const menuClose = element('button', 'owner-home-menu-close');
        menuClose.type = 'button'; menuClose.id = 'owner-home-menu-close'; menuClose.setAttribute('aria-label', 'Închide meniul');
        menuClose.append(icon('close')); menuClose.addEventListener('click', () => closeOverlay());
        menuHeader.append(menuTitle, menuClose);
        const menuNav = element('nav', 'owner-home-menu-links'); menuNav.id = 'owner-home-menu-links';
        menuNav.setAttribute('aria-label', 'Acțiuni administrator');
        menuPanel.append(menuHeader, menuNav); menu.append(menuPanel);
        menu.addEventListener('click', event => { if (event.target === menu) closeOverlay(); });
        const dialog = element('div', 'owner-home-dialog'); dialog.id = 'owner-home-dialog'; dialog.hidden = true;
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'owner-home-dialog-title');
        dialog.addEventListener('click', event => { if (event.target === dialog) closeOverlay(); });
        root.append(header, content, menu, dialog);
    }

    function renderBases() {
        const wrapper = byId('owner-home-bases');
        const bases = state.access?.bases || [];
        wrapper.replaceChildren(); wrapper.hidden = !bases.length;
        if (!bases.length) return;
        const heading = element('div', 'home-section-heading'); heading.append(element('h2', '', 'Baze sportive'));
        const grid = element('div', 'owner-home-base-grid');
        wrapper.append(heading, grid);
        for (const base of bases) {
            const card = element('article', 'owner-base-card'); card.dataset.ownerBaseId = String(base.id);
            const photo = window.createSportsBasePhoto?.(base, 'owner-base-cover'); if (photo) card.append(photo);
            const info = element('div', 'owner-base-info');
            const avatar = window.createSportsBaseAvatar?.(base, 'owner-base-avatar'); if (avatar) info.append(avatar);
            const copy = element('div', 'owner-base-copy');
            copy.append(element('h3', '', base.nume || 'Bază sportivă'), element('p', '', base.oras || '')); info.append(copy);
            const actions = element('div', 'owner-base-actions');
            if (base.can_edit_details === true) {
                actions.append(actionButton('Editează baza sportivă', 'base', { baseId: base.id }, 'owner-button owner-button-secondary'));
                actions.append(actionButton('Adaugă teren', 'create', { baseId: base.id }, 'owner-button owner-button-primary'));
            } else actions.append(element('span', 'owner-base-permission', 'Acces la terenurile alocate'));
            card.append(info, actions); grid.append(card);
        }
    }

    function courtCard(court, sport) {
        const base = ownBase(court.baza_sportiva_id);
        const context = { courtId: court.id, baseId: court.baza_sportiva_id || null, sport };
        const card = actionButton('', 'court', context, 'home-court-card owner-court-card');
        card.setAttribute('aria-label', `Editează ${court.nume || 'terenul'}, ${displaySport(sport)}, ${court.oras || base?.oras || ''}${court.este_activ === false ? ', ascuns clienților' : ''}`);
        const image = element('img', 'home-court-photo');
        image.src = safeImage(court.poza) || 'assets/imagini/avatar2.png';
        image.alt = ''; image.width = 240; image.height = 160; image.loading = 'lazy'; image.decoding = 'async';
        image.addEventListener('error', () => { if (image.getAttribute('src') !== 'assets/imagini/avatar2.png') image.src = 'assets/imagini/avatar2.png'; });
        const details = element('span', 'home-court-details');
        details.append(element('strong', 'home-court-name', court.nume || 'Teren'), element('span', 'home-court-meta', [displaySport(sport), court.oras || base?.oras].filter(Boolean).join(' · ')));
        if (court.pret !== null && court.pret !== undefined && Number.isFinite(Number(court.pret))) {
            details.append(element('span', 'home-court-price', `${Number(court.pret).toLocaleString('ro-RO')} Lei/oră`));
        }
        card.append(image, details);
        return card;
    }

    function createCard(sport, index) {
        const card = buttonWithContext('', 'create', { sport }, 'home-court-card owner-add-court-card');
        card.setAttribute('aria-label', `Adaugă un teren de ${displaySport(sport)}`);
        const symbol = element('span', 'home-court-photo owner-create-symbol'); symbol.append(icon('plus'));
        const details = element('span', 'home-court-details');
        details.append(element('strong', '', 'Adaugă teren'), element('span', 'home-court-meta', displaySport(sport)));
        if (!editableBases().length) {
            card.disabled = true;
            const permission = element('span', 'owner-create-permission', 'Nu ai permisiunea de a adăuga terenuri.');
            permission.id = `owner-create-permission-${index}`;
            card.setAttribute('aria-describedby', permission.id);
            card.title = permission.textContent;
            details.append(permission);
        } else card.addEventListener('click', () => requestCreation(sport, card));
        card.append(symbol, details);
        return card;
    }

    function renderSports() {
        const wrapper = byId('owner-home-sports'); wrapper.replaceChildren();
        if (editableBases().length) {
            const actions = element('div', 'owner-home-actions');
            actions.append(newSportButton('owner-home-add-sport', 'owner-button owner-button-secondary'));
            wrapper.append(actions);
        }
        const groups = new Map();
        for (const court of state.courts) {
            const sport = sportName(court.sport);
            if (!groups.has(sport)) groups.set(sport, []);
            groups.get(sport).push(court);
        }
        const sports = [...groups.keys()].sort((a, b) => {
            const order = sport => knownSports.includes(sport) ? window.getSportAppearance?.(sport)?.ordine || knownSports.indexOf(sport) + 1 : 100;
            return order(a) - order(b) || a.localeCompare(b, 'ro');
        });
        sports.forEach((sport, index) => {
            const knownIndex = knownSports.indexOf(sport);
            const section = element('section', `home-sport-hero owner-sport-section${knownIndex < 0 ? '' : ` home-hero-${sportClasses[knownIndex]}`}`);
            section.dataset.ownerSport = sport;
            const copy = element('div', 'home-hero-copy');
            const heading = element('div', 'home-sport-heading');
            const title = element(index === 0 ? 'h1' : 'h2', '', displaySport(sport)); title.id = `owner-home-sport-title-${index}`;
            section.setAttribute('aria-labelledby', title.id); heading.append(title);
            const actions = element('div', 'home-hero-actions');
            actions.append(actionButton('Program', 'program', { sport }, 'home-reserve-button owner-sport-program'));
            copy.append(heading, actions); section.append(copy);
            if (knownIndex >= 0) {
                const artwork = sportImages[knownIndex];
                const art = element('div', 'home-hero-art'); art.setAttribute('aria-hidden', 'true');
                const image = element('img');
                image.src = safeImage(window.getSportAppearance?.(sport)?.fundal_url) || `assets/imagini/${artwork.file}`;
                image.alt = ''; image.dataset.sportBackground = sport; image.width = artwork.width; image.height = artwork.height;
                image.loading = index === 0 ? 'eager' : 'lazy'; image.decoding = 'async';
                if (index === 0) image.setAttribute('fetchpriority', 'high');
                art.append(image); section.append(art);
            }
            const wrap = element('div', 'home-courts-wrap');
            const strip = element('div', 'home-courts-strip owner-courts-strip'); strip.dataset.ownerCourts = sport;
            strip.setAttribute('role', 'region'); strip.setAttribute('aria-label', `Terenurile tale de ${displaySport(sport)}`); strip.tabIndex = 0;
            strip.append(createCard(sport, index), ...groups.get(sport).map(court => courtCard(court, sport)));
            strip.scrollLeft = 0; wrap.append(strip); section.append(wrap); wrapper.append(section);
        });
        if (!sports.length) {
            const empty = element('div', 'owner-home-empty');
            empty.append(element('h1', '', 'Încă nu ai terenuri alocate'), element('p', '', editableBases().length ? 'Adaugă primul teren în baza ta sportivă.' : 'Terenurile apar aici după ce primești acces la ele.'));
            wrapper.append(empty);
        }
        window.applySportAppearance?.(wrapper);
    }

    function renderMenu() {
        const nav = byId('owner-home-menu-links'); nav.replaceChildren();
        const bases = editableBases();
        if (bases.length && !state.loading && state.access?.can_manage) nav.append(newSportButton('owner-home-menu-add-sport'));
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
        closeOverlay(false);
        const available = state.active && !!state.userId;
        root.hidden = !available;
        if (!available) { root.replaceChildren(); return; }
        makeShell();
        if (state.loading || !state.access?.can_manage) {
            byId('owner-home-content').setAttribute('aria-busy', String(state.loading));
            status(state.loading ? 'Se încarcă terenurile tale…' : 'Accesul la terenuri nu este disponibil momentan.');
        } else { renderSports(); renderBases(); }
        renderMenu();
        if (state.error) {
            status(typeof state.error === 'string' ? state.error : 'Terenurile nu pot fi încărcate momentan. Încearcă din nou.');
            byId('owner-home-status').append(actionButton('Încearcă din nou', 'retry', {}, 'owner-button owner-button-secondary'));
        }
    }

    function update(detail = {}) {
        const sourceAccess = detail.access && typeof detail.access === 'object' ? detail.access : null;
        const allowed = new Set((Array.isArray(sourceAccess?.courts) ? sourceAccess.courts : []).filter(Boolean).map(court => String(typeof court === 'object' ? court.id : court)));
        const courts = Array.isArray(detail.courts) ? detail.courts : Array.isArray(sourceAccess?.courts) ? sourceAccess.courts : [];
        const seenCourts = new Set(), seenBases = new Set();
        const access = sourceAccess ? { ...sourceAccess, bases: (Array.isArray(sourceAccess.bases) ? sourceAccess.bases : []).filter(base => {
            if (!base || !validId(base.id) || seenBases.has(String(base.id))) return false;
            seenBases.add(String(base.id)); return true;
        }) } : null;
        const next = { userId: detail.userId || null, access, active: detail.active === true,
            loading: detail.loading === true, error: detail.error || null,
            courts: courts.filter(court => {
                if (!court || !validId(court.id) || !allowed.has(String(court.id)) || seenCourts.has(String(court.id))) return false;
                seenCourts.add(String(court.id)); return true;
            }) };
        const nextSignature = JSON.stringify(next);
        if (signature === nextSignature) return;
        generation++; signature = nextSignature; state = next;
        render();
    }

    const overlayNode = () => byId(overlay === 'menu' ? 'owner-home-menu' : 'owner-home-dialog');
    const overlayControls = () => [...(overlayNode()?.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]') || [])].filter(node => !node.disabled && node.getClientRects().length);
    window.renderSpotivityOwnerHome = update;
    window.closeSpotivityOwnerHomeMenu = closeOverlay;
    window.addEventListener('spotivity:owner-home', event => update(event.detail));
    window.addEventListener('spotivity:sport-appearance', () => { if (state.active && root) window.applySportAppearance?.(root); });
    document.addEventListener('keydown', event => {
        if (!overlay || root?.hidden || root?.inert) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeOverlay(); return; }
        if (event.key !== 'Tab') return;
        const controls = overlayControls(), first = controls[0], last = controls[controls.length - 1];
        if (!controls.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }, true);
    document.addEventListener('focusin', event => {
        if (overlay && !root?.hidden && !root?.inert && !overlayNode()?.contains(event.target)) overlayControls()[0]?.focus({ preventScroll: true });
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
    else render();
})();
