/* Public discovery shares the existing, RLS-checked reservation form. */
(() => {
    'use strict';
    const labels = {
        ro: { home_search: 'Caută un teren', home_search_hint: 'Caută după nume, sport sau oraș, în toate orașele.', home_search_placeholder: 'Nume, sport sau oraș', loading: 'Se încarcă…', error: 'Terenurile nu au putut fi încărcate.', basesError: 'Bazele sportive nu au putut fi încărcate.', retry: 'Încearcă din nou', empty: 'Nu sunt terenuri disponibile în acest oraș.', noResults: 'Nu am găsit terenuri. Încearcă alt nume, sport sau oraș.', noBases: 'Nu sunt baze sportive disponibile în acest oraș.', hour: 'Lei/oră', results: 'terenuri găsite', reserve: 'Rezervă', booking: 'Se deschide terenul…', bookingError: 'Terenul nu mai este disponibil sau nu a putut fi deschis. Încearcă din nou.', close: 'Închide', courts: 'terenuri' },
        hu: { home_search: 'Pálya keresése', home_search_hint: 'Keress név, sport vagy város alapján, minden városban.', home_search_placeholder: 'Név, sport vagy város', loading: 'Betöltés…', error: 'A pályákat nem sikerült betölteni.', basesError: 'A sportközpontokat nem sikerült betölteni.', retry: 'Újrapróbálkozás', empty: 'Ebben a városban nincsenek elérhető pályák.', noResults: 'Nincs találat. Próbálj más nevet, sportot vagy várost.', noBases: 'Ebben a városban nincsenek elérhető sportközpontok.', hour: 'Lej/óra', results: 'talált pálya', reserve: 'Foglalás', booking: 'Pálya megnyitása…', bookingError: 'A pálya nem érhető el. Próbáld újra.', close: 'Bezárás', courts: 'pálya' },
        en: { home_search: 'Find a court', home_search_hint: 'Search by name, sport or city, across all cities.', home_search_placeholder: 'Name, sport or city', loading: 'Loading…', error: 'Courts could not be loaded.', basesError: 'Sports centres could not be loaded.', retry: 'Try again', empty: 'No courts are available in this city.', noResults: 'No courts found. Try another name, sport or city.', noBases: 'No sports centres are available in this city.', hour: 'RON/hour', results: 'courts found', reserve: 'Book', booking: 'Opening court…', bookingError: 'The court is unavailable or could not be opened. Please try again.', close: 'Close', courts: 'courts' }
    };
    for (const [language, copy] of Object.entries(labels)) {
        if (window.dict?.[language]) {
            for (const key of ['home_search', 'home_search_hint', 'home_search_placeholder']) window.dict[language][key] = copy[key];
        }
    }
    const t = key => (labels[window.lang] || labels.ro)[key];
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
    const cityName = value => String(value || '').trim().replace(/\.+$/, '');
    const node = (tag, className, text) => {
        const result = document.createElement(tag);
        if (className) result.className = className;
        if (text !== undefined) result.textContent = text;
        return result;
    };
    const action = (text, handler, className = 'sports-bases-action') => {
        const result = node('button', className, text);
        result.type = 'button';
        result.addEventListener('click', handler);
        return result;
    };

    function init() {
        const modal = document.getElementById('modal-cautare-terenuri');
        const input = document.getElementById('home-search-input');
        const results = document.getElementById('home-search-results');
        const status = document.getElementById('home-search-status');
        const directory = document.getElementById('home-bases-directory');
        const strips = [...document.querySelectorAll('[data-home-courts]')];
        if (!modal || !input || !results || !directory) return;
        let courts = [], bases = [];
        let courtsState = 'loading', basesState = 'loading';
        let loadGeneration = 0, bookingGeneration = 0;
        let bookingController = null, loadingController = null;
        let bookingBusy = false, previousFocus = null;
        const isOpen = () => modal.style.display === 'flex';
        const translatedSport = court => window.dict?.[window.lang]?.[String(court.sport).toLowerCase()] || court.sport;
        const selectedCity = () => document.getElementById('filtru-oras-global')?.value || 'ALL';
        const matchesCity = court => selectedCity() === 'ALL' || cityName(court.oras) === selectedCity();

        function message(container, text, retry = false) {
            container.replaceChildren(node('p', 'home-discovery-message', text));
            if (retry) container.append(action(t('retry'), load));
        }
        function cancelBooking() {
            bookingGeneration++;
            bookingController?.abort();
            bookingController = null;
            bookingBusy = false;
            document.querySelectorAll('[data-discovery-court]').forEach(button => { button.disabled = false; });
        }
        function close(restoreFocus = true) {
            cancelBooking();
            modal.style.display = 'none';
            if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        }
        async function reserve(court, feedback) {
            if (bookingBusy) return;
            bookingBusy = true;
            const token = ++bookingGeneration;
            bookingController = new AbortController();
            const controller = bookingController;
            const timeout = setTimeout(() => controller.abort(), 15000);
            document.querySelectorAll('[data-discovery-court]').forEach(button => { button.disabled = true; });
            feedback.textContent = t('booking');
            try {
                const opened = await window.openCourtReservation?.(court.id, { signal: controller.signal });
                if (token !== bookingGeneration) return;
                if (opened) {
                    feedback.textContent = '';
                    if (isOpen()) close(false);
                } else feedback.textContent = t('bookingError');
            } catch {
                if (token === bookingGeneration) feedback.textContent = t('bookingError');
            } finally {
                clearTimeout(timeout);
                if (token === bookingGeneration) cancelBooking();
            }
        }
        function courtCard(court, feedback) {
            const card = action('', () => reserve(court, feedback), 'home-court-card');
            card.dataset.discoveryCourt = String(court.id);
            card.disabled = bookingBusy;
            card.setAttribute('aria-label', `${t('reserve')} ${court.nume}, ${translatedSport(court)}, ${cityName(court.oras)}`);
            const image = node('img', 'home-court-photo');
            image.src = window.safeUrl?.(court.poza, true) || 'assets/imagini/avatar2.png';
            image.alt = '';
            image.width = 240; image.height = 160; image.loading = 'lazy';
            image.addEventListener('error', () => { image.remove(); }, { once: true });
            const details = node('span', 'home-court-details');
            details.append(node('strong', '', court.nume), node('span', 'home-court-meta', `${translatedSport(court)} · ${cityName(court.oras)}`));
            if (court.pret !== null && court.pret !== undefined && Number.isFinite(Number(court.pret))) {
                details.append(node('span', 'home-court-price', `${new Intl.NumberFormat(window.lang === 'hu' ? 'hu-HU' : window.lang === 'en' ? 'en-GB' : 'ro-RO').format(Number(court.pret))} ${t('hour')}`));
            }
            card.append(image, details);
            return card;
        }
        function renderCourts() {
            for (const strip of strips) {
                strip.setAttribute('aria-busy', String(courtsState === 'loading'));
                strip.setAttribute('aria-label', `${window.dict?.[window.lang]?.[strip.dataset.homeCourts.toLowerCase()] || strip.dataset.homeCourts} — ${selectedCity()}`);
                if (courtsState !== 'ready') {
                    message(strip, t(courtsState === 'loading' ? 'loading' : 'error'), courtsState === 'error');
                    continue;
                }
                const visible = courts.filter(court => matchesCity(court) && (court.sport === strip.dataset.homeCourts || strip.dataset.homeCourts === 'Fotbal' && court.sport === 'Tenis Picior'));
                strip.replaceChildren();
                const feedback = strip.parentElement.querySelector('.home-courts-status') || node('p', 'home-courts-status');
                feedback.setAttribute('role', 'status');
                strip.after(feedback);
                if (!visible.length) message(strip, t('empty'));
                else visible.forEach(court => strip.append(courtCard(court, feedback)));
            }
        }
        function renderBases() {
            directory.setAttribute('aria-busy', String(basesState === 'loading' || courtsState === 'loading'));
            if (basesState === 'loading' || courtsState === 'loading') return message(directory, t('loading'));
            if (basesState === 'error' || courtsState === 'error') return message(directory, t('basesError'), true);
            const visible = bases.filter(base => matchesCity(base) && courts.some(court => court.baza_sportiva_id === base.id));
            directory.replaceChildren();
            if (!visible.length) return message(directory, t('noBases'));
            for (const base of visible) {
                const card = action('', () => window.openSportsBases?.(base.id), 'sports-base-card');
                card.dataset.homeBaseId = base.id;
                card.append(node('span', 'sports-base-city', cityName(base.oras)), node('strong', 'sports-base-name', base.nume));
                if (base.descriere?.trim()) card.append(node('span', 'home-base-summary', base.descriere));
                card.append(node('span', 'sports-base-count', `${courts.filter(court => court.baza_sportiva_id === base.id).length} ${t('courts')}`));
                directory.append(card);
            }
        }
        function renderSearch() {
            results.setAttribute('aria-busy', String(courtsState === 'loading'));
            status.textContent = '';
            if (courtsState !== 'ready') return message(results, t(courtsState === 'loading' ? 'loading' : 'error'), courtsState === 'error');
            const words = normalize(input.value).split(/\s+/).filter(Boolean);
            // Deliberately ignore the homepage city/sport filters here.
            const visible = courts.filter(court => {
                const text = normalize([court.nume, court.sport, translatedSport(court), cityName(court.oras)].join(' '));
                return words.every(word => text.includes(word));
            });
            results.replaceChildren();
            status.textContent = `${visible.length} ${t('results')}`;
            if (!visible.length) return message(results, t('noResults'));
            visible.forEach(court => results.append(courtCard(court, status)));
        }
        function render() {
            renderCourts(); renderBases();
            if (isOpen()) renderSearch();
            input.placeholder = t('home_search_placeholder');
            document.getElementById('inchide-cautare-terenuri').setAttribute('aria-label', t('close'));
        }
        async function readPublicRows(table, fields, activeColumn, signal) {
            const rows = [];
            const pageSize = 500;
            for (let offset = 0; ; offset += pageSize) {
                const result = await db.from(table).select(fields).eq(activeColumn, true)
                    .order('nume').order('id').range(offset, offset + pageSize - 1).abortSignal(signal);
                if (result.error || !Array.isArray(result.data)) return result;
                rows.push(...result.data);
                if (result.data.length < pageSize) return { data: rows, error: null };
            }
        }
        async function load() {
            const token = ++loadGeneration;
            loadingController?.abort();
            loadingController = new AbortController();
            const controller = loadingController;
            const timeout = setTimeout(() => controller.abort(), 15000);
            courtsState = basesState = 'loading';
            render();
            try {
                const reads = await Promise.allSettled([
                    readPublicRows('terenuri', 'id,nume,sport,oras,pret,poza,baza_sportiva_id,este_activ', 'este_activ', controller.signal),
                    readPublicRows('baze_sportive', 'id,nume,oras,descriere,este_activa', 'este_activa', controller.signal)
                ]);
                if (token !== loadGeneration) return;
                for (const [index, read] of reads.entries()) {
                    const value = read.status === 'fulfilled' ? read.value : null;
                    const ok = value && !value.error && Array.isArray(value.data);
                    if (index === 0) { courtsState = ok ? 'ready' : 'error'; courts = ok ? value.data.filter(court => court.este_activ === true) : []; }
                    else { basesState = ok ? 'ready' : 'error'; bases = ok ? value.data.filter(base => base.este_activa === true) : []; }
                }
            } catch {
                if (token === loadGeneration) courtsState = basesState = 'error';
            } finally {
                clearTimeout(timeout);
                if (token === loadGeneration) render();
            }
        }
        window.openCourtSearch = () => {
            previousFocus = document.activeElement;
            cancelBooking();
            input.value = '';
            modal.style.display = 'flex';
            renderSearch();
            input.focus({ preventScroll: true });
        };
        input.addEventListener('input', () => { cancelBooking(); renderSearch(); });
        document.getElementById('inchide-cautare-terenuri').addEventListener('click', () => close());
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key !== 'Tab') return;
            const items = [...modal.querySelectorAll('input,button:not([disabled])')].filter(item => item.getClientRects().length);
            if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        });
        document.getElementById('filtru-oras-global')?.addEventListener('change', () => { cancelBooking(); render(); });
        window.addEventListener('spotivity:language', render);
        window.addEventListener('spotivity:booking-ready', () => { cancelBooking(); render(); });
        window.spotivityDiscoveryReady = load();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
