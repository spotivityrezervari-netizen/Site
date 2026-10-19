/* admin-schedule.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminSchedule = function(context) {
        const { db, state } = context;
        function validAdminCalendarDate(value) {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
            if (!match || Number(match[1]) < 1) return false;
            const date = new Date(0);
            date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            return date.getUTCFullYear() === Number(match[1])
                && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
        }

        window.deschideProgramAdmin = function(sport = '') {
            if (!state.account) return;
            const canonicalSport = window.normalizeSportName?.(sport) || sport;
            const names = state.managedCourts.filter(court => !canonicalSport
                || (window.normalizeSportName?.(court.sport) || court.sport) === canonicalSport).map(court => court.nume);
            if (!names.length) return;
            const title = document.querySelector('#modal-tabel-program .program-titlu');
            if (title) title.textContent = canonicalSport ? `Program ${canonicalSport === 'Tenis Picior' ? 'Tenis de picior' : canonicalSport}` : 'Program & Disponibilitate';
            window.initializeazaTabel(names);
            document.getElementById('modal-tabel-program').style.display = 'flex';
        };
        window.initializeazaTabel = function(terenuriArray) {
            const select = document.getElementById('tabel-teren');
            select.innerHTML = '';

            if (terenuriArray.length === 0) {
                select.innerHTML = '<option value="">Niciun teren alocat</option>';
                return;
            }

            terenuriArray.forEach(t => {
                select.innerHTML += `<option value="${window.escapeHtml(t)}">${window.escapeHtml(t)}</option>`;
            });

            const dataInput = document.getElementById('tabel-data');
            if (!dataInput.value) {
                dataInput.value = window.siteDate();
            }

            dataInput.onchange = window.incarcaTabelProgram;
            select.onchange = window.incarcaTabelProgram;
            window.incarcaTabelProgram();
        };

        window.incarcaTabelProgram = async function() {
            const request = ++state.programGeneration;
            const terenAles = document.getElementById('tabel-teren').value;
            const dataInput = document.getElementById('tabel-data').value;
            const tbody = document.getElementById('tabel-corp-program');

            if (!terenAles || !dataInput) {
                tbody.innerHTML = '<tr><td colspan="3">Alege un teren și o dată calendaristică.</td></tr>';
                return;
            }
            if (!validAdminCalendarDate(dataInput)) {
                tbody.innerHTML = '<tr><td colspan="3">Alege o dată validă, din orice an între 0001 și 9999.</td></tr>';
                return;
            }
            tbody.innerHTML = '<tr><td colspan="3" style="padding:15px; text-align:center;">Se Încarcă datele...</td></tr>';

            const dataFormata = dataInput;

            const { data: rezervari, error } = await db.from('rezervari')
                .select('*')
                .eq('teren', terenAles)
                .eq('data_str', dataFormata)
                .neq('stare', 'anulata');

            if (request !== state.programGeneration) return;
            if (error) {
                tbody.innerHTML = '<tr><td colspan="3">Programul nu poate fi încărcat. Încearcă din nou.</td></tr>';
                return;
            }

            let clientiAsociati = [];
            if (rezervari && rezervari.length > 0) {
                const emails = rezervari.filter(r => !r.guest_name && !r.guest_phone).map(r => r.email_client).filter(e => e !== 'Teren Blocat');
                if(emails.length > 0) {
                    const { data: clientiDB } = await db.from('clienti').select('*').in('email', emails);
                    if (clientiDB) clientiAsociati = clientiDB;
                }
            }

            const { data: infoTeren, error: courtError } = await db.from('terenuri').select('*').eq('nume', terenAles).single();
            if (request !== state.programGeneration) return;
            if (courtError || !infoTeren) {
                tbody.innerHTML = '<tr><td colspan="3">Setările terenului nu pot fi încărcate. Încearcă din nou.</td></tr>';
                return;
            }
            const terenAreChatActivat = infoTeren ? infoTeren.are_chat !== false : true;

            let html = '';
            const oreRezervabile = window.getCourtBookingHours(infoTeren);
            const ore = [...new Set([...oreRezervabile, ...(rezervari || []).map(r => r.ora)])]
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

            ore.forEach(ora => {
                const rGasita = rezervari ? rezervari.find(r => r.ora === ora) : null;
                const inProgram = oreRezervabile.includes(ora);

                let col1 = `<div class="program-ora-label">${window.escapeHtml(ora)}</div>`;
                let col2 = '';
                let col3 = '<span style="color:#888;">-</span>';
                let bg = 'transparent';

                if (rGasita) {
                    const eBlocat = rGasita.email_client === 'Teren Blocat';
                    bg = eBlocat ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.05)';

                    if (!window.bookingEnded(rGasita.data_str, rGasita.ora)) col1 += `<br><button class="program-anulare" aria-label="Anulează rezervarea de la ora ${window.escapeHtml(ora)}" title="Anulează rezervarea de la ora ${window.escapeHtml(ora)}" onclick="window.anulareDublaAdmin('${rGasita.id}', '${ora}')" style="background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 5px; width: 100%;"><span class="program-anulare-icon" aria-hidden="true">✕</span><span class="program-anulare-text">Anulează</span></button>`;

                    col2 = `
                        <select onchange="window.schimbaStareExistenta(this, '${rGasita.id}', '${ora}', '${window.escapeJs(terenAles)}', '${dataFormata}')" style="background: #1f2937; color: white; border: 1px solid ${eBlocat ? '#ef4444' : '#f59e0b'}; border-radius: 5px; padding: 6px; font-weight: bold; cursor: pointer; width: 100%;">
                            <option value="liber">LIBER</option>
                            <option value="ocupat" ${!eBlocat ? 'selected' : ''}>OCUPAT</option>
                            <option value="blocat" ${eBlocat ? 'selected' : ''}>BLOCAT</option>
                        </select>
                    `;
                    if (window.bookingEnded(rGasita.data_str, rGasita.ora)) {
                        col2 = '<span>FINALIZATĂ</span>';
                    } else if (!inProgram) {
                        col2 = `<span>${eBlocat ? 'BLOCAT' : 'OCUPAT'}</span><small class="program-in-afara">În afara programului actual</small>`;
                    }

                    if (eBlocat) {
                        col3 = `<span style="color:#ef4444; font-weight:bold;">Închis de Admin</span>`;
                    } else {
                        let infoClient = rGasita.email_client;
                        const isGuest = !!(rGasita.guest_name || rGasita.guest_phone);
                        // Guest details belong to this reservation; an equal email does not prove account ownership.
                        let contClient = isGuest ? null : clientiAsociati.find(c => c.email === rGasita.email_client);

                        if (isGuest) {
                            infoClient = [rGasita.guest_name ? `Nume: ${window.escapeHtml(rGasita.guest_name)}` : '',
                                rGasita.guest_phone ? `Tel: ${window.escapeHtml(rGasita.guest_phone)}` : '',
                                `Email: ${window.escapeHtml(rGasita.email_client)}`].filter(Boolean).join('<br>');
                        } else if (contClient) {
                            let cNume = contClient.nume ? `Nume: ${window.escapeHtml(contClient.nume)}<br>` : '';
                            let cTel = contClient.telefon ? `Tel: ${window.escapeHtml(contClient.telefon)}<br>` : '';
                            let cMail = `Email: ${window.escapeHtml(contClient.email)}`;
                            infoClient = `${cNume}${cTel}${cMail}`;
                        } else {
                            infoClient = `Detalii (Manual): ${window.escapeHtml(rGasita.email_client)}`;
                        }

                        let chatBtnStr = "";
                        if (terenAreChatActivat && !isGuest) {
                            const clientName = contClient ? (contClient.nume || contClient.email.split('@')[0]) : (rGasita.email_client.split('@')[0]);
                            const emailParam = contClient ? contClient.email : rGasita.email_client;
                            chatBtnStr = `<button class="btn-tabel-chat" onclick="deschideChatDinTabel('${window.escapeJs(emailParam)}', '${window.escapeJs(terenAles)}', '${window.escapeJs(clientName)}')" style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #3b82f6; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: bold; cursor: pointer; margin-left: 10px; transition: 0.3s; vertical-align: middle;">Chat</button>`;
                        }

                        col3 = `<span style="color:white; font-size:12px; line-height:1.4;">${infoClient}</span><div class="program-detalii-footer"><span style="font-size:12px; color:#aaa;">${window.escapeHtml(rGasita.pret_total)}</span>${chatBtnStr}</div>`;
                    }
                } else {
                    const oraId = ora.replace(':', '');
                    col2 = `
                        <select onchange="window.schimbaStareNoua(this, '${window.escapeJs(terenAles)}', '${dataFormata}', '${ora}')" id="select-stare-${oraId}" style="background: #1f2937; color: white; border: 1px solid #22c55e; border-radius: 5px; padding: 6px; font-weight: bold; cursor: pointer; width: 100%;">
                            <option value="liber" selected>LIBER</option>
                            <option value="ocupat">OCUPAT</option>
                            <option value="blocat">BLOCAT</option>
                        </select>
                    `;

                    col3 = `
                        <div id="form-inline-${oraId}" style="display: none; flex-direction: column; gap: 5px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 5px; border: 1px dashed #f59e0b;">
                            <input type="text" id="inline-nume-${oraId}" placeholder="Nume Client / Telefon" style="padding: 6px; border-radius: 3px; border: 1px solid #444; background: #222; color: white; font-size: 12px; width: 100%; box-sizing: border-box;">
                            <input type="text" id="inline-pret-${oraId}" placeholder="Detalii" style="padding: 6px; border-radius: 3px; border: 1px solid #444; background: #222; color: white; font-size: 12px; width: 100%; box-sizing: border-box;">
                            <button onclick="window.salveazaRezervareInlineAdmin('${window.escapeJs(terenAles)}', '${dataFormata}', '${ora}')" style="background: #22c55e; color: black; border: none; padding: 6px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 12px;">Salvează Rezervarea</button>
                        </div>
                        <span id="text-liber-${oraId}" style="color:#888;">-</span>
                    `;
                }

                html += `<tr data-ora="${window.escapeHtml(ora)}" style="background: ${bg}; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td class="program-col-ora">${col1}</td>
                        <td class="program-col-stare">${col2}</td>
                        <td>${col3}</td></tr>`;
            });
            tbody.innerHTML = html || '<tr><td colspan="3">Nu sunt ore rezervabile. Alege orele în setările terenului pentru a relua rezervările.</td></tr>';
        };

    };
})();
