/* Public base photos are stored only in the dedicated Supabase image bucket. */
(() => {
    'use strict';
    const photoPath = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpe?g|png|webp|avif|gif)$/;
    window.createSportsBasePhoto = (base, className) => {
        const path = String(base?.poza || '');
        if (!photoPath.test(path) || path.split('/')[0] !== String(base?.id)) return null;
        const { data } = db.storage.from('poze_baze_sportive').getPublicUrl(path);
        const url = window.safeUrl?.(data?.publicUrl);
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
})();
