let contLogatGlobal = null; 
window.lang = 'ro';
localStorage.setItem('lang', 'ro');

// --- TRADUCERI ADMIN ---
window.setLangAdmin = function(limba) {
    limba = 'ro'; // Force Romanian
    localStorage.setItem('lang', limba);
    window.lang = limba;

    const dict = {
        'ro': {
            't-logare': '🔐 Logare Panou Control',
            't-logout': 'Deconectare',
            't-rez-man-scurt': 'Rezervare Manuală',
            't-prog-scurt': 'Program & Active',
            't-istoric-titlu-scurt': 'Toate Rezervările',
            't-rez-man': '📝 Adaugă Rezervare Manuală',
            't-rez-desc': '(Dacă e ocupată, sistemul blochează)',
            't-pt-ce-teren': 'Pentru ce teren?',
            't-nume': 'Nume Client (sau Telefon)',
            't-data-cal': 'Data calendaristică',
            't-ora': 'Ora',
            't-pret-incasat': 'Preț Încasat',
            't-btn-salv': '➕ Salvează',
            't-istoric-titlu': '📅 Lista Detaliată a Rezervărilor',
            't-istoric-btn': '🔄 Descarcă Rezervările',
            't-prog': '📋 Program & Disponibilitate',
            't-alege': 'Alege Terenul',
            't-data': 'Data Dorită',
            't-ora-th': 'Ora',
            't-status': 'Status',
            't-detalii': 'Client / Detalii',
            't-reincarca': '🔄 Reîncarcă Programul',
            't-inchis-admin': '⛔ Închis de Admin'
        },
        'hu': {
            't-logare': '🔐 Vezérlőpult Bejelentkezés',
            't-logout': 'Kijelentkezés',
            't-rez-man-scurt': 'Kézi Foglalás',
            't-prog-scurt': 'Program és Aktív',
            't-istoric-titlu-scurt': 'Összes Foglalás',
            't-rez-man': '📝 Kézi Foglalás Hozzáadása',
            't-rez-desc': '(Ha foglalt, a rendszer blokkolja)',
            't-pt-ce-teren': 'Melyik pályára?',
            't-nume': 'Ügyfél neve (vagy Telefon)',
            't-data-cal': 'Naptári dátum',
            't-ora': 'Óra',
            't-pret-incasat': 'Beszedett Ár',
            't-btn-salv': '➕ Mentés',
            't-istoric-titlu': '📅 Foglalások Részletes Listája',
            't-istoric-btn': '🔄 Foglalások Letöltése',
            't-prog': '📋 Program és Elérhetőség',
            't-alege': 'Válassz Pályát',
            't-data': 'Kívánt Dátum',
            't-ora-th': 'Óra',
            't-status': 'Állapot',
            't-detalii': 'Ügyfél / Részletek',
            't-reincarca': '🔄 Program Újratöltése',
            't-inchis-admin': '⛔ Admin által Zárva'
        }
    };

    const currentDict = dict[limba] || dict['ro'];
    document.querySelectorAll('[data-trad]').forEach(el => {
        const key = el.getAttribute('data-trad');
        if (currentDict[key]) el.innerText = currentDict[key];
    });

    if(typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram();
    if(typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
};

document.addEventListener('DOMContentLoaded', () => {
    window.setLangAdmin(window.lang);
});

// --- FUNCTII GLOBALE ---
window.comprimaImagine = function(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800; 
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) {
                    height = Math.round((height * MAX_WIDTH) / width);
                    width = MAX_WIDTH;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                resolve(base64);
            };
        };
        reader.onerror = error => reject(error);
    });
};

window.initializeazaTabel = function(terenuriArray) {
    const select = document.getElementById('tabel-teren');
    select.innerHTML = '';
    
    if (terenuriArray.length === 0) {
        select.innerHTML = '<option value="">Niciun teren alocat</option>';
        return;
    }
    
    terenuriArray.forEach(t => {
        select.innerHTML += `<option value="${window.escapeHtml(t)}">${window.escapeHtml(t)}</option>`;
    });
    
    const dataInput = document.getElementById('tabel-data');
    if (!dataInput.value) {
        dataInput.value = window.siteDate();
    }
    
    dataInput.addEventListener('change', window.incarcaTabelProgram);
    select.addEventListener('change', window.incarcaTabelProgram);
    window.incarcaTabelProgram();
};

window.incarcaTabelProgram = async function() {
    const terenAles = document.getElementById('tabel-teren').value;
    const dataInput = document.getElementById('tabel-data').value;
    const tbody = document.getElementById('tabel-corp-program');
    
    if (!terenAles || !dataInput) return;
    tbody.innerHTML = '<tr><td colspan="3" style="padding:15px; text-align:center;">Se Încarcă datele... ⏳</td></tr>';

    const d = new Date(dataInput);
    const zile = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
    const dataFormata = dataInput;

    const { data: rezervari, error } = await db.from('rezervari')
        .select('*')
        .eq('teren', terenAles)
        .eq('data_str', dataFormata)
        .neq('stare', 'anulata');

    let clientiAsociati = [];
    if (rezervari && rezervari.length > 0) {
        const emails = rezervari.map(r => r.email_client).filter(e => e !== 'Teren Blocat');
        if(emails.length > 0) {
            const { data: clientiDB } = await db.from('clienti').select('*').in('email', emails);
            if (clientiDB) clientiAsociati = clientiDB;
        }
    }

    const { data: infoTeren } = await db.from('terenuri').select('are_chat').eq('nume', terenAles).single();
    const terenAreChatActivat = infoTeren ? infoTeren.are_chat !== false : true;

    let html = '';
    const ore = ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];

    ore.forEach(ora => {
        const rGasita = rezervari ? rezervari.find(r => r.ora === ora) : null;
        
        let col1 = `<div style="font-size: 16px;">${ora}</div>`;
        let col2 = '';
        let col3 = '<span style="color:#888;">-</span>';
        let bg = 'transparent';

        if (rGasita) {
            const eBlocat = rGasita.email_client === 'Teren Blocat';
            bg = eBlocat ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.05)';
            
            col1 += `<br><button onclick="window.anulareDublaAdmin('${rGasita.id}', '${ora}')" style="background: #ef4444; color: white; border: none; padding: 4px 6px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-top: 8px; width: 100%;">❌ Anulează</button>`;

            col2 = `
                <select onchange="window.schimbaStareExistenta(this, '${rGasita.id}', '${ora}', '${window.escapeJs(terenAles)}', '${dataFormata}')" style="background: #1f2937; color: white; border: 1px solid ${eBlocat ? '#ef4444' : '#f59e0b'}; border-radius: 5px; padding: 6px; font-weight: bold; cursor: pointer; width: 100%;">
                    <option value="liber">LIBER</option>
                    <option value="ocupat" ${!eBlocat ? 'selected' : ''}>OCUPAT</option>
                    <option value="blocat" ${eBlocat ? 'selected' : ''}>BLOCAT</option>
                </select>
            `;

            if (eBlocat) {
                col3 = `<span style="color:#ef4444; font-weight:bold;">⛔ Închis de Admin</span>`;
            } else {
                let infoClient = rGasita.email_client;
                let contClient = clientiAsociati.find(c => c.email === rGasita.email_client);
                
                if (contClient) {
                    let cNume = contClient.nume ? `👤 Nume: ${window.escapeHtml(contClient.nume)}<br>` : '';
                    let cTel = contClient.telefon ? `📞 Tel: ${window.escapeHtml(contClient.telefon)}<br>` : '';
                    let cMail = `📧 Email: ${window.escapeHtml(contClient.email)}`;
                    infoClient = `${cNume}${cTel}${cMail}`;
                } else {
                    infoClient = `👤 Detalii (Manual): ${window.escapeHtml(rGasita.email_client)}`;
                }

                let chatBtnStr = "";
                if (terenAreChatActivat) {
                    const clientName = contClient ? (contClient.nume || contClient.email.split('@')[0]) : (rGasita.email_client.split('@')[0]);
                    const emailParam = contClient ? contClient.email : rGasita.email_client;
                    chatBtnStr = `<button class="btn-tabel-chat" onclick="deschideChatDinTabel('${window.escapeJs(emailParam)}', '${window.escapeJs(terenAles)}', '${window.escapeJs(clientName)}')" style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #3b82f6; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: bold; cursor: pointer; margin-left: 10px; transition: 0.3s; vertical-align: middle;">💬 Chat</button>`;
                }

                col3 = `<span style="color:white; font-size:13px; line-height:1.4;">${infoClient}</span> <br><div style="margin-top: 5px; display: flex; align-items: center;"><span style="font-size:12px; color:#aaa;">💰 ${window.escapeHtml(rGasita.pret_total)}</span>${chatBtnStr}</div>`;
            }
        } else {
            const oraId = ora.replace(':', '');
            col2 = `
                <select onchange="window.schimbaStareNoua(this, '${window.escapeJs(terenAles)}', '${dataFormata}', '${ora}')" id="select-stare-${oraId}" style="background: #1f2937; color: white; border: 1px solid #22c55e; border-radius: 5px; padding: 6px; font-weight: bold; cursor: pointer; width: 100%;">
                    <option value="liber" selected>LIBER</option>
                    <option value="ocupat">OCUPAT (Date ➔)</option>
                    <option value="blocat">BLOCAT</option>
                </select>
            `;

            col3 = `
                <div id="form-inline-${oraId}" style="display: none; flex-direction: column; gap: 5px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 5px; border: 1px dashed #f59e0b;">
                    <input type="text" id="inline-nume-${oraId}" placeholder="Nume Client / Telefon" style="padding: 6px; border-radius: 3px; border: 1px solid #444; background: #222; color: white; font-size: 12px; width: 100%; box-sizing: border-box;">
                    <input type="text" id="inline-pret-${oraId}" placeholder="Detalii" style="padding: 6px; border-radius: 3px; border: 1px solid #444; background: #222; color: white; font-size: 12px; width: 100%; box-sizing: border-box;">
                    <button onclick="window.salveazaRezervareInlineAdmin('${window.escapeJs(terenAles)}', '${dataFormata}', '${ora}')" style="background: #22c55e; color: black; border: none; padding: 6px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 12px;">✔️ Salvează Rezervarea</button>
                </div>
                <span id="text-liber-${oraId}" style="color:#888;">-</span>
            `;
        }

        html += `<tr style="background: ${bg}; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 12px; border-right: 1px solid rgba(255,255,255,0.05); font-weight: bold; color: #fff; width: 70px; text-align: center; vertical-align: middle;">${col1}</td>
                <td style="padding: 12px; border-right: 1px solid rgba(255,255,255,0.05); width: 140px; text-align: center; vertical-align: middle;">${col2}</td>
                <td style="padding: 12px; vertical-align: middle;">${col3}</td></tr>`;
    });
    tbody.innerHTML = html;
};

