/* admin-courts.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminCourts = function(context) {
        const { db, state } = context;
        const photoBucket = 'poze_terenuri';
        const photoTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
        const photoPathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9][a-z0-9_.-]{0,199}$/i;
        const pendingPhotos = new Map();
        const inFlightPhotos = new Set();
        const queueKey = userId => `spotivity-court-photo-cleanup:${userId}`;
        function queuedPhotos(userId) {
            if (!pendingPhotos.has(userId)) {
                let value = [];
                try { value = JSON.parse(localStorage.getItem(queueKey(userId)) || '[]'); } catch { /* Storage can be unavailable. */ }
                pendingPhotos.set(userId, Array.isArray(value) ? value.filter(path => typeof path === 'string' && photoPathPattern.test(path)).slice(-50) : []);
            }
            return pendingPhotos.get(userId);
        }
        function queuePhoto(userId, path, remove = false) {
            const paths = queuedPhotos(userId).filter(value => value !== path);
            if (!remove) paths.push(path);
            pendingPhotos.set(userId, paths.slice(-50));
            try { localStorage.setItem(queueKey(userId), JSON.stringify(paths.slice(-50))); } catch { /* Retry within this page still works. */ }
        }
        function photoPath(url) {
            if (typeof url !== 'string') return null;
            try {
                const parsed = new URL(url);
                if (parsed.origin !== new URL(supabaseUrl).origin) return null;
                const match = parsed.pathname.match(/^\/storage\/v1\/(?:object\/public|render\/image\/public)\/poze_terenuri\/(.+)$/);
                const path = match && decodeURIComponent(match[1]);
                return path && photoPathPattern.test(path) ? path : null;
            } catch { return null; }
        }
        async function photoOperation(userId, sameContext) {
            const check = () => { if (!sameContext()) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.'); };
            check();
            // One Auth round trip: setSession asks the server for the token's user.
            const { data: auth, error: authError } = await db.auth.getSession(); check();
            const session = auth?.session;
            if (authError || session?.user?.id !== userId || !session.access_token || !session.refresh_token) throw new Error('Autentifică-te din nou.');
            const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
            const { data: verified, error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }); check();
            if (error || verified?.user?.id !== userId) throw new Error('Autentifică-te din nou.');
            return { client, userId, isSuper: state.account?.is_super === true, path: null, check };
        }
        async function removePhoto(operation, path) {
            if (!path || !photoPathPattern.test(path) || (!operation.isSuper && path.split('/')[0] !== operation.userId)) return false;
            try {
                // Migration 039 checks ALL court references server-side. It also
                // protects successful writes whose acknowledgement was lost.
                const { data, error } = await operation.client.storage.from(photoBucket).remove([path]);
                if (error || !Array.isArray(data) || !data.some(item => item.name === path)) return false;
                queuePhoto(operation.userId, path, true);
                return true;
            } catch { return false; }
        }
        async function retryPhotos(operation) {
            for (const path of [...queuedPhotos(operation.userId)]) {
                if (!inFlightPhotos.has(path)) await removePhoto(operation, path);
            }
        }
        async function uploadPhoto(operation, file) {
            operation.check();
            const extension = photoTypes[file.type];
            if (!extension || !Number.isFinite(file.size) || file.size < 1 || file.size > 5242880) throw new Error('Alege o imagine JPG, PNG, WebP, AVIF sau GIF de maximum 5 MB.');
            const preview = URL.createObjectURL(file);
            try {
                const image = new Image();
                image.src = preview;
                await image.decode();
                if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
            } catch {
                throw new Error('Fișierul nu poate fi afișat ca imagine. Alege o altă fotografie.');
            } finally {
                URL.revokeObjectURL(preview);
            }
            operation.check();
            // Lighter copy for visitors; the original is kept if it cannot be made smaller.
            file = await (window.spotivityShrinkImage?.(file) || file);
            operation.check();
            const path = `${operation.userId}/${crypto.randomUUID()}.${photoTypes[file.type] || extension}`;
            operation.path = path;
            inFlightPhotos.add(path);
            queuePhoto(operation.userId, path);
            const { error } = await operation.client.storage.from(photoBucket).upload(path, file);
            if (error) throw new Error('Eroare la urcarea pozei: ' + error.message);
            const url = operation.client.storage.from(photoBucket).getPublicUrl(path)?.data?.publicUrl;
            if (!url || photoPath(url) !== path) throw new Error('Adresa fotografiei nu poate fi verificată.');
            return url;
        }
        async function finishPhoto(operation, saved) {
            if (!operation?.path) return;
            inFlightPhotos.delete(operation.path);
            if (saved) queuePhoto(operation.userId, operation.path, true);
            else await removePhoto(operation, operation.path);
        }
        window.addEventListener('spotivity:admin-role', () => {
            const userId = state.account?.user_id;
            if (!userId || !queuedPhotos(userId).length) return;
            const sameContext = context.captureContext();
            void photoOperation(userId, sameContext).then(retryPhotos).catch(() => {});
        });
        window.incarcaTerenuriAdmin = async function() {
            const authRequest = state.authGeneration;
            const container = document.getElementById('container-lista-terenuri');
            if (!container) return;
            container.innerHTML = "<p style='color: white;'>Se descarcă terenurile din cloud...</p>";

            const { data, error } = await window.spotivityReadAllRows(() => db.from('terenuri').select('*').order('id'));
            if (authRequest !== state.authGeneration) return;
            if (error) { container.innerHTML = "<p style='color: #ccc;'>Terenurile nu pot fi încărcate. Încearcă din nou.</p>"; return; }
            if (!data || data.length === 0) { container.innerHTML = "<p style='color: #ccc;'>Niciun teren adăugat.</p>"; return; }

            let html = "";
            data.forEach(t => {
                let textMinge = t.optiune_minge ? `Da (${t.pret_minge ?? 15} Lei)` : 'Nu';
                html += `
                    <div class="admin-existing-court" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; color: white; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <img src="${window.escapeHtml(window.appAssetUrl(t.poza) || window.appAssetUrl('assets/imagini/spotivity-256.webp'))}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 5px;">
                            <div>
                                <h4 style="margin: 0 0 5px 0; color: #f59e0b;">${window.escapeHtml(t.sport)} - ${window.escapeHtml(t.nume)}</h4>
                                <p style="margin: 0; font-size: 13px; color: #ccc;">Preț: ${t.pret} Lei/oră | Minge: ${textMinge}</p>
                            </div>
                        </div>
                        <button data-delete-court="${window.escapeHtml(t.id)}" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 5px; cursor: pointer;">Șterge</button>
                    </div>
                `;
            });
            container.innerHTML = html;
            container.querySelectorAll('[data-delete-court]').forEach(button => {
                button.addEventListener('click', () => window.stergeTerenAdmin(button.dataset.deleteCourt));
            });
        };

        window.stergeTerenAdmin = async function(id) {
            if (!state.account?.is_super) return;
            const sameContext = context.captureContext();
            if (confirm("Ești sigur? Acest teren va dispărea definitiv de pe site!")) {
                const { error } = await db.from('terenuri').delete().eq('id', id);
                if (!sameContext()) return;
                if (error) return alert('Terenul nu a putut fi șters: ' + error.message);
                await window.refreshSpotivityAdminAccess?.({ force: true });
            }
        };
        window.salveazaSetariTeren = async function(idDB, numeTeren) {
            const sameContext = context.captureContext();
            const savingUserId = state.account?.user_id;
            if (!sameContext()) return;
            const btnSave = document.getElementById(`btn-save-${idDB}`);
            if (!btnSave) return;
            btnSave.innerText = 'Se salvează...'; btnSave.disabled = true;

            const pret = document.getElementById(`pret-${idDB}`).value;
            const oras = document.getElementById(`oras-${idDB}`).value.trim();
            const minge = document.getElementById(`minge-${idDB}`).checked;
            const pretMinge = document.getElementById(`pret-minge-${idDB}`).value;
            const esteActiv = document.getElementById(`activ-${idDB}`).checked;
            const areChat = document.getElementById(`are-chat-${idDB}`) ? document.getElementById(`are-chat-${idDB}`).checked : true;
            const fileInput = document.getElementById(`poza-${idDB}`);
            const selectedHours = Array.from(document.getElementById(`ore-rezervabile-${idDB}`).querySelectorAll('.ora-rezervabila:checked')).map(input => input.value);
            if (selectedHours.some(hour => !window.bookingHourOptions.includes(hour)) || new Set(selectedHours).size !== selectedHours.length) {
                if (btnSave) { btnSave.innerText = `Salvează Setările pt ${numeTeren}`; btnSave.disabled = false; }
                return alert('Programul conține ore nevalide. Reîncarcă setările terenului.');
            }
            const oreRezervabile = window.bookingHourOptions.filter(hour => selectedHours.includes(hour));

            let dateDeUpdatat = { oras, pret: parseInt(pret), optiune_minge: minge, pret_minge: parseInt(pretMinge), este_activ: esteActiv, are_chat: areChat, ore_rezervabile: oreRezervabile };

            let operation = null, savedPhoto = false, previousPhoto = null;
            try {
                if (fileInput?.files?.[0]) {
                    operation = await photoOperation(savingUserId, sameContext);
                    await retryPhotos(operation);
                    const before = await operation.client.from('terenuri').select('poza').eq('id', idDB).maybeSingle();
                    if (before.error || !before.data) throw new Error('Setările terenului nu pot fi verificate. Reîncarcă pagina.');
                    if (!sameContext()) return;
                    previousPhoto = photoPath(before.data.poza);
                    dateDeUpdatat.poza = await uploadPhoto(operation, fileInput.files[0]);
                }
                if (!sameContext()) return;
                const client = operation?.client || db;
                const { error } = await client.from('terenuri').update(dateDeUpdatat).eq('id', idDB);
                if (error) throw error;
                if (operation) {
                    const after = await client.from('terenuri').select('poza').eq('id', idDB).maybeSingle();
                    if (after.error || after.data?.poza !== dateDeUpdatat.poza) throw new Error('Salvarea fotografiei nu poate fi confirmată. Reîncarcă setările înainte să reîncerci.');
                    savedPhoto = true;
                    if (previousPhoto && previousPhoto !== operation.path && (operation.isSuper || previousPhoto.split('/')[0] === operation.userId)) {
                        queuePhoto(operation.userId, previousPhoto);
                        await removePhoto(operation, previousPhoto);
                    }
                }
                if (!sameContext()) return;
                alert('Setări salvate!');
                await window.refreshSpotivityAdminAccess?.({ force: true });
            } catch (error) {
                if (sameContext()) alert('Eroare: ' + (error.message || 'Setările nu pot fi salvate.'));
            } finally {
                await finishPhoto(operation, savedPhoto);
                if (sameContext()) { btnSave.innerText = `Salvează Setările pt ${numeTeren}`; btnSave.disabled = false; }
            }
        };
        window.deschideModalAdaugaTeren = function() {
            if (!state.account?.is_super) return;
            document.getElementById('teren-nume').value = '';
            const inputOras = document.getElementById('teren-oras');
            if (inputOras) inputOras.value = '';
            document.getElementById('teren-pret').value = '';
            document.getElementById('teren-locatie').value = '';
            document.getElementById('teren-poza').value = '';
            window.refreshAdminBaseOptions?.();
            const baseSelect = document.getElementById('teren-baza');
            if (baseSelect) baseSelect.value = '';
            document.getElementById('modal-adauga-teren').style.display = 'flex';
        };

        document.getElementById('btn-adauga-teren')?.addEventListener('click', async () => {
            const sameContext = context.captureContext();
            const savingUserId = state.account?.user_id;
            if (!sameContext()) return;
            const nume = document.getElementById('teren-nume').value.trim().replace(/\.$/, '');
            const sport = document.getElementById('teren-sport').value;
            const oras = document.getElementById('teren-oras') ? document.getElementById('teren-oras').value.trim().replace(/\.$/, '') : '';
            const pret = document.getElementById('teren-pret').value.trim().replace(/\.$/, '');
            const minge = document.getElementById('teren-minge').checked;
            const pretMinge = document.getElementById('teren-pret-minge').value.trim().replace(/\.$/, '');
            const locatie = document.getElementById('teren-locatie').value.trim().replace(/\.$/, '');
            const fileInput = document.getElementById('teren-poza');
            const bazaSportivaId = document.getElementById('teren-baza')?.value || null;
            const createAuthRequest = state.authGeneration;
            if (!state.account?.is_super) return alert('Doar superadminul poate adăuga terenuri.');

            if (!nume || !pret || !locatie) return alert("Completează câmpurile!");
            const btn = document.getElementById('btn-adauga-teren'); btn.innerText = "Se salvează..."; btn.disabled = true;

            let urlPoza = null, operation = null, savedPhoto = false;
            try {
                if (fileInput?.files?.[0]) {
                    operation = await photoOperation(savingUserId, sameContext);
                    await retryPhotos(operation);
                    if (!sameContext()) return;
                    urlPoza = await uploadPhoto(operation, fileInput.files[0]);
                }
                if (!sameContext() || createAuthRequest !== state.authGeneration || !state.account?.is_super) return;
                const client = operation?.client || db;
                const { error } = await client.from('terenuri').insert([{
                    nume, sport, oras, pret: parseInt(pret), optiune_minge: minge, pret_minge: parseInt(pretMinge), locatie, poza: urlPoza, este_activ: true, baza_sportiva_id: bazaSportivaId
                }]);
                if (error) throw error;
                if (operation) {
                    const after = await client.from('terenuri').select('id').eq('poza', urlPoza).maybeSingle();
                    if (after.error || !after.data) throw new Error('Salvarea terenului nu poate fi confirmată. Reîncarcă lista înainte să reîncerci.');
                    savedPhoto = true;
                }
                if (!sameContext()) return;
                alert('Teren adăugat!');
                document.getElementById('modal-adauga-teren').style.display = 'none';
                await window.refreshSpotivityAdminAccess?.({ force: true });
            } catch (error) {
                if (sameContext()) alert('Eroare DB: ' + (error.message || 'Terenul nu poate fi salvat.'));
            } finally {
                await finishPhoto(operation, savedPhoto);
                if (sameContext()) { btn.innerText = 'Adaugă Teren'; btn.disabled = false; }
            }
        });
        window.stergeTerenDublaConfirmare = async function(idDB, numeTeren) {
            if (!state.account?.is_super) return;
            const sameContext = context.captureContext();
            const prima = confirm(`Ești sigur că vrei să ștergi DEFINITIV terenul "${numeTeren}"?\nAceastă acțiune nu poate fi anulată!`);
            if (!prima) return;

            const aDoua = confirm(`ATENȚIE MAXIMĂ!\nȘtergerea acestui teren va afecta toate rezervările asociate.\nEști 100% sigur că vrei să-l ștergi complet din baza de date?`);
            if (!aDoua) return;

            const { error } = await db.from('terenuri').delete().eq('id', idDB);
            if (!sameContext()) return;
            if (error) {
                alert("Eroare la ștergerea terenului: " + error.message);
            } else {
                alert("Terenul a fost șters cu succes!");
                const mod = document.getElementById("modal-setari-" + idDB);
                if (mod) mod.style.display = 'none';
                await window.refreshSpotivityAdminAccess?.({ force: true });
            }
        };

    };
})();
