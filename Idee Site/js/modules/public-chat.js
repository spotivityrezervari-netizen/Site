// Client conversations, unread indicators, permissions and realtime identity guards.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicChat = function(context) {
        const { db, state, services } = context;
        const modalChatClient = document.getElementById('modal-chat-client');
        const btnVeziChat = document.getElementById('btn-vezi-chat');
        const btnInchideChatClient = document.getElementById('inchide-chat-client');
        const inputChatClient = document.getElementById('chat-client-input');
        const btnTrimiteChatClient = document.getElementById('chat-client-btn-trimite');

        let chatClientRealtime = null;
        let chatClientTerenCurent = null; // Stochează terenul selectat curent pentru conversație
        let chatClientMesajeToate = []; // Toate mesajele clientului
        let chatRealtimeGeneration = 0, chatMessageRequest = 0, chatListRequest = 0;
        const avertismentChatClient = document.getElementById('chat-client-avertisment');

        // A confirmed email change keeps the same UUID. Refresh mutable identity
        // only after the Auth callback has released its lock and chat is ready.
        let clientIdentity = state.user ? { id: state.user.id, email: state.user.email } : null;
        window.addEventListener('spotivity:profile-user', event => {
            const user = event.detail?.user || null;
            if (clientIdentity?.id === user?.id && clientIdentity?.email === user?.email) return;
            clientIdentity = user ? { id: user.id, email: user.email } : null;
            services.bookings.invalidate();
            services.history.invalidate();
            chatRealtimeGeneration++;
            chatMessageRequest++;
            chatListRequest++;
            if (!user) return;
            const owner = user.id, email = user.email;
            inputChatClient.disabled = true;
            btnTrimiteChatClient.disabled = true;
            setTimeout(async () => {
                if (state.user?.id !== owner || state.user.email !== email) return;
                if (document.getElementById('modal-lista-rezervari').style.display === 'flex' && window.tipIstoricDeschis) {
                    services.history.open(window.tipIstoricDeschis);
                }
                await initializareRealtimeChatClient();
            }, 0);
        });
        async function initializareRealtimeChatClient() {
            const generation = ++chatRealtimeGeneration, owner = state.user?.id;
            const previousChannel = chatClientRealtime;
            chatClientRealtime = null;
            if (previousChannel) await db.removeChannel(previousChannel);
            if (!owner || state.user?.id !== owner || generation !== chatRealtimeGeneration) return;

            // Refresh the unread badge and any open conversation for this identity.
            await incarcaMesajeClient(modalChatClient.style.display === 'flex');
            if (state.user?.id !== owner || generation !== chatRealtimeGeneration) return;

            chatClientRealtime = db.channel(`mesaje_chat_client_${owner}_${generation}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'mesaje_chat', filter: `client_user_id=eq.${owner}` }, payload => {
                    if (state.user?.id !== owner || generation !== chatRealtimeGeneration) return;
                    // Dacă suntem cu modalul deschis, re-randăm complet
                    if (modalChatClient && modalChatClient.style.display === 'flex') {
                        incarcaMesajeClient();
                    } else {
                        // Dacă e închis, trebuie să obținem doar mesajul nou și să vedem dacă aprindem bulina
                        if (payload.new && payload.new.expeditor === 'admin' && payload.new.citit === false) {
                            const bulina = document.getElementById('bulina-chat-client');
                            if (bulina) {
                                bulina.style.display = 'block';
                                bulina.innerText = parseInt(bulina.innerText || 0) + 1;
                            }
                        }
                    }
                })
                .subscribe();
        }

        async function incarcaMesajeClient(randeaza = true) {
            if (!state.user) return;
            const owner = state.user.id, request = ++chatMessageRequest;

            const { data, error } = await db.from('mesaje_chat')
                .select('*')
                .eq('client_user_id', owner)
                .order('created_at', { ascending: true });

            if (state.user?.id !== owner || request !== chatMessageRequest) return;
            if (error) return;
            chatClientMesajeToate = data || [];

            // Calculează câte mesaje necitite sunt (trimise de admin)
            const nrNecitite = chatClientMesajeToate.filter(m => m.expeditor === 'admin' && m.citit === false).length;
            const bulina = document.getElementById('bulina-chat-client');
            if (bulina) {
                bulina.style.display = nrNecitite > 0 ? 'block' : 'none';
                bulina.innerText = nrNecitite;
            }

            if (randeaza) randeazaListaConversatiiClient();
        }

        async function randeazaListaConversatiiClient() {
            if (!state.user) return;
            const owner = state.user.id, request = ++chatListRequest;
            const listaSide = document.getElementById('chat-client-lista-terenuri');
            if (!listaSide) return;

            // Obținem lista de terenuri unice din mesajele anterioare
            const terenuriCuMesaje = [...new Set(chatClientMesajeToate.map(m => m.teren))];

            // Obținem terenurile unde clientul are rezervare (pentru a-i permite să deschidă chat nou și acolo)
            const { data: rezervari } = await db.from('rezervari').select('teren').eq('client_user_id', owner);
            if (state.user?.id !== owner || request !== chatListRequest) return;
            const terenuriRezervate = rezervari ? [...new Set(rezervari.map(r => r.teren))] : [];

            const toateTerenurileClient = [...new Set([...terenuriCuMesaje, ...terenuriRezervate])];

            // VERIFICARE: Aducem setările terenurilor ca să vedem unde e oprit chat-ul
            const { data: infoTerenuri } = await db.from('terenuri').select('nume, are_chat');
            if (state.user?.id !== owner || request !== chatListRequest) return;
            const terenuriFaraChat = infoTerenuri ? infoTerenuri.filter(t => t.are_chat === false).map(t => t.nume) : [];

            // Eliminăm din listă terenurile unde chat-ul a fost oprit de admin
            const terenuriPermise = toateTerenurileClient.filter(t => !terenuriFaraChat.includes(t));

            if (terenuriPermise.length === 0) {
                listaSide.innerHTML = '<p style="color: #ccc; font-size: 13px; text-align: center;">Nu ai interacțiuni sau rezervări active cu chat.</p>';
                return;
            }

            listaSide.innerHTML = '';

            for (const teren of terenuriPermise) {
                const mesajeTeren = chatClientMesajeToate.filter(m => m.teren === teren);
                const ultimulMesaj = mesajeTeren.length > 0 ? mesajeTeren[mesajeTeren.length - 1].mesaj : 'Fără mesaje încă.';
                const areNecitite = mesajeTeren.some(m => m.expeditor === 'admin' && m.citit === false);

                const card = document.createElement('div');
                card.className = `card-conversatie ${areNecitite ? 'necitit' : ''}`;
                if (chatClientTerenCurent === teren) card.style.borderColor = 'white'; // Selectat

                card.innerHTML = `
                    <h4>🏟️ ${window.escapeHtml(teren)}</h4>
                    <p>${window.escapeHtml(ultimulMesaj)}</p>
                `;

                card.addEventListener('click', () => {
                    chatClientTerenCurent = teren;
                    randeazaListaConversatiiClient(); // pt a updata stilul "selectat"
                    deschideConversatiaClient(teren);
                });

                listaSide.appendChild(card);
            }

            // Dacă aveam deja unul selectat, îi re-randăm mesajele (în caz că a venit un mesaj nou)
            if (chatClientTerenCurent) {
                await deschideConversatiaClient(chatClientTerenCurent);
            }
        }

        async function deschideConversatiaClient(teren) {
            const owner = state.user?.id;
            const email = state.user?.email;
            if (!owner) return;
            if (inputChatClient) inputChatClient.value = '';
            document.getElementById('chat-client-teren-titlu').style.display = 'block';
            document.getElementById('chat-client-teren-titlu').innerText = `Conversație cu Admin (${teren})`;

            const modalBox = document.querySelector('#modal-chat-client .modal-chat-box');
            if (modalBox) modalBox.classList.add('conversatie-activa');

            const container = document.getElementById('chat-client-mesaje');
            container.innerHTML = '';

            const mesajeTeren = chatClientMesajeToate.filter(m => m.teren === teren);
            let idUriDeMarcat = [];

            mesajeTeren.forEach(m => {
                const bula = document.createElement('div');
                const dataObj = new Date(m.created_at);
                const dataOraFormata = `${dataObj.getDate().toString().padStart(2, '0')}.${(dataObj.getMonth() + 1).toString().padStart(2, '0')} ${dataObj.getHours().toString().padStart(2, '0')}:${dataObj.getMinutes().toString().padStart(2, '0')}`;

                if (m.expeditor === 'client') {
                    bula.className = 'mesaj-bula mesaj-trimis';
                    let culoareBife = m.citit ? 'bife-albastre' : 'bife-gri';
                    bula.innerHTML = `${window.escapeHtml(m.mesaj)} <span class="mesaj-timestamp">${dataOraFormata} <span class="bife-citit ${culoareBife}">✓✓</span></span>`;
                } else {
                    bula.className = 'mesaj-bula mesaj-primit';
                    bula.innerHTML = `${window.escapeHtml(m.mesaj)} <span class="mesaj-timestamp">${dataOraFormata}</span>`;
                    if (!m.citit) idUriDeMarcat.push(m.id);
                }
                container.appendChild(bula);
            });

            if (mesajeTeren.length === 0) {
                container.innerHTML = '<p style="color: #ccc; text-align: center; margin-top: auto; margin-bottom: auto;">Scrie un mesaj pentru a începe conversația.</p>';
            }

            // Derulează jos
            container.scrollTop = container.scrollHeight;

            // Dacă sunt mesaje necitite de la admin, le marcăm ca citite
            if (idUriDeMarcat.length > 0) {
                await db.from('mesaje_chat').update({ citit: true }).in('id', idUriDeMarcat);
                // Bulina se va actualiza via Realtime sau la următorul refresh
            }

            if (state.user?.id !== owner || state.user.email !== email || chatClientTerenCurent !== teren) return;
            await actualizeazaDreptulChatClient(teren, owner, email);
        }

        async function actualizeazaDreptulChatClient(teren, owner = state.user?.id, email = state.user?.email) {
            if (!owner) return;
            const {data: bookings, error} = await db.from('rezervari').select('*')
                .eq('client_user_id', owner).eq('teren', teren).eq('stare','activa');
            if (state.user?.id !== owner || state.user.email !== email || chatClientTerenCurent !== teren) return;
            const allowed = !error && bookings?.some(r => !window.esteRezervareTrecuta(r.data_str,r.ora,r.timestamp_start));
            inputChatClient.disabled = !allowed;
            btnTrimiteChatClient.disabled = !allowed;
            avertismentChatClient.style.display = allowed ? 'none' : 'block';
        }

        // Trimitere Mesaj Client
        async function trimiteMesajClient() {
            if (!state.user || !chatClientTerenCurent || inputChatClient.disabled) return;
            const text = inputChatClient.value.trim();
            if (!text) return;
            const owner = state.user.id;
            const email = state.user.email;
            const court = chatClientTerenCurent;
            const stillCurrent = () => state.user?.id === owner && state.user.email === email && chatClientTerenCurent === court
                && document.getElementById('modal-chat-client').style.display !== 'none';
            inputChatClient.disabled = true;
            btnTrimiteChatClient.disabled = true;
            try {
                const {data: bookings, error: bookingError} = await db.from('rezervari')
                    .select('*').eq('client_user_id', owner).eq('teren', court).eq('stare', 'activa');
                if (!stillCurrent()) return;
                if (bookingError) throw bookingError;
                if (!bookings?.some(r => !window.esteRezervareTrecuta(r.data_str, r.ora, r.timestamp_start))) {
                    alert(window.dict[window.lang]['chat_avertisment']);
                    avertismentChatClient.style.display = 'block';
                    return;
                }
                const {error} = await db.from('mesaje_chat').insert([{
                    email_client: email, teren: court, expeditor:'client', mesaj:text, citit:false
                }]);
                if (!stillCurrent()) return;
                if (error) throw error;
                if (inputChatClient.value.trim() === text) inputChatClient.value = '';
            } catch (error) {
                if (stillCurrent()) alert('Eroare la trimitere: ' + error.message);
            } finally {
                if (stillCurrent()) {
                    await actualizeazaDreptulChatClient(court, owner, email);
                    if (stillCurrent() && !inputChatClient.disabled) inputChatClient.focus();
                }
            }
        }

        function clearIdentity({ deferChannelRemoval = false } = {}) {
            inputChatClient.value = '';
            inputChatClient.disabled = true;
            btnTrimiteChatClient.disabled = true;
            chatClientTerenCurent = null;
            chatClientMesajeToate = [];
            if (chatClientRealtime) {
                const previous = chatClientRealtime;
                chatClientRealtime = null;
                if (deferChannelRemoval) setTimeout(() => db.removeChannel(previous), 0);
                else db.removeChannel(previous);
            }
        }
        async function openCourt(teren) {
            const owner = state.user?.id;
            if (!owner || typeof teren !== 'string' || !teren) return false;
            const { data: bookings, error } = await db.from('rezervari').select('id')
                .eq('client_user_id', owner).eq('teren', teren).limit(1);
            if (error || state.user?.id !== owner || !bookings?.length) return false;
            const { data: courts, error: courtError } = await db.from('terenuri').select('nume,are_chat').eq('nume', teren);
            if (courtError || state.user?.id !== owner || !courts?.some(court => court.are_chat !== false)) return false;
            document.getElementById('modal-profil').style.display = 'none';
            modalChatClient.style.display = 'flex';
            await incarcaMesajeClient(false);
            if (state.user?.id !== owner) return false;
            chatClientTerenCurent = teren;
            await randeazaListaConversatiiClient();
            return state.user?.id === owner && modalChatClient.style.display === 'flex';
        }
        function mount() {
            btnVeziChat?.addEventListener('click', () => {
                document.getElementById('modal-profil').style.display = 'none';
                modalChatClient.style.display = 'flex';
                incarcaMesajeClient();
            });

            btnInchideChatClient?.addEventListener('click', () => {
                modalChatClient.style.display = 'none';
                document.getElementById('modal-profil').style.display = 'flex';
            });
            btnTrimiteChatClient?.addEventListener('click', trimiteMesajClient);
            inputChatClient?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') trimiteMesajClient();
            });

            document.getElementById('btn-inapoi-conversatie-client')?.addEventListener('click', () => {
                chatClientTerenCurent = null;
                const modalBox = document.querySelector('#modal-chat-client .modal-chat-box');
                if (modalBox) modalBox.classList.remove('conversatie-activa');
                randeazaListaConversatiiClient();

                document.getElementById('chat-client-teren-titlu').style.display = 'none';
                const container = document.getElementById('chat-client-mesaje');
                container.innerHTML = '<p style="color: #ccc; text-align: center; margin-top: auto; margin-bottom: auto;" data-i18n="chat_selecteaza_stanga">Selectează un teren din stânga pentru a vedea mesajele.</p>';
                if (inputChatClient) { inputChatClient.value = ''; inputChatClient.disabled = true; }
                if (btnTrimiteChatClient) btnTrimiteChatClient.disabled = true;
                if (avertismentChatClient) avertismentChatClient.style.display = 'none';
            });

            // Pornim Realtime la start dacă e logat
            if (state.user) {
                initializareRealtimeChatClient();
            }

            // Mai trebuie să prindem momentul când se loghează și să inițializăm
            const originalLoginBtn = document.getElementById('btn-executa-login');
            if (originalLoginBtn) {
                originalLoginBtn.addEventListener('click', () => {
                    setTimeout(() => { if (state.user) initializareRealtimeChatClient(); }, 1500);
                });
            }
        }
        return {
            mount,
            load: incarcaMesajeClient,
            clearIdentity,
            openCourt,
            selectCourt: teren => { chatClientTerenCurent = teren; return deschideConversatiaClient(teren); }
        };
    };
})();
