// Deterministic public sport, court and sports-base pages. Only allowlisted
// anonymous catalog fields enter these documents; booking is revalidated live.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { redirectSeoAlias } from './seo-alias-runtime.mjs';
const require = createRequire(import.meta.url);
const paths = require('../Idee Site/js/entity-paths.js');
const seoData = require('../Idee Site/js/seo-data.js');

export const PAGES_BASE_URL = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
export const PRODUCTION_BASE_URL = 'https://spotivity.ro/';
export const GENERATED_MARKER = '<!-- Spotivity generated public page; edit the shared shell/catalog instead. -->';
// Shared answers describe the real booking rules (hourly slots, published price,
// cancellation until the slot starts, late cancellation under 60 minutes).
const commonFaq = label => [
  { question: `Cum rezerv un teren de ${label} pe Spotivity?`, answer: `Alege un teren de ${label} din listă, selectează data și una sau mai multe ore libere consecutive, apoi confirmă rezervarea. Confirmarea o primești pe email.` },
  { question: `Cât costă închirierea unui teren de ${label}?`, answer: 'Fiecare teren are un tarif pe oră stabilit de administrator și afișat pe card și în formularul de rezervare. Totalul se calculează înainte să confirmi.' },
  { question: 'Pot anula o rezervare?', answer: 'Da, din istoricul rezervărilor din contul tău, până la începutul orei rezervate. O anulare făcută cu mai puțin de 60 de minute înainte este înregistrată ca anulare târzie.' }
];
const sportFaq = {
  Fotbal: { question: 'Pot primi și o minge la terenul de fotbal?', answer: 'La unele terenuri administratorul oferă opțiunea de minge. Dacă este disponibilă, o vezi în formularul de rezervare, împreună cu costul suplimentar.' },
  Baschet: { question: 'Pot rezerva mai multe ore la rând pentru baschet?', answer: 'Da. În formular poți selecta mai multe ore libere consecutive, iar ele sunt rezervate împreună, ca o singură rezervare.' },
  Tenis: { question: 'Cât durează o rezervare pentru tenis?', answer: 'Rezervările se fac pe ore întregi: o oră care începe la 10:00 se termină la 11:00. Pentru un meci mai lung alegi mai multe ore consecutive.' },
  Volei: { question: 'Pot vorbi cu administratorul terenului de volei?', answer: 'Da. Din contul tău poți trimite mesaje administratorilor terenului în secțiunea de chat, de exemplu pentru detalii despre echipament sau acces.' },
  'Tenis Picior': { question: 'Ce este tenisul de picior?', answer: 'Tenisul de picior este un joc cu mingea peste fileu, în care mingea se lovește cu piciorul sau cu capul, ca la fotbal, pe un teren asemănător celui de tenis.' }
};
export const SPORTS = Object.freeze([
  { sport: 'Fotbal', slug: 'fotbal', label: 'fotbal', intro: 'Găsește terenuri de fotbal pentru meciurile cu prietenii. Compară terenurile și orașele, apoi verifică programul și alege ora potrivită pentru echipa ta.' },
  { sport: 'Baschet', slug: 'baschet', label: 'baschet', intro: 'Descoperă terenuri de baschet pentru antrenamente și meciuri între prieteni. Alege terenul din orașul tău și verifică intervalele de rezervare în formular.' },
  { sport: 'Tenis', slug: 'tenis', label: 'tenis', intro: 'Caută terenuri de tenis pentru partide de simplu, dublu sau antrenamente. Vezi terenurile și tarifele publicate, apoi selectează data și ora în formularul de rezervare.' },
  { sport: 'Volei', slug: 'volei', label: 'volei', intro: 'Alege un teren de volei pentru următorul joc cu echipa. Consultă terenurile pe orașe și verifică programul de rezervare înainte de a stabili întâlnirea.' },
  { sport: 'Tenis Picior', slug: 'tenis-de-picior', label: 'tenis de picior', intro: 'Găsește terenuri de tenis de picior pentru jocuri cu prietenii și antrenamente. Alege locația potrivită și consultă intervalele din formularul de rezervare.' }
].map(sport => Object.freeze({ ...sport, faq: Object.freeze([...commonFaq(sport.label), sportFaq[sport.sport]].map(item => Object.freeze(item))), title: `Terenuri de ${sport.label} – Rezervări online | Spotivity`, description: `Descoperă terenuri de ${sport.label} pe Spotivity. Compară locațiile și tarifele publicate, verifică programul și rezervă online un teren.` })));
export const SEO_PATHS = Object.freeze([...SPORTS.map(({ slug }) => `terenuri/${slug}/index.html`), 'js/seo-route-index.js', 'js/seo-alias-redirect.js', 'robots.txt', 'sitemap.xml']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const normalizeSport = value => value === 'Tenis de picior' ? 'Tenis Picior' : value;
const rowKeys = (row, allowed) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).every(key => allowed.includes(key));
const city = value => value.trim().replace(/\.+$/, '');
const publicText = (value, max, optional = false) => typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0);
const sortIds = (a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true });

