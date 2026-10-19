// Court catalog loading, city filters, availability search and court entry point.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicCourts = function(context) {
        const { db, state, services } = context;
        let filterRequest = 0, baseCourtRequest = 0;
        async function incarcaTerenuri() {
            const { data, error } = await db.from('terenuri').select('*');
            if (error || !data) return false;
            state.courts = data;
            return true;
        }
        function populeazaFiltruOrase() {
            const selectOras = document.getElementById('filtru-oras-global');
            if (!selectOras) return;

            const oraseUnice = [...new Set(state.courts.map(t => t.oras ? t.oras.trim().replace(/\.+$/, '') : '').filter(o => o !== ''))];
            oraseUnice.sort((a, b) => a.localeCompare(b));

            let html = `<option value="ALL">${window.lang === 'hu' ? 'Minden város' : (window.lang === 'en' ? 'All Cities' : 'Toate Orașele')}</option>`;
            oraseUnice.forEach(oras => {
                html += `<option value="${window.escapeHtml(oras)}">${window.escapeHtml(oras)}</option>`;
            });

            selectOras.innerHTML = html;
        }
        let searchTimer;
        const normalizaNume = value => String(value ?? '').normalize('NFD')
            .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('ro-RO').trim();
        async function aplicaFiltruSiDeseneazaTerenuri() {
            const request = ++filterRequest;
            const searchText = normalizaNume(document.getElementById('filtru-nume')?.value);
            const dataSelectataDinFiltru = document.getElementById('filtru-data').value;
            const filtruOra = document.getElementById('filtru-ora');
            const containerDinamicTerenuri = document.getElementById('container-dinamic-terenuri');
            containerDinamicTerenuri.innerHTML = `<p style="color:white; width:100%; text-align:center;">${window.dict[window.lang]['se_cauta']}</p>`;
            const loaded = await incarcaTerenuri();
            if (request !== filterRequest) return;
            if (!loaded) { containerDinamicTerenuri.textContent = services.ui.availabilityText(true); return; }

            const orasSelectat = document.getElementById('filtru-oras-global')?.value || 'ALL';
            const terenuriPentruAcestSport = state.courts.filter(t =>
                window.normalizeSportName(t.sport) === state.sport &&
                t.este_activ !== false && (orasSelectat === 'ALL' || (t.oras && t.oras.trim().replace(/\.+$/, '') === orasSelectat)));
            const selectedHour = filtruOra.value;
            const availableHours = window.bookingHourOptions.filter(hour =>
                terenuriPentruAcestSport.some(court => window.getCourtBookingHours(court).includes(hour)));
            filtruOra.innerHTML = `<option value="ALL" data-i18n="toate_orele">${window.dict[window.lang]['toate_orele']}</option>` +
                availableHours.map(hour => `<option value="${hour}">${hour}</option>`).join('');
            filtruOra.value = availableHours.includes(selectedHour) ? selectedHour : 'ALL';
            const oraAleasa = filtruOra.value;
            let terenuriDisponibile = terenuriPentruAcestSport.filter(court => {
                const hours = window.getCourtBookingHours(court);
                return hours.length > 0 && (oraAleasa === 'ALL' || hours.includes(oraAleasa));
            });
            if (oraAleasa !== 'ALL') {
                const {data: rezervari, error} = await db.from('rezervari_disponibilitate').select('teren,ora')
                    .eq('data_str', dataSelectataDinFiltru).eq('ora', oraAleasa);
                if (request !== filterRequest) return;
                if (error || !rezervari) { containerDinamicTerenuri.textContent = services.ui.availabilityText(true); return; }
                terenuriDisponibile = terenuriDisponibile.filter(court => !rezervari.some(rez => rez.teren === court.nume));
            }
            terenuriDisponibile = terenuriDisponibile.filter(court => normalizaNume(court.nume).includes(searchText));
            containerDinamicTerenuri.innerHTML = '';
            if (terenuriDisponibile.length === 0 && searchText) {
                containerDinamicTerenuri.textContent = window.dict[window.lang]['niciun_teren_cautare'];
                return;
            }
            if (terenuriDisponibile.length === 0) {
                containerDinamicTerenuri.textContent = '0' + (oraAleasa === 'ALL' ? '' : ` / ${oraAleasa}`);
                return;
            }

            terenuriDisponibile.forEach(teren => {
                const divTeren = document.createElement('div');
                divTeren.className = 'card-teren-poza btn-teren';
                const fallbackPhoto = 'assets/imagini/avatar2.png';
                divTeren.innerHTML = `<img src="${window.escapeHtml(window.safeUrl(teren.poza, true) || fallbackPhoto)}" alt="${window.escapeHtml(teren.nume)}"><div class="info-teren-poza"><h3>${window.escapeHtml(teren.nume)}</h3><p>${window.escapeHtml(teren.pret)} ${window.dict[window.lang]['lei_ora']}</p></div>`;
                divTeren.querySelector('img').addEventListener('error', function () {
                    if (this.getAttribute('src') !== fallbackPhoto) this.src = fallbackPhoto;
                });
                divTeren.addEventListener('click', () => services.bookings.openCourt(teren));
                containerDinamicTerenuri.appendChild(divTeren);
            });
        }
        // Base details use the same booking form and recheck the selected court via RLS.
        async function openCourtReservation(courtId, { signal } = {}) {
            const id = String(courtId ?? '');
            if (!/^(?:[1-9]\d{0,18}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(id) || signal?.aborted) return false;
            const request = ++baseCourtRequest;
            const generation = state.authGeneration;
            const bookingGeneration = services.bookings.generation();
            try {
                let query = db.from('terenuri').select('*').eq('id', id);
                if (signal) query = query.abortSignal(signal);
                const {data: court, error} = await query.maybeSingle();
                if (signal?.aborted || request !== baseCourtRequest || generation !== state.authGeneration ||
                    bookingGeneration !== services.bookings.generation() || error || !court || court.este_activ === false) return false;
                state.sport = window.normalizeSportName(court.sport);
                const translatedSport = window.dict[window.lang][state.sport.toLowerCase()] || state.sport;
                document.getElementById('titlu-sport').textContent = `${window.dict[window.lang]['alege_terenul']} - ${translatedSport}`;
                document.getElementById('filtru-data').value = window.siteDate();
                document.getElementById('filtru-ora').value = 'ALL';
                document.getElementById('filtru-nume').value = '';
                clearTimeout(searchTimer);
                services.ui.updateFilterDate();
                const background = document.getElementById('fundal-imagine-sport');
                services.ui.setSportBackground(background, state.sport);
                if (background) background.style.opacity = '1';
                services.ui.setSportBackground(document.querySelector('#modal-terenuri .modal-continut'), state.sport, true);
                services.bookings.openCourt(court);
                // Prepare the existing back-to-courts view using the current filters.
                void aplicaFiltruSiDeseneazaTerenuri();
                return true;
            } catch (_) {
                return false;
            }
        };

        function mount() {
            // --- LOGICA TERENURI ---
            document.querySelectorAll('.card-sport[data-sport]').forEach(card => {
                card.addEventListener('click', async () => {
                    state.sport = window.normalizeSportName(card.getAttribute('data-sport'));
                    const numeSportTradus = window.dict[window.lang][state.sport.toLowerCase()] || state.sport;

                    document.getElementById('titlu-sport').innerText = `${window.dict[window.lang]['alege_terenul']} - ${numeSportTradus}`;
                    document.getElementById('modal-terenuri').style.display = 'flex';

                    // Schimba fundalul cu imaginea sportului
                    const bgDiv = document.getElementById('fundal-imagine-sport');
                    if(bgDiv && state.sport) {

                        // Punem background-ul pe ecranul principal (in spatele modalului)
                        services.ui.setSportBackground(bgDiv, state.sport);
                        bgDiv.style.opacity = '1';

                        // Punem background-ul STRICT IN FEREASTRA (modal-continut)
                        const modalContinut = document.querySelector('#modal-terenuri .modal-continut');
                        if (modalContinut) {
                            services.ui.setSportBackground(modalContinut, state.sport, true);
                        }
                    }

                    const aziFormatStandard = window.siteDate();
                    const filtruData = document.getElementById('filtru-data');
                    if(filtruData) filtruData.value = aziFormatStandard;
                    services.ui.updateFilterDate();
                    const filtruOra = document.getElementById('filtru-ora');
                    if(filtruOra) filtruOra.value = 'ALL';
                    const filtruNume = document.getElementById('filtru-nume');
                    if (filtruNume) filtruNume.value = '';
                    clearTimeout(searchTimer);

                    await aplicaFiltruSiDeseneazaTerenuri();
                });
            });
            document.getElementById('filtru-nume')?.addEventListener('input', () => {
                clearTimeout(searchTimer);
                // Invalidate an earlier fetch as soon as the search changes.
                filterRequest++;
                searchTimer = setTimeout(aplicaFiltruSiDeseneazaTerenuri,150);
            });
            document.getElementById('filtru-nume')?.addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); clearTimeout(searchTimer); aplicaFiltruSiDeseneazaTerenuri(); }
            });
            document.getElementById('filtru-data')?.addEventListener('input', services.ui.updateFilterDate);
            document.getElementById('filtru-data')?.addEventListener('change', () => {
                services.ui.updateFilterDate();
                aplicaFiltruSiDeseneazaTerenuri();
            });
            document.getElementById('filtru-ora')?.addEventListener('change', aplicaFiltruSiDeseneazaTerenuri);
            document.getElementById('inchide-terenuri')?.addEventListener('click', () => {
                document.getElementById('modal-terenuri').style.display = 'none';
                services.ui.resetSportBackground();
            });
            document.getElementById('inapoi-la-terenuri')?.addEventListener('click', () => { document.getElementById('modal-rezervare').style.display = 'none'; document.getElementById('modal-terenuri').style.display = 'flex';

                    // Schimba fundalul cu imaginea sportului
                    const bgDiv = document.getElementById('fundal-imagine-sport');
                    if(bgDiv && state.sport) {

                        // Punem background-ul pe ecranul principal (in spatele modalului)
                        services.ui.setSportBackground(bgDiv, state.sport);
                        bgDiv.style.opacity = '1';

                        // Punem background-ul STRICT IN FEREASTRA (modal-continut)
                        const modalContinut = document.querySelector('#modal-terenuri .modal-continut');
                        if (modalContinut) {
                            services.ui.setSportBackground(modalContinut, state.sport, true);
                        }
                    } });

            window.openCourtReservation = openCourtReservation;
            window.dispatchEvent(new Event('spotivity:booking-ready'));
        }
        return { load: incarcaTerenuri, populateCities: populeazaFiltruOrase, render: aplicaFiltruSiDeseneazaTerenuri, mount };
    };
})();
