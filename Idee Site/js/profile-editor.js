(() => {
    'use strict';

    const copy = {
        ro: {
            profil_edit_button: 'Editează profilul',
            profil_edit_title: 'Editează profilul',
            profil_edit_intro: 'Actualizează datele, apoi verifică și confirmă modificările.',
            profil_edit_name: 'Nume',
            profil_edit_phone: 'Număr de telefon',
            profil_edit_email: 'Adresă de email',
            profil_edit_email_note: 'Schimbarea emailului trebuie confirmată din mesajele primite la adresa actuală și la adresa nouă. Până atunci, folosește adresa actuală pentru autentificare.',
            profil_edit_continue: 'Verifică modificările',
            profil_edit_confirm: 'Confirmă și salvează',
            profil_edit_back: 'Înapoi la editare',
            profil_edit_cancel: 'Anulează',
            profil_edit_close: 'Închide',
            profil_edit_done: 'Înapoi la profil',
            profil_edit_review: 'Confirmi aceste modificări?',
            profil_edit_loading: 'Se verifică profilul…',
            profil_edit_saving: 'Se salvează modificările…',
            profil_edit_name_invalid: 'Numele trebuie să aibă între 2 și 200 de caractere.',
            profil_edit_phone_invalid: 'Introdu un telefon cu 7–15 cifre. Poți folosi +, spații, puncte, paranteze și cratime.',
            profil_edit_email_invalid: 'Introdu o adresă de email validă.',
            profil_edit_no_changes: 'Nu ai făcut modificări.',
            profil_edit_session: 'Sesiunea a expirat sau contul s-a schimbat. Autentifică-te din nou.',
            profil_edit_load_failed: 'Profilul nu a putut fi reîncărcat. Închide și încearcă din nou.',
            profil_edit_profile_refresh_failed: 'Datele profilului nu au putut fi reîncărcate. Încearcă din nou.',
            profil_edit_save_failed: 'Salvarea nu a putut fi confirmată. Reîncarcă profilul și verifică datele înainte să încerci din nou.',
            profil_edit_email_failed: 'Trimiterea cererii de schimbare a emailului nu a putut fi confirmată. Adresa actuală rămâne valabilă până la confirmare. Verifică mesajele primite înainte să încerci din nou.',
            profil_edit_email_unavailable: 'Trimiterea confirmării pentru schimbarea emailului este momentan indisponibilă. Adresa actuală rămâne valabilă. Încearcă din nou mai târziu.',
            profil_edit_email_used: 'Adresa de email este deja folosită de un alt cont.',
            profil_edit_rate_limit: 'Așteaptă puțin înainte să încerci din nou schimbarea emailului.',
            profil_edit_saved: 'Profilul a fost salvat.',
            profil_edit_partial: 'Modificările profilului au fost salvate. ',
            profil_edit_email_sent: 'Cererea de schimbare a emailului a fost trimisă. Verifică mesajele de confirmare la ambele adrese, inclusiv folderul Spam. Adresa actuală rămâne valabilă până la confirmare.',
            profil_edit_email_changed: 'Adresa de email a fost confirmată și actualizată.',
            profil_edit_saved_reload: 'Modificările au fost salvate, dar profilul nu a putut fi reîncărcat. Redeschide profilul pentru datele actualizate.',
            profil_edit_pending: 'Schimbarea adresei către {email} așteaptă confirmarea. Verifică mesajele la adresa actuală și la cea nouă; până la confirmare, folosește adresa actuală.',
            profil_edit_already_pending: 'Această adresă așteaptă deja confirmarea. Verifică mesajele de confirmare la ambele adrese.',
            profil_edit_email_review: 'Vei primi mesaje pentru confirmarea noii adrese. Emailul actual rămâne activ până la confirmare.'
        },
        hu: {
            profil_edit_button: 'Profil szerkesztése',
            profil_edit_title: 'Profil szerkesztése',
            profil_edit_intro: 'Módosítsd az adatokat, majd ellenőrizd és erősítsd meg a változásokat.',
            profil_edit_name: 'Név',
            profil_edit_phone: 'Telefonszám',
            profil_edit_email: 'E-mail cím',
            profil_edit_email_note: 'Az e-mail cím módosítását a jelenlegi és az új címre küldött üzenetekkel kell megerősíteni. Addig a jelenlegi címmel jelentkezz be.',
            profil_edit_continue: 'Módosítások ellenőrzése',
            profil_edit_confirm: 'Megerősítés és mentés',
            profil_edit_back: 'Vissza a szerkesztéshez',
            profil_edit_cancel: 'Mégse',
            profil_edit_close: 'Bezárás',
            profil_edit_done: 'Vissza a profilhoz',
            profil_edit_review: 'Megerősíted ezeket a módosításokat?',
            profil_edit_loading: 'Profil ellenőrzése…',
            profil_edit_saving: 'Módosítások mentése…',
            profil_edit_name_invalid: 'A névnek 2–200 karakterből kell állnia.',
            profil_edit_phone_invalid: 'Adj meg 7–15 számjegyből álló telefonszámot. +, szóköz, pont, zárójel és kötőjel használható.',
            profil_edit_email_invalid: 'Adj meg érvényes e-mail címet.',
            profil_edit_no_changes: 'Nem módosítottál semmit.',
            profil_edit_session: 'A munkamenet lejárt, vagy a fiók megváltozott. Jelentkezz be újra.',
            profil_edit_load_failed: 'A profil nem tölthető újra. Zárd be és próbáld újra.',
            profil_edit_profile_refresh_failed: 'A profil adatait nem sikerült újratölteni. Próbáld újra.',
            profil_edit_save_failed: 'A mentés nem erősíthető meg. Töltsd újra a profilt és ellenőrizd az adatokat, mielőtt újra próbálkozol.',
            profil_edit_email_failed: 'Az e-mail módosítási kérés elküldése nem erősíthető meg. A jelenlegi cím a megerősítésig érvényes. Ellenőrizd az üzeneteidet, mielőtt újra próbálkozol.',
            profil_edit_email_unavailable: 'Az e-mail módosítás megerősítő üzenete jelenleg nem küldhető el. A jelenlegi cím érvényes marad. Próbáld újra később.',
            profil_edit_email_used: 'Ezt az e-mail címet már egy másik fiók használja.',
            profil_edit_rate_limit: 'Várj egy kicsit, mielőtt újra megpróbálod az e-mail cím módosítását.',
            profil_edit_saved: 'A profil mentve.',
            profil_edit_partial: 'A profil módosításai mentve. ',
            profil_edit_email_sent: 'Az e-mail módosítási kérés elküldve. Ellenőrizd mindkét cím megerősítő üzeneteit, a Spam mappát is. A jelenlegi cím a megerősítésig érvényes.',
            profil_edit_email_changed: 'Az e-mail cím megerősítve és frissítve.',
            profil_edit_saved_reload: 'A módosítások mentve, de a profil nem tölthető újra. Nyisd meg újra a frissített adatokért.',
            profil_edit_pending: 'A(z) {email} címre történő váltás megerősítésre vár. Ellenőrizd a jelenlegi és az új cím üzeneteit; addig a jelenlegi címet használd.',
            profil_edit_already_pending: 'Ez a cím már megerősítésre vár. Ellenőrizd mindkét cím megerősítő üzeneteit.',
            profil_edit_email_review: 'Üzeneteket kapsz az új cím megerősítéséhez. A jelenlegi e-mail cím a megerősítésig aktív marad.'
        },
        en: {
            profil_edit_button: 'Edit profile',
            profil_edit_title: 'Edit profile',
            profil_edit_intro: 'Update your details, then review and confirm the changes.',
            profil_edit_name: 'Name',
            profil_edit_phone: 'Phone number',
            profil_edit_email: 'Email address',
            profil_edit_email_note: 'Confirm your email change using the messages sent to your current and new addresses. Until then, sign in with your current address.',
            profil_edit_continue: 'Review changes',
            profil_edit_confirm: 'Confirm and save',
            profil_edit_back: 'Back to editing',
            profil_edit_cancel: 'Cancel',
            profil_edit_close: 'Close',
            profil_edit_done: 'Back to profile',
            profil_edit_review: 'Confirm these changes?',
            profil_edit_loading: 'Checking your profile…',
            profil_edit_saving: 'Saving your changes…',
            profil_edit_name_invalid: 'Your name must have 2–200 characters.',
            profil_edit_phone_invalid: 'Enter a phone number with 7–15 digits. +, spaces, dots, parentheses and hyphens are allowed.',
            profil_edit_email_invalid: 'Enter a valid email address.',
            profil_edit_no_changes: 'You have not made any changes.',
            profil_edit_session: 'Your session expired or the account changed. Please sign in again.',
            profil_edit_load_failed: 'Your profile could not be refreshed. Close and try again.',
            profil_edit_profile_refresh_failed: 'Your profile details could not be refreshed. Please try again.',
            profil_edit_save_failed: 'Saving could not be confirmed. Reload your profile and check your details before trying again.',
            profil_edit_email_failed: 'Sending the email change request could not be confirmed. Your current address remains valid until confirmation. Check your messages before trying again.',
            profil_edit_email_unavailable: 'Sending the email change confirmation is temporarily unavailable. Your current address remains valid. Please try again later.',
            profil_edit_email_used: 'This email address is already used by another account.',
            profil_edit_rate_limit: 'Wait a little before trying to change your email again.',
            profil_edit_saved: 'Your profile has been saved.',
            profil_edit_partial: 'Your profile changes have been saved. ',
            profil_edit_email_sent: 'Your email change request has been sent. Check the confirmation messages at both addresses, including Spam. Your current address remains valid until confirmation.',
            profil_edit_email_changed: 'Your email address has been confirmed and updated.',
            profil_edit_saved_reload: 'Your changes were saved, but your profile could not be refreshed. Reopen your profile to see the updated details.',
            profil_edit_pending: 'Changing your address to {email} is awaiting confirmation. Check the messages at your current and new addresses; until confirmed, use your current address.',
            profil_edit_already_pending: 'This address is already awaiting confirmation. Check the confirmation messages at both addresses.',
            profil_edit_email_review: 'You will receive messages to confirm your new address. Your current email stays active until confirmation.'
        }
    };
    for (const [language, labels] of Object.entries(copy)) {
        labels.profil_edit_hint = labels.profil_edit_email_note;
        labels.profil_edit_next = labels.profil_edit_continue;
        labels.profil_edit_review_title = labels.profil_edit_review;
        labels.profil_edit_pending_hint = labels.profil_edit_pending;
        if (window.dict?.[language]) Object.assign(window.dict[language], labels);
    }
    const t = key => (copy[window.lang] || copy.ro)[key] || copy.ro[key] || '';
    const emailKey = value => String(value || '').trim().toLowerCase();
    const phoneValue = user => user.telefon === '-' ? '' : user.telefon || '';

    function init() {
        const modal = document.getElementById('modal-editare-profil');
        const openButton = document.getElementById('btn-editeaza-profil');
        const form = document.getElementById('profil-edit-form');
        if (!modal || !openButton || !form) return;
        const fields = document.getElementById('profil-edit-fields');
        const review = document.getElementById('profil-edit-review');
        const summary = document.getElementById('profil-edit-summary');
        const status = document.getElementById('profil-edit-status');
        const inputs = {
            nume: document.getElementById('profil-edit-nume'),
            telefon: document.getElementById('profil-edit-telefon'),
            email: document.getElementById('profil-edit-email')
        };
        const next = document.getElementById('btn-profil-continua');
        const confirm = document.getElementById('btn-profil-confirma');
        const back = document.getElementById('btn-profil-inapoi');
        const cancel = document.getElementById('btn-profil-anuleaza');
        const closeButton = document.getElementById('inchide-editare-profil');
        const profile = document.getElementById('modal-profil');
        const pending = document.getElementById('profil-email-pending');
        let generation = 0;
        let state = null;
        let busy = false;
        let statusKeys = [];
        form.noValidate = true;

        const currentUser = () => window.getSpotivityProfileUser?.() || null;
        const isOpen = () => modal.style.display === 'flex';
        const isCurrent = captured => state === captured && captured.generation === generation
            && currentUser()?.id === captured.user.id && !captured.controller.signal.aborted;
        const staleError = () => Object.assign(new Error('Profile session changed'), { profileSessionChanged: true });
        const assertCurrent = captured => { if (!isCurrent(captured)) throw staleError(); };

        function showStatus(keys, kind = '') {
            statusKeys = Array.isArray(keys) ? keys : [keys];
            status.textContent = statusKeys.map(t).join(' ');
            status.dataset.kind = kind;
        }

        function renderPending(user = currentUser()) {
            if (!pending) return;
            const email = user?.newEmail;
            pending.hidden = !email || emailKey(email) === emailKey(user?.email);
            pending.textContent = pending.hidden ? '' : t('profil_edit_pending').replace('{email}', email);
        }

        function renderPhase() {
            if (!state) return;
            const editing = state.phase === 'editing';
            const reviewing = state.phase === 'review';
            fields.hidden = !editing;
            review.hidden = !reviewing;
            next.hidden = !editing;
            confirm.hidden = !reviewing;
            back.hidden = !reviewing;
            cancel.textContent = t(state.phase === 'saved' ? 'profil_edit_done' : 'profil_edit_cancel');
            cancel.dataset.i18n = state.phase === 'saved' ? 'profil_edit_done' : 'profil_edit_cancel';
            [next, confirm, back, cancel, closeButton, ...Object.values(inputs)].forEach(element => {
                const isClose = element === cancel || element === closeButton;
                element.disabled = (busy && (!isClose || state.operation === 'saving')) || (element === next && !state.loaded);
            });
            form.setAttribute('aria-busy', String(busy));
            closeButton.setAttribute('aria-label', t('profil_edit_close'));
        }

        function populate(user) {
            inputs.nume.value = user.nume || '';
            inputs.telefon.value = phoneValue(user);
            inputs.email.value = user.email || '';
            Object.values(inputs).forEach(input => input.setCustomValidity(''));
        }

        function close(force = false, returnToProfile = true) {
            if (busy && state?.operation === 'saving' && !force) return;
            const oldUser = state?.user;
            generation += 1;
            state?.controller.abort();
            state = null;
            busy = false;
            modal.style.display = 'none';
            form.reset();
            Object.values(inputs).forEach(input => { input.value = ''; input.setCustomValidity(''); });
            summary.replaceChildren();
            statusKeys = [];
            status.textContent = '';
            form.setAttribute('aria-busy', 'false');
            delete status.dataset.kind;
            if (returnToProfile && oldUser?.id === currentUser()?.id) {
                profile.style.display = 'flex';
                openButton.focus({ preventScroll: true });
            }
            if (![...document.querySelectorAll('.modal')].some(element => ['flex', 'block'].includes(element.style.display))) {
                document.body.classList.remove('fara-scroll');
            }
        }

        async function open() {
            if (isOpen()) return;
            const user = currentUser();
            if (!user?.id) return;
            const captured = { generation: ++generation, user: { ...user }, phase: 'editing', controller: new AbortController(), draft: null, loaded: false, operation: 'loading' };
            state = captured;
            busy = true;
            populate(user);
            profile.style.display = 'none';
            modal.style.display = 'flex';
            document.body.classList.add('fara-scroll');
            showStatus('profil_edit_loading');
            renderPhase();
            modal.querySelector('.modal-continut')?.focus({ preventScroll: true });
            try {
                await window.refreshSpotivityProfile();
                assertCurrent(captured);
                captured.user = { ...currentUser() };
                captured.loaded = true;
                populate(captured.user);
                showStatus([]);
            } catch (error) {
                if (!isCurrent(captured)) return;
                showStatus(error.profileSessionChanged ? 'profil_edit_session' : 'profil_edit_load_failed', 'error');
            } finally {
                if (isCurrent(captured)) {
                    busy = false;
                    captured.operation = null;
                    renderPhase();
                    (captured.loaded ? inputs.nume : cancel).focus({ preventScroll: true });
                }
            }
        }

        function validate() {
            const draft = {
                nume: inputs.nume.value.trim(),
                telefon: inputs.telefon.value.trim(),
                email: inputs.email.value.trim()
            };
            Object.values(inputs).forEach(input => input.setCustomValidity(''));
            inputs.email.value = draft.email;
            let invalid = null;
            const nameChanged = draft.nume !== (state.user.nume || '');
            const phoneChanged = draft.telefon !== phoneValue(state.user);
            if (nameChanged && (draft.nume.length < 2 || draft.nume.length > 200 || /[\u0000-\u001f\u007f]/.test(draft.nume))) {
                inputs.nume.setCustomValidity(t('profil_edit_name_invalid'));
                invalid = inputs.nume;
            } else if (phoneChanged && (draft.telefon.length > 50 || !/^\+?[\d ().-]+$/.test(draft.telefon)
                || draft.telefon.replace(/\D/g, '').length < 7 || draft.telefon.replace(/\D/g, '').length > 15)) {
                inputs.telefon.setCustomValidity(t('profil_edit_phone_invalid'));
                invalid = inputs.telefon;
            } else if (!draft.email || draft.email.length > 254 || !inputs.email.validity.valid) {
                inputs.email.setCustomValidity(t('profil_edit_email_invalid'));
                invalid = inputs.email;
            }
            if (invalid) {
                showStatus(invalid.validationMessage ? [] : 'profil_edit_save_failed', 'error');
                status.textContent = invalid.validationMessage;
                invalid.focus();
                invalid.reportValidity();
                return null;
            }
            return draft;
        }

        function changesFor(captured) {
            const draft = captured.draft;
            return {
                profile: draft.nume !== (captured.user.nume || '') || draft.telefon !== phoneValue(captured.user),
                email: emailKey(draft.email) !== emailKey(captured.user.email),
                alreadyPending: emailKey(draft.email) === emailKey(captured.user.newEmail)
            };
        }

        function renderSummary() {
            if (!state?.draft) return;
            summary.replaceChildren();
            for (const [key, label] of [['nume', 'profil_edit_name'], ['telefon', 'profil_edit_phone'], ['email', 'profil_edit_email']]) {
                const beforeValue = key === 'telefon' ? phoneValue(state.user) : state.user[key] || '';
                const changed = key === 'email' ? emailKey(state.draft[key]) !== emailKey(beforeValue) : state.draft[key] !== beforeValue;
                if (!changed) continue;
                const title = document.createElement('dt');
                title.textContent = t(label);
                const detail = document.createElement('dd');
                const before = document.createElement('span');
                before.className = 'profil-edit-before';
                before.textContent = beforeValue || '—';
                const after = document.createElement('strong');
                after.textContent = state.draft[key];
                detail.append(before, document.createTextNode(' → '), after);
                summary.append(title, detail);
            }
            if (changesFor(state).email) {
                const note = document.createElement('dd');
                note.className = 'profil-edit-review-note';
                note.textContent = t('profil_edit_email_review');
                summary.append(note);
            }
        }

        async function verifiedUser(captured) {
            assertCurrent(captured);
            const { data, error } = await db.auth.getUser();
            assertCurrent(captured);
            if (error || data?.user?.id !== captured.user.id) throw staleError();
            return data.user;
        }

        function emailErrorKey(error) {
            if (['email_exists', 'user_already_exists'].includes(error?.code)) return 'profil_edit_email_used';
            if (['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error?.code) || error?.status === 429) return 'profil_edit_rate_limit';
            if (['email_address_invalid', 'validation_failed'].includes(error?.code)) return 'profil_edit_email_invalid';
            if (['email_address_not_authorized', 'unexpected_failure', 'hook_payload_over_size_limit', 'hook_timeout', 'hook_timeout_after_retry'].includes(error?.code)
                || /(?:smtp|provider|sending|send.*(?:email|mail)|email.*send)/i.test(error?.message || '')) return 'profil_edit_email_unavailable';
            return 'profil_edit_email_failed';
        }

        async function save() {
            const captured = state;
            if (busy || !captured || captured.phase !== 'review' || !captured.draft) return;
            const changes = changesFor(captured);
            busy = true;
            captured.operation = 'saving';
            renderPhase();
            showStatus('profil_edit_saving');
            let profileSaved = false;
            let emailSent = false;
            let emailClient = null;
            let failureStage = 'profile';
            try {
                await verifiedUser(captured);
                assertCurrent(captured);
                if (changes.profile) {
                    const edited = {};
                    if (captured.draft.nume !== (captured.user.nume || '')) edited.nume = captured.draft.nume;
                    if (captured.draft.telefon !== phoneValue(captured.user)) edited.telefon = captured.draft.telefon;
                    let request = db.from('clienti').update(edited)
                        .eq('user_id', captured.user.id).select('nume,telefon').single();
                    if (typeof request.abortSignal === 'function') request = request.abortSignal(captured.controller.signal);
                    const { data, error } = await request;
                    assertCurrent(captured);
                    if (error) throw error;
                    if (!data || !Object.entries(edited).every(([key, value]) => typeof data[key] === 'string' && data[key] === value)) {
                        throw new Error('Profile acknowledgement was incomplete');
                    }
                    profileSaved = true;
                }
                if (changes.email && !changes.alreadyPending) {
                    failureStage = 'email';
                    await verifiedUser(captured);
                    assertCurrent(captured);
                    const { data: sessionData, error: sessionError } = await db.auth.getSession();
                    assertCurrent(captured);
                    const session = sessionData?.session;
                    if (sessionError || session?.user?.id !== captured.user.id || !session.access_token || !session.refresh_token) throw staleError();
                    // Bind Auth writes to the verified account, even if another tab switches the shared client.
                    emailClient = createClient(supabaseUrl, supabaseKey, {
                        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
                    });
                    const { error: bindError } = await emailClient.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
                    assertCurrent(captured);
                    if (bindError) throw bindError;
                    const { data: identity, error: identityError } = await emailClient.auth.getUser();
                    assertCurrent(captured);
                    if (identityError || identity?.user?.id !== captured.user.id) throw staleError();
                    const { error: updateError } = await emailClient.auth.updateUser({ email: captured.draft.email }, { emailRedirectTo: window.siteHomeUrl() });
                    assertCurrent(captured);
                    if (updateError) throw updateError;
                    emailSent = true;
                }
                failureStage = 'refresh';
                await window.refreshSpotivityProfile();
                assertCurrent(captured);
                captured.phase = 'saved';
                if (emailSent) {
                    showStatus(emailKey(currentUser()?.email) === emailKey(captured.draft.email) ? 'profil_edit_email_changed' : 'profil_edit_email_sent', 'success');
                } else if (changes.email && changes.alreadyPending) {
                    showStatus(profileSaved ? ['profil_edit_saved', 'profil_edit_already_pending'] : 'profil_edit_already_pending', 'success');
                } else showStatus('profil_edit_saved', 'success');
                renderPending();
            } catch (error) {
                if (!isCurrent(captured)) return;
                if (failureStage === 'refresh') {
                    captured.phase = 'saved';
                    showStatus(emailSent ? ['profil_edit_email_sent', 'profil_edit_saved_reload'] : 'profil_edit_saved_reload', 'error');
                } else {
                    const message = error.profileSessionChanged ? 'profil_edit_session' : failureStage === 'email' ? emailErrorKey(error) : 'profil_edit_save_failed';
                    showStatus(profileSaved ? ['profil_edit_partial', message] : message, 'error');
                    if (profileSaved) {
                        try {
                            await window.refreshSpotivityProfile();
                            assertCurrent(captured);
                            captured.user = { ...currentUser() };
                        } catch (_) {
                            if (!isCurrent(captured)) return;
                            // The acknowledged profile write succeeded; retain it for an honest retry preview.
                            captured.user.nume = captured.draft.nume;
                            captured.user.telefon = captured.draft.telefon;
                        }
                    }
                    captured.phase = 'editing';
                    inputs.nume.value = captured.draft.nume;
                    inputs.telefon.value = captured.draft.telefon;
                    inputs.email.value = captured.draft.email;
                }
            } finally {
                emailClient?.auth.stopAutoRefresh();
                if (isCurrent(captured)) {
                    busy = false;
                    captured.operation = null;
                    renderPhase();
                    if (captured.phase === 'saved') cancel.focus({ preventScroll: true });
                    else if (captured.phase === 'editing') inputs.email.focus({ preventScroll: true });
                }
            }
        }

        form.addEventListener('submit', event => {
            event.preventDefault();
            if (busy || !state || !state.loaded || state.phase !== 'editing') return;
            if (!isCurrent(state)) { close(true, false); return; }
            const draft = validate();
            if (!draft) return;
            state.draft = draft;
            const changes = changesFor(state);
            if (!changes.profile && (!changes.email || changes.alreadyPending)) {
                showStatus(changes.email && changes.alreadyPending ? 'profil_edit_already_pending' : 'profil_edit_no_changes');
                return;
            }
            state.phase = 'review';
            showStatus([]);
            renderSummary();
            renderPhase();
            confirm.focus({ preventScroll: true });
        });
        openButton.addEventListener('click', open);
        confirm.addEventListener('click', save);
        back.addEventListener('click', () => {
            if (busy || !state) return;
            state.phase = 'editing';
            state.draft = null;
            summary.replaceChildren();
            showStatus([]);
            renderPhase();
            inputs.nume.focus({ preventScroll: true });
        });
        cancel.addEventListener('click', () => close());
        // Capture the X click so the universal modal handler cannot bypass cleanup or busy state.
        closeButton.addEventListener('click', event => { event.stopImmediatePropagation(); close(); }, true);
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        document.addEventListener('keydown', event => {
            if (!isOpen()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close();
            } else if (event.key === 'Tab') {
                const available = [...modal.querySelectorAll('button, input, [tabindex="0"]')]
                    .filter(element => !element.disabled && !element.closest('[hidden]') && element.getClientRects().length);
                if (!available.length) { event.preventDefault(); return; }
                const first = available[0];
                const last = available[available.length - 1];
                if (event.shiftKey && (document.activeElement === first || !available.includes(document.activeElement))) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !available.includes(document.activeElement))) {
                    event.preventDefault(); first.focus();
                }
            }
        }, true);
        window.addEventListener('spotivity:profile-user', event => {
            const user = event.detail?.user || null;
            renderPending(user);
            if (state && user?.id !== state.user.id) close(true, false);
        });
        window.addEventListener('spotivity:language', () => {
            renderPending();
            if (state) {
                renderPhase();
                if (state.phase === 'review') renderSummary();
                if (statusKeys.length) status.textContent = statusKeys.map(t).join(' ');
            }
        });
        renderPending();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
