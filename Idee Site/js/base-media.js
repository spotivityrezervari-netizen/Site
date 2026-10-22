/* Public base photos are stored only in the dedicated Supabase image bucket. */
(() => {
    'use strict';
    const photoPath = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|avif|gif)$/;
    const publicImageUrl = (base, field) => {
        const path = String(base?.[field] || '');
        if (!photoPath.test(path) || path.split('/')[0] !== String(base?.id)) return '';
        const { data } = db.storage.from('poze_baze_sportive').getPublicUrl(path);
        return window.safeUrl?.(data?.publicUrl) || '';
    };
    window.createSportsBasePhoto = (base, className) => {
        const url = publicImageUrl(base, 'poza');
        if (!url) return null;
        const image = document.createElement('img');
        image.className = className || 'sports-base-photo';
        image.src = url;
        image.alt = base.nume || '';
        image.width = 640;
        image.height = 360;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => image.remove(), { once: true });
        return image;
    };

    window.createSportsBaseAvatar = (base, className = '') => {
        const avatar = document.createElement('span');
        avatar.className = `sports-base-avatar ${className}`.trim();
        avatar.setAttribute('role', 'img');
        avatar.setAttribute('aria-label', `Fotografia de profil · ${base?.nume || 'Bază sportivă'}`);
        const fallback = document.createElement('span');
        fallback.className = 'sports-base-avatar-initials';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = String(base?.nume || 'Bază sportivă').trim().split(/\s+/).slice(0, 2)
            .map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase('ro-RO');
        avatar.append(fallback);
        const url = publicImageUrl(base, 'poza_profil');
        if (url) {
            const image = document.createElement('img');
            image.src = url;
            image.alt = '';
            image.width = 128;
            image.height = 128;
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => image.remove(), { once: true });
            avatar.append(image);
        }
        return avatar;
    };

    // Keep public listings working while a deployment waits for the nullable
    // profile-photo column; fallback only for that precise schema mismatch.
    window.readSportsBasePresentation = async read => {
        const fields = 'id,nume,oras,descriere,este_activa,poza';
        const result = await read(`${fields},poza_profil`);
        const error = result?.error;
        if (['42703', 'PGRST204'].includes(error?.code)
            && /poza_profil/.test(`${error.message || ''} ${error.details || ''}`)) return read(fields);
        return result;
    };
})();
