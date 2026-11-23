/* Superadmin "Analitice": new accounts and, per court and in total,
   cancellations, late cancellations, attendance and no-shows for the last
   7 days, 30 days and all time. Data comes from admin_analytics() (050),
   which refuses anyone but the superadmin. */
(() => {
    'use strict';
    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    const periods = [['d7', 'Ultimele 7 zile'], ['d30', 'Ultimele 30 de zile'], ['all', 'Total (de la început)']];
    const metrics = [
        ['cancelled', 'Anulări'],
        ['late', 'Anulări târzii'],
        ['present', 'Prezențe'],
        ['no_show', 'Neprezentări']
    ];
    window.createAdminAnalytics = function(db) {
        const workspace = document.getElementById('base-admin-workspace');
        const tools = workspace?.querySelector('.base-admin-tools');
        if (!tools || document.getElementById('btn-admin-analytics')) return null;
        let role = null, view = 0, data = null, period = 'd7', previousFocus = null;
        const button = node('button', 'card-sport admin-menu-card');
        button.id = 'btn-admin-analytics'; button.type = 'button'; button.hidden = true;
        button.append(node('h2', '', 'Analitice'), node('span', 'admin-card-detail', 'Utilizatori noi, anulări, prezențe'));
        tools.append(button);
        const modal = node('div', 'modal announcements-modal');
        modal.id = 'modal-admin-analytics'; modal.style.display = 'none';
        // Static markup only; numbers and court names use textContent.
        modal.innerHTML = `<section class="modal-continut announcements-panel analytics-panel" role="dialog" aria-modal="true" aria-labelledby="an-title" tabindex="-1">
<header class="announcements-heading"><h2 id="an-title">Analitice · Superadmin</h2><div class="analytics-head-actions"><button type="button" class="btn-cont" id="an-refresh">Reîncarcă</button><button type="button" class="btn-cont" id="an-close">Închide</button></div></header>
<div class="analytics-periods" role="group" aria-label="Perioada" id="an-periods"></div>
<p id="an-status" role="status" aria-live="polite"></p>
<div class="analytics-tiles" id="an-tiles"></div>
<h3 class="analytics-subtitle">Pe fiecare teren</h3>
<div class="analytics-table-wrap" tabindex="0" aria-label="Tabel pe terenuri"><table class="analytics-table"><thead><tr id="an-head"></tr></thead><tbody id="an-body"></tbody><tfoot id="an-foot"></tfoot></table></div>
<p class="ann-help">O rezervare de mai multe ore la rând se numără o singură dată. „Prezențe” = rezervări încheiate care nu au fost marcate „Nu s-a prezentat”. Anulările și anulările târzii se numără după momentul anulării; prezențele și neprezentările după ora rezervării. Pentru anulările făcute înainte de 23.11.2026 momentul anulării este aproximat. „Teren Blocat” nu este rezervare și nu se numără.</p>
</section>`;
        workspace.append(modal);
        const get = id => modal.querySelector('#an-' + id);
        const panel = modal.firstElementChild;
        const isOpen = () => modal.style.display === 'flex';
        const token = () => ({ user: role?.userId, view });
        const valid = current => role?.isSuper && role.userId === current.user && view === current.view && isOpen();
        const num = value => Number(value) || 0;
        const periodButtons = periods.map(([key, label]) => {
            const b = node('button', 'btn-cont analytics-period', label); b.type = 'button'; b.dataset.period = key;
            b.addEventListener('click', () => { period = key; draw(); });
            get('periods').append(b); return b;
        });
        const headRow = get('head');
        for (const label of ['Teren', 'Sport · Oraș', ...metrics.map(m => m[1])]) { const th = node('th', '', label); th.scope = 'col'; headRow.append(th); }
        function status(text, error = false) { get('status').textContent = text; get('status').classList.toggle('is-error', error); }
        function tile(label, value, extra) {
            const card = node('div', 'analytics-tile');
            card.append(node('span', 'analytics-tile-value', String(value)), node('span', 'analytics-tile-label', label));
            if (extra) card.append(node('span', 'analytics-tile-extra', extra));
            return card;
        }
        function draw() {
            for (const b of periodButtons) { const on = b.dataset.period === period; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); }
            const tiles = get('tiles'), body = get('body'), foot = get('foot');
            tiles.replaceChildren(); body.replaceChildren(); foot.replaceChildren();
            if (!data) return;
            const label = periods.find(p => p[0] === period)[1].toLowerCase();
            tiles.append(tile('Utilizatori noi', num(data.users?.[period]), label));
            for (const [key, name] of metrics) tiles.append(tile(name, num(data.totals?.[key]?.[period]), label));
            for (const court of data.courts || []) {
                const tr = node('tr');
                const th = node('th', '', court.court || '—'); th.scope = 'row';
                if (!court.active) th.append(node('span', 'analytics-muted', court.sport ? ' (ascuns)' : ' (șters)'));
                tr.append(th, node('td', '', [court.sport, court.city].filter(Boolean).join(' · ') || '—'));
                for (const [key] of metrics) tr.append(node('td', 'analytics-num', String(num(court.stats?.[key]?.[period]))));
                body.append(tr);
            }
            const total = node('tr');
            const th = node('th', '', 'Total'); th.scope = 'row';
            total.append(th, node('td', '', ''));
            for (const [key] of metrics) total.append(node('td', 'analytics-num', String(num(data.totals?.[key]?.[period]))));
            foot.append(total);
        }
        async function load() {
            if (!role?.isSuper || !isOpen()) return;
            const current = token(); get('refresh').disabled = true; status('Se încarcă statisticile…');
            try {
                const { data: result, error } = await db.rpc('admin_analytics');
                if (!valid(current)) return;
                if (error) throw error;
                data = result; draw();
                const at = new Date(result?.generated_at);
                status(Number.isFinite(at.getTime()) ? `Actualizat la ${at.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' })}.` : '');
            } catch (error) {
                if (valid(current)) status(error?.code === '42501' ? 'Acces refuzat. Numai superadminul vede analiticele.' : 'Statisticile nu au putut fi încărcate. Încearcă din nou.', true);
            } finally { if (valid(current)) get('refresh').disabled = false; }
        }
        function close(restore = true) {
            view++; modal.style.display = 'none'; data = null; draw(); status('');
            if (window.syncSpotivityModalScroll) window.syncSpotivityModalScroll();
            else if (![...document.querySelectorAll('.modal')].some(el => ['flex', 'block'].includes(el.style.display))) document.body.classList.remove('fara-scroll');
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        button.addEventListener('click', () => {
            if (!role?.isSuper) return;
            view++; previousFocus = document.activeElement; period = 'd7';
            modal.style.display = 'flex'; document.body.classList.add('fara-scroll'); draw(); panel.focus(); load();
        });
        get('refresh').addEventListener('click', load);
        get('close').addEventListener('click', () => close());
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key !== 'Tab') return;
            const focusable = [...panel.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(n => n.getClientRects().length);
            if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); }
            else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus(); }
        });
        const clear = () => { role = null; close(false); button.hidden = true; };
        window.addEventListener('spotivity:admin-clear', clear);
        window.addEventListener('spotivity:admin-role', e => { clear(); if (e.detail?.isSuper === true && e.detail.userId) { role = { userId: e.detail.userId, isSuper: true }; button.hidden = false; } });
        return { close };
    };
    const start = () => { if (typeof db !== 'undefined') window.createAdminAnalytics(db); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
