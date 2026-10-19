/* Shared session and lifecycle for the administration workspace in index.html. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminCore = function(db) {
        const state = {
            account: null,
            authGeneration: 0,
            programGeneration: 0,
            manualHoursGeneration: 0,
            managedCourts: []
        };
        const context = {
            db,
            state,
            modalNodes: () => document.querySelectorAll('#base-admin-workspace .modal'),
            captureContext() {
                const generation = state.authGeneration;
                const userId = state.account?.user_id;
                return () => !!userId && generation === state.authGeneration && state.account?.user_id === userId;
            }
        };
        window.setLangAdmin = function(limba) {
            limba = 'ro'; // Force Romanian

            const dict = {
                'ro': {
                    't-rez-man-scurt': 'Rezervare Manuală',
                    't-prog-scurt': 'Program & Active',
                    't-istoric-titlu-scurt': 'Rezervări',
                    't-rez-man': 'Adaugă Rezervare Manuală',
                    't-rez-desc': '(Dacă e ocupată, sistemul blochează)',
                    't-pt-ce-teren': 'Pentru ce teren?',
                    't-nume': 'Nume Client (sau Telefon)',
                    't-data-cal': 'Data calendaristică',
                    't-ora': 'Ora',
                    't-pret-incasat': 'Preț Încasat',
                    't-btn-salv': 'Salvează',
                    't-istoric-titlu': 'Rezervări viitoare și recente',
                    't-istoric-btn': 'Descarcă Rezervările',
                    't-prog': 'Program & Disponibilitate',
                    't-alege': 'Alege Terenul',
                    't-data': 'Data Dorită',
                    't-ora-th': 'Ora',
                    't-status': 'Status',
                    't-detalii': 'Client / Detalii',
                    't-reincarca': 'Reîncarcă Programul',
                    't-inchis-admin': 'Închis de Admin'
                },
                'hu': {
                    't-rez-man-scurt': 'Kézi Foglalás',
                    't-prog-scurt': 'Program és Aktív',
                    't-istoric-titlu-scurt': 'Összes Foglalás',
                    't-rez-man': 'Kézi Foglalás Hozzáadása',
                    't-rez-desc': '(Ha foglalt, a rendszer blokkolja)',
                    't-pt-ce-teren': 'Melyik pályára?',
                    't-nume': 'Ügyfél neve (vagy Telefon)',
                    't-data-cal': 'Naptári dátum',
                    't-ora': 'Óra',
                    't-pret-incasat': 'Beszedett Ár',
                    't-btn-salv': 'Mentés',
                    't-istoric-titlu': 'Foglalások Részletes Listája',
                    't-istoric-btn': 'Foglalások Letöltése',
                    't-prog': 'Program és Elérhetőség',
                    't-alege': 'Válassz Pályát',
                    't-data': 'Kívánt Dátum',
                    't-ora-th': 'Óra',
                    't-status': 'Állapot',
                    't-detalii': 'Ügyfél / Részletek',
                    't-reincarca': 'Program Újratöltése',
                    't-inchis-admin': 'Admin által Zárva'
                }
            };

            const currentDict = dict[limba] || dict['ro'];
            document.querySelectorAll('[data-trad]').forEach(el => {
                const key = el.getAttribute('data-trad');
                if (currentDict[key]) el.innerText = currentDict[key];
            });

            if(typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram();
            if(typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
        };
        window.comprimaImagine = function(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = event => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 800;
                        let width = img.width;
                        let height = img.height;
                        if (width > MAX_WIDTH) {
                            height = Math.round((height * MAX_WIDTH) / width);
                            width = MAX_WIDTH;
                        }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const base64 = canvas.toDataURL('image/jpeg', 0.8);
                        resolve(base64);
                    };
                };
                reader.onerror = error => reject(error);
            });
        };
        function clearAdminSessionView() {
            context.chat.invalidateRealtime();
            state.authGeneration++;
            window.dispatchEvent(new Event('spotivity:admin-clear'));
            state.programGeneration++;
            state.manualHoursGeneration++;
            state.account = null;
            document.querySelectorAll('.super-admin-only').forEach(node => { node.style.display = 'none'; });
            state.managedCourts = [];
            context.chat.clearState();
            localStorage.removeItem('admin_session');
            context.modalNodes().forEach(modal => { modal.style.display = 'none'; });
            document.querySelectorAll('#base-admin-workspace .modal input, #base-admin-workspace .modal textarea').forEach(input => {
                if (input.type === 'checkbox' || input.type === 'radio') input.checked = false;
                else input.value = '';
            });
            for (const id of ['container-meniu-terenuri','container-modale-terenuri','sub-pages-container',
                'container-istoric','container-lista-terenuri','container-checkbox-terenuri','tabel-corp-program',
                'tabel-teren','manual-teren','manual-ora','chat-admin-lista-conversații','chat-admin-mesaje']) {
                document.getElementById(id)?.replaceChildren();
            }
            document.getElementById('sectiune-dashboard').style.display = 'none';
            document.getElementById('text-rol-activ').textContent = '';
            document.getElementById('manual-ora').disabled = true;
            document.getElementById('btn-rezervare-manuala').disabled = true;
            document.getElementById('chat-admin-input').disabled = true;
            document.getElementById('chat-admin-btn-trimite').disabled = true;
            document.getElementById('chat-admin-btn-sterge').style.display = 'none';
            const title = document.getElementById('chat-admin-conversație-titlu');
            title.textContent = ''; title.style.display = 'none';
            const badge = document.getElementById('bulina-chat-admin');
            badge.textContent = '0'; badge.style.display = 'none';
            document.querySelector('#modal-chat-admin .modal-chat-box')?.classList.remove('conversatie-activa');
            context.chat.removeRealtime();
        }
        context.clearSessionView = clearAdminSessionView;
        context.start = function() {
            // NOU: Închide modalele cu tasta ESC în Admin
            document.addEventListener('keydown', function(event) {
                if (event.key === "Escape" && !document.getElementById('base-admin-workspace').hidden) {
                    window.inchideSubPaginaOras?.();
                    context.modalNodes().forEach(m => {
                        m.style.display = 'none';
                        if (m.id === 'modal-chat-admin') { const inp = document.getElementById('chat-admin-input'); if (inp) inp.value = ''; }
                        if (m.id === 'modal-adauga-teren') { window.deschideModalAdaugaTeren(); m.style.display = 'none'; }
                    });
                }
            });

            // --- PREVENIRE SCROLL FUNDAL (MUTATION OBSERVER PENTRU MODALE) ---
            const observerModaleAdmin = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'style') {
                        const anyModalOpen = Array.from(context.modalNodes()).some(m => m.style.display === 'flex' || m.style.display === 'block');
                        if (anyModalOpen) {
                            document.body.classList.add('fara-scroll');
                        } else {
                            document.body.classList.remove('fara-scroll');
                        }
                    }
                });
            });


            // NOU: Închide modalele când se dă click pe fundalul întunecat (în afara chenarului)
            document.addEventListener('click', function(event) {
                if (event.target.classList.contains('modal') && event.target.closest('#base-admin-workspace')) {
                    event.target.style.display = 'none';
                }
            });
            context.observeModals = () => context.modalNodes().forEach(modal => {
                observerModaleAdmin.observe(modal, { attributes: true });
            });
            context.observeModals();
            const manualCourtSelect = document.getElementById('manual-teren');
            if (manualCourtSelect) manualCourtSelect.onchange = window.actualizeazaOreManualAdmin;
            window.clearSpotivityAdmin = clearAdminSessionView;
            db.auth.onAuthStateChange((event, session) => {
                const nextUserId = session?.user?.id || null;
                if (event === 'SIGNED_OUT' || (state.account && state.account.user_id !== nextUserId)) {
                    clearAdminSessionView();
                }
            });
            window.setLangAdmin(window.lang);
        };
        return context;
    };
})();