export function validateCatalog(catalog) {
  if (!rowKeys(catalog, ['version', 'refreshedAt', 'bases', 'courts']) || catalog.version !== 2 || !Array.isArray(catalog.courts) || !Array.isArray(catalog.bases) || catalog.courts.length > 100000 || catalog.bases.length > 100000 || typeof catalog.refreshedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(catalog.refreshedAt) || !Number.isFinite(Date.parse(catalog.refreshedAt))) {
    throw new Error('Invalid public SEO catalog. Refresh the reviewed public snapshot.');
  }
  const baseIds = new Set();
  const bases = catalog.bases.map(row => {
    if (!rowKeys(row, ['id', 'nume', 'oras', 'descriere']) || !paths.validId(row.id) || baseIds.has(String(row.id).toLowerCase()) || !publicText(row.nume, 200) || !publicText(row.oras, 120) || !city(row.oras) || !(row.descriere === null || publicText(row.descriere, 20000, true))) throw new Error('Invalid or unapproved field in public SEO base snapshot.');
    const id = typeof row.id === 'number' ? row.id : row.id.toLowerCase();
    baseIds.add(String(id));
    return { id, nume: row.nume.trim(), oras: city(row.oras), descriere: row.descriere?.trim() || '' };
  }).sort(sortIds);
  const courtIds = new Set();
  const courts = catalog.courts.map(row => {
    if (!rowKeys(row, ['id', 'nume', 'sport', 'oras', 'pret', 'baza_sportiva_id']) || !paths.validId(row.id) || courtIds.has(String(row.id).toLowerCase()) || !publicText(row.nume, 200) || !publicText(row.oras, 120) || !city(row.oras) || !SPORTS.some(({ sport }) => sport === normalizeSport(row.sport)) || !(row.pret === null || typeof row.pret === 'number' && Number.isFinite(row.pret) && row.pret >= 0 && row.pret <= 1000000) || !(row.baza_sportiva_id === null || paths.validId(row.baza_sportiva_id) && baseIds.has(String(row.baza_sportiva_id).toLowerCase()))) throw new Error('Invalid or unapproved field in public SEO court snapshot.');
    const id = typeof row.id === 'number' ? row.id : row.id.toLowerCase();
    courtIds.add(String(id));
    return { id, nume: row.nume.trim(), sport: normalizeSport(row.sport), oras: city(row.oras), pret: row.pret, baza_sportiva_id: row.baza_sportiva_id === null ? null : String(row.baza_sportiva_id).toLowerCase() };
  }).sort(sortIds);
  return { version: 2, refreshedAt: catalog.refreshedAt, bases, courts };
}

