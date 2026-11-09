// Deterministic public sport, court and sports-base pages. Only allowlisted
// anonymous catalog fields enter these documents; booking is revalidated live.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const paths = require('../Idee Site/js/entity-paths.js');
const seoData = require('../Idee Site/js/seo-data.js');

export const PAGES_BASE_URL = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
export const PRODUCTION_BASE_URL = 'https://spotivity.ro/';
export const GENERATED_MARKER = '<!-- Spotivity generated public page; edit the shared shell/catalog instead. -->';
export const SPORTS = Object.freeze([
  { sport: 'Fotbal', slug: 'fotbal', label: 'fotbal', intro: 'Găsește terenuri de fotbal pentru meciurile cu prietenii. Compară terenurile și orașele, apoi verifică programul și alege ora potrivită pentru echipa ta.' },
  { sport: 'Baschet', slug: 'baschet', label: 'baschet', intro: 'Descoperă terenuri de baschet pentru antrenamente și meciuri între prieteni. Alege terenul din orașul tău și verifică intervalele de rezervare în formular.' },
  { sport: 'Tenis', slug: 'tenis', label: 'tenis', intro: 'Caută terenuri de tenis pentru partide de simplu, dublu sau antrenamente. Vezi terenurile și tarifele publicate, apoi selectează data și ora în formularul de rezervare.' },
  { sport: 'Volei', slug: 'volei', label: 'volei', intro: 'Alege un teren de volei pentru următorul joc cu echipa. Consultă terenurile pe orașe și verifică programul de rezervare înainte de a stabili întâlnirea.' },
  { sport: 'Tenis Picior', slug: 'tenis-de-picior', label: 'tenis de picior', intro: 'Găsește terenuri de tenis de picior pentru jocuri cu prietenii și antrenamente. Alege locația potrivită și consultă intervalele din formularul de rezervare.' }
].map(sport => Object.freeze({ ...sport, title: `Terenuri de ${sport.label} – Rezervări online | Spotivity`, description: `Descoperă terenuri de ${sport.label} pe Spotivity. Compară locațiile și tarifele publicate, verifică programul și rezervă online un teren.` })));
export const SEO_PATHS = Object.freeze([...SPORTS.map(({ slug }) => `terenuri/${slug}/index.html`), 'js/seo-route-index.js', 'robots.txt', 'sitemap.xml']);
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

