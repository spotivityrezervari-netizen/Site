// Password recovery stays bound to the verified recovery identity.
// Factories share one explicit context; only app.js controls initialization.
(() => {
    'use strict';
    const modules = window.SpotivityModules ||= {};
    modules.publicRecovery = function(context) {
        const { db, createClient, supabaseUrl, supabaseKey } = context;
        let activeRecovery = null;
        const handledTokens = new Set();
        const clearRecoveryUrl = () => {
            const url = new URL(window.location.href);
            const keys = ['access_token','refresh_token','expires_in','expires_at','token_type',
                'type','code','error','error_code','error_description'];
            for (const key of keys) url.searchParams.delete(key);
            const hash = new URLSearchParams(url.hash.slice(1));
            if (keys.some(key => hash.has(key))) {
                for (const key of keys) hash.delete(key);
                url.hash = hash.toString();
            }
            window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        };
        const closeRecovery = () => {
            document.getElementById('modal-parola-noua')?.remove();
            activeRecovery = null;
            if (![...document.querySelectorAll('.modal')].some(m => ['flex','block'].includes(m.style.display))) {
                document.body.classList.remove('fara-scroll');
            }
            clearRecoveryUrl();
        };
        const showRecovery = session => {
            if (!session?.user?.id || !session.access_token || !session.refresh_token
                || handledTokens.has(session.access_token)) return;
            handledTokens.add(session.access_token);
            closeRecovery();
            activeRecovery = session;
            const modal = document.createElement('div');
            modal.id = 'modal-parola-noua';
            modal.className = 'modal';
            modal.style.cssText = 'display:flex;z-index:100001;';
            modal.innerHTML = `<div class="modal-continut" style="max-width:400px;width:calc(100% - 32px);height:auto;padding:28px;">
                <button type="button" class="buton-inchidere" aria-label="Închide">X</button>
                <h2 class="titlu-modal">Resetează parola</h2>
                <p>Introdu noua parolă (minim 6 caractere).</p>
                <div class="grup-input"><label for="input-noua-parola-js">Noua parolă</label>
                    <input type="password" id="input-noua-parola-js" autocomplete="new-password" minlength="6"></div>
                <p id="mesaj-resetare-parola" role="status" aria-live="polite"></p>
                <button type="button" id="btn-salveaza-parola-js" class="buton-rezervare">Salvează parola</button>
            </div>`;
            document.body.appendChild(modal);
            document.body.classList.add('fara-scroll');
            modal.querySelector('.buton-inchidere').onclick = closeRecovery;
            modal.querySelector('#btn-salveaza-parola-js').onclick = async () => {
                const button = modal.querySelector('#btn-salveaza-parola-js');
                if (button.disabled || activeRecovery !== session) return;
                const password = modal.querySelector('#input-noua-parola-js').value;
                const status = modal.querySelector('#mesaj-resetare-parola');
                if (password.length < 6) { status.textContent = 'Parola trebuie să aibă minim 6 caractere.'; return; }
                button.disabled = true;
                status.textContent = 'Se salvează...';
                // A separate in-memory client binds this request to the recovery user,
                // even if another tab signs the shared client into a different account.
                const recoveryClient = createClient(supabaseUrl, supabaseKey, {
                    auth: {persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
                });
                try {
                    const {error: sessionError} = await recoveryClient.auth.setSession({
                        access_token: session.access_token, refresh_token: session.refresh_token
                    });
                    if (sessionError) throw sessionError;
                    const {data: identity, error: identityError} = await recoveryClient.auth.getUser();
                    if (identityError || identity?.user?.id !== session.user.id) {
                        throw new Error('Linkul de resetare este invalid sau a expirat. Cere un link nou.');
                    }
                    if (activeRecovery !== session) return;
                    const {error} = await recoveryClient.auth.updateUser({password});
                    if (error) throw error;
                    if (activeRecovery !== session) return;
                    closeRecovery();
                    alert('Parola a fost schimbată cu succes.');
                } catch (error) {
                    if (activeRecovery === session) {
                        status.textContent = error.message || 'Resetarea nu a reușit. Cere un link nou.';
                        button.disabled = false;
                    }
                } finally {
                    recoveryClient.auth.stopAutoRefresh();
                }
            };
        };
        db.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                const render = () => showRecovery(session);
                if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, {once:true});
                else setTimeout(render,0);
            } else if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && activeRecovery
                && activeRecovery.user.id !== session?.user?.id)) {
                if (activeRecovery) setTimeout(closeRecovery,0);
            }
        });
        document.addEventListener('DOMContentLoaded', async () => {
            const initialUrl = new URL(window.location.href);
            const hash = new URLSearchParams(initialUrl.hash.slice(1));
            const recoveryLink = initialUrl.searchParams.get('type') === 'recovery' || hash.get('type') === 'recovery'
                || window.isSpotivityRecoveryCallback?.();
            await db.auth.getSession(); // Wait for SDK initialization and its verified event.
            showRecovery(window.takeSpotivityRecoverySession?.());
            if (recoveryLink && !activeRecovery && !handledTokens.size) {
                clearRecoveryUrl();
                alert('Linkul de resetare este invalid sau a expirat. Cere un link nou de la „Ai uitat parola?”.');
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && activeRecovery) closeRecovery();
        });
    };
})();