// One listing per sport and city that has published courts. Different spellings
// of the same city (diacritics, case) share one page and its first spelling.
export function cityListings(catalog) {
  const listings = new Map();
  for (const court of catalog.courts) {
    const route = paths.cityPath(court.sport, court.oras);
    if (!route) continue;
    if (!listings.has(route)) listings.set(route, { route, sport: court.sport, city: court.oras, courts: [] });
    listings.get(route).courts.push(court);
  }
  return [...listings.values()].sort((a, b) => a.route.localeCompare(b.route, 'en'));
}
function indexFor(catalog) {
  const bases = new Map(catalog.bases.map(base => [String(base.id), base]));
  const courts = Object.fromEntries(catalog.courts.map(court => [String(court.id), paths.courtPath(court, bases.get(court.baza_sportiva_id))]));
  const basePaths = Object.fromEntries(catalog.bases.map(base => [String(base.id), paths.basePath(base)]));
  const all = [...Object.values(courts), ...Object.values(basePaths), ...cityListings(catalog).map(listing => listing.route)];
  if (all.some(relative => !relative || relative.includes('..') || !/^[a-z0-9/-]+\/$/.test(relative)) || new Set(all).size !== all.length) throw new Error('Duplicate or invalid public entity route.');
  return { courts, bases: basePaths };
}
export function reconcileRouteHistory(input, history = { version: 1, courts: {}, bases: {} }) {
  const catalog = validateCatalog(input), index = indexFor(catalog);
  if (!rowKeys(history, ['version', 'courts', 'bases']) || history.version !== 1) throw new Error('Invalid SEO route history.');
  const result = { version: 1, courts: {}, bases: {} }, occupied = new Map();
  for (const kind of ['courts', 'bases']) {
    if (!history[kind] || Array.isArray(history[kind]) || typeof history[kind] !== 'object' || Object.keys(history[kind]).length > 200000) throw new Error('Invalid SEO route history identities.');
    const combined = new Set([...Object.keys(history[kind]), ...Object.keys(index[kind])]);
    for (const id of [...combined].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
      if (paths.normalizedId(id) !== id) throw new Error('Invalid SEO route history identity.');
      const previous = history[kind][id] ?? [];
      if (!Array.isArray(previous) || previous.length > 1000 || new Set(previous).size !== previous.length) throw new Error('Invalid SEO route history routes.');
      const routes = [...new Set([...previous, ...(index[kind][id] ? [index[kind][id]] : [])])].sort();
      for (const route of routes) {
        // Older court routes (terenuri/<sport>/<slug>-<id>/) stay as 301 aliases.
        const prefix = kind === 'courts' ? /^(?:teren\/(?:fotbal|baschet|tenis|volei|tenis-de-picior)\/(?:[a-z0-9-]+\/)?[a-z0-9-]+|terenuri\/(?:fotbal|baschet|tenis|volei|tenis-de-picior)\/[a-z0-9-]+)\/$/ : /^baze-sportive\/[a-z0-9-]+\/$/;
        if (typeof route !== 'string' || route.length > 240 || !prefix.test(route) || !route.endsWith(`-${id}/`) || occupied.has(route)) throw new Error('Unsafe or duplicate SEO historical route.');
        occupied.set(route, `${kind}:${id}`);
      }
      result[kind][id] = routes;
    }
  }
  return result;
}
export function seoAliases(input, history) {
  const catalog = validateCatalog(input), index = indexFor(catalog), reviewed = reconcileRouteHistory(catalog, history);
  return ['courts', 'bases'].flatMap(kind => Object.entries(reviewed[kind]).flatMap(([id, routes]) =>
    index[kind][id] ? routes.filter(route => route !== index[kind][id]).map(route => ({ kind, id, route, target: index[kind][id] })) : []));
}
export function seoPaths(input, history) {
  const catalog = validateCatalog(input), index = indexFor(catalog);
  return [...SEO_PATHS, ...cityListings(catalog).map(listing => listing.route + 'index.html'), ...Object.values(index.courts).map(route => route + 'index.html'), ...Object.values(index.bases).map(route => route + 'index.html'), ...seoAliases(catalog, history).map(alias => alias.route + 'index.html')];
}
export function netlifyAliasRedirects(catalog, history) {
  return seoAliases(catalog, history).flatMap(({ route, target }) => [`/${route} /${target} 301!`, `/${route.slice(0, -1)} /${target} 301!`]).join('\n') + '\n';
}
// Production-only app shell for court, base and city addresses that have no
// generated page yet (added after the last build). Netlify serves an existing
// file before a non-forced rewrite, so generated pages and aliases always win.
export const APP_SHELL_PATH = 'app.html';
export const NETLIFY_APP_REWRITES = Object.freeze([
  '/teren/:sport/:city/:court /app.html 200',
  '/teren/:sport/:court /app.html 200',
  '/terenuri/:sport/:city /app.html 200',
  '/baze-sportive/:base /app.html 200'
]);
export function productionAppShell(homeHtml) {
  // The shell answers at any depth, so its resources are root-absolute. That is
  // safe only on spotivity.ro, which serves the site from the domain root.
  let html = productionHome(homeHtml).replace(/\b(src|href)="([^"]*)"/gi, (attribute, name, value) => {
    if (/^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/|#|\/)/.test(value)) return attribute;
    return `${name}="/${value === './' ? '' : value}"`;
  });
  html = html.replace(/\bsrcset="(assets\/imagini\/[A-Za-z0-9_.-]+)"/g, (_, value) => `srcset="/${value}"`);
  // The address is the page's identity only after generation; until then it is never indexed.
  const robots = '<meta name="robots" content="noindex,follow">';
  if (/<meta name="robots" content="[^"]*">/i.test(html)) return html.replace(/<meta name="robots" content="[^"]*">/i, robots);
  if (!/<head\b[^>]*>/i.test(html)) throw new Error('App shell template is missing its head.');
  return html.replace(/<head\b[^>]*>/i, opening => `${opening}${robots}`);
}

