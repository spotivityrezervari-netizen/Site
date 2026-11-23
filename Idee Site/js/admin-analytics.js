/* "Analitice" for administrators: a dashboard with a side menu on the left,
   one button per category, plus an overview. At the top, two drop-down lists
   (like the city picker): the period (today, yesterday, 7/30 days, this/last
   month, 3/12 months, this year, all time, or chosen dates) and the court
   ("Toate terenurile" or one court), plus the category as a third list. Each category shows the number, the
   change against the window of the same length just before, a chart per day
   (per month for long periods). One court at a time is picked in the list.
   The superadmin may pick any court and also sees the account categories; an
   administrator only their own courts. The scope is enforced in SQL by
   admin_analytics_range() (migration 051). No icons in the admin panel. */
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
    // key, label, help, group, superadmin only, per court, daily average makes sense
    const metrics = [
        ['bookings', 'Rezervări', 'Rezervări făcute în perioada aleasă, inclusiv cele anulate ulterior. Mai multe ore la rând = o rezervare.', 'Rezervări', false, true, true],
        ['active_clients', 'Clienți activi', 'Clienți diferiți (cu cont sau fără) care au făcut cel puțin o rezervare în perioadă. Un client care a rezervat pe mai multe terenuri se numără o dată în total.', 'Rezervări', false, true, false],
        ['cancelled', 'Anulări', 'Rezervări anulate, numărate după momentul anulării.', 'Anulări', false, true, true],
        ['late', 'Anulări târzii', 'Anulări făcute cu mai puțin de 60 de minute înainte de oră sau în timpul orei.', 'Anulări', false, true, true],
        ['present', 'Prezențe', 'Rezervări încheiate care nu au fost marcate „Nu s-a prezentat”, numărate după ora rezervării.', 'Prezență', false, true, true],
        ['no_show', 'Neprezentări', 'Rezervări marcate „Nu s-a prezentat”, numărate după ora rezervării.', 'Prezență', false, true, true],
        ['users', 'Utilizatori noi', 'Conturi create pe site în perioadă. Contează pentru tot site-ul, indiferent de terenul ales.', 'Conturi', true, false, true],
        ['active_users', 'Utilizatori activi', 'Conturi a căror ultimă conectare pe site e în perioadă (pentru tot site-ul). Nu are grafic: se păstrează doar ultima conectare a fiecărui cont.', 'Conturi', true, false, false]
    ];
    const groups = ['Rezervări', 'Anulări', 'Prezență', 'Conturi'];
    const fmt = new Intl.NumberFormat('ro-RO');
    const fmt1 = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });

    // ---- Calendar days in Romania, as 'YYYY-MM-DD' ----
    const todayRo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const toDate = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
    const toIso = date => date.toISOString().slice(0, 10);
    const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
    const isIso = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(toDate(value).getTime());
    const show = (iso, opts) => toDate(iso).toLocaleDateString('ro-RO', { timeZone: 'UTC', ...opts });
    const dayShort = iso => show(iso, { day: 'numeric', month: 'short' });
    const dayLong = iso => show(iso, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    const monthShort = iso => show(iso, { month: 'short', year: 'numeric' });
    const monthLong = iso => show(iso, { month: 'long', year: 'numeric' });
    const rangeText = (from, to) => from === to ? show(from, { day: 'numeric', month: 'long', year: 'numeric' })
        : `${show(from, { day: 'numeric', month: 'short', ...(from.slice(0, 4) !== to.slice(0, 4) ? { year: 'numeric' } : {}) })} – ${show(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000) + 1;

    // Period list: [key, label in the list, words used in sentences, range(today)]
    const periods = [
        ['today', 'Azi', 'azi', t => [t, t]],
        ['yesterday', 'Ieri', 'ieri', t => [addDays(t, -1), addDays(t, -1)]],
        ['d7', 'Ultimele 7 zile', 'ultimele 7 zile', t => [addDays(t, -6), t]],
        ['d30', 'Ultimele 30 de zile', 'ultimele 30 de zile', t => [addDays(t, -29), t]],
        ['this_month', 'Luna aceasta', 'luna aceasta', t => [t.slice(0, 8) + '01', t]],
        ['last_month', 'Luna trecută', 'luna trecută', t => { const end = addDays(t.slice(0, 8) + '01', -1); return [end.slice(0, 8) + '01', end]; }],
        ['d90', 'Ultimele 3 luni', 'ultimele 3 luni', t => [addDays(t, -89), t]],
        ['d365', 'Ultimele 12 luni', 'ultimele 12 luni', t => [addDays(t, -364), t]],
        ['this_year', 'Anul acesta', 'anul acesta', t => [t.slice(0, 5) + '01-01', t]],
        ['all', 'Total (de la început)', 'de la început', () => [null, null]],
        ['custom', 'Alege datele…', 'perioada aleasă', null]
    ];

    window.createAdminAnalytics = function(db) {
        const workspace = document.getElementById('base-admin-workspace');
        const tools = workspace?.querySelector('.base-admin-tools');
        if (!tools || document.getElementById('btn-admin-analytics')) return null;
        let role = null, view = 0, request = 0, data = null, period = 'd30', court = '', section = 'overview', previousFocus = null;
        let custom = { from: '', to: '' };
        const button = node('button', 'card-sport admin-menu-card');
        button.id = 'btn-admin-analytics'; button.type = 'button'; button.hidden = true;
        const buttonDetail = node('span', 'admin-card-detail', '');
        button.append(node('h2', '', 'Analitice'), buttonDetail);
        tools.append(button);
        const modal = node('div', 'modal announcements-modal analytics-modal');
        modal.id = 'modal-admin-analytics'; modal.style.display = 'none';
        const chevron = '<svg class="analytics-select-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>';
        // Static markup only; numbers and court names use textContent.
        modal.innerHTML = `<section class="modal-continut analytics-panel" role="dialog" aria-modal="true" aria-labelledby="an-title" tabindex="-1">
<aside class="analytics-side"><div class="analytics-side-head"><h2 id="an-title">Analitice</h2><p id="an-scope" class="analytics-scope"></p></div>
<nav class="analytics-nav" id="an-nav" aria-label="Categorii"></nav></aside>
<div class="analytics-main"><header class="analytics-topbar">
<div class="analytics-filters">
<label class="analytics-filter"><span class="analytics-filter-label">Perioada</span><span class="analytics-select"><select id="an-period"></select>${chevron}</span></label>
<label class="analytics-filter"><span class="analytics-filter-label">Categorie</span><span class="analytics-select"><select id="an-section"></select>${chevron}</span></label>
<label class="analytics-filter"><span class="analytics-filter-label">Teren</span><span class="analytics-select"><select id="an-court"><option value="">Toate terenurile</option></select>${chevron}</span></label>
</div>
<div class="analytics-head-actions"><button type="button" class="analytics-action" id="an-refresh">Reîncarcă</button><button type="button" class="analytics-action" id="an-close">Închide</button></div>
<form class="analytics-custom" id="an-custom" hidden><label>De la <input type="date" id="an-from" required></label><label>Până la <input type="date" id="an-to" required></label><button type="submit" class="analytics-action">Arată</button></form>
</header>
<p id="an-status" class="analytics-status" role="status" aria-live="polite"></p><div id="an-content" class="analytics-content"></div>
<p class="analytics-footnote">„Teren Blocat” nu este rezervare și nu se numără. Comparația se face cu perioada de aceeași lungime de dinainte. Pentru anulările făcute înainte de 23.11.2026, momentul anulării este aproximat. Zilele sunt după ora României.</p></div>
<div class="analytics-tooltip" id="an-tip" role="presentation" hidden></div>
</section>`;
        workspace.append(modal);
        const get = id => modal.querySelector('#an-' + id);
        const panel = modal.firstElementChild;
        const tip = get('tip');
        for (const [key, label] of periods) { const o = node('option', '', label); o.value = key; get('period').append(o); }
        const isOpen = () => modal.style.display === 'flex';
        const num = value => Number(value) || 0;
        const visibleMetrics = () => metrics.filter(m => !m[4] || role?.isSuper);
        const stat = key => key === 'users' || key === 'active_users' ? data?.[key] : data?.totals?.[key];
        const value = key => num(stat(key)?.n);
        const previous = key => { const p = stat(key)?.p; return p === null || p === undefined ? null : num(p); };
        const series = key => { const s = stat(key)?.series; return Array.isArray(s) && s.length ? s.map(num) : null; };
        const periodInfo = () => periods.find(p => p[0] === period) || periods[3];
        const periodWords = () => period === 'custom' && data ? rangeText(data.from, data.to) : periodInfo()[2];
        const bucketLabel = (iso, long) => data?.bucket === 'month' ? (long ? monthLong(iso) : monthShort(iso)) : (long ? dayLong(iso) : dayShort(iso));

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

        // Change against the window of the same length just before.
        function trend(key) {
            const before = previous(key);
            if (before === null || !data?.previous) return null;
            const diff = value(key) - before;
            const el = node('span', 'analytics-trend ' + (diff > 0 ? 'is-up' : diff < 0 ? 'is-down' : 'is-flat'));
            const pct = before ? ` (${diff > 0 ? '+' : ''}${Math.round(diff / before * 100)}%)` : '';
            el.textContent = `${diff > 0 ? '+' : ''}${fmt.format(diff)}${pct} față de ${rangeText(data.previous.from, data.previous.to)}`;
            return el;
        }

        function drawNav() {
            const nav = get('nav'); nav.replaceChildren();
            const entry = (key, label) => {
                const b = node('button', 'analytics-nav-item'); b.type = 'button'; b.dataset.section = key;
                b.append(node('span', 'analytics-nav-label', label));
                if (key !== 'overview' && data) b.append(node('span', 'analytics-nav-count', fmt.format(value(key))));
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
        // Category list: the same choices as the side menu, as a drop-down list.
        function drawSectionSelect() {
            const select = get('section');
            select.replaceChildren();
            const label = (key, name) => key !== 'overview' && data ? `${name} (${fmt.format(value(key))})` : name;
            const first = node('option', '', 'Prezentare generală'); first.value = 'overview'; select.append(first);
            for (const group of groups) {
                const items = visibleMetrics().filter(m => m[3] === group);
                if (!items.length) continue;
                const og = node('optgroup'); og.label = group;
                for (const [key, name] of items) { const o = node('option', '', label(key, name)); o.value = key; og.append(o); }
                select.append(og);
            }
            select.value = section;
        }
        // Court list: every court the caller may pick, grouped by sport.
        function drawCourtOptions() {
            const select = get('court');
            const options = Array.isArray(data?.court_options) ? data.court_options : [];
            select.replaceChildren();
            const all = node('option', '', options.length === 1 ? 'Toate terenurile tale' : 'Toate terenurile'); all.value = ''; select.append(all);
            const bySport = new Map();
            for (const c of options) {
                const sport = c.sport || 'Terenuri șterse';
                if (!bySport.has(sport)) bySport.set(sport, []);
                bySport.get(sport).push(c);
            }
            for (const [sport, list] of bySport) {
                const group = node('optgroup'); group.label = sport;
                for (const c of list) {
                    const o = node('option', '', `${c.court}${c.city ? ' · ' + c.city : ''}${c.active ? '' : c.sport ? ' (ascuns)' : ''}`);
                    o.value = c.court; group.append(o);
                }
                select.append(group);
            }
            select.value = options.some(c => c.court === court) ? court : '';
        }

        // Columns per day (or per month), one series, one colour.
        function chart(key, label, { mini = false } = {}) {
            const list = series(key), buckets = data?.buckets || [];
            if (!list || list.length !== buckets.length) return null;
            const n = list.length;
            const W = mini ? 120 : Math.max(280, Math.min(1000, Math.round((get('content').clientWidth || 680) - 42)));
            const H = mini ? 34 : 200, top = mini ? 2 : 14, bottom = mini ? 2 : 26, left = mini ? 0 : 30;
            const max = Math.max(1, ...list);
            const niceMax = mini ? max : Math.max(4, Math.ceil(max / 4) * 4);
            const plotH = H - top - bottom, step = (W - left) / n;
            const gap = mini ? Math.min(1.5, step * 0.25) : Math.min(4, step * 0.25);
            const barW = Math.max(1, Math.min(mini ? 12 : 48, step - gap));
            const total = list.reduce((a, b) => a + b, 0);
            const chartEl = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: mini ? 'analytics-spark' : 'analytics-chart', role: 'img', 'aria-label': `${label}: ${fmt.format(total)} în ${periodWords()}` });
            if (!mini) {
                for (let i = 0; i <= 4; i++) {
                    const y = top + plotH - plotH * i / 4;
                    chartEl.append(svg('line', { x1: left, x2: W, y1: y, y2: y, class: i ? 'analytics-grid' : 'analytics-axis' }));
                    if (i % 2 === 0) { const t = svg('text', { x: left - 6, y: y + 4, class: 'analytics-tick', 'text-anchor': 'end' }); t.textContent = fmt.format(niceMax * i / 4); chartEl.append(t); }
                }
                const marks = n === 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
                for (const i of marks) {
                    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
                    const x = anchor === 'start' ? left + step * i : anchor === 'end' ? left + step * (i + 1) : left + step * i + step / 2;
                    const t = svg('text', { x, y: H - 6, class: 'analytics-tick', 'text-anchor': anchor });
                    t.textContent = data.bucket === 'day' && buckets[i] === data.today ? 'azi' : bucketLabel(buckets[i], false); chartEl.append(t);
                }
            }
            list.forEach((v, i) => {
                const h = v ? Math.max(mini ? 2 : 3, plotH * v / niceMax) : 0;
                const x = left + step * i + (step - barW) / 2, y = top + plotH - h;
                if (h) {
                    const r = Math.min(mini ? 1.5 : 4, barW / 2, h);
                    // Rounded top, square base on the axis.
                    chartEl.append(svg('path', { class: 'analytics-bar' + (buckets[i] === data.today ? ' is-today' : ''), d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z` }));
                }
                if (!mini) {
                    const hit = svg('rect', { x: left + step * i, y: top, width: step, height: plotH, class: 'analytics-hit' });
                    const lines = [bucketLabel(buckets[i], true) + (data.bucket === 'day' && buckets[i] === data.today ? ' (azi)' : ''), `${label}: ${fmt.format(v)}`];
                    hit.addEventListener('pointermove', e => showTip(e, lines));
                    hit.addEventListener('pointerleave', hideTip);
                    chartEl.append(hit);
                }
            });
            return chartEl;
        }

        const courtWords = () => court ? `terenul ${court}` : (data?.scope === 'own' ? 'terenurile tale' : 'toate terenurile');

        function drawOverview(content) {
            const title = node('h3', 'analytics-title', 'Prezentare generală'); title.tabIndex = -1;
            content.append(title, node('p', 'analytics-help', `${rangeText(data.from, data.to)} · ${courtWords()}. Apasă pe o casetă sau pe un buton din meniu pentru detalii.`));
            const grid = node('div', 'analytics-cards');
            for (const [key, label] of visibleMetrics()) {
                const card = node('button', 'analytics-card'); card.type = 'button';
                card.append(node('span', 'analytics-card-label', label), node('span', 'analytics-card-value', fmt.format(value(key))));
                const tr = trend(key); if (tr) card.append(tr);
                const spark = chart(key, label, { mini: true });
                if (spark) { spark.setAttribute('aria-hidden', 'true'); card.append(spark); }
                card.addEventListener('click', () => { section = key; draw(); get('content').querySelector('h3')?.focus({ preventScroll: true }); });
                grid.append(card);
            }
            content.append(grid);
        }
        function drawMetric(content, metric) {
            const [key, label, help, , , perCourt, average] = metric;
            const title = node('h3', 'analytics-title', label); title.tabIndex = -1;
            content.append(title, node('p', 'analytics-help', help));
            const hero = node('div', 'analytics-hero');
            const main = node('div', 'analytics-hero-main');
            main.append(node('span', 'analytics-hero-value', fmt.format(value(key))),
                node('span', 'analytics-hero-label', `${rangeText(data.from, data.to)} · ${perCourt ? courtWords() : 'tot site-ul'}`));
            const tr = trend(key); if (tr) main.append(tr);
            const side = node('dl', 'analytics-hero-periods');
            const fact = (name, text) => { const item = node('div'); item.append(node('dt', '', name), node('dd', '', text)); side.append(item); };
            if (previous(key) !== null && data.previous) fact('Perioada dinainte', fmt.format(previous(key)));
            if (average) fact('Media pe zi', fmt1.format(value(key) / daysBetween(data.from, data.to)));
            const s = series(key);
            if (s && Math.max(...s) > 0) {
                const best = s.indexOf(Math.max(...s));
                fact(data.bucket === 'month' ? 'Cea mai bună lună' : 'Cea mai bună zi', `${bucketLabel(data.buckets[best], false)} · ${fmt.format(s[best])}`);
            }
            hero.append(main);
            if (side.childElementCount) hero.append(side);
            content.append(hero);
            const c = chart(key, label);
            if (c) {
                const block = node('section', 'analytics-block');
                block.append(node('h4', 'analytics-block-title', data.bucket === 'month' ? 'Pe luni' : 'Pe zile'), c);
                content.append(block);
            }
        }
        function draw() {
            drawNav();
            const content = get('content'); content.replaceChildren();
            if (!data) return;
            const metric = visibleMetrics().find(m => m[0] === section);
            if (metric) drawMetric(content, metric); else { section = 'overview'; drawOverview(content); }
            drawSectionSelect();
        }
        function chosenRange() {
            if (period === 'custom') return isIso(custom.from) && isIso(custom.to) ? [custom.from, custom.to] : null;
            return periodInfo()[3](todayRo());
        }
        async function load() {
            if (!role || !isOpen()) return;
            const range = chosenRange();
            if (!range) { status('Alege data de început și data de sfârșit, apoi apasă „Arată”.'); return; }
            if (range[0] && range[1] && range[0] > range[1]) { status('Data de început trebuie să fie înaintea datei de sfârșit.', true); return; }
            const current = { user: role.userId, view, request: ++request };
            const fresh = () => role?.userId === current.user && view === current.view && request === current.request && isOpen();
            get('refresh').disabled = true; get('content').setAttribute('aria-busy', 'true'); status('Se încarcă statisticile…');
            try {
                const { data: result, error } = await db.rpc('admin_analytics_range', { p_from: range[0], p_to: range[1], p_court: court || null });
                if (!fresh()) return;
                if (error) throw error;
                data = result; drawCourtOptions(); draw();
                status(result?.generated_at ? `Actualizat la ${new Date(result.generated_at).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' })}.` : '');
            } catch (error) {
                if (!fresh()) return;
                if (error?.code === '42501' && court) { court = ''; get('court').value = ''; status('Nu ai acces la acest teren. Se arată toate terenurile tale.', true); load(); return; }
                status(error?.code === '42501' ? 'Acces refuzat. Numai administratorii văd analiticele.'
                    : error?.code === 'PGRST202' || error?.code === '42883' ? 'Statisticile pe perioade nu sunt încă active pe server (lipsește actualizarea bazei de date 051).'
                    : error?.code === '22023' ? 'Perioada aleasă nu este validă.'
                    : 'Statisticile nu au putut fi încărcate. Încearcă din nou.', true);
            } finally { if (fresh()) { get('refresh').disabled = false; get('content').removeAttribute('aria-busy'); } }
        }
        function close(restore = true) {
            view++; modal.style.display = 'none'; data = null; hideTip(); draw(); status('');
            if (window.syncSpotivityModalScroll) window.syncSpotivityModalScroll();
            else if (![...document.querySelectorAll('.modal')].some(el => ['flex', 'block'].includes(el.style.display))) document.body.classList.remove('fara-scroll');
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        get('period').addEventListener('change', () => {
            period = get('period').value; hideTip();
            const customForm = get('custom');
            customForm.hidden = period !== 'custom';
            if (period === 'custom') {
                const t = todayRo();
                get('to').max = t; get('from').max = t;
                if (!isIso(custom.from)) { custom = { from: data?.from || addDays(t, -29), to: data?.to || t }; }
                get('from').value = custom.from; get('to').value = custom.to;
                get('from').focus();
            }
            load();
        });
        get('custom').addEventListener('submit', e => {
            e.preventDefault();
            custom = { from: get('from').value, to: get('to').value };
            load();
        });
        get('section').addEventListener('change', () => { section = get('section').value; hideTip(); draw(); });
        get('court').addEventListener('change', () => { court = get('court').value; hideTip(); load(); });
        button.addEventListener('click', () => {
            if (!role) return;
            view++; previousFocus = document.activeElement; period = 'd30'; court = ''; section = 'overview';
            get('period').value = period; get('custom').hidden = true; data = null; drawCourtOptions();
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
            const focusable = [...panel.querySelectorAll('button:not(:disabled),select,input,summary,[tabindex="0"]')].filter(n => n.getClientRects().length);
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
