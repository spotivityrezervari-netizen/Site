/* Visual navigation delegates to the existing account and booking controls. */
(() => {
    'use strict';

    const copy = {
        ro: {
            home_alege_oras: 'Alege orașul și găsește terenul potrivit.', home_profil: 'Profilul meu',
            home_rezerva: 'Rezervă un teren', home_vezi_terenuri: 'Vezi terenurile',
            home_subtitlu_fotbal: 'Jocul începe aici.', home_subtitlu_baschet: 'Fiecare aruncare contează.',
            home_subtitlu_tenis: 'Următorul punct e al tău.', home_subtitlu_volei: 'Adună echipa. Intră în joc.'
        },
        hu: {
            home_alege_oras: 'Válassz várost, és találd meg a megfelelő pályát.', home_profil: 'Profilom',
            home_rezerva: 'Pálya foglalása', home_vezi_terenuri: 'Pályák megtekintése',
            home_subtitlu_fotbal: 'Itt kezdődik a játék.', home_subtitlu_baschet: 'Minden dobás számít.',
            home_subtitlu_tenis: 'Tiéd a következő pont.', home_subtitlu_volei: 'Hívd a csapatod. Játsszatok együtt.'
        },
        en: {
            home_alege_oras: 'Choose your city and find your next court.', home_profil: 'My profile',
            home_rezerva: 'Book a court', home_vezi_terenuri: 'Explore courts',
            home_subtitlu_fotbal: 'The game starts here.', home_subtitlu_baschet: 'Make every shot count.',
            home_subtitlu_tenis: 'The next point is yours.', home_subtitlu_volei: 'Bring your team. Join the game.'
        }
    };
    for (const [lang, labels] of Object.entries(copy)) {
        if (window.dict?.[lang]) Object.assign(window.dict[lang], labels);
    }

    function initNavigation() {
        const menu = document.getElementById('home-mobile-menu');
        const toggle = document.getElementById('btn-mobile-menu');
        const profile = document.getElementById('btn-top-cont');
        const bases = document.getElementById('btn-home-baze');
        if (!menu || !toggle || !profile) return;
        const desktop = window.matchMedia('(min-width: 768px)');
        const backgroundRegions = ['home-city-region', 'home-main', 'home-footer']
            .map(id => document.getElementById(id)).filter(Boolean);
        let previousFocus = null;
        let previousScroll = 0;

        function menuLabel(open) {
            if (window.lang === 'hu') return open ? 'Menü bezárása' : 'Menü megnyitása';
            if (window.lang === 'en') return open ? 'Close menu' : 'Open menu';
            return open ? 'Închide meniul' : 'Deschide meniul';
        }

        function closeMenu(restoreFocus = true) {
            if (menu.hidden) return;
            menu.hidden = true;
            document.body.classList.remove('home-menu-open');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', menuLabel(false));
            backgroundRegions.forEach(region => { region.inert = false; });
            profile.inert = false;
            if (bases) bases.inert = false;
            window.scrollTo({ top: previousScroll, behavior: 'instant' });
            if (restoreFocus && previousFocus?.isConnected && !desktop.matches) previousFocus.focus({ preventScroll: true });
        }

        function openMenu() {
            if (desktop.matches) return;
            previousFocus = document.activeElement;
            previousScroll = window.scrollY;
            menu.hidden = false;
            document.body.classList.add('home-menu-open');
            toggle.setAttribute('aria-expanded', 'true');
            toggle.setAttribute('aria-label', menuLabel(true));
            backgroundRegions.forEach(region => { region.inert = true; });
            profile.inert = true;
            if (bases) bases.inert = true;
            menu.querySelector('button')?.focus({ preventScroll: true });
        }

        toggle.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu());
        document.getElementById('home-brand')?.addEventListener('click', () => closeMenu(false));
        document.querySelectorAll('[data-sport-target]').forEach(button => {
            button.addEventListener('click', () => {
                const sport = button.getAttribute('data-sport-target');
                closeMenu(false);
                const primary = [...document.querySelectorAll('.card-sport[data-sport]')]
                    .find(card => card.getAttribute('data-sport') === sport);
                primary?.click();
            });
        });
        document.querySelectorAll('[data-profile-target]').forEach(button => {
            button.addEventListener('click', () => { closeMenu(false); profile.click(); });
        });
        document.querySelectorAll('[data-bases-target]').forEach(button => {
            button.addEventListener('click', () => {
                closeMenu(false);
                window.openSportsBases?.();
            });
        });
        document.addEventListener('keydown', event => {
            if (menu.hidden) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = [document.getElementById('home-brand'), toggle, ...menu.querySelectorAll('button')].filter(Boolean);
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        });
        const onResize = () => { if (desktop.matches) closeMenu(false); };
        if (desktop.addEventListener) desktop.addEventListener('change', onResize);
        else desktop.addListener(onResize);
        // A restored auth/recovery dialog also closes the visual menu cleanly.
        new MutationObserver(() => {
            if (!menu.hidden && document.body.classList.contains('fara-scroll')) closeMenu(false);
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNavigation, { once: true });
    else initNavigation();
})();
