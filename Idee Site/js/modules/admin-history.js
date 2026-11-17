/* admin-history.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminHistory = function(context) {
        const { db, state } = context;
        let historyRequest = 0, expiryTimer = null, snapshot = null;
        const hourMs = 60 * 60 * 1000;
        const bucharestParts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        });
        function stopExpiryTimer() { clearTimeout(expiryTimer); expiryTimer = null; }
        function historyIsOpen() {
            const modal = document.getElementById('modal-istoric');
            return !!modal && !modal.hidden && modal.getClientRects().length > 0
                && ['flex', 'block'].includes(modal.style.display);
        }
        function slotEnd(row) {
            const startsAt = Date.parse(row.starts_at || '');
            if (Number.isFinite(startsAt)) return startsAt + hourMs;
            const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(row.data_str || ''));
            const time = /^(\d{2}):(\d{2})$/.exec(String(row.ora || ''));
            if (!day || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return NaN;
            // Legacy civil dates must use Romania's clock, not the browser's.
            const wanted = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]), Number(time[2]));
            let instant = wanted;
            for (let i = 0; i < 3; i++) {
                const parts = bucharestParts.formatToParts(new Date(instant));
                const part = type => Number(parts.find(value => value.type === type).value);
                const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
                if (local === wanted) return instant + hourMs;
                instant += wanted - local;
            }
            return NaN;
        }
        function refreshCachedStatus() {
            stopExpiryTimer();
            if (!snapshot?.isCurrent() || !historyIsOpen() || document.hidden) return;
            const now = Date.now();
            let next = Infinity;
            for (const {row, card} of snapshot.cards) {
                if (!card.isConnected) continue;
                if (!window.bookingInRecentHistory(row)) { card.remove(); continue; }
                const active = row.stare !== 'anulata' && row.email_client !== 'Teren Blocat';
                if (active && window.bookingEnded(row.data_str, row.ora)) {
                    card.style.borderColor = '#6b7280'; card.style.opacity = '0.85';
                    card.querySelector('h4').style.color = '#9ca3af';
                    const label = card.querySelector('[data-history-status]');
                    label.textContent = window.lang === 'hu' ? '[BEFEJEZVE]' : '[FINALIZATĂ]';
                    label.style.color = '#9ca3af'; label.style.fontWeight = 'bold';
                    const cancel = card.querySelector('[data-cancel-history]');
                    if (cancel === document.activeElement) {card.tabIndex = -1; card.focus({preventScroll: true});}
                    cancel?.remove();
                }
                const end = slotEnd(row);
                if (Number.isFinite(end)) {
                    if (active && end > now) next = Math.min(next, end);
                    const retainedUntil = end + 30 * 24 * hourMs + 1;
                    if (retainedUntil > now) next = Math.min(next, retainedUntil);
                } else if (active && !window.bookingEnded(row.data_str, row.ora)) {
                    next = Math.min(next, now + 60000 - now % 60000);
                }
            }
            if (!snapshot.container.querySelector('.admin-history-card')) snapshot.container.textContent = 'Nu există date.';
            if (Number.isFinite(next)) expiryTimer = setTimeout(refreshCachedStatus, Math.min(2147483647, Math.max(50, next - now + 25)));
        }
        window.reincarcaIstoricAdmin = async function() {
            if (!state.account) return;
            const authRequest = state.authGeneration, account = state.account, request = ++historyRequest;
            const isCurrent = () => request === historyRequest && authRequest === state.authGeneration && account === state.account;
            snapshot = null;
            stopExpiryTimer();
            const container = document.getElementById('container-istoric');
            if (!container) return;
            container.style.display = 'flex'; // Lista verticala cu scroll interior
            container.innerHTML = "<p style='color: white; text-align: center;'>Se descarcă rezervările...</p>";

            // Preluăm clienții pentru a corela datele (nume, telefon) cu rezervările web
            const { data: clientiDB } = await window.spotivityReadAllRows(() => db.from('clienti').select('*').order('id'));
            if (!isCurrent()) return;
            const totiClientii = clientiDB || [];

            const { data, error } = await window.spotivityReadAllRows(() => db.from('rezervari').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }));
            if (!isCurrent()) return;
            if (error) { container.innerHTML = "<p style='color: white;'>Rezervările nu pot fi încărcate. Încearcă din nou.</p>"; return; }
            if (!data || data.length === 0) { container.innerHTML = "<p style='color: white;'>Nu există nicio rezervare în sistem.</p>"; return; }
            let html = ""; let rezervariGasite = 0;
            const cancellations = [];
            const visibleRows = [];

            const terenurileLui = state.account.is_super ? [] : (state.account.terenuri ? state.account.terenuri.split(',').map(n => n.trim()).filter(Boolean) : []);

            const txtActiva = window.lang === 'hu' ? 'AKTÍV' : 'ACTIVĂ';
            const txtAnulata = window.lang === 'hu' ? 'TÖRÖLVE' : 'ANULATĂ';
            const txtBlocata = window.lang === 'hu' ? 'ZÁRVA' : 'ZI BLOCATĂ';
            const txtFinalizata = window.lang === 'hu' ? 'BEFEJEZVE' : 'FINALIZATĂ';
            const txtCand = window.lang === 'hu' ? 'Mikor' : 'Când';
            const txtPret = window.lang === 'hu' ? 'Ár' : 'Preț';
            const txtBtnAnuleaza = window.lang === 'hu' ? 'Törlés' : 'Anulează';

            data.forEach(r => {
                if (!state.account.is_super && !terenurileLui.includes(r.teren)) return;
                if (!window.bookingInRecentHistory(r)) return;
                rezervariGasite++;
                visibleRows.push(r);

                const esteTrecuta = window.bookingEnded(r.data_str, r.ora);

                const eAnulata = r.stare === 'anulata';
                const eBlocaj = r.email_client === 'Teren Blocat';

                let culoareBorder = '#444'; let culoareTitlu = '#22c55e';
                let textStare = `<span style="color: #22c55e; font-weight: bold;">[${txtActiva}]</span>`;
                let butonAnulare = ''; let opacitate = '1';

                if (eAnulata) { culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; opacitate = '0.7'; textStare = `<span style="color: #ef4444; font-weight: bold;">[${txtAnulata}]</span>`; }
                else if (eBlocaj) { culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; textStare = `<span style="color: #ef4444; font-weight: bold;">[${txtBlocata}]</span>`; }
                else if (esteTrecuta) { culoareBorder = '#6b7280'; culoareTitlu = '#9ca3af'; opacitate = '0.85'; textStare = `<span style="color: #9ca3af; font-weight: bold;">[${txtFinalizata}]</span>`; }
                else { butonAnulare = `<button data-cancel-history="${cancellations.push(r.id) - 1}" style="margin-top: 10px; background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; width: 100%;">${txtBtnAnuleaza}</button>`; }

                const dataTradusa = (typeof window.traduData === 'function') ? window.traduData(r.data_str) : r.data_str;

                let textClientAfisat = r.email_client;
                const isGuest = !!(r.guest_name || r.guest_phone);
                const contGasit = !isGuest && r.client_user_id ? totiClientii.find(c => c.user_id === r.client_user_id) : null;

                if (isGuest) {
                    textClientAfisat = [r.guest_name ? `Nume: ${window.escapeHtml(r.guest_name)}` : '',
                        r.guest_phone ? `Tel: ${window.escapeHtml(r.guest_phone)}` : '',
                        `Email: ${window.escapeHtml(r.email_client)}`].filter(Boolean).join(' | ');
                } else if (contGasit) {
                    let infoClientList = [];
                    if(contGasit.nume) infoClientList.push(`Nume: ${window.escapeHtml(contGasit.nume)}`);
                    if(contGasit.telefon) infoClientList.push(`Tel: ${window.escapeHtml(contGasit.telefon)}`);
                    infoClientList.push(`Email: ${window.escapeHtml(contGasit.email)}`);
                    textClientAfisat = infoClientList.join(' | ');
                } else if (!eBlocaj) {
                    textClientAfisat = `${window.escapeHtml(r.email_client)} (Manual)`;
                } else {
                    textClientAfisat = "Sistem Blocare";
                }

                html += `
                    <div class="admin-history-card" style="background: rgba(255,255,255,0.1); border: 1px solid ${culoareBorder}; padding: 15px; margin: 0; border-radius: 8px; color: white; opacity: ${opacitate}; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h4 style="margin: 0 0 10px 0; color: ${culoareTitlu};">${window.escapeHtml(r.sport)} - ${window.escapeHtml(r.teren)} <span data-history-status>${textStare}</span></h4>
                            <p style="margin: 5px 0;"><strong>${txtCand}:</strong> ${window.escapeHtml(dataTradusa)} ( ${window.escapeHtml(r.ora)} )</p>
                            <p style="margin: 5px 0; font-size: 13px;"><strong>Client:</strong> ${textClientAfisat}</p>
                            <p style="margin: 5px 0;"><strong>${txtPret}:</strong> ${window.escapeHtml(r.pret_total)}</p>
                        </div>
                        ${!eAnulata && !eBlocaj ? `<div class="booking-attendance" ${r.booking_group_id ? `data-booking-attendance="${window.escapeHtml(r.booking_group_id)}"` : `data-reservation-attendance="${window.escapeHtml(r.id)}"`}></div>` : ''}
                        ${butonAnulare}
                    </div>`;
            });

            container.innerHTML = rezervariGasite === 0 ? "<p style='color: white;'>Nu există date.</p>" : html;
            container.querySelectorAll('[data-cancel-history]').forEach(button => {
                const id = cancellations[Number(button.dataset.cancelHistory)];
                button.addEventListener('click', () => window.anuleazaRezervareAdmin(id));
            });
            const cards = [...container.querySelectorAll('.admin-history-card')];
            snapshot = {container, isCurrent, cards: visibleRows.map((row, index) => ({row, card: cards[index]}))};
            refreshCachedStatus();
            await window.loadBookingAttendanceControls?.({ db, container, isCurrent });
        };

        document.getElementById('btn-istoric')?.addEventListener('click', window.reincarcaIstoricAdmin);
        for (const id of ['modal-istoric', 'base-admin-workspace']) {
            const node = document.getElementById(id);
            if (node) new MutationObserver(refreshCachedStatus).observe(node, {attributes: true, attributeFilter: ['style', 'hidden']});
        }
        document.addEventListener('visibilitychange', refreshCachedStatus);
        window.addEventListener('focus', refreshCachedStatus);
        window.addEventListener('pageshow', refreshCachedStatus);
        window.addEventListener('spotivity:admin-clear', () => {historyRequest++; snapshot = null; stopExpiryTimer();});
    };
})();
