/* Account deletion: red "Șterge contul" at the bottom of the client profile and
   of the 3-bar menu (confirmed by typing the account name), and the superadmin
   "Conturi utilizatori" panel. Every rule is enforced in SQL (migration 050):
   delete_my_account, admin_list_accounts, admin_delete_account. */
(() => {
    'use strict';
    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    const copy = {
        ro: {
            button: 'Șterge contul',
            title: 'Șterge contul',
            intro: 'Contul, datele de autentificare și profilul tău vor fi șterse definitiv. Nu mai poți intra cu acest cont, iar operația nu poate fi anulată.',
            keep: 'Istoricul rezervărilor rămâne la bazele sportive, fără legătură cu un cont. Dacă ai rezervări viitoare, anulează-le mai întâi din „Rezervări active”.',
            label: 'Pentru confirmare, scrie numele tău exact cum apare în profil: {name}',
            confirm: 'Șterge definitiv contul',
            cancel: 'Renunță',
            working: 'Se șterge contul…',
            word: 'Numele scris nu corespunde contului. Scrie: {name}',
            future: 'Ai {n} ore rezervate în viitor. Anulează-le din „Rezervări active”, apoi încearcă din nou.',
            admin: 'Conturile de administrator nu se pot șterge de aici. Cere ștergerea superadminului.',
            session: 'Sesiunea a expirat. Conectează-te din nou.',
            failed: 'Contul nu a putut fi șters. Încearcă din nou.',
            done: 'Contul a fost șters.'
        },
        hu: {
            button: 'Fiók törlése',
            title: 'Fiók törlése',
            intro: 'A fiókod, a bejelentkezési adataid és a profilod véglegesen törlődnek. Ezzel a fiókkal többé nem tudsz belépni, és a művelet nem vonható vissza.',
            keep: 'A foglalási előzmények fiók nélkül megmaradnak a sportközpontoknál. Ha jövőbeli foglalásod van, előbb mondd le az „Aktív foglalások” menüben.',
            label: 'Megerősítéshez írd be a neved úgy, ahogy a profilodban szerepel: {name}',
            confirm: 'Fiók végleges törlése',
            cancel: 'Mégse',
            working: 'Fiók törlése…',
            word: 'A beírt név nem egyezik a fiókkal. Írd be: {name}',
            future: '{n} jövőbeli foglalt órád van. Mondd le őket az „Aktív foglalások” menüben, majd próbáld újra.',
            admin: 'Adminisztrátori fiók itt nem törölhető. Kérd a szuperadmint.',
            session: 'A munkamenet lejárt. Jelentkezz be újra.',
            failed: 'A fiókot nem sikerült törölni. Próbáld újra.',
            done: 'A fiók törölve.'
        },
        en: {
            button: 'Delete account',
            title: 'Delete account',
            intro: 'Your account, sign-in details and profile will be permanently deleted. You will no longer be able to sign in with this account, and this cannot be undone.',
            keep: 'Booking history stays with the sports bases, no longer linked to an account. If you have future bookings, cancel them first from “Active bookings”.',
            label: 'To confirm, type your name exactly as your profile shows it: {name}',
            confirm: 'Delete my account permanently',
            cancel: 'Cancel',
            working: 'Deleting your account…',
            word: 'The name you typed does not match this account. Type: {name}',
            future: 'You have {n} booked hours in the future. Cancel them from “Active bookings”, then try again.',
            admin: 'Administrator accounts cannot be deleted here. Ask the superadmin.',
            session: 'Your session expired. Please sign in again.',
            failed: 'Your account could not be deleted. Please try again.',
            done: 'Your account has been deleted.'
        }
    };
    const t = key => (copy[window.lang] || copy.ro)[key] || copy.ro[key];
    const futureCount = error => Number(/active_bookings:(\d+)/.exec(error?.message || '')?.[1] || 0);
    const syncScroll = () => {
        if (window.syncSpotivityModalScroll) return window.syncSpotivityModalScroll();
        if (![...document.querySelectorAll('.modal')].some(el => ['flex', 'block'].includes(el.style.display))) document.body.classList.remove('fara-scroll');
    };

    function trapFocus(modal, panel, close) {
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key !== 'Tab') return;
            const focusable = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(n => n.getClientRects().length);
            if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); }
            else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus(); }
        });
    }

    // Same rule as spotivity_private.confirm_name_key() in migration 050:
    // case, extra spaces and Romanian/Hungarian diacritics are ignored.
    const nameKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toLocaleLowerCase('ro-RO').replace(/\s+/g, ' ');
    const accountName = user => String(user?.nume || '').trim() || String(user?.email || '').split('@')[0];

    // ---- Client: "Șterge contul" at the bottom of the profile and of the menu ----
    function createSelfDeletion(db) {
        const actions = document.querySelector('#modal-profil .actiuni-cont');
        if (!actions || document.getElementById('btn-sterge-cont')) return;
        const makeButton = (id, className) => {
            const b = node('button', className);
            b.id = id; b.type = 'button';
            b.setAttribute('aria-controls', 'modal-sterge-cont');
            b.setAttribute('aria-haspopup', 'dialog');
            return b;
        };
        // Profile: the very last button, under "Deconectare".
        const button = makeButton('btn-sterge-cont', 'btn-cont btn-sterge-cont');
        actions.append(button);
        // Menu with the 3 bars: the very last entry, shown only when signed in.
        const menuLinks = document.querySelector('#home-mobile-menu .home-mobile-links');
        const menuButton = menuLinks ? makeButton('btn-sterge-cont-meniu', 'home-menu-delete-account') : null;
        if (menuButton) { menuButton.hidden = true; menuLinks.append(menuButton); }
        const entries = [button, menuButton].filter(Boolean);

        const modal = node('div', 'modal account-delete-modal');
        modal.id = 'modal-sterge-cont'; modal.style.display = 'none';
        const panel = node('section', 'modal-continut account-delete-panel');
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'sterge-cont-titlu'); panel.tabIndex = -1;
        const title = node('h2', 'titlu-modal'); title.id = 'sterge-cont-titlu';
        const intro = node('p', 'account-delete-warning');
        const keep = node('p', 'ann-help');
        const form = node('form');
        const group = node('div', 'grup-input');
        const label = node('label'); label.htmlFor = 'sterge-cont-confirmare';
        const input = node('input'); input.id = 'sterge-cont-confirmare'; input.type = 'text';
        input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 120;
        group.append(label, input);
        const status = node('p', 'account-delete-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const row = node('div', 'account-delete-actions');
        const confirm = node('button', 'btn-deconectare btn-sterge-definitiv'); confirm.type = 'submit';
        const cancel = node('button', 'btn-cont'); cancel.type = 'button';
        row.append(confirm, cancel);
        form.append(group, status, row);
        panel.append(title, intro, keep, form);
        modal.append(panel);
        document.body.append(modal);
        let busy = false, isAdmin = false, returnTo = null, fromProfile = false;
        const currentUser = () => window.getSpotivityProfileUser?.() || null;
        const signedIn = () => Boolean(currentUser()?.id);

        function render() {
            for (const entry of entries) entry.textContent = t('button');
            title.textContent = t('title'); intro.textContent = t('intro'); keep.textContent = t('keep');
            label.textContent = t('label').replace('{name}', accountName(currentUser()) || '—');
            confirm.textContent = t('confirm'); cancel.textContent = t('cancel');
        }
        function sync() {
            button.hidden = isAdmin;
            if (menuButton) menuButton.hidden = isAdmin || !signedIn();
            render();
        }
        function setStatus(text, error = false) { status.textContent = text; status.classList.toggle('is-error', error); }
        function matches() { return nameKey(input.value) !== '' && nameKey(input.value) === nameKey(accountName(currentUser())); }
        function setBusy(value) { busy = value; input.disabled = value; cancel.disabled = value; confirm.disabled = value || !matches(); form.setAttribute('aria-busy', String(value)); }
        function close() {
            if (busy) return;
            modal.style.display = 'none'; input.value = ''; setStatus('');
            const profile = document.getElementById('modal-profil');
            if (fromProfile && signedIn() && profile) { profile.style.display = 'flex'; button.focus({ preventScroll: true }); }
            else if (returnTo?.isConnected && returnTo.getClientRects().length) returnTo.focus({ preventScroll: true });
            syncScroll();
        }
        function open(origin) {
            if (!signedIn() || isAdmin) return;
            returnTo = origin; fromProfile = origin === button;
            input.value = ''; render(); setStatus(''); setBusy(false);
            const profile = document.getElementById('modal-profil');
            if (profile) profile.style.display = 'none';
            modal.style.display = 'flex'; document.body.classList.add('fara-scroll');
            input.focus({ preventScroll: true });
        }
        button.addEventListener('click', () => open(button));
        menuButton?.addEventListener('click', () => {
            const toggle = document.getElementById('btn-mobile-menu');
            const menu = document.getElementById('home-mobile-menu');
            // Close the menu through its own toggle, so home.js restores the page (inert, scroll).
            if (menu && !menu.hidden) toggle?.click();
            open(toggle || menuButton);
        });
        input.addEventListener('input', () => { if (!busy) confirm.disabled = !matches(); });
        cancel.addEventListener('click', close);
        trapFocus(modal, panel, close);
        form.addEventListener('submit', async e => {
            e.preventDefault();
            if (busy) return;
            const user = currentUser();
            if (!user?.id) { setStatus(t('session'), true); return; }
            const name = accountName(user);
            if (!matches()) { setStatus(t('word').replace('{name}', name), true); input.focus(); return; }
            setBusy(true); setStatus(t('working'));
            try {
                const { data: session } = await db.auth.getSession();
                if (session?.session?.user?.id !== user.id) throw Object.assign(new Error('session'), { code: 'session' });
                const { error } = await db.rpc('delete_my_account', { p_confirm: input.value.trim() });
                if (error) throw error;
                setStatus(t('done'));
                // The Auth user no longer exists: drop the local session only.
                try { await db.auth.signOut({ scope: 'local' }); } catch { /* the session is already invalid */ }
                window.location.reload();
            } catch (error) {
                setBusy(false);
                const n = futureCount(error);
                if (error?.code === '55000' && n) setStatus(t('future').replace('{n}', n), true);
                else if (/admin_account/.test(error?.message || '')) setStatus(t('admin'), true);
                else if (error?.code === '22023') setStatus(t('word').replace('{name}', name), true);
                else if (error?.code === 'session' || error?.code === '42501') setStatus(t('session'), true);
                else setStatus(t('failed'), true);
            }
        });
        // Administrators delete accounts through the superadmin only.
        window.addEventListener('spotivity:admin-role', e => { isAdmin = Boolean(e.detail?.userId); sync(); });
        window.addEventListener('spotivity:admin-clear', () => { isAdmin = false; sync(); });
        window.addEventListener('spotivity:profile-user', sync);
        window.addEventListener('spotivity:language', render);
        sync();
    }

    // ---- Superadmin: "Conturi utilizatori" ----
    function createAccountsPanel(db) {
        const workspace = document.getElementById('base-admin-workspace');
        const tools = workspace?.querySelector('.base-admin-tools');
        if (!tools || document.getElementById('btn-admin-accounts')) return;
        const pageSize = 50;
        let role = null, view = 0, items = [], total = 0, busy = false, previousFocus = null;
        const button = node('button', 'card-sport admin-menu-card');
        button.id = 'btn-admin-accounts'; button.type = 'button'; button.hidden = true;
        button.append(node('h2', '', 'Conturi utilizatori'), node('span', 'admin-card-detail', 'Caută și șterge conturi'));
        tools.append(button);
        const modal = node('div', 'modal announcements-modal');
        modal.id = 'modal-admin-accounts'; modal.style.display = 'none';
        // Static markup only; account data is assigned through textContent.
        modal.innerHTML = `<section class="modal-continut announcements-panel accounts-panel" role="dialog" aria-modal="true" aria-labelledby="acc-title" tabindex="-1">
<header class="announcements-heading"><h2 id="acc-title">Conturi utilizatori · Superadmin</h2><button type="button" class="btn-cont" id="acc-close">Închide</button></header>
<p class="ann-help">Ștergerea elimină contul, profilul, drepturile de administrator și alocările la baze. Rezervările și statisticile rămân, fără legătură cu contul. Un cont cu rezervări viitoare nu poate fi șters până nu sunt anulate. Superadminii nu pot fi șterși de aici.</p>
<form id="acc-search-form" class="accounts-search"><label for="acc-search">Caută după email sau nume</label><div class="accounts-search-row"><input id="acc-search" type="search" maxlength="200" autocomplete="off"><button type="submit" class="btn-cont">Caută</button></div></form>
<p id="acc-status" role="status" aria-live="polite"></p><div id="acc-list" class="accounts-list"></div>
<button type="button" class="btn-cont" id="acc-more" hidden>Încarcă mai multe</button></section>`;
        workspace.append(modal);
        const get = id => modal.querySelector('#acc-' + id);
        const panel = modal.firstElementChild;
        const isOpen = () => modal.style.display === 'flex';
        const token = () => ({ user: role?.userId, view });
        const valid = current => role?.isSuper && role.userId === current.user && view === current.view && isOpen();
        const roleName = { client: 'Client', admin: 'Administrator', superadmin: 'Superadmin' };
        const when = value => {
            const date = value ? new Date(value) : null;
            return date && Number.isFinite(date.getTime()) ? date.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' }) : '—';
        };
        function status(text, error = false) { get('status').textContent = text; get('status').classList.toggle('is-error', error); }
        function setBusy(value) { busy = value; for (const el of panel.querySelectorAll('#acc-list button, #acc-list input, #acc-search-form button')) el.disabled = value; }
        function draw() {
            const list = get('list'); list.replaceChildren();
            for (const item of items) {
                const card = node('article', 'ann-history-card accounts-card');
                card.append(node('h4', '', item.email || '(fără email)'));
                card.append(node('p', 'ann-help', `${roleName[item.role] || item.role} · ${item.name || 'fără nume'} · tel. ${item.phone && item.phone !== '-' ? item.phone : '—'}`));
                card.append(node('p', 'ann-help', `Creat: ${when(item.created_at)} · Ultima conectare: ${when(item.last_sign_in_at)} · Ore rezervate în viitor: ${Number(item.future_bookings) || 0}`));
                if (item.role !== 'superadmin' && item.id !== role?.userId) {
                    const remove = node('button', 'btn-cont', 'Șterge contul'); remove.type = 'button';
                    remove.addEventListener('click', () => askDelete(card, item, remove));
                    card.append(remove);
                }
                list.append(card);
            }
            get('more').hidden = items.length >= total;
        }
        function askDelete(card, item, remove) {
            if (busy || card.querySelector('.accounts-confirm')) return;
            remove.hidden = true;
            const box = node('div', 'accounts-confirm');
            const id = 'acc-confirm-' + item.id;
            const label = node('label', '', `Scrie adresa ${item.email} ca să confirmi ștergerea definitivă:`); label.htmlFor = id;
            const input = node('input'); input.id = id; input.type = 'email'; input.autocomplete = 'off';
            const go = node('button', 'btn-deconectare', 'Șterge definitiv'); go.type = 'button';
            const back = node('button', 'btn-cont', 'Renunță'); back.type = 'button';
            const row = node('div', 'account-delete-actions'); row.append(go, back);
            box.append(label, input, row); card.append(box); input.focus();
            back.addEventListener('click', () => { box.remove(); remove.hidden = false; remove.focus(); });
            go.addEventListener('click', async () => {
                if (busy) return;
                if (input.value.trim().toLowerCase() !== String(item.email || '').toLowerCase()) { status('Adresa scrisă nu corespunde contului.', true); input.focus(); return; }
                const current = token(); setBusy(true); status(`Se șterge ${item.email}…`);
                try {
                    const { error } = await db.rpc('admin_delete_account', { p_user_id: item.id, p_confirm_email: input.value.trim() });
                    if (!valid(current)) return;
                    if (error) throw error;
                    items = items.filter(x => x.id !== item.id); total = Math.max(0, total - 1);
                    draw(); status(`Contul ${item.email} a fost șters.`);
                } catch (error) {
                    if (!valid(current)) return;
                    const n = futureCount(error);
                    status(error?.code === '55000' && n ? `${item.email} are ${n} ore rezervate în viitor. Anulează-le întâi, apoi șterge contul.`
                        : /superadmin_account|own_account/.test(error?.message || '') ? 'Acest cont nu poate fi șters de aici.'
                        : error?.code === 'P0002' ? 'Contul nu mai există. Reîncarcă lista.'
                        : error?.code === '42501' ? 'Acces refuzat. Numai superadminul poate șterge conturi.'
                        : 'Contul nu a putut fi șters. Încearcă din nou.', true);
                } finally { if (valid(current)) setBusy(false); }
            });
        }
        async function load(append = false) {
            if (!role?.isSuper || !isOpen()) return;
            const current = token(); setBusy(true); status('Se încarcă conturile…');
            try {
                const { data, error } = await db.rpc('admin_list_accounts', { p_search: get('search').value.trim(), p_limit: pageSize, p_offset: append ? items.length : 0 });
                if (!valid(current)) return;
                if (error) throw error;
                total = Number(data?.total) || 0;
                items = append ? items.concat(data?.items || []) : (data?.items || []);
                draw(); status(total ? `${total} ${total === 1 ? 'cont' : 'conturi'}.` : 'Niciun cont găsit.');
            } catch (error) {
                if (valid(current)) status(error?.code === '42501' ? 'Acces refuzat. Numai superadminul poate vedea conturile.' : 'Conturile nu au putut fi încărcate. Încearcă din nou.', true);
            } finally { if (valid(current)) setBusy(false); }
        }
        function close(restore = true) {
            view++; modal.style.display = 'none'; items = []; total = 0; get('list').replaceChildren(); status('');
            syncScroll();
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        button.addEventListener('click', () => {
            if (!role?.isSuper) return;
            view++; previousFocus = document.activeElement; modal.style.display = 'flex';
            document.body.classList.add('fara-scroll'); panel.focus(); load();
        });
        get('search-form').addEventListener('submit', e => { e.preventDefault(); if (!busy) load(); });
        get('more').addEventListener('click', () => { if (!busy) load(true); });
        get('close').addEventListener('click', () => close());
        trapFocus(modal, panel, close);
        const clear = () => { role = null; close(false); get('search').value = ''; button.hidden = true; };
        window.addEventListener('spotivity:admin-clear', clear);
        window.addEventListener('spotivity:admin-role', e => { clear(); if (e.detail?.isSuper === true && e.detail.userId) { role = { userId: e.detail.userId, isSuper: true }; button.hidden = false; } });
    }

    const start = () => {
        if (typeof db === 'undefined') return;
        createSelfDeletion(db);
        createAccountsPanel(db);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
