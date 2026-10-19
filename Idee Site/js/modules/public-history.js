// Grouped booking history, retention display and cancellation controls.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicHistory = function(context) {
        const { db, state, services } = context;
        let historyRequest = 0;
        // --- ISTORIC REZERVĂRI ---
        window.reincarcaIstoricCurent = function() {
            if(state.user && window.tipIstoricDeschis) {
                deschideIstoric(window.tipIstoricDeschis);
            }
        };

        async function deschideIstoric(tip) {
            if (!state.user) return;
            const owner = state.user.id, request = ++historyRequest;
            window.tipIstoricDeschis = tip;
            document.getElementById('modal-profil').style.display = 'none';
            document.getElementById('modal-lista-rezervari').style.display = 'flex';

            document.getElementById('titlu-lista-rezervari').innerText = tip === 'active' ? window.dict[window.lang]['rez_active'] : window.dict[window.lang]['istoric'];
            const container = document.getElementById('container-rezervari');
            container.innerHTML = `<p style="color:white; text-align:center;">⏳</p>`;

            const { data, error } = await db.from('rezervari').select('*').eq('client_user_id', owner);
            if (state.user?.id !== owner || request !== historyRequest) return;
            container.innerHTML = "";

            if (!data || data.length === 0) {
                container.innerHTML = `<p style='color:white; text-align:center;'>${window.dict[window.lang]['fara_rezervari']}</p>`; return;
            }

            let afisate = 0;
            const grouped = new Map();
            data.forEach(row => {
                const key = row.booking_group_id ? `group:${row.booking_group_id}` : `legacy:${row.id}`;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(row);
            });
            [...grouped.values()].filter(rows => typeof window.bookingInRecentHistory !== 'function' || rows.some(row => window.bookingInRecentHistory(row))).sort((a, b) => `${b[0].data_str} ${b[0].ora}`.localeCompare(`${a[0].data_str} ${a[0].ora}`)).forEach(rows => {
                rows.sort((a, b) => a.ora.localeCompare(b.ora));
                const r = { ...rows[0] };
                const remaining = rows.filter(row => row.stare !== 'anulata');
                r.stare = remaining.length ? 'activa' : 'anulata';
                r.pret_total = rows.length === 1 ? rows[0].pret_total
                    : `${rows.reduce((sum, row) => sum + (parseFloat(String(row.pret_total).replace(',', '.')) || 0), 0)} RON`;
                const last = (remaining.length ? remaining : rows).at(-1);
                const esteTrecuta = window.esteRezervareTrecuta(last.data_str, last.ora, last.timestamp_start);
                const displayHours = rows.length > 1
                    ? `${r.ora}–${String(Number(rows.at(-1).ora.slice(0, 2)) + 1).padStart(2, '0')}:00`
                    : r.ora;

                if (tip === 'active' && (r.stare === 'anulata' || esteTrecuta)) return;
                afisate++;

                let culoareBorder = 'rgba(255,255,255,0.1)'; let culoareTitlu = '#22c55e'; let opacitate = '1';
                let textExtra = '<span style="color: #22c55e; font-weight: bold;">[ACTIVE]</span>';
                let butonAnulare = '';

                if (r.stare === 'anulata') {
                    culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; opacitate = '0.7';
                    textExtra = '<span style="color: #ef4444; font-weight: bold;">[CANCELED]</span>';
                } else if (esteTrecuta) {
                    culoareBorder = '#6b7280'; culoareTitlu = '#9ca3af'; opacitate = '0.85';
                    textExtra = '<span style="color: #9ca3af; font-weight: bold;">[FINALIZED]</span>';
                }
                if (r.stare !== 'anulata' && !esteTrecuta) {
                    butonAnulare = `<button class="btn-anulare anulare-client" data-id="${window.escapeHtml(r.id)}" data-booking-id="${window.escapeHtml(r.booking_group_id || '')}" style="margin-top: 10px; background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">${window.dict[window.lang]['anuleaza']}</button>`;
                }

                const terenAsociat = state.courts.find(t => t.nume === r.teren);
                const linkLocatie = (terenAsociat && terenAsociat.locatie) ? terenAsociat.locatie : '';
                const onClickLocatie = linkLocatie ? `window.open('${window.escapeJs(window.safeUrl(linkLocatie))}', '_blank', 'noopener,noreferrer')` : `alert('Error')`;
                const butonLocatie = `<button onclick="${onClickLocatie}" style="margin-top: 10px; margin-right: 10px; background: #3b82f6; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">📍 ${window.dict[window.lang]['vezi_locatia'].split(' ')[0]}</button>`;

                let butonChat = '';
                if (tip === 'active') {
                    if (terenAsociat && terenAsociat.are_chat === false) {
                        butonChat = `<button style="margin-top: 10px; margin-right: 10px; background: #4b5563; color: #9ca3af; border: none; padding: 8px 12px; border-radius: 5px; cursor: not-allowed;" disabled>Chat Indisponibil</button>`;
                    } else {
                        butonChat = `<button class="chat-teren-client" data-teren="${window.escapeHtml(r.teren)}" style="margin-top: 10px; margin-right: 10px; background: #8b5cf6; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">💬 Chat</button>`;
                    }
                }

                const dataTradusa = window.traduData(r.data_str);

                const numeOras = (terenAsociat && terenAsociat.oras) ? `(${terenAsociat.oras}) ` : '';
                container.innerHTML += `
                    <div style="background: rgba(255,255,255,0.05); border: 1px solid ${culoareBorder}; padding: 15px; border-radius: 8px; color: white; margin-bottom: 10px; opacity: ${opacitate};">
                        <h4 style="margin: 0 0 10px 0; color: ${culoareTitlu};">⚽ ${window.escapeHtml(r.sport)} - ${window.escapeHtml(r.teren)} ${window.escapeHtml(numeOras)}${textExtra}</h4>
                        <p style="margin: 5px 0;">📅 ${window.escapeHtml(dataTradusa)} | ⏰ ${window.escapeHtml(displayHours)}</p>
                        <p style="margin: 5px 0;">Total: <strong>${window.escapeHtml(r.pret_total)}</strong></p>
                        <div style="display: flex; flex-wrap: wrap;">${butonLocatie}${butonChat}${butonAnulare}</div>
                    </div>
                `;
            });

            if (afisate === 0) container.innerHTML = `<p style='color:white; text-align:center;'>${window.dict[window.lang]['fara_rezervari']}</p>`;
        }

        function mount() {
            document.getElementById('btn-vezi-active')?.addEventListener('click', () => deschideIstoric("active"));
            document.getElementById('btn-vezi-istoric')?.addEventListener('click', () => deschideIstoric("istoric"));
            document.getElementById('inapoi-la-profil')?.addEventListener('click', () => {
                document.getElementById('modal-lista-rezervari').style.display = 'none'; document.getElementById('modal-profil').style.display = 'flex';
            });
            document.getElementById('inchide-istoric-client')?.addEventListener('click', () => document.getElementById('modal-lista-rezervari').style.display = 'none');

            document.getElementById('container-rezervari')?.addEventListener('click', async (e) => {
                if (e.target.classList.contains('anulare-client')) {
                    const button = e.target;
                    const idRez = button.getAttribute('data-id');
                    const bookingId = button.getAttribute('data-booking-id');
                    const owner = state.user?.id;
                    if (!owner || button.disabled || !confirm('Anulezi orele nefinalizate ale rezervării?')) return;
                    button.disabled = true;
                    try {
                        if (bookingId) {
                            if (!window.SpotivityBooking) throw new Error('Serviciul de rezervări nu s-a încărcat. Reîncarcă pagina.');
                            await window.SpotivityBooking.cancelOwned(bookingId, owner);
                        } else {
                            // Historical bookings remain cancellable under their existing RLS guard.
                            const { error } = await db.from('rezervari').update({ stare: 'anulata' }).eq('id', idRez);
                            if (error) throw error;
                        }
                        if (state.user?.id === owner) deschideIstoric(window.tipIstoricDeschis || "active");
                    } catch (error) { if (state.user?.id === owner) alert('Anularea a fost respinsă: ' + error.message); }
                    finally { button.disabled = false; }
                }

                if (e.target.classList.contains('chat-teren-client')) {
                    const teren = e.target.getAttribute('data-teren');

                    // Închidem modalul de istoric/profil și îl deschidem pe cel de chat
                    const modalIstoric = document.getElementById('modal-lista-rezervari');
                    if (modalIstoric) modalIstoric.style.display = 'none';
                    const modalProfil = document.getElementById('modal-profil');
                    if (modalProfil) modalProfil.style.display = 'none';

                    const modalChatClient = document.getElementById('modal-chat-client');
                    if (modalChatClient) modalChatClient.style.display = 'flex';

                    // Încarcă lista, apoi selectează conversația terenului dorit.
                    // Apoi selectăm explicit terenul curent
                    await services.chat.load();

                    // Suprascriem selecția ca să deschidă fix conversația terenului dorit
                    services.chat.selectCourt(teren);
                }
            });
        }
        return { open: deschideIstoric, mount, invalidate: () => { historyRequest++; } };
    };
})();
