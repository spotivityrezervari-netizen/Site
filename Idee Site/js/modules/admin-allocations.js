/* admin-allocations.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminAllocations = function(context) {
        const { db, state } = context;
        let pendingAllocation = null;
        const allocationButton = document.getElementById('creeaza-supervisor-btn');
        window.addEventListener('spotivity:admin-clear', () => {
            pendingAllocation = null;
            if (allocationButton) { allocationButton.innerText = 'Alocă Terenuri'; allocationButton.disabled = false; }
        });
        window.actualizeazaBifeTerenuri = async function() {
            const authRequest = state.authGeneration;
            const container = document.getElementById('container-checkbox-terenuri');
            if (!container) return;
            container.innerHTML = `
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="check-super-admin" value="ALL" style="margin-right: 5px; width: 20px; height: 20px; flex-shrink: 0;"> SUPER ADMIN (Acces Total)</label>
                <hr style="border-color: rgba(255,255,255,0.1); width: 100%; margin: 5px 0;">
            `;
            const { data } = await window.spotivityReadAllRows(() => db.from('terenuri').select('nume, sport').order('nume'));
            if (authRequest !== state.authGeneration) return;
            if (data) {
                data.forEach(t => { container.innerHTML += `<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" class="check-teren-alocat" value="${window.escapeHtml(t.nume)}" style="margin-right: 5px; width: 20px; height: 20px; flex-shrink: 0;">${window.escapeHtml(t.nume)} (${window.escapeHtml(t.sport)})</label>`; });
            }
        };
        allocationButton?.addEventListener('click', async () => {
            if (!state.account?.is_super) return;
            if (pendingAllocation?.generation === state.authGeneration) return;
            const sameSession = context.captureContext();
            const modal = document.getElementById('modal-creeaza-cont');
            const nameInput = document.getElementById('super-nume');
            const emailInput = document.getElementById('super-email');
            const nameValue = nameInput.value;
            const emailValue = emailInput.value;
            const checkboxes = Array.from(modal.querySelectorAll('input[type=checkbox]'), node => ({node, value: node.value, checked: node.checked}));
            const sameContext = () => sameSession() && state.account?.is_super && modal.style.display === 'flex'
                && nameInput.isConnected && emailInput.isConnected && nameInput.value === nameValue && emailInput.value === emailValue
                && checkboxes.every(({node, value, checked}) => node.isConnected && node.value === value && node.checked === checked);
            if (!sameContext()) return;
            const nume = nameValue.trim().replace(/\.$/, '');
            const email = emailValue.trim().replace(/\.$/, '');
            const esteSuper = document.getElementById('check-super-admin').checked;
            const listaTerenuri = Array.from(document.querySelectorAll('.check-teren-alocat:checked')).map(cb => cb.value).join(',');

            if (!nume || !email) return alert("Completează numele și adresa de mail!");
            if (!esteSuper && listaTerenuri === "") return alert("Bifează măcar un teren!");

            const request = {generation: state.authGeneration};
            pendingAllocation = request;
            const btn = allocationButton; btn.innerText = "Se verifică..."; btn.disabled = true;
            try {

                // Verifică dacă adresa e deja alocată
                const { data: verificare, error: lookupError } = await db.from('users_admin').select('id').eq('email', email);
                if (!sameContext()) return;
                if (lookupError) return alert('Alocările existente nu pot fi verificate. Încearcă din nou.');
                if (verificare && verificare.length > 0) return alert("Acest E-mail este deja alocat unui angajat/admin!");

                const { error } = await db.from('users_admin').insert([{ nume_admin: nume, email: email, is_super: esteSuper, terenuri: esteSuper ? "ALL" : listaTerenuri }]);
                if (!sameContext()) return;
                if (!error) {
                    alert(`Rol și terenuri alocate pentru contul Auth existent: ${email}.`);
                    checkboxes.forEach(({node}) => {node.checked = false;});
                    nameInput.value = "";
                    emailInput.value = "";
                    modal.style.display = 'none';
                } else {
                    alert("Eroare: " + error.message);
                }
            } finally {
                if (pendingAllocation === request) {
                    pendingAllocation = null;
                    btn.innerText = "Alocă Terenuri"; btn.disabled = false;
                }
            }
        });

    };
})();
