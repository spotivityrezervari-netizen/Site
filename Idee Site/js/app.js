// Password resets require a recovery session accepted by the Auth SDK.
(() => {
    let activeRecovery = null;
    const handledTokens = new Set();
    const clearRecoveryUrl = () => {
        const url = new URL(window.location.href);
        const keys = ['access_token','refresh_token','expires_in','expires_at','token_type',
            'type','code','error','error_code','error_description'];
        for (const key of keys) url.searchParams.delete(key);
        const hash = new URLSearchParams(url.hash.slice(1));
        if (keys.some(key => hash.has(key))) {
            for (const key of keys) hash.delete(key);
            url.hash = hash.toString();
        }
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    };
    const closeRecovery = () => {
        document.getElementById('modal-parola-noua')?.remove();
        activeRecovery = null;
        if (![...document.querySelectorAll('.modal')].some(m => ['flex','block'].includes(m.style.display))) {
            document.body.classList.remove('fara-scroll');
        }
        clearRecoveryUrl();
    };
    const showRecovery = session => {
        if (!session?.user?.id || !session.access_token || !session.refresh_token
            || handledTokens.has(session.access_token)) return;
        handledTokens.add(session.access_token);
        closeRecovery();
        activeRecovery = session;
        const modal = document.createElement('div');
        modal.id = 'modal-parola-noua';
        modal.className = 'modal';
        modal.style.cssText = 'display:flex;z-index:100001;';
        modal.innerHTML = `<div class="modal-continut" style="max-width:400px;width:calc(100% - 32px);height:auto;padding:28px;">
            <button type="button" class="buton-inchidere" aria-label="Închide">X</button>
            <h2 class="titlu-modal">Resetează parola</h2>
            <p>Introdu noua parolă (minim 6 caractere).</p>
            <div class="grup-input"><label for="input-noua-parola-js">Noua parolă</label>
                <input type="password" id="input-noua-parola-js" autocomplete="new-password" minlength="6"></div>
            <p id="mesaj-resetare-parola" role="status" aria-live="polite"></p>
            <button type="button" id="btn-salveaza-parola-js" class="buton-rezervare">Salvează parola</button>
        </div>`;
        document.body.appendChild(modal);
        document.body.classList.add('fara-scroll');
        modal.querySelector('.buton-inchidere').onclick = closeRecovery;
        modal.querySelector('#btn-salveaza-parola-js').onclick = async () => {
            const button = modal.querySelector('#btn-salveaza-parola-js');
            if (button.disabled || activeRecovery !== session) return;
            const password = modal.querySelector('#input-noua-parola-js').value;
            const status = modal.querySelector('#mesaj-resetare-parola');
            if (password.length < 6) { status.textContent = 'Parola trebuie să aibă minim 6 caractere.'; return; }
            button.disabled = true;
            status.textContent = 'Se salvează...';
            // A separate in-memory client binds this request to the recovery user,
            // even if another tab signs the shared client into a different account.
            const recoveryClient = createClient(supabaseUrl, supabaseKey, {
                auth: {persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
            });
            try {
                const {error: sessionError} = await recoveryClient.auth.setSession({
                    access_token: session.access_token, refresh_token: session.refresh_token
                });
                if (sessionError) throw sessionError;
                const {data: identity, error: identityError} = await recoveryClient.auth.getUser();
                if (identityError || identity?.user?.id !== session.user.id) {
                    throw new Error('Linkul de resetare este invalid sau a expirat. Cere un link nou.');
                }
                if (activeRecovery !== session) return;
                const {error} = await recoveryClient.auth.updateUser({password});
                if (error) throw error;
                if (activeRecovery !== session) return;
                closeRecovery();
                alert('Parola a fost schimbată cu succes.');
            } catch (error) {
                if (activeRecovery === session) {
                    status.textContent = error.message || 'Resetarea nu a reușit. Cere un link nou.';
                    button.disabled = false;
                }
            } finally {
                recoveryClient.auth.stopAutoRefresh();
            }
        };
    };
    db.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            const render = () => showRecovery(session);
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, {once:true});
            else setTimeout(render,0);
        } else if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && activeRecovery
            && activeRecovery.user.id !== session?.user?.id)) {
            if (activeRecovery) setTimeout(closeRecovery,0);
        }
    });
    document.addEventListener('DOMContentLoaded', async () => {
        const initialUrl = new URL(window.location.href);
        const hash = new URLSearchParams(initialUrl.hash.slice(1));
        const recoveryLink = initialUrl.searchParams.get('type') === 'recovery' || hash.get('type') === 'recovery';
        const linkError = initialUrl.searchParams.has('error') || hash.has('error');
        await db.auth.getSession(); // Wait for SDK initialization and its verified event.
        showRecovery(window.takeSpotivityRecoverySession?.());
        if ((recoveryLink || linkError) && !activeRecovery && !handledTokens.size) {
            clearRecoveryUrl();
            alert('Linkul de resetare este invalid sau a expirat. Cere un link nou de la „Ai uitat parola?”.');
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && activeRecovery) closeRecovery();
    });
})();