export async function readReviewedFile(root, relative) {
  let location = path.resolve(root);
  const parts = relative.split('/');
  const rootStat = await lstat(location);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('SEO root must be a real directory.');
  for (let index = 0; index < parts.length; index++) {
    if (!parts[index] || parts[index] === '.' || parts[index] === '..') throw new Error('Invalid reviewed SEO input path.');
    location = path.join(location, parts[index]);
    const stat = await lstat(location);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error(`SEO input must have no symlink components: ${relative}`);
  }
  const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile('utf8'); } finally { await handle.close(); }
}

// Only balanced, explicitly labelled homepage sections may be changed. Keep the
// shared app modals and auxiliary public directories required by its bootstrap.
function sportSections(template) {
  const sections = [], stack = [];
  const expression = /<\/?section\b[^>]*>/gi;
  let match;
  while ((match = expression.exec(template))) {
    if (/^<\/section/i.test(match[0])) {
      const section = stack.pop();
      if (!section) throw new Error('Unbalanced section in SEO template.');
      if (section.sport || section.homeIntro) sections.push({ ...section, end: expression.lastIndex });
    } else stack.push({ start: match.index, sport: match[0].match(/\bdata-home-sport="([^"]+)"/)?.[1], homeIntro: /\bdata-home-intro(?=[\s=>])/.test(match[0]) });
  }
  if (stack.length || sections.filter(section => section.sport).length !== SPORTS.length || sections.filter(section => section.homeIntro).length > 1 || SPORTS.some(({ sport }) => sections.filter(section => section.sport === sport).length !== 1)) throw new Error('SEO template must contain exactly the five reviewed sport sections and at most one homepage introduction.');
  return sections;
}
function withoutSports(template, sections) {
  for (const section of [...sections].sort((a, b) => b.start - a.start)) template = template.slice(0, section.start) + template.slice(section.end);
  return template;
}
// 1200x630 social preview (Facebook, WhatsApp, X), much lighter than the old 2 MB avatar.
const SOCIAL_IMAGE = 'assets/imagini/spotivity-og.jpg';
function metadata(html, { baseUrl, title, description, route = '' }) {
  const canonical = new URL(route, baseUrl).href;
  html = html.replace(/<title>[^<]*<\/title>/i, () => `<title>${escape(title)}</title>`);
  const replacements = new Map([['name="description"', description], ['property="og:title"', title], ['property="og:description"', description], ['property="og:url"', canonical], ['property="og:image"', new URL(SOCIAL_IMAGE, baseUrl).href]]);
  for (const [attribute, value] of replacements) {
    const expression = new RegExp(`<meta\\s+${attribute}\\s+content="[^"]*"\\s*\\/?>`, 'i');
    if (!expression.test(html)) throw new Error(`SEO template is missing ${attribute}.`);
    html = html.replace(expression, () => `<meta ${attribute} content="${escape(value)}">`);
  }
  // Twitter/X tags are optional in the template; when present they follow the page's own title and image.
  for (const [attribute, value] of [['name="twitter:title"', title], ['name="twitter:description"', description], ['name="twitter:image"', new URL(SOCIAL_IMAGE, baseUrl).href]]) {
    html = html.replace(new RegExp(`<meta\\s+${attribute}\\s+content="[^"]*"\\s*\\/?>`, 'i'), () => `<meta ${attribute} content="${escape(value)}">`);
  }
  if (!/<link rel="canonical" href="[^"]*"\s*\/?>/i.test(html)) throw new Error('SEO template is missing its canonical link.');
  return html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, () => `<link rel="canonical" href="${escape(canonical)}">`);
}
export function productionHome(html) {
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/i, `$1${PRODUCTION_BASE_URL}$2`).replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${PRODUCTION_BASE_URL}$2`).replace(/(<meta property="og:image" content=")[^"]*(")/i, `$1${new URL(SOCIAL_IMAGE, PRODUCTION_BASE_URL).href}$2`).replace(/(<meta name="twitter:image" content=")[^"]*(")/i, `$1${new URL(SOCIAL_IMAGE, PRODUCTION_BASE_URL).href}$2`);
  return structuredData(html, { baseUrl: PRODUCTION_BASE_URL, kind: 'home' });
}
function structuredData(html, options) {
  const expression = /<script\b(?=[^>]*\bid=["']spotivity-seo-data["'])[^>]*>[\s\S]*?<\/script\s*>/gi;
  const blocks = [...html.matchAll(expression)];
  const opening = blocks[0]?.[0].split('>')[0] || '';
  if (blocks.length !== 1 || !/\btype=["']application\/ld\+json["']/i.test(opening) || /\bsrc\s*=/i.test(opening)) throw new Error('SEO template must contain exactly one inline application/ld+json block with id spotivity-seo-data.');
  return html.replace(expression, () => seoData.script(seoData.graphFor(options)));
}
function link(relative, label, attributes = '') { return `<a href="${escape(relative)}"${attributes}>${escape(label)}</a>`; }
function courtCards(courts, index) {
  return courts.map(court => `<a href="${escape(index.courts[String(court.id)])}" class="home-court-card" data-entity-court-id="${escape(court.id)}" aria-label="Rezervă ${escape(court.nume)}, ${escape(court.oras)}"><span class="home-court-details"><strong>${escape(court.nume)}</strong><span class="home-court-meta">${escape(court.oras)}</span>${court.pret === null ? '' : `<span class="home-court-price">${escape(String(court.pret))} Lei/oră</span>`}</span></a>`).join('\n');
}
function breadcrumb(items) { return `<nav class="category-breadcrumb" aria-label="Navigare">${items.map(({ route, label, attributes }) => route ? link(route, label, attributes) : `<span aria-current="page">${escape(label)}</span>`).join(' ')}</nav>`; }
function snapshotNote(catalog) { return `<p class="category-catalog-note">Catalog public actualizat la ${escape(catalog.refreshedAt.slice(0, 10))}. Tariful și disponibilitatea se verifică în formularul de rezervare.</p>`; }
function finish(html, { baseUrl, route, title, description, sport, bodyAttribute, kind, court, base, city, faq }) {
  html = html.replace(/<body\b([^>]*)>/i, (_, attributes) => `<body${attributes}${sport ? ` data-category-sport="${escape(sport)}"` : ''}${bodyAttribute || ''}>`);
  html = html.replace(/(<a\b[^>]*\bid="home-brand"[^>]*\bhref=")[^"]*(")/i, '$1./$2');
  if (sport) html = html.replace(/<a\b[^>]*\bdata-sport-target="[^"]*"[^>]*>/gi, tag => tag.includes(`data-sport-target="${sport}"`) ? tag.replace(/\saria-current="[^"]*"/gi, '').replace(/>$/, ' aria-current="page">') : tag);
  html = html.replace('</main>', '<noscript><p class="category-catalog-note">Activează JavaScript pentru programul actualizat și rezervarea unui teren.</p></noscript>\n</main>');
  html = metadata(html, { baseUrl, title, description, route });
  html = structuredData(html, { baseUrl, route, title, kind, sport, court, base, city, faq });
  const prefix = '../'.repeat(route.split('/').filter(Boolean).length);
  html = html.replace(/\b(src|href)="([^"]*)"/gi, (attribute, name, value) => {
    if (/^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/|#|\/)/.test(value)) return attribute;
    return `${name}="${value === './' ? prefix : prefix + value}"`;
  });
  // Desktop <picture> sources currently contain one bundled image each.
  // Rebase these too, so nested category pages can select HD before JS runs.
  html = html.replace(/\bsrcset="(assets\/imagini\/[A-Za-z0-9_.-]+)"/g, (_, value) => `srcset="${prefix + value}"`);
  return html.replace(/(<!doctype html>)/i, (_, declaration) => `${declaration}\n${GENERATED_MARKER}`).replace(/[ \t]+(?=\r?$)/gm, '');
}

export function generateSeoFiles({ template, catalog: input, routeHistory, baseUrl = PAGES_BASE_URL }) {
  if (![PAGES_BASE_URL, PRODUCTION_BASE_URL].includes(baseUrl)) throw new Error('Unreviewed SEO deployment origin.');
  const catalog = validateCatalog(input), index = indexFor(catalog), sections = sportSections(template), files = new Map();
  const stripped = withoutSports(template, sections);
  const bases = new Map(catalog.bases.map(base => [String(base.id), base]));
  const listings = cityListings(catalog);
  function listingPage(sport, { city = '', courts, route, title, description, intro, crumbs, extra = '', related, faq }) {
    const source = sections.find(section => section.sport === sport.sport);
    let section = template.slice(source.start, source.end);
    const heading = `Terenuri de ${sport.label}${city ? ` în ${city}` : ''}`;
    section = section.replace(/<h[12]\b([^>]*)>[^<]*<\/h[12]>/i, (_, attributes) => `<h1${attributes.replace(/\sdata-i18n="[^"]*"/gi, '')}>${escape(heading)}</h1>`);
    section = section.replace(/(<\/h1>\s*<\/div>)/, (_, opening) => `${opening}\n<p class="category-intro">${escape(intro)}</p>`);
    section = section.replace(/<a\b([^>]*\bclass="[^"]*\bcard-sport\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i, (_, attributes, text) => `<button type="button"${attributes.replace(/\s(?:href|aria-current)="[^"]*"/gi, '')}>${text}</button>`);
    section = section.replace(/\bloading="lazy"/, 'loading="eager" fetchpriority="high"');
    const strip = /(<div\b[^>]*\bdata-home-courts="[^"]+"[^>]*>)[\s\S]*?(<\/div>)/;
    if (!strip.test(section)) throw new Error(`Missing public court strip: ${sport.slug}`);
    section = section.replace(strip, (_, opening, closing) => `${opening.replace(/aria-busy="true"/, 'aria-busy="false"')}${courts.length ? courtCards(courts, index) : '<p class="home-discovery-message">Momentan nu sunt terenuri publicate pentru acest sport.</p>'}${closing}${snapshotNote(catalog)}`);
    const faqSection = faq ? `<section class="category-faq" aria-labelledby="faq-title"><h2 id="faq-title">Întrebări frecvente despre terenurile de ${escape(sport.label)}</h2>${faq.map(item => `<details><summary>${escape(item.question)}</summary><p>${escape(item.answer)}</p></details>`).join('')}</section>` : '';
    const html = stripped.replace(/(<main\b[^>]*>)/i, (_, opening) => `${opening}\n${breadcrumb(crumbs)}${section}${extra}${faqSection}${related}`);
    const bodyAttribute = city ? ` data-category-city="${escape(city)}"` : '';
    return finish(html, { baseUrl, route, title, description, sport: sport.sport, bodyAttribute, kind: city ? 'city' : 'sport', city, faq });
  }
  const cityList = (items, heading) => items.length ? `<nav class="category-cities" aria-labelledby="${heading.id}"><h2 id="${heading.id}">${escape(heading.text)}</h2><ul>${items.map(item => `<li>${link(item.route, item.label)}</li>`).join('')}</ul></nav>` : '';
  const sportLabel = value => SPORTS.find(item => item.sport === value).label;
  for (const sport of SPORTS) {
    const courts = catalog.courts.filter(court => court.sport === sport.sport);
    const cities = listings.filter(listing => listing.sport === sport.sport);
    const route = `terenuri/${sport.slug}/`;
    const related = `<nav class="category-related" aria-label="Alte sporturi">${SPORTS.filter(other => other !== sport).map(other => link(`terenuri/${other.slug}/`, `Terenuri de ${other.label}`)).join(' ')}</nav>`;
    files.set(route + 'index.html', listingPage(sport, { courts, route, title: sport.title, description: sport.description, intro: sport.intro,
      crumbs: [{ route: './', label: 'Acasă' }, { label: `Terenuri de ${sport.label}` }],
      extra: cityList(cities.map(listing => ({ route: listing.route, label: `${listing.city} (${listing.courts.length})` })), { id: 'category-cities-title', text: `Terenuri de ${sport.label} pe orașe` }),
      related, faq: sport.faq }));
  }
  for (const listing of listings) {
    const sport = SPORTS.find(item => item.sport === listing.sport), count = listing.courts.length;
    const baseNames = [...new Set(listing.courts.map(court => bases.get(court.baza_sportiva_id)?.nume).filter(Boolean))];
    const prices = listing.courts.map(court => court.pret).filter(price => price !== null);
    const intro = `În ${listing.city} găsești ${count === 1 ? 'un teren' : `${count} terenuri`} de ${sport.label} pe Spotivity${baseNames.length ? `, la ${baseNames.join(', ')}` : ''}.${prices.length ? ` Tariful publicat începe de la ${Math.min(...prices)} Lei/oră.` : ''} Alege terenul, verifică programul și rezervă online ora potrivită.`;
    const otherCities = listings.filter(other => other.sport === listing.sport && other !== listing);
    const otherSports = listings.filter(other => other.sport !== listing.sport && paths.citySlug(other.city) === paths.citySlug(listing.city));
    const related = `<nav class="category-related" aria-label="Pagini apropiate">${[link(`terenuri/${sport.slug}/`, `Toate terenurile de ${sport.label}`), ...otherSports.map(other => link(other.route, `Terenuri de ${sportLabel(other.sport)} în ${other.city}`))].join(' ')}</nav>`;
    files.set(listing.route + 'index.html', listingPage(sport, { city: listing.city, courts: listing.courts, route: listing.route,
      title: `Terenuri de ${sport.label} în ${listing.city} – Rezervări online | Spotivity`,
      description: `Terenuri de ${sport.label} în ${listing.city}: vezi ${count === 1 ? 'terenul publicat' : `cele ${count} terenuri publicate`} și tarifele, verifică programul și rezervă online pe Spotivity.`,
      intro, crumbs: [{ route: './', label: 'Acasă' }, { route: `terenuri/${sport.slug}/`, label: `Terenuri de ${sport.label}` }, { label: listing.city }],
      extra: cityList(otherCities.map(other => ({ route: other.route, label: other.city })), { id: 'category-cities-title', text: `Terenuri de ${sport.label} în alte orașe` }),
      related }));
  }
  for (const court of catalog.courts) {
    const base = bases.get(court.baza_sportiva_id), sport = SPORTS.find(item => item.sport === court.sport), route = index.courts[String(court.id)];
    const title = `${court.nume}${base ? `, ${base.nume}` : ''} – ${sport.label} în ${court.oras} | Spotivity`;
    const description = `Rezervă terenul ${court.nume} pentru ${sport.label} în ${court.oras}${base ? `, la ${base.nume}` : ''}. Consultă tariful publicat și verifică programul actualizat pe Spotivity.`;
    const crumbs = [{ route: './', label: 'Acasă' }, { route: `terenuri/${sport.slug}/`, label: `Terenuri de ${sport.label}` }];
    const cityRoute = paths.cityPath(court.sport, court.oras);
    if (cityRoute) crumbs.push({ route: cityRoute, label: court.oras });
    if (base) crumbs.push({ route: index.bases[String(base.id)], label: base.nume, attributes: ` data-entity-base-id="${escape(base.id)}"` });
    crumbs.push({ label: court.nume });
    const detail = `${breadcrumb(crumbs)}<section class="entity-page" aria-labelledby="entity-title"><p class="entity-eyebrow">Teren de ${escape(sport.label)} · ${escape(court.oras)}</p><h1 id="entity-title">${escape(court.nume)} — ${escape(court.oras)}</h1><p class="entity-intro">Teren de ${escape(sport.label)} în ${escape(court.oras)}${base ? `, în baza sportivă ${link(index.bases[String(base.id)], base.nume, ` data-entity-base-id="${escape(base.id)}"`)}` : ''}.</p>${court.pret === null ? '' : `<p class="entity-price">Tarif publicat: ${escape(court.pret)} Lei/oră</p>`}<button type="button" class="home-reserve-button" data-entity-booking="${escape(court.id)}">Verifică programul și rezervă</button>${snapshotNote(catalog)}<nav class="category-related" aria-label="Terenuri de ${escape(sport.label)}">${link(`terenuri/${sport.slug}/`, `Vezi toate terenurile de ${sport.label}`)}</nav></section>`;
    const html = stripped.replace(/(<main\b[^>]*>)/i, (_, opening) => `${opening}\n${detail}`);
    files.set(route + 'index.html', finish(html, { baseUrl, route, title, description, sport: court.sport, bodyAttribute: ` data-court-id="${escape(court.id)}"`, kind: 'court', court, base }));
  }
  for (const base of catalog.bases) {
    const route = index.bases[String(base.id)], courts = catalog.courts.filter(court => court.baza_sportiva_id === String(base.id));
    const title = `${base.nume} – Bază sportivă în ${base.oras} | Spotivity`;
    const description = `${base.nume}, bază sportivă în ${base.oras}. Descoperă terenurile publicate și verifică programul de rezervări online pe Spotivity.`;
    const detail = `${breadcrumb([{ route: './', label: 'Acasă' }, { label: base.nume }])}<section class="entity-page" aria-labelledby="entity-title"><p class="entity-eyebrow">Bază sportivă · ${escape(base.oras)}</p><h1 id="entity-title">${escape(base.nume)} — ${escape(base.oras)}</h1><p class="entity-intro">Bază sportivă în ${escape(base.oras)}.</p>${base.descriere ? `<p class="entity-description">${escape(base.descriere)}</p>` : ''}<button type="button" class="home-reserve-button" data-entity-base="${escape(base.id)}">Vezi terenurile bazei</button><h2>Terenuri la ${escape(base.nume)}</h2><div class="entity-courts">${courts.length ? courtCards(courts, index) : '<p>Momentan nu sunt terenuri publicate la această bază sportivă.</p>'}</div>${snapshotNote(catalog)}</section>`;
    const html = stripped.replace(/(<main\b[^>]*>)/i, (_, opening) => `${opening}\n${detail}`);
    files.set(route + 'index.html', finish(html, { baseUrl, route, title, description, bodyAttribute: ` data-base-id="${escape(base.id)}"`, kind: 'base', base }));
  }
  files.set('js/seo-route-index.js', `// Generated from the reviewed anonymous public catalog. No account data.\nwindow.spotivitySeoRoutes = ${JSON.stringify(index)};\n`);
  files.set('js/seo-alias-redirect.js', `// Generated public alias navigation. No inline script is needed.\n(${redirectSeoAlias.toString()})();\n`);
  files.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', baseUrl).href}\n`);
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...SPORTS.map(({ slug }) => `terenuri/${slug}/`), ...listings.map(listing => listing.route), ...Object.values(index.courts), ...Object.values(index.bases)].map(route => `  <url><loc>${escape(new URL(route, baseUrl).href)}</loc><lastmod>${escape(catalog.refreshedAt.slice(0, 10))}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  for (const { route, target } of seoAliases(catalog, routeHistory)) {
    const csp = template.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
    const referrer = template.match(/<meta\b[^>]*name="referrer"[^>]*>/i)?.[0];
    if (!csp || !referrer) throw new Error('Alias pages require the shared CSP and referrer policy.');
    const prefix = '../'.repeat(route.split('/').filter(Boolean).length);
    const canonical = new URL(target, baseUrl).href;
    files.set(route + 'index.html', `<!doctype html>\n${GENERATED_MARKER}\n<html lang="ro"><head><meta charset="UTF-8">${csp}${referrer}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,follow"><title>Adresă actualizată | Spotivity</title><link rel="canonical" href="${escape(canonical)}"><script src="${prefix}js/seo-alias-redirect.js" defer></script></head><body><main><h1>Pagina s-a mutat</h1><p>Adresa acestui teren sau a bazei sportive a fost actualizată.</p><p><a id="seo-alias-destination" href="${prefix + target}">Continuă către pagina actuală</a></p><p><a href="${prefix}">Pagina principală Spotivity</a></p></main></body></html>\n`);
  }
  return new Map(seoPaths(catalog, routeHistory).map(relative => [relative, files.get(relative)]));
}
