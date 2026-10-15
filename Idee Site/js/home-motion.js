/* Gentle motion enhances the existing cards without cloning or changing booking controls. */
(() => {
    'use strict';
    const copy = {
        ro: { pause: 'Pauză derulare', resume: 'Reia derularea' },
        hu: { pause: 'Görgetés szüneteltetése', resume: 'Görgetés folytatása' },
        en: { pause: 'Pause scrolling', resume: 'Resume scrolling' }
    };

    function init() {
        const main = document.getElementById('home-main');
        if (!main || !document.body.classList.contains('pagina-publica') || !window.requestAnimationFrame) return;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const strips = new Map();
        const revealed = new WeakSet();
        let frame = 0, measurement = 0, wakeTimer = 0, previousTime = 0, nextId = 0;
        let blocked = false;
        const speed = 18, interactionDelay = 6000, edgeDelay = 1200;

        function setStatus(state, status) {
            if (state.strip.dataset.autoScroll !== status) state.strip.dataset.autoScroll = status;
        }

        function wake() {
            clearTimeout(wakeTimer);
            wakeTimer = 0;
            if (!frame && !blocked) frame = requestAnimationFrame(animate);
        }

        function animate(time) {
            frame = 0;
            const elapsed = previousTime ? Math.min(time - previousTime, 48) : 0;
            previousTime = time;
            let running = false, nextWake = Infinity;
            for (const state of strips.values()) {
                if (state.max <= 1 || reducedMotion.matches) { setStatus(state, 'idle'); continue; }
                if (blocked || state.paused || state.hovered || state.focused || state.pointer || !state.visible) {
                    setStatus(state, 'paused');
                    continue;
                }
                if (time < state.resumeAfter) {
                    nextWake = Math.min(nextWake, state.resumeAfter - time);
                    setStatus(state, 'paused');
                    continue;
                }
                setStatus(state, 'running');
                running = true;
                state.position += state.direction * speed * elapsed / 1000;
                if ((state.direction > 0 && state.position >= state.max) || (state.direction < 0 && state.position <= 0)) {
                    state.position = Math.max(0, Math.min(state.max, state.position));
                    state.direction = state.position === 0 ? 1 : -1;
                    state.resumeAfter = time + edgeDelay;
                }
                state.strip.scrollLeft = state.position;
                // Browsers may round fractional pixels; retain the accumulated position.
                state.expected = state.strip.scrollLeft;
            }
            if (running && !blocked) frame = requestAnimationFrame(animate);
            else {
                previousTime = 0;
                if (Number.isFinite(nextWake) && !blocked) wakeTimer = setTimeout(wake, Math.max(16, nextWake));
            }
        }

        function pauseForInteraction(state) {
            state.resumeAfter = performance.now() + interactionDelay;
            setStatus(state, state.max > 1 && !reducedMotion.matches ? 'paused' : 'idle');
            wake();
        }

        function updateButton(state) {
            const labels = copy[window.lang] || copy.ro;
            const label = state.paused ? labels.resume : labels.pause;
            const sport = window.dict?.[window.lang]?.[state.strip.dataset.homeCourts.toLowerCase()] || state.strip.dataset.homeCourts;
            if (state.button.textContent !== label) state.button.textContent = label;
            state.button.setAttribute('aria-label', `${label} — ${sport}`);
            state.button.dataset.paused = String(state.paused);
            const hidden = state.max <= 1 || reducedMotion.matches;
            if (hidden && document.activeElement === state.button) state.strip.focus({ preventScroll: true });
            state.button.hidden = hidden;
            // Keep native snap from moving cards after autoplay pauses beneath a pointer.
            state.strip.classList.toggle('home-courts-autoplay', !hidden);
        }

        function addStrip(strip) {
            const wrapper = strip.closest('.home-courts-wrap');
            if (!wrapper) return;
            if (!strip.id) strip.id = `home-courts-motion-${++nextId}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'home-courts-motion-toggle';
            button.dataset.homeMotionToggle = strip.dataset.homeCourts;
            button.setAttribute('aria-controls', strip.id);
            button.hidden = true;
            wrapper.append(button);
            const state = {
                strip, wrapper, button, max: 0, position: strip.scrollLeft, expected: strip.scrollLeft,
                direction: 1, resumeAfter: performance.now() + edgeDelay, paused: false,
                hovered: false, focused: wrapper.contains(document.activeElement), pointer: false, visible: false, listeners: []
            };
            strips.set(strip, state);
            const listen = (target, name, listener, options) => {
                target.addEventListener(name, listener, options);
                state.listeners.push(() => target.removeEventListener(name, listener, options));
            };
            listen(button, 'click', () => {
                state.paused = !state.paused;
                state.resumeAfter = performance.now() + 300;
                updateButton(state);
                wake();
            });
            listen(wrapper, 'pointerenter', event => { if (event.pointerType !== 'touch') { state.hovered = true; wake(); } });
            listen(wrapper, 'pointerleave', event => { if (event.pointerType !== 'touch') { state.hovered = false; wake(); } });
            listen(wrapper, 'focusin', () => { state.focused = true; wake(); });
            listen(wrapper, 'focusout', () => {
                setTimeout(() => { state.focused = wrapper.contains(document.activeElement); wake(); }, 0);
            });
            listen(strip, 'pointerdown', () => { state.pointer = true; pauseForInteraction(state); }, { passive: true });
            listen(strip, 'wheel', () => pauseForInteraction(state), { passive: true });
            listen(strip, 'keydown', event => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(event.key)) pauseForInteraction(state);
            });
            listen(strip, 'scroll', () => {
                const position = strip.scrollLeft;
                if (Math.abs(position - state.expected) > .75) {
                    state.position = state.expected = position;
                    pauseForInteraction(state);
                }
            }, { passive: true });
            resizeObserver?.observe(strip);
            visibilityObserver?.observe(strip);
        }

        function reveal(section) {
            section.classList.remove('home-section-pending');
            revealObserver?.unobserve(section);
        }

        const visibilityObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
            for (const entry of entries) {
                const state = strips.get(entry.target);
                if (state) state.visible = entry.isIntersecting && entry.intersectionRatio > 0;
            }
            wake();
        }, { threshold: .01 }) : null;
        const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
            for (const entry of entries) if (entry.isIntersecting) reveal(entry.target);
        }, { rootMargin: '0px 0px -24px 0px', threshold: 0 }) : null;
        const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(() => scheduleMeasure()) : null;

        function measure() {
            measurement = 0;
            for (const strip of main.querySelectorAll('.home-courts-strip[data-home-courts]')) if (!strips.has(strip)) addStrip(strip);
            for (const [strip, state] of strips) {
                if (!strip.isConnected) {
                    state.listeners.forEach(remove => remove());
                    state.button.remove();
                    resizeObserver?.unobserve(strip);
                    visibilityObserver?.unobserve(strip);
                    strips.delete(strip);
                    continue;
                }
                state.max = Math.max(0, strip.scrollWidth - strip.clientWidth);
                state.position = state.expected = strip.scrollLeft;
                const bounds = strip.getBoundingClientRect();
                state.visible = bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth;
                updateButton(state);
                if (state.max <= 1 || reducedMotion.matches) setStatus(state, 'idle');
            }
            if (revealObserver) {
                for (const section of main.querySelectorAll('.home-sport-hero, .home-bases-section')) {
                    if (revealed.has(section)) continue;
                    revealed.add(section);
                    const bounds = section.getBoundingClientRect();
                    if (reducedMotion.matches || bounds.top < innerHeight && bounds.bottom > 0) continue;
                    section.classList.add('home-section-reveal', 'home-section-pending');
                    revealObserver.observe(section);
                }
            }
            wake();
        }

        function scheduleMeasure() {
            if (!measurement) measurement = requestAnimationFrame(measure);
        }

        function updateBlocked() {
            blocked = document.hidden || document.body.classList.contains('fara-scroll') || document.body.classList.contains('home-menu-open')
                || [...document.querySelectorAll('.modal')].some(modal => getComputedStyle(modal).display !== 'none');
            if (blocked) {
                cancelAnimationFrame(frame);
                clearTimeout(wakeTimer);
                frame = wakeTimer = previousTime = 0;
                for (const state of strips.values()) setStatus(state, state.max > 1 && !reducedMotion.matches ? 'paused' : 'idle');
            } else wake();
        }

        new MutationObserver(records => {
            if (records.some(record => record.target.matches?.('.home-courts-strip')
                || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
                    && (node.matches('.home-courts-strip, .home-sport-hero, .home-bases-section') || node.querySelector('.home-courts-strip'))))) scheduleMeasure();
        }).observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
        new MutationObserver(records => {
            if (records.some(record => record.target === document.body || record.target.matches?.('.modal'))) updateBlocked();
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        const releasePointer = () => {
            for (const state of strips.values()) if (state.pointer) { state.pointer = false; pauseForInteraction(state); }
        };
        window.addEventListener('pointerup', releasePointer, { passive: true });
        window.addEventListener('pointercancel', releasePointer, { passive: true });
        window.addEventListener('resize', scheduleMeasure, { passive: true });
        if (!visibilityObserver) window.addEventListener('scroll', scheduleMeasure, { passive: true });
        window.addEventListener('spotivity:language', scheduleMeasure);
        document.getElementById('filtru-oras-global')?.addEventListener('change', scheduleMeasure);
        document.addEventListener('visibilitychange', updateBlocked);
        document.addEventListener('focusin', event => {
            const section = event.target.closest?.('.home-section-pending');
            if (section) reveal(section);
        });
        const motionPreferenceChanged = () => {
            if (reducedMotion.matches) main.querySelectorAll('.home-section-pending').forEach(reveal);
            scheduleMeasure();
        };
        if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', motionPreferenceChanged);
        else reducedMotion.addListener(motionPreferenceChanged);
        updateBlocked();
        measure();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
