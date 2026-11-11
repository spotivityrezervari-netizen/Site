// Public visual settings only. Booking and staff authorization remain in Supabase RLS.
(() => {
    const defaults = {
        Fotbal: { sport: 'Fotbal', icona_url: 'assets/imagini/fotbalrealist.png', fundal_url: 'assets/imagini/BackgroundFootball.avif', ordine: 1 },
        Baschet: { sport: 'Baschet', icona_url: 'assets/imagini/baschetrealist.png', fundal_url: 'assets/imagini/BackgroundBasketball.avif', ordine: 2 },
        Tenis: { sport: 'Tenis', icona_url: 'assets/imagini/tenisrealist.png', fundal_url: 'assets/imagini/TenisFINAL.jpeg', ordine: 3 },
        Volei: { sport: 'Volei', icona_url: 'assets/imagini/voleirealist.png', fundal_url: 'assets/imagini/BackgroundVoleyball.avif', ordine: 4 },
        'Tenis Picior': { sport: 'Tenis Picior', icona_url: 'assets/imagini/fotbalrealist.png', fundal_url: 'assets/imagini/BackgroundLavolei.avif', ordine: 5 }
    };
    const keys = new Map(Object.keys(defaults).map(sport => [sport.toLocaleLowerCase('ro-RO'), sport]));
    keys.set('tenis de picior', 'Tenis Picior');
    const sportKey = value => keys.get(String(value ?? '').trim().toLocaleLowerCase('ro-RO').replace(/[_\s]+/g, ' '));
    window.normalizeSportName = value => sportKey(value) || String(value ?? '').trim();
    const safeImage = value => {
        const safe = window.safeUrl(value, true);
        if (/^assets\/imagini\/[a-zA-Z0-9_.-]+$/.test(safe)) return safe;
        try { return new URL(safe).protocol === 'https:' ? safe : ''; } catch { return ''; }
    };
    // Older visual migrations/live settings still name the retired bundled
    // photographs. Upgrade only those exact defaults; retain custom images.
    const retiredBackgrounds = {
        Fotbal: ['fundal-fotbal.webp', 'RealistFotbal.png', 'RealistFotbal1.png', 'FotbalFinal.jpeg', 'BackgroundFootball.avif'],
        Baschet: ['fundal-baschet.webp', 'RealisBaschet.png', 'BaschetFinal.jpeg', 'BackgroundBasketball.avif'],
        Tenis: ['fundal-tenis.webp', 'RealistTenis.png', 'TenisFINAL.jpeg', 'TenisVFinal.jpg'],
        Volei: ['fundal-volei.webp', 'RealistVolei.png', 'VoleiVFinal.jpg', 'BackgroundVoleyball.avif'],
        'Tenis Picior': ['fundal-tenis-picior.webp', 'RealistTenispicior.png', 'BackgroundLavolei.avif']
    };
    const pagesHome = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
    const exactBundledImage = (value, path) => value === path || value === new URL(path, pagesHome).href;
    // Keep the small original photos on phones. Only the two low-resolution
    // bundled sources have restored desktop copies; custom settings take priority.
    const desktopBackgrounds = {
        Volei: 'assets/imagini/BackgroundVoleyball-desktop.jpg',
        'Tenis Picior': 'assets/imagini/BackgroundLavolei-desktop.jpg'
    };
    const desktop = window.matchMedia?.('(min-width: 1024px)');
    const desktopBackground = (key, source) => desktopBackgrounds[key]
        && exactBundledImage(source, defaults[key].fundal_url) ? desktopBackgrounds[key] : '';
    const backgroundImage = (sport, value) => {
        const safe = safeImage(value);
        return exactBundledImage(safe, defaults[sport].fundal_url)
            || retiredBackgrounds[sport]?.some(file => exactBundledImage(safe, `assets/imagini/${file}`))
            ? defaults[sport].fundal_url : safe || defaults[sport].fundal_url;
    };
    window.spotivitySportAppearance = { ...defaults };
    window.getSportAppearance = sport => window.spotivitySportAppearance[sportKey(sport)] || defaults.Fotbal;
    window.getSportBackgroundSource = (sport, source) => {
        const key = sportKey(sport);
        const selected = source || window.getSportAppearance(sport).fundal_url;
        return (desktop?.matches && key && desktopBackground(key, selected)) || selected;
    };
    window.applySportAppearance = (root = document) => {
        for (const [attribute, column] of [['data-sport-icon', 'icona_url'], ['data-sport-background', 'fundal_url'], ['data-sport-ambient', 'fundal_url']]) {
            root.querySelectorAll(`img[${attribute}]`).forEach(img => {
                const key = sportKey(img.getAttribute(attribute));
                if (!key) return;
                const selected = window.spotivitySportAppearance[key][column];
                const source = window.appAssetUrl(selected);
                const desktopSource = column === 'fundal_url'
                    ? img.closest?.('picture')?.querySelector('source[data-sport-desktop]') : null;
                if (desktopSource) {
                    const hd = desktopBackground(key, selected);
                    const srcset = hd && img.dataset.failedDesktopSource !== hd ? window.appAssetUrl(hd) : '';
                    if (desktopSource.getAttribute('srcset') !== srcset) desktopSource.setAttribute('srcset', srcset);
                }
                if (img.getAttribute('src') !== source) img.src = source;
                if (!img.dataset.appearanceFallbackBound) {
                    img.dataset.appearanceFallbackBound = 'true';
                    if (column === 'fundal_url') {
                        const fitScene = () => {
                            if (img.naturalWidth && img.naturalHeight) img.closest?.('.home-hero-art')?.style.setProperty('--home-photo-ratio', String(img.naturalWidth / img.naturalHeight));
                        };
                        img.addEventListener('load', fitScene);
                        fitScene();
                    }
                    img.addEventListener('error', () => {
                        if (desktopSource?.getAttribute('srcset')) {
                            img.dataset.failedDesktopSource = desktopBackgrounds[key];
                            desktopSource.setAttribute('srcset', '');
                        }
                        const fallback = window.appAssetUrl(defaults[key][column]);
                        if (img.getAttribute('src') !== fallback) img.src = fallback;
                    });
                }
            });
        }
    };
    const desktopChanged = () => window.dispatchEvent(new CustomEvent('spotivity:sport-appearance', { detail: window.spotivitySportAppearance }));
    if (desktop?.addEventListener) desktop.addEventListener('change', desktopChanged);
    else desktop?.addListener(desktopChanged);
    document.addEventListener('DOMContentLoaded', () => window.applySportAppearance());
    window.spotivitySportAppearanceReady = (async () => {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 10000);
        try {
            const { data, error } = await db.from('site_sporturi')
                .select('sport,icona_url,fundal_url,ordine').order('ordine').abortSignal(abort.signal);
            if (!error && Array.isArray(data)) {
                for (const row of data) {
                    const key = sportKey(row.sport);
                    if (!key) continue;
                    window.spotivitySportAppearance[key] = {
                        ...defaults[key],
                        icona_url: safeImage(row.icona_url) || defaults[key].icona_url,
                        fundal_url: backgroundImage(key, row.fundal_url),
                        ordine: Number.isInteger(row.ordine) ? row.ordine : defaults[key].ordine
                    };
                }
            }
        } catch {
            // Bundled images also work if public settings are temporarily unavailable.
        } finally {
            clearTimeout(timeout);
        }
        window.applySportAppearance();
        window.dispatchEvent(new CustomEvent('spotivity:sport-appearance', { detail: window.spotivitySportAppearance }));
        return window.spotivitySportAppearance;
    })();
})();
