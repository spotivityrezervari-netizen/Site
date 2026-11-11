/* Welcome photos share one frame; booking and sport navigation stay separate. */
(() => {
    'use strict';
    function init() {
        const gallery = document.querySelector('[data-welcome-gallery]');
        if (!gallery) return;
        const image = gallery.querySelector('.welcome-cover');
        const frame = gallery.querySelector('.welcome-photo-frame');
        const buttons = [...gallery.querySelectorAll('[data-welcome-sport]')];
        const toggle = gallery.querySelector('[data-gallery-toggle]');
        const controls = gallery.querySelector('.welcome-gallery-controls');
        const photos = [
            { sport: 'Fotbal', file: 'BackgroundFootball.avif', position: '55% 50%' },
            { sport: 'Baschet', file: 'BackgroundBasketball.avif', position: '68% 50%' },
            { sport: 'Tenis', file: 'TenisFINAL.jpeg', position: '50% 50%' },
            { sport: 'Volei', file: 'BackgroundVoleyball.avif', position: '52% 50%' },
            { sport: 'Tenis Picior', file: 'BackgroundLavolei.avif', position: '50% 50%' }
        ];
        const labels = {
            ro: { title: 'Fotografiile sporturilor', pause: 'Oprește schimbarea fotografiilor', play: 'Reia schimbarea fotografiilor' },
            hu: { title: 'Sportfotók', pause: 'Képváltás szüneteltetése', play: 'Képváltás folytatása' },
            en: { title: 'Sports photographs', pause: 'Pause photo rotation', play: 'Resume photo rotation' }
        };
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let current = 0, desired = 0, generation = 0, pending = 0, timer;
        let paused = false, hovered = false, visible = false, explicitPlay = false;

        function syncControls() {
            const text = labels[window.lang] || labels.ro;
            controls.setAttribute('aria-label', text.title);
            buttons.forEach((button, index) => {
                const sport = photos[index].sport;
                const label = window.dict?.[window.lang]?.[sport.toLowerCase()] || sport;
                button.setAttribute('aria-label', label);
                button.title = label;
                button.setAttribute('aria-pressed', String(index === current));
            });
            toggle.hidden = reduced.matches;
            toggle.setAttribute('aria-label', paused ? text.play : text.pause);
            toggle.title = paused ? text.play : text.pause;
            toggle.setAttribute('aria-pressed', String(paused));
            toggle.querySelector('path').setAttribute('d', paused ? 'M6 4l7 4-7 4z' : 'M5 4v8M11 4v8');
        }
        function canRotate() {
            return visible && !document.hidden && !paused && !reduced.matches
                && (explicitPlay || (!hovered && !gallery.contains(document.activeElement)))
                && !document.body.classList.contains('fara-scroll')
                && !document.body.classList.contains('home-menu-open');
        }
        function schedule() {
            clearTimeout(timer);
            if (canRotate() && !pending) timer = setTimeout(() => void show((current + 1) % photos.length).then(schedule), 7000);
        }
        const absolute = source => new URL(window.appAssetUrl(source), window.siteHomeUrl()).href;
        async function load(source) {
            const candidate = new Image();
            candidate.decoding = 'async';
            candidate.src = source;
            await candidate.decode();
            return candidate;
        }
        async function show(index, manual = false) {
            desired = index;
            const request = ++generation;
            pending = request;
            clearTimeout(timer);
            const photo = photos[index];
            const fallback = absolute(`assets/imagini/${photo.file}`);
            const preferred = absolute(window.getSportAppearance?.(photo.sport)?.fundal_url || `assets/imagini/${photo.file}`);
            try {
                let decoded;
                try { decoded = await load(preferred); }
                catch {
                    if (preferred === fallback) return;
                    try { decoded = await load(fallback); } catch { return; }
                }
                if (request !== generation || (!manual && !canRotate())) return;
                image.src = decoded.src;
                image.width = decoded.naturalWidth;
                image.height = decoded.naturalHeight;
                image.dataset.fit = decoded.naturalHeight > decoded.naturalWidth ? 'contain' : 'cover';
                image.dataset.gallerySport = photo.sport;
                image.style.objectPosition = photo.position;
                frame.style.setProperty('--welcome-photo', `url(${JSON.stringify(decoded.src)})`);
                current = index;
                syncControls();
            } finally {
                if (pending === request) pending = 0;
            }
        }
        buttons.forEach((button, index) => button.addEventListener('click', () => {
            explicitPlay = false;
            clearTimeout(timer);
            void show(index, true).then(schedule);
        }));
        toggle.addEventListener('click', () => {
            paused = !paused;
            explicitPlay = !paused;
            if (paused) { generation++; pending = 0; desired = current; }
            syncControls(); schedule();
        });
        gallery.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { hovered = true; explicitPlay = false; schedule(); } });
        gallery.addEventListener('pointerleave', () => { hovered = false; schedule(); });
        gallery.addEventListener('focusin', event => { if (event.target !== toggle) explicitPlay = false; schedule(); });
        gallery.addEventListener('focusout', () => setTimeout(schedule, 0));
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('spotivity:language', syncControls);
        window.addEventListener('spotivity:sport-appearance', () => { if (visible) void show(desired, true).then(schedule); });
        const motionChanged = () => { syncControls(); schedule(); };
        if (reduced.addEventListener) reduced.addEventListener('change', motionChanged);
        else reduced.addListener(motionChanged);
        new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        if (window.IntersectionObserver) {
            new IntersectionObserver(entries => {
                visible = entries[0].isIntersecting;
                if (visible) void show(desired, true).then(schedule);
                else schedule();
            }, { threshold: .2 }).observe(gallery);
        } else { visible = true; void show(0, true).then(schedule); }
        syncControls();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
