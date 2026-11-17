/* admin-schedule.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminSchedule = function(context) {
        const { db, state } = context;
        let expiryTimer = null, snapshot = null;
        const hourMs = 60 * 60 * 1000;
        const bucharestParts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        });
        function stopExpiryTimer() { clearTimeout(expiryTimer); expiryTimer = null; }
        function scheduleIsOpen() {
            const modal = document.getElementById('modal-tabel-program');
            return !!modal && !modal.hidden && modal.getClientRects().length > 0
                && ['flex', 'block'].includes(modal.style.display);
        }
        function utcTime(year, month, day, hour, minute) {
            const date = new Date(0);
            date.setUTCFullYear(year, month - 1, day);
            date.setUTCHours(hour, minute, 0, 0);
            return date.getTime();
        }
        function slotEnd(row) {
            const startsAt = Date.parse(row.starts_at || '');
            if (Number.isFinite(startsAt)) return startsAt + hourMs;
            const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(row.data_str || ''));
            const time = /^(\d{2}):(\d{2})$/.exec(String(row.ora || ''));
            if (!day || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return NaN;
            const wanted = utcTime(Number(day[1]), Number(day[2]), Number(day[3]), Number(time[1]), Number(time[2]));
            let instant = wanted;
            // Legacy reservations use Romania's civil clock in every browser time zone.
            for (let i = 0; i < 3; i++) {
                const parts = bucharestParts.formatToParts(new Date(instant));
                const part = type => Number(parts.find(value => value.type === type).value);
                const local = utcTime(part('year'), part('month'), part('day'), part('hour'), part('minute'));
                if (local === wanted) return instant + hourMs;
                instant += wanted - local;
            }
            return NaN;
        }
        function refreshCachedStatus() {
            stopExpiryTimer();
            if (!snapshot?.isCurrent() || !scheduleIsOpen() || document.hidden) return;
            const now = Date.now();
            const scrollPositions = [];
            for (let node = snapshot.container.parentElement; node; node = node.parentElement) {
                if (node.scrollTop || node.scrollLeft) scrollPositions.push({node, top: node.scrollTop, left: node.scrollLeft});
            }
            let next = Infinity;
            for (const {row, element} of snapshot.rows) {
                if (!element.isConnected) continue;
                if (window.bookingEnded(row.data_str, row.ora)) {
                    const cancel = element.querySelector('.program-anulare');
                    const status = element.querySelector('.program-col-stare');
                    if (cancel?.contains(document.activeElement) || status.contains(document.activeElement)) {
                        element.tabIndex = -1;
                        element.focus({preventScroll: true});
                    }
                    cancel?.remove();
                    if (status.textContent !== 'FINALIZATĂ') status.textContent = 'FINALIZATĂ';
                } else {
                    const end = slotEnd(row);
                    next = Math.min(next, Number.isFinite(end) && end > now ? end : now + 60000 - now % 60000);
                }
            }
            for (const {node, top, left} of scrollPositions) {node.scrollTop = top; node.scrollLeft = left;}
            if (Number.isFinite(next)) expiryTimer = setTimeout(refreshCachedStatus, Math.min(2147483647, Math.max(50, next - now + 25)));
        }
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

            window.incarcaTabelProgram();
        };

        window.incarcaTabelProgram = async function() {
            snapshot = null;
            stopExpiryTimer();
            const request = ++state.programGeneration;
            const authRequest = state.authGeneration;
            const account = state.account;
            const terenAles = document.getElementById('tabel-teren').value;
            const dataInput = document.getElementById('tabel-data').value;
            const tbody = document.getElementById('tabel-corp-program');
            const isCurrent = () => request === state.programGeneration && authRequest === state.authGeneration
                && !!account && account === state.account && terenAles === document.getElementById('tabel-teren').value
                && dataInput === document.getElementById('tabel-data').value;

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

            const { data: rezervari, error } = await window.spotivityReadAllRows(() => db.from('rezervari')
                .select('*')
                .eq('teren', terenAles)
                .eq('data_str', dataFormata)
                .neq('stare', 'anulata').order('id'));

            if (!isCurrent()) return;
            if (error) {
                tbody.innerHTML = '<tr><td colspan="3">Programul nu poate fi încărcat. Încearcă din nou.</td></tr>';
                return;
            }

            let clientiAsociati = [];
            if (rezervari && rezervari.length > 0) {
                const userIds = [...new Set(rezervari.filter(r => !r.guest_name && !r.guest_phone && r.email_client !== 'Teren Blocat')
                    .map(r => r.client_user_id).filter(Boolean))];
                if(userIds.length > 0) {
                    const { data: clientiDB } = await window.spotivityReadAllRows(() => db.from('clienti').select('*').in('user_id', userIds).order('id'));
                    if (clientiDB) clientiAsociati = clientiDB;
                }
            }

            const { data: infoTeren, error: courtError } = await db.from('terenuri').select('*').eq('nume', terenAles).single();
            if (!isCurrent()) return;
            if (courtError || !infoTeren) {
                tbody.innerHTML = '<tr><td colspan="3">Setările terenului nu pot fi încărcate. Încearcă din nou.</td></tr>';
                return;
            }
            const terenAreChatActivat = infoTeren ? infoTeren.are_chat !== false : true;

            let html = '';
            const actions = [];
            const action = (type, handler) => {
                const index = actions.push({ type, handler }) - 1;
                return `data-program-action="${index}"`;
            };
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

                    if (!window.bookingEnded(rGasita.data_str, rGasita.ora)) col1 += `<br><button class="program-anulare" aria-label="Anulează rezervarea de la ora ${window.escapeHtml(ora)}" title="Anulează rezervarea de la ora ${window.escapeHtml(ora)}" ${action('click', () => window.anulareDublaAdmin(rGasita.id, ora))} style="background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 5px; width: 100%;"><span class="program-anulare-icon" aria-hidden="true">✕</span><span class="program-anulare-text">Anulează</span></button>`;

                    col2 = `
                        <select ${action('change', event => window.schimbaStareExistenta(event.currentTarget, rGasita.id, ora, terenAles, dataFormata))} style="background: #1f2937; color: white; border: 1px solid ${eBlocat ? '#ef4444' : '#f59e0b'}; border-radius: 5px; padding: 6px; font-weight: bold; cursor: pointer; width: 100%;">
                            <option value="liber">LIBER</option>
                            <option value="ocupat" ${!eBlocat ? 'selected' : ''}>OCUPAT</option>
                            ${eBlocat ? '<option value="blocat" selected>BLOCAT</option>' : ''}
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
                        const contClient = !isGuest && rGasita.client_user_id ? clientiAsociati.find(c => c.user_id === rGasita.client_user_id) : null;

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
                        if (terenAreChatActivat && contClient && !state.account?.is_super) {
                            const clientName = contClient.nume || contClient.email.split('@')[0];
                            const emailParam = contClient.email;
                            chatBtnStr = `<button class="btn-tabel-chat" ${action('click', () => window.deschideChatDinTabel(emailParam, terenAles, clientName))} style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #3b82f6; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: bold; cursor: pointer; margin-left: 10px; transition: 0.3s; vertical-align: middle;">Chat</button>`;
                        }

                        col3 = `<span style="color:white; font-size:12px; line-height:1.4;">${infoClient}</span><div class="program-detalii-footer"><span style="font-size:12px; color:#aaa;">${window.escapeHtml(rGasita.pret_total)}</span>${chatBtnStr}</div>`;
                        col3 += `<div class="booking-attendance" ${rGasita.booking_group_id ? `data-booking-attendance="${window.escapeHtml(rGasita.booking_group_id)}"` : `data-reservation-attendance="${window.escapeHtml(rGasita.id)}"`}></div>`;
                    }
                } else {
                    const oraId = ora.replace(':', '');
                    col2 = `
                        <select ${action('change', event => window.schimbaStareNoua(event.currentTarget, terenAles, dataFormata, ora))} id="select-stare-${oraId}" style="background: #1f2937; color: white; border: 1px solid #22c55e; border-radius: 5px; padding: 6px; font-weight: bold; cursor: pointer; width: 100%;">
                            <option value="liber" selected>LIBER</option>
                            <option value="ocupat">OCUPAT</option>
                            <option value="blocat">BLOCAT</option>
                        </select>
                    `;

                    col3 = `
                        <div id="form-inline-${oraId}" style="display: none; flex-direction: column; gap: 5px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 5px; border: 1px dashed #f59e0b;">
                            <input type="text" id="inline-nume-${oraId}" placeholder="Nume Client / Telefon" style="padding: 6px; border-radius: 3px; border: 1px solid #444; background: #222; color: white; font-size: 12px; width: 100%; box-sizing: border-box;">
                            <input type="text" id="inline-pret-${oraId}" placeholder="Detalii" style="padding: 6px; border-radius: 3px; border: 1px solid #444; background: #222; color: white; font-size: 12px; width: 100%; box-sizing: border-box;">
                            <button ${action('click', () => window.salveazaRezervareInlineAdmin(terenAles, dataFormata, ora))} style="background: #22c55e; color: black; border: none; padding: 6px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 12px;">Salvează Rezervarea</button>
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
            tbody.querySelectorAll('[data-program-action]').forEach(element => {
                const binding = actions[Number(element.dataset.programAction)];
                element.addEventListener(binding.type, binding.handler);
            });
            const elements = [...tbody.querySelectorAll('tr[data-ora]')];
            snapshot = {container: tbody, isCurrent, rows: ore.map((ora, index) => ({
                row: (rezervari || []).find(row => row.ora === ora), element: elements[index]
            })).filter(({row, element}) => row && element)};
            refreshCachedStatus();
            await window.loadBookingAttendanceControls?.({ db, container: tbody, isCurrent });
        };

        document.getElementById('tabel-data')?.addEventListener('change', () => window.incarcaTabelProgram());
        document.getElementById('tabel-teren')?.addEventListener('change', () => window.incarcaTabelProgram());
        for (const id of ['modal-tabel-program', 'base-admin-workspace']) {
            const node = document.getElementById(id);
            if (node) new MutationObserver(refreshCachedStatus).observe(node, {attributes: true, attributeFilter: ['style', 'hidden']});
        }
        document.addEventListener('visibilitychange', refreshCachedStatus);
        window.addEventListener('focus', refreshCachedStatus);
        window.addEventListener('pageshow', refreshCachedStatus);
        window.addEventListener('spotivity:admin-clear', () => {snapshot = null; stopExpiryTimer();});
    };
})();