window.actualizeazaBifeTerenuri = async function() {
    const container = document.getElementById('container-checkbox-terenuri');
    if (!container) return;
    container.innerHTML = `
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="check-super-admin" value="ALL" style="margin-right: 5px; width: 20px; height: 20px; flex-shrink: 0;"> 👑 SUPER ADMIN (Acces Total)</label>
        <hr style="border-color: rgba(255,255,255,0.1); width: 100%; margin: 5px 0;">
    `;
    const { data } = await db.from('terenuri').select('nume, sport');
    if (data) {
        data.forEach(t => { container.innerHTML += `<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" class="check-teren-alocat" value="${window.escapeHtml(t.nume)}" style="margin-right: 5px; width: 20px; height: 20px; flex-shrink: 0;"> ${window.escapeHtml(t.nume)} (${window.escapeHtml(t.sport)})</label>`; });
    }
};

window.incarcaTerenuriAdmin = async function() {
    const container = document.getElementById('container-lista-terenuri');
    if (!container) return;
    container.innerHTML = "<p style='color: white;'>Se descarcă terenurile din cloud...</p>";
    
    const { data } = await db.from('terenuri').select('*');
    if (!data || data.length === 0) { container.innerHTML = "<p style='color: #ccc;'>Niciun teren adăugat.</p>"; return; }
    
    let html = "";
    data.forEach(t => {
        let textMinge = t.optiune_minge ? `Da (${t.pret_minge || 15} Lei)` : 'Nu';
        html += `
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; color: white; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="display: flex; gap: 15px; align-items: center;">
                    <img src="${window.escapeHtml(window.safeUrl(t.poza || 'assets/imagini/avatar2.png', true))}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 5px;">
                    <div>
                        <h4 style="margin: 0 0 5px 0; color: #f59e0b;">${window.escapeHtml(t.sport)} - ${window.escapeHtml(t.nume)}</h4>
                        <p style="margin: 0; font-size: 13px; color: #ccc;">Preț: ${t.pret} Lei/oră | Minge: ${textMinge}</p>
                    </div>
                </div>
                <button onclick="stergeTerenAdmin('${window.escapeJs(t.id)}')" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 5px; cursor: pointer;">❌ Șterge</button>
            </div>
        `;
    });
    container.innerHTML = html;
};

window.stergeTerenAdmin = async function(id) {
    if (confirm("Ești sigur? Acest teren va dispărea definitiv de pe site!")) {
        await db.from('terenuri').delete().eq('id', id);
        window.incarcaTerenuriAdmin();
        window.actualizeazaBifeTerenuri();
    }
};

window.anuleazaRezervareAdmin = async function(id) {
    if (confirm("Ești sigur că vrei să anulezi rezervarea? Ea va apărea marcată cu roșu în istoric.")) {
        const { error } = await db.from('rezervari').update({ stare: 'anulata' }).eq('id', id);
        if (!error) {
            if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
            if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram(); 
        }
        else if (error) alert("Eroare la anulare: " + error.message);
    }
};

