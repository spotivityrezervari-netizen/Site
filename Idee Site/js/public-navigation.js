/* Public entity URLs identify a court/base; live RLS reads still authorize it. */
(() => {
    'use strict';
    const paths = window.SpotivityEntityPaths;
    if (!paths || typeof window.siteHomeUrl !== 'function') return;
    const initialDocumentUrl = new URL(window.location.href);
    const documentLinkBase = new URL(initialDocumentUrl);
    documentLinkBase.search = ''; documentLinkBase.hash = '';
    const appRoot = new URL(window.siteHomeUrl());
    appRoot.search = ''; appRoot.hash = '';
    const stateKey = 'spotivityPublicNavigation';
    const publicModals = new Set(['modal-terenuri', 'modal-rezervare', 'modal-baze-sportive', 'modal-cautare-terenuri']);
    const protectedKeys = ['code', 'token', 'token_hash', 'access_token', 'refresh_token', 'error', 'error_code'];
    function protectedIntent(url = new URL(location.href)) {
        const hash = new URLSearchParams(url.hash.slice(1));
        return protectedKeys.some(key => url.searchParams.has(key) || hash.has(key))
            || url.searchParams.get('type') === 'recovery' || hash.get('type') === 'recovery'
            || hash.has('spotivity-action') || url.searchParams.has('spotivity-action');
    }
    const initialProtectedIntent = protectedIntent(initialDocumentUrl);
    let ready = false, initialized = false, restoring = false, goingBack = false;
    let generation = 0, controller = null, active = null, currentEntry = null;
    let previousView = null, baseOrigin = null, hasBaseOrigin = false, queuedEntity = null;
    let restoreAfterClose = true;
    let pendingPromise = Promise.resolve(), settle = null;
    let sourceMetadata, canonicalRoot;
    const entityRecords = new Map();
    const byId = id => document.getElementById(id);
    const visible = id => {
        const node = byId(id);
        return !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    };
    const foreignModal = () => [...document.querySelectorAll('.modal')]
        .some(node => !publicModals.has(node.id) && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const isPrivateWorkspace = () => document.body.classList.contains('base-admin-owner')
        || !!document.querySelector('#base-admin-workspace:not([hidden])');
    function indexedPath(kind, id) {
        const value = window.spotivitySeoRoutes?.[kind === 'court' ? 'courts' : 'bases']?.[id];
        if (typeof value !== 'string' || value.length > 240 || !value.endsWith(`-${id}/`)) return '';
        const pattern = kind === 'court'
            ? /^terenuri\/(?:fotbal|baschet|tenis|volei|tenis-de-picior)\/[a-z0-9-]+\/$/
            : /^baze-sportive\/[a-z0-9-]+\/$/;
        return pattern.test(value) ? value : '';
    }
    function entityUrl(kind, row) {
        const id = paths.normalizedId(row?.id);
        if (!id) return '';
        const indexed = indexedPath(kind, id);
        if (indexed) return new URL(indexed, appRoot).href;
        const url = new URL(appRoot);
        url.searchParams.set(kind === 'court' ? 'teren' : 'baza', id);
        url.searchParams.set('nume', paths.slug(row?.nume, kind === 'court' ? 'teren' : 'baza'));
        const city = paths.citySlug(row?.oras);
        if (city) url.searchParams.set('oras', city);
        return url.href;
    }
    function startPending() {
        settle?.();
        pendingPromise = new Promise(resolve => { settle = resolve; });
    }
    function finishPending() { settle?.(); settle = null; }
    async function whenSettled() {
        const observed = pendingPromise;
        await observed;
        if (observed !== pendingPromise || settle || restoring || goingBack) return whenSettled();
    }
    function status(text = '') {
        let node = byId('public-navigation-status');
        if (!node && text) {
            node = document.createElement('p'); node.id = 'public-navigation-status';
            node.className = 'category-catalog-note'; node.setAttribute('role', 'status');
            (byId('home-main') || document.body).prepend(node);
        }
        if (node) { node.textContent = text; node.hidden = !text; }
    }
    function captureMetadata() {
        const selectors = ['link[rel="canonical"]', 'meta[name="description"]', 'meta[name="robots"]',
            'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]'];
        return { title: document.title, values: selectors.map(selector => {
            const node = document.querySelector(selector);
            return [selector, node?.getAttribute(node.tagName === 'LINK' ? 'href' : 'content') ?? null];
        }), structuredData: byId('spotivity-seo-data')?.textContent ?? null };
    }
    function restoreMetadata() {
        if (!sourceMetadata) return;
        document.title = sourceMetadata.title;
        for (const [selector, value] of sourceMetadata.values) {
            const node = document.querySelector(selector);
            if (node && value !== null) node.setAttribute(node.tagName === 'LINK' ? 'href' : 'content', value);
        }
        const structured = byId('spotivity-seo-data');
        if (structured && sourceMetadata.structuredData !== null) structured.textContent = sourceMetadata.structuredData;
    }
    function updateMetadata(kind, row) {
        const id = paths.normalizedId(row?.id), name = String(row?.nume || '').slice(0, 200);
        const city = String(row?.oras || '').trim().replace(/\.+$/, '').slice(0, 120);
        const title = `${name}${city ? ` în ${city}` : ''} – ${kind === 'court' ? 'Rezervări' : 'Bază sportivă'} | Spotivity`;
        const description = kind === 'court'
            ? `Consultă programul și rezervă ${name}${city ? ` în ${city}` : ''} pe Spotivity. Disponibilitatea și tariful se verifică în formular.`
            : `Descoperă ${name}${city ? ` în ${city}` : ''}, vezi terenurile publicate și verifică programul de rezervare pe Spotivity.`;
        const indexed = indexedPath(kind, id), canonical = new URL(indexed || './', canonicalRoot).href;
        document.title = title;
        for (const [selector, value] of [['link[rel="canonical"]', canonical], ['meta[name="description"]', description],
            ['meta[property="og:title"]', title], ['meta[property="og:description"]', description], ['meta[property="og:url"]', canonical],
            ['meta[name="robots"]', indexed ? 'index,follow' : 'noindex,follow']]) {
            const node = document.querySelector(selector);
            if (node) node.setAttribute(node.tagName === 'LINK' ? 'href' : 'content', value);
        }
        const structured = byId('spotivity-seo-data'), seo = window.SpotivitySeoData;
        if (structured && seo) {
            const options = indexed ? {
                baseUrl: canonicalRoot.href, kind, route: indexed, title,
                ...(kind === 'court' ? { court: row, baseRoute: indexedPath('base', paths.normalizedId(row?.baza_sportiva_id)) } : { base: row })
            } : { baseUrl: canonicalRoot.href, kind: 'home' };
            try {
                structured.textContent = seo.serialize(seo.graphFor(options));
            } catch {
                // Incomplete live catalog details must not prevent booking or
                // leave the previous court advertised as the selected place.
                structured.textContent = seo.serialize(seo.graphFor({ baseUrl: canonicalRoot.href, kind: 'home' }));
            }
        }
    }
    function readView() {
        if (visible('modal-rezervare')) return active ? { kind: active.kind, id: active.id } : null;
        if (visible('modal-baze-sportive')) {
            const id = paths.normalizedId(byId('modal-baze-sportive')?.dataset.selectedBaseId);
            return id ? { kind: 'base', id } : { kind: 'base-list' };
        }
        if (visible('modal-terenuri')) return { kind: 'court-list', sport: byId('modal-terenuri')?.dataset.sport || '',
            date: byId('filtru-data')?.value || '', hour: byId('filtru-ora')?.value || 'ALL', name: byId('filtru-nume')?.value || '' };
        if (visible('modal-cautare-terenuri')) return { kind: 'search' };
        return null;
    }
    function freezeRelativeLinks() {
        for (const node of document.querySelectorAll('[href], [src]')) {
            for (const attribute of ['href', 'src']) {
                const value = node.getAttribute(attribute);
                if (value === null || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;
                // Bundled assets assigned at runtime are relative to the app
                // root even when this document began on a detail page.
                const base = /^assets\//.test(value) ? appRoot : documentLinkBase;
                try { node.setAttribute(attribute, new URL(value, base).href); } catch { /* Invalid optional resource remains untouched. */ }
            }
        }
    }
    function writeState(entry, url, replace = false) {
        // Visual/catalog refreshes may have assigned another relative asset
        // since initialization. Freeze those before the document URL changes.
        if (new URL(url, location.href).pathname !== location.pathname) freezeRelativeLinks();
        const original = history.state && typeof history.state === 'object' && !Array.isArray(history.state) ? history.state : {};
        history[replace ? 'replaceState' : 'pushState']({ ...original, [stateKey]: entry }, '', url);
        currentEntry = entry;
    }
    function readLocation() {
        const url = new URL(location.href);
        const court = url.searchParams.get('teren'), base = url.searchParams.get('baza');
        if (court !== null || base !== null) {
            if (court !== null && base !== null) return { kind: 'invalid' };
            const id = paths.normalizedId(court ?? base);
            return id ? { kind: court !== null ? 'court' : 'base', id, direct: true } : { kind: 'invalid' };
        }
        const relative = url.pathname.startsWith(appRoot.pathname) ? url.pathname.slice(appRoot.pathname.length).replace(/index\.html$/, '') : '';
        for (const kind of ['court', 'base']) {
            const entries = window.spotivitySeoRoutes?.[kind === 'court' ? 'courts' : 'bases'] || {};
            for (const id of Object.keys(entries)) if (paths.validId(id) && indexedPath(kind, id) === relative) return { kind, id, direct: true };
        }
        return { kind: null, view: null, direct: true };
    }
    function closeUi() {
        window.closeCourtSearch?.(false);
        window.closeSpotivityPublicCourts?.();
        window.closeSportsBases?.(false);
    }
    async function restoreView(view) {
        if (!view || foreignModal() || isPrivateWorkspace()) return;
        if (view.kind === 'court-list') {
            if (typeof window.openSpotivityCourtList === 'function') await window.openSpotivityCourtList(view.sport, { date: view.date, hour: view.hour, name: view.name });
            else [...document.querySelectorAll('button.card-sport[data-sport]')].find(node => node.dataset.sport === view.sport)?.click();
        } else if (view.kind === 'base-list') await window.openSportsBases?.();
        else if (view.kind === 'search') window.openCourtSearch?.(byId('home-search-input')?.value || '');
    }
    async function applyEntry(entry) {
        const token = ++generation;
        controller?.abort(); controller = new AbortController();
        const signal = controller.signal;
        restoring = true; active = null; startPending();
        freezeRelativeLinks();
        closeUi(); status('');
        try {
            if (entry?.kind === 'invalid') { status('Linkul terenului sau al bazei sportive nu este valid.'); return; }
            if (entry?.kind === 'court' || entry?.kind === 'base') {
                if (entry.closed) {
                    const record = entityRecords.get(`${entry.kind}:${entry.id}`);
                    if (record) updateMetadata(entry.kind, record);
                    else restoreMetadata();
                    return;
                }
                if (foreignModal() || isPrivateWorkspace()) return;
                const opened = entry.kind === 'court'
                    ? await window.openCourtReservation?.(entry.id, { signal })
                    : await window.openSportsBases?.(entry.id);
                if (signal.aborted || token !== generation) return;
                if (!opened) {
                    active = null; closeUi();
                    status(entry.kind === 'court' ? 'Acest teren nu mai este disponibil sau nu a putut fi încărcat.' : 'Această bază sportivă nu mai este disponibilă sau nu a putut fi încărcată.');
                }
            } else {
                restoreMetadata();
                await restoreView(entry?.view);
            }
        } finally {
            if (token === generation) { restoring = false; previousView = readView(); finishPending(); }
        }
    }
    function opened(kind, row) {
        const id = paths.normalizedId(row?.id);
        if (!initialized || !id || protectedIntent()) return;
        entityRecords.set(`${kind}:${id}`, { id, nume: row.nume, oras: row.oras,
            ...(kind === 'court' ? { sport: row.sport, baza_sportiva_id: row.baza_sportiva_id } : { descriere: row.descriere }) });
        if (goingBack) { queuedEntity = { kind, id }; return; }
        const item = { kind, id };
        if (restoring) { active = item; updateMetadata(kind, row); return; }
        status('');
        const url = entityUrl(kind, row);
        if (currentEntry?.kind === kind && currentEntry.id === id && new URL(url).href === location.href) {
            if (currentEntry.closed) writeState({ ...currentEntry, closed: false }, location.href, true);
            active = item; updateMetadata(kind, row); return;
        }
        const view = kind === 'base' && hasBaseOrigin ? baseOrigin : previousView;
        baseOrigin = null; hasBaseOrigin = false;
        writeState({ ...currentEntry, view }, location.href, true);
        writeState({ ...item, direct: false }, url);
        active = item;
        updateMetadata(kind, row);
        previousView = readView();
    }
    function closed(kind, options = {}) {
        if (!active || active.kind !== kind || restoring || goingBack) return;
        active = null;
        controller?.abort(); ++generation;
        if (currentEntry?.kind === kind && !currentEntry.direct) {
            goingBack = true; restoreAfterClose = options?.toList === true;
            startPending(); history.back();
        } else {
            if (currentEntry?.kind === kind) writeState({ ...currentEntry, closed: true }, location.href, true);
            finishPending();
        }
    }
    async function popstate() {
        if (!initialized || protectedIntent()) return;
        const queued = queuedEntity;
        queuedEntity = null; goingBack = false;
        currentEntry = history.state?.[stateKey] || readLocation();
        const entry = !restoreAfterClose && !currentEntry.kind ? { ...currentEntry, view: null } : currentEntry;
        restoreAfterClose = true;
        await applyEntry(entry);
        if (queued) await openUser(queued.kind, queued.id);
    }
    async function openUser(kind, value) {
        const id = paths.normalizedId(value);
        if (!id || protectedIntent() || foreignModal() || isPrivateWorkspace()) return false;
        if (goingBack) await whenSettled();
        const token = ++generation;
        restoring = false;
        controller?.abort(); controller = new AbortController();
        const signal = controller.signal;
        startPending(); status('');
        try {
            const opened = kind === 'court'
                ? await window.openCourtReservation?.(id, { signal })
                : await window.openSportsBases?.(id);
            if (signal.aborted || token !== generation) return false;
            if (!opened) status(kind === 'court' ? 'Acest teren nu mai este disponibil sau nu a putut fi încărcat.' : 'Această bază sportivă nu mai este disponibilă sau nu a putut fi încărcată.');
            return !!opened;
        } finally { if (token === generation) finishPending(); }
    }
    function initialize() {
        if (initialized) return;
        initialized = true;
        // pushState changes document.baseURI. Freeze trusted document-relative
        // resources/links first, so opening a modal cannot break the next link.
        freezeRelativeLinks();
        sourceMetadata = captureMetadata();
        const canonical = document.querySelector('link[rel="canonical"]')?.href || appRoot.href;
        const relative = initialDocumentUrl.pathname.startsWith(appRoot.pathname)
            ? initialDocumentUrl.pathname.slice(appRoot.pathname.length).replace(/index\.html$/, '') : '';
        canonicalRoot = new URL(canonical);
        if (relative && canonicalRoot.pathname.endsWith(relative)) canonicalRoot.pathname = canonicalRoot.pathname.slice(0, -relative.length);
        else if (relative) canonicalRoot = new URL(appRoot);
        canonicalRoot.search = ''; canonicalRoot.hash = '';
        currentEntry = readLocation();
        previousView = readView();
        if (!initialProtectedIntent) writeState(currentEntry, location.href, true);
        const observer = new MutationObserver(() => {
            if (restoring || goingBack) return;
            if (active?.kind === 'court' && !visible('modal-rezervare')) closed('court');
            else if (active?.kind === 'base' && !visible('modal-baze-sportive')) closed('base');
            previousView = readView();
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class', 'data-selected-base-id'], childList: true });
        document.addEventListener('click', event => {
            // A new explicit selection takes precedence over an older route
            // read, even when it was started by Back/Forward and is still pending.
            if ((!restoring && !settle) || goingBack || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const target = event.target.closest?.('[data-discovery-court], [data-base-court], [data-base-id], [data-entity-court-id], [data-entity-base-id], [data-entity-booking], [data-entity-base], .card-teren-poza, .sports-base-card, button.card-sport[data-sport], #btn-top-cont, [data-profile-target]');
            if (!target) return;
            controller?.abort(); ++generation;
            restoring = false; active = null; finishPending();
        }, true);
        document.addEventListener('click', event => {
            const target = event.target.closest?.('[data-entity-court-id], [data-entity-base-id], [data-entity-booking], [data-entity-base]');
            if (!target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const kind = target.hasAttribute('data-entity-court-id') || target.hasAttribute('data-entity-booking') ? 'court' : 'base';
            const id = kind === 'court' ? target.dataset.entityCourtId || target.dataset.entityBooking : target.dataset.entityBaseId || target.dataset.entityBase;
            if (!paths.validId(id)) return;
            event.preventDefault();
            openUser(kind, id).catch(() => status('Pagina nu a putut fi deschisă. Încearcă din nou.'));
        });
        if (ready) start();
    }
    function start() {
        ready = true;
        if (!initialized || initialProtectedIntent || protectedIntent() || window.isSpotivityRecoveryCallback?.() || window.isSpotivityAuthCallback?.()) return;
        setTimeout(() => {
            if (currentEntry?.kind && !foreignModal() && !isPrivateWorkspace()) applyEntry(currentEntry).catch(() => status('Pagina nu a putut fi încărcată. Încearcă din nou.'));
        }, 0);
    }
    window.SpotivityNavigation = Object.freeze({
        courtUrl: row => entityUrl('court', row), baseUrl: row => entityUrl('base', row),
        openCourt: id => openUser('court', id), openBase: id => openUser('base', id),
        openCurrent: () => applyEntry(readLocation()), close: closed,
        whenSettled,
        get pending() { return !!settle || restoring || goingBack; }
    });
    window.addEventListener('spotivity:public-court-opened', event => opened('court', event.detail?.court));
    window.addEventListener('spotivity:public-base-opening', () => { baseOrigin = readView(); hasBaseOrigin = true; });
    window.addEventListener('spotivity:public-base-opened', event => opened('base', event.detail?.base));
    window.addEventListener('spotivity:public-court-closed', event => closed('court', event.detail));
    window.addEventListener('spotivity:public-base-closed', event => closed('base', event.detail));
    window.addEventListener('spotivity:public-ready', start);
    window.addEventListener('popstate', () => { popstate().catch(() => status('Pagina nu a putut fi încărcată. Încearcă din nou.')); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
