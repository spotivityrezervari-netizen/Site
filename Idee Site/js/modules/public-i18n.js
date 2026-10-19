// Translations and booking date labels used by the public and admin interfaces.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicI18n = function() {
        window.dict = {
            'ro': {
                'rezervare_succes': 'Rezervarea a fost realizată cu succes.',
                'contul_meu': 'Contul Meu', 'login_cont': 'Login / Cont', 'fotbal': 'Fotbal', 'baschet': 'Baschet', 'tenis': 'Tenis', 'volei': 'Volei', 'tenis picior': 'Tenis de picior',
                'autentificare': 'Autentificare', 'creare_cont': 'Creare Cont', 'email': 'Adresă Email', 'parola': 'Parolă', 'telefon': 'Număr de Telefon',
                'nume_complet': 'Nume Complet (Username)',
                'intra_cont': 'Intră în cont', 'btn_creare_cont': 'Creează Cont', 'profil_titlu': 'Profilul Tău', 'rez_active': 'Rezervări Active',
                'istoric': 'Istoric Rezervări', 'deconectare': 'Deconectare', 'inapoi_profil': 'Înapoi la Profil', 'alege_terenul': 'Alege Terenul',
                'data_dorita': 'Data Dorită', 'ora_dorita': 'Ora Dorită', 'toate_orele': 'Toate Orele', 'inapoi': 'Înapoi',
                'finalizare_rezervare': 'Finalizare Rezervare', 'nevoie_minge': 'Ai nevoie de minge?', 'alege_ziua': 'Alege Ziua',
                'alege_ora': 'Alege ore consecutive', 'disclaimer': 'Rezervarea poate fi anulată gratuit până la încheierea orei rezervate.',
                'vezi_locatia': 'Vezi Locația (Hartă)', 'alegeti_o_ora': 'Alegeți o oră', 'zile': ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"], 'azi': 'Azi', 'maine': 'Mâine',
                'lei_ora': 'Lei/oră', 'ocupat': 'Ocupat', 'trecut': 'Trecut', 'rezerva': 'Rezervă', 'se_cauta': 'Se caută terenuri disponibile...',
                'fara_rezervari': 'Nu ai rezervări momentan.', 'anuleaza': '❌ Anulează (Gratuit)',
                'chat_btn': 'Chat', 'rez_active_titlu': 'Rezervările Tale Active', 'chat_titlu': '💬 Mesaje Chat',
                'chat_cauta_conv': 'Se caută conversații...', 'chat_alege_conv': 'Alege o conversație',
                'chat_selecteaza_stanga': 'Selectează un teren din stânga pentru a vedea mesajele.', 'chat_scrie': 'Scrie un mesaj...',
                'chat_avertisment': 'Este nevoie de rezervare pentru a trimite un chat', 'nume_nesetat': 'Nume Nesetat',
                'fotbal_tenis_picior': 'Fotbal', 'copyright_text': '© 2026 Numele SRL', 'drepturi_rezervate': 'Toate drepturile rezervate',
                'info_legale': 'Info Legale', 'info_legale_titlu': 'Informații Legale', 'legal_denumire': 'Denumire:', 'legal_reg': 'Reg. Comerțului:',
                'legal_sediu': 'Sediu Social:', 'legal_contact': 'Contact:', 'legal_anpc': 'Protecția Consumatorilor (ANPC):', 'legal_sol': 'Soluționare Online a Litigiilor (SOL):',
                'legal_termeni': 'Termeni și Condiții', 'legal_gdpr': 'Politica de Confidențialitate (GDPR)', 'legal_cookies': 'Politica de Cookies',
                'copyright_footer': '© 2026 Numele SRL. Toate drepturile rezervate.', 'toate_orasele': 'Toate Orașele'
            },
            'hu': {
                'rezervare_succes': 'A foglalás sikeresen megtörtént.',
                'contul_meu': 'Fiókom', 'login_cont': 'Belépés / Fiók', 'fotbal': 'Foci', 'baschet': 'Kosárlabda', 'tenis': 'Tenisz', 'volei': 'Röplabda', 'tenis picior': 'Lábtenisz',
                'autentificare': 'Bejelentkezés', 'creare_cont': 'Regisztráció', 'email': 'E-mail cím', 'parola': 'Jelszó', 'telefon': 'Telefonszám',
                'nume_complet': 'Teljes Név (Felhasználónév)',
                'intra_cont': 'Belépés', 'btn_creare_cont': 'Fiók létrehozása', 'profil_titlu': 'Profilod', 'rez_active': 'Aktív foglalások',
                'istoric': 'Foglalási előzmények', 'deconectare': 'Kijelentkezés', 'inapoi_profil': 'Vissza a profilhoz', 'alege_terenul': 'Pálya kiválasztása',
                'data_dorita': 'Kívánt dátum', 'ora_dorita': 'Kívánt időpont', 'toate_orele': 'Minden időpont', 'inapoi': 'Vissza',
                'finalizare_rezervare': 'Foglalás véglegesítése', 'nevoie_minge': 'Szükséged van labdára?', 'alege_ziua': 'Válassz napot',
                'alege_ora': 'Válassz időpontot (többet is lehet)', 'disclaimer': 'A foglalás a lefoglalt óra végéig ingyenesen lemondható.',
                'vezi_locatia': 'Helyszín (Térkép)', 'alegeti_o_ora': 'Válassz időpontot', 'zile': ["Vas", "Hét", "Ked", "Sze", "Csü", "Pén", "Szo"], 'azi': 'Ma', 'maine': 'Holnap',
                'lei_ora': 'RON/óra', 'ocupat': 'Foglalt', 'trecut': 'Elmúlt', 'rezerva': 'Foglalás', 'se_cauta': 'Szabad pályák keresése...',
                'fara_rezervari': 'Jelenleg nincsenek foglalásaid.', 'anuleaza': '❌ Lemondás (Ingyenes)',
                'chat_btn': 'Chat', 'rez_active_titlu': 'Aktív foglalásaid', 'chat_titlu': '💬 Chat üzenetek',
                'chat_cauta_conv': 'Beszélgetések keresése...', 'chat_alege_conv': 'Válassz egy beszélgetést',
                'chat_selecteaza_stanga': 'Válassz egy pályát balról az üzenetek megtekintéséhez.', 'chat_scrie': 'Írj egy üzenetet...',
                'chat_avertisment': 'Üzenet küldéséhez aktív foglalás szükséges',
                'fotbal_tenis_picior': 'Foci', 'copyright_text': '© 2026 Numele SRL', 'drepturi_rezervate': 'Minden jog fenntartva',
                'info_legale': 'Jogi Információk', 'info_legale_titlu': 'Jogi Információk', 'legal_denumire': 'Cégnév:', 'legal_reg': 'Cégjegyzékszám:',
                'legal_sediu': 'Székhely:', 'legal_contact': 'Kapcsolat:', 'legal_anpc': 'Fogyasztóvédelem (ANPC):', 'legal_sol': 'Online vitarendezés (SOL):',
                'legal_termeni': 'Feltételek és Szabályok', 'legal_gdpr': 'Adatvédelmi Irányelvek (GDPR)', 'legal_cookies': 'Süti Szabályzat',
                'copyright_footer': '© 2026 Numele SRL. Minden jog fenntartva.', 'toate_orasele': 'Minden Város'
            },
            'en': {
                'rezervare_succes': 'Booking completed successfully.',
                'contul_meu': 'My Account', 'login_cont': 'Login / Account', 'fotbal': 'Football', 'baschet': 'Basketball', 'tenis': 'Tennis', 'volei': 'Volleyball', 'tenis picior': 'Foot tennis',
                'autentificare': 'Login', 'creare_cont': 'Register', 'email': 'Email Address', 'parola': 'Password', 'telefon': 'Phone Number',
                'nume_complet': 'Full Name (Username)',
                'intra_cont': 'Sign In', 'btn_creare_cont': 'Create Account', 'profil_titlu': 'Your Profile', 'rez_active': 'Active Bookings',
                'istoric': 'Booking History', 'deconectare': 'Logout', 'inapoi_profil': 'Back to Profile', 'alege_terenul': 'Choose Court',
                'data_dorita': 'Desired Date', 'ora_dorita': 'Desired Time', 'toate_orele': 'All Hours', 'inapoi': 'Back',
                'finalizare_rezervare': 'Finalize Booking', 'nevoie_minge': 'Need a ball?', 'alege_ziua': 'Choose Day',
                'alege_ora': 'Choose consecutive hours', 'disclaimer': 'You can cancel your booking for free until the booked hour ends.',
                'vezi_locatia': 'View Location (Map)', 'alegeti_o_ora': 'Choose a time', 'zile': ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], 'azi': 'Today', 'maine': 'Tomorrow',
                'lei_ora': 'RON/hour', 'ocupat': 'Booked', 'trecut': 'Passed', 'rezerva': 'Book', 'se_cauta': 'Searching for available courts...',
                'fara_rezervari': 'You have no bookings at the moment.', 'anuleaza': '❌ Cancel (Free)',
                'chat_btn': 'Chat', 'rez_active_titlu': 'Your Active Bookings', 'chat_titlu': '💬 Chat Messages',
                'chat_cauta_conv': 'Searching for conversations...', 'chat_alege_conv': 'Choose a conversation',
                'chat_selecteaza_stanga': 'Select a court from the left to view messages.', 'chat_scrie': 'Type a message...',
                'chat_avertisment': 'An active booking is required to send a message', 'nume_nesetat': 'Name Not Set',
                'fotbal_tenis_picior': 'Football', 'copyright_text': '© 2026 Numele SRL', 'drepturi_rezervate': 'All rights reserved',
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
            window.dispatchEvent(new Event('spotivity:language'));
        };
    };
})();
