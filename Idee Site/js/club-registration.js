/* Registration requests stay private. Supabase enforces submission and review permissions. */
(() => {
    'use strict';
    const copy = {
        ro: {
            eyebrow: 'Pentru cluburi și baze sportive', title: 'Înscrie-ți baza sportivă', intro: 'Ai unul sau mai multe terenuri? Trimite-ne detaliile și hai să le aducem mai aproape de jucători.', open: 'Înscrie baza sportivă',
            privacy: 'Cererea și fotografia sunt vizibile doar superadminului. Trimiterea nu publică automat baza.', details: 'Datele bazei sportive', name: 'Numele bazei / clubului *', contact: 'Persoană de contact *', email: 'Email de contact *', phone: 'Număr de telefon *', city: 'Oraș *', address: 'Adresă', maps: 'Link Google Maps *', mapsHint: 'Copiază linkul locației din Google Maps.', courts: 'Terenurile tale', courtsHint: 'Adaugă fiecare teren și sportul său. Maximum 20.', court: 'Terenul {n}', courtName: 'Numele terenului *', sport: 'Sport *', addCourt: '+ Adaugă un teren', removeCourt: 'Elimină', description: 'Alte detalii', photo: 'Fotografie (opțional)', photoHint: 'JPG, PNG, WebP, AVIF sau GIF, maximum 5 MB. Nu include documente sau date personale în fotografie.', removePhoto: 'Elimină fotografia', consent: 'Sunt de acord să fiu contactat în legătură cu această cerere.', submit: 'Trimite cererea', login: 'Autentifică-te pentru a trimite', close: 'Închide',
            loginHint: 'Autentifică-te pentru a trimite cererea. Detaliile rămân completate, iar trimiterea se face doar când apeși din nou butonul.', ready: 'Te-ai autentificat. Verifică detaliile și apasă „Trimite cererea” când ești gata.', uploading: 'Se încarcă fotografia în siguranță…', sending: 'Se trimite cererea…', success: 'Cererea a fost trimisă superadminului. Te vom contacta după verificare.', failed: 'Cererea nu a putut fi trimisă. Detaliile au rămas completate. Încearcă din nou.', photoFailed: 'Fotografia nu a putut fi încărcată. Detaliile au rămas completate. Încearcă din nou.', invalidPhoto: 'Alege o fotografie JPG, PNG, WebP, AVIF sau GIF de maximum 5 MB.', invalidMaps: 'Introdu un link HTTPS valid de la Google Maps.', invalidPhone: 'Introdu un număr de telefon valid, cu 7–15 cifre.', invalidCourt: 'Completează numele și sportul fiecărui teren. Numele terenurilor trebuie să fie diferite.', invalidForm: 'Verifică și completează câmpurile obligatorii.', rate: 'Ai atins limita de 5 cereri pe zi. Poți încerca din nou mâine.', session: 'Sesiunea s-a schimbat. Autentifică-te din nou înainte de trimitere.', uncertain: 'Nu am primit confirmarea trimiterii. Apasă „Verifică trimiterea” pentru a verifica aceeași cerere, fără să o dublezi.', retry: 'Verifică trimiterea', photoUncertain: 'Încărcarea fotografiei nu a fost confirmată. Apasă „Reîncearcă trimiterea” pentru a continua aceeași cerere.', retryUpload: 'Reîncearcă trimiterea', busy: 'Trimiterea este în curs. Așteaptă confirmarea.'
        },
        hu: {
            eyebrow: 'Kluboknak és sportközpontoknak', title: 'Regisztráld sportközpontodat', intro: 'Egy vagy több sportpályád van? Küldd el az adataikat, és segítsünk a játékosoknak megtalálni őket.', open: 'Sportközpont regisztrálása',
            privacy: 'A kérelmet és a fényképet csak a főadminisztrátor láthatja. Az elküldés nem teszi közzé automatikusan a sportközpontot.', details: 'A sportközpont adatai', name: 'A sportközpont / klub neve *', contact: 'Kapcsolattartó neve *', email: 'Kapcsolattartási email *', phone: 'Telefonszám *', city: 'Város *', address: 'Cím', maps: 'Google Maps hivatkozás *', mapsHint: 'Másold ide a hely Google Maps hivatkozását.', courts: 'Sportpályáid', courtsHint: 'Add hozzá a pályákat és sportágukat. Legfeljebb 20 pálya.', court: '{n}. pálya', courtName: 'A pálya neve *', sport: 'Sportág *', addCourt: '+ Pálya hozzáadása', removeCourt: 'Törlés', description: 'További információk', photo: 'Fénykép (nem kötelező)', photoHint: 'JPG, PNG, WebP, AVIF vagy GIF, legfeljebb 5 MB. Ne szerepeljenek dokumentumok vagy személyes adatok a képen.', removePhoto: 'Fénykép eltávolítása', consent: 'Hozzájárulok, hogy megkeressenek ezzel a kérelemmel kapcsolatban.', submit: 'Kérelem elküldése', login: 'Jelentkezz be az elküldéshez', close: 'Bezárás',
            loginHint: 'A kérelem elküldéséhez jelentkezz be. A kitöltött adatok megmaradnak; a küldéshez újra meg kell nyomnod a gombot.', ready: 'Sikeres bejelentkezés. Ellenőrizd az adatokat, majd küldd el a kérelmet.', uploading: 'A fénykép biztonságos feltöltése…', sending: 'Kérelem küldése…', success: 'A kérelmet elküldtük a főadminisztrátornak. Az ellenőrzés után felvesszük veled a kapcsolatot.', failed: 'A kérelmet nem sikerült elküldeni. A kitöltött adatok megmaradtak. Próbáld újra.', photoFailed: 'A fényképet nem sikerült feltölteni. A kitöltött adatok megmaradtak. Próbáld újra.', invalidPhoto: 'Válassz legfeljebb 5 MB méretű JPG, PNG, WebP, AVIF vagy GIF képet.', invalidMaps: 'Adj meg egy érvényes HTTPS Google Maps hivatkozást.', invalidPhone: 'Adj meg egy érvényes, 7–15 számjegyből álló telefonszámot.', invalidCourt: 'Add meg minden pálya nevét és sportágát. A pályanevek legyenek különbözők.', invalidForm: 'Ellenőrizd és töltsd ki a kötelező mezőket.', rate: 'Elérted a napi 5 kérelem korlátját. Próbáld újra holnap.', session: 'A munkamenet megváltozott. Küldés előtt jelentkezz be újra.', uncertain: 'Nem érkezett visszaigazolás. Nyomd meg a „Küldés ellenőrzése” gombot ugyanannak a kérelemnek az ellenőrzéséhez, másolat létrehozása nélkül.', retry: 'Küldés ellenőrzése', photoUncertain: 'A fénykép feltöltése nem lett visszaigazolva. Ugyanennek a kérelemnek a folytatásához próbáld újra.', retryUpload: 'Küldés újrapróbálása', busy: 'A küldés folyamatban van. Várd meg a visszaigazolást.'
        },
        en: {
            eyebrow: 'For clubs and sports centres', title: 'Register your sports centre', intro: 'Have one court or several? Send us the details and help more players find their next game.', open: 'Register your sports centre',
            privacy: 'Only the superadmin can view your request and photo. Submitting does not automatically publish your sports centre.', details: 'Sports centre details', name: 'Sports centre / club name *', contact: 'Contact person *', email: 'Contact email *', phone: 'Phone number *', city: 'City *', address: 'Address', maps: 'Google Maps link *', mapsHint: 'Copy the location link from Google Maps.', courts: 'Your courts', courtsHint: 'Add each court and its sport. Up to 20 courts.', court: 'Court {n}', courtName: 'Court name *', sport: 'Sport *', addCourt: '+ Add a court', removeCourt: 'Remove', description: 'Additional details', photo: 'Photo (optional)', photoHint: 'JPG, PNG, WebP, AVIF or GIF, up to 5 MB. Do not include documents or personal information in the photo.', removePhoto: 'Remove photo', consent: 'I agree to be contacted about this request.', submit: 'Send request', login: 'Sign in to send', close: 'Close',
            loginHint: 'Sign in to send your request. Your details will stay filled in; sending requires pressing the button again.', ready: 'You are signed in. Review your details and send the request when ready.', uploading: 'Uploading your photo securely…', sending: 'Sending your request…', success: 'Your request was sent to the superadmin. We will contact you after reviewing it.', failed: 'Your request could not be sent. Your details are still filled in. Please try again.', photoFailed: 'Your photo could not be uploaded. Your details are still filled in. Please try again.', invalidPhoto: 'Choose a JPG, PNG, WebP, AVIF or GIF photo up to 5 MB.', invalidMaps: 'Enter a valid HTTPS Google Maps link.', invalidPhone: 'Enter a valid phone number with 7–15 digits.', invalidCourt: 'Enter a name and sport for each court. Court names must be different.', invalidForm: 'Check and complete the required fields.', rate: 'You have reached the limit of 5 requests per day. Please try again tomorrow.', session: 'Your session changed. Sign in again before sending.', uncertain: 'We did not receive confirmation. Press “Check submission” to check the same request without sending a duplicate.', retry: 'Check submission', photoUncertain: 'The photo upload was not confirmed. Press “Retry submission” to continue the same request.', retryUpload: 'Retry submission', busy: 'Your request is being sent. Please wait for confirmation.'
        }
    };
    for (const [language, entries] of Object.entries(copy)) {
        if (window.dict?.[language]) for (const [key, value] of Object.entries(entries)) window.dict[language][`club_registration_${key}`] = value;
    }
    const t = key => window.dict?.[window.lang]?.[`club_registration_${key}`] || (copy[window.lang] || copy.ro)[key] || key;
    const sports = ['Fotbal', 'Baschet', 'Tenis', 'Volei', 'Tenis Picior'];
    const mimeExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
    const validMaps = value => {
        const text = String(value || '').trim();
        return text.length <= 2048 && !/[\x00-\x1f\x7f]/.test(text) &&
            /^https:\/\/(?:(?:www\.)?google\.(?:com|ro)\/maps(?:[/?#][^\s]*)?|maps\.google\.(?:com|ro)\/[^\s]*|maps\.app\.goo\.gl\/[A-Za-z0-9_-]+(?:\?[^\s]*)?|goo\.gl\/maps\/[A-Za-z0-9_-]+(?:\?[^\s]*)?)$/.test(text);
    };
    const uuid = () => crypto.randomUUID();

    function init() {
        const modal = document.getElementById('modal-club-registration');
        const form = document.getElementById('club-registration-form');
        const openButton = document.getElementById('btn-club-registration');
        if (!modal || !form || !openButton) return;
        const fields = document.getElementById('club-request-fields');
        const courts = document.getElementById('club-request-courts');
        const addButton = document.getElementById('club-request-add-court');
        const submitButton = document.getElementById('club-request-submit');
        const loginButton = document.getElementById('club-request-login');
        const status = document.getElementById('club-request-status');
        const photo = document.getElementById('club-request-photo');
        const preview = document.getElementById('club-request-photo-preview');
        const previewImage = document.getElementById('club-request-photo-image');
        const input = key => document.getElementById(`club-request-${key}`);
        const user = () => window.getSpotivityProfileUser?.() || null;
        let ownerId = user()?.id || null;
        let generation = 0, busy = false, attempt = null, previousFocus = null, previewUrl = '', statusKey = '', statusKind = '', waitingLogin = false;
        let controller = null;
        const isOpen = () => modal.style.display === 'flex';
        const assertCurrent = captured => {
            if (captured.generation !== generation || user()?.id !== captured.userId) throw Object.assign(new Error('Session changed'), { sessionChanged: true });
            if (captured.controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
        };

        function showStatus(key = '', kind = '') {
            statusKey = key;
            statusKind = kind;
            status.textContent = key ? t(key) : '';
            status.dataset.kind = kind;
        }
        function render() {
            document.querySelectorAll('[data-club-i18n]').forEach(element => { element.textContent = t(element.dataset.clubI18n); });
            document.getElementById('close-club-registration').setAttribute('aria-label', t('close'));
            [...courts.children].forEach((row, index) => {
                row.querySelector('[data-club-court-title]').textContent = t('court').replace('{n}', index + 1);
                row.querySelector('[data-club-court-remove]').hidden = courts.children.length <= 1;
                for (const option of row.querySelectorAll('option')) option.textContent = window.dict?.[window.lang]?.[option.value.toLowerCase()] || option.value;
            });
            fields.disabled = busy || Boolean(attempt?.uncertain);
            addButton.disabled = courts.children.length >= 20;
            submitButton.disabled = busy;
            submitButton.textContent = t(busy ? (attempt?.stage === 'upload' ? 'uploading' : 'sending') : attempt?.uncertain ? (attempt.stage === 'upload' ? 'retryUpload' : 'retry') : 'submit');
            form.setAttribute('aria-busy', String(busy));
            status.textContent = statusKey ? t(statusKey) : '';
            status.dataset.kind = statusKind;
        }
        function addCourt() {
            if (courts.children.length >= 20 || busy || attempt?.uncertain) return;
            const row = document.createElement('div');
            row.className = 'club-request-court';
            row.dataset.clubCourt = '';
            const heading = document.createElement('div');
            heading.className = 'club-request-court-heading';
            const title = document.createElement('strong');
            title.dataset.clubCourtTitle = '';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'club-registration-secondary club-request-court-remove';
            remove.dataset.clubCourtRemove = '';
            remove.dataset.clubI18n = 'removeCourt';
            remove.addEventListener('click', () => { if (courts.children.length > 1 && !busy && !attempt?.uncertain) { row.remove(); render(); } });
            heading.append(title, remove);
            const grid = document.createElement('div');
            grid.className = 'club-request-grid';
            const nameLabel = document.createElement('label');
            const nameText = document.createElement('span');
            nameText.dataset.clubI18n = 'courtName';
            const name = document.createElement('input');
            name.type = 'text'; name.required = true; name.minLength = 2; name.maxLength = 120; name.autocomplete = 'off'; name.dataset.clubCourtName = '';
            nameLabel.append(nameText, name);
            const sportLabel = document.createElement('label');
            const sportText = document.createElement('span'); sportText.dataset.clubI18n = 'sport';
            const select = document.createElement('select'); select.required = true; select.dataset.clubCourtSport = '';
            for (const sport of sports) { const option = document.createElement('option'); option.value = sport; select.append(option); }
            sportLabel.append(sportText, select); grid.append(nameLabel, sportLabel); row.append(heading, grid); courts.append(row); render();
        }
        function clearPhoto() {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = ''; photo.value = ''; previewImage.removeAttribute('src'); preview.hidden = true;
        }
        function resetDraft() {
            form.reset(); clearPhoto(); courts.replaceChildren(); attempt = null; busy = false; addCourt(); showStatus(); render();
        }
        function prefill() {
            const profile = user();
            if (!profile || busy || attempt) return;
            for (const [key, value] of [['contact', profile.nume], ['email', profile.email], ['phone', profile.telefon === '-' ? '' : profile.telefon]]) {
                if (!input(key).value.trim() && value) input(key).value = value;
            }
        }
        function open() {
            previousFocus = document.activeElement;
            prefill(); render(); modal.style.display = 'flex';
            modal.querySelector('.club-registration-panel').focus({ preventScroll: true });
        }
        function close() {
            if (busy) { showStatus('busy'); return; }
            modal.style.display = 'none';
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        }
        function clearIdentity() {
            generation++; controller?.abort(); controller = null; waitingLogin = false; ownerId = null;
            resetDraft(); modal.style.display = 'none';
        }
        function onProfile() {
            const next = user()?.id || null;
            if (ownerId && ownerId !== next) clearIdentity();
            ownerId = next;
            if (next && waitingLogin) {
                waitingLogin = false;
                prefill(); loginButton.hidden = true; showStatus('ready');
                document.getElementById('modal-auth').style.display = 'none'; open();
            } else prefill();
        }
        async function validPhoto(file) {
            if (!file || !mimeExtensions[file.type] || file.size <= 0 || file.size > 5 * 1024 * 1024) return false;
            let data;
            try { data = new Uint8Array(await file.slice(0, 32).arrayBuffer()); } catch { return false; }
            const text = String.fromCharCode(...data);
            let signature = false;
            if (file.type === 'image/jpeg') signature = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
            else if (file.type === 'image/png') signature = [137,80,78,71,13,10,26,10].every((value, index) => data[index] === value);
            else if (file.type === 'image/gif') signature = /^GIF8[79]a/.test(text);
            else if (file.type === 'image/webp') signature = text.startsWith('RIFF') && text.slice(8,12) === 'WEBP';
            else signature = text.slice(4,8) === 'ftyp' && /avif|avis/.test(text.slice(8));
            if (!signature) return false;
            // A file extension or header alone does not make a usable photograph.
            try {
                if (typeof createImageBitmap === 'function') {
                    const bitmap = await createImageBitmap(file);
                    const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 40000000;
                    bitmap.close();
                    return valid;
                }
                const objectUrl = URL.createObjectURL(file);
                try {
                    const image = new Image(); image.src = objectUrl;
                    await image.decode();
                    return image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth * image.naturalHeight <= 40000000;
                } finally { URL.revokeObjectURL(objectUrl); }
            } catch { return false; }
        }
        function draft() {
            for (const element of form.querySelectorAll('input,textarea')) if (!['file','checkbox'].includes(element.type)) element.value = element.value.trim();
            input('maps').setCustomValidity(validMaps(input('maps').value) ? '' : t('invalidMaps'));
            const digits = input('phone').value.replace(/\D/g, '');
            input('phone').setCustomValidity(/^[+\d() .-]+$/.test(input('phone').value) && digits.length >= 7 && digits.length <= 15 ? '' : t('invalidPhone'));
            for (const name of courts.querySelectorAll('[data-club-court-name]')) name.setCustomValidity('');
            const rows = [...courts.children].map(row => ({ nume: row.querySelector('[data-club-court-name]').value.trim(), sport: row.querySelector('[data-club-court-sport]').value }));
            const names = new Set();
            [...courts.children].forEach((row, index) => {
                const normalized = rows[index].nume.toLocaleLowerCase();
                if (names.has(normalized)) row.querySelector('[data-club-court-name]').setCustomValidity(t('invalidCourt'));
                names.add(normalized);
            });
            if (!form.checkValidity()) { showStatus('invalidForm', 'error'); form.reportValidity(); return null; }
            return { p_nume_baza: input('name').value, p_nume_contact: input('contact').value, p_email: input('email').value, p_telefon: input('phone').value, p_oras: input('city').value, p_adresa: input('address').value, p_link_maps: input('maps').value, p_terenuri: rows, p_descriere: input('description').value };
        }
        function definite(error) {
            return /^[0-9A-Z]{5}$/.test(error?.code || '') || /^PGRST\d+$/.test(error?.code || '');
        }
        function errorKey(error) {
            return /(?:club_request_rate_limit|request_limit|rate.limit|(?:5|five).*(?:day|zi|24 hours)|daily.limit)/i.test(error?.message || '') || error?.code === '429' ? 'rate' : 'failed';
        }
        async function bindClient(captured) {
            const { data, error } = await db.auth.getSession();
            assertCurrent(captured);
            const session = data?.session;
            if (error) throw new Error('Session verification is temporarily unavailable');
            if (session?.user?.id !== captured.userId || !session.access_token) throw Object.assign(new Error('Session changed'), { sessionChanged: true });
            const identity = await db.auth.getUser(session.access_token);
            assertCurrent(captured);
            if (identity.error) throw new Error('Session verification is temporarily unavailable');
            if (identity.data?.user?.id !== captured.userId) throw Object.assign(new Error('Session changed'), { sessionChanged: true });
            // Every write uses this verified token, even if another tab changes the shared client.
            const nativeFetch = window.fetch.bind(window);
            return createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
                global: { headers: { Authorization: `Bearer ${session.access_token}` }, fetch: (url, options = {}) => nativeFetch(url, { ...options, signal: captured.controller.signal }) }
            });
        }
        async function submit(event) {
            event.preventDefault();
            if (busy) return;
            const payload = attempt?.uncertain ? attempt.payload : draft();
            if (!payload) return;
            if (!user()?.id) { showStatus('loginHint'); loginButton.hidden = false; loginButton.focus(); return; }
            const preflightGeneration = generation, preflightUserId = user().id;
            const chosenPhoto = attempt?.uncertain ? attempt.file : photo.files[0] || null;
            // Lock before reading the file, so repeated submit events cannot race that await.
            busy = true; render();
            const fileValid = !chosenPhoto || await validPhoto(chosenPhoto);
            if (preflightGeneration !== generation || user()?.id !== preflightUserId) return;
            if (!fileValid) { busy = false; render(); showStatus('invalidPhoto', 'error'); photo.focus(); return; }
            const captured = { generation, userId: preflightUserId, controller: new AbortController() };
            ownerId = captured.userId; controller = captured.controller; busy = true;
            if (!attempt) attempt = { id: uuid(), payload, file: chosenPhoto, path: '', uploaded: false, stage: chosenPhoto ? 'upload' : 'rpc', uncertain: false };
            const active = attempt;
            active.uncertain = false;
            loginButton.hidden = true;
            render(); showStatus(active.stage === 'upload' ? 'uploading' : 'sending');
            const timeout = setTimeout(() => captured.controller.abort(), 30000);
            let client;
            try {
                client = await bindClient(captured);
                assertCurrent(captured);
                if (active.file && !active.uploaded) {
                    active.stage = 'upload';
                    if (!active.path) active.path = `${captured.userId}/${active.id}/${uuid()}.${mimeExtensions[active.file.type]}`;
                    showStatus('uploading'); render();
                    const result = await client.storage.from('cereri_baze_sportive').upload(active.path, active.file, { contentType: active.file.type, upsert: false, cacheControl: '0' });
                    assertCurrent(captured);
                    const duplicate = String(result.error?.statusCode) === '409' || result.error?.code === 'Duplicate';
                    if (result.error && !duplicate) throw Object.assign(result.error, { uploadFailed: true });
                    active.uploaded = true;
                }
                active.stage = 'rpc'; showStatus('sending'); render();
                const result = await client.rpc('submit_club_request', { p_request_id: active.id, ...active.payload, p_poza_path: active.path || null });
                assertCurrent(captured);
                if (result.error) throw result.error;
                if (result.data !== active.id) throw new Error('Submission acknowledgement was incomplete');
                resetDraft(); loginButton.hidden = true; showStatus('success', 'success');
            } catch (error) {
                if (captured.generation !== generation || user()?.id !== captured.userId) return;
                if (error.sessionChanged) { active.uncertain = true; showStatus('session', 'error'); loginButton.hidden = false; }
                else if (definite(error) || error.uploadFailed && /^4\d\d$/.test(String(error.statusCode || '')) && String(error.statusCode) !== '408') {
                    // A rejected RPC did not attach this photo; never delete on an uncertain response.
                    if (active.uploaded && active.path && client && !captured.controller.signal.aborted) {
                        try { await client.storage.from('cereri_baze_sportive').remove([active.path]); } catch { /* Unattached objects stay private. */ }
                    }
                    attempt = null; showStatus(error.uploadFailed ? 'photoFailed' : errorKey(error), 'error');
                } else {
                    active.uncertain = true;
                    showStatus(active.stage === 'upload' ? 'photoUncertain' : 'uncertain', 'error');
                }
            } finally {
                clearTimeout(timeout);
                if (captured.generation === generation && user()?.id === captured.userId) { busy = false; controller = null; render(); }
            }
        }
        openButton.addEventListener('click', open);
        document.getElementById('close-club-registration').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); close(); }, true);
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key !== 'Tab') return;
            const available = [...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(element => !element.disabled && !element.closest('[disabled]') && element.getClientRects().length);
            const first = available[0], last = available.at(-1);
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || !available.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !available.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
        });
        addButton.addEventListener('click', () => { addCourt(); courts.lastElementChild?.querySelector('input')?.focus(); });
        document.getElementById('club-request-remove-photo').addEventListener('click', () => { if (!busy && !attempt?.uncertain) clearPhoto(); });
        photo.addEventListener('change', async () => {
            const file = photo.files[0];
            const capturedGeneration = generation;
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = ''; preview.hidden = true; previewImage.removeAttribute('src');
            if (!file) return;
            const valid = await validPhoto(file);
            if (capturedGeneration !== generation || photo.files[0] !== file) return;
            if (!valid) { clearPhoto(); showStatus('invalidPhoto', 'error'); return; }
            previewUrl = URL.createObjectURL(file); previewImage.src = previewUrl; preview.hidden = false;
        });
        form.addEventListener('input', event => { if (event.target.setCustomValidity) event.target.setCustomValidity(''); });
        form.addEventListener('submit', submit);
        loginButton.addEventListener('click', () => {
            if (busy) return;
            waitingLogin = true; modal.style.display = 'none';
            const auth = document.getElementById('modal-auth');
            auth.style.display = 'flex'; auth.querySelector('input')?.focus();
        });
        window.addEventListener('spotivity:profile-user', onProfile);
        db.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || (ownerId && session?.user?.id && session.user.id !== ownerId)) clearIdentity();
        });
        window.addEventListener('spotivity:language', render);
        addCourt(); prefill(); render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
