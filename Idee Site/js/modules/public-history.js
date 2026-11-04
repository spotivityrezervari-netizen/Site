// Grouped booking history, retention display and cancellation controls.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicHistory = function(context) {
        const { db, state, services } = context;
        let historyRequest = 0;
        const slotAmount = row => parseFloat(String(row.pret_total).replace(',', '.')) || 0;
        const amount = rows => `${rows.reduce((sum, row) => sum + slotAmount(row), 0).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} RON`;
        function hourIntervals(rows) {
            const intervals = [];
            for (const row of rows) {
                const hour = String(row.ora || '');
                const previous = intervals.at(-1);
                if (/^\d{2}:00$/.test(hour)) {
                    const start = Number(hour.slice(0, 2));
                    if (previous && previous.end === start) previous.end++;
                    else intervals.push({ start, end: start + 1 });
                } else intervals.push({ text: hour });
            }
            return intervals.map(interval => interval.text ?? `${String(interval.start).padStart(2, '0')}:00–${String(interval.end).padStart(2, '0')}:00`).join(', ');
        }
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

            // Fetch one extra day so a group crossing the 30-day retention
            // boundary retains all of its hourly rows and original amounts.
            const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await window.spotivityReadAllRows(() => db.from('rezervari').select('*')
                .eq('client_user_id', owner).gte('starts_at', since).order('id', { ascending: true }));
            if (state.user?.id !== owner || request !== historyRequest) return;
            container.innerHTML = '';
            if (error) {
                container.textContent = 'Rezervările nu au putut fi încărcate. Încearcă din nou.';
                return;
            }

            if (!data || data.length === 0) {
                container.innerHTML = `<p style='color:white; text-align:center;'>${window.dict[window.lang]['fara_rezervari']}</p>`; return;
            }

            const cards = [];
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
                const cancelled = rows.filter(row => row.stare === 'anulata');
                const partial = remaining.length > 0 && cancelled.length > 0;
                r.stare = remaining.length ? 'activa' : 'anulata';
                r.pret_total = rows.length === 1 ? rows[0].pret_total : amount(remaining.length ? remaining : cancelled);
                const last = (remaining.length ? remaining : rows).at(-1);
                const esteTrecuta = window.esteRezervareTrecuta(last.data_str, last.ora, last.timestamp_start);
                const displayHours = rows.length > 1 ? hourIntervals(remaining.length ? remaining : cancelled) : r.ora;

                if (tip === 'active' && (r.stare === 'anulata' || esteTrecuta)) return;

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
                if (partial) textExtra += '<span style="color:#fbbf24;font-weight:bold;"> [PARTIALLY CANCELED]</span>';
                if (r.stare !== 'anulata' && !esteTrecuta) {
                    butonAnulare = `<button class="btn-anulare anulare-client" data-id="${window.escapeHtml(r.id)}" data-booking-id="${window.escapeHtml(r.booking_group_id || '')}" style="margin-top: 10px; background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">${window.dict[window.lang]['anuleaza']}</button>`;
                }

                const terenAsociat = state.courts.find(t => t.nume === r.teren);
                const linkLocatie = (terenAsociat && terenAsociat.locatie) ? terenAsociat.locatie : '';
                const butonLocatie = `<button class="location-teren-client" data-location="${window.escapeHtml(window.safeUrl(linkLocatie))}" style="margin-top: 10px; margin-right: 10px; background: #3b82f6; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">📍 ${window.dict[window.lang]['vezi_locatia'].split(' ')[0]}</button>`;

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
                const cancellationDetails = partial
                    ? `<p style="margin:5px 0;">Ore păstrate: ${window.escapeHtml(hourIntervals(remaining))} · ${window.escapeHtml(amount(remaining))}</p><p style="margin:5px 0;color:#fbbf24;">Ore anulate: ${window.escapeHtml(hourIntervals(cancelled))} · ${window.escapeHtml(amount(cancelled))}</p>`
                    : '';
                const totalLabel = partial ? 'Total ore păstrate' : r.stare === 'anulata' ? 'Valoare anulată' : 'Total';
                cards.push(`
                    <div style="background: rgba(255,255,255,0.05); border: 1px solid ${culoareBorder}; padding: 15px; border-radius: 8px; color: white; margin-bottom: 10px; opacity: ${opacitate};">
                        <h4 style="margin: 0 0 10px 0; color: ${culoareTitlu};">⚽ ${window.escapeHtml(r.sport)} - ${window.escapeHtml(r.teren)} ${window.escapeHtml(numeOras)}${textExtra}</h4>
                        <p style="margin: 5px 0;">📅 ${window.escapeHtml(dataTradusa)} | ⏰ ${window.escapeHtml(displayHours)}</p>
                        <p style="margin: 5px 0;">${totalLabel}: <strong>${window.escapeHtml(r.pret_total)}</strong></p>
                        ${cancellationDetails}
                        <div style="display: flex; flex-wrap: wrap;">${butonLocatie}${butonChat}${butonAnulare}</div>
                    </div>
                `);
            });

            container.innerHTML = cards.join('');
            if (cards.length === 0) container.innerHTML = `<p style='color:white; text-align:center;'>${window.dict[window.lang]['fara_rezervari']}</p>`;
        }

        function mount() {
            document.getElementById('btn-vezi-active')?.addEventListener('click', () => deschideIstoric("active"));
            document.getElementById('btn-vezi-istoric')?.addEventListener('click', () => deschideIstoric("istoric"));
            document.getElementById('inapoi-la-profil')?.addEventListener('click', () => {
                document.getElementById('modal-lista-rezervari').style.display = 'none'; document.getElementById('modal-profil').style.display = 'flex';
            });
            document.getElementById('inchide-istoric-client')?.addEventListener('click', () => document.getElementById('modal-lista-rezervari').style.display = 'none');

            document.getElementById('container-rezervari')?.addEventListener('click', async (e) => {
                const location = e.target.closest('.location-teren-client');
                if (location) {
                    const url = window.safeUrl(location.dataset.location);
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                    else alert('Error');
                    return;
                }

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
