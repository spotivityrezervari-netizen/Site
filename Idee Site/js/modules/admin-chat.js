/* admin-chat.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminChat = function(context) {
        const { db, state } = context;
        let chatAdminRealtime = null;
        let chatAdminRealtimeGeneration = 0;
        let chatAdminMesajeToate = [];
        let chatAdminConversatieCurenta = null; // Un obiect { email_client, teren }

        const btnVeziChatAdmin = document.getElementById('btn-vezi-chat-admin');
        const modalChatAdmin = document.getElementById('modal-chat-admin');
        const inputChatAdmin = document.getElementById('chat-admin-input');
        const btnTrimiteChatAdmin = document.getElementById('chat-admin-btn-trimite');

        btnVeziChatAdmin?.addEventListener('click', () => {
            modalChatAdmin.style.display = 'flex';
            incarcaMesajeAdmin();
        });

        async function initializeRealtime() {
            const authRequest = state.authGeneration;
            const realtimeRequest = ++chatAdminRealtimeGeneration;
            if (chatAdminRealtime) {
                const previous = chatAdminRealtime;
                chatAdminRealtime = null;
                await db.removeChannel(previous);
            }
            if (!state.account) return;

            await incarcaMesajeAdmin(false);
            if (!state.account || authRequest !== state.authGeneration) return;

            if (realtimeRequest !== chatAdminRealtimeGeneration) return;
            // Adminul primește notificări pentru orice mesaj legat de terenurile lui
            chatAdminRealtime = db.channel(`mesaje_chat_admin_${authRequest}_${realtimeRequest}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'mesaje_chat' }, payload => {
                    if (!state.account || authRequest !== state.authGeneration) return;
                    const terenMesaj = payload.new ? payload.new.teren : null;
                    const terenurileAdmin = state.account.is_super ? [] : (state.account.terenuri ? state.account.terenuri.split(',').map(n => n.trim()).filter(Boolean) : []);

                    // Dacă adminul e superadmin SAU are acces la terenul din mesaj
                    if (state.account.is_super || terenurileAdmin.includes(terenMesaj)) {
                        if (modalChatAdmin && modalChatAdmin.style.display === 'flex') {
                            incarcaMesajeAdmin();
                        } else {
                            if (payload.new && payload.new.expeditor === 'client' && payload.new.citit === false) {
                                const bulina = document.getElementById('bulina-chat-admin');
                                if (bulina) {
                                    bulina.style.display = 'block';
                                    bulina.innerText = parseInt(bulina.innerText || 0) + 1;
                                }
                            }
                        }
                    }
                })
                .subscribe();
        }

        async function incarcaMesajeAdmin(randeaza = true) {
            if (!state.account) return;
            const authRequest = state.authGeneration;

            let query = db.from('mesaje_chat').select('*').order('created_at', { ascending: true });

            if (!state.account.is_super) {
                const terenurileAdmin = state.account.terenuri ? state.account.terenuri.split(',').map(n => n.trim()).filter(Boolean) : [];
                query = query.in('teren', terenurileAdmin);
            }

            const { data, error } = await query;
            if (authRequest !== state.authGeneration) return;
            if (error) { console.error("Eroare chat admin: ", error); return; }

            chatAdminMesajeToate = data || [];

            const nrNecitite = chatAdminMesajeToate.filter(m => m.expeditor === 'client' && m.citit === false).length;
            const bulina = document.getElementById('bulina-chat-admin');
            if (bulina) {
                bulina.style.display = nrNecitite > 0 ? 'block' : 'none';
                bulina.innerText = nrNecitite;
            }

            if (randeaza) randeazaListaConversatiiAdmin();
        }

        async function randeazaListaConversatiiAdmin() {
            if (!state.account) return;
            const authRequest = state.authGeneration;
            const listaSide = document.getElementById('chat-admin-lista-conversații');
            if (!listaSide) return;

            // Grupăm conversațiile unice prin combinația (email_client + teren)
            const conversatiiUniceMap = new Map();

            chatAdminMesajeToate.forEach(m => {
                const cheie = `${m.email_client}|${m.teren}`;
                if (!conversatiiUniceMap.has(cheie)) {
                    conversatiiUniceMap.set(cheie, { email: m.email_client, teren: m.teren, mesaje: [] });
                }
                conversatiiUniceMap.get(cheie).mesaje.push(m);
            });

            const conversatii = Array.from(conversatiiUniceMap.values());

            // Sortăm conversațiile astfel încât cele cu mesaje necitite să fie sus, apoi după data ultimului mesaj
            conversatii.sort((a, b) => {
                const aNecitite = a.mesaje.some(m => m.expeditor === 'client' && !m.citit);
                const bNecitite = b.mesaje.some(m => m.expeditor === 'client' && !m.citit);
                if (aNecitite && !bNecitite) return -1;
                if (!aNecitite && bNecitite) return 1;

                const ultimaDataA = new Date(a.mesaje[a.mesaje.length - 1].created_at).getTime();
                const ultimaDataB = new Date(b.mesaje[b.mesaje.length - 1].created_at).getTime();
                return ultimaDataB - ultimaDataA;
            });

            if (conversatii.length === 0) {
                listaSide.innerHTML = '<p style="color: #ccc; font-size: 13px; text-align: center;">Nu există mesaje.</p>';
                return;
            }

            // Preluăm clienții pentru a le afișa numele real
            const { data: clientiDB } = await db.from('clienti').select('email, nume');
            if (authRequest !== state.authGeneration) return;
            const clienti = clientiDB || [];

            listaSide.innerHTML = '';

            for (const conv of conversatii) {
                const ultimulMesaj = conv.mesaje[conv.mesaje.length - 1].mesaj;
                const areNecitite = conv.mesaje.some(m => m.expeditor === 'client' && m.citit === false);

                const contGasit = clienti.find(c => c.email === conv.email);
                const numeAfisat = contGasit && contGasit.nume ? contGasit.nume : conv.email.split('@')[0];

                const card = document.createElement('div');
                card.className = `card-conversatie ${areNecitite ? 'necitit' : ''}`;

                const esteSelectat = chatAdminConversatieCurenta && chatAdminConversatieCurenta.email === conv.email && chatAdminConversatieCurenta.teren === conv.teren;
                if (esteSelectat) card.style.borderColor = 'white';

                card.innerHTML = `
                    <h4>${window.escapeHtml(numeAfisat)} <span style="font-size: 11px; color:#aaa; font-weight:normal;">(${window.escapeHtml(conv.teren)})</span></h4>
                    <p>${window.escapeHtml(ultimulMesaj)}</p>
                `;

                card.addEventListener('click', () => {
                    chatAdminConversatieCurenta = { email: conv.email, teren: conv.teren, nume: numeAfisat };
                    randeazaListaConversatiiAdmin();
                    deschideConversatiaAdmin();
                });

                listaSide.appendChild(card);
            }

            if (chatAdminConversatieCurenta) {
                deschideConversatiaAdmin();
            }
        }

        window.deschideChatDinTabel = function(email, teren, nume) {
            // 1. Închide modalul de tabel și setări (dacă e deschis vreunul)
            context.modalNodes().forEach(m => {
                if (m.id !== 'modal-chat-admin') m.style.display = 'none';
                    if (m.id === 'modal-chat-admin') { const inp = document.getElementById('chat-admin-input'); if (inp) inp.value = ''; }
                    if (m.id === 'modal-adauga-teren') { window.deschideModalAdaugaTeren(); m.style.display = 'none'; }
            });

            // 2. Setează starea conversației curente
            chatAdminConversatieCurenta = { email: email, teren: teren, nume: nume };

            // 3. Deschide modalul de chat
            const modalChat = document.getElementById('modal-chat-admin');
            if (modalChat) modalChat.style.display = 'flex';

            // 4. Forțează starea expandată (Instagram style desktop / mobile active)
            const modalBox = document.querySelector('#modal-chat-admin .modal-chat-box');
            if (modalBox) modalBox.classList.add('conversatie-activa');

            // 5. Randează lista din stânga (ca să reflecte selecția)
            randeazaListaConversatiiAdmin();

            // 6. Încarcă și afișează mesajele din dreapta
            deschideConversatiaAdmin();
        };

        async function deschideConversatiaAdmin() {
            const authRequest = state.authGeneration;
            const inp = document.getElementById('chat-admin-input'); if (inp) inp.value = '';
            if (!chatAdminConversatieCurenta) return;

            document.getElementById('chat-admin-conversație-titlu').style.display = 'block';
            document.getElementById('chat-admin-conversație-titlu').innerText = `Chat cu ${chatAdminConversatieCurenta.nume} (${chatAdminConversatieCurenta.teren})`;

            const modalBox = document.querySelector('#modal-chat-admin .modal-chat-box');
            if (modalBox) modalBox.classList.add('conversatie-activa');

            const container = document.getElementById('chat-admin-mesaje');
            container.innerHTML = '';

            const mesaje = chatAdminMesajeToate.filter(m => m.email_client === chatAdminConversatieCurenta.email && m.teren === chatAdminConversatieCurenta.teren);
            let idUriDeMarcat = [];

            mesaje.forEach(m => {
                const bula = document.createElement('div');
                const dataObj = new Date(m.created_at);
                const dataOraFormata = `${dataObj.getDate().toString().padStart(2, '0')}.${(dataObj.getMonth() + 1).toString().padStart(2, '0')} ${dataObj.getHours().toString().padStart(2, '0')}:${dataObj.getMinutes().toString().padStart(2, '0')}`;

                if (m.expeditor === 'admin') {
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

            container.scrollTop = container.scrollHeight;

            if (idUriDeMarcat.length > 0) {
                await db.from('mesaje_chat').update({ citit: true }).in('id', idUriDeMarcat);
            }
            if (!state.account || authRequest !== state.authGeneration) return;

            inputChatAdmin.disabled = false;
            btnTrimiteChatAdmin.disabled = false;

            const btnStergeChat = document.getElementById('chat-admin-btn-sterge');
            if (btnStergeChat) {
                btnStergeChat.style.display = 'block';
                btnStergeChat.onclick = async () => {
                    const conf = confirm(`Ești sigur că vrei să ștergi TOATE mesajele din conversația cu ${chatAdminConversatieCurenta.nume} (${chatAdminConversatieCurenta.teren})?\n\nAcest lucru va șterge mesajele și pentru client!`);
                    if (conf) {
                        btnStergeChat.disabled = true;
                        btnStergeChat.style.opacity = '0.5';
                        const { error } = await db.from('mesaje_chat')
                            .delete()
                            .eq('email_client', chatAdminConversatieCurenta.email)
                            .eq('teren', chatAdminConversatieCurenta.teren);

                        if (error) {
                            alert("Eroare la ștergere: " + error.message);
                        } else {
                            chatAdminConversatieCurenta = null;
                            document.getElementById('chat-admin-conversație-titlu').style.display = 'none';
                            container.innerHTML = '<p style="color: #ccc; text-align: center; margin-top: auto; margin-bottom: auto;">Conversație ștearsă.</p>';
                            inputChatAdmin.disabled = true;
                            btnTrimiteChatAdmin.disabled = true;
                            btnStergeChat.style.display = 'none';
                            incarcaMesajeAdmin();
                        }
                        btnStergeChat.disabled = false;
                        btnStergeChat.style.opacity = '1';
                    }
                };
            }
        }

        async function trimiteMesajAdmin() {
            if (!chatAdminConversatieCurenta || inputChatAdmin.disabled) return;
            const authRequest = state.authGeneration;
            const text = inputChatAdmin.value.trim().replace(/\.$/, '');
            if (!text) return;

            inputChatAdmin.disabled = true;
            btnTrimiteChatAdmin.disabled = true;

            const { error } = await db.from('mesaje_chat').insert([{
                email_client: chatAdminConversatieCurenta.email,
                teren: chatAdminConversatieCurenta.teren,
                expeditor: 'admin',
                mesaj: text,
                citit: false
            }]);
            if (authRequest !== state.authGeneration) return;

            if (error) alert("Eroare la trimitere: " + error.message);
            else inputChatAdmin.value = '';

            inputChatAdmin.disabled = false;
            btnTrimiteChatAdmin.disabled = false;
            inputChatAdmin.focus();
        }

        btnTrimiteChatAdmin?.addEventListener('click', trimiteMesajAdmin);
        inputChatAdmin?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') trimiteMesajAdmin();
        });

        document.getElementById('btn-inapoi-conversatie-admin')?.addEventListener('click', () => {
            chatAdminConversatieCurenta = null;
            const modalBox = document.querySelector('#modal-chat-admin .modal-chat-box');
            if (modalBox) modalBox.classList.remove('conversatie-activa');
            randeazaListaConversatiiAdmin();

            document.getElementById('chat-admin-conversație-titlu').style.display = 'none';
            const container = document.getElementById('chat-admin-mesaje');
            container.innerHTML = '<p style="color: #ccc; text-align: center; margin-top: auto; margin-bottom: auto;">Selectează un client din stânga pentru a vedea mesajele.</p>';
            const btnSterge = document.getElementById('btn-sterge-chat-admin');
            if (btnSterge) btnSterge.style.display = 'none';
            if (inputChatAdmin) { inputChatAdmin.value = ''; inputChatAdmin.disabled = true; }
            if (btnTrimiteChatAdmin) btnTrimiteChatAdmin.disabled = true;
        });
        return {
            initializeRealtime,
            invalidateRealtime() { chatAdminRealtimeGeneration++; },
            clearState() {
                chatAdminMesajeToate = [];
                chatAdminConversatieCurenta = null;
            },
            removeRealtime() {
                if (!chatAdminRealtime) return;
                const oldChannel = chatAdminRealtime;
                chatAdminRealtime = null;
                setTimeout(() => { db.removeChannel(oldChannel); }, 0);
            }
        };
    };
})();
