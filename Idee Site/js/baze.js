/* Public sports bases use the same Supabase client and booking flow as the site. */
(() => {
    'use strict';
    const copy = {
        ro: {
            baze_vezi: 'Vezi bazele sportive', baze_titlu: 'Baze sportive', baze_toate: 'Toate bazele',
            loading: 'Se încarcă bazele sportive…', error: 'Bazele sportive nu au putut fi încărcate.',
            retry: 'Încearcă din nou', empty: 'Momentan nu sunt baze sportive disponibile.',
            emptyCity: 'Momentan nu sunt baze sportive disponibile în acest oraș.',
            missing: 'Această bază sportivă nu este disponibilă.', courts: 'Terenuri disponibile',
            count: 'terenuri', single: 'teren', descriptionEmpty: 'Descrierea bazei va fi disponibilă în curând.',
            share: 'Distribuie', copied: 'Link copiat.', copyLink: 'Copiază acest link pentru a distribui baza sportivă:',
            reserve: 'Rezervă', perHour: 'Lei/oră', bookingError: 'Terenul nu a putut fi deschis. Încearcă din nou.',
            bookingLoading: 'Se deschide terenul…', close: 'Închide'
        },
        hu: {
            baze_vezi: 'Sportközpontok megtekintése', baze_titlu: 'Sportközpontok', baze_toate: 'Összes központ',
            loading: 'Sportközpontok betöltése…', error: 'A sportközpontokat nem sikerült betölteni.',
            retry: 'Újrapróbálkozás', empty: 'Jelenleg nincsenek elérhető sportközpontok.',
            emptyCity: 'Ebben a városban jelenleg nincsenek elérhető sportközpontok.',
            missing: 'Ez a sportközpont jelenleg nem elérhető.', courts: 'Elérhető pályák',
            count: 'pálya', single: 'pálya', descriptionEmpty: 'A sportközpont leírása hamarosan elérhető lesz.',
            share: 'Megosztás', copied: 'A link másolva.', copyLink: 'Másold ezt a linket a sportközpont megosztásához:',
            reserve: 'Foglalás', perHour: 'Lej/óra', bookingError: 'A pályát nem sikerült megnyitni. Próbáld újra.',
            bookingLoading: 'A pálya megnyitása…', close: 'Bezárás'
        },
        en: {
            baze_vezi: 'Explore sports centres', baze_titlu: 'Sports centres', baze_toate: 'All centres',
            loading: 'Loading sports centres…', error: 'Sports centres could not be loaded.',
            retry: 'Try again', empty: 'No sports centres are available yet.',
            emptyCity: 'No sports centres are currently available in this city.',
            missing: 'This sports centre is not available.', courts: 'Available courts',
            count: 'courts', single: 'court', descriptionEmpty: 'A description of this sports centre will be available soon.',
            share: 'Share', copied: 'Link copied.', copyLink: 'Copy this link to share the sports centre:',
            reserve: 'Book', perHour: 'RON/hour', bookingError: 'The court could not be opened. Please try again.',
            bookingLoading: 'Opening court…', close: 'Close'
        }
    };
    for (const [lang, labels] of Object.entries(copy)) {
        if (window.dict?.[lang]) {
            for (const key of ['baze_vezi', 'baze_titlu', 'baze_toate']) window.dict[lang][key] = labels[key];
        }
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const t = key => (copy[window.lang] || copy.ro)[key];
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function button(className, text, handler) {
        const node = element('button', className, text);
        node.type = 'button';
        node.addEventListener('click', handler);
        return node;
    }

    function init() {
        const modal = document.getElementById('modal-baze-sportive');
        const panel = modal?.querySelector('.sports-bases-panel');
        const content = document.getElementById('baze-sportive-continut');
        const title = document.getElementById('baze-sportive-titlu');
        const back = document.getElementById('baze-sportive-inapoi');
        const close = document.getElementById('inchide-baze-sportive');
        const shell = document.getElementById('home-shell') || document.querySelector('.home-shell');
        if (!modal || !panel || !content || !title || !back || !close) return;
        let generation = 0;
        let controller = null;
        let previousFocus = null;
        let selectedId = null;
        let bases = [];
        let courts = [];
        let state = 'loading';
        let currentLanguage = window.lang;
        let pendingDeepLink = new URL(window.location.href).searchParams.get('baza');
        let bookingBusy = false;
        const isOpen = () => modal.style.display === 'flex';
        const otherModalOpen = () => [...document.querySelectorAll('.modal')].some(node =>
            node !== modal && ['flex', 'block'].includes(node.style.display));
        const isCurrent = token => token === generation && isOpen();
        const baseCourts = baseId => courts.filter(court => String(court.baza_sportiva_id) === baseId);

        function updateChrome() {
            close.setAttribute('aria-label', t('close'));
            back.querySelector('span').textContent = t('baze_toate');
            back.hidden = selectedId === null;
            title.removeAttribute('data-i18n');
            title.textContent = bases.find(base => base.id === selectedId)?.nume || t('baze_titlu');
        }
        function showMessage(key, retry = false) {
            content.replaceChildren(element('p', 'sports-bases-message', t(key)));
            if (retry) content.append(button('sports-bases-action', t('retry'), () => open(selectedId)));
        }
        function statusMessage(text) {
            const status = document.getElementById('baze-sportive-status');
            if (status) status.textContent = text;
        }
        function shareUrl(baseId) {
            // Deliberately discard every other query parameter and the hash,
            // including Auth recovery codes/tokens and unrelated tracking data.
            const url = new URL(window.location.pathname, window.location.origin);
            url.searchParams.set('baza', baseId);
            return url.href;
        }
        async function share(base) {
            const token = generation;
            const url = shareUrl(base.id);
            statusMessage('');
            document.getElementById('baze-sportive-copy-fallback')?.remove();
            if (typeof navigator.share === 'function') {
                try {
                    await navigator.share({ title: base.nume, url });
                    return;
                } catch (error) {
                    if (error?.name === 'AbortError' || !isCurrent(token)) return;
                }
            }
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(url);
                if (isCurrent(token)) statusMessage(t('copied'));
            } catch {
                if (!isCurrent(token)) return;
                const fallback = element('div', 'sports-bases-copy-fallback');
                fallback.id = 'baze-sportive-copy-fallback';
                const label = element('label', '', t('copyLink'));
                label.htmlFor = 'baze-sportive-link';
                const input = element('input');
                input.id = 'baze-sportive-link';
                input.type = 'text';
                input.readOnly = true;
                input.value = url;
                input.addEventListener('focus', () => input.select());
                fallback.append(label, input);
                document.getElementById('baze-sportive-status')?.after(fallback);
                input.focus({ preventScroll: true });
                input.select();
            }
        }
        async function reserve(court) {
            if (bookingBusy) return;
            const token = generation;
            bookingBusy = true;
            content.querySelectorAll('[data-base-court]').forEach(node => { node.disabled = true; });
            statusMessage(t('bookingLoading'));
            try {
                if (typeof window.openCourtReservation !== 'function') throw new Error('Booking is still loading');
                const opened = await window.openCourtReservation(court.id, { signal: controller?.signal });
                if (!isCurrent(token)) return;
                if (opened) hide(false);
                else statusMessage(t('bookingError'));
            } catch {
                if (isCurrent(token)) statusMessage(t('bookingError'));
            } finally {
                if (token === generation) {
                    bookingBusy = false;
                    content.querySelectorAll('[data-base-court]').forEach(node => { node.disabled = false; });
                }
            }
        }
        function renderCourt(court) {
            const card = element('article', 'sports-base-court');
            const src = window.safeUrl?.(court.poza, true);
            if (src) {
                const image = element('img', 'sports-base-court-photo');
                image.src = src;
                image.alt = '';
                image.width = 450;
                image.height = 300;
                image.loading = 'lazy';
                image.addEventListener('error', () => image.remove(), { once: true });
                card.append(image);
            }
            const sportKey = window.normalizeSportName(court.sport).toLowerCase();
            const sport = window.dict?.[window.lang]?.[sportKey] || court.sport;
            card.append(element('p', 'sports-base-court-sport', sport), element('h4', '', court.nume));
            if (court.pret !== null && court.pret !== undefined && Number.isFinite(Number(court.pret))) {
                const price = new Intl.NumberFormat(window.lang === 'hu' ? 'hu-HU' : window.lang === 'en' ? 'en-GB' : 'ro-RO').format(Number(court.pret));
                card.append(element('p', 'sports-base-court-price', `${price} ${t('perHour')}`));
            }
            const reserveButton = button('sports-bases-action', t('reserve'), () => reserve(court));
            reserveButton.dataset.baseCourt = String(court.id);
            reserveButton.setAttribute('aria-label', `${t('reserve')} ${court.nume}`);
            reserveButton.disabled = bookingBusy;
            card.append(reserveButton);
            return card;
        }
        function render() {
            updateChrome();
            content.setAttribute('aria-busy', String(state === 'loading'));
            if (state === 'loading') return showMessage('loading');
            if (state === 'error') return showMessage('error', true);
            if (selectedId !== null) {
                const base = bases.find(item => item.id === selectedId);
                if (!base) return showMessage('missing');
                const city = element('p', 'sports-base-city', base.oras);
                const description = element('p', 'sports-base-description', base.descriere?.trim() ? base.descriere : t('descriptionEmpty'));
                description.id = 'baze-sportive-descriere';
                const shareButton = button('sports-bases-action sports-bases-share', t('share'), () => share(base));
                shareButton.id = 'baze-sportive-share';
                const status = element('p', 'sports-bases-status');
                status.id = 'baze-sportive-status';
                status.setAttribute('role', 'status');
                const heading = element('h3', 'sports-bases-section-title', t('courts'));
                const grid = element('div', 'sports-base-courts');
                baseCourts(base.id).forEach(court => grid.append(renderCourt(court)));
                const photo = window.createSportsBasePhoto?.(base, 'sports-base-photo sports-base-photo-detail');
                const identity = element('div', 'sports-base-identity');
                identity.classList.toggle('has-base-cover', !!photo);
                const avatar = window.createSportsBaseAvatar?.(base, 'sports-base-avatar-detail');
                if (avatar) identity.append(avatar);
                const name = element('div', 'sports-base-identity-copy');
                name.append(element('h3', 'sports-base-profile-name', base.nume), city);
                identity.append(name);
                content.replaceChildren(...(photo ? [photo] : []), identity, description, shareButton, status, heading, grid);
                return;
            }
            const selectedCity = document.getElementById('filtru-oras-global')?.value || 'ALL';
            const visible = bases.filter(base => selectedCity === 'ALL' || String(base.oras || '').trim().replace(/\.+$/, '') === selectedCity);
            if (!visible.length) return showMessage(selectedCity === 'ALL' ? 'empty' : 'emptyCity');
            const grid = element('div', 'sports-bases-grid');
            visible.forEach(base => {
                const card = button('sports-base-card', '', () => open(base.id));
                card.dataset.baseId = base.id;
                const photo = window.createSportsBasePhoto?.(base, 'sports-base-photo');
                card.classList.toggle('has-base-cover', !!photo);
                photo?.addEventListener('error', () => card.classList.remove('has-base-cover'), { once: true });
                const media = element('span', 'sports-base-card-media');
                if (photo) media.append(photo);
                const avatar = window.createSportsBaseAvatar?.(base);
                if (avatar) media.append(avatar);
                const content = element('span', 'sports-base-card-content');
                const heading = element('span', 'sports-base-card-heading');
                const count = baseCourts(base.id).length;
                heading.append(element('span', 'sports-base-name', base.nume),
                    element('span', 'sports-base-count', `${count} ${t(count === 1 ? 'single' : 'count')}`));
                content.append(element('span', 'sports-base-city', base.oras), heading);
                card.append(media, content);
                grid.append(card);
            });
            content.replaceChildren(grid);
        }
        function hide(restoreFocus = true) {
            generation++;
            controller?.abort();
            controller = null;
            bookingBusy = false;
            modal.style.display = 'none';
            if (shell) shell.inert = false;
            if (!otherModalOpen()) document.body.classList.remove('fara-scroll');
            if (restoreFocus && !otherModalOpen()) {
                const target = previousFocus?.isConnected && previousFocus.getClientRects().length
                    ? previousFocus : document.getElementById('btn-home-baze');
                target?.focus({ preventScroll: true });
            }
        }
        async function open(baseId = null) {
            pendingDeepLink = null;
            if (otherModalOpen()) return false;
            const token = ++generation;
            controller?.abort();
            controller = new AbortController();
            const requestController = controller;
            selectedId = baseId === null || baseId === undefined ? null : String(baseId).toLowerCase();
            bookingBusy = false;
            if (!isOpen()) previousFocus = document.activeElement;
            modal.style.display = 'flex';
            document.body.classList.add('fara-scroll');
            if (shell) shell.inert = true;
            panel.scrollTop = 0;
            state = 'loading';
            bases = [];
            courts = [];
            render();
            close.focus({ preventScroll: true });
            if (selectedId !== null && !uuid.test(selectedId)) {
                state = 'ready';
                render();
                return false;
            }
            const timeout = window.setTimeout(() => requestController.abort(), 15000);
            try {
                const [baseResult, courtResult] = await Promise.all([
                    window.readSportsBasePresentation(fields => db.from('baze_sportive').select(fields).eq('este_activa', true)
                        .order('nume').abortSignal(requestController.signal)),
                    db.from('terenuri').select('id,nume,sport,oras,pret,poza,baza_sportiva_id,este_activ').eq('este_activ', true)
                        .order('nume').abortSignal(requestController.signal)
                ]);
                if (!isCurrent(token)) return false;
                if (baseResult.error || courtResult.error || !Array.isArray(baseResult.data) || !Array.isArray(courtResult.data)) {
                    throw new Error('Sports bases could not be read');
                }
                courts = courtResult.data.filter(court => court.este_activ === true && court.baza_sportiva_id);
                bases = baseResult.data.filter(base => base.este_activa === true && baseCourts(base.id).length > 0);
                state = 'ready';
                render();
                return selectedId === null || bases.some(base => base.id === selectedId);
            } catch {
                if (isCurrent(token)) { state = 'error'; render(); }
                return false;
            } finally {
                window.clearTimeout(timeout);
            }
        }
        window.openSportsBases = open;
        window.closeSportsBases = hide;
        window.addEventListener('spotivity:base-updated', event => {
            if (!event.detail?.id) return;
            bases = bases.map(base => base.id === event.detail.id ? { ...base, ...event.detail } : base);
            if (isOpen()) render();
        });
        close.addEventListener('click', () => hide());
        back.addEventListener('click', () => open());
        modal.addEventListener('click', event => { if (event.target === modal) hide(); });
        document.addEventListener('keydown', event => {
            if (!isOpen()) return;
            if (event.key === 'Escape') { event.preventDefault(); hide(); return; }
            if (event.key !== 'Tab') return;
            const items = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')]
                .filter(node => !node.hidden && node.getClientRects().length);
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        document.getElementById('filtru-oras-global')?.addEventListener('change', () => {
            if (isOpen() && selectedId === null) render();
        });
        const languageControls = document.getElementById('selector-limba');
        if (languageControls) new MutationObserver(() => {
            if (window.lang === currentLanguage) return;
            currentLanguage = window.lang;
            if (isOpen()) render();
        }).observe(languageControls, { subtree: true, attributes: true, attributeFilter: ['style'] });

        function openPendingLink() {
            if (pendingDeepLink === null || typeof window.openCourtReservation !== 'function' || otherModalOpen()) return;
            const id = pendingDeepLink;
            pendingDeepLink = null;
            open(id);
        }
        if (pendingDeepLink !== null) {
            // Let the normal Auth restore/recovery UI finish first. A shared base
            // must never cover the password-reset dialog or interrupt sign-in.
            window.addEventListener('spotivity:booking-ready', openPendingLink, { once: true });
            const authObserver = new MutationObserver(() => {
                if (pendingDeepLink === null) { authObserver.disconnect(); return; }
                openPendingLink();
            });
            document.querySelectorAll('.modal').forEach(node => authObserver.observe(node, { attributes: true, attributeFilter: ['style'] }));
            openPendingLink();
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
