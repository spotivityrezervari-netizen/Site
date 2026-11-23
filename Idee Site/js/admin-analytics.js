/* "Analitice" for administrators: a dashboard with a side menu on the left,
   one button per category, plus an overview. Each category shows the number
   for the chosen period, the change against the period before, a day-by-day
   chart for the last 30 days and a ranking of the courts (with a table).
   The superadmin sees every court and the account categories; an ordinary
   administrator sees only their own courts. The scope is enforced by
   admin_analytics() in SQL (migration 050). No icons in the admin panel. */
(() => {
    'use strict';
    const SVG = 'http://www.w3.org/2000/svg';
    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    const svg = (tag, attrs = {}) => {
        const el = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        return el;
    };
    const periods = [['d7', '7 zile', 'ultimele 7 zile', 'p7', 'cele 7 zile dinainte'], ['d30', '30 de zile', 'ultimele 30 de zile', 'p30', 'cele 30 de zile dinainte'], ['all', 'Total', 'de la început']];
    // key, label, help, group, superadmin only, per court
    const metrics = [
        ['bookings', 'Rezervări', 'Rezervări făcute în perioada aleasă, inclusiv cele anulate ulterior. Mai multe ore la rând = o rezervare.', 'Rezervări', false, true],
        ['active_clients', 'Clienți activi', 'Clienți diferiți (cu cont sau fără) care au făcut cel puțin o rezervare. Un client care a rezervat pe mai multe terenuri se numără o dată în total.', 'Rezervări', false, true],
        ['cancelled', 'Anulări', 'Rezervări anulate, numărate după momentul anulării.', 'Anulări', false, true],
        ['late', 'Anulări târzii', 'Anulări făcute cu mai puțin de 60 de minute înainte de oră sau în timpul orei.', 'Anulări', false, true],
        ['present', 'Prezențe', 'Rezervări încheiate care nu au fost marcate „Nu s-a prezentat”, numărate după ora rezervării.', 'Prezență', false, true],
        ['no_show', 'Neprezentări', 'Rezervări marcate „Nu s-a prezentat”, numărate după ora rezervării.', 'Prezență', false, true],
        ['users', 'Utilizatori noi', 'Conturi create pe site.', 'Conturi', true, false],
        ['active_users', 'Utilizatori activi', 'Conturi care s-au conectat pe site (după ultima conectare a fiecărui cont, deci fără grafic pe zile).', 'Conturi', true, false]
    ];
    const groups = ['Rezervări', 'Anulări', 'Prezență', 'Conturi'];
    const when = value => {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' }) : '';
    };
    const dayLabel = (today, back, long = false) => {
        const [y, m, d] = String(today || '').split('-').map(Number);
        if (!y) return '';
        const date = new Date(Date.UTC(y, m - 1, d - back, 12));
        return date.toLocaleDateString('ro-RO', long ? { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' } : { timeZone: 'UTC', day: 'numeric', month: 'short' });
    };
    const fmt = new Intl.NumberFormat('ro-RO');

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
        const modal = node('div', 'modal announcements-modal analytics-modal');
        modal.id = 'modal-admin-analytics'; modal.style.display = 'none';
        // Static markup only; numbers and court names use textContent.
        modal.innerHTML = `<section class="modal-continut analytics-panel" role="dialog" aria-modal="true" aria-labelledby="an-title" tabindex="-1">
<aside class="analytics-side"><div class="analytics-side-head"><h2 id="an-title">Analitice</h2><p id="an-scope" class="analytics-scope"></p></div>
<nav class="analytics-nav" id="an-nav" aria-label="Categorii"></nav></aside>
<div class="analytics-main"><header class="analytics-topbar"><div class="analytics-periods" id="an-periods" role="group" aria-label="Perioada"></div>
<div class="analytics-head-actions"><button type="button" class="analytics-action" id="an-refresh">Reîncarcă</button><button type="button" class="analytics-action" id="an-close">Închide</button></div></header>
<p id="an-status" class="analytics-status" role="status" aria-live="polite"></p><div id="an-content" class="analytics-content"></div>
<p class="analytics-footnote">„Teren Blocat” nu este rezervare și nu se numără. Pentru anulările făcute înainte de 23.11.2026, momentul anulării este aproximat. Zilele sunt după ora României.</p></div>
<div class="analytics-tooltip" id="an-tip" role="presentation" hidden></div>
</section>`;
        workspace.append(modal);
        const get = id => modal.querySelector('#an-' + id);
        const panel = modal.firstElementChild;
        const tip = get('tip');
        const isOpen = () => modal.style.display === 'flex';
        const token = () => ({ user: role?.userId, view });
        const valid = current => role?.userId === current.user && view === current.view && isOpen();
        const num = value => Number(value) || 0;
        const visibleMetrics = () => metrics.filter(m => !m[4] || role?.isSuper);
        const stats = key => key === 'users' ? data?.users : key === 'active_users' ? data?.active_users : data?.totals?.[key];
        const value = (key, p) => num(stats(key)?.[p]);
        const series = key => {
            const list = key === 'users' ? data?.users?.daily : key === 'active_users' ? null : data?.daily?.[key];
            return Array.isArray(list) && list.length ? list.map(num) : null;
        };
        const periodInfo = () => periods.find(p => p[0] === period);

        function status(text, error = false) { get('status').textContent = text; get('status').classList.toggle('is-error', error); }
        function showTip(event, lines) {
            tip.replaceChildren(...lines.map((line, i) => node(i ? 'span' : 'strong', '', line)));
            tip.hidden = false;
            const box = panel.getBoundingClientRect();
            const x = Math.min(event.clientX - box.left + 14, box.width - tip.offsetWidth - 8);
            const y = Math.max(event.clientY - box.top - tip.offsetHeight - 12, 8);
            tip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
        }
        const hideTip = () => { tip.hidden = true; };

        // Change against the period before ("+3 față de cele 7 zile dinainte").
        function trend(key) {
            const info = periodInfo();
            if (!info[3] || !stats(key) || stats(key)[info[3]] === undefined) return null;
            const now = value(key, period), before = value(key, info[3]);
            const diff = now - before;
            const el = node('span', 'analytics-trend ' + (diff > 0 ? 'is-up' : diff < 0 ? 'is-down' : 'is-flat'));
            const pct = before ? ` (${diff > 0 ? '+' : ''}${Math.round(diff / before * 100)}%)` : '';
            el.textContent = `${diff > 0 ? '+' : ''}${fmt.format(diff)}${pct} față de ${info[4]}`;
            return el;
        }

        function drawNav() {
            const nav = get('nav'); nav.replaceChildren();
            const entry = (key, label) => {
                const b = node('button', 'analytics-nav-item'); b.type = 'button'; b.dataset.section = key;
                b.append(node('span', 'analytics-nav-label', label));
                if (key !== 'overview' && data) b.append(node('span', 'analytics-nav-count', fmt.format(value(key, period))));
                const on = key === section;
                b.classList.toggle('is-active', on);
                if (on) b.setAttribute('aria-current', 'page');
                b.addEventListener('click', () => { section = key; hideTip(); draw(); get('content').querySelector('h3')?.focus({ preventScroll: true }); });
                return b;
            };
            nav.append(entry('overview', 'Prezentare generală'));
            for (const group of groups) {
                const items = visibleMetrics().filter(m => m[3] === group);
                if (!items.length) continue;
                nav.append(node('span', 'analytics-nav-group', group));
                for (const [key, label] of items) nav.append(entry(key, label));
            }
        }
        function drawPeriods() {
            const box = get('periods'); box.replaceChildren();
            for (const [key, label] of periods) {
                const b = node('button', 'analytics-period', label); b.type = 'button';
                b.classList.toggle('is-active', key === period); b.setAttribute('aria-pressed', String(key === period));
                b.addEventListener('click', () => { period = key; hideTip(); draw(); });
                box.append(b);
            }
        }

        // Day-by-day columns for the last 30 days (one series, one colour).
        function dayChart(key, label, { mini = false } = {}) {
            const list = series(key);
            if (!list) return null;
            // The full chart is drawn at its real width, so its labels stay readable on phones.
            const W = mini ? 120 : Math.max(280, Math.min(1000, Math.round((get('content').clientWidth || 680) - 42))), H = mini ? 34 : 200, top = mini ? 2 : 14, bottom = mini ? 2 : 26, left = mini ? 0 : 30;
            const max = Math.max(1, ...list);
            const niceMax = mini ? max : Math.max(4, Math.ceil(max / 4) * 4);
            const plotH = H - top - bottom, step = (W - left) / list.length, barW = Math.max(2, step - (mini ? 1.5 : 4));
            const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: mini ? 'analytics-spark' : 'analytics-chart', role: 'img', 'aria-label': `${label}: ultimele 30 de zile, în total ${fmt.format(list.reduce((a, b) => a + b, 0))}` });
            if (!mini) {
                for (let i = 0; i <= 4; i++) {
                    const y = top + plotH - plotH * i / 4;
                    chart.append(svg('line', { x1: left, x2: W, y1: y, y2: y, class: i ? 'analytics-grid' : 'analytics-axis' }));
                    if (i % 2 === 0) { const t = svg('text', { x: left - 6, y: y + 4, class: 'analytics-tick', 'text-anchor': 'end' }); t.textContent = fmt.format(niceMax * i / 4); chart.append(t); }
                }
                for (const back of [29, 15, 0]) {
                    const i = 29 - back;
                    const t = svg('text', { x: left + step * i + step / 2, y: H - 6, class: 'analytics-tick', 'text-anchor': i === 0 ? 'start' : i === 29 ? 'end' : 'middle' });
                    t.textContent = back === 0 ? 'azi' : dayLabel(data.today, back); chart.append(t);
                }
            }
            list.forEach((n, i) => {
                const h = n ? Math.max(mini ? 2 : 3, plotH * n / niceMax) : 0;
                const x = left + step * i + (step - barW) / 2, y = top + plotH - h;
                if (h) {
                    const r = Math.min(mini ? 1.5 : 4, barW / 2, h);
                    // Rounded top, square base on the axis.
                    chart.append(svg('path', { class: 'analytics-bar' + (i === list.length - 1 ? ' is-today' : ''), d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z` }));
                }
                if (!mini) {
                    const hit = svg('rect', { x: left + step * i, y: top, width: step, height: plotH, class: 'analytics-hit' });
                    const back = 29 - i;
                    const lines = [dayLabel(data.today, back, true) + (back === 0 ? ' (azi)' : ''), `${label}: ${fmt.format(n)}`];
                    hit.addEventListener('pointermove', e => showTip(e, lines));
                    hit.addEventListener('pointerleave', hideTip);
                    chart.append(hit);
                }
            });
            return chart;
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
        // Courts ranked by the chosen period, as horizontal bars.
        function courtRanking(key, label) {
            const courts = (data.courts || []).map(c => ({ c, n: num(c.stats?.[key]?.[period]) })).sort((a, b) => b.n - a.n || String(a.c.court).localeCompare(String(b.c.court), 'ro'));
            const box = node('div', 'analytics-ranking');
            if (!courts.length) { box.append(node('p', 'analytics-empty', 'Nu ai terenuri alocate.')); return box; }
            const max = Math.max(1, ...courts.map(x => x.n));
            for (const { c, n } of courts) {
                const row = node('div', 'analytics-rank-row');
                const name = node('span', 'analytics-rank-name', c.court || '—');
                const where = [c.sport, c.city].filter(Boolean).join(' · ') + (c.active ? '' : c.sport ? ' · ascuns' : ' · șters');
                if (where) name.append(node('span', 'analytics-muted', where));
                const track = node('span', 'analytics-rank-track');
                const bar = node('span', 'analytics-rank-bar');
                bar.style.width = n ? `${Math.max(2, n / max * 100)}%` : '0';
                track.append(bar);
                row.append(name, track, node('span', 'analytics-rank-value', fmt.format(n)));
                row.title = `${c.court}: ${fmt.format(n)} ${label.toLowerCase()} (${periodInfo()[2]})`;
                box.append(row);
            }
            return box;
        }
        function details(summary, content) {
            const d = node('details', 'analytics-details');
            d.append(node('summary', '', summary), content);
            return d;
        }

        function drawOverview(content) {
            const info = periodInfo();
            const title = node('h3', 'analytics-title', 'Prezentare generală'); title.tabIndex = -1;
            content.append(title, node('p', 'analytics-help', `Toate categoriile pentru ${info[2]}. Apasă pe o casetă sau pe un buton din meniu pentru detalii.`));
            const grid = node('div', 'analytics-cards');
            for (const [key, label] of visibleMetrics()) {
                const card = node('button', 'analytics-card'); card.type = 'button';
                card.append(node('span', 'analytics-card-label', label), node('span', 'analytics-card-value', fmt.format(value(key, period))));
                const tr = trend(key); if (tr) card.append(tr);
                const spark = dayChart(key, label, { mini: true });
                if (spark) { spark.setAttribute('aria-hidden', 'true'); card.append(spark); }
                card.addEventListener('click', () => { section = key; draw(); get('content').querySelector('h3')?.focus({ preventScroll: true }); });
                grid.append(card);
            }
            content.append(grid);
            const courtMetrics = metrics.filter(m => m[5]);
            const rows = (data.courts || []).map(court => {
                const tr = node('tr'); tr.append(courtCell(court));
                for (const [key] of courtMetrics) tr.append(node('td', 'analytics-num', fmt.format(num(court.stats?.[key]?.[period]))));
                return tr;
            });
            const foot = node('tr'); const th = node('th', '', 'Total'); th.scope = 'row'; foot.append(th);
            for (const [key] of courtMetrics) foot.append(node('td', 'analytics-num', fmt.format(value(key, period))));
            const section2 = node('section', 'analytics-block');
            section2.append(node('h4', 'analytics-block-title', `Pe fiecare teren · ${info[2]}`),
                rows.length ? table(['Teren', ...courtMetrics.map(m => m[1])], rows, foot) : node('p', 'analytics-empty', 'Nu ai terenuri alocate.'));
            content.append(section2);
        }
        function drawMetric(content, metric) {
            const [key, label, help, , , perCourt] = metric;
            const info = periodInfo();
            const title = node('h3', 'analytics-title', label); title.tabIndex = -1;
            content.append(title, node('p', 'analytics-help', help));
            const hero = node('div', 'analytics-hero');
            const main = node('div', 'analytics-hero-main');
            main.append(node('span', 'analytics-hero-value', fmt.format(value(key, period))), node('span', 'analytics-hero-label', info[2]));
            const tr = trend(key); if (tr) main.append(tr);
            const side = node('dl', 'analytics-hero-periods');
            for (const [p, name] of periods) {
                const item = node('div', p === period ? 'is-active' : '');
                item.append(node('dt', '', name), node('dd', '', fmt.format(value(key, p))));
                side.append(item);
            }
            hero.append(main, side);
            content.append(hero);
            const chart = dayChart(key, label);
            if (chart) {
                const block = node('section', 'analytics-block');
                block.append(node('h4', 'analytics-block-title', 'Pe zile · ultimele 30 de zile'), chart);
                content.append(block);
            }
            if (!perCourt) return;
            const block = node('section', 'analytics-block');
            block.append(node('h4', 'analytics-block-title', `Pe fiecare teren · ${info[2]}`), courtRanking(key, label));
            const rows = (data.courts || []).map(court => {
                const tr = node('tr'); tr.append(courtCell(court));
                for (const [p] of periods) tr.append(node('td', 'analytics-num', fmt.format(num(court.stats?.[key]?.[p]))));
                return tr;
            });
            const foot = node('tr'); const th = node('th', '', 'Total'); th.scope = 'row'; foot.append(th);
            for (const [p] of periods) foot.append(node('td', 'analytics-num', fmt.format(value(key, p))));
            if (rows.length) block.append(details('Tabel cu toate perioadele', table(['Teren', ...periods.map(p => p[1])], rows, foot)));
            content.append(block);
        }
        function draw() {
            drawNav(); drawPeriods();
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
                if (valid(current)) status(error?.code === '42501' ? 'Acces refuzat. Numai administratorii văd analiticele.'
                    : error?.code === 'PGRST202' || error?.code === '42883' ? 'Statisticile nu sunt încă active pe server (lipsește actualizarea bazei de date 050).'
                    : 'Statisticile nu au putut fi încărcate. Încearcă din nou.', true);
            } finally { if (valid(current)) get('refresh').disabled = false; }
        }
        function close(restore = true) {
            view++; modal.style.display = 'none'; data = null; hideTip(); draw(); status('');
            if (window.syncSpotivityModalScroll) window.syncSpotivityModalScroll();
            else if (![...document.querySelectorAll('.modal')].some(el => ['flex', 'block'].includes(el.style.display))) document.body.classList.remove('fara-scroll');
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        button.addEventListener('click', () => {
            if (!role) return;
            view++; previousFocus = document.activeElement; period = 'd30'; section = 'overview';
            get('scope').textContent = role.isSuper ? 'Superadmin · toate terenurile și conturile' : 'Doar terenurile tale';
            modal.style.display = 'flex'; document.body.classList.add('fara-scroll'); draw(); panel.focus(); load();
        });
        // Redraw at the new width when the window changes size (phone rotation).
        let resizeTimer = 0, lastWidth = 0;
        window.addEventListener('resize', () => {
            if (!isOpen() || !data) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { const w = get('content').clientWidth; if (Math.abs(w - lastWidth) > 24) { lastWidth = w; hideTip(); draw(); } }, 150);
        });
        get('refresh').addEventListener('click', load);
        get('close').addEventListener('click', () => close());
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key !== 'Tab') return;
            const focusable = [...panel.querySelectorAll('button:not(:disabled),summary,[tabindex="0"]')].filter(n => n.getClientRects().length);
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
