/* Gentle motion enhances the existing cards without cloning or changing booking controls. */
(() => {
    'use strict';

    function init() {
        const roots = ['home-main', 'owner-home'].map(id => document.getElementById(id)).filter(Boolean);
        if (!roots.length || !document.body.classList.contains('pagina-publica') || !window.requestAnimationFrame) return;
        const findAll = selector => roots.flatMap(root => Array.from(root.querySelectorAll(selector)));
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const strips = new Map();
        const revealed = new WeakSet();
        let frame = 0, measurement = 0, wakeTimer = 0, previousTime = 0;
        let blocked = false;
        // 25.11.2026 (owner): rows keep moving no matter what — hover, focus, touch and
        // page scrolling never stop them. Only a manual horizontal drag/fling takes over
        // the row; the motion continues from the new spot as soon as that gesture settles.
        const speed = 22, acceleration = 20, settleDelay = 220, friction = 3.2, dragThreshold = 6;

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
                if (state.max <= 1 || reducedMotion.matches) { state.velocity = 0; setStatus(state, 'idle'); continue; }
                if (blocked || !state.visible || state.dragging) {
                    state.velocity = state.fling = 0;
                    setStatus(state, 'paused');
                    continue;
                }
                if (state.fling) {
                    // Mouse throw: glide with friction, then hand the remaining speed
                    // to the autoplay in the direction the visitor threw the row.
                    setStatus(state, 'running');
                    running = true;
                    const seconds = elapsed / 1000;
                    state.position += state.fling * seconds;
                    state.fling *= Math.exp(-friction * seconds);
                    if (state.position <= 0 || state.position >= state.max) {
                        state.position = Math.max(0, Math.min(state.max, state.position));
                        state.direction = state.position <= 0 ? 1 : -1;
                        state.velocity = state.fling = 0;
                    } else if (Math.abs(state.fling) <= speed) {
                        state.direction = state.fling < 0 ? -1 : 1;
                        state.velocity = state.fling;
                        state.fling = 0;
                    }
                    writePosition(state);
                    continue;
                }
                if (time < state.resumeAfter) {
                    nextWake = Math.min(nextWake, state.resumeAfter - time);
                    state.velocity = 0;
                    setStatus(state, 'paused');
                    continue;
                }
                setStatus(state, 'running');
                running = true;
                const seconds = elapsed / 1000;
                const remaining = state.direction > 0 ? state.max - state.position : state.position;
                // Brake before each edge and accelerate gently after a pause or reversal.
                const targetSpeed = Math.min(speed, Math.sqrt(2 * acceleration * Math.max(0, remaining)));
                const targetVelocity = state.direction * targetSpeed;
                const maxChange = acceleration * seconds;
                state.velocity += Math.max(-maxChange, Math.min(maxChange, targetVelocity - state.velocity));
                state.position += state.velocity * seconds;
                if ((state.direction > 0 && state.position >= state.max) || (state.direction < 0 && state.position <= 0)) {
                    state.position = Math.max(0, Math.min(state.max, state.position));
                    state.direction *= -1;
                    state.velocity = 0;
                }
                writePosition(state);
            }
            if (running && !blocked) frame = requestAnimationFrame(animate);
            else {
                previousTime = 0;
                if (Number.isFinite(nextWake) && !blocked) wakeTimer = setTimeout(wake, Math.max(16, nextWake));
            }
        }

        function writePosition(state) {
            state.strip.scrollLeft = state.position;
            state.expected = state.strip.scrollLeft;
            // Native scrolling can round to whole pixels. Composite the remainder
            // so the cards still advance by a fraction of a pixel on every frame.
            state.strip.style.setProperty('--home-courts-offset', `${(state.expected - state.position).toFixed(4)}px`);
        }

        function pauseForInteraction(state) {
            state.resumeAfter = performance.now() + settleDelay;
            state.velocity = 0;
            setStatus(state, state.max > 1 && !reducedMotion.matches ? 'paused' : 'idle');
            wake();
        }

        function updateMotion(state) {
            const enabled = state.max > 1 && !reducedMotion.matches;
            // Native snap must not pull the row backwards between animation frames.
            state.strip.classList.toggle('home-courts-autoplay', enabled);
            if (!enabled) state.strip.style.removeProperty('--home-courts-offset');
            if (!state.dragging) state.strip.style.cursor = state.max > 1 ? 'grab' : '';
        }

        function addStrip(strip) {
            const wrapper = strip.closest('.home-courts-wrap');
            if (!wrapper) return;
            const state = {
                strip, max: 0, position: strip.scrollLeft, expected: strip.scrollLeft,
                direction: 1, velocity: 0, resumeAfter: performance.now() + 400,
                visible: false, listeners: [], dragging: false, fling: 0, touch: null, mouse: null
            };
            strips.set(strip, state);
            const listen = (target, name, listener, options) => {
                target.addEventListener(name, listener, options);
                state.listeners.push(() => target.removeEventListener(name, listener, options));
            };
            listen(strip, 'scroll', () => {
                const position = strip.scrollLeft;
                if (Math.abs(position - state.expected) > .75) {
                    state.position = state.expected = position;
                    state.strip.style.removeProperty('--home-courts-offset');
                    pauseForInteraction(state);
                }
            }, { passive: true });

            // 25.11.2026 (owner): visitors can swipe/drag the moving row left-right to
            // look for a court faster. A horizontal finger swipe hands the row to the
            // browser's native scroll (autoplay stops writing so it never fights the
            // finger); a tap or a vertical page swipe leaves the row moving.
            listen(strip, 'touchstart', event => {
                const point = event.touches[0];
                state.touch = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null;
            }, { passive: true });
            listen(strip, 'touchmove', event => {
                if (!state.touch || state.dragging) return;
                const point = event.touches[0], dx = point.clientX - state.touch.x, dy = point.clientY - state.touch.y;
                if (Math.abs(dx) > dragThreshold && Math.abs(dx) > Math.abs(dy)) {
                    state.dragging = true;
                    state.direction = dx < 0 ? 1 : -1;
                    state.velocity = state.fling = 0;
                    setStatus(state, 'paused');
                }
            }, { passive: true });
            const endTouch = event => {
                if (event.touches.length) return;
                state.touch = null;
                if (!state.dragging) return;
                state.dragging = false;
                // The native fling keeps firing scroll events; autoplay resumes once it settles.
                state.position = state.expected = strip.scrollLeft;
                strip.style.removeProperty('--home-courts-offset');
                pauseForInteraction(state);
            };
            listen(strip, 'touchend', endTouch, { passive: true });
            listen(strip, 'touchcancel', endTouch, { passive: true });

            // Desktop: drag the row with the mouse and throw it. A real drag never
            // opens the card it started on; a plain click still does.
            listen(strip, 'pointerdown', event => {
                if (event.pointerType !== 'mouse' || event.button !== 0) return;
                state.mouse = { id: event.pointerId, x: event.clientX, start: strip.scrollLeft, moved: false, samples: [] };
            });
            listen(strip, 'pointermove', event => {
                const mouse = state.mouse;
                if (!mouse || event.pointerId !== mouse.id) return;
                const dx = event.clientX - mouse.x;
                if (!mouse.moved) {
                    if (Math.abs(dx) <= dragThreshold) return;
                    mouse.moved = true;
                    state.dragging = true;
                    state.velocity = state.fling = 0;
                    strip.setPointerCapture?.(event.pointerId);
                    strip.style.cursor = 'grabbing';
                    strip.style.userSelect = 'none';
                    setStatus(state, 'paused');
                }
                strip.scrollLeft = mouse.start - dx;
                state.position = state.expected = strip.scrollLeft;
                strip.style.removeProperty('--home-courts-offset');
                const now = performance.now();
                mouse.samples.push({ t: now, x: event.clientX });
                while (mouse.samples.length > 2 && now - mouse.samples[0].t > 90) mouse.samples.shift();
            });
            const endMouse = event => {
                const mouse = state.mouse;
                if (!mouse || event.pointerId !== mouse.id) return;
                state.mouse = null;
                if (!mouse.moved) return;
                state.dragging = false;
                strip.style.cursor = state.max > 1 ? 'grab' : '';
                strip.style.userSelect = '';
                if (strip.hasPointerCapture?.(event.pointerId)) strip.releasePointerCapture(event.pointerId);
                const first = mouse.samples[0], last = mouse.samples[mouse.samples.length - 1];
                const fresh = last && performance.now() - last.t < 120 && last.t > first.t;
                const throwSpeed = fresh ? -(last.x - first.x) / (last.t - first.t) * 1000 : 0;
                if (Math.abs(throwSpeed) > speed) {
                    state.fling = Math.max(-4000, Math.min(4000, throwSpeed));
                    state.resumeAfter = 0;
                } else {
                    if (event.clientX !== mouse.x) state.direction = event.clientX < mouse.x ? 1 : -1;
                    state.resumeAfter = performance.now() + settleDelay;
                }
                if (event.type === 'pointerup') {
                    // Swallow the click that ends a drag so it does not open a booking.
                    const swallow = click => { click.preventDefault(); click.stopPropagation(); };
                    strip.addEventListener('click', swallow, { capture: true, once: true });
                    setTimeout(() => strip.removeEventListener('click', swallow, { capture: true }), 0);
                }
                wake();
            };
            listen(strip, 'pointerup', endMouse);
            listen(strip, 'pointercancel', endMouse);
            listen(strip, 'dragstart', event => { if (state.mouse) event.preventDefault(); });
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
            // A section skipped above the viewport (fast jump to the footer) is revealed too,
            // so it is never left transparent when the visitor scrolls back.
            for (const entry of entries) if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) reveal(entry.target);
        }, { rootMargin: '0px 0px -24px 0px', threshold: 0 }) : null;
        const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(() => scheduleMeasure()) : null;

        function measure() {
            measurement = 0;
            for (const strip of findAll('.home-courts-strip[data-home-courts], .home-courts-strip[data-owner-courts]')) if (!strips.has(strip)) addStrip(strip);
            for (const [strip, state] of strips) {
                if (!strip.isConnected) {
                    state.listeners.forEach(remove => remove());
                    resizeObserver?.unobserve(strip);
                    visibilityObserver?.unobserve(strip);
                    strips.delete(strip);
                    continue;
                }
                state.max = Math.max(0, strip.scrollWidth - strip.clientWidth);
                if (Math.abs(strip.scrollLeft - state.expected) > .75) {
                    state.position = state.expected = strip.scrollLeft;
                    strip.style.removeProperty('--home-courts-offset');
                    state.velocity = 0;
                }
                state.position = Math.max(0, Math.min(state.max, state.position));
                const bounds = strip.getBoundingClientRect();
                state.visible = bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth;
                updateMotion(state);
                if (state.max <= 1 || reducedMotion.matches) setStatus(state, 'idle');
            }
            if (revealObserver) {
                for (const section of findAll('.home-sport-hero, .home-bases-section')) {
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
                || document.body.classList.contains('owner-home-menu-open') || document.body.classList.contains('owner-home-dialog-open')
                || [...document.querySelectorAll('.modal')].some(modal => getComputedStyle(modal).display !== 'none');
            if (blocked) {
                cancelAnimationFrame(frame);
                clearTimeout(wakeTimer);
                frame = wakeTimer = previousTime = 0;
                for (const state of strips.values()) {
                    state.velocity = 0;
                    setStatus(state, state.max > 1 && !reducedMotion.matches ? 'paused' : 'idle');
                }
            } else wake();
        }

        const contentObserver = new MutationObserver(records => {
            if (records.some(record => record.target.matches?.('.home-courts-strip')
                || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
                    && (node.matches('.home-courts-strip, .home-sport-hero, .home-bases-section') || node.querySelector('.home-courts-strip'))))) scheduleMeasure();
        });
        roots.forEach(root => contentObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] }));
        new MutationObserver(records => {
            if (records.some(record => record.target === document.body || record.target.matches?.('.modal'))) updateBlocked();
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
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
            if (reducedMotion.matches) findAll('.home-section-pending').forEach(reveal);
            scheduleMeasure();
        };
        if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', motionPreferenceChanged);
        else reducedMotion.addListener(motionPreferenceChanged);
        updateBlocked();
        measure();
        keepHashTarget();

        // A direct link such as #sport-tenis must stay on its section while the
        // court cards above it load and push the page down.
        function keepHashTarget() {
            let id = '';
            try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
            if (!/^[A-Za-z][\w-]{0,80}$/.test(id)) return;
            const target = document.getElementById(id);
            if (!target || !roots.some(root => root.contains(target))) return;
            let userMoved = false;
            const stop = () => { userMoved = true; };
            const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
            events.forEach(name => window.addEventListener(name, stop, { passive: true, once: true }));
            const align = () => {
                if (userMoved || !target.isConnected) return;
                const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
                if (Math.abs(target.getBoundingClientRect().top - margin) > 2) target.scrollIntoView({ block: 'start', behavior: 'instant' });
            };
            const layoutObserver = 'ResizeObserver' in window ? new ResizeObserver(align) : null;
            roots.forEach(root => layoutObserver?.observe(root));
            setTimeout(() => {
                layoutObserver?.disconnect();
                events.forEach(name => window.removeEventListener(name, stop));
            }, 5000);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
