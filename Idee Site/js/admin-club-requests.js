/* Applications and contacts stay private; the approval service alone publishes bases and access. */
(() => {
    'use strict';
    const table = 'cereri_baze_sportive';
    const bucket = 'cereri_baze_sportive';
    const pageSize = 50;
    const summaryFields = 'id,created_at,nume_baza,nume_contact,oras,terenuri,stare';
    const detailFields = 'id,created_at,updated_at,solicitant_user_id,nume_baza,nume_contact,email,telefon,oras,adresa,link_maps,terenuri,descriere,poza_path,stare,nota_interna,reviewer_user_id,reviewed_at,reserved_base_id,approved_base_id,approved_court_ids,preturi_solicitate';
    const states = {
        noua: 'Nouă', in_analiza: 'În analiză', contactata: 'Contactată',
        acceptata: 'Acceptată', respinsa: 'Respinsă', arhivata: 'Arhivată'
    };
    const reviewStates = new Set(['noua', 'in_analiza', 'contactata', 'arhivata']);
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const photoPattern = new RegExp(`^${uuid}/${uuid}/${uuid}\\.(?:jpg|jpeg|png|webp|avif|gif)$`, 'i');
    const byId = id => document.getElementById(id);
    const operations = new Set();
    let role = null;
    let generation = 0;
    let viewGeneration = 0;
    let listGeneration = 0;
    let detailGeneration = 0;
    let countGeneration = 0;
    let records = [];
    let selected = null;
    let loading = false;
    let saving = false;
    let hasMore = false;
    let lastFocus = null;
    let verificationTimer = null;
    let pendingDecision = null;

    const isOpen = () => byId('modal-cereri-baze-admin')?.style.display === 'flex';
    const current = context => role?.isSuper === true && context.generation === generation
        && context.userId === role.userId && !context.controller.signal.aborted
        && (!context.view || (context.view === viewGeneration && isOpen()))
        && (!context.detail || context.detail === detailGeneration);
    function check(context) {
        if (!current(context)) throw new Error('Contextul cererii s-a schimbat.');
    }
    function operation({ view = false, detail = false } = {}) {
        if (!role?.isSuper) return null;
        const context = {
            generation, userId: role.userId, controller: new AbortController(),
            view: view ? viewGeneration : 0, detail: detail ? detailGeneration : 0
        };
        operations.add(context);
        return context;
    }
    function finish(context) { operations.delete(context); }
    function message(id, text, error = false) {
        const node = byId(id);
        node.textContent = text;
        node.classList.toggle('is-error', error);
    }
    function abortOperations(viewOnly = false) {
        for (const context of operations) {
            if (!viewOnly || context.view) {
                context.controller.abort();
                operations.delete(context);
            }
        }
    }
    function clearPhoto() {
        const photo = byId('admin-cerere-photo');
        photo.hidden = true;
        photo.removeAttribute('src');
        message('admin-cerere-photo-status', '');
    }
    function clearDecision(restoreFocus = false) {
        const previous = pendingDecision?.action;
        pendingDecision = null;
        byId('admin-cerere-confirm').hidden = true;
        byId('admin-cerere-confirm-description').textContent = '';
        byId('admin-cerere-confirm-prices').replaceChildren();
        if (restoreFocus) byId(previous === 'reject' ? 'admin-cerere-reject' : 'admin-cerere-approve').focus();
    }
    function clearDetail() {
        detailGeneration++;
        selected = null;
        saving = false;
        clearPhoto();
        byId('admin-cerere-detail').hidden = true;
        byId('admin-cereri-directory').classList.remove('has-selected-request');
        byId('admin-cerere-title').textContent = '';
        byId('admin-cerere-data').replaceChildren();
        byId('admin-cerere-state').value = 'noua';
        byId('admin-cerere-state-field').hidden = false;
        byId('admin-cerere-note').value = '';
        byId('admin-cerere-save').disabled = false;
        byId('admin-cerere-state').disabled = false;
        byId('admin-cerere-note').disabled = false;
        byId('admin-cerere-save').textContent = 'Salvează modificările';
        byId('admin-cerere-form').setAttribute('aria-busy', 'false');
        clearDecision();
        byId('admin-cerere-decision').hidden = true;
        byId('admin-cerere-price-fields').replaceChildren();
        byId('admin-cerere-prices').disabled = false;
        for (const id of ['admin-cerere-approve', 'admin-cerere-reject', 'admin-cerere-confirm-submit', 'admin-cerere-confirm-cancel', 'admin-cerere-back', 'admin-cereri-filter', 'admin-cereri-refresh', 'admin-cereri-more']) byId(id).disabled = false;
        byId('admin-cerere-decision').setAttribute('aria-busy', 'false');
        message('admin-cerere-save-status', '');
        message('admin-cerere-decision-status', '');
        for (const node of byId('admin-cereri-list').querySelectorAll('[aria-current]')) node.removeAttribute('aria-current');
    }
    function clearView() {
        viewGeneration++;
        listGeneration++;
        abortOperations(true);
        clearDetail();
        records = [];
        loading = false;
        hasMore = false;
        byId('admin-cereri-list').replaceChildren();
        byId('admin-cereri-more').hidden = true;
        byId('admin-cereri-more').disabled = false;
        byId('admin-cereri-refresh').disabled = false;
        byId('admin-cereri-list').setAttribute('aria-busy', 'false');
        message('admin-cereri-status', '');
        clearInterval(verificationTimer);
        verificationTimer = null;
    }
    function close(restoreFocus = true) {
        byId('modal-cereri-baze-admin').style.display = 'none';
        clearView();
        if (restoreFocus && lastFocus?.isConnected && !byId('btn-cereri-baze-admin').hidden) lastFocus.focus();
        lastFocus = null;
    }
    function clear() {
        generation++;
        countGeneration++;
        role = null;
        abortOperations();
        byId('btn-cereri-baze-admin').hidden = true;
        byId('admin-cereri-badge').hidden = true;
        byId('admin-cereri-badge').textContent = '0';
        byId('admin-cereri-filter').value = '';
        close(false);
    }

    async function authorizedClient(context) {
        check(context);
        const { data: identity, error: identityError } = await db.auth.getUser();
        check(context);
        if (identityError || identity?.user?.id !== context.userId) {
            clear();
            throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
        }
        const { data, error } = await db.auth.getSession();
        check(context);
        const session = data?.session;
        if (error || session?.user?.id !== context.userId || !session.access_token || !session.refresh_token) {
            clear();
            throw new Error('Sesiunea a expirat. Conectează-te din nou.');
        }
        // Freeze this operation to the verified account, including Storage, UPDATE and approval requests.
        const client = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        const { error: bindError } = await client.auth.setSession({
            access_token: session.access_token, refresh_token: session.refresh_token
        });
        check(context);
        if (bindError) throw new Error('Sesiunea a expirat. Conectează-te din nou.');
        const { data: verified, error: verifiedError } = await client.auth.getUser();
        check(context);
        if (verifiedError || verified?.user?.id !== context.userId) {
            clear();
            throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
        }
        const result = await client.from('users_admin').select('is_super').eq('user_id', context.userId)
            .abortSignal(context.controller.signal).maybeSingle();
        check(context);
        if (result.error) throw new Error('Permisiunile nu au putut fi verificate. Încearcă din nou.');
        if (result.data?.is_super !== true) {
            clear();
            throw new Error('Accesul de superadmin nu mai este disponibil.');
        }
        return client;
    }

    async function refreshCount() {
        const context = operation();
        if (!context) return;
        const request = ++countGeneration;
        try {
            const client = await authorizedClient(context);
            const { count, error } = await client.from(table).select('id', { count: 'exact', head: true })
                .eq('stare', 'noua').abortSignal(context.controller.signal);
            if (!current(context) || request !== countGeneration) return;
            if (error) {
                byId('admin-cereri-badge').hidden = true;
                return;
            }
            const badge = byId('admin-cereri-badge');
            badge.textContent = String(count || 0);
            badge.setAttribute('aria-label', `${count || 0} cereri noi`);
            badge.hidden = !(count > 0);
        } catch (_) {
            if (current(context) && request === countGeneration) byId('admin-cereri-badge').hidden = true;
        } finally { finish(context); }
    }

    function date(value) {
        const parsed = new Date(value);
        return value && Number.isFinite(parsed.getTime())
            ? parsed.toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bucharest' }) : '—';
    }
    function element(tag, text, className = '') {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = String(text ?? '');
        if (className) node.className = className;
        return node;
    }
    function sportLabel(value) {
        return value === 'Tenis Picior' ? 'Tenis de picior' : String(value || '');
    }
    function renderList() {
        const list = byId('admin-cereri-list');
        const fragment = document.createDocumentFragment();
        for (const record of records) {
            const button = element('button', undefined, 'admin-club-request');
            button.type = 'button';
            button.dataset.clubRequestId = record.id;
            if (selected?.id === record.id) button.setAttribute('aria-current', 'true');
            const heading = element('span', record.nume_baza, 'admin-club-request-name');
            const state = element('span', states[record.stare] || record.stare, 'admin-club-state');
            state.dataset.state = record.stare;
            const courts = Array.isArray(record.terenuri) ? record.terenuri : [];
            const sports = [...new Set(courts.map(court => sportLabel(court.sport)).filter(Boolean))];
            button.append(heading, state,
                element('span', [record.oras, `${courts.length} ${courts.length === 1 ? 'teren' : 'terenuri'}`].join(' · '), 'admin-club-help'),
                element('span', sports.join(', '), 'admin-club-help'),
                element('span', date(record.created_at), 'admin-club-date'));
            fragment.append(button);
        }
        list.replaceChildren(fragment);
        byId('admin-cereri-more').hidden = !hasMore;
    }

    async function loadList(more = false, keepDetail = false) {
        if (more && (loading || !hasMore)) return;
        const context = operation({ view: true });
        if (!context) return;
        const request = ++listGeneration;
        if (!more) {
            if (!keepDetail) clearDetail();
            records = [];
            hasMore = false;
            renderList();
        }
        loading = true;
        byId('admin-cereri-more').disabled = true;
        byId('admin-cereri-refresh').disabled = true;
        byId('admin-cereri-list').setAttribute('aria-busy', 'true');
        message('admin-cereri-status', 'Se încarcă cererile…');
        const offset = records.length;
        const filter = byId('admin-cereri-filter').value;
        try {
            const client = await authorizedClient(context);
            let query = client.from(table).select(summaryFields).order('created_at', { ascending: false }).order('id', { ascending: false });
            if (filter && Object.hasOwn(states, filter)) query = query.eq('stare', filter);
            const { data, error } = await query.range(offset, offset + pageSize - 1).abortSignal(context.controller.signal);
            if (!current(context) || request !== listGeneration) return;
            if (error || !Array.isArray(data)) throw new Error('Cererile nu au putut fi încărcate. Apasă „Reîncarcă lista” pentru a încerca din nou.');
            records = more ? records.concat(data.filter(row => !records.some(existing => existing.id === row.id))) : data;
            hasMore = data.length === pageSize;
            renderList();
            message('admin-cereri-status', records.length ? `${records.length} ${records.length === 1 ? 'cerere afișată' : 'cereri afișate'}.` : 'Nu există cereri pentru filtrul ales.');
        } catch (error) {
            if (current(context) && request === listGeneration) message('admin-cereri-status', error.message || 'Încărcarea a eșuat. Reîncearcă.', true);
        } finally {
            if (current(context) && request === listGeneration) {
                loading = false;
                byId('admin-cereri-more').disabled = false;
                byId('admin-cereri-refresh').disabled = false;
                byId('admin-cereri-list').setAttribute('aria-busy', 'false');
            }
            finish(context);
        }
    }

    function mapsUrl(value) {
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password) return '';
            if (['maps.app.goo.gl', 'maps.google.com', 'maps.google.ro'].includes(url.hostname)
                || (['google.com', 'www.google.com', 'google.ro', 'www.google.ro', 'goo.gl'].includes(url.hostname)
                    && /^\/maps(?:\/|$)/.test(url.pathname))) return url.href;
        } catch (_) { /* No external navigation for malformed application data. */ }
        return '';
    }
    function field(list, label, value, link = null) {
        const item = element('div');
        item.append(element('dt', label));
        const data = element('dd');
        if (link) {
            const anchor = element('a', value);
            anchor.href = link;
            if (link.startsWith('https:')) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
            data.append(anchor);
        } else data.textContent = value || '—';
        item.append(data);
        list.append(item);
    }
    function isPublished(record) {
        return typeof record?.approved_base_id === 'string' && new RegExp(`^${uuid}$`, 'i').test(record.approved_base_id);
    }
    const isProvisioned = record => isPublished(record) || Array.isArray(record?.approved_court_ids);
    function renderDecision(record) {
        clearDecision();
        const published = isPublished(record);
        const final = isProvisioned(record) || record.stare === 'respinsa';
        byId('admin-cerere-state-field').hidden = final || record.stare === 'acceptata';
        byId('admin-cerere-save').textContent = final || record.stare === 'acceptata' ? 'Salvează nota internă' : 'Salvează modificările';
        byId('admin-cerere-decision').hidden = final;
        const fields = byId('admin-cerere-price-fields');
        fields.replaceChildren();
        if (published) {
            const status = byId('admin-cerere-decision-status');
            status.classList.remove('is-error');
            const link = element('a', 'Vezi baza publicată');
            const url = new URL('index.html', window.location.href);
            url.searchParams.set('baza', record.approved_base_id);
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            status.replaceChildren(document.createTextNode('Bază publicată, acces admin activ. '), link);
            return;
        }
        if (isProvisioned(record)) {
            message('admin-cerere-decision-status', 'Cererea a fost acceptată anterior. Baza nu mai este disponibilă; această cerere nu poate crea din nou baza sau accesul de admin.');
            return;
        }
        if (record.stare === 'respinsa') {
            message('admin-cerere-decision-status', 'Cerere respinsă. Nu au fost create baza, terenurile sau permisiuni de admin.');
            return;
        }
        message('admin-cerere-decision-status', '');
        const courts = Array.isArray(record.terenuri) ? record.terenuri : [];
        const prices = Array.isArray(record.preturi_solicitate) ? record.preturi_solicitate : [];
        courts.forEach((court, index) => {
            const group = element('div', undefined, 'grup-input');
            const id = `admin-cerere-price-${index}`;
            const label = element('label', `${court.nume || `Teren ${index + 1}`} · ${sportLabel(court.sport)}`);
            label.htmlFor = id;
            const input = document.createElement('input');
            input.id = id;
            input.type = 'number';
            input.min = '0';
            input.max = '100000';
            input.step = '1';
            input.required = true;
            input.inputMode = 'numeric';
            input.dataset.courtPriceIndex = String(index);
            input.setAttribute('aria-label', `Tarif lei/oră pentru ${court.nume || `terenul ${index + 1}`}`);
            input.placeholder = 'Tarif lei/oră';
            // Legacy requests have no tariff: require an explicit price, including an intentional zero.
            if (Number.isInteger(prices[index]) && prices[index] >= 0 && prices[index] <= 100000) input.value = String(prices[index]);
            group.append(label, input);
            fields.append(group);
        });
    }
    function renderDetail(record) {
        selected = record;
        byId('admin-cerere-title').textContent = record.nume_baza;
        const content = byId('admin-cerere-data');
        const details = element('dl', undefined, 'admin-club-fields');
        const email = typeof record.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email) ? `mailto:${encodeURIComponent(record.email)}` : null;
        const phone = typeof record.telefon === 'string' ? record.telefon.replace(/[\s().-]/g, '') : '';
        field(details, 'Persoană de contact', record.nume_contact);
        field(details, 'Email', record.email, email);
        field(details, 'Telefon', record.telefon, /^\+?\d{7,15}$/.test(phone) ? `tel:${phone}` : null);
        field(details, 'Oraș', record.oras);
        field(details, 'Adresă', record.adresa);
        field(details, 'Google Maps', record.link_maps, mapsUrl(record.link_maps));
        field(details, 'Trimisă la', date(record.created_at));
        field(details, 'Ultima actualizare', date(record.updated_at));
        if (record.reviewed_at) field(details, 'Ultima analiză', date(record.reviewed_at));
        const courtsTitle = element('h4', 'Terenuri și sporturi');
        const courts = element('ul', undefined, 'admin-club-courts');
        for (const court of Array.isArray(record.terenuri) ? record.terenuri : []) {
            courts.append(element('li', `${court.nume || 'Teren'} · ${sportLabel(court.sport)}`));
        }
        content.replaceChildren(details, courtsTitle, courts, element('h4', 'Descriere'), element('p', record.descriere || 'Nu a fost adăugată o descriere.', 'admin-club-description'));
        byId('admin-cerere-state').value = reviewStates.has(record.stare) ? record.stare : 'noua';
        byId('admin-cerere-note').value = record.nota_interna || '';
        renderDecision(record);
        byId('admin-cerere-detail').hidden = false;
        byId('admin-cereri-directory').classList.add('has-selected-request');
        renderList();
    }

    function privatePhotoPath(record) {
        return typeof record.poza_path === 'string' && photoPattern.test(record.poza_path)
            && (record.solicitant_user_id === null || record.poza_path.split('/')[0] === record.solicitant_user_id)
            && record.poza_path.split('/')[1] === record.id ? record.poza_path : '';
    }
    async function loadPhoto(record, client, context) {
        clearPhoto();
        const path = privatePhotoPath(record);
        if (!path) {
            message('admin-cerere-photo-status', record.poza_path ? 'Fotografia nu poate fi afișată.' : 'Nu a fost trimisă o fotografie.');
            return;
        }
        message('admin-cerere-photo-status', 'Se încarcă fotografia privată…');
        try {
            const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 60);
            if (!current(context) || selected?.id !== record.id) return;
            if (error || !data?.signedUrl) throw new Error('Fotografia nu a putut fi încărcată. Redeschide cererea pentru a reîncerca.');
            const url = new URL(data.signedUrl);
            const expectedPath = `/storage/v1/object/sign/${bucket}/${path}`;
            if (url.origin !== new URL(supabaseUrl).origin || url.username || url.password || url.pathname !== expectedPath || !url.searchParams.get('token')) {
                throw new Error('Fotografia nu poate fi afișată în siguranță.');
            }
            const photo = byId('admin-cerere-photo');
            photo.alt = `Fotografia trimisă · ${record.nume_baza}`;
            photo.src = url.href;
            photo.hidden = false;
            message('admin-cerere-photo-status', isPublished(record)
                ? 'Fotografia cererii rămâne privată; o copie a fost publicată la baza acceptată.'
                : 'Fotografie privată. Acceptarea va publica o copie la baza sportivă.');
        } catch (error) {
            if (current(context) && selected?.id === record.id) {
                clearPhoto();
                message('admin-cerere-photo-status', error.message || 'Fotografia nu a putut fi afișată.', true);
            }
        }
    }

    async function openDetail(id) {
        if (saving || !records.some(row => row.id === id)) return;
        clearDetail();
        const context = operation({ view: true, detail: true });
        if (!context) return;
        message('admin-cereri-status', 'Se încarcă detaliile cererii…');
        try {
            const client = await authorizedClient(context);
            const { data, error } = await client.from(table).select(detailFields).eq('id', id)
                .abortSignal(context.controller.signal).maybeSingle();
            if (!current(context)) return;
            if (error || !data) throw new Error('Cererea nu mai este disponibilă sau nu ai permisiune. Reîncarcă lista.');
            renderDetail(data);
            message('admin-cereri-status', '');
            byId('admin-cerere-title').focus();
            await loadPhoto(data, client, context);
        } catch (error) {
            if (current(context)) message('admin-cereri-status', error.message || 'Detaliile nu au putut fi încărcate.', true);
        } finally { finish(context); }
    }

    function savingControls(value) {
        saving = value;
        for (const id of ['admin-cerere-save', 'admin-cerere-state', 'admin-cerere-note', 'admin-cerere-approve', 'admin-cerere-reject', 'admin-cerere-confirm-submit', 'admin-cerere-confirm-cancel', 'admin-cerere-back', 'admin-cereri-filter', 'admin-cereri-refresh', 'admin-cereri-more']) byId(id).disabled = value;
        byId('admin-cerere-prices').disabled = value;
        byId('admin-cerere-save').textContent = value ? 'Se salvează…'
            : selected && (isProvisioned(selected) || ['acceptata', 'respinsa'].includes(selected.stare)) ? 'Salvează nota internă' : 'Salvează modificările';
        byId('admin-cerere-form').setAttribute('aria-busy', String(value));
        byId('admin-cerere-decision').setAttribute('aria-busy', String(value));
    }
    async function save(event) {
        event.preventDefault();
        if (saving || !selected || !role?.isSuper) return;
        const context = operation({ view: true, detail: true });
        const record = selected;
        const state = isProvisioned(record) || ['acceptata', 'respinsa'].includes(record.stare) ? record.stare : byId('admin-cerere-state').value;
        const note = byId('admin-cerere-note').value.trim();
        if ((!reviewStates.has(state) && state !== record.stare) || !Object.hasOwn(states, state) || note.length > 2000) {
            finish(context);
            return message('admin-cerere-save-status', 'Alege o stare validă și o notă de cel mult 2.000 de caractere.', true);
        }
        savingControls(true);
        clearDecision();
        message('admin-cerere-save-status', '');
        try {
            const client = await authorizedClient(context);
            check(context);
            let query = client.from(table).update({ stare: state, nota_interna: note }).eq('id', record.id);
            // Avoid replacing a second superadmin's more recent review.
            if (record.updated_at) query = query.eq('updated_at', record.updated_at);
            const { data, error } = await query.select(detailFields).abortSignal(context.controller.signal).maybeSingle();
            if (!current(context) || selected?.id !== record.id) return;
            if (error) throw new Error('Salvarea nu a reușit. Verifică permisiunile și reîncearcă.');
            if (!data) throw new Error('Cererea a fost modificată între timp sau accesul s-a schimbat. Redeschide cererea înainte de a salva.');
            renderDetail(data);
            message('admin-cerere-save-status', 'Starea și nota internă au fost salvate.');
            await Promise.allSettled([loadList(false, true), refreshCount()]);
        } catch (error) {
            if (current(context)) message('admin-cerere-save-status', error.message || 'Salvarea nu a reușit.', true);
        } finally {
            if (current(context)) savingControls(false);
            finish(context);
        }
    }

    function readPrices() {
        const courts = Array.isArray(selected?.terenuri) ? selected.terenuri : [];
        if (!courts.length) throw new Error('Cererea nu conține terenuri care pot fi publicate.');
        return courts.map((_, index) => {
            const input = byId(`admin-cerere-price-${index}`);
            if (!input || !/^\d+$/.test(input.value) || !Number.isInteger(Number(input.value))
                || Number(input.value) < 0 || Number(input.value) > 100000 || !input.checkValidity()) {
                input?.focus();
                input?.reportValidity();
                throw new Error('Completează pentru fiecare teren un tarif întreg între 0 și 100.000 lei/oră.');
            }
            return Number(input.value);
        });
    }
    function prepareDecision(action) {
        if (saving || !selected || !role?.isSuper || isProvisioned(selected) || selected.stare === 'respinsa') return;
        clearDecision();
        message('admin-cerere-decision-status', '');
        try {
            if (action === 'approve' && selected.stare === 'arhivata') throw new Error('Schimbă starea cererii arhivate în „În analiză” și salvează înainte de a o accepta.');
            const note = byId('admin-cerere-note').value.trim();
            if (note.length > 2000) throw new Error('Nota internă poate avea cel mult 2.000 de caractere.');
            const prices = action === 'approve' ? readPrices() : [];
            pendingDecision = { action, id: selected.id, updatedAt: selected.updated_at, prices, note };
            const approve = action === 'approve';
            byId('admin-cerere-confirm-title').textContent = approve ? 'Confirmă acceptarea și publicarea' : 'Confirmă respingerea';
            byId('admin-cerere-confirm-description').textContent = approve
                ? `Publici „${selected.nume_baza}” în ${selected.oras}, cu ${prices.length} ${prices.length === 1 ? 'teren activ' : 'terenuri active'} și fotografia trimisă, dacă există. Solicitantul primește acces de admin numai la această bază. Datele sale de contact rămân private.`
                : `Respingi cererea „${selected.nume_baza}”. Nu se publică o bază și nu se acordă acces de admin. Nota internă rămâne vizibilă numai superadminilor.`;
            const list = byId('admin-cerere-confirm-prices');
            prices.forEach((price, index) => list.append(element('li', `${selected.terenuri[index].nume || `Teren ${index + 1}`} · ${price} lei/oră`)));
            byId('admin-cerere-confirm-submit').textContent = approve ? 'Confirmă acceptarea și publică' : 'Confirmă respingerea';
            byId('admin-cerere-confirm-submit').classList.toggle('admin-club-reject', !approve);
            byId('admin-cerere-confirm').hidden = false;
            byId('admin-cerere-confirm-title').focus();
        } catch (error) {
            message('admin-cerere-decision-status', error.message || 'Verifică datele cererii.', true);
        }
    }
    function decisionError(response, payload) {
        const codes = {
            email_confirmation_required: 'Solicitantul trebuie să confirme adresa de email înainte de acceptare. Cererea nu a fost publicată.',
            conflict: 'Cererea a fost modificată între timp. Reîncarcă lista și verifică din nou datele.',
            already_published: 'Baza acestei cereri este deja publicată. Reîncarcă lista.',
            forbidden: 'Permisiunea de superadmin nu mai este disponibilă.',
            unauthorized: 'Sesiunea a expirat. Conectează-te din nou.'
        };
        return codes[payload?.code] || (typeof payload?.error === 'string' && payload.error.length <= 500 ? payload.error : '')
            || (response.status === 409 ? codes.conflict : 'Decizia nu a putut fi salvată. Reîncarcă cererea pentru a verifica starea ei înainte de a reîncerca.');
    }
    async function submitDecision() {
        if (saving || !pendingDecision || !selected || !role?.isSuper || isProvisioned(selected) || selected.stare === 'respinsa') return;
        const decision = pendingDecision;
        const record = selected;
        if (decision.id !== record.id || decision.updatedAt !== record.updated_at) {
            clearDecision();
            return message('admin-cerere-decision-status', 'Cererea s-a schimbat. Verifică din nou datele înainte de confirmare.', true);
        }
        const context = operation({ view: true, detail: true });
        if (!context) return;
        savingControls(true);
        byId('admin-cerere-confirm-submit').textContent = decision.action === 'approve' ? 'Se publică baza…' : 'Se respinge cererea…';
        message('admin-cerere-decision-status', decision.action === 'approve' ? 'Se verifică și se publică baza sportivă…' : 'Se înregistrează respingerea…');
        try {
            const client = await authorizedClient(context);
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            check(context);
            if (sessionError || sessionData?.session?.user?.id !== context.userId || !sessionData?.session?.access_token) {
                throw new Error('Sesiunea a expirat. Conectează-te din nou.');
            }
            const body = {
                action: decision.action, request_id: record.id, expected_updated_at: record.updated_at,
                note: decision.note
            };
            if (decision.action === 'approve') body.prices = decision.prices;
            const response = await fetch(`${supabaseUrl}/functions/v1/club-applications`, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json', apikey: supabaseKey,
                    Authorization: `Bearer ${sessionData.session.access_token}`
                }, body: JSON.stringify(body), signal: context.controller.signal
            });
            const payload = await response.json().catch(() => null);
            check(context);
            if (!response.ok) throw new Error(decisionError(response, payload));
            const expectedStatus = decision.action === 'approve' ? 'acceptata' : 'respinsa';
            if (payload?.request_id !== record.id || payload?.status !== expectedStatus
                || (decision.action === 'approve' && !isPublished({ approved_base_id: payload.base_id }))) {
                throw new Error('Răspunsul publicării nu a putut fi verificat. Reîncarcă cererea înainte de a reîncerca.');
            }
            // Read the committed record instead of presenting a locally invented approval state.
            const { data, error } = await client.from(table).select(detailFields).eq('id', record.id)
                .abortSignal(context.controller.signal).maybeSingle();
            check(context);
            if (error || !data || data.stare !== expectedStatus
                || (decision.action === 'approve' && data.approved_base_id !== payload.base_id)) {
                clearDecision();
                byId('admin-cerere-decision').hidden = true;
                throw new Error('Decizia a fost înregistrată, dar detaliile nu au putut fi reîncărcate. Reîncarcă lista pentru a vedea rezultatul.');
            }
            renderDetail(data);
            message('admin-cerere-save-status', decision.action === 'approve'
                ? 'Cererea a fost acceptată. Baza și terenurile sunt publicate, iar accesul de admin la această bază este activ.'
                : 'Cererea a fost respinsă. Nu s-a acordat acces de admin.');
            await Promise.allSettled([loadList(false, true), refreshCount()]);
        } catch (error) {
            if (current(context)) message('admin-cerere-decision-status', error.message || 'Decizia nu a putut fi salvată.', true);
        } finally {
            if (current(context)) {
                savingControls(false);
                if (pendingDecision) byId('admin-cerere-confirm-submit').textContent = pendingDecision.action === 'approve'
                    ? 'Confirmă acceptarea și publică' : 'Confirmă respingerea';
            }
            finish(context);
        }
    }

    async function verifyWhileOpen() {
        if (!isOpen() || document.hidden || !role?.isSuper) return;
        const context = operation({ view: true });
        try { await authorizedClient(context); }
        catch (_) {
            if (current(context)) {
                // Do not leave private details on screen when permission cannot be checked.
                clearView();
                message('admin-cereri-status', 'Permisiunile nu au putut fi verificate. Reîncarcă lista pentru a continua.', true);
            }
        } finally { finish(context); }
    }
    function open() {
        if (!role?.isSuper) return;
        lastFocus = document.activeElement;
        clearView();
        byId('modal-cereri-baze-admin').style.display = 'flex';
        byId('admin-cereri-close').focus();
        loadList();
        refreshCount();
        verificationTimer = setInterval(verifyWhileOpen, 60000);
    }

    window.addEventListener('spotivity:admin-role', event => {
        clear();
        const detail = event.detail;
        if (detail?.isSuper !== true || typeof detail.userId !== 'string' || !new RegExp(`^${uuid}$`, 'i').test(detail.userId)) return;
        role = { userId: detail.userId, isSuper: true };
        byId('btn-cereri-baze-admin').hidden = false;
        refreshCount();
    });
    window.addEventListener('spotivity:admin-clear', clear);
    db.auth.onAuthStateChange((event, session) => {
        if (role && (event === 'SIGNED_OUT' || session?.user?.id !== role.userId)) clear();
    });
    window.addEventListener('focus', verifyWhileOpen);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verifyWhileOpen(); });
    document.addEventListener('DOMContentLoaded', () => {
        byId('btn-cereri-baze-admin').addEventListener('click', open);
        byId('admin-cereri-close').addEventListener('click', () => close());
        byId('admin-cereri-refresh').addEventListener('click', () => { loadList(); refreshCount(); });
        byId('admin-cereri-filter').addEventListener('change', () => loadList());
        byId('admin-cereri-more').addEventListener('click', () => loadList(true));
        byId('admin-cereri-list').addEventListener('click', event => {
            const button = event.target.closest('[data-club-request-id]');
            if (button) openDetail(button.dataset.clubRequestId);
        });
        byId('admin-cerere-back').addEventListener('click', () => {
            const previous = selected?.id;
            clearDetail();
            const button = Array.from(byId('admin-cereri-list').querySelectorAll('[data-club-request-id]')).find(node => node.dataset.clubRequestId === previous);
            (button || byId('admin-cereri-filter')).focus();
        });
        byId('admin-cerere-form').addEventListener('submit', save);
        byId('admin-cerere-approve').addEventListener('click', () => prepareDecision('approve'));
        byId('admin-cerere-reject').addEventListener('click', () => prepareDecision('reject'));
        byId('admin-cerere-confirm-submit').addEventListener('click', submitDecision);
        byId('admin-cerere-confirm-cancel').addEventListener('click', () => clearDecision(true));
        for (const id of ['admin-cerere-price-fields', 'admin-cerere-note']) byId(id).addEventListener('input', () => {
            if (!saving) clearDecision();
        });
        byId('admin-cerere-photo').addEventListener('error', () => {
            if (!selected) return;
            clearPhoto();
            message('admin-cerere-photo-status', 'Fotografia nu a putut fi afișată. Redeschide cererea pentru a reîncerca.', true);
        });
        const modal = byId('modal-cereri-baze-admin');
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(modal.querySelectorAll('a[href], button, input, select, textarea'))
                .filter(node => !node.disabled && node.getClientRects().length);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        // Existing admin Escape/backdrop handlers also close dialogs directly through style.display.
        new MutationObserver(() => {
            if (!isOpen() && (records.length || selected || loading || verificationTimer)) clearView();
        }).observe(modal, { attributes: true, attributeFilter: ['style'] });
    });
})();
