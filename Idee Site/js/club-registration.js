/* Public submissions use the server endpoint. Only approved applicants receive scoped admin access. */
(() => {
    'use strict';
    const copy = {
        ro: {
            eyebrow: 'Pentru cluburi și baze sportive', title: 'Înscrie-ți baza sportivă', intro: 'Ai unul sau mai multe terenuri? Trimite-ne detaliile și hai să le aducem mai aproape de jucători.', open: 'Înscrie baza sportivă',
            privacy: 'Cererea și datele de contact sunt vizibile doar superadminului. Baza, terenurile și fotografia vor fi publicate doar după acceptare.', details: 'Datele bazei sportive', name: 'Numele bazei / clubului *', contact: 'Persoană de contact *', email: 'Email de contact *', phone: 'Număr de telefon *', city: 'Oraș *', address: 'Adresă', maps: 'Link Google Maps *', mapsHint: 'Copiază linkul locației din Google Maps.', courts: 'Terenurile tale', courtsHint: 'Adaugă fiecare teren și sportul său. Maximum 20.', court: 'Terenul {n}', courtName: 'Numele terenului *', sport: 'Sport *', price: 'Tarif pe oră (RON) *', addCourt: '+ Adaugă un teren', removeCourt: 'Elimină', description: 'Alte detalii', photo: 'Fotografie (opțional)', photoHint: 'JPG, PNG, WebP, AVIF sau GIF, maximum 5 MB. Nu include documente sau date personale în fotografie.', removePhoto: 'Elimină fotografia', consent: 'Sunt de acord să fiu contactat în legătură cu această cerere.', submit: 'Trimite cererea', close: 'Închide', account: 'Accesul la administrarea bazei', accountHint: 'Alege o parolă pentru emailul de contact. Vei putea administra baza cu acest email și această parolă doar după acceptarea cererii.', existingAccount: 'Pentru un email deja înregistrat, folosește parola acelui cont.', password: 'Parolă *', confirmPassword: 'Confirmă parola *', passwordHint: 'Folosește cel puțin 6 caractere.', invalidPassword: 'Parola trebuie să aibă minimum 6 caractere.', invalidPasswordLong: 'Parola este prea lungă. Alege una mai scurtă.', passwordMismatch: 'Parolele nu coincid.', credentials: 'Verifică emailul și parola. Pentru un email deja înregistrat, folosește parola acelui cont.', invalidPrice: 'Introdu pentru fiecare teren un tarif întreg între 0 și 100.000 RON pe oră.', retryPassword: 'Pentru a verifica aceeași cerere, introdu din nou parola folosită la trimitere.', confirmation: 'Confirmă adresa de email înainte de a retrimite cererea.', successConfirm: 'Cererea a fost trimisă și așteaptă verificarea. Confirmă adresa de email pentru ca baza să poată fi aprobată. Accesul la administrare se activează doar după acceptare.',
            sending: 'Se trimite cererea…', success: 'Cererea a fost trimisă superadminului și este în așteptare. Vei putea intra în administrarea bazei cu emailul și parola alese doar după aprobare.', failed: 'Cererea nu a putut fi trimisă. Detaliile au rămas completate. Încearcă din nou.', invalidPhoto: 'Alege o fotografie JPG, PNG, WebP, AVIF sau GIF de maximum 5 MB.', invalidMaps: 'Introdu un link HTTPS valid de la Google Maps.', invalidPhone: 'Introdu un număr de telefon valid, cu 7–15 cifre.', invalidCourt: 'Completează numele și sportul fiecărui teren. Numele terenurilor trebuie să fie diferite.', invalidForm: 'Verifică și completează câmpurile obligatorii.', rate: 'Ai atins limita de 5 cereri pe zi. Poți încerca din nou mâine.', uncertain: 'Nu am primit confirmarea trimiterii. Apasă „Verifică trimiterea” pentru a verifica aceeași cerere, fără să o dublezi.', retry: 'Verifică trimiterea', busy: 'Trimiterea este în curs. Așteaptă confirmarea.'
        },
        hu: {
            eyebrow: 'Kluboknak és sportközpontoknak', title: 'Regisztráld sportközpontodat', intro: 'Egy vagy több sportpályád van? Küldd el az adataikat, és segítsünk a játékosoknak megtalálni őket.', open: 'Sportközpont regisztrálása',
            privacy: 'A kérelmet és az elérhetőségeket csak a főadminisztrátor láthatja. A sportközpont, a pályák és a fénykép csak jóváhagyás után jelennek meg nyilvánosan.', details: 'A sportközpont adatai', name: 'A sportközpont / klub neve *', contact: 'Kapcsolattartó neve *', email: 'Kapcsolattartási email *', phone: 'Telefonszám *', city: 'Város *', address: 'Cím', maps: 'Google Maps hivatkozás *', mapsHint: 'Másold ide a hely Google Maps hivatkozását.', courts: 'Sportpályáid', courtsHint: 'Add hozzá a pályákat és sportágukat. Legfeljebb 20 pálya.', court: '{n}. pálya', courtName: 'A pálya neve *', sport: 'Sportág *', price: 'Óradíj (RON) *', addCourt: '+ Pálya hozzáadása', removeCourt: 'Törlés', description: 'További információk', photo: 'Fénykép (nem kötelező)', photoHint: 'JPG, PNG, WebP, AVIF vagy GIF, legfeljebb 5 MB. Ne szerepeljenek dokumentumok vagy személyes adatok a képen.', removePhoto: 'Fénykép eltávolítása', consent: 'Hozzájárulok, hogy megkeressenek ezzel a kérelemmel kapcsolatban.', submit: 'Kérelem elküldése', close: 'Bezárás', account: 'Hozzáférés a sportközpont kezeléséhez', accountHint: 'Válassz jelszót a kapcsolattartási emailhez. Csak a kérelem jóváhagyása után kezelheted a sportközpontot ezzel az emaillel és jelszóval.', existingAccount: 'Ha az email már regisztrálva van, használd a meglévő fiók jelszavát.', password: 'Jelszó *', confirmPassword: 'Jelszó megerősítése *', passwordHint: 'Használj legalább 6 karaktert.', invalidPassword: 'A jelszó legalább 6 karakter legyen.', invalidPasswordLong: 'A jelszó túl hosszú. Válassz rövidebbet.', passwordMismatch: 'A jelszavak nem egyeznek.', credentials: 'Ellenőrizd az emailt és a jelszót. Regisztrált emailnél a meglévő fiók jelszavát használd.', invalidPrice: 'Minden pályához 0 és 100 000 RON közötti egész óradíjat adj meg.', retryPassword: 'Ugyanennek a kérelemnek az ellenőrzéséhez add meg újra a küldéskor használt jelszót.', confirmation: 'Erősítsd meg az emailcímed, mielőtt újra elküldöd a kérelmet.', successConfirm: 'A kérelmet elküldtük, és ellenőrzésre vár. Erősítsd meg az emailcímed a sportközpont jóváhagyásához. A kezelőfelület csak jóváhagyás után érhető el.',
            sending: 'Kérelem küldése…', success: 'A kérelmet elküldtük a főadminisztrátornak, és jóváhagyásra vár. Csak jóváhagyás után léphetsz be a sportközpont kezeléséhez a választott emaillel és jelszóval.', failed: 'A kérelmet nem sikerült elküldeni. A kitöltött adatok megmaradtak. Próbáld újra.', invalidPhoto: 'Válassz legfeljebb 5 MB méretű JPG, PNG, WebP, AVIF vagy GIF képet.', invalidMaps: 'Adj meg egy érvényes HTTPS Google Maps hivatkozást.', invalidPhone: 'Adj meg egy érvényes, 7–15 számjegyből álló telefonszámot.', invalidCourt: 'Add meg minden pálya nevét és sportágát. A pályanevek legyenek különbözők.', invalidForm: 'Ellenőrizd és töltsd ki a kötelező mezőket.', rate: 'Elérted a napi 5 kérelem korlátját. Próbáld újra holnap.', uncertain: 'Nem érkezett visszaigazolás. Nyomd meg a „Küldés ellenőrzése” gombot ugyanannak a kérelemnek az ellenőrzéséhez, másolat létrehozása nélkül.', retry: 'Küldés ellenőrzése', busy: 'A küldés folyamatban van. Várd meg a visszaigazolást.'
        },
        en: {
            eyebrow: 'For clubs and sports centres', title: 'Register your sports centre', intro: 'Have one court or several? Send us the details and help more players find their next game.', open: 'Register your sports centre',
            privacy: 'Only the superadmin can view your request and contact details. Your sports centre, courts and photo will be published only after approval.', details: 'Sports centre details', name: 'Sports centre / club name *', contact: 'Contact person *', email: 'Contact email *', phone: 'Phone number *', city: 'City *', address: 'Address', maps: 'Google Maps link *', mapsHint: 'Copy the location link from Google Maps.', courts: 'Your courts', courtsHint: 'Add each court and its sport. Up to 20 courts.', court: 'Court {n}', courtName: 'Court name *', sport: 'Sport *', price: 'Hourly price (RON) *', addCourt: '+ Add a court', removeCourt: 'Remove', description: 'Additional details', photo: 'Photo (optional)', photoHint: 'JPG, PNG, WebP, AVIF or GIF, up to 5 MB. Do not include documents or personal information in the photo.', removePhoto: 'Remove photo', consent: 'I agree to be contacted about this request.', submit: 'Send request', close: 'Close', account: 'Access to manage your sports centre', accountHint: 'Choose a password for the contact email. You can manage the sports centre with this email and password only after your request is approved.', existingAccount: 'For an email that is already registered, use that account’s password.', password: 'Password *', confirmPassword: 'Confirm password *', passwordHint: 'Use at least 6 characters.', invalidPassword: 'Your password must contain at least 6 characters.', invalidPasswordLong: 'Your password is too long. Choose a shorter one.', passwordMismatch: 'The passwords do not match.', credentials: 'Check your email and password. For an email that is already registered, use that account’s password.', invalidPrice: 'Enter a whole hourly price between 0 and 100,000 RON for each court.', retryPassword: 'To check the same request, enter the password you used when sending it again.', confirmation: 'Confirm your email address before submitting the request again.', successConfirm: 'Your request has been sent and is awaiting review. Confirm your email address so the sports centre can be approved. Management access is activated only after approval.',
            sending: 'Sending your request…', success: 'Your request was sent to the superadmin and is awaiting approval. You can sign in to manage your sports centre with your chosen email and password only after approval.', failed: 'Your request could not be sent. Your details are still filled in. Please try again.', invalidPhoto: 'Choose a JPG, PNG, WebP, AVIF or GIF photo up to 5 MB.', invalidMaps: 'Enter a valid HTTPS Google Maps link.', invalidPhone: 'Enter a valid phone number with 7–15 digits.', invalidCourt: 'Enter a name and sport for each court. Court names must be different.', invalidForm: 'Check and complete the required fields.', rate: 'You have reached the limit of 5 requests per day. Please try again tomorrow.', uncertain: 'We did not receive confirmation. Press “Check submission” to check the same request without sending a duplicate.', retry: 'Check submission', busy: 'Your request is being sent. Please wait for confirmation.'
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
        const accountFields = document.getElementById('club-request-account-fields');
        const status = document.getElementById('club-request-status');
        const photo = document.getElementById('club-request-photo');
        const preview = document.getElementById('club-request-photo-preview');
        const previewImage = document.getElementById('club-request-photo-image');
        const input = key => document.getElementById(`club-request-${key}`);
        const user = () => window.getSpotivityProfileUser?.() || null;
        let ownerId = user()?.id || null;
        let generation = 0, busy = false, attempt = null, previousFocus = null, previewUrl = '', statusKey = '', statusKind = '';
        let controller = null;
        const assertCurrent = captured => {
            if (captured.generation !== generation) throw new DOMException('Request cancelled', 'AbortError');
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
            accountFields.disabled = busy || Boolean(attempt?.uncertain && attempt.payload.password);
            addButton.disabled = courts.children.length >= 20;
            submitButton.disabled = busy;
            submitButton.textContent = t(busy ? 'sending' : attempt?.uncertain ? 'retry' : 'submit');
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
            sportLabel.append(sportText, select);
            const priceLabel = document.createElement('label');
            priceLabel.className = 'club-request-wide';
            const priceText = document.createElement('span'); priceText.dataset.clubI18n = 'price';
            const price = document.createElement('input');
            price.type = 'number'; price.required = true; price.min = '0'; price.max = '100000'; price.step = '1'; price.inputMode = 'numeric'; price.dataset.clubCourtPrice = '';
            priceLabel.append(priceText, price);
            grid.append(nameLabel, sportLabel, priceLabel); row.append(heading, grid); courts.append(row); render();
        }
        function clearPhoto() {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = ''; photo.value = ''; previewImage.removeAttribute('src'); preview.hidden = true;
        }
        function clearPasswords() {
            input('password').value = ''; input('password-confirm').value = '';
            input('password').setCustomValidity(''); input('password-confirm').setCustomValidity('');
            if (attempt) delete attempt.payload.password;
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
            clearPasswords();
            if (attempt?.uncertain) showStatus('retryPassword');
            render(); modal.style.display = 'none';
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        }
        function clearIdentity() {
            generation++; controller?.abort(); controller = null; ownerId = null;
            clearPasswords();
            resetDraft(); modal.style.display = 'none';
        }
        function onProfile() {
            const next = user()?.id || null;
            if (ownerId && ownerId !== next) clearIdentity();
            ownerId = next;
            prefill();
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
            for (const element of form.querySelectorAll('input,textarea')) if (!['file','checkbox','password'].includes(element.type)) element.value = element.value.trim();
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
            const prices = [...courts.querySelectorAll('[data-club-court-price]')].map(price => {
                const valid = /^\d+$/.test(price.value) && Number.isSafeInteger(Number(price.value)) && Number(price.value) >= 0 && Number(price.value) <= 100000;
                price.setCustomValidity(valid ? '' : t('invalidPrice'));
                return Number(price.value);
            });
            const password = readPassword();
            if (password === null) return null;
            if (!form.checkValidity()) { showStatus('invalidForm', 'error'); form.reportValidity(); return null; }
            return { nume_baza: input('name').value, nume_contact: input('contact').value, email: input('email').value, telefon: input('phone').value, oras: input('city').value, adresa: input('address').value, link_maps: input('maps').value, terenuri: rows, prices, descriere: input('description').value, password };
        }
        function readPassword() {
            const password = input('password').value;
            const passwordError = [...password].length < 6 || /[\x00\r\n]/.test(password) ? 'invalidPassword' : new TextEncoder().encode(password).length > 72 ? 'invalidPasswordLong' : '';
            input('password').setCustomValidity(passwordError ? t(passwordError) : '');
            input('password-confirm').setCustomValidity(input('password-confirm').value === password ? '' : t('passwordMismatch'));
            if (!input('password').checkValidity() || !input('password-confirm').checkValidity()) {
                showStatus(passwordError || 'passwordMismatch', 'error');
                form.reportValidity(); return null;
            }
            return password;
        }
        function errorKey(error) {
            const code = String(error?.code || '');
            if (code === 'email_confirmation_required') return 'confirmation';
            if (error?.status === 429 || /rate.limit|request_limit/i.test(code)) return 'rate';
            if (/credential|invalid.password|invalid.login|invalid_login|authentication|account_password/i.test(code)) return 'credentials';
            if (/photo|image/i.test(code)) return 'invalidPhoto';
            if (/price/i.test(code)) return 'invalidPrice';
            return 'failed';
        }
        async function submit(event) {
            event.preventDefault();
            if (busy) return;
            const retryingPriorUnknown = Boolean(attempt?.uncertain);
            let payload;
            if (retryingPriorUnknown) {
                payload = attempt.payload;
                if (!payload.password) {
                    const password = readPassword();
                    if (password === null) return;
                    payload.password = password;
                }
            } else payload = draft();
            if (!payload) return;
            const preflightGeneration = generation;
            const chosenPhoto = attempt?.uncertain ? attempt.file : photo.files[0] || null;
            // Lock before reading the file, so repeated submit events cannot race that await.
            busy = true; render();
            const fileValid = !chosenPhoto || await validPhoto(chosenPhoto);
            if (preflightGeneration !== generation) return;
            if (!fileValid) { busy = false; render(); showStatus('invalidPhoto', 'error'); photo.focus(); return; }
            const captured = { generation, controller: new AbortController() };
            controller = captured.controller;
            if (!attempt) attempt = { id: uuid(), payload, file: chosenPhoto, uncertain: false };
            const active = attempt;
            active.uncertain = false;
            render(); showStatus('sending');
            const timeout = setTimeout(() => captured.controller.abort(), 45000);
            try {
                const body = new FormData();
                body.set('payload', JSON.stringify({ action: 'submit', request_id: active.id, ...active.payload }));
                if (active.file) body.set('photo', active.file);
                const response = await fetch(`${supabaseUrl}/functions/v1/club-applications`, {
                    method: 'POST', headers: { apikey: supabaseKey }, body, signal: captured.controller.signal
                });
                assertCurrent(captured);
                let result;
                try { result = await response.json(); } catch { throw new Error('Submission acknowledgement was incomplete'); }
                assertCurrent(captured);
                if (!response.ok) {
                    const error = new Error('Submission rejected');
                    error.code = typeof result?.code === 'string' ? result.code : '';
                    error.status = response.status;
                    error.definite = response.status >= 400 && response.status < 500 && ![408, 425].includes(response.status) && !/in.progress|processing/i.test(error.code);
                    throw error;
                }
                if (result?.request_id !== active.id || result?.status !== 'noua') throw new Error('Submission acknowledgement was incomplete');
                clearPasswords(); resetDraft(); showStatus(result.email_confirmation_required === true ? 'successConfirm' : 'success', 'success');
            } catch (error) {
                if (captured.generation !== generation) return;
                if (error.definite) {
                    const key = errorKey(error);
                    if (retryingPriorUnknown) {
                        // A failed retry cannot disprove that the first request committed.
                        // Keep its UUID and snapshot even when credentials must be reentered.
                        active.uncertain = true;
                        if (key === 'credentials' || key === 'confirmation') clearPasswords();
                    } else attempt = null;
                    showStatus(key, 'error');
                } else {
                    // Retain the UUID, snapshot, password and file only in memory until confirmed.
                    // A retry checks the same request even if its first response was lost.
                    active.uncertain = true; showStatus('uncertain', 'error');
                }
            } finally {
                clearTimeout(timeout);
                if (captured.generation === generation) { busy = false; controller = null; render(); }
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
            if (statusKey === 'invalidPhoto') showStatus();
        });
        form.addEventListener('input', event => { if (event.target.setCustomValidity) event.target.setCustomValidity(''); });
        form.addEventListener('submit', submit);
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
