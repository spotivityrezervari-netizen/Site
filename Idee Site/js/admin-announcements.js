/* Superadmin composer. SQL authorizes every operation; no transport secrets reach this file. */
(() => {
    'use strict';
    const imageBucket = 'announcement_images';
    const imageOrigin = 'https://ndubcdwohqzgxpuiowye.supabase.co/storage/v1/object/public/announcement_images/';
    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    const label = audience => audience === 'admins' ? 'administratori' : 'clienți';
    window.createAnnouncementPanel = function(db) {
        const workspace = document.getElementById('base-admin-workspace');
        const tools = workspace?.querySelector('.base-admin-tools');
        if (!tools || document.getElementById('btn-admin-announcements')) return null;
        let role = null, generation = 0, view = 0, busy = false, ready = false, preview = null;
        let draft = null, history = [], timer = null, previousFocus = null, historyRequest = 0;
        const button = node('button', 'card-sport admin-menu-card');
        button.id = 'btn-admin-announcements'; button.type = 'button'; button.hidden = true;
        button.append(node('h2', '', 'Setări emailuri'), node('span', 'admin-card-detail', 'Anunțuri pentru clienți sau administratori'));
        tools.append(button);
        const modal = node('div', 'modal announcements-modal');
        modal.id = 'modal-admin-announcements'; modal.style.display = 'none';
        // Static markup only. Campaign/user values below are assigned via textContent.
        modal.innerHTML = `<section class="modal-continut announcements-panel" role="dialog" aria-modal="true" aria-labelledby="ann-title" tabindex="-1">
<header class="announcements-heading"><h2 id="ann-title">Emailuri · Superadmin</h2><button type="button" class="btn-cont" id="ann-close">Închide</button></header>
<p>Trimite un anunț exclusiv către clienți sau exclusiv către administratori. Fiecare persoană primește un email individual.</p>
<p id="ann-transport" role="status"></p><div class="announcements-columns">
<form id="ann-form"><fieldset id="ann-fields"><legend>Compune anunțul</legend>
<div class="grup-input"><label for="ann-audience">Destinatari</label><select id="ann-audience" required><option value="clients">Numai clienți · fără administratori</option><option value="admins">Numai administratori · inclusiv superadmini</option></select></div>
<div class="grup-input"><label for="ann-subject">Subiect</label><input id="ann-subject" type="text" maxlength="180" required autocomplete="off"></div>
<div class="grup-input"><label for="ann-message">Mesaj</label><textarea id="ann-message" rows="8" maxlength="20000" required></textarea></div>
<div class="grup-input"><label for="ann-image">Imagine opțională · JPG sau PNG, maximum 5 MB</label><input id="ann-image" type="file" accept="image/jpeg,image/png"><p class="ann-help">Imaginea își păstrează proporțiile și se adaptează la lățimea emailului, inclusiv pe telefon.</p><button type="button" class="btn-cont" id="ann-remove-image">Elimină imaginea</button></div>
<button type="submit" class="btn-cont" id="ann-preview">Previzualizează și verifică destinatarii</button></fieldset></form>
<section id="ann-review" class="ann-review" aria-labelledby="ann-review-title" hidden><h3 id="ann-review-title">Previzualizare email</h3>
<p id="ann-count"></p><article class="ann-email"><p class="ann-brand">Spotivity</p><h3 id="ann-email-subject"></h3><img id="ann-email-image" alt="" hidden><p id="ann-email-message"></p><p class="ann-help">Deschide Spotivity · Contact: spotivity.rezervari@gmail.com</p></article>
<label class="ann-confirm"><input type="checkbox" id="ann-confirm"><span id="ann-confirm-text"></span></label>
<button type="button" class="btn-cont" id="ann-send" disabled>Trimite emailurile</button></section></div>
<p id="ann-status" role="status" aria-live="polite"></p>
<section class="ann-history" aria-labelledby="ann-history-title"><div class="announcements-heading"><h3 id="ann-history-title">Istoricul anunțurilor</h3><button type="button" class="btn-cont" id="ann-refresh">Reîncarcă</button></div>
<p class="ann-help">„Acceptate de Gmail” nu confirmă sosirea în inbox. O trimitere cu rezultat incert rămâne pentru verificare și nu este retrimisă automat.</p><p id="ann-history-status" role="status"></p><div id="ann-history-list"></div><button type="button" class="btn-cont" id="ann-more" hidden>Încarcă mai multe</button></section></section>`;
        workspace.append(modal);
        const get = id => modal.querySelector('#ann-' + id);
        const panel = modal.firstElementChild;
        const isOpen = () => modal.style.display === 'flex';
        const valid = token => role?.isSuper && role.userId === token.user && generation === token.generation && view === token.view && isOpen();
        const token = () => ({ user: role?.userId, generation, view });
        function status(text, error = false) { get('status').textContent = text; get('status').classList.toggle('is-error', error); }
        function setBusy(value) {
            busy = value; get('fields').disabled = value; get('confirm').disabled = value;
            get('send').disabled = value || !ready || !preview || !get('confirm').checked || preview.count < 1 || preview.expired || preview.stale;
            get('form').setAttribute('aria-busy', String(value));
            for (const b of get('history-list').querySelectorAll('button')) b.disabled = value;
        }
        function invalidate() {
            preview = null; draft = null; get('review').hidden = true; get('confirm').checked = false;
            get('email-image').hidden = true; get('email-image').removeAttribute('src');
            get('send').disabled = true;
            for (const id of ['email-subject', 'email-message', 'count', 'confirm-text']) get(id).textContent = '';
        }
        function close(restore = true) {
            view++; historyRequest++; clearTimeout(timer); timer = null;
            modal.style.display = 'none'; get('history-list').replaceChildren(); history = [];
            window.syncSpotivityModalScroll?.();
            if (restore && previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
        }
        function clear() {
            generation++; role = null; close(false); invalidate(); get('form').reset();
            status(''); get('history-status').textContent = ''; get('transport').textContent = '';
            busy = false; ready = false; setBusy(false); button.hidden = true;
        }
        async function rpc(name, args, current) {
            const { data, error } = await db.rpc(name, args);
            if (!valid(current)) throw new Error('stale_context');
            if (error?.code === '42501') { clear(); throw error; }
            if (error) throw error;
            return data;
        }
        function explain(error) {
            if (error?.code === '42501') return 'Acces refuzat. Numai superadminul conectat poate gestiona emailurile.';
            if (error?.code === '40001') return 'Destinatarii s-au schimbat. Creează o previzualizare nouă și confirmă din nou.';
            if (error?.code === '55000') return 'Trimiterea nu este disponibilă momentan. Previzualizarea rămâne salvată.';
            if (error?.code === '22023') return 'Previzualizarea a expirat sau conținutul nu mai corespunde. Verifică datele și previzualizează din nou.';
            return 'Nu am putut confirma operația. Verifică istoricul înainte să încerci din nou; nu crea un anunț nou pentru a forța retrimiterea.';
        }
        function renderPreview(data) {
            preview = data; get('review').hidden = false;
            get('email-subject').textContent = data.subject; get('email-message').textContent = data.message;
            get('count').textContent = `${data.count} ${label(data.audience)} eligibili. ${data.audience === 'clients' ? 'Toate conturile de administrator sunt excluse.' : 'Clienții fără rol administrativ sunt excluși.'}`;
            const img = get('email-image'); img.hidden = true; img.removeAttribute('src');
            if (typeof data.image_url === 'string' && data.image_url.startsWith(imageOrigin)) {
                img.src = data.image_url; img.alt = data.subject; img.hidden = false;
            }
            get('confirm-text').textContent = `Confirm trimiterea acestui email către ${data.count} ${label(data.audience)}.`;
            get('confirm').checked = false; setBusy(busy);
        }
        function drawHistory() {
            get('history-list').replaceChildren();
            get('history-status').textContent = history.length ? '' : 'Nu ai încă anunțuri salvate din panou.';
            for (const item of history) {
                const card = node('article', 'ann-history-card'); card.dataset.campaignId = item.campaign_id;
                const date = new Date(item.created_at);
                card.append(node('h4', '', item.subject), node('p', 'ann-help', `${label(item.audience)} · ${Number(item.count) || 0} destinatari · ${Number.isFinite(date.getTime()) ? date.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }) : ''}`));
                const stage = item.stage || {};
                const state = item.cancelled_at ? 'Oprit' : item.status === 'preview' ? 'Previzualizare · fără trimitere' : item.expired ? 'Aprobare expirată' : Number(stage.sending) ? 'Necesită verificare pentru rezultate incerte' : Number(stage.pending) ? 'În coadă' : 'Procesat';
                card.append(node('p', '', `${state}. Acceptate de Gmail: ${Number(stage.sent) || 0}; în așteptare: ${Number(stage.pending) || 0}; rezultat incert: ${Number(stage.sending) || 0}; omise: ${Number(stage.skipped) || 0}.`));
                if (item.status === 'approved' && !item.expired && !item.cancelled_at && stage.pending > 0) {
                    const resume = node('button', 'btn-cont', 'Continuă destinatarii rămași'); resume.type = 'button';
                    resume.addEventListener('click', () => resumeCampaign(item)); card.append(resume);
                }
                if (!item.cancelled_at && stage.pending > 0) {
                    const cancel = node('button', 'btn-cont', 'Oprește destinatarii rămași'); cancel.type = 'button';
                    cancel.addEventListener('click', () => cancelCampaign(item)); card.append(cancel);
                }
                get('history-list').append(card);
            }
        }
        async function loadHistory(append = false) {
            if (!role?.isSuper || !isOpen()) return;
            const current = token(), request = ++historyRequest;
            clearTimeout(timer); get('refresh').disabled = true; get('more').disabled = true;
            try {
                const last = append ? history.at(-1) : null;
                const data = await rpc('admin_announcement_history', { p_before: last?.created_at || null, p_before_id: last?.campaign_id || null }, current);
                if (request !== historyRequest) return;
                ready = data?.ready === true;
                get('transport').textContent = ready ? 'Trimitere disponibilă. Previzualizarea nu trimite emailuri.' : 'Trimiterea este momentan indisponibilă. Poți pregăti și previzualiza anunțul.';
                const rows = Array.isArray(data?.campaigns) ? data.campaigns : [];
                history = append ? [...history, ...rows.slice(0, 20).filter(row => !history.some(old => old.campaign_id === row.campaign_id))] : rows.slice(0, 20);
                get('more').hidden = rows.length <= 20; drawHistory(); setBusy(busy);
                if (history.some(item => item.status === 'approved' && !item.expired && !item.cancelled_at && item.stage?.pending > 0)) timer = setTimeout(() => loadHistory(), 10000);
            } catch (error) {
                if (valid(current) && request === historyRequest) {
                    ready = false; get('send').disabled = true; get('history-list').replaceChildren();
                    get('history-status').textContent = 'Istoricul nu a putut fi încărcat. Reîncarcă înainte să trimiți.';
                }
            } finally { if (valid(current) && request === historyRequest) { get('refresh').disabled = false; get('more').disabled = false; } }
        }
        async function validateImage(file) {
            if (!['image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 5242880) throw new Error('image');
            const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
            if (file.type === 'image/jpeg' ? !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) : ![137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) throw new Error('image');
            const image = await createImageBitmap(file);
            const good = image.width > 0 && image.height > 0 && image.width * image.height <= 40000000;
            image.close(); if (!good) throw new Error('image');
        }
        async function previewEmail(event) {
            event.preventDefault(); if (busy || !role?.isSuper || !get('form').reportValidity()) return;
            const current = token(); setBusy(true); status('Se verifică mesajul și destinatarii…');
            const file = get('image').files?.[0];
            try {
                if (!draft) draft = { id: crypto.randomUUID(), audience: get('audience').value, subject: get('subject').value.trim(), message: get('message').value.trim(), path: null };
                if (file && !draft.path) {
                    await validateImage(file); if (!valid(current)) return;
                    draft.path = `${role.userId}/${draft.id}/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
                }
                const attempt = { ...draft };
                if (file) {
                    const { error } = await db.storage.from(imageBucket).upload(attempt.path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
                    if (!valid(current)) return;
                    if (error && String(error.statusCode || error.status) !== '409') throw error;
                }
                const data = await rpc('admin_announcement_preview', { p_campaign_id: attempt.id, p_audience: attempt.audience, p_subject: attempt.subject, p_message: attempt.message, p_image_path: attempt.path }, current);
                renderPreview(data);
                status(data.count > 0 ? 'Previzualizare salvată. Verifică mesajul și confirmă destinatarii înainte de trimitere.' : 'Nu există destinatari eligibili pentru acest grup. Nu se vor trimite emailuri.');
                await loadHistory();
            } catch (error) { if (valid(current)) status(error?.message === 'image' ? 'Alege o imagine JPG sau PNG validă, de maximum 5 MB.' : explain(error), true); }
            finally { if (valid(current)) setBusy(false); }
        }
        async function sendCampaign(item) {
            const current = token(); setBusy(true); status('Se înregistrează trimiterea…');
            try {
                await rpc('admin_announcement_send', { p_campaign_id: item.campaign_id, p_expected_count: item.count, p_fingerprint: item.fingerprint }, current);
                invalidate(); status('Anunțul a fost pus în coadă. Urmărește progresul în istoric; confirmarea nu înseamnă că toate emailurile au ajuns în inbox.');
                await loadHistory();
            } catch (error) { if (valid(current)) { status(explain(error), true); await loadHistory(); } }
            finally { if (valid(current)) setBusy(false); }
        }
        async function resumeCampaign(item) {
            if (busy || !role?.isSuper || !confirm(`Continui anunțul pentru ${item.stage.pending} destinatari rămași? Emailurile deja procesate sau cu rezultat incert nu vor fi retrimise.`)) return;
            await sendCampaign(item);
        }
        async function cancelCampaign(item) {
            if (busy || !role?.isSuper || !confirm('Oprești destinatarii rămași? Emailurile deja acceptate sau în curs de trimitere nu pot fi retrase.')) return;
            const current = token(); setBusy(true);
            try { await rpc('admin_announcement_cancel', { p_campaign_id: item.campaign_id }, current); invalidate(); status('Destinatarii care nu erau încă procesați au fost opriți.'); await loadHistory(); }
            catch (error) { if (valid(current)) status(explain(error), true); }
            finally { if (valid(current)) setBusy(false); }
        }
        button.addEventListener('click', () => {
            if (!role?.isSuper) return;
            view++; busy = false; ready = false; previousFocus = document.activeElement;
            modal.style.display = 'flex'; setBusy(false); window.syncSpotivityModalScroll?.(); panel.focus(); loadHistory();
        });
        get('form').addEventListener('submit', previewEmail);
        get('form').addEventListener('input', invalidate);
        get('image').addEventListener('change', invalidate);
        get('remove-image').addEventListener('click', () => { get('image').value = ''; invalidate(); });
        get('confirm').addEventListener('change', () => setBusy(busy));
        get('send').addEventListener('click', () => { if (!busy && ready && preview && get('confirm').checked && !get('send').disabled) sendCampaign({ ...preview }); });
        get('refresh').addEventListener('click', () => loadHistory()); get('more').addEventListener('click', () => loadHistory(true));
        get('close').addEventListener('click', () => close());
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key === 'Tab') {
                const focusable = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(n => n.getClientRects().length);
                if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); }
                else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus(); }
            }
        });
        window.addEventListener('spotivity:admin-clear', clear);
        window.addEventListener('spotivity:admin-role', e => { clear(); if (e.detail?.isSuper === true && e.detail.userId) { role = { userId: e.detail.userId, isSuper: true }; button.hidden = false; } });
        return { clear, close };
    };
    const start = () => { if (typeof db !== 'undefined') window.createAnnouncementPanel(db); };
    if (document.getElementById('base-admin-workspace')) start(); else document.addEventListener('DOMContentLoaded', start);
})();
