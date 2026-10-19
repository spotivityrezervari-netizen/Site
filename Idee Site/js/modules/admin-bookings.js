/* admin-bookings.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminBookings = function(context) {
        const { db, state } = context;
        async function adminHourIsAllowed(courtName, hour) {
            const sameContext = context.captureContext();
            if (!sameContext()) return false;
            const { data: court, error } = await db.from('terenuri').select('*').eq('nume', courtName).single();
            if (!sameContext()) return false;
            if (error || !court) {
                alert('Programul terenului nu poate fi verificat. Reîncarcă și încearcă din nou.');
                return false;
            }
            if (!window.getCourtBookingHours(court).includes(hour)) {
                alert('Această oră nu este în programul rezervabil al terenului.');
                return false;
            }
            return true;
        }

        window.actualizeazaOreManualAdmin = async function() {
            const courtSelect = document.getElementById('manual-teren');
            const hourSelect = document.getElementById('manual-ora');
            const saveButton = document.getElementById('btn-rezervare-manuala');
            if (!courtSelect || !hourSelect) return;
            const request = ++state.manualHoursGeneration;
            const previousHour = hourSelect.value;
            hourSelect.disabled = true;
            if (saveButton) saveButton.disabled = true;
            hourSelect.innerHTML = '<option value="">Se încarcă orele...</option>';
            if (!courtSelect.value) {
                hourSelect.innerHTML = '<option value="">Alege un teren</option>';
                return;
            }
            const { data: court, error } = await db.from('terenuri').select('*').eq('nume', courtSelect.value).single();
            if (request !== state.manualHoursGeneration) return;
            if (error || !court) {
                hourSelect.innerHTML = '<option value="">Orele nu pot fi încărcate</option>';
                return;
            }
            const hours = window.getCourtBookingHours(court);
            hourSelect.innerHTML = hours.length
                ? hours.map(hour => `<option value="${hour}">${hour}</option>`).join('')
                : '<option value="">Fără ore rezervabile</option>';
            if (hours.includes(previousHour)) hourSelect.value = previousHour;
            hourSelect.disabled = !hours.length;
            if (saveButton) saveButton.disabled = !hours.length;
        };
        window.anuleazaRezervareAdmin = async function(id) {
            const sameContext = context.captureContext();
            if (!sameContext()) return;
            if (confirm("Ești sigur că vrei să anulezi rezervarea? Ea va apărea marcată cu roșu în istoric.")) {
                const { error } = await db.from('rezervari').update({ stare: 'anulata' }).eq('id', id);
                if (!sameContext()) return;
                if (!error) {
                    if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
                    if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram();
                }
                else if (error) alert("Eroare la anulare: " + error.message);
            }
        };
        window.blocheazaZiuaIntreaga = async function(numeTeren, idTeren, event) {
            const sameContext = context.captureContext();
            const dateElement = document.getElementById(`data-blocare-${idTeren}`);
            if (!sameContext() || !dateElement) return;
            const dataInput = dateElement.value;
            if (!dataInput) return alert("Alege o dată din calendar mai întâi!");
            const d = new Date(dataInput);
            const zile = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
            const dataFormata = dataInput;
            const { data: court, error: courtError } = await db.from('terenuri').select('*').eq('nume', numeTeren).single();
            if (!sameContext()) return;
            if (courtError || !court) return alert('Programul terenului nu poate fi verificat. Încearcă din nou.');
            const ore = window.getCourtBookingHours(court);
            if (!ore.length) return alert('Terenul nu are ore rezervabile. Nu este nimic de blocat.');
            if (!confirm(`Ești sigur că blochezi complet terenul ${numeTeren} pe data de ${dataFormata}?`)) return;

            const btn = event.target; const textVechi = btn.innerText; btn.innerText = "Se blochează..."; btn.disabled = true;

            const { data: oreExistente, error: availabilityError } = await db.from('rezervari').select('ora').eq('teren', numeTeren).eq('data_str', dataFormata).neq('stare', 'anulata');
            if (!sameContext()) return;
            if (availabilityError) {
                alert('Rezervările existente nu pot fi verificate. Încearcă din nou.');
                btn.innerText = textVechi; btn.disabled = false;
                return;
            }
            const oreOcupate = oreExistente ? oreExistente.map(r => r.ora) : [];

            const oreDeBlocat = ore.filter(o => !oreOcupate.includes(o)).map(oraLibera => ({
                sport: "Blocat", teren: numeTeren, data_str: dataFormata, ora: oraLibera,
                pret_total: "0 Lei", email_client: "Teren Blocat", stare: 'activa', timestamp_start: Date.now()
            }));

            if (oreDeBlocat.length > 0) {
                const { error } = await db.from('rezervari').insert(oreDeBlocat);
                if (!sameContext()) return;
                if (error) { alert("Eroare: " + error.message); btn.innerText = textVechi; btn.disabled = false; return; }
            }

            alert(`Ziua a fost blocată!`); btn.innerText = textVechi; btn.disabled = false;
            if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
            if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram();
        };

        window.deblocheazaZiua = async function(numeTeren, idTeren, event) {
            const sameContext = context.captureContext();
            const dateElement = document.getElementById(`data-blocare-${idTeren}`);
            if (!sameContext() || !dateElement) return;
            const dataInput = dateElement.value;
            if (!dataInput) return alert("Alege o dată!");
            const d = new Date(dataInput);
            const zile = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
            const dataFormata = dataInput;
            if (!confirm(`Deblochezi terenul ${numeTeren} pe ${dataFormata}?`)) return;

            const btn = event.target; const textVechi = btn.innerText; btn.innerText = "Așteaptă..."; btn.disabled = true;
            const { error } = await db.from('rezervari').delete().eq('teren', numeTeren).eq('data_str', dataFormata).eq('email_client', 'Teren Blocat');
            if (!sameContext()) return;
            if (!error) {
                alert(`Ziua deblocată!`);
                if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
                if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram();
            }
            else alert("Eroare: " + error.message);
            btn.innerText = textVechi; btn.disabled = false;
        };
        document.getElementById('btn-rezervare-manuala')?.addEventListener('click', async () => {
            const selectBox = document.getElementById('manual-teren');
            const hourSelect = document.getElementById('manual-ora');
            const clientInput = document.getElementById('manual-client');
            const dateInput = document.getElementById('manual-data');
            const priceInput = document.getElementById('manual-pret');
            const modal = document.getElementById('modal-rezervare-manuala');
            const saveButton = document.getElementById('btn-rezervare-manuala');
            const request = state.manualHoursGeneration;
            const clientValue = clientInput.value;
            const priceValue = priceInput.value;
            const terenAles = selectBox.value;
            const sportAles = selectBox.selectedIndex >= 0 ? selectBox.options[selectBox.selectedIndex].getAttribute('data-sport') : '-';
            const client = clientValue.trim().replace(/\.$/, '');
            const dataInput = dateInput.value;
            const oraAlesa = hourSelect.value;
            const pret = priceValue.trim().replace(/\.$/, '');
            const sameContext = () => request === state.manualHoursGeneration
                && modal.style.display === 'flex' && selectBox.value === terenAles
                && hourSelect.value === oraAlesa && dateInput.value === dataInput
                && clientInput.value === clientValue && priceInput.value === priceValue;

            if (!terenAles || !oraAlesa || !client || !dataInput || !pret) return alert("Alege o oră rezervabilă și completează câmpurile!");
            const dataFormata = dataInput;
            saveButton.innerText = 'Se verifică...';
            saveButton.disabled = true;
            try {
                const allowed = await adminHourIsAllowed(terenAles, oraAlesa);
                if (!sameContext()) return;
                if (!allowed) { await window.actualizeazaOreManualAdmin(); return; }
                const { data: dublura, error: availabilityError } = await db.from('rezervari').select('id').eq('teren', terenAles).eq('data_str', dataFormata).eq('ora', oraAlesa).neq('stare', 'anulata');
                if (!sameContext()) return;
                if (availabilityError) return alert('Rezervările existente nu pot fi verificate. Încearcă din nou.');
                if (dublura && dublura.length > 0) return alert(`Ora ${oraAlesa} pe ${dataFormata} este rezervată!`);
                const { error } = await db.from('rezervari').insert([{
                    sport: sportAles, teren: terenAles, data_str: dataFormata, ora: oraAlesa,
                    pret_total: pret + (window.lang === 'hu' ? ' RON (Kézi)' : ' Lei (Manual)'), email_client: client, stare: 'activa', timestamp_start: Date.now()
                }]);
                if (!sameContext()) return;
                if (!error) {
                    alert('Rezervare adăugată!');
                    if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
                    if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram();
                } else alert('Eroare: ' + error.message);
            } finally {
                if (request === state.manualHoursGeneration) {
                    saveButton.innerText = window.lang === 'hu' ? 'Mentés' : 'Salvează';
                    saveButton.disabled = hourSelect.disabled || !hourSelect.value;
                }
            }
        });
        window.blocheazaOraSinguraAdmin = async function(numeTeren, dataFormata, ora) {
            const sameContext = context.captureContext();
            if (!sameContext()) return;
            if (!await adminHourIsAllowed(numeTeren, ora)) { window.incarcaTabelProgram(); return; }
            if (!sameContext()) return;
            if (!confirm(`Blochezi ora ${ora} pentru terenul ${numeTeren}?`)) return;

            const { data: verif } = await db.from('rezervari').select('id').eq('teren', numeTeren).eq('data_str', dataFormata).eq('ora', ora).neq('stare', 'anulata');
            if (!sameContext()) return;
            if (verif && verif.length > 0) {
                alert("Eroare: Ora a fost rezervata intre timp de altcineva!");
                window.incarcaTabelProgram();
                return;
            }

            const deBlocat = {
                sport: "Blocat",
                teren: numeTeren,
                data_str: dataFormata,
                ora: ora,
                pret_total: "0 Lei",
                email_client: "Teren Blocat",
                stare: 'activa',
                timestamp_start: Date.now()
            };

            const { error } = await db.from('rezervari').insert([deBlocat]);

            if (!sameContext()) return;
            if (error) {
                alert("Eroare la blocare: " + error.message);
            } else {
                window.incarcaTabelProgram();
                if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
            }
        };

        window.schimbaStareNoua = function(select, teren, data, ora) {
            const val = select.value;
            const oraId = ora.replace(':', '');
            const form = document.getElementById('form-inline-' + oraId);
            const txtLiber = document.getElementById('text-liber-' + oraId);

            if (val === 'ocupat') {
                form.style.display = 'flex';
                txtLiber.style.display = 'none';
                select.style.borderColor = '#f59e0b';
            } else if (val === 'blocat') {
                form.style.display = 'none';
                txtLiber.style.display = 'inline-block';
                select.style.borderColor = '#ef4444';
                window.blocheazaOraSinguraAdmin(teren, data, ora);
                select.value = 'liber';
            } else {
                form.style.display = 'none';
                txtLiber.style.display = 'inline-block';
                select.style.borderColor = '#22c55e';
            }
        };

        window.schimbaStareExistenta = async function(select, idRez, ora, teren, data) {
            const sameContext = context.captureContext();
            if (!sameContext()) return;
            const val = select.value;
            if (val === 'liber') {
                window.anulareDublaAdmin(idRez, ora);
            } else if (val === 'blocat') {
                if (!await adminHourIsAllowed(teren, ora)) { window.incarcaTabelProgram(); return; }
                if(confirm('Transformi aceasta rezervare in BLOCAT?')) {
                    await db.from('rezervari').update({ email_client: 'Teren Blocat' }).eq('id', idRez);
                    window.incarcaTabelProgram();
                } else {
                    window.incarcaTabelProgram();
                }
            } else if (val === 'ocupat') {
                alert('Pentru a rezerva un teren blocat, te rog trece-l pe LIBER mai intai!');
                window.incarcaTabelProgram();
            }
        };

        window.anulareDublaAdmin = async function(idRez, ora) {
            const sameContext = context.captureContext();
            if (!sameContext()) return;
            if (confirm('Pasul 1: Esti sigur ca vrei sa anulezi ora ' + ora + '?')) {
                setTimeout(async () => {
                    if (!sameContext()) return;
                    if (confirm('Pasul 2 (Confirmare Finala): ESTI ABSOLUT SIGUR ca anulezi ora ' + ora + ' si o eliberezi?')) {
                        const { error } = await db.from('rezervari').update({ stare: 'anulata' }).eq('id', idRez);
                        if (!sameContext()) return;
                        if (!error) {
                            window.incarcaTabelProgram();
                            if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
                        } else {
                            alert('Eroare la anulare: ' + error.message);
                        }
                    } else {
                        window.incarcaTabelProgram();
                    }
                }, 300);
            } else {
                window.incarcaTabelProgram();
            }
        };

        window.salveazaRezervareInlineAdmin = async function(teren, data, ora) {
            const request = state.programGeneration;
            const oraId = ora.replace(':', '');
            const nameInput = document.getElementById('inline-nume-' + oraId);
            const priceInput = document.getElementById('inline-pret-' + oraId);
            if (!nameInput || !priceInput) return;
            const nume = nameInput.value.trim().replace(/\.$/, '');
            const pret = priceInput.value.trim().replace(/\.$/, '');
            const sameContext = () => request === state.programGeneration && nameInput.isConnected && priceInput.isConnected
                && document.getElementById('modal-tabel-program').style.display === 'flex';

            if (!nume) {
                alert('Introdu un Nume / Telefon pentru a rezerva!');
                return;
            }

            const allowed = await adminHourIsAllowed(teren, ora);
            if (!sameContext()) return;
            if (!allowed) { window.incarcaTabelProgram(); return; }

            const { data: verif, error: availabilityError } = await db.from('rezervari').select('id').eq('teren', teren).eq('data_str', data).eq('ora', ora).neq('stare', 'anulata');
            if (!sameContext()) return;
            if (availabilityError) return alert('Rezervările existente nu pot fi verificate. Încearcă din nou.');
            if (verif && verif.length > 0) {
                alert('Eroare: Ora a fost rezervata intre timp!');
                window.incarcaTabelProgram();
                return;
            }

            const { error } = await db.from('rezervari').insert([{
                sport: '-',
                teren: teren,
                data_str: data,
                ora: ora,
                pret_total: pret ? pret : 'Platit / Custom',
                email_client: nume,
                stare: 'activa',
                timestamp_start: Date.now()
            }]);

            if (!sameContext()) return;
            if (!error) {
                window.incarcaTabelProgram();
                if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
            } else {
                alert('Eroare: ' + error.message);
            }
        };

    };
})();