// ==========================================
// 0. SISTEMUL DE TRADUCERI (i18n) GLOBAL
// ==========================================
window.dict = {
    'ro': {
        'rezervare_succes': 'Rezervarea a fost realizată cu succes.',
        'contul_meu': 'Contul Meu', 'login_cont': 'Login / Cont', 'fotbal': 'Fotbal', 'baschet': 'Baschet', 'tenis': 'Tenis', 'volei': 'Volei',
        'autentificare': 'Autentificare', 'creare_cont': 'Creare Cont', 'email': 'Adresă Email', 'parola': 'Parolă', 'telefon': 'Număr de Telefon',
        'nume_complet': 'Nume Complet (Username)',
        'intra_cont': 'Intră în cont', 'btn_creare_cont': 'Creează Cont', 'profil_titlu': 'Profilul Tău', 'rez_active': 'Rezervări Active',
        'istoric': 'Istoric Rezervări', 'deconectare': 'Deconectare', 'inapoi_profil': 'Înapoi la Profil', 'alege_terenul': 'Alege Terenul',
        'data_dorita': 'Data Dorită', 'ora_dorita': 'Ora Dorită', 'toate_orele': 'Toate Orele', 'inapoi': 'Înapoi',
        'finalizare_rezervare': 'Finalizare Rezervare', 'nevoie_minge': 'Ai nevoie de minge?', 'alege_ziua': 'Alege Ziua', 
        'alege_ora': 'Alege Ora (Poți selecta mai multe)', 'disclaimer': 'Rezervarea poate fi anulată gratuit oricând.',
        'vezi_locatia': 'Vezi Locația (Hartă)', 'alegeti_o_ora': 'Alegeți o oră', 'zile': ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"], 'azi': 'Azi', 'maine': 'Mâine',
        'lei_ora': 'Lei/oră', 'ocupat': 'Ocupat', 'trecut': 'Trecut', 'rezerva': 'Rezervă', 'se_cauta': 'Se caută terenuri disponibile...',
        'fara_rezervari': 'Nu ai rezervări momentan.', 'anuleaza': '❌ Anulează (Gratuit)',
        'chat_btn': 'Chat', 'rez_active_titlu': 'Rezervările Tale Active', 'chat_titlu': '💬 Mesaje Chat',
        'chat_cauta_conv': 'Se caută conversații...', 'chat_alege_conv': 'Alege o conversație',
        'chat_selecteaza_stanga': 'Selectează un teren din stânga pentru a vedea mesajele.', 'chat_scrie': 'Scrie un mesaj...',
        'chat_avertisment': 'Este nevoie de rezervare pentru a trimite un chat', 'nume_nesetat': 'Nume Nesetat',
        'fotbal_tenis_picior': 'Fotbal<br><span style="font-size: 0.8em; font-weight: normal; opacity: 0.8;">Tenis Picior</span>', 'copyright_text': '© 2026 Numele SRL', 'drepturi_rezervate': 'Toate drepturile rezervate',
        'info_legale': 'Info Legale', 'info_legale_titlu': 'Informații Legale', 'legal_denumire': 'Denumire:', 'legal_reg': 'Reg. Comerțului:',
        'legal_sediu': 'Sediu Social:', 'legal_contact': 'Contact:', 'legal_anpc': 'Protecția Consumatorilor (ANPC):', 'legal_sol': 'Soluționare Online a Litigiilor (SOL):',
        'legal_termeni': 'Termeni și Condiții', 'legal_gdpr': 'Politica de Confidențialitate (GDPR)', 'legal_cookies': 'Politica de Cookies',
        'copyright_footer': '© 2026 Numele SRL. Toate drepturile rezervate.', 'toate_orasele': 'Toate Orașele'
    },
    'hu': {
        'rezervare_succes': 'A foglalás sikeresen megtörtént.',
        'contul_meu': 'Fiókom', 'login_cont': 'Belépés / Fiók', 'fotbal': 'Foci', 'baschet': 'Kosárlabda', 'tenis': 'Tenisz', 'volei': 'Röplabda',
        'autentificare': 'Bejelentkezés', 'creare_cont': 'Regisztráció', 'email': 'E-mail cím', 'parola': 'Jelszó', 'telefon': 'Telefonszám',
        'nume_complet': 'Teljes Név (Felhasználónév)',
        'intra_cont': 'Belépés', 'btn_creare_cont': 'Fiók létrehozása', 'profil_titlu': 'Profilod', 'rez_active': 'Aktív foglalások',
        'istoric': 'Foglalási előzmények', 'deconectare': 'Kijelentkezés', 'inapoi_profil': 'Vissza a profilhoz', 'alege_terenul': 'Pálya kiválasztása',
        'data_dorita': 'Kívánt dátum', 'ora_dorita': 'Kívánt időpont', 'toate_orele': 'Minden időpont', 'inapoi': 'Vissza',
        'finalizare_rezervare': 'Foglalás véglegesítése', 'nevoie_minge': 'Szükséged van labdára?', 'alege_ziua': 'Válassz napot', 
        'alege_ora': 'Válassz időpontot (többet is lehet)', 'disclaimer': 'A foglalás bármikor ingyenesen lemondható.',
        'vezi_locatia': 'Helyszín (Térkép)', 'alegeti_o_ora': 'Válassz időpontot', 'zile': ["Vas", "Hét", "Ked", "Sze", "Csü", "Pén", "Szo"], 'azi': 'Ma', 'maine': 'Holnap',
        'lei_ora': 'RON/óra', 'ocupat': 'Foglalt', 'trecut': 'Elmúlt', 'rezerva': 'Foglalás', 'se_cauta': 'Szabad pályák keresése...',
        'fara_rezervari': 'Jelenleg nincsenek foglalásaid.', 'anuleaza': '❌ Lemondás (Ingyenes)',
        'chat_btn': 'Chat', 'rez_active_titlu': 'Aktív foglalásaid', 'chat_titlu': '💬 Chat üzenetek',
        'chat_cauta_conv': 'Beszélgetések keresése...', 'chat_alege_conv': 'Válassz egy beszélgetést',
        'chat_selecteaza_stanga': 'Válassz egy pályát balról az üzenetek megtekintéséhez.', 'chat_scrie': 'Írj egy üzenetet...',
        'chat_avertisment': 'Üzenet küldéséhez aktív foglalás szükséges',
        'fotbal_tenis_picior': 'Foci<br><span style="font-size: 0.8em; font-weight: normal; opacity: 0.8;">Lábtenisz</span>', 'copyright_text': '© 2026 Numele SRL', 'drepturi_rezervate': 'Minden jog fenntartva',
        'info_legale': 'Jogi Információk', 'info_legale_titlu': 'Jogi Információk', 'legal_denumire': 'Cégnév:', 'legal_reg': 'Cégjegyzékszám:',
        'legal_sediu': 'Székhely:', 'legal_contact': 'Kapcsolat:', 'legal_anpc': 'Fogyasztóvédelem (ANPC):', 'legal_sol': 'Online vitarendezés (SOL):',
        'legal_termeni': 'Feltételek és Szabályok', 'legal_gdpr': 'Adatvédelmi Irányelvek (GDPR)', 'legal_cookies': 'Süti Szabályzat',
        'copyright_footer': '© 2026 Numele SRL. Minden jog fenntartva.', 'toate_orasele': 'Minden Város'
    },
    'en': {
        'rezervare_succes': 'Booking completed successfully.',
        'contul_meu': 'My Account', 'login_cont': 'Login / Account', 'fotbal': 'Football', 'baschet': 'Basketball', 'tenis': 'Tennis', 'volei': 'Volleyball',
        'autentificare': 'Login', 'creare_cont': 'Register', 'email': 'Email Address', 'parola': 'Password', 'telefon': 'Phone Number',
        'nume_complet': 'Full Name (Username)',
        'intra_cont': 'Sign In', 'btn_creare_cont': 'Create Account', 'profil_titlu': 'Your Profile', 'rez_active': 'Active Bookings',
        'istoric': 'Booking History', 'deconectare': 'Logout', 'inapoi_profil': 'Back to Profile', 'alege_terenul': 'Choose Court',
        'data_dorita': 'Desired Date', 'ora_dorita': 'Desired Time', 'toate_orele': 'All Hours', 'inapoi': 'Back',
        'finalizare_rezervare': 'Finalize Booking', 'nevoie_minge': 'Need a ball?', 'alege_ziua': 'Choose Day', 
        'alege_ora': 'Choose Time (Select multiple)', 'disclaimer': 'You can cancel your booking for free at any time.',
        'vezi_locatia': 'View Location (Map)', 'alegeti_o_ora': 'Choose a time', 'zile': ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], 'azi': 'Today', 'maine': 'Tomorrow',
        'lei_ora': 'RON/hour', 'ocupat': 'Booked', 'trecut': 'Passed', 'rezerva': 'Book', 'se_cauta': 'Searching for available courts...',
        'fara_rezervari': 'You have no bookings at the moment.', 'anuleaza': '❌ Cancel (Free)',
        'chat_btn': 'Chat', 'rez_active_titlu': 'Your Active Bookings', 'chat_titlu': '💬 Chat Messages',
        'chat_cauta_conv': 'Searching for conversations...', 'chat_alege_conv': 'Choose a conversation',
        'chat_selecteaza_stanga': 'Select a court from the left to view messages.', 'chat_scrie': 'Type a message...',
        'chat_avertisment': 'An active booking is required to send a message', 'nume_nesetat': 'Name Not Set',
        'fotbal_tenis_picior': 'Football<br><span style="font-size: 0.8em; font-weight: normal; opacity: 0.8;">Foot Tennis</span>', 'copyright_text': '© 2026 Numele SRL', 'drepturi_rezervate': 'All rights reserved',
        'info_legale': 'Legal Info', 'info_legale_titlu': 'Legal Information', 'legal_denumire': 'Company Name:', 'legal_reg': 'Registration Number:',
        'legal_sediu': 'Headquarters:', 'legal_contact': 'Contact:', 'legal_anpc': 'Consumer Protection (ANPC):', 'legal_sol': 'Online Dispute Resolution (ODR):',
        'legal_termeni': 'Terms and Conditions', 'legal_gdpr': 'Privacy Policy (GDPR)', 'legal_cookies': 'Cookies Policy',
        'copyright_footer': '© 2026 Numele SRL. All rights reserved.', 'toate_orasele': 'All Cities'
    }
};

window.lang = localStorage.getItem('limba_app') || 'ro';
window.tipIstoricDeschis = null; // Stochează ce tip de istoric este deschis ("active" sau "istoric")

// Funcție globală utilitară pentru traducerea automată a zilelor reținute în BD
window.traduData = function(dataStrDB) {
    if (!dataStrDB) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataStrDB)) {
        const date = new Date(`${dataStrDB}T12:00:00Z`);
        return `${window.dict[window.lang].zile[date.getUTCDay()]}, ${dataStrDB.slice(8,10)}.${dataStrDB.slice(5,7)}.${dataStrDB.slice(0,4)}`;
    }
    const parts = dataStrDB.split(', ');
    if (parts.length === 2) {
        const indexZi = window.dict['ro']['zile'].indexOf(parts[0]);
        if (indexZi !== -1) {
            return `${window.dict[window.lang]['zile'][indexZi]}, ${parts[1]}`;
        }
    }
    return dataStrDB; // Fallback, returnează textul netradus
};

