// Booking selection, consecutive hours, confirmation and realtime availability.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicBookings = function(context) {
        const { db, state, services } = context;
        let hoursRequest = 0, bookingContextGeneration = 0;
        let bookingInFlight = false, hoursLoading = false;
        let terenCurent = '', terenCurentId = '', pretTerenCurent = 0, pretMingeCurent = 15;
        let mingeBifata = false, oraSelectata = [], dataSelectataStr = '';
        const numeZileT_DB = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
        function incarcaInterfataRezervare(terenDinDB) {
            bookingContextGeneration++;
            document.getElementById('rezervare-teren-selectat').textContent = terenDinDB.nume;
            terenCurent = terenDinDB.nume; terenCurentId = String(terenDinDB.id); pretTerenCurent = terenDinDB.pret; pretMingeCurent = terenDinDB.pret_minge !== null ? terenDinDB.pret_minge : 15;
            document.getElementById('buton-vezi-locatia').onclick = () => window.open(window.safeUrl(terenDinDB.locatie), '_blank', 'noopener,noreferrer');

            mingeBifata = false; document.getElementById('checkbox-minge').checked = false;
            if (terenDinDB.optiune_minge) {
                document.getElementById('container-minge').style.display = 'flex';
                document.getElementById('text-label-minge').innerText = `${window.dict[window.lang]['nevoie_minge']} (+${pretMingeCurent})`;
            } else document.getElementById('container-minge').style.display = 'none';

            document.getElementById('modal-terenuri').style.display = 'none';
            document.getElementById('modal-rezervare').style.display = 'flex';

            // Aplica fundalul sportului si pe modal-rezervare
            const modalRezervare = document.querySelector('#modal-rezervare .modal-continut');
            if (modalRezervare && state.sport) {
                services.ui.setSportBackground(modalRezervare, state.sport, true);
            }

            window.genereazaZile();
        }
        function genereazaZile() {
            const containerZile = document.getElementById('container-zile');
            if(!containerZile) return;
            containerZile.innerHTML = '';
            const azi = new Date(`${window.siteDate()}T12:00:00Z`);

            // Extragem data din filtru pentru a o selecta automat
            let indexDeSelectat = 0;
            const filtruDataInput = document.getElementById('filtru-data');
            if (filtruDataInput && filtruDataInput.value) {
                const dataC = new Date(`${filtruDataInput.value}T12:00:00Z`);
                const aziFaraOra = azi;
                const diffDays = Math.round((dataC - aziFaraOra) / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays < 7) {
                    indexDeSelectat = diffDays;
                }
            }

            for (let i = 0; i < 7; i++) {
                let dataCurenta = new Date(azi); dataCurenta.setUTCDate(azi.getUTCDate() + i);
                let btnZi = document.createElement('button'); btnZi.className = 'btn-zi' + (i === indexDeSelectat ? ' selectat' : '');

                let ziTextVizual = i === 0 ? window.dict[window.lang]['azi'] : (i === 1 ? window.dict[window.lang]['maine'] : window.dict[window.lang]['zile'][dataCurenta.getUTCDay()]);

                let ziTextDB = numeZileT_DB[dataCurenta.getUTCDay()];
                let ziNumar = String(dataCurenta.getUTCDate()).padStart(2, '0');
                let lunaNumar = String(dataCurenta.getUTCMonth() + 1).padStart(2, '0');

                btnZi.innerText = `${ziTextVizual}\n${ziNumar}.${lunaNumar}`;
                btnZi.addEventListener('click', () => {
                    document.querySelectorAll('.btn-zi').forEach(b => b.classList.remove('selectat')); btnZi.classList.add('selectat');
                    bookingContextGeneration++;
                    dataSelectataStr = dataCurenta.toISOString().slice(0,10);
                    oraSelectata = [];
                    incarcaOreDinSupabase();
                });
                containerZile.appendChild(btnZi);
                if (i === indexDeSelectat) btnZi.click();
            }
        };

        async function incarcaOreDinSupabase() {
            if (bookingInFlight || pendingBooking()) { actualizeazaButonFinal(); return; }
            const selection = [...oraSelectata];
            hoursLoading = true; actualizeazaButonFinal();
            const containerOre = document.getElementById('container-ore');
            containerOre.innerHTML = '<p style="grid-column: span 4; text-align:center;">⏳...</p>';

            const request = ++hoursRequest;
            const requestDay = dataSelectataStr, requestCourt = terenCurent;
            const [availability, settings] = await Promise.all([
                db.from('rezervari_disponibilitate').select('ora').eq('teren', requestCourt).eq('data_str', requestDay),
                db.from('terenuri').select('*').eq('nume', requestCourt).maybeSingle()
            ]);
            if (request !== hoursRequest || requestDay !== dataSelectataStr || requestCourt !== terenCurent) return;
            hoursLoading = false;
            oraSelectata = [];
            actualizeazaButonFinal();
            const rezervariOcupate = availability.data;
            if (availability.error || settings.error || !settings.data || settings.data.este_activ === false) {
                containerOre.textContent = services.ui.availabilityText(true);
                return;
            }
            const oreTeren = window.getCourtBookingHours(settings.data);
            if (!oreTeren.length) { containerOre.textContent = services.ui.availabilityText(); return; }

            let oreOcupateArray = rezervariOcupate ? rezervariOcupate.map(r => r.ora) : [];

            const {hour: oraCurenta, minute: minutCurent} = window.siteClock();
            const esteZiuaDeAzi = (dataSelectataStr === window.siteDate());

            // SETARE: Cu câte ore înainte se poate face o rezervare cel târziu (Marjă de siguranță)
            const ORE_AVANS_MINIM = 1;

            // NOU: Verificăm ce a selectat clientul în filtru pentru Oră
            const filtruOraInput = document.getElementById('filtru-ora');
            const oraCautataInFiltru = filtruOraInput ? filtruOraInput.value : 'ALL';

            // Verificăm dacă suntem fix pe ziua căutată în filtru
            let suntemPeZiuaCautata = false;
            const filtruDataInput = document.getElementById('filtru-data');
            if (filtruDataInput && filtruDataInput.value) {
                const dataC = new Date(filtruDataInput.value);
                const ziTextDB = numeZileT_DB[dataC.getDay()];
                const ziNumar = String(dataC.getDate()).padStart(2, '0');
                const lunaNumar = String(dataC.getMonth() + 1).padStart(2, '0');
                if (filtruDataInput.value === dataSelectataStr) {
                    suntemPeZiuaCautata = true;
                }
            }

            containerOre.innerHTML = '';
            for (const oraTxt of oreTeren) {
                const i = Number(oraTxt.split(':')[0]);
                const btnOra = document.createElement('button');
                btnOra.className = 'btn-ora'; btnOra.innerText = oraTxt;

                // Calculăm dacă e prea din scurt
                let estePreaDinScurt = false;
                if (esteZiuaDeAzi) {
                    let minutePanaLaRezervare = (i * 60) - (oraCurenta * 60 + minutCurent);
                    if (minutePanaLaRezervare < (ORE_AVANS_MINIM * 60)) {
                        estePreaDinScurt = true;
                    }
                }

                if (oreOcupateArray.includes(oraTxt) || estePreaDinScurt) {
                    btnOra.classList.add('ocupat');
                    btnOra.disabled = true;
                    btnOra.innerText += oreOcupateArray.includes(oraTxt) ? ` (${window.dict[window.lang]['ocupat']})` : ` (${window.dict[window.lang]['trecut']})`;
                } else {
                    btnOra.addEventListener('click', () => toggleOra(btnOra, oraTxt));

                    // Dacă ora curentă corespunde cu cea din filtru, o bifăm automat
                    if (selection.includes(oraTxt) || (suntemPeZiuaCautata && oraCautataInFiltru === oraTxt)) {
                        btnOra.classList.add('selectat');
                        oraSelectata.push(oraTxt);
                    }
                }
                containerOre.appendChild(btnOra);
            }

            actualizeazaButonFinal(); // Reactualizăm butonul de rezervare ca să fie verde și gata de plată
        }

        function pendingBooking() {
            return window.SpotivityBooking?.pendingSelection(state.user?.id);
        }

        function consecutiveHours(hours) {
            const ordered = [...hours].sort();
            return ordered.every((hour, index) => !index || Number(hour.slice(0, 2)) === Number(ordered[index - 1].slice(0, 2)) + 1);
        }

        function bookingNote() {
            let note = document.getElementById('booking-consecutive-note');
            if (!note) {
                note = document.createElement('p'); note.id = 'booking-consecutive-note'; note.className = 'booking-consecutive-note';
                note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
                document.getElementById('container-ore')?.after(note);
            }
            return note;
        }

        function toggleOra(btn, ora) {
            if (bookingInFlight || hoursLoading || pendingBooking()) return;
            const proposed = btn.classList.contains('selectat') ? oraSelectata.filter(value => value !== ora) : [...oraSelectata, ora];
            if (!consecutiveHours(proposed)) {
                bookingNote().textContent = 'Selectează ore consecutive. Pentru a schimba intervalul, debifează orele de la capete.';
                return;
            }
            oraSelectata = proposed;
            btn.classList.toggle('selectat', oraSelectata.includes(ora));
            actualizeazaButonFinal();
        }

        function actualizeazaButonFinal() {
            const butonConfirma = document.getElementById('buton-confirma');
            if (!butonConfirma) return;
            const pending = pendingBooking();
            if (bookingInFlight) { butonConfirma.disabled = true; return; }
            if (pending) {
                const court = state.courts.find(row => String(row.id) === pending.court_id);
                bookingNote().textContent = `Verifică rezervarea trimisă anterior: ${court?.nume || 'teren selectat'}, ${window.traduData(pending.day)}, ${pending.hours.join(', ')}. Se păstrează aceleași date pentru a evita o dublură.`;
                butonConfirma.innerText = 'Verifică rezervarea anterioară'; butonConfirma.disabled = false; butonConfirma.style.opacity = '1';
            } else if (hoursLoading || oraSelectata.length === 0) {
                bookingNote().textContent = 'O singură rezervare pe zi la același sport, cu una sau mai multe ore consecutive, indiferent de oraș.';
                butonConfirma.innerText = window.dict[window.lang]['alegeti_o_ora']; butonConfirma.disabled = true; butonConfirma.style.opacity = '0.5';
            } else if (!consecutiveHours(oraSelectata)) {
                bookingNote().textContent = 'Selectează numai ore consecutive, pe același teren.';
                butonConfirma.disabled = true;
            } else {
                bookingNote().textContent = 'O singură rezervare pe zi la același sport, cu una sau mai multe ore consecutive, indiferent de oraș.';
                let pretTotal = (pretTerenCurent * oraSelectata.length);
                if (mingeBifata) pretTotal += pretMingeCurent;
                butonConfirma.innerText = `${window.dict[window.lang]['rezerva']} (${pretTotal})`; butonConfirma.disabled = false; butonConfirma.style.opacity = '1';
            }
        }

        function mount() {
            window.genereazaZile = genereazaZile;
            document.getElementById('inchide-rezervare')?.addEventListener('click', () => {
                document.getElementById('modal-rezervare').style.display = 'none';
                services.ui.resetSportBackground();
            });
            document.getElementById('checkbox-minge')?.addEventListener('change', (e) => { mingeBifata = e.target.checked; actualizeazaButonFinal(); });
            window.addEventListener('spotivity:booking-signin', () => {
                if (state.user || pendingBooking()) return;
                document.getElementById('modal-rezervare').style.display = 'none';
                document.getElementById('modal-terenuri').style.display = 'none';
                services.ui.resetSportBackground();
                document.getElementById('tab-login')?.click();
                document.getElementById('modal-auth').style.display = 'flex';
                document.getElementById('login-email')?.focus({ preventScroll: true });
            });

            document.getElementById('buton-confirma')?.addEventListener('click', async () => {
                if (bookingInFlight || hoursLoading || (!oraSelectata.length && !pendingBooking())) return;
                const ownerId = state.user?.id || null;
                const identity = state.user ? { ...state.user } : null;
                const selected = pendingBooking() || {
                    court_id: terenCurentId, day: dataSelectataStr, hours: [...oraSelectata].sort(), with_ball: mingeBifata
                };
                if (!consecutiveHours(selected.hours)) { bookingNote().textContent = 'Selectează numai ore consecutive.'; return; }
                if (!window.SpotivityBooking) { alert('Serviciul de rezervări nu s-a încărcat. Reîncarcă pagina.'); return; }
                const butonConfirma = document.getElementById('buton-confirma');
                bookingInFlight = true;
                butonConfirma.innerText = 'Se procesează…'; butonConfirma.disabled = true;
                try {
                    const court = state.courts.find(row => String(row.id) === selected.court_id);
                    const result = await window.SpotivityBooking.create(selected, { user: identity, court_name: court?.nume || terenCurent });
                    if (!result || (state.user?.id || null) !== ownerId) return;
                    document.getElementById('modal-rezervare').style.display = 'none';
                    document.getElementById('modal-terenuri').style.display = 'none';
                    services.ui.resetSportBackground();
                    services.ui.showBookingSuccess(window.SpotivityBooking.notificationText(result));
                    window.dispatchEvent(new CustomEvent('spotivity:booking-created', { detail: { booking_id: result.booking_id } }));
                } catch (error) {
                    if ((state.user?.id || null) === ownerId) alert(error.message || 'Rezervarea nu a putut fi confirmată. Încearcă din nou.');
                } finally {
                    bookingInFlight = false;
                    actualizeazaButonFinal();
                    if (!pendingBooking() && document.getElementById('modal-rezervare').style.display === 'flex') incarcaOreDinSupabase();
                }
            });

            // ----------------------------------------
            // REALTIME REZERVĂRI (pentru update vizual live)
            // ----------------------------------------
            db.channel('rezervari_live')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'rezervari_disponibilitate' }, payload => {
                    if (document.getElementById('modal-rezervare')?.style.display === 'flex') {
                        if (payload.eventType === 'DELETE') { incarcaOreDinSupabase(); return; }
                        if (payload.new && payload.new.teren === terenCurent && payload.new.data_str === dataSelectataStr) {
                            const oraOcupata = payload.new.ora;
                            const btns = document.querySelectorAll('.btn-ora');
                            btns.forEach(b => {
                                if (b.innerText.startsWith(oraOcupata) && !b.classList.contains('ocupat')) {
                                    b.classList.add('ocupat');
                                    b.disabled = true;
                                    b.innerText = `${oraOcupata} (${window.dict[window.lang]['ocupat']})`;
                                    if (b.classList.contains('selectat')) {
                                        b.classList.remove('selectat');
                                        oraSelectata = oraSelectata.filter(o => o !== oraOcupata);
                                        actualizeazaButonFinal();
                                    }
                                }
                            });
                        }
                    }
                })
                .subscribe();
            setInterval(() => {
                if (document.visibilityState === 'visible' && document.getElementById('modal-rezervare')?.style.display === 'flex') incarcaOreDinSupabase();
            }, 15000);
        }
        return {
            mount,
            openCourt: incarcaInterfataRezervare,
            generation: () => bookingContextGeneration,
            invalidate: () => { bookingContextGeneration++; }
        };
    };
})();