function indexFor(catalog) {
  const bases = new Map(catalog.bases.map(base => [String(base.id), base]));
  const courts = Object.fromEntries(catalog.courts.map(court => [String(court.id), paths.courtPath(court, bases.get(court.baza_sportiva_id))]));
  const basePaths = Object.fromEntries(catalog.bases.map(base => [String(base.id), paths.basePath(base)]));
  const all = [...Object.values(courts), ...Object.values(basePaths)];
  if (all.some(relative => !relative || relative.includes('..') || !/^[a-z0-9/-]+\/$/.test(relative)) || new Set(all).size !== all.length) throw new Error('Duplicate or invalid public entity route.');
  return { courts, bases: basePaths };
}
export function seoPaths(input) {
  const catalog = validateCatalog(input), index = indexFor(catalog);
  return [...SEO_PATHS, ...Object.values(index.courts).map(route => route + 'index.html'), ...Object.values(index.bases).map(route => route + 'index.html')];
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
function metadata(html, { baseUrl, title, description, route = '' }) {
  const canonical = new URL(route, baseUrl).href;
  html = html.replace(/<title>[^<]*<\/title>/i, () => `<title>${escape(title)}</title>`);
  const replacements = new Map([['name="description"', description], ['property="og:title"', title], ['property="og:description"', description], ['property="og:url"', canonical], ['property="og:image"', new URL('assets/imagini/avatar2.png', baseUrl).href]]);
  for (const [attribute, value] of replacements) {
    const expression = new RegExp(`<meta\\s+${attribute}\\s+content="[^"]*"\\s*\\/?>`, 'i');
    if (!expression.test(html)) throw new Error(`SEO template is missing ${attribute}.`);
    html = html.replace(expression, () => `<meta ${attribute} content="${escape(value)}">`);
  }
  if (!/<link rel="canonical" href="[^"]*"\s*\/?>/i.test(html)) throw new Error('SEO template is missing its canonical link.');
  return html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, () => `<link rel="canonical" href="${escape(canonical)}">`);
}
export function productionHome(html) {
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/i, `$1${PRODUCTION_BASE_URL}$2`).replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${PRODUCTION_BASE_URL}$2`).replace(/(<meta property="og:image" content=")[^"]*(")/i, `$1${new URL('assets/imagini/avatar2.png', PRODUCTION_BASE_URL).href}$2`);
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
function finish(html, { baseUrl, route, title, description, sport, bodyAttribute, kind, court, base }) {
  html = html.replace(/<body\b([^>]*)>/i, (_, attributes) => `<body${attributes}${sport ? ` data-category-sport="${escape(sport)}"` : ''}${bodyAttribute || ''}>`);
  html = html.replace(/(<a\b[^>]*\bid="home-brand"[^>]*\bhref=")[^"]*(")/i, '$1./$2');
  if (sport) html = html.replace(/<a\b[^>]*\bdata-sport-target="[^"]*"[^>]*>/gi, tag => tag.includes(`data-sport-target="${sport}"`) ? tag.replace(/\saria-current="[^"]*"/gi, '').replace(/>$/, ' aria-current="page">') : tag);
  html = html.replace('</main>', '<noscript><p class="category-catalog-note">Activează JavaScript pentru programul actualizat și rezervarea unui teren.</p></noscript>\n</main>');
  html = metadata(html, { baseUrl, title, description, route });
  html = structuredData(html, { baseUrl, route, title, kind, sport, court, base });
  const prefix = '../'.repeat(route.split('/').filter(Boolean).length);
  html = html.replace(/\b(src|href)="([^"]*)"/gi, (attribute, name, value) => {
    if (/^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/|#|\/)/.test(value)) return attribute;
    return `${name}="${value === './' ? prefix : prefix + value}"`;
  });
  return html.replace(/(<!doctype html>)/i, (_, declaration) => `${declaration}\n${GENERATED_MARKER}`).replace(/[ \t]+(?=\r?$)/gm, '');
}

export function generateSeoFiles({ template, catalog: input, baseUrl = PAGES_BASE_URL }) {
  if (![PAGES_BASE_URL, PRODUCTION_BASE_URL].includes(baseUrl)) throw new Error('Unreviewed SEO deployment origin.');
  const catalog = validateCatalog(input), index = indexFor(catalog), sections = sportSections(template), files = new Map();
  const stripped = withoutSports(template, sections);
  const bases = new Map(catalog.bases.map(base => [String(base.id), base]));
  for (const sport of SPORTS) {
    const source = sections.find(section => section.sport === sport.sport);
    let section = template.slice(source.start, source.end);
    section = section.replace(/<h[12]\b([^>]*)>[^<]*<\/h[12]>/i, (_, attributes) => `<h1${attributes.replace(/\sdata-i18n="[^"]*"/gi, '')}>Terenuri de ${sport.label}</h1>`);
    section = section.replace(/(<\/h1>\s*<\/div>)/, (_, opening) => `${opening}\n<p class="category-intro">${escape(sport.intro)}</p>`);
    section = section.replace(/<a\b([^>]*\bclass="[^"]*\bcard-sport\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i, (_, attributes, text) => `<button type="button"${attributes.replace(/\s(?:href|aria-current)="[^"]*"/gi, '')}>${text}</button>`);
    section = section.replace(/\bloading="lazy"/, 'loading="eager" fetchpriority="high"');
    const courts = catalog.courts.filter(court => court.sport === sport.sport);
    const strip = /(<div\b[^>]*\bdata-home-courts="[^"]+"[^>]*>)[\s\S]*?(<\/div>)/;
    if (!strip.test(section)) throw new Error(`Missing public court strip: ${sport.slug}`);
    section = section.replace(strip, (_, opening, closing) => `${opening.replace(/aria-busy="true"/, 'aria-busy="false"')}${courts.length ? courtCards(courts, index) : '<p class="home-discovery-message">Momentan nu sunt terenuri publicate pentru acest sport.</p>'}${closing}${snapshotNote(catalog)}`);
    const intro = breadcrumb([{ route: './', label: 'Acasă' }, { label: `Terenuri de ${sport.label}` }]);
    const related = `<nav class="category-related" aria-label="Alte sporturi">${SPORTS.filter(other => other !== sport).map(other => link(`terenuri/${other.slug}/`, `Terenuri de ${other.label}`)).join(' ')}</nav>`;
    const html = stripped.replace(/(<main\b[^>]*>)/i, (_, opening) => `${opening}\n${intro}${section}${related}`);
    files.set(`terenuri/${sport.slug}/index.html`, finish(html, { baseUrl, route: `terenuri/${sport.slug}/`, ...sport, kind: 'sport' }));
  }
  for (const court of catalog.courts) {
    const base = bases.get(court.baza_sportiva_id), sport = SPORTS.find(item => item.sport === court.sport), route = index.courts[String(court.id)];
    const title = `${court.nume}${base ? `, ${base.nume}` : ''} – ${sport.label} în ${court.oras} | Spotivity`;
    const description = `Rezervă terenul ${court.nume} pentru ${sport.label} în ${court.oras}${base ? `, la ${base.nume}` : ''}. Consultă tariful publicat și verifică programul actualizat pe Spotivity.`;
    const crumbs = [{ route: './', label: 'Acasă' }, { route: `terenuri/${sport.slug}/`, label: `Terenuri de ${sport.label}` }];
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
  files.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', baseUrl).href}\n`);
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...SPORTS.map(({ slug }) => `terenuri/${slug}/`), ...Object.values(index.courts), ...Object.values(index.bases)].map(route => `  <url><loc>${escape(new URL(route, baseUrl).href)}</loc></url>`).join('\n')}\n</urlset>\n`);
  return new Map(seoPaths(catalog).map(relative => [relative, files.get(relative)]));
}
