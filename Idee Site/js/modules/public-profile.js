// Current profile identity, contact display, refresh and profile entry point.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicProfile = function(context) {
        const { db, state } = context;
        localStorage.removeItem('user_session');
        function renderProfileUser() {
            const user = state.user;
            document.getElementById('profil-nume').textContent = user?.nume || '';
            document.getElementById('profil-email').textContent = user?.email || '';
            document.getElementById('profil-telefon').textContent = user?.telefon || '-';
            const pending = document.getElementById('profil-email-pending');
            if (pending) {
                pending.hidden = !user?.newEmail || user.newEmail === user.email;
                const pendingCopy = window.dict?.[window.lang]?.profil_edit_pending || 'Schimbarea adresei către {email} așteaptă confirmarea.';
                pending.textContent = pending.hidden ? '' : pendingCopy.replace('{email}', user.newEmail);
            }
        }
        window.getSpotivityProfileUser = () => state.user ? { ...state.user } : null;
        window.refreshSpotivityProfile = async () => {
            const capturedId = state.user?.id;
            if (!capturedId) throw new Error('Conectează-te din nou.');
            const { data, error } = await db.auth.getUser();
            if (error || !data.user || capturedId !== data.user.id || state.user?.id !== capturedId) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
            const synced = await syncAuthUser(data.user, true);
            if (!synced) throw new Error('Profilul nu a putut fi reîncărcat. Încearcă din nou.');
            if (state.user?.id !== data.user.id) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
            return window.getSpotivityProfileUser();
        };
        window.addEventListener('spotivity:language', renderProfileUser);
        async function syncAuthUser(user, requireProfile = false) {
            const generation = ++state.authGeneration;
            const { data: profile, error: profileError } = user
                ? await db.from('clienti').select('nume,telefon').eq('user_id', user.id).maybeSingle()
                : { data: null, error: null };
            if (generation !== state.authGeneration) return false;
            if (requireProfile && (profileError || !profile)) throw new Error('Profilul nu a putut fi reîncărcat. Încearcă din nou.');
            const storedPhone = typeof profile?.telefon === 'string' ? profile.telefon.trim() : '';
            const metadataPhone = typeof user?.user_metadata?.telefon === 'string' ? user.user_metadata.telefon.trim() : '';
            const metadataDigits = metadataPhone.replace(/\D/g, '');
            const ownMetadataPhone = metadataPhone.length <= 50 && /^\+?[0-9 ().-]+$/.test(metadataPhone)
                && metadataDigits.length >= 7 && metadataDigits.length <= 15 ? metadataPhone : '';
            // Saved profile edits take precedence. Auth metadata only fills a
            // missing display value; reading a profile never writes contact data.
            const phone = storedPhone && storedPhone !== '-' ? storedPhone : ownMetadataPhone;
            state.user = user ? { id: user.id, email: user.email, newEmail: user.new_email || '', nume: profile?.nume || user.email?.split('@')[0] || '', telefon: phone || '-' } : null;
            renderProfileUser();
            window.dispatchEvent(new CustomEvent('spotivity:profile-user', { detail: { user: window.getSpotivityProfileUser() } }));
            if (typeof window.actualizeazaButonCont === 'function') window.actualizeazaButonCont();
            return true;
        }
        const btnTopCont = document.getElementById('btn-top-cont');

        window.actualizeazaButonCont = function() {
            const textTopCont = document.getElementById('text-top-cont');
            if(textTopCont) {
                textTopCont.innerText = state.user ? window.dict[window.lang]['contul_meu'] : window.dict[window.lang]['login_cont'];
            }
        };

        async function restore() {
            const { data: restoredAuth } = await db.auth.getUser();
            await syncAuthUser(restoredAuth.user);
            window.actualizeazaButonCont();
        }
        function mount() {
            if (btnTopCont) {
                btnTopCont.addEventListener('click', async () => {
                    if (state.user) {
                        const owner = state.user.id;
                        const refreshStatus = document.getElementById('profil-refresh-status');
                        if (refreshStatus) { refreshStatus.hidden = true; refreshStatus.textContent = ''; }
                        try {
                            await window.refreshSpotivityProfile();
                        } catch {
                            if (state.user?.id !== owner) return;
                            if (refreshStatus) {
                                refreshStatus.textContent = window.dict?.[window.lang]?.profil_edit_profile_refresh_failed
                                    || 'Datele profilului nu au putut fi reîncărcate. Încearcă din nou.';
                                refreshStatus.hidden = false;
                            }
                        }
                        if (state.user?.id !== owner) return;
                        if(document.getElementById('profil-nume')) document.getElementById('profil-nume').innerText = state.user.nume || (window.dict[window.lang]['nume_nesetat'] || 'Nume Nesetat');
                        document.getElementById('profil-email').innerText = state.user.email;
                        if(document.getElementById('profil-telefon')) document.getElementById('profil-telefon').innerText = state.user.telefon || "-";

                        const nrActiveSpan = document.getElementById('nr-active');
                        if (nrActiveSpan) {
                            const { data } = await db.from('rezervari').select('id, booking_group_id, data_str, ora, stare, timestamp_start').eq('client_user_id', owner).neq('stare', 'anulata');
                            if (state.user?.id !== owner) return;
                            const activeGroups = new Set();
                            if (data) {
                                data.forEach(r => {
                                    if (!window.esteRezervareTrecuta(r.data_str, r.ora, r.timestamp_start)) activeGroups.add(r.booking_group_id || r.id);
                                });
                            }
                            nrActiveSpan.innerText = activeGroups.size;
                        }
                        if (state.user?.id !== owner) return;
                        document.getElementById('modal-profil').style.display = 'flex';
                    } else document.getElementById('modal-auth').style.display = 'flex';
                });
            }
        }
        return { syncUser: syncAuthUser, renderUser: renderProfileUser, restore, mount };
    };
})();