// --- LOGICA PRINCIPALĂ A PAGINII ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-logout-admin')?.addEventListener('click', async () => {
        const { error } = await db.auth.signOut();
        if (error) return alert('Deconectarea a eșuat: ' + error.message);
        contLogatGlobal = null;
        localStorage.removeItem('admin_session');
        window.location.reload();
    });

    // NOU: Închide modalele cu tasta ESC în Admin
    document.addEventListener('keydown', function(event) {
        if (event.key === "Escape") {
            document.querySelectorAll('.modal').forEach(m => {
                m.style.display = 'none';
                if (m.id === 'modal-chat-admin') { const inp = document.getElementById('chat-admin-input'); if (inp) inp.value = ''; }
                if (m.id === 'modal-adauga-teren') { window.deschideModalAdaugaTeren(); m.style.display = 'none'; }
            });
        }
    });

    // --- PREVENIRE SCROLL FUNDAL (MUTATION OBSERVER PENTRU MODALE) ---
    const observerModaleAdmin = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'style') {
                const anyModalOpen = Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'flex' || m.style.display === 'block');
                if (anyModalOpen) {
                    document.body.classList.add('fara-scroll');
                } else {
                    document.body.classList.remove('fara-scroll');
                }
            }
        });
    });
    document.querySelectorAll('.modal').forEach(m => {
        observerModaleAdmin.observe(m, { attributes: true });
    });

    // NOU: Închide modalele când se dă click pe fundalul întunecat (în afara chenarului)
    document.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });

    document.getElementById('sectiune-login')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('login-admin-btn')?.click();
        }
    });

    document.getElementById('login-admin-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email-admin').value.trim().replace(/\.$/, '');
        const parola = document.getElementById('login-parola').value;
        if (!email || !parola) return alert("Introdu adresa de email și parola!");

        const btn = document.getElementById('login-admin-btn');
        const textVechi = btn.innerText;
        btn.innerText = "Se verifică securitatea...";
        btn.disabled = true;
        
        // 1. Verificare Auth Securizată
        const { data: authData, error: authError } = await db.auth.signInWithPassword({
            email: email,
            password: parola,
        });

        if (authError) {
            btn.innerText = textVechi; btn.disabled = false;
            return alert("⛔ Acces respins! Email sau parolă greșită.");
        }
        
        // 2. Extragere rol din tabelul users_admin pe baza email-ului
        const { data, error } = await db.from('users_admin').select('*').eq('user_id', authData.user.id).single();
        
        if (data && !error) {
            contLogatGlobal = data;
            document.getElementById('sectiune-login').style.display = 'none';
            document.getElementById('sectiune-dashboard').style.display = 'flex';
            document.getElementById('text-rol-activ').innerText = window.lang === 'hu' ? `Bejelentkezve mint: \n${contLogatGlobal.nume_admin}` : `Logat ca: ${contLogatGlobal.nume_admin}`;
            
            let terenuriPtTabel = []; 

            // NOUA LOGICĂ DE SHOW/HIDE PENTRU MENIU GRID
            let listaTerenuriAlocate = [];

            if (contLogatGlobal.is_super) {
                document.querySelectorAll('.super-admin-only').forEach(el => el.style.display = 'flex');
                document.querySelectorAll('.admin-comun').forEach(el => el.style.display = 'flex');
                
                window.incarcaTerenuriAdmin();
                window.actualizeazaBifeTerenuri(); 
                
                const { data: toate } = await db.from('terenuri').select('nume');
                if (toate) {
                    terenuriPtTabel = toate.map(t => t.nume);
                    listaTerenuriAlocate = terenuriPtTabel;
                }
            } else {
                document.querySelectorAll('.super-admin-only').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.admin-comun').forEach(el => el.style.display = 'flex');

                listaTerenuriAlocate = contLogatGlobal.terenuri ? contLogatGlobal.terenuri.split(',').map(n => n.trim()).filter(Boolean) : [];
                terenuriPtTabel = listaTerenuriAlocate.filter(n => n); 
            }

            const containerMeniu = document.getElementById('container-meniu-terenuri');
                const containerModale = document.getElementById('container-modale-terenuri');
                const selectManualTeren = document.getElementById('manual-teren');
                
                containerMeniu.innerHTML = ''; 
                containerModale.innerHTML = '';
                selectManualTeren.innerHTML = '';

                let htmlMeniu = "";
                let htmlModale = "";

                
                const oraseTerenuri = {};

                for (let numeT of listaTerenuriAlocate) {
                    if(!numeT) continue;
                    const { data: terenDB } = await db.from('terenuri').select('*').eq('nume', numeT).single();
                    if (terenDB) {
                        selectManualTeren.innerHTML += `<option value="${window.escapeHtml(terenDB.nume)}" data-sport="${window.escapeHtml(terenDB.sport)}">${window.escapeHtml(terenDB.nume)}</option>`;
                        
                        let orasul = terenDB.oras || 'Altele';
                        orasul = orasul.trim().replace(/\.+$/, ''); // STRIP TRAILING DOTS OVERALL
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
                    document.getElementById('container-meniu-terenuri').parentElement.style.display = ''; // Show main grila
                };

                // ESC listener for sub-pages
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        const activeSubPage = Array.from(document.querySelectorAll('.sub-pagina-oras')).find(p => p.style.display === 'block');
                        if (activeSubPage) {
                            window.inchideSubPaginaOras();
                        }
                    }
                });

                for (const oras in oraseTerenuri) {
                    const safeOras = oras.replace(/[^a-zA-Z0-9]/g, '') || 'Unknown';
                    
                    htmlMeniu += `
                        <div class="card-sport admin-comun" style="padding: 20px; display: flex;" onclick="document.getElementById('container-meniu-terenuri').parentElement.style.display='none'; document.getElementById('pagina-oras-${safeOras}').style.display='block';">
                            <h2 style="font-size: 18px;">⚙️<br><br>Setări Terenuri<br>${window.escapeHtml(oras)}</h2>
                        </div>
                    `;

                    let carduriTerenuri = '';
                    for (const terenDB of oraseTerenuri[oras]) {
                        let culoareTeren = terenDB.este_activ !== false ? '#3b82f6' : '#ef4444';
                        
                        carduriTerenuri += `
                            <div class="card-sport admin-comun" style="padding: 20px; display: flex;" onclick="document.getElementById('modal-setari-${terenDB.id}').style.display='flex'">
                                <h2 style="font-size: 18px;">⚙️<br><br>Setări<br>${window.escapeHtml(terenDB.nume)}</h2>
                            </div>
                        `;

                        htmlModale += `
                            <div class="modal" id="modal-setari-${terenDB.id}">
                                <div class="modal-continut modal-mare" style="border-color: ${culoareTeren}; width: 100%; max-width: 550px;">
                                    <button class="buton-inchidere" onclick="this.parentElement.parentElement.style.display='none'">X</button>
                                    <div>
                                        <h2 class="titlu-modal" style="font-size: 20px; text-align: left; color: ${culoareTeren};">⚙️ Setări (${window.escapeHtml(terenDB.nume)})</h2>
                                    </div>
                                    
                                    <div class="formular-auth" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; display: flex; flex-direction: column; flex: 1;">
                                        
                                        <div class="grup-input" style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1);">
                                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                                <label style="margin:0; font-weight:bold; color: ${terenDB.este_activ !== false ? '#22c55e' : '#ef4444'};">
                                                    ${terenDB.este_activ !== false ? '✅ Terenul este Vizibil' : '❌ Terenul este Ascuns'}
                                                </label>
                                                <input type="checkbox" id="activ-${terenDB.id}" ${terenDB.este_activ !== false ? 'checked' : ''} style="width:20px;height:20px; cursor:pointer;">
                                            </div>
                                            <p style="margin: 5px 0 0 0; font-size: 12px; color: #ccc;">Debifează pentru a ascunde complet terenul de clienți.</p>
                                        </div>

                                        <div class="grup-input" style="background: rgba(239, 68, 68, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(239, 68, 68, 0.3);">
                                            <label style="color: #ef4444; font-weight: bold; font-size: 15px;">🔒 Blochează / Deblochează o zi</label>
                                            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px;">
                                                <input type="date" id="data-blocare-${terenDB.id}" style="background: rgba(0,0,0,0.5); color: white; padding: 8px; border-radius: 5px; flex: 1; min-width: 120px;">
                                                <button type="button" onclick="blocheazaZiuaIntreaga('${window.escapeJs(terenDB.nume)}', '${window.escapeJs(terenDB.id)}', event)" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-weight: bold;">Închide</button>
                                                <button type="button" onclick="deblocheazaZiua('${window.escapeJs(terenDB.nume)}', '${window.escapeJs(terenDB.id)}', event)" style="background: #22c55e; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-weight: bold;">Deblochează</button>
                                            </div>
                                        </div>

                                        <div class="grup-input" style="margin-bottom: 15px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden; width: 100%; box-sizing: border-box;">
                                            <label style="margin-bottom: 8px; display: block; color: #a1eafb;">📷 Schimbă Poza Terenului</label>
                                            <div style="display: flex; gap: 10px; align-items: center; width: 100%;">
                                                <img src="${window.escapeHtml(window.safeUrl(terenDB.poza || 'assets/imagini/avatar2.png', true))}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0;">
                                                <input type="file" id="poza-${terenDB.id}" accept="image/*" style="background: rgba(0,0,0,0.5); color: white; padding: 8px; border-radius: 5px; flex: 1; min-width: 0; cursor: pointer; border: 1px dashed rgba(255,255,255,0.2);">
                                            </div>
                                        </div>

                                        <div class="grup-input" style="margin-bottom: 15px;"><label>Oraș</label><input type="text" id="oras-${terenDB.id}" value="${window.escapeHtml(terenDB.oras ? terenDB.oras.trim().replace(/\.+$/, '') : '')}" placeholder="Ex: București"></div>
                                        <div class="grup-input"><label>Preț Teren (Lei)</label><input type="number" id="pret-${terenDB.id}" value="${terenDB.pret}"></div>
                                        <div class="grup-input" style="display:flex; justify-content:space-between; margin-top:10px;"><label>Ofertă Minge?</label><input type="checkbox" id="minge-${terenDB.id}" ${terenDB.optiune_minge ? 'checked' : ''} style="width:20px;height:20px;"></div>
                                        <div class="grup-input" style="margin-top:10px;"><label>Preț Minge (Lei)</label><input type="number" id="pret-minge-${terenDB.id}" value="${terenDB.pret_minge || 15}"></div>
                                        <div class="grup-input" style="display:flex; justify-content:space-between; margin-top:10px; background: rgba(59, 130, 246, 0.1); padding: 10px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.3);">
                                            <label style="color: #a1eafb; font-weight: bold;">💬 Activează Chat (pt acest teren)</label>
                                            <input type="checkbox" id="are-chat-${terenDB.id}" ${terenDB.are_chat !== false ? 'checked' : ''} style="width:20px;height:20px; cursor: pointer;">
                                        </div>
                                        
                                        <div style="flex: 1;"></div>
                                        <button id="btn-save-${terenDB.id}" type="button" onclick="salveazaSetariTeren('${window.escapeJs(terenDB.id)}', '${window.escapeJs(terenDB.nume)}')" class="buton-rezervare" style="background: #3b82f6; margin-top: 15px;">💾 Salvează Setările pt ${window.escapeHtml(terenDB.nume)}</button>
                                        <button ${contLogatGlobal.is_super ? '' : 'hidden'} type="button" onclick="stergeTerenDublaConfirmare('${window.escapeJs(terenDB.id)}', '${window.escapeJs(terenDB.nume)}')" class="buton-rezervare" style="background: #ef4444; margin-top: 10px;">🗑️ Șterge Terenul</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }

                    const pageHtml = `
                        <div id="pagina-oras-${safeOras}" class="sub-pagina-oras" style="display: none; width: 100%; margin-top: 20px;">
                            <div style="display: flex; align-items: center; justify-content: flex-start; margin-bottom: 20px; width: 100%;">
                                <button class="btn-cont" onclick="window.inchideSubPaginaOras()">
                                    ⬅️ Înapoi
                                </button>
                                <h1 style="color: white; margin: 0; margin-left: 20px; font-size: 24px;">🌍 Terenuri din ${window.escapeHtml(oras)}</h1>
                            </div>
                            <div class="grila-sporturi" style="display: grid; gap: 20px;">
                                ${carduriTerenuri}
                            </div>
                        </div>
                    `;
                    subPagesContainer.innerHTML += pageHtml;
                }

                containerMeniu.innerHTML = htmlMeniu;
                containerModale.innerHTML = htmlModale;
                
                // Reatașează observerul pentru scroll pe noile modale create
                document.querySelectorAll('.modal').forEach(m => {
                    observerModaleAdmin.observe(m, { attributes: true });
                });
            
            // Reîncărcare automată tabel la selecție/login
            const selectM = document.getElementById('tabel-teren');
            if (selectM && terenuriPtTabel.length > 0) {
                window.initializeazaTabel(terenuriPtTabel);
            }

            // Chat real-time pentru admin
            setTimeout(() => { initializareRealtimeChatAdmin(); }, 1000);

        } else {
            alert("⛔ Ești logat, dar contul tău nu are profil de Admin setat în baza de date!");
            await db.auth.signOut();
        }
        btn.innerText = "Intră în Sistem";
        btn.disabled = false;
    });

    window.blocheazaZiuaIntreaga = async function(numeTeren, idTeren, event) {
        const dataInput = document.getElementById(`data-blocare-${idTeren}`).value;
        if (!dataInput) return alert("Alege o dată din calendar mai întâi!");
        const d = new Date(dataInput);
        const zile = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
        const dataFormata = dataInput;
        if (!confirm(`Ești sigur că blochezi complet terenul ${numeTeren} pe data de ${dataFormata}?`)) return;

        const btn = event.target; const textVechi = btn.innerText; btn.innerText = "Se blochează..."; btn.disabled = true;
        const ore = ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
        
        const { data: oreExistente } = await db.from('rezervari').select('ora').eq('teren', numeTeren).eq('data_str', dataFormata).neq('stare', 'anulata');
        const oreOcupate = oreExistente ? oreExistente.map(r => r.ora) : [];
        
        const oreDeBlocat = ore.filter(o => !oreOcupate.includes(o)).map(oraLibera => ({
            sport: "Blocat", teren: numeTeren, data_str: dataFormata, ora: oraLibera,
            pret_total: "0 Lei", email_client: "Teren Blocat", stare: 'activa', timestamp_start: Date.now()
        }));

        if (oreDeBlocat.length > 0) {
            const { error } = await db.from('rezervari').insert(oreDeBlocat);
            if (error) { alert("Eroare: " + error.message); btn.innerText = textVechi; btn.disabled = false; return; }
        }
        
        alert(`✅ Ziua a fost blocată!`); btn.innerText = textVechi; btn.disabled = false;
        if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin(); 
        if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram(); 
    };

    window.deblocheazaZiua = async function(numeTeren, idTeren, event) {
        const dataInput = document.getElementById(`data-blocare-${idTeren}`).value;
        if (!dataInput) return alert("Alege o dată!");
        const d = new Date(dataInput);
        const zile = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
        const dataFormata = dataInput;
        if (!confirm(`Deblochezi terenul ${numeTeren} pe ${dataFormata}?`)) return;

        const btn = event.target; const textVechi = btn.innerText; btn.innerText = "Așteaptă..."; btn.disabled = true;
        const { error } = await db.from('rezervari').delete().eq('teren', numeTeren).eq('data_str', dataFormata).eq('email_client', 'Teren Blocat');
        if (!error) { 
            alert(`✅ Ziua deblocată!`); 
            if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin(); 
            if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram(); 
        } 
        else alert("Eroare: " + error.message);
        btn.innerText = textVechi; btn.disabled = false;
    };

    window.salveazaSetariTeren = async function(idDB, numeTeren) {
        const btnSave = document.getElementById(`btn-save-${idDB}`);
        if(btnSave) { btnSave.innerText = "⏳ Se salvează..."; btnSave.disabled = true; }

        const pret = document.getElementById(`pret-${idDB}`).value;
        const minge = document.getElementById(`minge-${idDB}`).checked;
        const pretMinge = document.getElementById(`pret-minge-${idDB}`).value;
        const esteActiv = document.getElementById(`activ-${idDB}`).checked;
        const areChat = document.getElementById(`are-chat-${idDB}`) ? document.getElementById(`are-chat-${idDB}`).checked : true;
        const fileInput = document.getElementById(`poza-${idDB}`);

        let dateDeUpdatat = { pret: parseInt(pret), optiune_minge: minge, pret_minge: parseInt(pretMinge), este_activ: esteActiv, are_chat: areChat };

        if (fileInput && fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const ext = file.name.split('.').pop();
            const { data: currentAuth } = await db.auth.getUser();
            if (!currentAuth.user) { if (btnSave) btnSave.disabled = false; return alert('Autentifică-te din nou.'); }
            const fileName = `${currentAuth.user.id}/${crypto.randomUUID()}.${ext}`;
            
            const { error: uploadError } = await db.storage.from('poze_terenuri').upload(fileName, file);
                
            if (uploadError) {
                if(btnSave) { btnSave.innerText = `💾 Salvează Setările pt ${numeTeren}`; btnSave.disabled = false; }
                return alert("Eroare la urcarea pozei: " + uploadError.message);
            }
            
            const { data: publicUrlData } = db.storage.from('poze_terenuri').getPublicUrl(fileName);
            dateDeUpdatat.poza = publicUrlData.publicUrl;
        }

        const { error } = await db.from('terenuri').update(dateDeUpdatat).eq('id', idDB);
        
        if (!error) { alert(`✅ Setări salvate!`); document.getElementById('login-admin-btn').click(); }
        else alert("Eroare: " + error.message);
        
        if(btnSave) { btnSave.innerText = `💾 Salvează Setările pt ${numeTeren}`; btnSave.disabled = false; }
    };

    document.getElementById('btn-rezervare-manuala')?.addEventListener('click', async () => {
        const selectBox = document.getElementById('manual-teren');
        const terenAles = selectBox.value;
        const sportAles = selectBox.options[selectBox.selectedIndex].getAttribute('data-sport');
        const client = document.getElementById('manual-client').value.trim().replace(/\.$/, '');
        const dataInput = document.getElementById('manual-data').value;
        const oraAlesa = document.getElementById('manual-ora').value;
        const pret = document.getElementById('manual-pret').value.trim().replace(/\.$/, '');
        
        if (!client || !dataInput || !pret) return alert("Completează câmpurile!");
        const d = new Date(dataInput);
        const zile = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
        const dataFormata = dataInput;

        document.getElementById('btn-rezervare-manuala').innerText = "Se verifică...";
        const { data: dublura } = await db.from('rezervari').select('id').eq('teren', terenAles).eq('data_str', dataFormata).eq('ora', oraAlesa).neq('stare', 'anulata');
        if (dublura && dublura.length > 0) {
            document.getElementById('btn-rezervare-manuala').innerText = window.lang === 'hu' ? "➕ Mentés" : "➕ Salvează";
            return alert(`❌ Ora ${oraAlesa} pe ${dataFormata} este rezervată!`);
        }

        const { error } = await db.from('rezervari').insert([{
            sport: sportAles, teren: terenAles, data_str: dataFormata, ora: oraAlesa,
            pret_total: pret + (window.lang === 'hu' ? " RON (Kézi)" : " Lei (Manual)"), email_client: client, stare: 'activa', timestamp_start: Date.now()
        }]);
        if (!error) { 
            alert("✅ Rezervare adăugată!"); 
            if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin(); 
            if (typeof window.incarcaTabelProgram === 'function') window.incarcaTabelProgram(); 
        } 
        else alert("Eroare: " + error.message);
        document.getElementById('btn-rezervare-manuala').innerText = window.lang === 'hu' ? "➕ Mentés" : "➕ Salvează";
    });

        window.deschideModalAdaugaTeren = function() {
        document.getElementById('teren-nume').value = '';
        const inputOras = document.getElementById('teren-oras');
        if (inputOras) inputOras.value = '';
        document.getElementById('teren-pret').value = '';
        document.getElementById('teren-locatie').value = '';
        document.getElementById('teren-poza').value = '';
        document.getElementById('modal-adauga-teren').style.display = 'flex';
    };

    document.getElementById('btn-adauga-teren')?.addEventListener('click', async () => {
        const nume = document.getElementById('teren-nume').value.trim().replace(/\.$/, '');
        const sport = document.getElementById('teren-sport').value;
        const oras = document.getElementById('teren-oras') ? document.getElementById('teren-oras').value.trim().replace(/\.$/, '') : '';
        const pret = document.getElementById('teren-pret').value.trim().replace(/\.$/, '');
        const minge = document.getElementById('teren-minge').checked;
        const pretMinge = document.getElementById('teren-pret-minge').value.trim().replace(/\.$/, '');
        const locatie = document.getElementById('teren-locatie').value.trim().replace(/\.$/, '');
        const fileInput = document.getElementById('teren-poza');

        if (!nume || !pret || !locatie) return alert("Completează câmpurile!");
        const btn = document.getElementById('btn-adauga-teren'); btn.innerText = "⏳ Se salvează..."; btn.disabled = true;

        let urlPoza = null;
        if (fileInput && fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const ext = file.name.split('.').pop();
            const { data: currentAuth } = await db.auth.getUser();
            if (!currentAuth.user) { btn.disabled = false; return alert('Autentifică-te din nou.'); }
            const fileName = `${currentAuth.user.id}/${crypto.randomUUID()}.${ext}`;
            
            // Urcăm fișierul fizic în Storage (Bucket: poze_terenuri)
            const { data: uploadData, error: uploadError } = await db.storage
                .from('poze_terenuri')
                .upload(fileName, file);
                
            if (uploadError) {
                alert("Eroare la urcarea pozei: " + uploadError.message);
                btn.innerText = "➕ Adaugă Teren"; btn.disabled = false; 
                return;
            }
            
            // Extragem link-ul public către poză
            const { data: publicUrlData } = db.storage.from('poze_terenuri').getPublicUrl(fileName);
            urlPoza = publicUrlData.publicUrl;
        }

        const { error } = await db.from('terenuri').insert([{
            nume, sport, oras, pret: parseInt(pret), optiune_minge: minge, pret_minge: parseInt(pretMinge), locatie, poza: urlPoza, este_activ: true
        }]);
        
        if (error) alert("❌ Eroare DB: " + error.message);
        else { alert("✅ Teren adăugat!"); document.getElementById('modal-adauga-teren').style.display='none'; window.incarcaTerenuriAdmin(); window.actualizeazaBifeTerenuri(); }
        btn.innerText = "➕ Adaugă Teren"; btn.disabled = false;
    });

    document.getElementById('creeaza-supervisor-btn')?.addEventListener('click', async () => {
        const nume = document.getElementById('super-nume').value.trim().replace(/\.$/, '');
        const email = document.getElementById('super-email').value.trim().replace(/\.$/, '');
        const esteSuper = document.getElementById('check-super-admin').checked;
        const listaTerenuri = Array.from(document.querySelectorAll('.check-teren-alocat:checked')).map(cb => cb.value).join(','); 

        if (!nume || !email) return alert("Completează numele și adresa de mail!");
        if (!esteSuper && listaTerenuri === "") return alert("Bifează măcar un teren!");

        const btn = document.getElementById('creeaza-supervisor-btn'); btn.innerText = "Se verifică...";
        
        // Verifică dacă adresa e deja alocată
        const { data: verificare } = await db.from('users_admin').select('id').eq('email', email);
        if (verificare && verificare.length > 0) { btn.innerText = "Alocă Terenuri"; return alert("❌ Acest E-mail este deja alocat unui angajat/admin!"); }

        const { error } = await db.from('users_admin').insert([{ nume_admin: nume, email: email, is_super: esteSuper, terenuri: esteSuper ? "ALL" : listaTerenuri }]);
        if (!error) { 
            alert(`✅ Rol și terenuri alocate pentru contul Auth existent: ${email}.`);
            document.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false); 
            document.getElementById('super-nume').value = "";
            document.getElementById('super-email').value = "";
            document.getElementById('modal-creeaza-cont').style.display = 'none';
        } else {
            alert("Eroare: " + error.message);
        }
        btn.innerText = "Alocă Terenuri";
    });

    window.reincarcaIstoricAdmin = async function() {
        const container = document.getElementById('container-istoric');
        if (!container) return;
        container.style.display = 'flex'; // Lista verticala cu scroll interior
        container.innerHTML = "<p style='color: white; text-align: center;'>Se descarcă rezervările... ⏳</p>";
        
        // Preluăm clienții pentru a corela datele (nume, telefon) cu rezervările web
        const { data: clientiDB } = await db.from('clienti').select('*');
        const totiClientii = clientiDB || [];

        const { data, error } = await db.from('rezervari').select('*');
        if (error || !data || data.length === 0) { container.innerHTML = "<p style='color: white;'>Nu există nicio rezervare în sistem.</p>"; return; }

        data.sort((a, b) => b.id - a.id);
        let html = ""; let rezervariGasite = 0;

        const terenurileLui = contLogatGlobal.is_super ? [] : (contLogatGlobal.terenuri ? contLogatGlobal.terenuri.split(',').map(n => n.trim()).filter(Boolean) : []);
        const acum = new Date();

        const txtActiva = window.lang === 'hu' ? 'AKTÍV' : 'ACTIVĂ';
        const txtAnulata = window.lang === 'hu' ? 'TÖRÖLVE' : 'ANULATĂ';
        const txtBlocata = window.lang === 'hu' ? 'ZÁRVA' : 'ZI BLOCATĂ';
        const txtFinalizata = window.lang === 'hu' ? 'BEFEJEZVE' : 'FINALIZATĂ';
        const txtCand = window.lang === 'hu' ? 'Mikor' : 'Când';
        const txtPret = window.lang === 'hu' ? 'Ár' : 'Preț';
        const txtBtnAnuleaza = window.lang === 'hu' ? '❌ Törlés' : '❌ Anulează';

        data.forEach(r => {
            if (!contLogatGlobal.is_super && !terenurileLui.includes(r.teren)) return;
            rezervariGasite++;

            const esteTrecuta = window.bookingEnded(r.data_str, r.ora);

            const eAnulata = r.stare === 'anulata';
            const eBlocaj = r.email_client === 'Teren Blocat';

            let culoareBorder = '#444'; let culoareTitlu = '#22c55e';
            let textStare = `<span style="color: #22c55e; font-weight: bold;">[${txtActiva}]</span>`;
            let butonAnulare = ''; let opacitate = '1';

            if (eAnulata) { culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; opacitate = '0.7'; textStare = `<span style="color: #ef4444; font-weight: bold;">[${txtAnulata}]</span>`; } 
            else if (eBlocaj) { culoareBorder = '#ef4444'; culoareTitlu = '#ef4444'; textStare = `<span style="color: #ef4444; font-weight: bold;">[${txtBlocata}]</span>`; } 
            else if (esteTrecuta) { culoareBorder = '#6b7280'; culoareTitlu = '#9ca3af'; opacitate = '0.85'; textStare = `<span style="color: #9ca3af; font-weight: bold;">[${txtFinalizata}]</span>`; } 
            else { butonAnulare = `<button onclick="anuleazaRezervareAdmin('${window.escapeJs(r.id)}')" style="margin-top: 10px; background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; width: 100%;">${txtBtnAnuleaza}</button>`; }

            const dataTradusa = (typeof window.traduData === 'function') ? window.traduData(r.data_str) : r.data_str;

            let textClientAfisat = r.email_client;
            let contGasit = totiClientii.find(c => c.email === r.email_client);
            
            if (contGasit) {
                let infoClientList = [];
                if(contGasit.nume) infoClientList.push(`Nume: ${window.escapeHtml(contGasit.nume)}`);
                if(contGasit.telefon) infoClientList.push(`Tel: ${window.escapeHtml(contGasit.telefon)}`);
                infoClientList.push(`Email: ${window.escapeHtml(contGasit.email)}`);
                textClientAfisat = infoClientList.join(' | ');
            } else if (!eBlocaj) {
                textClientAfisat = `${window.escapeHtml(r.email_client)} (Manual)`;
            } else {
                textClientAfisat = "Sistem Blocare";
            }

            html += `
                <div style="background: rgba(255,255,255,0.1); border: 1px solid ${culoareBorder}; padding: 15px; margin: 0; border-radius: 8px; color: white; opacity: ${opacitate}; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0 0 10px 0; color: ${culoareTitlu};">⚽ ${window.escapeHtml(r.sport)} - ${window.escapeHtml(r.teren)} ${textStare}</h4>
                        <p style="margin: 5px 0;"><strong>📅 ${txtCand}:</strong> ${dataTradusa} ( ${r.ora} )</p>
                        <p style="margin: 5px 0; font-size: 13px;"><strong>👤 Client:</strong> ${textClientAfisat}</p>
                        <p style="margin: 5px 0;"><strong>💰 ${txtPret}:</strong> ${window.escapeHtml(r.pret_total)}</p>
                    </div>
                    ${butonAnulare}
                </div>`;
        });
        
        container.innerHTML = rezervariGasite === 0 ? "<p style='color: white;'>Nu există date.</p>" : html;
    };
    
    document.getElementById('btn-istoric')?.addEventListener('click', window.reincarcaIstoricAdmin);

    // ==========================================
    // LOGICĂ CHAT ADMIN
    // ==========================================
    let chatAdminRealtime = null;
    let chatAdminMesajeToate = [];
    let chatAdminConversatieCurenta = null; // Un obiect { email_client, teren }
    
    const btnVeziChatAdmin = document.getElementById('btn-vezi-chat-admin');
    const modalChatAdmin = document.getElementById('modal-chat-admin');
    const inputChatAdmin = document.getElementById('chat-admin-input');
    const btnTrimiteChatAdmin = document.getElementById('chat-admin-btn-trimite');

    btnVeziChatAdmin?.addEventListener('click', () => {
        modalChatAdmin.style.display = 'flex';
        incarcaMesajeAdmin();
    });

    async function initializareRealtimeChatAdmin() {
        if (chatAdminRealtime) db.removeChannel(chatAdminRealtime);
        if (!contLogatGlobal) return;
        
        await incarcaMesajeAdmin(false); 
        
        // Adminul primește notificări pentru orice mesaj legat de terenurile lui
        chatAdminRealtime = db.channel('mesaje_chat_admin')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mesaje_chat' }, payload => {
                const terenMesaj = payload.new ? payload.new.teren : null;
                const terenurileAdmin = contLogatGlobal.is_super ? [] : (contLogatGlobal.terenuri ? contLogatGlobal.terenuri.split(',').map(n => n.trim()).filter(Boolean) : []);
                
                // Dacă adminul e superadmin SAU are acces la terenul din mesaj
                if (contLogatGlobal.is_super || terenurileAdmin.includes(terenMesaj)) {
                    if (modalChatAdmin && modalChatAdmin.style.display === 'flex') {
                        incarcaMesajeAdmin();
                    } else {
                        if (payload.new && payload.new.expeditor === 'client' && payload.new.citit === false) {
                            const bulina = document.getElementById('bulina-chat-admin');
                            if (bulina) {
                                bulina.style.display = 'block';
                                bulina.innerText = parseInt(bulina.innerText || 0) + 1;
                            }
                        }
                    }
                }
            })
            .subscribe();
    }

    async function incarcaMesajeAdmin(randeaza = true) {
        if (!contLogatGlobal) return;
        
        let query = db.from('mesaje_chat').select('*').order('created_at', { ascending: true });
        
        if (!contLogatGlobal.is_super) {
            const terenurileAdmin = contLogatGlobal.terenuri ? contLogatGlobal.terenuri.split(',').map(n => n.trim()).filter(Boolean) : [];
            query = query.in('teren', terenurileAdmin);
        }

        const { data, error } = await query;
        if (error) { console.error("Eroare chat admin: ", error); return; }
        
        chatAdminMesajeToate = data || [];
        
        const nrNecitite = chatAdminMesajeToate.filter(m => m.expeditor === 'client' && m.citit === false).length;
        const bulina = document.getElementById('bulina-chat-admin');
        if (bulina) {
            bulina.style.display = nrNecitite > 0 ? 'block' : 'none';
            bulina.innerText = nrNecitite;
        }

        if (randeaza) randeazaListaConversatiiAdmin();
    }

    async function randeazaListaConversatiiAdmin() {
        const listaSide = document.getElementById('chat-admin-lista-conversații');
        if (!listaSide) return;
        
        // Grupăm conversațiile unice prin combinația (email_client + teren)
        const conversatiiUniceMap = new Map();
        
        chatAdminMesajeToate.forEach(m => {
            const cheie = `${m.email_client}|${m.teren}`;
            if (!conversatiiUniceMap.has(cheie)) {
                conversatiiUniceMap.set(cheie, { email: m.email_client, teren: m.teren, mesaje: [] });
            }
            conversatiiUniceMap.get(cheie).mesaje.push(m);
        });

        const conversatii = Array.from(conversatiiUniceMap.values());
        
        // Sortăm conversațiile astfel încât cele cu mesaje necitite să fie sus, apoi după data ultimului mesaj
        conversatii.sort((a, b) => {
            const aNecitite = a.mesaje.some(m => m.expeditor === 'client' && !m.citit);
            const bNecitite = b.mesaje.some(m => m.expeditor === 'client' && !m.citit);
            if (aNecitite && !bNecitite) return -1;
            if (!aNecitite && bNecitite) return 1;
            
            const ultimaDataA = new Date(a.mesaje[a.mesaje.length - 1].created_at).getTime();
            const ultimaDataB = new Date(b.mesaje[b.mesaje.length - 1].created_at).getTime();
            return ultimaDataB - ultimaDataA;
        });

        if (conversatii.length === 0) {
            listaSide.innerHTML = '<p style="color: #ccc; font-size: 13px; text-align: center;">Nu există mesaje.</p>';
            return;
        }

        // Preluăm clienții pentru a le afișa numele real
        const { data: clientiDB } = await db.from('clienti').select('email, nume');
        const clienti = clientiDB || [];

        listaSide.innerHTML = '';
        
        for (const conv of conversatii) {
            const ultimulMesaj = conv.mesaje[conv.mesaje.length - 1].mesaj;
            const areNecitite = conv.mesaje.some(m => m.expeditor === 'client' && m.citit === false);
            
            const contGasit = clienti.find(c => c.email === conv.email);
            const numeAfisat = contGasit && contGasit.nume ? contGasit.nume : conv.email.split('@')[0];
            
            const card = document.createElement('div');
            card.className = `card-conversatie ${areNecitite ? 'necitit' : ''}`;
            
            const esteSelectat = chatAdminConversatieCurenta && chatAdminConversatieCurenta.email === conv.email && chatAdminConversatieCurenta.teren === conv.teren;
            if (esteSelectat) card.style.borderColor = 'white';
            
            card.innerHTML = `
                <h4>👤 ${window.escapeHtml(numeAfisat)} <span style="font-size: 11px; color:#aaa; font-weight:normal;">(${window.escapeHtml(conv.teren)})</span></h4>
                <p>${window.escapeHtml(ultimulMesaj)}</p>
            `;
            
            card.addEventListener('click', () => {
                chatAdminConversatieCurenta = { email: conv.email, teren: conv.teren, nume: numeAfisat };
                randeazaListaConversatiiAdmin(); 
                deschideConversatiaAdmin();
            });
            
            listaSide.appendChild(card);
        }
        
        if (chatAdminConversatieCurenta) {
            deschideConversatiaAdmin();
        }
    }

    window.deschideChatDinTabel = function(email, teren, nume) {
        // 1. Închide modalul de tabel și setări (dacă e deschis vreunul)
        document.querySelectorAll('.modal').forEach(m => {
            if (m.id !== 'modal-chat-admin') m.style.display = 'none';
                if (m.id === 'modal-chat-admin') { const inp = document.getElementById('chat-admin-input'); if (inp) inp.value = ''; }
                if (m.id === 'modal-adauga-teren') { window.deschideModalAdaugaTeren(); m.style.display = 'none'; }
        });
        
        // 2. Setează starea conversației curente
        chatAdminConversatieCurenta = { email: email, teren: teren, nume: nume };
        
        // 3. Deschide modalul de chat
        const modalChat = document.getElementById('modal-chat-admin');
        if (modalChat) modalChat.style.display = 'flex';
        
        // 4. Forțează starea expandată (Instagram style desktop / mobile active)
        const modalBox = document.querySelector('#modal-chat-admin .modal-chat-box');
        if (modalBox) modalBox.classList.add('conversatie-activa');
        
        // 5. Randează lista din stânga (ca să reflecte selecția)
        randeazaListaConversatiiAdmin();
        
        // 6. Încarcă și afișează mesajele din dreapta
        deschideConversatiaAdmin();
    };

    async function deschideConversatiaAdmin() {
        const inp = document.getElementById('chat-admin-input'); if (inp) inp.value = '';
        if (!chatAdminConversatieCurenta) return;
        
        document.getElementById('chat-admin-conversație-titlu').style.display = 'block';
        document.getElementById('chat-admin-conversație-titlu').innerText = `Chat cu ${chatAdminConversatieCurenta.nume} (${chatAdminConversatieCurenta.teren})`;
        
        const modalBox = document.querySelector('#modal-chat-admin .modal-chat-box');
        if (modalBox) modalBox.classList.add('conversatie-activa');

        const container = document.getElementById('chat-admin-mesaje');
        container.innerHTML = '';
        
        const mesaje = chatAdminMesajeToate.filter(m => m.email_client === chatAdminConversatieCurenta.email && m.teren === chatAdminConversatieCurenta.teren);
        let idUriDeMarcat = [];

        mesaje.forEach(m => {
            const bula = document.createElement('div');
            const dataObj = new Date(m.created_at);
            const dataOraFormata = `${dataObj.getDate().toString().padStart(2, '0')}.${(dataObj.getMonth() + 1).toString().padStart(2, '0')} ${dataObj.getHours().toString().padStart(2, '0')}:${dataObj.getMinutes().toString().padStart(2, '0')}`;
            
            if (m.expeditor === 'admin') {
                bula.className = 'mesaj-bula mesaj-trimis';
                let culoareBife = m.citit ? 'bife-albastre' : 'bife-gri';
                bula.innerHTML = `${window.escapeHtml(m.mesaj)} <span class="mesaj-timestamp">${dataOraFormata} <span class="bife-citit ${culoareBife}">✓✓</span></span>`;
            } else {
                bula.className = 'mesaj-bula mesaj-primit';
                bula.innerHTML = `${window.escapeHtml(m.mesaj)} <span class="mesaj-timestamp">${dataOraFormata}</span>`;
                if (!m.citit) idUriDeMarcat.push(m.id);
            }
            container.appendChild(bula);
        });

        container.scrollTop = container.scrollHeight;

        if (idUriDeMarcat.length > 0) {
            await db.from('mesaje_chat').update({ citit: true }).in('id', idUriDeMarcat);
        }

        inputChatAdmin.disabled = false;
        btnTrimiteChatAdmin.disabled = false;

        const btnStergeChat = document.getElementById('chat-admin-btn-sterge');
        if (btnStergeChat) {
            btnStergeChat.style.display = 'block';
            btnStergeChat.onclick = async () => {
                const conf = confirm(`Ești sigur că vrei să ștergi TOATE mesajele din conversația cu ${chatAdminConversatieCurenta.nume} (${chatAdminConversatieCurenta.teren})?\n\nAcest lucru va șterge mesajele și pentru client!`);
                if (conf) {
                    btnStergeChat.disabled = true;
                    btnStergeChat.style.opacity = '0.5';
                    const { error } = await db.from('mesaje_chat')
                        .delete()
                        .eq('email_client', chatAdminConversatieCurenta.email)
                        .eq('teren', chatAdminConversatieCurenta.teren);
                    
                    if (error) {
                        alert("Eroare la ștergere: " + error.message);
                    } else {
                        chatAdminConversatieCurenta = null;
                        document.getElementById('chat-admin-conversație-titlu').style.display = 'none';
                        container.innerHTML = '<p style="color: #ccc; text-align: center; margin-top: auto; margin-bottom: auto;">Conversație ștearsă.</p>';
                        inputChatAdmin.disabled = true;
                        btnTrimiteChatAdmin.disabled = true;
                        btnStergeChat.style.display = 'none';
                        incarcaMesajeAdmin();
                    }
                    btnStergeChat.disabled = false;
                    btnStergeChat.style.opacity = '1';
                }
            };
        }
    }

    async function trimiteMesajAdmin() {
        if (!chatAdminConversatieCurenta || inputChatAdmin.disabled) return;
        const text = inputChatAdmin.value.trim().replace(/\.$/, '');
        if (!text) return;

        inputChatAdmin.disabled = true;
        btnTrimiteChatAdmin.disabled = true;

        const { error } = await db.from('mesaje_chat').insert([{
            email_client: chatAdminConversatieCurenta.email,
            teren: chatAdminConversatieCurenta.teren,
            expeditor: 'admin',
            mesaj: text,
            citit: false
        }]);

        if (error) alert("Eroare la trimitere: " + error.message);
        else inputChatAdmin.value = '';

        inputChatAdmin.disabled = false;
        btnTrimiteChatAdmin.disabled = false;
        inputChatAdmin.focus();
    }

    btnTrimiteChatAdmin?.addEventListener('click', trimiteMesajAdmin);
    inputChatAdmin?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') trimiteMesajAdmin();
    });

    document.getElementById('btn-inapoi-conversatie-admin')?.addEventListener('click', () => {
        chatAdminConversatieCurenta = null;
        const modalBox = document.querySelector('#modal-chat-admin .modal-chat-box');
        if (modalBox) modalBox.classList.remove('conversatie-activa');
        randeazaListaConversatiiAdmin();
        
        document.getElementById('chat-admin-conversație-titlu').style.display = 'none';
        const container = document.getElementById('chat-admin-mesaje');
        container.innerHTML = '<p style="color: #ccc; text-align: center; margin-top: auto; margin-bottom: auto;">Selectează un client din stânga pentru a vedea mesajele.</p>';
        const btnSterge = document.getElementById('btn-sterge-chat-admin');
        if (btnSterge) btnSterge.style.display = 'none';
        if (inputChatAdmin) { inputChatAdmin.value = ''; inputChatAdmin.disabled = true; }
        if (btnTrimiteChatAdmin) btnTrimiteChatAdmin.disabled = true;
    });

    const originalLoginAdminBtn = document.getElementById('login-admin-btn');
    if (originalLoginAdminBtn) {
        originalLoginAdminBtn.addEventListener('click', () => {
            setTimeout(() => { if (contLogatGlobal) initializareRealtimeChatAdmin(); }, 1500);
        });
    }

});


window.blocheazaOraSinguraAdmin = async function(numeTeren, dataFormata, ora) {
    if (!confirm(`Blochezi ora ${ora} pentru terenul ${numeTeren}?`)) return;

    const { data: verif } = await db.from('rezervari').select('id').eq('teren', numeTeren).eq('data_str', dataFormata).eq('ora', ora).neq('stare', 'anulata');
    if (verif && verif.length > 0) {
        alert("Eroare: Ora a fost rezervata intre timp de altcineva!");
        window.incarcaTabelProgram();
        return;
    }

    const deBlocat = {
        sport: "Blocat", 
        teren: numeTeren, 
        data_str: dataFormata, 
        ora: ora,
        pret_total: "0 Lei", 
        email_client: "Teren Blocat", 
        stare: 'activa', 
        timestamp_start: Date.now()
    };
    
    const { error } = await db.from('rezervari').insert([deBlocat]);
    
    if (error) {
        alert("Eroare la blocare: " + error.message);
    } else {
        window.incarcaTabelProgram(); 
        if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
    }
};

window.schimbaStareNoua = function(select, teren, data, ora) {
    const val = select.value;
    const oraId = ora.replace(':', '');
    const form = document.getElementById('form-inline-' + oraId);
    const txtLiber = document.getElementById('text-liber-' + oraId);

    if (val === 'ocupat') {
        form.style.display = 'flex';
        txtLiber.style.display = 'none';
        select.style.borderColor = '#f59e0b';
    } else if (val === 'blocat') {
        form.style.display = 'none';
        txtLiber.style.display = 'inline-block';
        select.style.borderColor = '#ef4444';
        window.blocheazaOraSinguraAdmin(teren, data, ora);
        select.value = 'liber'; 
    } else {
        form.style.display = 'none';
        txtLiber.style.display = 'inline-block';
        select.style.borderColor = '#22c55e';
    }
};

window.schimbaStareExistenta = async function(select, idRez, ora, teren, data) {
    const val = select.value;
    if (val === 'liber') {
        window.anulareDublaAdmin(idRez, ora);
    } else if (val === 'blocat') {
        if(confirm('Transformi aceasta rezervare in BLOCAT?')) {
            await db.from('rezervari').update({ email_client: 'Teren Blocat' }).eq('id', idRez);
            window.incarcaTabelProgram();
        } else {
            window.incarcaTabelProgram();
        }
    } else if (val === 'ocupat') {
        alert('Pentru a rezerva un teren blocat, te rog trece-l pe LIBER mai intai!');
        window.incarcaTabelProgram();
    }
};

window.anulareDublaAdmin = async function(idRez, ora) {
    if (confirm('Pasul 1: Esti sigur ca vrei sa anulezi ora ' + ora + '?')) {
        setTimeout(async () => {
            if (confirm('Pasul 2 (Confirmare Finala): ESTI ABSOLUT SIGUR ca anulezi ora ' + ora + ' si o eliberezi?')) {
                const { error } = await db.from('rezervari').update({ stare: 'anulata' }).eq('id', idRez);
                if (!error) {
                    window.incarcaTabelProgram();
                    if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
                } else {
                    alert('Eroare la anulare: ' + error.message);
                }
            } else {
                window.incarcaTabelProgram();
            }
        }, 300);
    } else {
        window.incarcaTabelProgram();
    }
};

window.salveazaRezervareInlineAdmin = async function(teren, data, ora) {
    const oraId = ora.replace(':', '');
    const nume = document.getElementById('inline-nume-' + oraId).value.trim().replace(/\.$/, '');
    const pret = document.getElementById('inline-pret-' + oraId).value.trim().replace(/\.$/, '');

    if (!nume) {
        alert('Introdu un Nume / Telefon pentru a rezerva!');
        return;
    }

    const { data: verif } = await db.from('rezervari').select('id').eq('teren', teren).eq('data_str', data).eq('ora', ora).neq('stare', 'anulata');
    if (verif && verif.length > 0) {
        alert('Eroare: Ora a fost rezervata intre timp!');
        window.incarcaTabelProgram();
        return;
    }

    const { error } = await db.from('rezervari').insert([{
        sport: '-', 
        teren: teren, 
        data_str: data, 
        ora: ora,
        pret_total: pret ? pret : 'Platit / Custom', 
        email_client: nume, 
        stare: 'activa', 
        timestamp_start: Date.now()
    }]);

    if (!error) {
        window.incarcaTabelProgram();
        if (typeof window.reincarcaIstoricAdmin === 'function') window.reincarcaIstoricAdmin();
    } else {
        alert('Eroare: ' + error.message);
    }
};

window.stergeTerenDublaConfirmare = async function(idDB, numeTeren) {
    const prima = confirm(`Ești sigur că vrei să ștergi DEFINITIV terenul "${numeTeren}"?\nAceastă acțiune nu poate fi anulată!`);
    if (!prima) return;

    const aDoua = confirm(`ATENȚIE MAXIMĂ!\nȘtergerea acestui teren va afecta toate rezervările asociate.\nEști 100% sigur că vrei să-l ștergi complet din baza de date?`);
    if (!aDoua) return;

    const { error } = await db.from('terenuri').delete().eq('id', idDB);
    
    if (error) {
        alert("Eroare la ștergerea terenului: " + error.message);
    } else {
        alert("Terenul a fost șters cu succes!");
        const mod = document.getElementById("modal-setari-" + idDB);
        if (mod) mod.style.display = 'none';
        window.incarcaTerenuriAdmin();
        window.actualizeazaBifeTerenuri();
    }
};
