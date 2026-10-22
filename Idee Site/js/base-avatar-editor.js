/* Independent cover/profile images share validation, session guards and safe cleanup. */
(() => {
    'use strict';
    const bucket = 'poze_baze_sportive';
    const types = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/avif': ['avif'], 'image/gif': ['gif'] };
    const pathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|avif|gif)$/i;

    window.createSportsBasePhotoEditor = function(options) {
        const { field, prefix, sectionId, statusId, getContext, isBusy, onStateChange, onSaved } = options;
        const avatar = field === 'poza_profil';
        const title = avatar ? 'fotografia de profil' : 'fotografia';
        const byId = id => document.getElementById(id);
        const node = suffix => byId(`${prefix}-${suffix}`);
        const button = suffix => byId(`btn-${prefix}-${suffix}`);
        const available = current => !avatar || Object.prototype.hasOwnProperty.call(current.base || {}, 'poza_profil');
        const allowed = current => current.allowed && available(current);
        let draft = null;
        let selection = 0;
        let operation = null;

        function status(message, error = false) {
            const target = byId(statusId);
            if (!target) return;
            target.textContent = message;
            target.classList.toggle('is-error', error);
        }

        function discard() {
            selection++;
            if (draft?.url) URL.revokeObjectURL(draft.url);
            draft = null;
            if (node('file')) node('file').value = '';
        }

        function cancel() {
            operation?.controller.abort();
            operation = null;
            discard();
            status('');
        }

        function photoUrl(path) {
            const baseId = getContext().baseId;
            if (typeof path !== 'string' || !pathPattern.test(path) || path.split('/')[0] !== baseId) return '';
            const publicUrl = db.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl;
            const safe = window.safeUrl(publicUrl);
            if (!safe) return '';
            try { return new URL(safe).origin === new URL(supabaseUrl).origin ? safe : ''; }
            catch (_) { return ''; }
        }

        function renderControls() {
            const input = node('file');
            if (!input) return;
            const current = getContext();
            const busy = isBusy();
            byId(sectionId).hidden = !!current.baseId && !available(current);
            input.disabled = busy || !allowed(current);
            button('save').disabled = busy || !allowed(current) || !draft?.ready;
            button('save').textContent = operation ? `Se salvează ${title}…` : `Salvează ${title}`;
            button('clear').hidden = !draft;
            button('clear').disabled = busy;
            button('remove').hidden = !current.base?.[field];
            button('remove').disabled = busy || !allowed(current);
            node('selection').textContent = draft
                ? `${draft.file.name} · ${(draft.file.size / 1024 / 1024).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} MB${draft.ready ? ' · Fotografie nesalvată' : ' · Se verifică imaginea…'}` : '';
            node('hint').textContent = !current.baseId
                ? `Salvează mai întâi baza sportivă, apoi redeschide setările pentru a adăuga ${title}.`
                : `JPG, PNG, WebP, AVIF sau GIF, maximum 5 MB. ${avatar ? 'Fotografia de profil' : 'Fotografia de fundal'} se salvează separat de celelalte date ale bazei.`;
            byId(sectionId)?.setAttribute('aria-busy', String(!!operation));
        }

        function render() {
            const image = node('preview');
            if (!image) return;
            const base = getContext().base;
            const source = draft?.ready ? draft.url : photoUrl(base?.[field]);
            image.hidden = !source;
            node('empty').hidden = !!source;
            node('empty').textContent = avatar ? 'Baza nu are încă o fotografie de profil.' : 'Baza nu are încă o fotografie.';
            if (source) {
                image.alt = `${draft?.ready ? 'Previzualizarea fotografiei selectate' : avatar ? 'Fotografia de profil a bazei' : 'Fotografia bazei'}${base?.nume ? ` · ${base.nume}` : ''}`;
                image.src = source;
            } else image.removeAttribute('src');
            renderControls();
        }

        async function choose() {
            const current = getContext();
            if (isBusy() || !allowed(current)) return;
            const file = node('file').files?.[0];
            discard();
            status('');
            if (!file) return render();
            const extension = file.name.split('.').pop()?.toLowerCase();
            const accepted = Object.prototype.hasOwnProperty.call(types, file.type) ? types[file.type] : null;
            if (!accepted || !accepted.includes(extension)) {
                status('Alege o imagine JPG, PNG, WebP, AVIF sau GIF. Fișierele SVG nu sunt acceptate.', true);
                return render();
            }
            if (!file.size || file.size > 5 * 1024 * 1024) {
                status('Fotografia trebuie să aibă cel mult 5 MB și să nu fie goală.', true);
                return render();
            }
            const selected = selection;
            const candidate = { file, extension: accepted[0], url: URL.createObjectURL(file), ready: false };
            draft = candidate;
            renderControls();
            const stillSelected = () => {
                const next = getContext();
                return allowed(next) && next.generation === current.generation && next.editor === current.editor
                    && next.baseId === current.baseId && next.userId === current.userId && next.open
                    && selection === selected && draft === candidate;
            };
            try {
                const image = new Image(); image.src = candidate.url;
                await image.decode();
                if (!stillSelected()) return;
                if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
                candidate.ready = true;
                render();
            } catch (_) {
                if (!stillSelected()) return;
                discard();
                status('Fișierul nu poate fi afișat ca imagine. Alege o altă fotografie.', true);
                render();
            }
        }

        function sameContext(context) {
            const current = getContext();
            return operation === context && !context.controller.signal.aborted && allowed(current) && current.open
                && current.generation === context.generation && current.editor === context.editor
                && current.baseId === context.baseId && current.userId === context.userId;
        }
        const checkContext = context => { if (!sameContext(context)) throw new Error('Photo context changed'); };

        async function photoClient(context) {
            checkContext(context);
            const { data: identity, error: identityError } = await db.auth.getUser();
            checkContext(context);
            if (identityError || identity?.user?.id !== context.userId) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
            const { data, error } = await db.auth.getSession();
            checkContext(context);
            const session = data?.session;
            if (error || session?.user?.id !== context.userId || !session.access_token || !session.refresh_token) throw new Error('Sesiunea a expirat. Conectează-te din nou.');
            const client = createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });
            context.client = client;
            const { error: bindError } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
            checkContext(context);
            if (bindError) throw new Error('Sesiunea a expirat. Conectează-te din nou.');
            const { data: verified, error: verifiedError } = await client.auth.getUser();
            checkContext(context);
            if (verifiedError || verified?.user?.id !== context.userId) throw new Error('Sesiunea s-a schimbat. Conectează-te din nou.');
            return client;
        }

        async function removeUnreferencedObject(client, path, baseId) {
            if (!path || !pathPattern.test(path) || path.split('/')[0] !== baseId) return false;
            try {
                // Covers and avatars can share an existing object. A fresh read also
                // protects a successful UPDATE whose acknowledgement was lost.
                const result = await client.from('baze_sportive').select('*').eq('id', baseId).maybeSingle();
                if (result.error || result.data?.id !== baseId) return false;
                if (result.data.poza === path || result.data.poza_profil === path) return true;
                const { error } = await client.storage.from(bucket).remove([path]);
                return !error;
            } catch (_) { return false; }
        }

        async function save(remove = false) {
            const current = getContext();
            if (isBusy() || !allowed(current) || (!remove && !draft?.ready)) return;
            const base = current.base;
            if (remove && !base?.[field]) return;
            const selected = draft;
            const context = { ...current, controller: new AbortController(), client: null };
            operation = context;
            onStateChange();
            status(remove ? `Se elimină ${title}…` : `Se încarcă ${title}…`);
            let uploadedPath = null;
            let metadataSaved = false;
            try {
                const client = await photoClient(context);
                checkContext(context);
                let nextPath = null;
                if (!remove) {
                    nextPath = `${context.baseId}/${crypto.randomUUID()}.${selected.extension}`;
                    uploadedPath = nextPath;
                    const { data, error } = await client.storage.from(bucket).upload(nextPath, selected.file, {
                        contentType: selected.file.type, upsert: false, cacheControl: '3600'
                    });
                    checkContext(context);
                    if (error || data?.path !== nextPath) throw new Error('Fotografia nu a putut fi încărcată. Verifică permisiunile și încearcă din nou.');
                }
                checkContext(context);
                let update = client.from('baze_sportive').update({ [field]: nextPath }).eq('id', context.baseId).select('*');
                if (typeof update.abortSignal === 'function') update = update.abortSignal(context.controller.signal);
                const result = await update;
                checkContext(context);
                if (result.error || !Array.isArray(result.data) || result.data.length !== 1
                    || result.data[0].id !== context.baseId || result.data[0][field] !== nextPath) {
                    throw new Error('Salvarea fotografiei nu a putut fi confirmată. Reîncarcă baza și verifică permisiunile înainte să încerci din nou.');
                }
                metadataSaved = true;
                const change = { id: context.baseId, poza: result.data[0].poza };
                if (Object.prototype.hasOwnProperty.call(result.data[0], 'poza_profil')) change.poza_profil = result.data[0].poza_profil;
                onSaved(change);
                discard(); render();
                let cleaned = true;
                if (base[field] && base[field] !== nextPath) {
                    cleaned = await removeUnreferencedObject(client, base[field], context.baseId);
                    checkContext(context);
                }
                const savedCopy = avatar ? 'Fotografia de profil a fost salvată.' : 'Fotografia a fost salvată.';
                const removedCopy = avatar ? 'Fotografia de profil a fost eliminată.' : 'Fotografia a fost eliminată.';
                status(cleaned ? remove ? removedCopy : savedCopy
                    : `${remove ? 'Fotografia nu mai este afișată pe site.' : savedCopy} Imaginea anterioară nu a putut fi eliminată. Verifică permisiunile înainte să încerci din nou.`, !cleaned);
            } catch (error) {
                let cleanupFailed = false;
                if (uploadedPath && !metadataSaved && context.client) {
                    cleanupFailed = !await removeUnreferencedObject(context.client, uploadedPath, context.baseId);
                }
                if (sameContext(context)) status(`${error.message || 'Fotografia nu a putut fi salvată.'}${cleanupFailed ? ' Fișierul nou nu a putut fi curățat automat. Reîncarcă baza înainte de a încerca din nou.' : ''}`, true);
            } finally {
                context.client?.auth.stopAutoRefresh();
                if (operation === context) {
                    operation = null;
                    onStateChange();
                    renderControls();
                }
            }
        }

        function mount() {
            if (!node('file')) return;
            node('file').addEventListener('change', choose);
            button('save').addEventListener('click', () => save(false));
            button('remove').addEventListener('click', () => save(true));
            button('clear').addEventListener('click', () => {
                if (isBusy()) return;
                discard(); status(''); render();
            });
            node('preview').addEventListener('error', () => {
                node('preview').hidden = true;
                node('empty').hidden = false;
                node('empty').textContent = 'Fotografia nu a putut fi afișată. Poți alege o altă imagine.';
            });
        }
        return { cancel, mount, render, renderControls, status, isSaving: () => !!operation, hasPending: () => !!draft || !!operation };
    };
})();
