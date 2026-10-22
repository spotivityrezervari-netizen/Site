/* admin-court-view.js — same-page administration module. */
(() => {
    'use strict';
    const modules = window.SpotivityModules = window.SpotivityModules || {};
    modules.adminCourtView = function(context) {
        const { db, state } = context;
        window.renderSpotivityAdmin = async function(data) {
            context.clearSessionView();
                state.account = { ...data };
                const authRequest = state.authGeneration;
                window.dispatchEvent(new CustomEvent('spotivity:admin-role', { detail: { userId: data.user_id, isSuper: data.is_super === true, generation: state.authGeneration, selectedBaseId: data.selectedBaseId || null, baseAccess: data.baseAccess || null } }));
                document.getElementById('sectiune-dashboard').style.display = 'flex';
                document.getElementById('text-rol-activ').innerText = window.lang === 'hu' ? `Bejelentkezve mint: \n${state.account.nume_admin}` : `Logat ca: ${state.account.nume_admin}`;

                let terenuriPtTabel = [];

                // NOUA LOGICĂ DE SHOW/HIDE PENTRU MENIU GRID
                let listaTerenuriAlocate = [];

                if (state.account.is_super) {
                    document.querySelectorAll('.super-admin-only').forEach(el => el.style.display = 'flex');
                    document.querySelectorAll('.admin-comun').forEach(el => el.style.display = 'flex');

                    window.incarcaTerenuriAdmin();
                    window.actualizeazaBifeTerenuri();

                    const { data: toate } = await db.from('terenuri').select('nume');
                    if (authRequest !== state.authGeneration) return;
                    if (toate) {
                        terenuriPtTabel = toate.map(t => t.nume);
                        listaTerenuriAlocate = terenuriPtTabel;
                    }
                } else {
                    document.querySelectorAll('.super-admin-only').forEach(el => el.style.display = 'none');
                    document.querySelectorAll('.admin-comun').forEach(el => el.style.display = 'flex');

                    listaTerenuriAlocate = state.account.terenuri ? state.account.terenuri.split(',').map(n => n.trim()).filter(Boolean) : [];
                    terenuriPtTabel = listaTerenuriAlocate.filter(n => n);
                }

                const containerMeniu = document.getElementById('container-meniu-terenuri');
                    const containerModale = document.getElementById('container-modale-terenuri');
                    const selectManualTeren = document.getElementById('manual-teren');

                    containerMeniu.innerHTML = '';
                    containerMeniu.parentElement.style.display = 'flex';
                    containerModale.innerHTML = '';
                    selectManualTeren.innerHTML = '';

                    let htmlMeniu = "";
                    let htmlModale = "";


                    const oraseTerenuri = Object.create(null);
                    const allocatedCourts = [];

                    for (let numeT of listaTerenuriAlocate) {
                        if(!numeT) continue;
                        const { data: terenDB } = await db.from('terenuri').select('*').eq('nume', numeT).single();
                        if (authRequest !== state.authGeneration) return;
                        if (terenDB) {
                            allocatedCourts.push(terenDB);
                            selectManualTeren.innerHTML += `<option value="${window.escapeHtml(terenDB.nume)}" data-sport="${window.escapeHtml(terenDB.sport)}">${window.escapeHtml(terenDB.nume)}</option>`;

                            let orasul = terenDB.oras || 'Altele';
                            orasul = orasul.trim().replace(/\.+$/, '') || 'Altele';
                            if (!oraseTerenuri[orasul]) oraseTerenuri[orasul] = [];
                            oraseTerenuri[orasul].push(terenDB);
                        }
                    }

                    // Make a container for the sub-pages if it doesn't exist
                    let subPagesContainer = document.getElementById('sub-pages-container');
                    if (!subPagesContainer) {
                        subPagesContainer = document.createElement('div');
                        subPagesContainer.id = 'sub-pages-container';
                        subPagesContainer.style.width = '100%';
                        document.getElementById('sectiune-dashboard').appendChild(subPagesContainer);
                    }
                    subPagesContainer.innerHTML = ''; // reset

                    // Global back function
                    window.inchideSubPaginaOras = function() {
                        const subPages = document.querySelectorAll('.sub-pagina-oras');
                        subPages.forEach(p => p.style.display = 'none');
                        document.getElementById('container-meniu-terenuri').style.display = '';
                        const tools = document.querySelector('#base-admin-workspace .base-admin-tools');
                        if (tools) tools.hidden = false;
                    };

                    window.deschideSubPaginaOras = function(id) {
                        const page = document.getElementById(id);
                        if (!state.account?.is_super || !page) return;
                        document.getElementById('container-meniu-terenuri').style.display = 'none';
                        document.querySelector('#base-admin-workspace .base-admin-tools').hidden = true;
                        page.style.display = 'block';
                    };

                    for (const [cityIndex, [oras, courts]] of Object.entries(oraseTerenuri).entries()) {
                        const safeOras = `oras-${cityIndex}`;
                        // Only the superadmin navigates through city groups.
                        if (state.account.is_super) {
                            htmlMeniu += `
                                <button type="button" class="card-sport admin-menu-card admin-city-card admin-comun" onclick="window.deschideSubPaginaOras('pagina-oras-${safeOras}')">
                                    <h2>Setări <span class="admin-card-name">${window.escapeHtml(oras)}</span></h2>
                                    <span class="admin-card-detail">${courts.length} ${courts.length === 1 ? 'teren' : 'terenuri'}</span>
                                </button>
                            `;
                        }

                        let carduriTerenuri = '';
                        for (const terenDB of courts) {
                            const courtId = window.escapeHtml(terenDB.id);
                            const courtJsId = window.escapeJs(terenDB.id);
                            const sportLabel = terenDB.sport === 'Tenis Picior' ? 'Tenis de picior' : terenDB.sport || 'Sport';
                            let culoareTeren = terenDB.este_activ !== false ? '#3b82f6' : '#ef4444';

                            carduriTerenuri += `
                                <button type="button" class="card-sport admin-menu-card admin-court-card admin-comun" onclick="document.getElementById('modal-setari-${courtJsId}').style.display='flex'">
                                    <h2>Setări <span class="admin-card-name">${window.escapeHtml(terenDB.nume)}</span></h2>
                                    <span class="admin-card-detail">${window.escapeHtml(sportLabel)}</span>
                                </button>
                            `;

                            htmlModale += `
                                <div class="modal" id="modal-setari-${courtId}">
                                    <div class="modal-continut modal-mare" style="border-color: ${culoareTeren}; width: 100%; max-width: 550px;">
                                        <button class="buton-inchidere" aria-label="Închide" onclick="this.parentElement.parentElement.style.display='none'">X</button>
                                        <div class="admin-settings-header">
                                            <h2 class="titlu-modal" style="font-size: 20px; text-align: left; color: ${culoareTeren};">Setări ${window.escapeHtml(terenDB.nume)}</h2>
                                        </div>

                                        <div class="formular-auth" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; display: flex; flex-direction: column; flex: 1;">

                                            <div class="grup-input" style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1);">
                                                <div class="admin-toggle-row" style="display:flex; justify-content:space-between; align-items:center;">
                                                    <label style="margin:0; font-weight:bold; color: ${terenDB.este_activ !== false ? '#22c55e' : '#ef4444'};">
                                                        ${terenDB.este_activ !== false ? 'Terenul este Vizibil' : 'Terenul este Ascuns'}
                                                    </label>
                                                    <input type="checkbox" id="activ-${courtId}" ${terenDB.este_activ !== false ? 'checked' : ''} style="width:20px;height:20px; cursor:pointer;">
                                                </div>
                                                <p style="margin: 5px 0 0 0; font-size: 12px; color: #ccc;">Debifează pentru a ascunde complet terenul de clienți.</p>
                                            </div>

                                            <div class="grup-input" style="background: rgba(239, 68, 68, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(239, 68, 68, 0.3);">
                                                <label style="color: #ef4444; font-weight: bold; font-size: 15px;">Blochează / Deblochează o zi</label>
                                                <div class="admin-day-actions" style="display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px;">
                                                    <input type="date" id="data-blocare-${courtId}" style="background: rgba(0,0,0,0.5); color: white; padding: 8px; border-radius: 5px; flex: 1; min-width: 120px;">
                                                    <button type="button" onclick="blocheazaZiuaIntreaga('${window.escapeJs(terenDB.nume)}', '${window.escapeJs(terenDB.id)}', event)" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-weight: bold;">Închide</button>
                                                    <button type="button" onclick="deblocheazaZiua('${window.escapeJs(terenDB.nume)}', '${window.escapeJs(terenDB.id)}', event)" style="background: #22c55e; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-weight: bold;">Deblochează</button>
                                                </div>
                                            </div>

                                            <div class="grup-input" style="margin-bottom: 15px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden; width: 100%; box-sizing: border-box;">
                                                <label style="margin-bottom: 8px; display: block; color: #a1eafb;">Schimbă Poza Terenului</label>
                                                <div style="display: flex; gap: 10px; align-items: center; width: 100%;">
                                                    <img src="${window.escapeHtml(window.safeUrl(terenDB.poza || 'assets/imagini/avatar2.png', true))}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0;">
                                                    <input type="file" id="poza-${courtId}" accept="image/*" style="background: rgba(0,0,0,0.5); color: white; padding: 8px; border-radius: 5px; flex: 1; min-width: 0; cursor: pointer; border: 1px dashed rgba(255,255,255,0.2);">
                                                </div>
                                            </div>

                                            <div class="grup-input" style="margin-bottom: 15px;"><label>Oraș</label><input type="text" id="oras-${courtId}" value="${window.escapeHtml(terenDB.oras ? terenDB.oras.trim().replace(/\.+$/, '') : '')}" placeholder="Ex: București"></div>
                                            <fieldset class="ore-teren-setari" id="ore-rezervabile-${courtId}">
                                                <legend>Ore rezervabile</legend>
                                                <p>Bifează orele de început, între 09:00 și 22:00. Ora 22:00 acoperă intervalul 22:00–23:00. Fără bife, rezervările noi sunt oprite; cele existente rămân vizibile în program.</p>
                                                <div class="ore-teren-grid">
                                                    ${window.bookingHourOptions.map(hour => `<label><input type="checkbox" class="ora-rezervabila" value="${hour}" ${window.getCourtBookingHours(terenDB).includes(hour) ? 'checked' : ''}><span>${hour}</span></label>`).join('')}
                                                </div>
                                            </fieldset>
                                            <div class="grup-input"><label>Preț Teren (Lei)</label><input type="number" id="pret-${courtId}" value="${window.escapeHtml(terenDB.pret)}"></div>
                                            <div class="grup-input admin-toggle-row" style="display:flex; justify-content:space-between; margin-top:10px;"><label>Ofertă Minge?</label><input type="checkbox" id="minge-${courtId}" ${terenDB.optiune_minge ? 'checked' : ''} style="width:20px;height:20px;"></div>
                                            <div class="grup-input" style="margin-top:10px;"><label>Preț Minge (Lei)</label><input type="number" id="pret-minge-${courtId}" value="${window.escapeHtml(terenDB.pret_minge ?? 15)}"></div>
                                            <div class="grup-input admin-toggle-row" style="display:flex; justify-content:space-between; margin-top:10px; background: rgba(59, 130, 246, 0.1); padding: 10px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.3);">
                                                <label style="color: #a1eafb; font-weight: bold;">Activează Chat (pt acest teren)</label>
                                                <input type="checkbox" id="are-chat-${courtId}" ${terenDB.are_chat !== false ? 'checked' : ''} style="width:20px;height:20px; cursor: pointer;">
                                            </div>

                                            <button id="btn-save-${courtId}" type="button" onclick="salveazaSetariTeren('${window.escapeJs(terenDB.id)}', '${window.escapeJs(terenDB.nume)}')" class="buton-rezervare" style="background: #3b82f6; margin-top: 15px;">Salvează Setările pt ${window.escapeHtml(terenDB.nume)}</button>
                                            <button ${state.account.is_super ? '' : 'hidden'} type="button" onclick="stergeTerenDublaConfirmare('${window.escapeJs(terenDB.id)}', '${window.escapeJs(terenDB.nume)}')" class="buton-rezervare" style="background: #ef4444; margin-top: 10px;">Șterge Terenul</button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }

                        if (state.account.is_super) {
                        const pageHtml = `
                            <div id="pagina-oras-${safeOras}" class="sub-pagina-oras" style="display: none; width: 100%; margin-top: 20px;">
                                <div class="admin-city-header" style="display: flex; align-items: center; justify-content: flex-start; margin-bottom: 20px; width: 100%;">
                                    <button class="btn-cont" onclick="window.inchideSubPaginaOras()">
                                        Înapoi
                                    </button>
                                    <h1 style="color: white; margin: 0; margin-left: 20px; font-size: 24px;">Setări ${window.escapeHtml(oras)}</h1>
                                </div>
                                <div class="grila-sporturi" style="display: grid; gap: 20px;">
                                    ${carduriTerenuri}
                                </div>
                            </div>
                        `;
                        subPagesContainer.innerHTML += pageHtml;
                        } else {
                            htmlMeniu += carduriTerenuri;
                        }
                    }

                    state.managedCourts = allocatedCourts;
                    if (!state.account.is_super) {
                        const sports = new Map();
                        for (const court of allocatedCourts) {
                            const sport = window.normalizeSportName?.(court.sport) || court.sport || 'Alte sporturi';
                            if (!sports.has(sport)) sports.set(sport, []);
                            sports.get(sport).push(court);
                        }
                        const ordered = [...sports].sort(([a], [b]) =>
                            (window.getSportAppearance(a).ordine || 99) - (window.getSportAppearance(b).ordine || 99));
                        htmlMeniu = ordered.map(([sport, courts]) => {
                            const label = sport === 'Tenis Picior' ? 'Tenis de picior' : sport;
                            return `<section class="base-admin-sport" data-admin-sport="${window.escapeHtml(sport)}">
                                <header class="base-admin-sport-heading"><div><h3>${window.escapeHtml(label)}</h3></div>
                                    <button type="button" class="btn-cont base-admin-program" data-admin-program="${window.escapeHtml(sport)}">Program ${window.escapeHtml(label)}</button>
                                </header>
                                <div class="base-admin-courts">${courts.map(court => `<article class="base-admin-court">
                                    <img class="base-admin-court-photo" src="${window.escapeHtml(window.safeUrl(court.poza, true) || 'assets/imagini/avatar2.png')}" alt="" loading="lazy">
                                    <div class="base-admin-court-copy"><h4 class="admin-card-name">${window.escapeHtml(court.nume)}</h4>
                                        <p>${window.escapeHtml(court.oras || '')}</p><span>${window.escapeHtml(court.pret)} lei / oră · ${court.este_activ !== false ? 'Vizibil' : 'Ascuns'}</span>
                                    </div>
                                    <button type="button" class="btn-cont admin-court-card" data-admin-court="${window.escapeHtml(court.id)}" aria-label="Editează ${window.escapeHtml(court.nume)}"><span>Editează</span><span class="admin-card-name" hidden>${window.escapeHtml(court.nume)}</span></button>
                                </article>`).join('')}</div>
                            </section>`;
                        }).join('') || '<p class="base-admin-empty">Nu ai terenuri alocate în această bază. Poți actualiza prezentarea bazei dacă ai permisiune.</p>';
                    }
                    containerMeniu.style.display = '';
                    document.querySelector('#base-admin-workspace .base-admin-tools')?.removeAttribute('hidden');
                    containerMeniu.innerHTML = htmlMeniu;
                    containerModale.innerHTML = htmlModale;
                    window.applySportAppearance?.();

                    // Reatașează observerul pentru scroll pe noile modale create
                    context.observeModals();

                // Reîncărcare automată tabel la selecție/login
                const selectM = document.getElementById('tabel-teren');
                if (selectM && terenuriPtTabel.length > 0) {
                    window.initializeazaTabel(terenuriPtTabel);
                }
                document.querySelectorAll('#base-admin-workspace .admin-comun, #base-admin-workspace #btn-vezi-chat-admin').forEach(node => { node.hidden = !terenuriPtTabel.length; node.style.display = terenuriPtTabel.length ? 'flex' : 'none'; });
                if (!terenuriPtTabel.length) document.getElementById('tabel-corp-program').replaceChildren();
                await window.actualizeazaOreManualAdmin();
                if (authRequest !== state.authGeneration) return;

                // Chat real-time pentru admin
                setTimeout(() => { if (authRequest === state.authGeneration) context.chat.initializeRealtime(); }, 0);

        };

        document.getElementById('container-meniu-terenuri').addEventListener('click', event => {
            const program = event.target.closest('[data-admin-program]');
            if (program) return window.deschideProgramAdmin(program.dataset.adminProgram);
            const edit = event.target.closest('[data-admin-court]');
            if (!edit || !state.managedCourts.some(court => String(court.id) === edit.dataset.adminCourt)) return;
            const modal = document.getElementById(`modal-setari-${edit.dataset.adminCourt}`);
            if (modal) modal.style.display = 'flex';
        });

    };
})();