// Funcție globală pentru verificarea exactă a timpului (ținând cont de anul creării)
window.esteRezervareTrecuta = function(dataStr, ora, timestamp_start) {
    if (!dataStr || !ora) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) return window.bookingEnded(dataStr, ora);
    const matchData = dataStr.match(/\d{1,2}\.\d{1,2}/); 
    if (!matchData) return false;
    const [zi, luna] = matchData[0].split('.');
    const oraRezervareNumar = parseInt(ora.split(':')[0]);
    const acum = new Date();
    
    let anRezervare = acum.getFullYear();
    if (timestamp_start) {
        const dataCreare = new Date(timestamp_start);
        anRezervare = dataCreare.getFullYear();
        if (dataCreare.getMonth() === 11 && parseInt(luna) === 1) anRezervare++;
    } else {
        if (acum.getMonth() === 11 && parseInt(luna) === 1) anRezervare++;
    }
    const dataTerminarii = new Date(anRezervare, parseInt(luna) - 1, parseInt(zi), oraRezervareNumar, 59, 59);
    return dataTerminarii < acum;
};

Object.assign(window.dict.ro, {cauta_teren:'Caută terenul',cauta_teren_placeholder:'Numele terenului',niciun_teren_cautare:'Nu am găsit un teren cu acest nume.'});
Object.assign(window.dict.hu, {cauta_teren:'Pálya keresése',cauta_teren_placeholder:'A pálya neve',niciun_teren_cautare:'Nem találtunk ilyen nevű pályát.'});
Object.assign(window.dict.en, {cauta_teren:'Find a court',cauta_teren_placeholder:'Court name',niciun_teren_cautare:'No courts match this name.'});

window.schimbaLimba = function(limbaNoua) {
    window.lang = limbaNoua;
    localStorage.setItem('limba_app', window.lang);
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const cheie = el.getAttribute('data-i18n');
        if (window.dict[window.lang][cheie]) {
            el.innerHTML = window.dict[window.lang][cheie];
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const cheie = el.getAttribute('data-i18n-placeholder');
        if (window.dict[window.lang][cheie]) {
            el.placeholder = window.dict[window.lang][cheie];
        }
    });

    // Colorare și Evidențiere buton limbă (Activ)
    document.querySelectorAll('.btn-lang').forEach(btn => {
        if (btn.id === `btn-lang-${limbaNoua}`) {
            btn.style.background = 'rgba(255,255,255,0.16)';
            btn.style.color = '#fff';
            btn.style.boxShadow = 'none';
        } else {
            btn.style.background = 'transparent';
            btn.style.color = 'white';
            btn.style.boxShadow = 'none';
        }
    });

    if(typeof window.actualizeazaButonCont === 'function') window.actualizeazaButonCont();
    
    // Re-generare zile din calendar la schimbarea limbii
    if(document.getElementById('modal-rezervare')?.style.display === 'flex' && typeof window.genereazaZile === 'function') {
        window.genereazaZile();
    }
    
    // Reîncărcare Istoric Client dacă este deschis, pentru traducerea în timp real a zilelor
    if (document.getElementById('modal-lista-rezervari')?.style.display === 'flex' && typeof window.reincarcaIstoricCurent === 'function') {
        window.reincarcaIstoricCurent();
    }
    
    // Reîncărcare Istoric Admin (pentru admin.js) dacă e deschis pe ecran
    if (document.getElementById('container-istoric')?.style.display === 'flex' && typeof window.reincarcaIstoricAdmin === 'function') {
        window.reincarcaIstoricAdmin();
    }
};


