/* Clear welcome photos rotate automatically from right to left. */
(() => {
    'use strict';
    function init() {
        const gallery = document.querySelector('[data-welcome-gallery]');
        if (!gallery) return;
        const image = gallery.querySelector('.welcome-cover');
        const front = gallery.querySelector('[data-photo-current]');
        const back = gallery.querySelector('[data-photo-next]');
        const frame = gallery.querySelector('.welcome-photo-frame');
        const backImage = back.querySelector('img');
        const buttons = [...gallery.querySelectorAll('[data-welcome-sport]')];
        const toggle = gallery.querySelector('[data-gallery-toggle]');
        const controls = gallery.querySelector('.welcome-gallery-controls');
        const photos = [
            { sport: 'Fotbal', slug: 'fotbal', file: 'BackgroundFootball.avif' },
            { sport: 'Baschet', slug: 'baschet', file: 'BackgroundBasketball.avif' },
            { sport: 'Tenis', slug: 'tenis', file: 'TenisFINAL.jpeg' },
            { sport: 'Volei', slug: 'volei', file: 'BackgroundVoleyball.avif' },
            { sport: 'Tenis Picior', slug: 'tenis-de-picior', file: 'BackgroundLavolei.avif' }
        ];
        const labels = {
            ro: { title: 'Fotografiile sporturilor', pause: 'Oprește schimbarea fotografiilor', play: 'Reia schimbarea fotografiilor' },
            hu: { title: 'Sportfotók', pause: 'Képváltás szüneteltetése', play: 'Képváltás folytatása' },
            en: { title: 'Sports photographs', pause: 'Pause photo rotation', play: 'Resume photo rotation' }
        };
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        // One complete cycle includes both the still photograph and its slide.
        const slideIntervalMs = 2500, transitionDurationMs = 600;
        const decodedImages = new Map();
        let current = 0, desired = 0, generation = 0, pending = 0, timer;
        let previewGeneration = 0, transition = null, outgoingTransition = null;
        let paused = false, visible = false, bookingFocused = false;

        function syncCard(card, index) {
            const photo = photos[index];
            const text = window.dict?.[window.lang];
            const sport = text?.[photo.sport.toLowerCase()] || photo.sport;
            const reserve = text?.home_rezerva || 'Rezervă un teren';
            const link = card.querySelector('.welcome-photo-link');
            card.dataset.galleryIndex = String(index);
            link.dataset.sport = photo.sport;
            link.href = new URL(`terenuri/${photo.slug}/`, window.siteHomeUrl()).href;
            link.setAttribute('aria-label', `${reserve} — ${sport}`);
            link.querySelector('[data-slide-title]').textContent = sport;
            link.querySelector('[data-slide-cta]').textContent = reserve;
        }
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
            syncCard(front, current);
            if (back.dataset.galleryIndex !== undefined) syncCard(back, Number(back.dataset.galleryIndex));
        }
        function canRotate() {
            return visible && !document.hidden && !paused && !bookingFocused && !reduced.matches
                && !document.body.classList.contains('fara-scroll')
                && !document.body.classList.contains('home-menu-open');
        }
        function schedule() {
            clearTimeout(timer);
            if (canRotate() && !pending) timer = setTimeout(() => void show((current + 1) % photos.length).then(schedule), slideIntervalMs - transitionDurationMs);
        }
        const absolute = source => new URL(window.appAssetUrl(source), window.siteHomeUrl()).href;
        function load(source) {
            if (!decodedImages.has(source)) {
                const promise = (async () => {
                    const candidate = new Image();
                    candidate.decoding = 'async';
                    candidate.src = source;
                    await candidate.decode();
                    return candidate;
                })();
                decodedImages.set(source, promise);
                promise.catch(() => { if (decodedImages.get(source) === promise) decodedImages.delete(source); });
            }
            return decodedImages.get(source);
        }
        async function photoImage(index) {
            const photo = photos[index];
            const fallback = absolute(`assets/imagini/${photo.file}`);
            const selected = window.getSportAppearance?.(photo.sport)?.fundal_url || `assets/imagini/${photo.file}`;
            const preferred = absolute(window.getSportBackgroundSource?.(photo.sport, selected) || selected);
            try { return await load(preferred); }
            catch (error) { if (preferred === fallback) throw error; return load(fallback); }
        }
        function fillCard(card, img, decoded, index) {
            card.style.setProperty('--photo-ratio', String(decoded.naturalWidth / decoded.naturalHeight));
            img.src = decoded.src;
            img.width = decoded.naturalWidth;
            img.height = decoded.naturalHeight;
            img.draggable = false;
            syncCard(card, index);
        }
        function cancelTransition() {
            if (transition) { transition.cancel(); transition = null; }
            if (outgoingTransition) { outgoingTransition.cancel(); outgoingTransition = null; }
            back.hidden = true;
            back.classList.remove('is-entering');
        }
        async function preparePreview() {
            const version = ++previewGeneration;
            try {
                const index = (current + 1) % photos.length;
                const decoded = await photoImage(index);
                if (version !== previewGeneration || pending) return;
                fillCard(back, backImage, decoded, index);
                back.hidden = true;
            } catch { if (version === previewGeneration) back.hidden = true; }
        }
        async function show(index, manual = false) {
            desired = index;
            const request = ++generation;
            pending = request;
            clearTimeout(timer);
            previewGeneration++;
            cancelTransition();
            const photo = photos[index];
            try {
                let decoded;
                try { decoded = await photoImage(index); } catch { return; }
                if (request !== generation || (!manual && !canRotate())) return;
                let animation;
                if (image.src !== decoded.src && visible && !document.hidden && !reduced.matches && back.animate) {
                    fillCard(back, backImage, decoded, index);
                    back.hidden = false;
                    back.classList.add('is-entering');
                    const distance = frame.clientWidth + 24;
                    const timing = { duration: transitionDurationMs, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' };
                    outgoingTransition = front.animate([
                        { transform: 'translate3d(0, 0, 0)' },
                        { transform: `translate3d(${-distance}px, 0, 0)` }
                    ], timing);
                    animation = transition = back.animate([
                        { transform: `translate3d(${distance}px, 0, 0)` },
                        { transform: 'translate3d(0, 0, 0)' }
                    ], timing);
                    try { await animation.finished; } catch { return; }
                    if (request !== generation) return;
                }
                fillCard(front, image, decoded, index);
                image.dataset.gallerySport = photo.sport;
                current = index;
                syncControls();
                cancelTransition();
            } finally {
                if (pending === request) {
                    pending = 0;
                    if (visible) void preparePreview();
                }
            }
        }
        for (const card of [front, back]) {
            const link = card.querySelector('.welcome-photo-link');
            // The incoming copy is pointer-operable, but never receives keyboard
            // focus while it is moving or duplicates the committed slide for AT.
            if (card === back) link.addEventListener('mousedown', event => {
                if (event.button === 0) event.preventDefault();
            });
            link.addEventListener('click', event => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const index = Number(card.dataset.galleryIndex);
                const photo = photos[index];
                const primary = photo && [...document.querySelectorAll('button.card-sport[data-sport]')]
                    .find(button => button.dataset.sport === photo.sport);
                // Keep the real category URL usable before the booking module
                // mounts, with JavaScript disabled, and for modified clicks.
                if (!primary || typeof window.openSpotivityCourtList !== 'function') return;
                event.preventDefault();
                bookingFocused = event.detail === 0 && link.matches(':focus-visible');
                generation++; previewGeneration++; pending = 0;
                clearTimeout(timer);
                fillCard(front, image, card.querySelector('img'), index);
                current = desired = index;
                image.dataset.gallerySport = photo.sport;
                cancelTransition(); syncControls();
                front.querySelector('.welcome-photo-link').focus({ preventScroll: true });
                primary.click();
                schedule();
            });
        }
        gallery.addEventListener('focusin', event => {
            const link = event.target.closest('.welcome-photo-link');
            if (!link || !front.contains(link) || !link.matches(':focus-visible')) return;
            bookingFocused = true;
            generation++; previewGeneration++; pending = 0; desired = current;
            cancelTransition(); schedule();
        });
        gallery.addEventListener('focusout', () => {
            bookingFocused = front.contains(document.activeElement) && document.activeElement.matches('.welcome-photo-link:focus-visible');
            schedule();
        });
        buttons.forEach((button, index) => button.addEventListener('click', () => {
            clearTimeout(timer);
            void show(index, true).then(schedule);
        }));
        toggle.addEventListener('click', () => {
            paused = !paused;
            if (paused) {
                generation++; previewGeneration++; pending = 0; desired = current;
                cancelTransition();
                if (visible) void preparePreview();
            }
            syncControls(); schedule();
        });
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('spotivity:language', syncControls);
        window.addEventListener('spotivity:sport-appearance', () => { if (visible) void show(desired, true).then(schedule); });
        const motionChanged = () => {
            if (reduced.matches && outgoingTransition) outgoingTransition.finish();
            if (reduced.matches && transition) transition.finish();
            syncControls(); schedule();
        };
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
