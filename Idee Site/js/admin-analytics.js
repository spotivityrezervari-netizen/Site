/* "Analitice" for administrators. A side menu has one button per indicator
   (plus an overview). The superadmin sees every court and the account
   indicators; an ordinary administrator sees only their own courts.
   The scope is enforced by admin_analytics() in SQL (migration 050). */
(() => {
    'use strict';
    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    const periods = [['d7', 'Ultimele 7 zile'], ['d30', 'Ultimele 30 de zile'], ['all', 'Total']];
    // [key, label, help, superadmin only, per court]
    const metrics = [
        ['users', 'Utilizatori noi', 'Conturi create pe site în perioada aleasă.', true, false],
        ['active_users', 'Utilizatori activi', 'Conturi care s-au conectat pe site în perioada aleasă (după ultima conectare a fiecărui cont).', true, false],
        ['bookings', 'Rezervări', 'Rezervări făcute în perioada aleasă, inclusiv cele anulate ulterior. Mai multe ore la rând = o rezervare.', false, true],
        ['active_clients', 'Clienți activi', 'Clienți diferiți (cu cont sau fără) care au făcut cel puțin o rezervare în perioada aleasă. În total, un client care a rezervat pe mai multe terenuri se numără o dată.', false, true],
        ['cancelled', 'Anulări', 'Rezervări anulate, numărate după momentul anulării.', false, true],
        ['late', 'Anulări târzii', 'Anulări făcute cu mai puțin de 60 de minute înainte de oră sau în timpul orei.', false, true],
        ['present', 'Prezențe', 'Rezervări încheiate care nu au fost marcate „Nu s-a prezentat”, numărate după ora rezervării.', false, true],
        ['no_show', 'Neprezentări', 'Rezervări marcate „Nu s-a prezentat”, numărate după ora rezervării.', false, true]
    ];
    const when = value => {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' }) : '';
    };
    window.createAdminAnalytics = function(db) {
        const workspace = document.getElementById('base-admin-workspace');
        const tools = workspace?.querySelector('.base-admin-tools');
        if (!tools || document.getElementById('btn-admin-analytics')) return null;
        let role = null, view = 0, data = null, period = 'd7', section = 'overview', previousFocus = null;
        const button = node('button', 'card-sport admin-menu-card');
        button.id = 'btn-admin-analytics'; button.type = 'button'; button.hidden = true;
        const buttonDetail = node('span', 'admin-card-detail', '');
        button.append(node('h2', '', 'Analitice'), buttonDetail);
        tools.append(button);
        const modal = node('div', 'modal announcements-modal');
        modal.id = 'modal-admin-analytics'; modal.style.display = 'none';
        // Static markup only; numbers and court names use textContent.
        modal.innerHTML = `<section class="modal-continut announcements-panel analytics-panel" role="dialog" aria-modal="true" aria-labelledby="an-title" tabindex="-1">
<header class="announcements-heading"><h2 id="an-title">Analitice</h2><div class="analytics-head-actions"><button type="button" class="btn-cont" id="an-refresh">Reîncarcă</button><button type="button" class="btn-cont" id="an-close">Închide</button></div></header>
<p id="an-scope" class="ann-help"></p>
<div class="analytics-layout"><nav class="analytics-nav" id="an-nav" aria-label="Indicatori"></nav>
<div class="analytics-main"><p id="an-status" role="status" aria-live="polite"></p><div id="an-content"></div></div></div>
<p class="ann-help">„Teren Blocat” nu este rezervare și nu se numără. Pentru anulările făcute înainte de 23.11.2026, momentul anulării este aproximat.</p>
</section>`;
        workspace.append(modal);
        const get = id => modal.querySelector('#an-' + id);
        const panel = modal.firstElementChild;
        const isOpen = () => modal.style.display === 'flex';
        const token = () => ({ user: role?.userId, view });
        const valid = current => role?.userId === current.user && view === current.view && isOpen();
        const num = value => Number(value) || 0;
        const visibleMetrics = () => metrics.filter(m => !m[3] || role?.isSuper);
        const metricValue = (key, p) => {
            if (key === 'users') return num(data?.users?.[p]);
            if (key === 'active_users') return num(data?.active_users?.[p]);
            return num(data?.totals?.[key]?.[p]);
        };

        function status(text, error = false) { get('status').textContent = text; get('status').classList.toggle('is-error', error); }
        function drawNav() {
            const nav = get('nav'); nav.replaceChildren();
            for (const [key, label] of [['overview', 'Prezentare generală'], ...visibleMetrics()]) {
                const b = node('button', 'analytics-nav-item'); b.type = 'button'; b.dataset.section = key;
                b.append(node('span', 'analytics-nav-label', label));
                if (key !== 'overview' && data) b.append(node('span', 'analytics-nav-count', String(metricValue(key, 'd7'))));
                const on = key === section;
                b.classList.toggle('is-active', on);
                if (on) b.setAttribute('aria-current', 'true');
                b.addEventListener('click', () => { section = key; draw(); get('content').querySelector('h3')?.focus({ preventScroll: true }); });
                nav.append(b);
            }
        }
        function tile(label, value, extra) {
            const card = node('div', 'analytics-tile');
            card.append(node('span', 'analytics-tile-value', String(value)), node('span', 'analytics-tile-label', label));
            if (extra) card.append(node('span', 'analytics-tile-extra', extra));
            return card;
        }
        function courtCell(court) {
            const th = node('th', '', court.court || '—'); th.scope = 'row';
            if (!court.active) th.append(node('span', 'analytics-muted', court.sport ? ' (ascuns)' : ' (șters)'));
            const where = [court.sport, court.city].filter(Boolean).join(' · ');
            if (where) { th.append(node('br')); th.append(node('span', 'analytics-muted', where)); }
            return th;
        }
        function table(headers, rows, footer) {
            const wrap = node('div', 'analytics-table-wrap'); wrap.tabIndex = 0;
            const t = node('table', 'analytics-table');
            const head = node('tr');
            headers.forEach((label, i) => { const th = node('th', i ? 'analytics-num' : '', label); th.scope = 'col'; head.append(th); });
            const thead = node('thead'); thead.append(head);
            const tbody = node('tbody'); rows.forEach(r => tbody.append(r));
            t.append(thead, tbody);
            if (footer) { const tfoot = node('tfoot'); tfoot.append(footer); t.append(tfoot); }
            wrap.append(t); return wrap;
        }
        function drawOverview(content) {
            const title = node('h3', 'analytics-subtitle', 'Prezentare generală'); title.tabIndex = -1;
            const group = node('div', 'analytics-periods'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Perioada');
            for (const [key, label] of periods) {
                const b = node('button', 'btn-cont analytics-period', label); b.type = 'button';
                b.classList.toggle('is-active', key === period); b.setAttribute('aria-pressed', String(key === period));
                b.addEventListener('click', () => { period = key; draw(); });
                group.append(b);
            }
            const tiles = node('div', 'analytics-tiles');
            const label = periods.find(p => p[0] === period)[1].toLowerCase();
            for (const [key, name] of visibleMetrics()) tiles.append(tile(name, metricValue(key, period), label));
            const courtMetrics = metrics.filter(m => m[4]);
            const rows = (data.courts || []).map(court => {
                const tr = node('tr'); tr.append(courtCell(court));
                for (const [key] of courtMetrics) tr.append(node('td', 'analytics-num', String(num(court.stats?.[key]?.[period]))));
                return tr;
            });
            const foot = node('tr'); const th = node('th', '', 'Total'); th.scope = 'row'; foot.append(th);
            for (const [key] of courtMetrics) foot.append(node('td', 'analytics-num', String(metricValue(key, period))));
            content.append(title, group, tiles, node('h3', 'analytics-subtitle', 'Pe fiecare teren'),
                rows.length ? table(['Teren', ...courtMetrics.map(m => m[1])], rows, foot) : node('p', 'ann-help', 'Nu ai terenuri alocate.'));
        }
        function drawMetric(content, metric) {
            const [key, name, help, , perCourt] = metric;
            const title = node('h3', 'analytics-subtitle', name); title.tabIndex = -1;
            const tiles = node('div', 'analytics-tiles');
            for (const [p, label] of periods) tiles.append(tile(label, metricValue(key, p)));
            content.append(title, node('p', 'ann-help', help), tiles);
            if (!perCourt) return;
            const rows = (data.courts || []).map(court => {
                const tr = node('tr'); tr.append(courtCell(court));
                for (const [p] of periods) tr.append(node('td', 'analytics-num', String(num(court.stats?.[key]?.[p]))));
                return tr;
            });
            const foot = node('tr'); const th = node('th', '', 'Total'); th.scope = 'row'; foot.append(th);
            for (const [p] of periods) foot.append(node('td', 'analytics-num', String(metricValue(key, p))));
            content.append(node('h3', 'analytics-subtitle', 'Pe fiecare teren'),
                rows.length ? table(['Teren', ...periods.map(p => p[1])], rows, foot) : node('p', 'ann-help', 'Nu ai terenuri alocate.'));
        }
        function draw() {
            drawNav();
            const content = get('content'); content.replaceChildren();
            if (!data) return;
            const metric = visibleMetrics().find(m => m[0] === section);
            if (metric) drawMetric(content, metric); else { section = 'overview'; drawOverview(content); }
        }
        async function load() {
            if (!role || !isOpen()) return;
            const current = token(); get('refresh').disabled = true; status('Se încarcă statisticile…');
            try {
                const { data: result, error } = await db.rpc('admin_analytics');
                if (!valid(current)) return;
                if (error) throw error;
                data = result; draw();
                status(result?.generated_at ? `Actualizat la ${when(result.generated_at)}.` : '');
            } catch (error) {
                if (valid(current)) status(error?.code === '42501' ? 'Acces refuzat. Numai administratorii văd analiticele.' : 'Statisticile nu au putut fi încărcate. Încearcă din nou.', true);
            } finally { if (valid(current)) get('refresh').disabled = false; }
        }
        function close(restore = true) {
            view++; modal.style.display = 'none'; data = null; draw(); status('');
            if (window.syncSpotivityModalScroll) window.syncSpotivityModalScroll();
            else if (![...document.querySelectorAll('.modal')].some(el => ['flex', 'block'].includes(el.style.display))) document.body.classList.remove('fara-scroll');
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        button.addEventListener('click', () => {
            if (!role) return;
            view++; previousFocus = document.activeElement; period = 'd7'; section = 'overview';
            get('title').textContent = role.isSuper ? 'Analitice · Superadmin' : 'Analitice · Terenurile tale';
            get('scope').textContent = role.isSuper ? 'Vezi toate terenurile platformei și conturile.' : 'Vezi numai terenurile care îți sunt alocate.';
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
        window.addEventListener('spotivity:admin-role', e => {
            clear();
            if (!e.detail?.userId) return;
            role = { userId: e.detail.userId, isSuper: e.detail.isSuper === true };
            buttonDetail.textContent = role.isSuper ? 'Statistici: utilizatori, anulări, prezențe' : 'Statistici pentru terenurile tale';
            button.hidden = false;
        });
        return { close };
    };
    const start = () => { if (typeof db !== 'undefined') window.createAdminAnalytics(db); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
