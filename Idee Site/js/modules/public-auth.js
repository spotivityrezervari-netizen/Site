// Login, registration, logout, reset requests and Auth identity changes.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicAuth = function(context) {
        const { db, state, services } = context;
        const clearPasswords = () => {
            for (const id of ['login-parola', 'reg-parola']) {
                const input = document.getElementById(id);
                if (input) input.value = '';
            }
        };
        function mount() {
            // --- ENTER PENTRU LOGIN / REGISTER ---
            document.getElementById('form-login')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-executa-login')?.click(); }
            });
            document.getElementById('form-register')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-executa-register')?.click(); }
            });

            document.getElementById('inchide-auth')?.addEventListener('click', () => {
                clearPasswords();
                document.getElementById('modal-auth').style.display = 'none';
            });
            document.getElementById('inchide-profil')?.addEventListener('click', () => document.getElementById('modal-profil').style.display = 'none');

            document.getElementById('btn-logout')?.addEventListener('click', async () => {
                clearPasswords();
                const { error } = await db.auth.signOut();
                if (error) return alert('Deconectarea a eșuat: ' + error.message);
                await services.profile.syncUser(null);
                document.getElementById('modal-profil').style.display = 'none'; window.actualizeazaButonCont();
            });

            document.getElementById('tab-login')?.addEventListener('click', () => {
                document.getElementById('form-login').style.display = 'flex'; document.getElementById('form-register').style.display = 'none';
                document.getElementById('tab-login').classList.add('activ'); document.getElementById('tab-register').classList.remove('activ');
            });

            document.getElementById('tab-register')?.addEventListener('click', () => {
                document.getElementById('form-login').style.display = 'none'; document.getElementById('form-register').style.display = 'flex';
                document.getElementById('tab-register').classList.add('activ'); document.getElementById('tab-login').classList.remove('activ');
            });

            document.getElementById('btn-executa-login')?.addEventListener('click', async () => {
                const email = document.getElementById('login-email').value.trim(); const parola = document.getElementById('login-parola').value;
                if(!email || !parola) return alert("Completati datele!");

                const btn = document.getElementById('btn-executa-login');
                const textInitial = btn.innerText;
                btn.innerText = "⏳..."; btn.disabled = true;

                // Autentificare prin Supabase Auth
                const { data: authData, error: authError } = await db.auth.signInWithPassword({
                    email: email,
                    password: parola,
                }).finally(clearPasswords);

                if (authError) {
                    btn.innerText = textInitial; btn.disabled = false;
                    return alert("Email sau parolă greșită! (Eroare Auth: " + authError.message + ")");
                }

                await services.profile.syncUser(authData.user);
                document.getElementById('modal-auth').style.display = 'none';

                btn.innerText = textInitial; btn.disabled = false;
            });

            document.getElementById('btn-executa-register')?.addEventListener('click', async () => {
                const nume = document.getElementById('reg-nume').value.trim();
                const email = document.getElementById('reg-email').value.trim();
                const telefon = document.getElementById('reg-telefon').value.trim();
                const parola = document.getElementById('reg-parola').value;

                if(!nume || !email || !telefon || !parola) return alert("Completați toate câmpurile!");
                if(parola.length < 6) return alert("Parola trebuie să aibă minim 6 caractere pentru securitate!");

                const btn = document.getElementById('btn-executa-register');
                btn.innerText = "⏳..."; btn.disabled = true;

                // 1. Înregistrare în seiful Supabase Auth (Securitate)
                const { data: authData, error: authError } = await db.auth.signUp({
                    email: email,
                    password: parola,
                    options: { data: { nume, telefon }, emailRedirectTo: window.siteHomeUrl() },
                }).finally(clearPasswords);

                if (authError) {
                    btn.innerText = window.dict[window.lang]['btn_creare_cont']; btn.disabled = false;
                    if (authError.message.includes("already registered")) {
                        return alert("Există deja un cont cu această adresă de email! Te rugăm să te conectezi pe el.");
                    }
                    return alert("Eroare la securizarea contului: " + authError.message);
                }

                // The Auth trigger creates the profile, even before email confirmation.
                btn.innerText = window.dict[window.lang]['btn_creare_cont']; btn.disabled = false;
                alert(authData.session
                    ? 'Cont creat. Ești autentificat.'
                    : 'Verifică emailul pentru confirmarea contului, apoi autentifică-te.');
                document.getElementById('tab-login').click();
            });

            // --- 1. BUTONUL DE AM UITAT PAROLA (Cere emailul si trimite) ---
            const btnUitat = document.getElementById('btn-am-uitat-parola') || document.getElementById('btn-forgot-password');
            if (btnUitat) {
                // Înlocuim butonul cu o clonă pentru a șterge orice "refresh/jump" stricat setat anterior
                const nouBtnUitat = btnUitat.cloneNode(true);
                btnUitat.parentNode.replaceChild(nouBtnUitat, btnUitat);

                nouBtnUitat.addEventListener('click', async (e) => {
                    e.preventDefault();
                    // Încearcă să ia emailul din câmpul de login. Dacă e gol, cere prin prompt.
                    let email = document.getElementById('login-email')?.value.trim();
                    if (!email) {
                        alert("Te rugăm să introduci adresa de email în căsuța de mai sus, apoi apasă din nou pe Resetare.");
                        return;
                    }

                    const textInitial = nouBtnUitat.innerText;
                    nouBtnUitat.innerText = "⏳...";
                    nouBtnUitat.style.pointerEvents = "none";

                    const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
                        redirectTo: window.siteHomeUrl(),
                    });

                    nouBtnUitat.innerText = textInitial;
                    nouBtnUitat.style.pointerEvents = "auto";

                    if (error) {
                        alert("Eroare la trimitere: " + error.message);
                    } else {
                        alert("Ți-am trimis un link de resetare a parolei pe email! Deschide-l în același browser în care l-ai solicitat. Verifică și folderul Spam.");
                    }
                });
            }
        }
        function watchIdentity() {
            db.auth.onAuthStateChange((event, session) => {
                if (['SIGNED_IN', 'SIGNED_OUT'].includes(event)) clearPasswords();
                // restore() already fetched this user's authoritative Auth data.
                // INITIAL_SESSION can carry older cached email-change metadata.
                if (event === 'INITIAL_SESSION'
                    && (state.user?.id || null) === (session?.user?.id || null)) return;
                if (['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','USER_UPDATED','TOKEN_REFRESHED'].includes(event)) {
                    if (!session || (state.user && state.user.id !== session.user?.id)) {
                        state.authGeneration++;
                        state.user = null;
                        services.profile.renderUser();
                        window.dispatchEvent(new CustomEvent('spotivity:profile-user', { detail: { user: null } }));
                        for (const id of ['modal-profil','modal-lista-rezervari','modal-chat-client']) document.getElementById(id).style.display = 'none';
                        for (const id of ['chat-client-lista-terenuri','chat-client-mesaje','container-rezervari']) document.getElementById(id)?.replaceChildren();
                        services.chat.clearIdentity({ deferChannelRemoval: true });
                    }
                    setTimeout(async () => {
                        await services.profile.syncUser(session?.user || null);
                        if (!session) {
                            for (const id of ['modal-profil','modal-lista-rezervari','modal-chat-client']) document.getElementById(id).style.display = 'none';
                            services.chat.clearIdentity();
                        }
                    },0);
                }
            });
        }
        return { mount, watchIdentity };
    };
})();
