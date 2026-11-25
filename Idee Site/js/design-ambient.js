/*
 * Spotivity design layer (decorative only; nothing depends on it).
 * 1. Ambient light: the glow behind the home gallery takes the colours of the photo on
 *    screen (a blurred copy of it, see .welcome-art::before in design-background.css).
 * 2. Tilt: on devices with a mouse, the gallery leans slightly towards the pointer and a
 *    soft highlight follows it.
 * Both stop for people who ask for reduced motion (the ambient light stays, still).
 * Undo: remove this file, its <script> in index.html and its entry in scripts/public-files.json.
 */
(() => {
    'use strict';
    function start() {
        const art = document.querySelector('.welcome-art');
        const frame = art?.querySelector('.welcome-photo-frame');
        if (!art || !frame) return;
        const front = frame.querySelector('[data-photo-current] img');
        const back = frame.querySelector('[data-photo-next]');
        const backImg = back?.querySelector('img');
        let shown = '';
        function sync() {
            const entering = back && !back.hidden && back.classList.contains('is-entering') && backImg?.src;
            const src = entering ? backImg.src : front?.currentSrc || front?.src;
            if (!src || src === shown) return;
            shown = src;
            art.style.setProperty('--design-ambient', `url("${src.replace(/["\\\n\r]/g, encodeURIComponent)}")`);
            art.classList.add('has-ambient');
        }
        const watch = new MutationObserver(sync);
        if (front) watch.observe(front, { attributes: true, attributeFilter: ['src'] });
        if (back) watch.observe(back, { attributes: true, attributeFilter: ['class', 'hidden'] });
        front?.addEventListener('load', sync);
        sync();

        const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let frameRequest = 0, lastEvent = null;
        function apply() {
            frameRequest = 0;
            if (!lastEvent) return;
            const box = frame.getBoundingClientRect();
            const x = Math.min(Math.max((lastEvent.clientX - box.left) / box.width, 0), 1);
            const y = Math.min(Math.max((lastEvent.clientY - box.top) / box.height, 0), 1);
            frame.style.setProperty('--tilt-x', `${((.5 - y) * 7).toFixed(2)}deg`);
            frame.style.setProperty('--tilt-y', `${((x - .5) * 9).toFixed(2)}deg`);
            frame.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
            frame.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
        }
        frame.addEventListener('pointermove', event => {
            if (!finePointer.matches || reduced.matches || event.pointerType !== 'mouse') return;
            lastEvent = event;
            frame.classList.add('is-tilting');
            if (!frameRequest) frameRequest = requestAnimationFrame(apply);
        });
        frame.addEventListener('pointerleave', () => {
            lastEvent = null;
            frame.classList.remove('is-tilting');
            for (const name of ['--tilt-x', '--tilt-y']) frame.style.setProperty(name, '0deg');
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
