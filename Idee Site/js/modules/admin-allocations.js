/* admin-allocations.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminAllocations = function(context) {
        const { db, state } = context;
        window.actualizeazaBifeTerenuri = async function() {
            const authRequest = state.authGeneration;
            const container = document.getElementById('container-checkbox-terenuri');
            if (!container) return;
            container.innerHTML = `
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="check-super-admin" value="ALL" style="margin-right: 5px; width: 20px; height: 20px; flex-shrink: 0;"> SUPER ADMIN (Acces Total)</label>
                <hr style="border-color: rgba(255,255,255,0.1); width: 100%; margin: 5px 0;">
            `;
            const { data } = await db.from('terenuri').select('nume, sport');
            if (authRequest !== state.authGeneration) return;
            if (data) {
                data.forEach(t => { container.innerHTML += `<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" class="check-teren-alocat" value="${window.escapeHtml(t.nume)}" style="margin-right: 5px; width: 20px; height: 20px; flex-shrink: 0;">${window.escapeHtml(t.nume)} (${window.escapeHtml(t.sport)})</label>`; });
            }
        };
        document.getElementById('creeaza-supervisor-btn')?.addEventListener('click', async () => {
            if (!state.account?.is_super) return;
            const sameContext = context.captureContext();
            const nume = document.getElementById('super-nume').value.trim().replace(/\.$/, '');
            const email = document.getElementById('super-email').value.trim().replace(/\.$/, '');
            const esteSuper = document.getElementById('check-super-admin').checked;
            const listaTerenuri = Array.from(document.querySelectorAll('.check-teren-alocat:checked')).map(cb => cb.value).join(',');

            if (!nume || !email) return alert("Completează numele și adresa de mail!");
            if (!esteSuper && listaTerenuri === "") return alert("Bifează măcar un teren!");

            const btn = document.getElementById('creeaza-supervisor-btn'); btn.innerText = "Se verifică...";

            // Verifică dacă adresa e deja alocată
            const { data: verificare } = await db.from('users_admin').select('id').eq('email', email);
            if (!sameContext() || !state.account?.is_super) return;
            if (verificare && verificare.length > 0) { btn.innerText = "Alocă Terenuri"; return alert("Acest E-mail este deja alocat unui angajat/admin!"); }

            const { error } = await db.from('users_admin').insert([{ nume_admin: nume, email: email, is_super: esteSuper, terenuri: esteSuper ? "ALL" : listaTerenuri }]);
            if (!sameContext()) return;
            if (!error) {
                alert(`Rol și terenuri alocate pentru contul Auth existent: ${email}.`);
                document.querySelectorAll('#modal-creeaza-cont input[type=checkbox]').forEach(cb => cb.checked = false);
                document.getElementById('super-nume').value = "";
                document.getElementById('super-email').value = "";
                document.getElementById('modal-creeaza-cont').style.display = 'none';
            } else {
                alert("Eroare: " + error.message);
            }
            btn.innerText = "Alocă Terenuri";
        });

    };
})();
