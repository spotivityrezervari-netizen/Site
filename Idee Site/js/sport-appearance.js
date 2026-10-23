// Public visual settings only. Booking and staff authorization remain in Supabase RLS.
(() => {
    const defaults = {
        Fotbal: { sport: 'Fotbal', icona_url: 'assets/imagini/fotbalrealist.png', fundal_url: 'assets/imagini/FotbalFinal.jpeg', ordine: 1 },
        Baschet: { sport: 'Baschet', icona_url: 'assets/imagini/baschetrealist.png', fundal_url: 'assets/imagini/BaschetFinal.jpeg', ordine: 2 },
        Tenis: { sport: 'Tenis', icona_url: 'assets/imagini/tenisrealist.png', fundal_url: 'assets/imagini/TenisFINAL.jpeg', ordine: 3 },
        Volei: { sport: 'Volei', icona_url: 'assets/imagini/voleirealist.png', fundal_url: 'assets/imagini/RealistVolei.png', ordine: 4 },
        'Tenis Picior': { sport: 'Tenis Picior', icona_url: 'assets/imagini/fotbalrealist.png', fundal_url: 'assets/imagini/RealistTenispicior.png', ordine: 5 }
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
    window.spotivitySportAppearance = { ...defaults };
    window.getSportAppearance = sport => window.spotivitySportAppearance[sportKey(sport)] || defaults.Fotbal;
    window.applySportAppearance = (root = document) => {
        for (const [attribute, column] of [['data-sport-icon', 'icona_url'], ['data-sport-background', 'fundal_url']]) {
            root.querySelectorAll(`img[${attribute}]`).forEach(img => {
                const key = sportKey(img.getAttribute(attribute));
                if (!key) return;
                const source = window.spotivitySportAppearance[key][column];
                if (img.getAttribute('src') !== source) img.src = source;
                if (!img.dataset.appearanceFallbackBound) {
                    img.dataset.appearanceFallbackBound = 'true';
                    img.addEventListener('error', () => {
                        if (img.getAttribute('src') !== defaults[key][column]) img.src = defaults[key][column];
                    });
                }
            });
        }
    };
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
                        fundal_url: safeImage(row.fundal_url) || defaults[key].fundal_url,
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
