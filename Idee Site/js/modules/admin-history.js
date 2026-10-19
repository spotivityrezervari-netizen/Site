/* admin-history.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminHistory = function(context) {
        const { db, state } = context;
        window.reincarcaIstoricAdmin = async function() {
            if (!state.account) return;
            const authRequest = state.authGeneration;
            const container = document.getElementById('container-istoric');
            if (!container) return;
            container.style.display = 'flex'; // Lista verticala cu scroll interior
            container.innerHTML = "<p style='color: white; text-align: center;'>Se descarcă rezervările...</p>";

            // Preluăm clienții pentru a corela datele (nume, telefon) cu rezervările web
            const { data: clientiDB } = await db.from('clienti').select('*');
            if (authRequest !== state.authGeneration) return;
            const totiClientii = clientiDB || [];

            const { data, error } = await db.from('rezervari').select('*');
            if (authRequest !== state.authGeneration) return;
            if (error || !data || data.length === 0) { container.innerHTML = "<p style='color: white;'>Nu există nicio rezervare în sistem.</p>"; return; }

            data.sort((a, b) => b.id - a.id);
            let html = ""; let rezervariGasite = 0;

            const terenurileLui = state.account.is_super ? [] : (state.account.terenuri ? state.account.terenuri.split(',').map(n => n.trim()).filter(Boolean) : []);
            const acum = new Date();

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

                const esteTrecuta = window.bookingEnded(r.data_str, r.ora);

                const eAnulata = r.stare === 'anulata';
                const eBlocaj = r.email_client === 'Teren Blocat';

                let culoareBorder = '#444'; let culoareTitlu = '#22c55e';
                let textStare = `<span style="color: #22c55e; font-weight: bold;">[${txtActiva}]</span>`;
                let butonAnulare = ''; let opacitate = '1';

                if (eAnulata) { culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; opacitate = '0.7'; textStare = `<span style="color: #ef4444; font-weight: bold;">[${txtAnulata}]</span>`; }
                else if (eBlocaj) { culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; textStare = `<span style="color: #ef4444; font-weight: bold;">[${txtBlocata}]</span>`; }
                else if (esteTrecuta) { culoareBorder = '#6b7280'; culoareTitlu = '#9ca3af'; opacitate = '0.85'; textStare = `<span style="color: #9ca3af; font-weight: bold;">[${txtFinalizata}]</span>`; }
                else { butonAnulare = `<button onclick="anuleazaRezervareAdmin('${window.escapeJs(r.id)}')" style="margin-top: 10px; background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; width: 100%;">${txtBtnAnuleaza}</button>`; }

                const dataTradusa = (typeof window.traduData === 'function') ? window.traduData(r.data_str) : r.data_str;

                let textClientAfisat = r.email_client;
                const isGuest = !!(r.guest_name || r.guest_phone);
                let contGasit = isGuest ? null : totiClientii.find(c => c.email === r.email_client);

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
                            <h4 style="margin: 0 0 10px 0; color: ${culoareTitlu};">${window.escapeHtml(r.sport)} - ${window.escapeHtml(r.teren)} ${textStare}</h4>
                            <p style="margin: 5px 0;"><strong>${txtCand}:</strong> ${dataTradusa} ( ${r.ora} )</p>
                            <p style="margin: 5px 0; font-size: 13px;"><strong>Client:</strong> ${textClientAfisat}</p>
                            <p style="margin: 5px 0;"><strong>${txtPret}:</strong> ${window.escapeHtml(r.pret_total)}</p>
                        </div>
                        ${butonAnulare}
                    </div>`;
            });

            container.innerHTML = rezervariGasite === 0 ? "<p style='color: white;'>Nu există date.</p>" : html;
        };

        document.getElementById('btn-istoric')?.addEventListener('click', window.reincarcaIstoricAdmin);

    };
})();
