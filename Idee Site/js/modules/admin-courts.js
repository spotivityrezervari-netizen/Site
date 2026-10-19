/* admin-courts.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminCourts = function(context) {
        const { db, state } = context;
        window.incarcaTerenuriAdmin = async function() {
            const authRequest = state.authGeneration;
            const container = document.getElementById('container-lista-terenuri');
            if (!container) return;
            container.innerHTML = "<p style='color: white;'>Se descarcă terenurile din cloud...</p>";

            const { data } = await db.from('terenuri').select('*');
            if (authRequest !== state.authGeneration) return;
            if (!data || data.length === 0) { container.innerHTML = "<p style='color: #ccc;'>Niciun teren adăugat.</p>"; return; }

            let html = "";
            data.forEach(t => {
                let textMinge = t.optiune_minge ? `Da (${t.pret_minge ?? 15} Lei)` : 'Nu';
                html += `
                    <div class="admin-existing-court" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; color: white; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <img src="${window.escapeHtml(window.safeUrl(t.poza || 'assets/imagini/avatar2.png', true))}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 5px;">
                            <div>
                                <h4 style="margin: 0 0 5px 0; color: #f59e0b;">${window.escapeHtml(t.sport)} - ${window.escapeHtml(t.nume)}</h4>
                                <p style="margin: 0; font-size: 13px; color: #ccc;">Preț: ${t.pret} Lei/oră | Minge: ${textMinge}</p>
                            </div>
                        </div>
                        <button onclick="stergeTerenAdmin('${window.escapeJs(t.id)}')" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 5px; cursor: pointer;">Șterge</button>
                    </div>
                `;
            });
            container.innerHTML = html;
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

            if (fileInput && fileInput.files && fileInput.files[0]) {
                const file = fileInput.files[0];
                const ext = file.name.split('.').pop();
                const { data: currentAuth } = await db.auth.getUser();
                if (!sameContext()) return;
                if (!currentAuth.user || currentAuth.user.id !== savingUserId) { if (btnSave) btnSave.disabled = false; return alert('Autentifică-te din nou.'); }
                const fileName = `${currentAuth.user.id}/${crypto.randomUUID()}.${ext}`;

                const { error: uploadError } = await db.storage.from('poze_terenuri').upload(fileName, file);
                if (!sameContext()) return;
                if (uploadError) {
                    if(btnSave) { btnSave.innerText = `Salvează Setările pt ${numeTeren}`; btnSave.disabled = false; }
                    return alert("Eroare la urcarea pozei: " + uploadError.message);
                }

                const { data: publicUrlData } = db.storage.from('poze_terenuri').getPublicUrl(fileName);
                dateDeUpdatat.poza = publicUrlData.publicUrl;
            }

            if (!sameContext()) return;
            const { error } = await db.from('terenuri').update(dateDeUpdatat).eq('id', idDB);
            if (!sameContext()) return;
            if (!error) {
                alert('Setări salvate!');
                await window.refreshSpotivityAdminAccess?.({ force: true });
            }
            else alert("Eroare: " + error.message);

            if(btnSave) { btnSave.innerText = `Salvează Setările pt ${numeTeren}`; btnSave.disabled = false; }
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

            let urlPoza = null;
            if (fileInput && fileInput.files && fileInput.files[0]) {
                const file = fileInput.files[0];
                const ext = file.name.split('.').pop();
                const { data: currentAuth } = await db.auth.getUser();
                if (!sameContext()) return;
                if (!currentAuth.user || currentAuth.user.id !== savingUserId) { btn.disabled = false; return alert('Autentifică-te din nou.'); }
                const fileName = `${currentAuth.user.id}/${crypto.randomUUID()}.${ext}`;

                // Urcăm fișierul fizic în Storage (Bucket: poze_terenuri)
                const { data: uploadData, error: uploadError } = await db.storage
                    .from('poze_terenuri')
                    .upload(fileName, file);
                if (!sameContext()) return;
                if (uploadError) {
                    alert("Eroare la urcarea pozei: " + uploadError.message);
                    btn.innerText = "Adaugă Teren"; btn.disabled = false;
                    return;
                }

                // Extragem link-ul public către poză
                const { data: publicUrlData } = db.storage.from('poze_terenuri').getPublicUrl(fileName);
                urlPoza = publicUrlData.publicUrl;
            }

            if (createAuthRequest !== state.authGeneration || !state.account?.is_super) return;
            const { error } = await db.from('terenuri').insert([{
                nume, sport, oras, pret: parseInt(pret), optiune_minge: minge, pret_minge: parseInt(pretMinge), locatie, poza: urlPoza, este_activ: true, baza_sportiva_id: bazaSportivaId
            }]);
            if (createAuthRequest !== state.authGeneration) return;

            if (error) alert("Eroare DB: " + error.message);
            else {
                alert("Teren adăugat!");
                document.getElementById('modal-adauga-teren').style.display = 'none';
                await window.refreshSpotivityAdminAccess?.({ force: true });
            }
            btn.innerText = "Adaugă Teren"; btn.disabled = false;
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
