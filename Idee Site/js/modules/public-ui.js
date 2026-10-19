// Shared modal lifecycle, sport backgrounds and booking status presentation.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicUi = function() {
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
        function afiseazaSuccesRezervare(message) {
            const notificare = document.getElementById('notificare-rezervare');
            const mesaj = document.getElementById('notificare-rezervare-text');
            if (!notificare || !mesaj) return;
            clearTimeout(temporizatorNotificareRezervare);
            mesaj.textContent = message || window.dict[window.lang]['rezervare_succes'];
            notificare.hidden = false;
            temporizatorNotificareRezervare = setTimeout(() => {
                notificare.hidden = true;
            }, message ? 10000 : 2000);
        }
        function textProgram(indisponibil = false) {
            if (indisponibil) return window.lang === 'hu' ? 'Nem sikerült betölteni az időpontokat. Próbáld újra.' :
                window.lang === 'en' ? 'Availability could not be loaded. Please try again.' :
                'Disponibilitatea nu poate fi încărcată. Încearcă din nou.';
            return window.lang === 'hu' ? 'Erre a pályára nincs foglalható időpont.' :
                window.lang === 'en' ? 'This court has no booking hours available.' :
                'Acest teren nu are ore disponibile pentru rezervări.';
        }

        function mount() {
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

        }
        return {
            mount,
            updateFilterDate: actualizeazaDataFiltrului,
            setSportBackground: seteazaFundalSport,
            resetSportBackground: reseteazaFundalSport,
            showBookingSuccess: afiseazaSuccesRezervare,
            availabilityText: textProgram
        };
    };
})();