// ==========================================
// 1. LOGICA APLICAȚIEI
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    
    let loggedInUser = null;
    let authGeneration = 0;
    localStorage.removeItem('user_session');
    async function syncAuthUser(user) {
        const generation = ++authGeneration;
        const { data: profile } = user
            ? await db.from('clienti').select('nume,telefon').eq('user_id', user.id).maybeSingle()
            : { data: null };
        if (generation !== authGeneration) return;
        loggedInUser = user ? { id: user.id, email: user.email, nume: profile?.nume || user.email.split('@')[0], telefon: profile?.telefon || '-' } : null;
        if (typeof window.actualizeazaButonCont === 'function') window.actualizeazaButonCont();
    }
    let terenuriDinDB = [];
    let filterRequest = 0, hoursRequest = 0, bookingContextGeneration = 0;
    let bookingInFlight = false, hoursLoading = false;
    let sportCurent = "", terenCurent = "", pretTerenCurent = 0, pretMingeCurent = 15;
    let mingeBifata = false, oraSelectata = [], dataSelectataStr = "";

    window.schimbaLimba(window.lang);

    const aziD = new Date();
    const numeZileT_DB = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
    const aziStringFormatat = window.siteDate();

    async function incarcaTerenuri() {
        const { data, error } = await db.from('terenuri').select('*');
        if (error || !data) return false;
        terenuriDinDB = data;
        return true;
    }
    await incarcaTerenuri();

    function populeazaFiltruOrase() {
        const selectOras = document.getElementById('filtru-oras-global');
        if (!selectOras) return;
        
        const oraseUnice = [...new Set(terenuriDinDB.map(t => t.oras ? t.oras.trim().replace(/\.+$/, '') : '').filter(o => o !== ''))];
        oraseUnice.sort((a, b) => a.localeCompare(b));
        
        let html = `<option value="ALL">${window.lang === 'hu' ? 'Minden város' : (window.lang === 'en' ? 'All Cities' : 'Toate Orașele')}</option>`;
        oraseUnice.forEach(oras => {
            html += `<option value="${window.escapeHtml(oras)}">${window.escapeHtml(oras)}</option>`;
        });
        
        selectOras.innerHTML = html;
    }
    populeazaFiltruOrase();

    const btnTopCont = document.getElementById('btn-top-cont');
    
    window.actualizeazaButonCont = function() {
        const textTopCont = document.getElementById('text-top-cont');
        if(textTopCont) {
            textTopCont.innerText = loggedInUser ? window.dict[window.lang]['contul_meu'] : window.dict[window.lang]['login_cont'];
        }
    };
    const { data: restoredAuth } = await db.auth.getUser();
    await syncAuthUser(restoredAuth.user);
    window.actualizeazaButonCont();

    if (btnTopCont) {
        btnTopCont.addEventListener('click', async () => {
            if (loggedInUser) {
                if(document.getElementById('profil-nume')) document.getElementById('profil-nume').innerText = loggedInUser.nume || (window.dict[window.lang]['nume_nesetat'] || 'Nume Nesetat');
                document.getElementById('profil-email').innerText = loggedInUser.email;
                if(document.getElementById('profil-telefon')) document.getElementById('profil-telefon').innerText = loggedInUser.telefon || "-";
                
                const nrActiveSpan = document.getElementById('nr-active');
                if (nrActiveSpan) {
                    const { data } = await db.from('rezervari').select('data_str, ora, stare, timestamp_start').eq('email_client', loggedInUser.email.trim()).neq('stare', 'anulata');
                    let nrReale = 0;
                    if (data) {
                        data.forEach(r => {
                            if (!window.esteRezervareTrecuta(r.data_str, r.ora, r.timestamp_start)) nrReale++;
                        });
                    }
                    nrActiveSpan.innerText = nrReale;
                }
                document.getElementById('modal-profil').style.display = 'flex';
            } else document.getElementById('modal-auth').style.display = 'flex';
        });
    }

    // --- ESC PENTRU A ÎNCHIDE ORICE MODAL ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modals = ['modal-auth', 'modal-profil', 'modal-terenuri', 'modal-rezervare', 'modal-lista-rezervari', 'modal-chat-client', 'modal-parola-noua', 'modal-legal'];
            modals.forEach(id => {
                const el = document.getElementById(id);
                if (el && el.style.display !== 'none') { el.style.display = 'none'; 
                    if(id === 'modal-terenuri' || id === 'modal-rezervare') reseteazaFundalSport(); if (id === 'modal-chat-client') { const inp = document.getElementById('chat-client-input'); if (inp) inp.value = ''; } }
            });
        }
    });

    // TASK 2: Închidere universală pentru orice buton X dintr-un modal
    document.querySelectorAll('.buton-inchidere').forEach(btn => {
        btn.addEventListener('click', function() {
            const modalParent = this.closest('.modal');
            if (modalParent) {
                modalParent.style.display = 'none';
                if (modalParent.id === 'modal-chat-client') { const inp = document.getElementById('chat-client-input'); if (inp) inp.value = ''; }
            }
        });
    });

    // Language buttons binding
    document.getElementById('btn-lang-ro')?.addEventListener('click', () => window.schimbaLimba('ro'));
    document.getElementById('btn-lang-hu')?.addEventListener('click', () => window.schimbaLimba('hu'));
    document.getElementById('btn-lang-en')?.addEventListener('click', () => window.schimbaLimba('en'));

    // --- PREVENIRE SCROLL FUNDAL (MUTATION OBSERVER PENTRU MODALE) ---
    const observerModale = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'style') {
                const anyModalOpen = Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'flex' || m.style.display === 'block');
                if (anyModalOpen) {
                    document.body.classList.add('fara-scroll');
                } else {
                    document.body.classList.remove('fara-scroll');
                }
            }
        });
    });
    document.querySelectorAll('.modal').forEach(m => {
        observerModale.observe(m, { attributes: true });
    });

    // --- ENTER PENTRU LOGIN / REGISTER ---
    document.getElementById('form-login')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-executa-login')?.click(); }
    });
    document.getElementById('form-register')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-executa-register')?.click(); }
    });

    document.getElementById('inchide-auth')?.addEventListener('click', () => document.getElementById('modal-auth').style.display = 'none');
    document.getElementById('inchide-profil')?.addEventListener('click', () => document.getElementById('modal-profil').style.display = 'none');
    
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        const { error } = await db.auth.signOut();
        if (error) return alert('Deconectarea a eșuat: ' + error.message);
        await syncAuthUser(null);
        document.getElementById('modal-profil').style.display = 'none'; window.actualizeazaButonCont();
    });

    document.getElementById('tab-login')?.addEventListener('click', () => {
        document.getElementById('form-login').style.display = 'flex'; document.getElementById('form-register').style.display = 'none';
        document.getElementById('tab-login').classList.add('activ'); document.getElementById('tab-register').classList.remove('activ');
    });

    document.getElementById('tab-register')?.addEventListener('click', () => {
        document.getElementById('form-login').style.display = 'none'; document.getElementById('form-register').style.display = 'flex';
        document.getElementById('tab-register').classList.add('activ'); document.getElementById('tab-login').classList.remove('activ');
    });

    document.getElementById('btn-executa-login')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim(); const parola = document.getElementById('login-parola').value;
        if(!email || !parola) return alert("Completati datele!");
        
        const btn = document.getElementById('btn-executa-login');
        const textInitial = btn.innerText;
        btn.innerText = "⏳..."; btn.disabled = true;

        // Autentificare prin Supabase Auth
        const { data: authData, error: authError } = await db.auth.signInWithPassword({
            email: email,
            password: parola,
        });

        if (authError) {
            btn.innerText = textInitial; btn.disabled = false;
            return alert("Email sau parolă greșită! (Eroare Auth: " + authError.message + ")");
        }

        await syncAuthUser(authData.user);
        document.getElementById('modal-auth').style.display = 'none';

        btn.innerText = textInitial; btn.disabled = false;
    });

    document.getElementById('btn-executa-register')?.addEventListener('click', async () => {
        const nume = document.getElementById('reg-nume').value.trim();
        const email = document.getElementById('reg-email').value.trim(); 
        const telefon = document.getElementById('reg-telefon').value.trim(); 
        const parola = document.getElementById('reg-parola').value;
        
        if(!nume || !email || !telefon || !parola) return alert("Completați toate câmpurile!");
        if(parola.length < 6) return alert("Parola trebuie să aibă minim 6 caractere pentru securitate!");
        
        const btn = document.getElementById('btn-executa-register');
        btn.innerText = "⏳..."; btn.disabled = true;

        // 1. Înregistrare în seiful Supabase Auth (Securitate)
        const { data: authData, error: authError } = await db.auth.signUp({
            email: email,
            password: parola,
            options: { data: { nume, telefon }, emailRedirectTo: window.siteHomeUrl() },
        });

        if (authError) {
            btn.innerText = window.dict[window.lang]['btn_creare_cont']; btn.disabled = false;
            if (authError.message.includes("already registered")) {
                return alert("Există deja un cont cu această adresă de email! Te rugăm să te conectezi pe el.");
            }
            return alert("Eroare la securizarea contului: " + authError.message);
        }

        // The Auth trigger creates the profile, even before email confirmation.
        btn.innerText = window.dict[window.lang]['btn_creare_cont']; btn.disabled = false;
        alert(authData.session
            ? 'Cont creat. Ești autentificat.'
            : 'Verifică emailul pentru confirmarea contului, apoi autentifică-te.');
        document.getElementById('tab-login').click();
    });

    // --- ISTORIC REZERVĂRI ---
    window.reincarcaIstoricCurent = function() {
        if(loggedInUser && window.tipIstoricDeschis) {
            deschideIstoric(window.tipIstoricDeschis);
        }
    };

    async function deschideIstoric(tip) {
        window.tipIstoricDeschis = tip;
        document.getElementById('modal-profil').style.display = 'none';
        document.getElementById('modal-lista-rezervari').style.display = 'flex';
        
        document.getElementById('titlu-lista-rezervari').innerText = tip === 'active' ? window.dict[window.lang]['rez_active'] : window.dict[window.lang]['istoric'];
        const container = document.getElementById('container-rezervari');
        container.innerHTML = `<p style="color:white; text-align:center;">⏳</p>`;

        const { data, error } = await db.from('rezervari').select('*').ilike('email_client', loggedInUser.email.trim());
        container.innerHTML = "";
        
        if (!data || data.length === 0) {
            container.innerHTML = `<p style='color:white; text-align:center;'>${window.dict[window.lang]['fara_rezervari']}</p>`; return;
        }

        let afisate = 0; const acum = new Date();

        data.sort((a, b) => b.id - a.id).forEach((r) => {
            const esteTrecuta = window.esteRezervareTrecuta(r.data_str, r.ora, r.timestamp_start);

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
            if (r.stare !== 'anulata') {
                butonAnulare = `<button class="btn-anulare anulare-client" data-id="${window.escapeHtml(r.id)}" style="margin-top: 10px; background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">${window.dict[window.lang]['anuleaza']}</button>`;
            }

            const terenAsociat = terenuriDinDB.find(t => t.nume === r.teren);
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
                    <p style="margin: 5px 0;">📅 ${window.escapeHtml(dataTradusa)} | ⏰ ${r.ora}</p>
                    <p style="margin: 5px 0;">Total: <strong>${window.escapeHtml(r.pret_total)}</strong></p>
                    <div style="display: flex; flex-wrap: wrap;">${butonLocatie}${butonChat}${butonAnulare}</div>
                </div>
            `;
        });
        
        if (afisate === 0) container.innerHTML = `<p style='color:white; text-align:center;'>${window.dict[window.lang]['fara_rezervari']}</p>`;
    }

    document.getElementById('btn-vezi-active')?.addEventListener('click', () => deschideIstoric("active"));
    document.getElementById('btn-vezi-istoric')?.addEventListener('click', () => deschideIstoric("istoric"));
    document.getElementById('inapoi-la-profil')?.addEventListener('click', () => {
        document.getElementById('modal-lista-rezervari').style.display = 'none'; document.getElementById('modal-profil').style.display = 'flex';
    });
    document.getElementById('inchide-istoric-client')?.addEventListener('click', () => document.getElementById('modal-lista-rezervari').style.display = 'none');

    document.getElementById('container-rezervari')?.addEventListener('click', async (e) => {
        if (e.target.classList.contains('anulare-client')) {
            const idRez = e.target.getAttribute('data-id');
            if (confirm("Confirm?")) {
                const { error } = await db.from('rezervari').update({ stare: 'anulata' }).eq('id', idRez);
                if (error) return alert('Anularea a fost respinsă: ' + error.message);
                deschideIstoric(window.tipIstoricDeschis || "active");
            }
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
            
            // Funcția incarcaMesajeClient populează lista și o randează
            // Apoi selectăm explicit terenul curent
            await incarcaMesajeClient();
            
            // Suprascriem selecția ca să deschidă fix conversația terenului dorit
            chatClientTerenCurent = teren;
            deschideConversatiaClient(teren);
        }
    });

    function actualizeazaDataFiltrului() {
        const valoare = document.getElementById('filtru-data')?.value || '';
        const afisaj = document.getElementById('filtru-data-afisata');
        if (afisaj) afisaj.textContent = /^\d{4}-\d{2}-\d{2}$/.test(valoare)
            ? valoare.split('-').reverse().join('.') : '';
    }

    function seteazaFundalSport(element, sport, suprapunere = false) {
        if (!element) return;
        const appearance = window.getSportAppearance(sport);
        const background = `url(${JSON.stringify(new URL(appearance.fundal_url, document.baseURI).href)})`;
        element.style.setProperty('--fundal-desktop', background);
        element.style.setProperty('--fundal-mobil', background);
        const stratGri = 'linear-gradient(rgba(60, 60, 64, 0.7), rgba(60, 60, 64, 0.7)), ';
        element.style.backgroundImage = (suprapunere ? stratGri : '') + 'var(--fundal-ales)';
        element.style.backgroundSize = suprapunere ? '100% 100%, cover' : 'cover';
        element.style.backgroundRepeat = 'no-repeat';
        element.style.backgroundPosition = 'center';
    }

    function reseteazaFundalSport() {
        const fundal = document.getElementById('fundal-imagine-sport');
        if (fundal) fundal.style.opacity = '0';
        document.querySelectorAll('#modal-terenuri .modal-continut, #modal-rezervare .modal-continut')
            .forEach(modal => {
                modal.style.backgroundImage = '';
                modal.style.removeProperty('--fundal-desktop');
                modal.style.removeProperty('--fundal-mobil');
            });
    }

    let temporizatorNotificareRezervare;
    function afiseazaSuccesRezervare() {
        const notificare = document.getElementById('notificare-rezervare');
        const mesaj = document.getElementById('notificare-rezervare-text');
        if (!notificare || !mesaj) return;
        clearTimeout(temporizatorNotificareRezervare);
        mesaj.textContent = window.dict[window.lang]['rezervare_succes'];
        notificare.hidden = false;
        temporizatorNotificareRezervare = setTimeout(() => {
            notificare.hidden = true;
        }, 2000);
    }

    // --- LOGICA TERENURI ---
    document.querySelectorAll('.card-sport').forEach(card => {
        card.addEventListener('click', async () => {
            sportCurent = card.getAttribute('data-sport'); 
            const numeSportTradus = window.dict[window.lang][sportCurent.toLowerCase()] || sportCurent;
            
            document.getElementById('titlu-sport').innerText = `${window.dict[window.lang]['alege_terenul']} - ${numeSportTradus}`;
            document.getElementById('modal-terenuri').style.display = 'flex';
            
            // Schimba fundalul cu imaginea sportului
            const bgDiv = document.getElementById('fundal-imagine-sport');
            if(bgDiv && sportCurent) {
                const sportStr = sportCurent.toLowerCase().replace(/\s+/g, '_');
                const bgStr = (sportStr === 'tenis_picior') ? 'fotbal' : sportStr;
                
                // Punem background-ul pe ecranul principal (in spatele modalului)
                seteazaFundalSport(bgDiv, bgStr);
                bgDiv.style.opacity = '1';
                
                // Punem background-ul STRICT IN FEREASTRA (modal-continut)
                const modalContinut = document.querySelector('#modal-terenuri .modal-continut');
                if (modalContinut) {
                    seteazaFundalSport(modalContinut, bgStr, true);
                }
            }
            
            const aziFormatStandard = window.siteDate();
            const filtruData = document.getElementById('filtru-data');
            if(filtruData) filtruData.value = aziFormatStandard;
            actualizeazaDataFiltrului();
            const filtruOra = document.getElementById('filtru-ora');
            if(filtruOra) filtruOra.value = 'ALL'; 
            const filtruNume = document.getElementById('filtru-nume');
            if (filtruNume) filtruNume.value = '';
            clearTimeout(searchTimer);
            
            await aplicaFiltruSiDeseneazaTerenuri();
        });
    });

    function textProgram(indisponibil = false) {
        if (indisponibil) return window.lang === 'hu' ? 'Nem sikerült betölteni az időpontokat. Próbáld újra.' :
            window.lang === 'en' ? 'Availability could not be loaded. Please try again.' :
            'Disponibilitatea nu poate fi încărcată. Încearcă din nou.';
        return window.lang === 'hu' ? 'Erre a pályára nincs foglalható időpont.' :
            window.lang === 'en' ? 'This court has no booking hours available.' :
            'Acest teren nu are ore disponibile pentru rezervări.';
    }

    let searchTimer;
    const normalizaNume = value => String(value ?? '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('ro-RO').trim();
    async function aplicaFiltruSiDeseneazaTerenuri() {
        const request = ++filterRequest;
        const searchText = normalizaNume(document.getElementById('filtru-nume')?.value);
        const dataSelectataDinFiltru = document.getElementById('filtru-data').value;
        const filtruOra = document.getElementById('filtru-ora');
        const containerDinamicTerenuri = document.getElementById('container-dinamic-terenuri');
        containerDinamicTerenuri.innerHTML = `<p style="color:white; width:100%; text-align:center;">${window.dict[window.lang]['se_cauta']}</p>`;
        const loaded = await incarcaTerenuri();
        if (request !== filterRequest) return;
        if (!loaded) { containerDinamicTerenuri.textContent = textProgram(true); return; }

        const orasSelectat = document.getElementById('filtru-oras-global')?.value || 'ALL';
        const terenuriPentruAcestSport = terenuriDinDB.filter(t =>
            (t.sport === sportCurent || (sportCurent === 'Fotbal' && t.sport === 'Tenis Picior')) &&
            t.este_activ !== false && (orasSelectat === 'ALL' || (t.oras && t.oras.trim().replace(/\.+$/, '') === orasSelectat)));
        const selectedHour = filtruOra.value;
        const availableHours = window.bookingHourOptions.filter(hour =>
            terenuriPentruAcestSport.some(court => window.getCourtBookingHours(court).includes(hour)));
        filtruOra.innerHTML = `<option value="ALL" data-i18n="toate_orele">${window.dict[window.lang]['toate_orele']}</option>` +
            availableHours.map(hour => `<option value="${hour}">${hour}</option>`).join('');
        filtruOra.value = availableHours.includes(selectedHour) ? selectedHour : 'ALL';
        const oraAleasa = filtruOra.value;
        let terenuriDisponibile = terenuriPentruAcestSport.filter(court => {
            const hours = window.getCourtBookingHours(court);
            return hours.length > 0 && (oraAleasa === 'ALL' || hours.includes(oraAleasa));
        });
        if (oraAleasa !== 'ALL') {
            const {data: rezervari, error} = await db.from('rezervari_disponibilitate').select('teren,ora')
                .eq('data_str', dataSelectataDinFiltru).eq('ora', oraAleasa);
            if (request !== filterRequest) return;
            if (error || !rezervari) { containerDinamicTerenuri.textContent = textProgram(true); return; }
            terenuriDisponibile = terenuriDisponibile.filter(court => !rezervari.some(rez => rez.teren === court.nume));
        }
        terenuriDisponibile = terenuriDisponibile.filter(court => normalizaNume(court.nume).includes(searchText));
        containerDinamicTerenuri.innerHTML = '';
        if (terenuriDisponibile.length === 0 && searchText) {
            containerDinamicTerenuri.textContent = window.dict[window.lang]['niciun_teren_cautare'];
            return;
        }
        if (terenuriDisponibile.length === 0) {
            containerDinamicTerenuri.textContent = '0' + (oraAleasa === 'ALL' ? '' : ` / ${oraAleasa}`);
            return;
        }

        terenuriDisponibile.forEach(teren => {
            const divTeren = document.createElement('div');
            divTeren.className = 'card-teren-poza btn-teren';
            const fallbackPhoto = 'assets/imagini/avatar2.png';
            divTeren.innerHTML = `<img src="${window.escapeHtml(window.safeUrl(teren.poza, true) || fallbackPhoto)}" alt="${window.escapeHtml(teren.nume)}"><div class="info-teren-poza"><h3>${window.escapeHtml(teren.nume)}</h3><p>${window.escapeHtml(teren.pret)} ${window.dict[window.lang]['lei_ora']}</p></div>`;
            divTeren.querySelector('img').addEventListener('error', function () {
                if (this.getAttribute('src') !== fallbackPhoto) this.src = fallbackPhoto;
            });
            divTeren.addEventListener('click', () => incarcaInterfataRezervare(teren));
            containerDinamicTerenuri.appendChild(divTeren);
        });
    }

    document.getElementById('filtru-nume')?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        // Invalidate an earlier fetch as soon as the search changes.
        filterRequest++;
        searchTimer = setTimeout(aplicaFiltruSiDeseneazaTerenuri,150);
    });
    document.getElementById('filtru-nume')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); clearTimeout(searchTimer); aplicaFiltruSiDeseneazaTerenuri(); }
    });
    document.getElementById('filtru-data')?.addEventListener('input', actualizeazaDataFiltrului);
    document.getElementById('filtru-data')?.addEventListener('change', () => {
        actualizeazaDataFiltrului();
        aplicaFiltruSiDeseneazaTerenuri();
    });
    document.getElementById('filtru-ora')?.addEventListener('change', aplicaFiltruSiDeseneazaTerenuri);

    function incarcaInterfataRezervare(terenDinDB) {
        bookingContextGeneration++;
        terenCurent = terenDinDB.nume; pretTerenCurent = terenDinDB.pret; pretMingeCurent = terenDinDB.pret_minge !== null ? terenDinDB.pret_minge : 15;
        document.getElementById('buton-vezi-locatia').onclick = () => window.open(window.safeUrl(terenDinDB.locatie), '_blank', 'noopener,noreferrer');
        
        mingeBifata = false; document.getElementById('checkbox-minge').checked = false;
        if (terenDinDB.optiune_minge) {
            document.getElementById('container-minge').style.display = 'flex';
            document.getElementById('text-label-minge').innerText = `${window.dict[window.lang]['nevoie_minge']} (+${pretMingeCurent})`;
        } else document.getElementById('container-minge').style.display = 'none';

        document.getElementById('modal-terenuri').style.display = 'none';
        document.getElementById('modal-rezervare').style.display = 'flex';
        
        // Aplica fundalul sportului si pe modal-rezervare
        const modalRezervare = document.querySelector('#modal-rezervare .modal-continut');
        if (modalRezervare && sportCurent) {
            const sportStr = sportCurent.toLowerCase().replace(/\s+/g, '_');
            const bgStr = (sportStr === 'tenis_picior') ? 'fotbal' : sportStr;
            seteazaFundalSport(modalRezervare, bgStr, true);
        }
        
        window.genereazaZile();
    }

    document.getElementById('inchide-terenuri')?.addEventListener('click', () => {
        document.getElementById('modal-terenuri').style.display = 'none';
        reseteazaFundalSport();
    });
    document.getElementById('inapoi-la-terenuri')?.addEventListener('click', () => { document.getElementById('modal-rezervare').style.display = 'none'; document.getElementById('modal-terenuri').style.display = 'flex';
            
            // Schimba fundalul cu imaginea sportului
            const bgDiv = document.getElementById('fundal-imagine-sport');
            if(bgDiv && sportCurent) {
                const sportStr = sportCurent.toLowerCase().replace(/\s+/g, '_');
                const bgStr = (sportStr === 'tenis_picior') ? 'fotbal' : sportStr;
                
                // Punem background-ul pe ecranul principal (in spatele modalului)
                seteazaFundalSport(bgDiv, bgStr);
                bgDiv.style.opacity = '1';
                
                // Punem background-ul STRICT IN FEREASTRA (modal-continut)
                const modalContinut = document.querySelector('#modal-terenuri .modal-continut');
                if (modalContinut) {
                    seteazaFundalSport(modalContinut, bgStr, true);
                }
            } });
    document.getElementById('inchide-rezervare')?.addEventListener('click', () => {
    document.getElementById('modal-rezervare').style.display = 'none';
    reseteazaFundalSport();
});
    document.getElementById('checkbox-minge')?.addEventListener('change', (e) => { mingeBifata = e.target.checked; actualizeazaButonFinal(); });

    window.genereazaZile = function() {
        const containerZile = document.getElementById('container-zile'); 
        if(!containerZile) return;
        containerZile.innerHTML = '';
        const azi = new Date(`${window.siteDate()}T12:00:00Z`);

        // Extragem data din filtru pentru a o selecta automat
        let indexDeSelectat = 0;
        const filtruDataInput = document.getElementById('filtru-data');
        if (filtruDataInput && filtruDataInput.value) {
            const dataC = new Date(`${filtruDataInput.value}T12:00:00Z`);
            const aziFaraOra = azi;
            const diffDays = Math.round((dataC - aziFaraOra) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 7) {
                indexDeSelectat = diffDays;
            }
        }

        for (let i = 0; i < 7; i++) {
            let dataCurenta = new Date(azi); dataCurenta.setUTCDate(azi.getUTCDate() + i);
            let btnZi = document.createElement('button'); btnZi.className = 'btn-zi' + (i === indexDeSelectat ? ' selectat' : '');
            
            let ziTextVizual = i === 0 ? window.dict[window.lang]['azi'] : (i === 1 ? window.dict[window.lang]['maine'] : window.dict[window.lang]['zile'][dataCurenta.getUTCDay()]);
            
            let ziTextDB = numeZileT_DB[dataCurenta.getUTCDay()];
            let ziNumar = String(dataCurenta.getUTCDate()).padStart(2, '0');
            let lunaNumar = String(dataCurenta.getUTCMonth() + 1).padStart(2, '0');

            btnZi.innerText = `${ziTextVizual}\n${ziNumar}.${lunaNumar}`;
            btnZi.addEventListener('click', () => {
                document.querySelectorAll('.btn-zi').forEach(b => b.classList.remove('selectat')); btnZi.classList.add('selectat');
                bookingContextGeneration++;
                dataSelectataStr = dataCurenta.toISOString().slice(0,10);
                oraSelectata = [];
                incarcaOreDinSupabase();
            });
            containerZile.appendChild(btnZi);
            if (i === indexDeSelectat) btnZi.click();
        }
    };

    async function incarcaOreDinSupabase() {
        if (bookingInFlight) return;
        const selection = [...oraSelectata];
        hoursLoading = true; actualizeazaButonFinal();
        const containerOre = document.getElementById('container-ore');
        containerOre.innerHTML = '<p style="grid-column: span 4; text-align:center;">⏳...</p>';

        const request = ++hoursRequest;
        const requestDay = dataSelectataStr, requestCourt = terenCurent;
        const [availability, settings] = await Promise.all([
            db.from('rezervari_disponibilitate').select('ora').eq('teren', requestCourt).eq('data_str', requestDay),
            db.from('terenuri').select('*').eq('nume', requestCourt).maybeSingle()
        ]);
        if (request !== hoursRequest || requestDay !== dataSelectataStr || requestCourt !== terenCurent) return;
        hoursLoading = false;
        oraSelectata = [];
        actualizeazaButonFinal();
        const rezervariOcupate = availability.data;
        if (availability.error || settings.error || !settings.data || settings.data.este_activ === false) {
            containerOre.textContent = textProgram(true);
            return;
        }
        const oreTeren = window.getCourtBookingHours(settings.data);
        if (!oreTeren.length) { containerOre.textContent = textProgram(); return; }

        let oreOcupateArray = rezervariOcupate ? rezervariOcupate.map(r => r.ora) : [];
        
        const {hour: oraCurenta, minute: minutCurent} = window.siteClock();
        const esteZiuaDeAzi = (dataSelectataStr === window.siteDate());
        
        // SETARE: Cu câte ore înainte se poate face o rezervare cel târziu (Marjă de siguranță)
        const ORE_AVANS_MINIM = 1; 

        // NOU: Verificăm ce a selectat clientul în filtru pentru Oră
        const filtruOraInput = document.getElementById('filtru-ora');
        const oraCautataInFiltru = filtruOraInput ? filtruOraInput.value : 'ALL';
        
        // Verificăm dacă suntem fix pe ziua căutată în filtru
        let suntemPeZiuaCautata = false;
        const filtruDataInput = document.getElementById('filtru-data');
        if (filtruDataInput && filtruDataInput.value) {
            const dataC = new Date(filtruDataInput.value);
            const ziTextDB = numeZileT_DB[dataC.getDay()];
            const ziNumar = String(dataC.getDate()).padStart(2, '0');
            const lunaNumar = String(dataC.getMonth() + 1).padStart(2, '0');
            if (filtruDataInput.value === dataSelectataStr) {
                suntemPeZiuaCautata = true;
            }
        }

        containerOre.innerHTML = '';
        for (const oraTxt of oreTeren) {
            const i = Number(oraTxt.split(':')[0]);
            const btnOra = document.createElement('button');
            btnOra.className = 'btn-ora'; btnOra.innerText = oraTxt;

            // Calculăm dacă e prea din scurt
            let estePreaDinScurt = false;
            if (esteZiuaDeAzi) {
                let minutePanaLaRezervare = (i * 60) - (oraCurenta * 60 + minutCurent);
                if (minutePanaLaRezervare < (ORE_AVANS_MINIM * 60)) {
                    estePreaDinScurt = true;
                }
            }

            if (oreOcupateArray.includes(oraTxt) || estePreaDinScurt) {
                btnOra.classList.add('ocupat'); 
                btnOra.disabled = true; 
                btnOra.innerText += oreOcupateArray.includes(oraTxt) ? ` (${window.dict[window.lang]['ocupat']})` : ` (${window.dict[window.lang]['trecut']})`;
            } else {
                btnOra.addEventListener('click', () => toggleOra(btnOra, oraTxt));
                
                // Dacă ora curentă corespunde cu cea din filtru, o bifăm automat
                if (selection.includes(oraTxt) || (suntemPeZiuaCautata && oraCautataInFiltru === oraTxt)) {
                    btnOra.classList.add('selectat');
                    oraSelectata.push(oraTxt);
                }
            }
            containerOre.appendChild(btnOra);
        }
        
        actualizeazaButonFinal(); // Reactualizăm butonul de rezervare ca să fie verde și gata de plată
    }

    function toggleOra(btn, ora) {
        if (bookingInFlight || hoursLoading) return;
        if (btn.classList.contains('selectat')) { btn.classList.remove('selectat'); oraSelectata = oraSelectata.filter(o => o !== ora); } 
        else { btn.classList.add('selectat'); oraSelectata.push(ora); }
        actualizeazaButonFinal();
    }

    function actualizeazaButonFinal() {
        const butonConfirma = document.getElementById('buton-confirma');
        if (bookingInFlight) { butonConfirma.disabled = true; return; }
        if (hoursLoading || oraSelectata.length === 0) {
            butonConfirma.innerText = window.dict[window.lang]['alegeti_o_ora']; butonConfirma.disabled = true; butonConfirma.style.opacity = '0.5';
        } else {
            let pretTotal = (pretTerenCurent * oraSelectata.length);
            if (mingeBifata) pretTotal += pretMingeCurent;
            butonConfirma.innerText = `${window.dict[window.lang]['rezerva']} (${pretTotal})`; butonConfirma.disabled = false; butonConfirma.style.opacity = '1';
        }
    }

    document.getElementById('buton-confirma')?.addEventListener('click', async () => {
        if (!loggedInUser) {
            document.getElementById('modal-rezervare').style.display = 'none'; reseteazaFundalSport(); document.getElementById('modal-auth').style.display = 'flex'; return;
        }

        if (bookingInFlight || hoursLoading || !oraSelectata.length) return;
        const butonConfirma = document.getElementById('buton-confirma');
        const context = bookingContextGeneration, ownerId = loggedInUser.id;
        const rowsToInsert = oraSelectata.map((ora, index) => ({
            sport: sportCurent, teren: terenCurent, data_str: dataSelectataStr, ora,
            cu_minge: index === 0 && mingeBifata, email_client: loggedInUser.email,
            stare: 'activa', timestamp_start: Date.now()
        }));
        const textButonInitial = butonConfirma.innerText;
        bookingInFlight = true;
        butonConfirma.innerText = 'Se procesează...';
        butonConfirma.disabled = true;
        try {
            const {data: dublura, error: availabilityError} = await db.from('rezervari_disponibilitate')
                .select('ora').eq('teren', rowsToInsert[0].teren).eq('data_str', rowsToInsert[0].data_str)
                .in('ora', rowsToInsert.map(row => row.ora));
            if (context !== bookingContextGeneration || loggedInUser?.id !== ownerId ||
                document.getElementById('modal-rezervare').style.display !== 'flex' ||
                availabilityError || !dublura || dublura.length > 0) return;

            const { error } = await db.from('rezervari').insert(rowsToInsert);
        
            let erori = error ? 1 : 0;
            if (error && error.code === '23505') {
                console.error("Eroare rezervare - dublura:", error);
                alert("Atenție: Una sau mai multe ore selectate tocmai au fost rezervate de altcineva. Vă rugăm să reîncărcați și să alegeți altă oră.");
            } else if (error) {
                console.error("Eroare salvare rezervare:", error);
                alert("Eroare la salvarea rezervării: " + error.message);
            }

            if (erori === 0) {
                document.getElementById('modal-rezervare').style.display = 'none';
                document.getElementById('modal-terenuri').style.display = 'none';
                reseteazaFundalSport();
                afiseazaSuccesRezervare();
            }

        } finally {
            bookingInFlight = false;
            butonConfirma.innerText = textButonInitial;
            actualizeazaButonFinal();
            if (document.getElementById('modal-rezervare').style.display === 'flex') incarcaOreDinSupabase();
        }
    });

    // ----------------------------------------
    // REALTIME REZERVĂRI (pentru update vizual live)
    // ----------------------------------------
    db.channel('rezervari_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rezervari_disponibilitate' }, payload => {
            if (document.getElementById('modal-rezervare')?.style.display === 'flex') {
                if (payload.eventType === 'DELETE') { incarcaOreDinSupabase(); return; }
                if (payload.new && payload.new.teren === terenCurent && payload.new.data_str === dataSelectataStr) {
                    const oraOcupata = payload.new.ora;
                    const btns = document.querySelectorAll('.btn-ora');
                    btns.forEach(b => {
                        if (b.innerText.startsWith(oraOcupata) && !b.classList.contains('ocupat')) {
                            b.classList.add('ocupat');
                            b.disabled = true;
                            b.innerText = `${oraOcupata} (${window.dict[window.lang]['ocupat']})`;
                            if (b.classList.contains('selectat')) {
                                b.classList.remove('selectat');
                                oraSelectata = oraSelectata.filter(o => o !== oraOcupata);
                                actualizeazaButonFinal();
                            }
                        }
                    });
                }
            }
        })
        .subscribe();
    setInterval(() => {
        if (document.visibilityState === 'visible' && document.getElementById('modal-rezervare')?.style.display === 'flex') incarcaOreDinSupabase();
    }, 15000);


    // ==========================================
    // LOGICĂ CHAT CLIENT
    // ==========================================
    const modalChatClient = document.getElementById('modal-chat-client');
    const btnVeziChat = document.getElementById('btn-vezi-chat');
    const btnInchideChatClient = document.getElementById('inchide-chat-client');
    const inputChatClient = document.getElementById('chat-client-input');
    const btnTrimiteChatClient = document.getElementById('chat-client-btn-trimite');
    
    let chatClientRealtime = null;
    let chatClientTerenCurent = null; // Stochează terenul selectat curent pentru conversație
    let chatClientMesajeToate = []; // Toate mesajele clientului
    const avertismentChatClient = document.getElementById('chat-client-avertisment');

    btnVeziChat?.addEventListener('click', () => {
        document.getElementById('modal-profil').style.display = 'none';
        modalChatClient.style.display = 'flex';
        incarcaMesajeClient();
    });

    btnInchideChatClient?.addEventListener('click', () => {
        modalChatClient.style.display = 'none';
        document.getElementById('modal-profil').style.display = 'flex';
    });

    async function initializareRealtimeChatClient() {
        if (chatClientRealtime) db.removeChannel(chatClientRealtime);
        if (!loggedInUser) return;
        
        // Preluare inițială pentru bulină
        await incarcaMesajeClient(false); // Nu randăm interfața, doar actualizăm datele interne și bulina
        
        chatClientRealtime = db.channel('mesaje_chat_client')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mesaje_chat', filter: `email_client=eq.${loggedInUser.email}` }, payload => {
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
        if (!loggedInUser) return;
        const owner = loggedInUser.id;
        
        const { data, error } = await db.from('mesaje_chat')
            .select('*')
            .eq('email_client', loggedInUser.email)
            .order('created_at', { ascending: true });

        if (loggedInUser?.id !== owner) return;
        if (error) { console.error("Eroare chat: ", error); return; }
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
        if (!loggedInUser) return;
        const owner = loggedInUser.id;
        const listaSide = document.getElementById('chat-client-lista-terenuri');
        if (!listaSide) return;
        
        // Obținem lista de terenuri unice din mesajele anterioare
        const terenuriCuMesaje = [...new Set(chatClientMesajeToate.map(m => m.teren))];
        
        // Obținem terenurile unde clientul are rezervare (pentru a-i permite să deschidă chat nou și acolo)
        const { data: rezervari } = await db.from('rezervari').select('teren').eq('email_client', loggedInUser.email);
        if (loggedInUser?.id !== owner) return;
        const terenuriRezervate = rezervari ? [...new Set(rezervari.map(r => r.teren))] : [];
        
        const toateTerenurileClient = [...new Set([...terenuriCuMesaje, ...terenuriRezervate])];
        
        // VERIFICARE: Aducem setările terenurilor ca să vedem unde e oprit chat-ul
        const { data: infoTerenuri } = await db.from('terenuri').select('nume, are_chat');
        if (loggedInUser?.id !== owner) return;
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
            deschideConversatiaClient(chatClientTerenCurent);
        }
    }

    async function deschideConversatiaClient(teren) {
        const owner = loggedInUser?.id;
        const email = loggedInUser?.email;
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

        if (loggedInUser?.id !== owner || chatClientTerenCurent !== teren) return;
        await actualizeazaDreptulChatClient(teren, owner, email);
    }

    async function actualizeazaDreptulChatClient(teren, owner = loggedInUser?.id, email = loggedInUser?.email) {
        if (!owner) return;
        const {data: bookings, error} = await db.from('rezervari').select('*')
            .eq('email_client', email).eq('teren', teren).eq('stare','activa');
        if (loggedInUser?.id !== owner || chatClientTerenCurent !== teren) return;
        const allowed = !error && bookings?.some(r => !window.esteRezervareTrecuta(r.data_str,r.ora,r.timestamp_start));
        inputChatClient.disabled = !allowed;
        btnTrimiteChatClient.disabled = !allowed;
        avertismentChatClient.style.display = allowed ? 'none' : 'block';
    }

    // Trimitere Mesaj Client
    async function trimiteMesajClient() {
        if (!loggedInUser || !chatClientTerenCurent || inputChatClient.disabled) return;
        const text = inputChatClient.value.trim();
        if (!text) return;
        const owner = loggedInUser.id;
        const email = loggedInUser.email;
        const court = chatClientTerenCurent;
        const stillCurrent = () => loggedInUser?.id === owner && chatClientTerenCurent === court
            && document.getElementById('modal-chat-client').style.display !== 'none';
        inputChatClient.disabled = true;
        btnTrimiteChatClient.disabled = true;
        try {
            const {data: bookings, error: bookingError} = await db.from('rezervari')
                .select('*').eq('email_client', email).eq('teren', court).eq('stare', 'activa');
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
    if (loggedInUser) {
        initializareRealtimeChatClient();
    }

    // Mai trebuie să prindem momentul când se loghează și să inițializăm
    const originalLoginBtn = document.getElementById('btn-executa-login');
    if (originalLoginBtn) {
        originalLoginBtn.addEventListener('click', () => {
            setTimeout(() => { if (loggedInUser) initializareRealtimeChatClient(); }, 1500);
        });
    }

    // --- 1. BUTONUL DE AM UITAT PAROLA (Cere emailul si trimite) ---
    const btnUitat = document.getElementById('btn-am-uitat-parola') || document.getElementById('btn-forgot-password');
    if (btnUitat) {
        // Înlocuim butonul cu o clonă pentru a șterge orice "refresh/jump" stricat setat anterior
        const nouBtnUitat = btnUitat.cloneNode(true);
        btnUitat.parentNode.replaceChild(nouBtnUitat, btnUitat);

        nouBtnUitat.addEventListener('click', async (e) => {
            e.preventDefault();
            // Încearcă să ia emailul din câmpul de login. Dacă e gol, cere prin prompt.
            let email = document.getElementById('login-email')?.value.trim();
            if (!email) {
                alert("Te rugăm să introduci adresa de email în căsuța de mai sus, apoi apasă din nou pe Resetare.");
                return;
            }

            const textInitial = nouBtnUitat.innerText;
            nouBtnUitat.innerText = "⏳..."; 
            nouBtnUitat.style.pointerEvents = "none";

            const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
                redirectTo: window.siteHomeUrl(),
            });

            nouBtnUitat.innerText = textInitial; 
            nouBtnUitat.style.pointerEvents = "auto";

            if (error) {
                alert("Eroare la trimitere: " + error.message);
            } else {
                alert("Ți-am trimis un link de resetare a parolei pe email! Verifică și folderul Spam.");
            }
        });
    }

    db.auth.onAuthStateChange((event, session) => {
        if (['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event)) {
            if (!session || (loggedInUser && loggedInUser.id !== session.user?.id)) {
                authGeneration++;
                loggedInUser = null;
                for (const id of ['modal-profil','modal-lista-rezervari','modal-chat-client']) document.getElementById(id).style.display = 'none';
                for (const id of ['chat-client-lista-terenuri','chat-client-mesaje','container-lista-rezervari']) document.getElementById(id)?.replaceChildren();
                inputChatClient.value = '';
                inputChatClient.disabled = true;
                btnTrimiteChatClient.disabled = true;
                chatClientTerenCurent = null;
                chatClientMesajeToate = [];
                if (chatClientRealtime) { const old = chatClientRealtime; chatClientRealtime = null; setTimeout(() => db.removeChannel(old),0); }
            }
            setTimeout(async () => {
                await syncAuthUser(session?.user || null);
                if (!session) {
                    for (const id of ['modal-profil','modal-lista-rezervari','modal-chat-client']) document.getElementById(id).style.display = 'none';
                    if (chatClientRealtime) { db.removeChannel(chatClientRealtime); chatClientRealtime = null; }
                    chatClientMesajeToate = [];
                }
            },0);
        }
    });

});
