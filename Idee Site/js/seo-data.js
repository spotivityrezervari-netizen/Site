/* Public structured data shared by the browser and static page generator. */
(function(root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./entity-paths.js'));
    else root.SpotivitySeoData = factory(root.SpotivityEntityPaths);
})(typeof window === 'object' ? window : globalThis, function(paths) {
    'use strict';
    const roots = Object.freeze([
        'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/',
        'https://spotivity.ro/'
    ]);
    const homeTitle = 'Spotivity — Rezervări terenuri de sport';
    const sportLabels = Object.freeze({ fotbal: 'fotbal', baschet: 'baschet', tenis: 'tenis', volei: 'volei', 'tenis-de-picior': 'tenis de picior' });
    const text = value => typeof value === 'string' ? value.trim() : '';
    const city = value => text(value).replace(/\.+$/, '');
    const reference = id => ({ '@id': id });
    function publicPlace(row) {
        if (!row || !paths.validId(row.id) || !text(row.nume) || !city(row.oras)) throw new TypeError('Structured data requires a public name, city and valid ID.');
        return { id: paths.normalizedId(row.id), nume: text(row.nume), oras: city(row.oras) };
    }
    function routeFor(route, fallback, kind, sportSlug) {
        const candidate = route === undefined ? fallback : route;
        if (typeof candidate !== 'string' || !/^(?:[a-z0-9-]+\/)*$/.test(candidate) || candidate.includes('//') ||
            (kind === 'home' ? candidate !== '' : kind === 'sport' ? candidate !== `terenuri/${sportSlug}/` :
                kind === 'court' ? !new RegExp(`^terenuri/${sportSlug}/[a-z0-9-]+/$`).test(candidate) : !/^baze-sportive\/[a-z0-9-]+\/$/.test(candidate))) {
            throw new TypeError('Invalid structured data route.');
        }
        return candidate;
    }
    function location(row, url, type) {
        return { '@type': type, '@id': url + '#place', name: row.nume, url,
            address: { '@type': 'PostalAddress', addressLocality: row.oras } };
    }
    function baseReferenceRoute(route, id) {
        if (route === undefined || route === null || route === '') return '';
        if (!paths.validId(id) || typeof route !== 'string' || !/^baze-sportive\/[a-z0-9-]+\/$/.test(route) || !route.endsWith(`-${paths.normalizedId(id)}/`)) throw new TypeError('Invalid containing sports base route.');
        return route;
    }
    function graphFor(options) {
        if (!paths || !options || !roots.includes(options.baseUrl)) throw new TypeError('Unreviewed structured data deployment origin.');
        const { baseUrl, kind } = options;
        if (!['home', 'sport', 'court', 'base'].includes(kind)) throw new TypeError('Unknown structured data page kind.');
        let court, base, sportSlug = '', defaultRoute = '', defaultTitle = homeTitle;
        if (kind === 'court') {
            court = publicPlace(options.court);
            sportSlug = paths.sportSlug(options.court.sport);
            if (!sportSlug) throw new TypeError('Unknown structured data sport.');
            // A supplied base describes containment only when the public membership agrees.
            if (options.base && paths.normalizedId(options.court.baza_sportiva_id) === paths.normalizedId(options.base.id)) base = publicPlace(options.base);
            defaultRoute = paths.courtPath({ ...court, sport: options.court.sport }, base);
            defaultTitle = `${court.nume}${base ? `, ${base.nume}` : ''} – ${sportLabels[sportSlug]} în ${court.oras} | Spotivity`;
        } else if (kind === 'base') {
            base = publicPlace(options.base);
            defaultRoute = paths.basePath(base);
            defaultTitle = `${base.nume} – Bază sportivă în ${base.oras} | Spotivity`;
        } else if (kind === 'sport') {
            sportSlug = paths.sportSlug(options.sport);
            if (!sportSlug) throw new TypeError('Unknown structured data sport.');
            defaultRoute = `terenuri/${sportSlug}/`;
            defaultTitle = `Terenuri de ${sportLabels[sportSlug]} – Rezervări online | Spotivity`;
        }
        const route = routeFor(options.route, defaultRoute, kind, sportSlug);
        if ((kind === 'court' || kind === 'base') && !route.endsWith(`-${(court || base).id}/`)) throw new TypeError('Structured data route does not match its public entity ID.');
        const canonical = new URL(route, baseUrl).href;
        const organizationId = baseUrl + '#organization', websiteId = baseUrl + '#website';
        const page = { '@type': kind === 'sport' ? 'CollectionPage' : 'WebPage', '@id': canonical + '#webpage',
            url: canonical, name: text(options.title) || defaultTitle, inLanguage: 'ro', isPartOf: reference(websiteId) };
        const graph = [
            { '@type': 'Organization', '@id': organizationId, name: 'Spotivity', url: baseUrl },
            { '@type': 'WebSite', '@id': websiteId, url: baseUrl, name: 'Spotivity', inLanguage: 'ro', publisher: reference(organizationId) },
            page
        ];
        if (kind !== 'home') {
            const crumbs = [{ name: 'Acasă', item: baseUrl }];
            if (sportSlug) crumbs.push({ name: `Terenuri de ${sportLabels[sportSlug]}`, item: new URL(`terenuri/${sportSlug}/`, baseUrl).href });
            if (kind === 'court' && base) crumbs.push({ name: base.nume, item: new URL(paths.basePath(base), baseUrl).href });
            if (kind === 'court' || kind === 'base') crumbs.push({ name: (court || base).nume, item: canonical });
            const breadcrumbId = canonical + '#breadcrumb';
            page.breadcrumb = reference(breadcrumbId);
            graph.push({ '@type': 'BreadcrumbList', '@id': breadcrumbId, itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, ...crumb })) });
        }
        if (kind === 'court' || kind === 'base') {
            const place = location(court || base, canonical, court ? 'Place' : 'SportsActivityLocation');
            page.mainEntity = reference(place['@id']);
            graph.push(place);
            if (court && base) {
                const containingPlace = location(base, new URL(paths.basePath(base), baseUrl).href, 'SportsActivityLocation');
                place.containedInPlace = reference(containingPlace['@id']);
                graph.push(containingPlace);
            } else if (court) {
                const baseRoute = baseReferenceRoute(options.baseRoute, options.court.baza_sportiva_id);
                if (baseRoute) place.containedInPlace = reference(new URL(baseRoute, baseUrl).href + '#place');
            }
        }
        return { '@context': 'https://schema.org', '@graph': graph };
    }
    function serialize(graph) {
        return JSON.stringify(graph).replace(/[<&\u2028\u2029]/g, character => ({ '<': '\\u003c', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' }[character]));
    }
    function script(graph) {
        return `<script id="spotivity-seo-data" type="application/ld+json">${serialize(graph)}</script>`;
    }
    return Object.freeze({ graphFor, serialize, script });
});
