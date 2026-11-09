import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { PAGES_BASE_URL, PRODUCTION_BASE_URL, SPORTS, generateSeoFiles, productionHome, validateCatalog } from '../seo-pages.mjs';
const require = createRequire(import.meta.url);
const seo = require('../../Idee Site/js/seo-data.js');
const paths = require('../../Idee Site/js/entity-paths.js');
const base = { id: '00000000-0000-0000-0000-000000000001', nume: 'Bază Ștefănești', oras: 'Reghin' };
const court = { id: 9, nume: 'Teren sintetic', sport: 'Fotbal', oras: 'Reghin', baza_sportiva_id: base.id };
const nodes = graph => graph['@graph'];
const node = (graph, type) => nodes(graph).find(item => item['@type'] === type);
const decode = html => {
  const blocks = [...html.matchAll(/<script\b[^>]*\bid="spotivity-seo-data"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  assert.match(blocks[0][0], /type="application\/ld\+json"/);
  return JSON.parse(blocks[0][1]);
};

test('shared browser and CommonJS helper generate the same public graph', async () => {
  const context = vm.createContext({ window: {}, URL });
  for (const relative of ['entity-paths.js', 'seo-data.js']) vm.runInContext(await readFile(new URL(`../../Idee Site/js/${relative}`, import.meta.url), 'utf8'), context);
  const input = { baseUrl: PAGES_BASE_URL, kind: 'court', court, base };
  assert.equal(context.window.SpotivitySeoData.serialize(context.window.SpotivitySeoData.graphFor(input)), seo.serialize(seo.graphFor(input)));
});

test('brand and category graphs have canonical IDs, explicit language and real breadcrumb URLs', () => {
  for (const baseUrl of [PAGES_BASE_URL, PRODUCTION_BASE_URL]) {
    const graph = seo.graphFor({ baseUrl, kind: 'home' });
    assert.equal(graph['@context'], 'https://schema.org');
    assert.deepEqual(node(graph, 'Organization'), { '@type': 'Organization', '@id': baseUrl + '#organization', name: 'Spotivity', url: baseUrl });
    assert.equal(node(graph, 'WebSite').url, baseUrl);
    assert.equal(node(graph, 'WebSite').publisher['@id'], baseUrl + '#organization');
    assert.equal(node(graph, 'WebPage').url, baseUrl);
    assert.equal(node(graph, 'WebPage').inLanguage, 'ro');
    assert.equal(node(graph, 'BreadcrumbList'), undefined);
    for (const sport of SPORTS) {
      const category = seo.graphFor({ baseUrl, kind: 'sport', sport: sport.sport });
      const url = new URL(`terenuri/${sport.slug}/`, baseUrl).href;
      assert.equal(node(category, 'CollectionPage').url, url);
      assert.deepEqual(node(category, 'BreadcrumbList').itemListElement, [
        { '@type': 'ListItem', position: 1, name: 'Acasă', item: baseUrl },
        { '@type': 'ListItem', position: 2, name: `Terenuri de ${sport.label}`, item: url }
      ]);
    }
  }
});

test('courts describe their actual containing sports base and public city only', () => {
  const baseUrl = PAGES_BASE_URL;
  const baseUrlExact = new URL(paths.basePath(base), baseUrl).href;
  const graph = seo.graphFor({ baseUrl, kind: 'court', court, base });
  const place = node(graph, 'Place'), sportsBase = node(graph, 'SportsActivityLocation');
  assert.equal(place.url, new URL(paths.courtPath(court, base), baseUrl).href);
  assert.deepEqual(place.containedInPlace, { '@id': baseUrlExact + '#place' });
  assert.equal(sportsBase.url, baseUrlExact);
  assert.deepEqual(place.address, { '@type': 'PostalAddress', addressLocality: 'Reghin' });
  assert.deepEqual(sportsBase.address, { '@type': 'PostalAddress', addressLocality: 'Reghin' });
  assert.equal(node(graph, 'WebPage').mainEntity['@id'], place['@id']);
  assert.deepEqual(node(graph, 'BreadcrumbList').itemListElement.map(item => item.name), ['Acasă', 'Terenuri de fotbal', base.nume, court.nume]);
  const standalone = seo.graphFor({ baseUrl, kind: 'court', court: { ...court, baza_sportiva_id: null }, base });
  assert.equal(node(standalone, 'Place').containedInPlace, undefined);
  assert.equal(node(standalone, 'SportsActivityLocation'), undefined);
  const mismatched = seo.graphFor({ baseUrl, kind: 'court', court, base: { ...base, id: '00000000-0000-0000-0000-000000000002' } });
  assert.equal(node(mismatched, 'Place').containedInPlace, undefined);
  const indexed = seo.graphFor({ baseUrl, kind: 'court', court, route: paths.courtPath(court, base), baseRoute: paths.basePath(base) });
  assert.equal(node(indexed, 'Place').url, place.url);
  assert.deepEqual(node(indexed, 'Place').containedInPlace, place.containedInPlace);
  assert.equal(node(indexed, 'SportsActivityLocation'), undefined, 'Unknown base details must not be fabricated.');
  const baseGraph = seo.graphFor({ baseUrl, kind: 'base', base });
  assert.deepEqual(node(baseGraph, 'SportsActivityLocation'), sportsBase);
  assert.deepEqual(node(baseGraph, 'BreadcrumbList').itemListElement.map(item => item.name), ['Acasă', base.nume]);
});

test('public row projection never invents legal, address, review, search or booking claims', () => {
  const graph = seo.graphFor({ baseUrl: PRODUCTION_BASE_URL, kind: 'court', court: { ...court, telefon: 'private', email: 'private', geo: { latitude: 1 }, sport_secret: 'private' }, base: { ...base, legalName: 'private', descriere: 'private', streetAddress: 'private' } });
  const serialized = seo.serialize(graph);
  assert.doesNotMatch(serialized, /private|legalName|streetAddress|addressCountry|postalCode|latitude|longitude|aggregateRating|openingHours|SearchAction|potentialAction|offers|availability|"sport"/);
});

test('serialization preserves text and JSON quotes while preventing closing-script and line-separator injection', () => {
  const malicious = "$& $1 $` $' </ScRiPt><script>window.injected=true</script> & \u2028 \u2029 tail";
  const graph = seo.graphFor({ baseUrl: PAGES_BASE_URL, kind: 'court', court: { ...court, nume: malicious, oras: malicious }, base: { ...base, nume: malicious } });
  const serialized = seo.serialize(graph);
  assert.doesNotMatch(serialized, /[<&\u2028\u2029]|&quot;|&#34;/);
  assert.ok(serialized.includes('"@context":"https://schema.org"'));
  assert.deepEqual(JSON.parse(serialized), graph);
  const html = seo.script(graph);
  assert.equal((html.match(/<script\b/gi) || []).length, 1);
  assert.equal((html.match(/<\/script>/gi) || []).length, 1);
  assert.equal(node(decode(html), 'Place').name, malicious);
});

test('unreviewed origins, malformed routes, wrong IDs and nonpublic entities are rejected', () => {
  const input = { baseUrl: PAGES_BASE_URL, kind: 'court', court };
  for (const baseUrl of ['https://attacker.invalid/', 'http://spotivity.ro/', 'https://spotivity.ro/?x=1']) assert.throws(() => seo.graphFor({ ...input, baseUrl }), /Unreviewed/);
  for (const route of ['https://attacker.invalid/', '//attacker.invalid/', '/terenuri/fotbal/a-9/', '../a-9/', 'terenuri/fotbal/a-9/?x=1', 'terenuri/fotbal/a-9/#id', 'terenuri/fotbal/a%2f-9/', 'terenuri/tenis/a-9/', 'terenuri/fotbal/a-10/']) assert.throws(() => seo.graphFor({ ...input, route }), /route/);
  assert.throws(() => seo.graphFor({ ...input, baseRoute: paths.basePath({ ...base, id: '00000000-0000-0000-0000-000000000002' }) }), /base route/);
  for (const row of [{ ...court, id: 0 }, { ...court, nume: '' }, { ...court, oras: '...' }, { ...court, sport: 'Other' }]) assert.throws(() => seo.graphFor({ ...input, court: row }), /Structured data|structured data/);
});

test('reviewed source and production generation replace exactly one block with each page graph', async () => {
  const template = await readFile(new URL('../../Idee Site/index.html', import.meta.url), 'utf8');
  const catalog = validateCatalog(JSON.parse(await readFile(new URL('../seo-public-catalog.json', import.meta.url), 'utf8')));
  const source = generateSeoFiles({ template, catalog });
  const production = generateSeoFiles({ template, catalog, baseUrl: PRODUCTION_BASE_URL });
  for (const [relative, html] of source) if (relative.endsWith('.html')) {
    const graph = decode(html), prod = decode(production.get(relative));
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    const page = nodes(graph).find(item => ['WebPage', 'CollectionPage'].includes(item['@type']));
    assert.equal(page.url, canonical, relative);
    assert.equal(page['@id'], canonical + '#webpage', relative);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, relative);
    assert.doesNotMatch(html, /data-home-intro/, relative);
    assert.doesNotMatch(seo.serialize(prod), /spotivityrezervari-netizen\.github\.io/);
    for (const item of nodes(graph)) for (const key of ['url', '@id']) if (item[key]) assert.ok(item[key].startsWith(PAGES_BASE_URL), relative);
    assert.equal((await readFile(new URL(`../../Idee Site/${relative}`, import.meta.url), 'utf8')), html, relative);
  }
  assert.equal(node(decode(template), 'WebPage').url, PAGES_BASE_URL);
  const homeProduction = productionHome(template);
  assert.equal(node(decode(homeProduction), 'WebPage').url, PRODUCTION_BASE_URL);
  assert.doesNotMatch(seo.serialize(decode(homeProduction)), /spotivityrezervari-netizen\.github\.io/);
  assert.throws(() => generateSeoFiles({ template: template.replace(/<script id="spotivity-seo-data"[\s\S]*?<\/script>/, ''), catalog }), /exactly one/);
  assert.throws(() => generateSeoFiles({ template: template.replace('</head>', seo.script(seo.graphFor({ baseUrl: PAGES_BASE_URL, kind: 'home' })) + '</head>'), catalog }), /exactly one/);
});
