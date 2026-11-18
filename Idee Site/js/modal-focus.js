// Keyboard focus for the older public dialogs that have no focus handling of
// their own (login, profile, court list, booking, history, chat, legal, new
// password). When one opens, focus moves into it; Tab and Shift+Tab stay
// inside it; when it closes, focus returns to the control that opened it.
// Dialogs with their own controllers (search, bases, registration, profile
// editor, admin workspace, guest booking, email links...) are left untouched.
(() => {
    'use strict';
    if (window.spotivityModalFocus) return;
    const LEGACY = ['modal-auth', 'modal-profil', 'modal-lista-rezervari', 'modal-terenuri',
        'modal-rezervare', 'modal-chat-client', 'modal-legal', 'modal-parola-noua'];
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
        'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const shown = node => !!node && node.isConnected && node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== 'hidden';
    const panelOf = modal => modal.querySelector(':scope > .modal-continut') || modal.querySelector('.modal-continut') || modal;
    const isLegacy = node => !!node && LEGACY.includes(node.id);
    const openers = new Map();   // modal element -> { el, fallback }
    const wasOpen = new WeakMap(); // modal element -> boolean

    function prepare(modal) {
        if (modal.dataset.focusReady === '1') return;
        modal.dataset.focusReady = '1';
        const panel = panelOf(modal);
        if (!modal.hasAttribute('role') && !panel.hasAttribute('role')) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            const title = panel.querySelector('h1, h2, h3');
            if (title) {
                if (!title.id) title.id = `${modal.id}-titlu`;
                panel.setAttribute('aria-labelledby', title.id);
            }
        }
        if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
        panel.querySelectorAll('.buton-inchidere').forEach(button => {
            if (!button.hasAttribute('aria-label') && /^\s*[X×✕]\s*$/.test(button.textContent)) {
                button.setAttribute('aria-label', 'Închide');
            }
            if (!button.hasAttribute('type')) button.type = 'button';
        });
    }

    // The dialog on top: innermost open dialog, then highest z-index, then the
    // last one in the page.
    function topmost() {
        const open = [...document.querySelectorAll('.modal, [aria-modal="true"]')]
            .map(node => node.closest('.modal') || node)
            .filter((node, index, list) => list.indexOf(node) === index && shown(node));
        const leaves = open.filter(node => !open.some(other => other !== node && node.contains(other)));
        let best = null; let bestZ = -Infinity;
        for (const node of leaves) {
            const z = Number.parseInt(getComputedStyle(node).zIndex, 10) || 0;
            if (z >= bestZ) { best = node; bestZ = z; }
        }
        return best;
    }

    const items = modal => [...modal.querySelectorAll(FOCUSABLE)]
        .filter(node => !node.closest('[hidden], [inert]') && shown(node));

    function opened(modal) {
        prepare(modal);
        const active = document.activeElement;
        if (active && active !== document.body && !modal.contains(active)) {
            const parent = LEGACY.map(id => document.getElementById(id)).find(m => m && m.contains(active));
            openers.set(modal, { el: active, fallback: parent ? openers.get(parent)?.el || openers.get(parent)?.fallback : null });
        }
        requestAnimationFrame(() => {
            if (!shown(modal) || modal.contains(document.activeElement) || topmost() !== modal) return;
            panelOf(modal).focus({ preventScroll: true });
        });
    }

    function closed(modal) {
        const saved = openers.get(modal);
        openers.delete(modal);
        if (!saved) return;
        requestAnimationFrame(() => {
            const active = document.activeElement;
            if (active && active !== document.body && !modal.contains(active)) return;
            const top = topmost();
            const target = [saved.el, saved.fallback].find(node => shown(node) && (!top || top.contains(node)));
            target?.focus({ preventScroll: true });
        });
    }

    function check() {
        const states = LEGACY.map(id => document.getElementById(id)).filter(Boolean)
            .map(modal => ({ modal, now: shown(modal), before: wasOpen.get(modal) === true }));
        // Openings first, so a dialog opened from another one remembers its way back.
        states.filter(s => s.now && !s.before).forEach(s => opened(s.modal));
        states.filter(s => !s.now && s.before).forEach(s => closed(s.modal));
        states.forEach(s => wasOpen.set(s.modal, s.now));
        // A dynamic dialog removed from the page (new password) is closed too.
        for (const modal of [...openers.keys()]) if (!modal.isConnected) closed(modal);
    }

    let scheduled = false;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; check(); });
    };
    const touchesModal = node => node.nodeType === 1 && (node.matches('.modal') || !!node.querySelector('.modal'));

    function start() {
        LEGACY.map(id => document.getElementById(id)).filter(Boolean).forEach(modal => {
            prepare(modal);
            wasOpen.set(modal, shown(modal));
        });
        new MutationObserver(records => {
            if (records.some(record => record.type === 'childList'
                ? [...record.addedNodes, ...record.removedNodes].some(touchesModal)
                : record.target.nodeType === 1 && record.target.matches('.modal'))) schedule();
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });

        document.addEventListener('keydown', event => {
            if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
            const top = topmost();
            if (!isLegacy(top)) return;
            const list = items(top);
            const panel = panelOf(top);
            const active = document.activeElement;
            if (!list.length) { event.preventDefault(); panel.focus({ preventScroll: true }); return; }
            const first = list[0]; const last = list[list.length - 1];
            if (!top.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
            else if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
        });
        // Dialogs already open at load (court and base pages open the booking form).
        LEGACY.map(id => document.getElementById(id)).filter(m => m && shown(m)).forEach(opened);
    }

    window.spotivityModalFocus = { check };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
