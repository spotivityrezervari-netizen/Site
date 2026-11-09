/* Shared public URL rules for the browser and the static page generator. */
(function(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SpotivityEntityPaths = api;
})(typeof window === 'object' ? window : globalThis, function() {
    'use strict';
    const idPattern = /^(?:[1-9]\d{0,18}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
    function validId(value) {
        if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0;
        return typeof value === 'string' && idPattern.test(value);
    }
    const normalizedId = value => validId(value) ? String(value).toLowerCase() : '';
    function simplify(value) {
        return String(value ?? '').normalize('NFKD').toLowerCase()
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
            .replace(/[đð]/g, 'd').replace(/ł/g, 'l')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function slug(value, fallback = 'teren', maxLength = 96) {
        const length = Number.isInteger(maxLength) && maxLength > 0 && maxLength <= 96 ? maxLength : 96;
        return (simplify(value) || simplify(fallback) || 'teren').slice(0, length).replace(/-+$/g, '');
    }
    function sportSlug(value) {
        const sports = { fotbal: 'fotbal', baschet: 'baschet', tenis: 'tenis', volei: 'volei',
            'tenis-picior': 'tenis-de-picior', 'tenis-de-picior': 'tenis-de-picior' };
        const key = simplify(value);
        return Object.hasOwn(sports, key) ? sports[key] : '';
    }
    const citySlug = value => simplify(value).slice(0, 40).replace(/-+$/g, '');
    function courtPath(court, base) {
        const id = normalizedId(court?.id), sport = sportSlug(court?.sport);
        if (!id || !sport) return '';
        const name = base?.nume
            ? `${slug(base.nume, 'baza', 40)}-${slug(court.nume, 'teren', 55)}`
            : slug(court?.nume);
        const city = citySlug(court?.oras) || citySlug(base?.oras);
        return `terenuri/${sport}/${city ? `${city}-` : ''}${name}-${id}/`;
    }
    function basePath(base) {
        const id = normalizedId(base?.id);
        const city = citySlug(base?.oras);
        return id ? `baze-sportive/${city ? `${city}-` : ''}${slug(base?.nume, 'baza')}-${id}/` : '';
    }
    return Object.freeze({ validId, normalizedId, slug, citySlug, sportSlug, courtPath, basePath });
});
