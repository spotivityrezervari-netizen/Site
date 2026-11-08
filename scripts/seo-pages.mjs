// Deterministic, reviewed public category pages. Never read privileged data here.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

export const PAGES_BASE_URL = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';
export const PRODUCTION_BASE_URL = 'https://spotivity.ro/';
export const SPORTS = Object.freeze([
  { sport: 'Fotbal', slug: 'fotbal', label: 'fotbal', intro: 'Găsește terenuri de fotbal pentru meciurile cu prietenii. Compară terenurile și orașele, apoi verifică programul și alege ora potrivită pentru echipa ta.' },
  { sport: 'Baschet', slug: 'baschet', label: 'baschet', intro: 'Descoperă terenuri de baschet pentru antrenamente și meciuri între prieteni. Alege terenul din orașul tău și verifică intervalele de rezervare în formular.' },
  { sport: 'Tenis', slug: 'tenis', label: 'tenis', intro: 'Caută terenuri de tenis pentru partide de simplu, dublu sau antrenamente. Vezi terenurile și tarifele publicate, apoi selectează data și ora în formularul de rezervare.' },
  { sport: 'Volei', slug: 'volei', label: 'volei', intro: 'Alege un teren de volei pentru următorul joc cu echipa. Consultă terenurile pe orașe și verifică programul de rezervare înainte de a stabili întâlnirea.' },
  { sport: 'Tenis Picior', slug: 'tenis-de-picior', label: 'tenis de picior', intro: 'Găsește terenuri de tenis de picior pentru jocuri cu prietenii și antrenamente. Alege locația potrivită și consultă intervalele din formularul de rezervare.' }
].map(sport => Object.freeze({
  ...sport,
  title: `Terenuri de ${sport.label} – Rezervări online | Spotivity`,
  description: `Descoperă terenuri de ${sport.label} pe Spotivity. Compară locațiile și tarifele publicate, verifică programul și rezervă online un teren.`
})));
export const SEO_PATHS = Object.freeze([...SPORTS.map(({ slug }) => `terenuri/${slug}/index.html`), 'robots.txt', 'sitemap.xml']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const normalizeSport = value => value === 'Tenis de picior' ? 'Tenis Picior' : value;
const validId = value => Number.isSafeInteger(value) && value > 0 || typeof value === 'string' && /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value);

export function validateCatalog(catalog) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.courts) || catalog.courts.length > 100000 ||
      Object.keys(catalog).some(key => !['version', 'refreshedAt', 'courts'].includes(key)) ||
      typeof catalog.refreshedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(catalog.refreshedAt) || !Number.isFinite(Date.parse(catalog.refreshedAt))) {
    throw new Error('Invalid public SEO catalog. Refresh the reviewed public snapshot.');
  }
  const seen = new Set();
  return catalog.courts.map(row => {
    if (!row || Object.keys(row).some(key => !['id', 'nume', 'sport', 'oras', 'pret'].includes(key)) ||
        !validId(row.id) || seen.has(String(row.id)) ||
        typeof row.nume !== 'string' || !row.nume.trim() || row.nume.length > 200 ||
        typeof row.oras !== 'string' || !row.oras.trim() || row.oras.length > 120 ||
        !SPORTS.some(({ sport }) => sport === normalizeSport(row.sport)) ||
        !(row.pret === null || typeof row.pret === 'number' && Number.isFinite(row.pret) && row.pret >= 0 && row.pret <= 1000000)) {
      throw new Error('Invalid or unapproved field in public SEO court snapshot.');
    }
    seen.add(String(row.id));
    return { id: row.id, nume: row.nume.trim(), sport: normalizeSport(row.sport), oras: row.oras.trim().replace(/\.+$/, ''), pret: row.pret };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
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

// The template is maintained as plain HTML. Only the known balanced sport
// sections are transformed; a changed template fails instead of omitting pages.
function sportSections(template) {
  const sections = [];
  const expression = /<\/?section\b[^>]*>/gi;
  let match, open = [];
  while ((match = expression.exec(template))) {
    if (/^<\/section/i.test(match[0])) {
      const section = open.pop();
      if (!section) throw new Error('Unbalanced section in SEO template.');
      if (section.sport) sections.push({ ...section, end: expression.lastIndex });
    } else {
      const sport = match[0].match(/\bdata-home-sport="([^"]+)"/);
      open.push({ start: match.index, sport: sport?.[1] });
    }
  }
  if (open.length || sections.length !== SPORTS.length || SPORTS.some(({ sport }) => sections.filter(section => section.sport === sport).length !== 1)) {
    throw new Error('SEO template must contain exactly the five reviewed sport sections.');
  }
  return sections;
}

function metadata(html, { baseUrl, title, description, route = '' }) {
  const canonical = new URL(route, baseUrl).href;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escape(title)}</title>`);
  const replacements = new Map([
    ['name="description"', description], ['property="og:title"', title],
    ['property="og:description"', description], ['property="og:url"', canonical],
    ['property="og:image"', new URL('assets/imagini/avatar2.png', baseUrl).href]
  ]);
  for (const [attribute, value] of replacements) {
    const pattern = new RegExp(`<meta\\s+${attribute}\\s+content="[^"]*"\\s*\\/?>`, 'i');
    if (!pattern.test(html)) throw new Error(`SEO template is missing ${attribute}.`);
    html = html.replace(pattern, `<meta ${attribute} content="${escape(value)}">`);
  }
  if (!/<link rel="canonical" href="[^"]*"\s*\/?>/i.test(html)) throw new Error('SEO template is missing its canonical link.');
  return html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${escape(canonical)}">`);
}

export function productionHome(html) {
  // Keep the reviewed home copy and replace only its deployment-dependent URLs.
  return html.replace(/(<link rel="canonical" href=")[^"]*(")/i, `$1${PRODUCTION_BASE_URL}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${PRODUCTION_BASE_URL}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/i, `$1${new URL('assets/imagini/avatar2.png', PRODUCTION_BASE_URL).href}$2`);
}

function staticCards(courts) {
  return courts.map(court => `<button type="button" class="home-court-card" data-seo-court-id="${escape(court.id)}" aria-label="Rezervă ${escape(court.nume)}, ${escape(court.oras)}"><span class="home-court-details"><strong>${escape(court.nume)}</strong><span class="home-court-meta">${escape(court.oras)}</span>${court.pret === null ? '' : `<span class="home-court-price">${escape(String(court.pret))} Lei/oră</span>`}</span></button>`).join('\n');
}

export function generateSeoFiles({ template, catalog, baseUrl = PAGES_BASE_URL }) {
  if (![PAGES_BASE_URL, PRODUCTION_BASE_URL].includes(baseUrl)) throw new Error('Unreviewed SEO deployment origin.');
  const courts = validateCatalog(catalog);
  const sections = sportSections(template);
  const files = new Map();
  for (const sport of SPORTS) {
    let html = template;
    for (const section of [...sections].sort((a, b) => b.start - a.start)) {
      if (section.sport !== sport.sport) html = html.slice(0, section.start) + html.slice(section.end);
    }
    const selected = sportSectionsInCategory(html, sport.sport);
    let section = html.slice(selected.start, selected.end);
    const heading = /<h[12]\b([^>]*)>[^<]*<\/h[12]>/i;
    if (!heading.test(section)) throw new Error(`Missing sport heading: ${sport.slug}`);
    section = section.replace(heading, (_, attributes) => `<h1${attributes.replace(/\sdata-i18n="[^"]*"/gi, '')}>Terenuri de ${sport.label}</h1>`);
    section = section.replace(/(<\/h1>\s*<\/div>)/, `$1\n<p class="category-intro">${escape(sport.intro)}</p>`);
    // The home CTA navigates to this category. Within a category it opens the
    // existing sport/court chooser, whose backend still validates availability.
    section = section.replace(/<a\b([^>]*\bclass="[^"]*\bcard-sport\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i,
      (_, attributes, text) => `<button type="button"${attributes.replace(/\s(?:href|aria-current)="[^"]*"/gi, '')}>${text}</button>`);
    section = section.replace(/\bloading="lazy"/, 'loading="eager" fetchpriority="high"');
    const selectedCourts = courts.filter(court => court.sport === sport.sport);
    const strip = /(<div\b[^>]*\bdata-home-courts="[^"]+"[^>]*>)[\s\S]*?(<\/div>)/;
    if (!strip.test(section)) throw new Error(`Missing public court strip: ${sport.slug}`);
    const content = selectedCourts.length ? staticCards(selectedCourts) : '<p class="home-discovery-message">Momentan nu sunt terenuri publicate pentru acest sport.</p>';
    section = section.replace(strip, (_, opening, closing) => `${opening.replace(/aria-busy="true"/, 'aria-busy="false"')}${content}${closing}<p class="category-catalog-note">Catalog public actualizat la ${escape(catalog.refreshedAt.slice(0, 10))}. Tariful și disponibilitatea se verifică în formularul de rezervare.</p>`);
    const breadcrumb = `<nav class="category-breadcrumb" aria-label="Navigare"><a href="./">Acasă</a><span aria-current="page">Terenuri de ${escape(sport.label)}</span></nav>\n`;
    const related = `<nav class="category-related" aria-label="Alte sporturi">${SPORTS.filter(other => other !== sport).map(other => `<a href="terenuri/${other.slug}/">Terenuri de ${escape(other.label)}</a>`).join(' ')}</nav>`;
    html = html.slice(0, selected.start) + breadcrumb + section + related + html.slice(selected.end);
    html = html.replace(/<body\b([^>]*)>/i, `<body$1 data-category-sport="${escape(sport.sport)}">`);
    html = html.replace(/(<a\b[^>]*\bid="home-brand"[^>]*\bhref=")[^"]*(")/i, '$1./$2');
    html = html.replace(/<a\b[^>]*\bdata-sport-target="[^"]*"[^>]*>/gi, tag =>
      tag.includes(`data-sport-target="${sport.sport}"`) ? tag.replace(/\saria-current="[^"]*"/gi, '').replace(/>$/, ' aria-current="page">') : tag);
    // Meaningful navigation and catalog remain available without JavaScript;
    // live schedules and booking require the existing authenticated app flow.
    html = html.replace('</main>', '<noscript><p class="category-catalog-note">Activează JavaScript pentru programul actualizat și rezervarea unui teren.</p></noscript>\n</main>');
    html = metadata(html, { ...sport, baseUrl, route: `terenuri/${sport.slug}/` });
    // No <base> (base-uri 'none'). Both a Pages subdirectory and Netlify root
    // work with the same page bytes and ordinary browser URL resolution.
    html = html.replace(/\b(src|href)="([^"]*)"/gi, (attribute, name, value) => {
      if (/^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/|#|\/)/.test(value)) return attribute;
      return `${name}="${value === './' ? '../../' : `../../${value}`}"`;
    });
    files.set(`terenuri/${sport.slug}/index.html`, html);
  }
  files.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', baseUrl).href}\n`);
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...SPORTS.map(({ slug }) => `terenuri/${slug}/`)].map(route => `  <url><loc>${escape(new URL(route, baseUrl).href)}</loc></url>`).join('\n')}\n</urlset>\n`);
  return files;
}

function sportSectionsInCategory(html, sport) {
  const opening = new RegExp(`<section\\b[^>]*\\bdata-home-sport="${sport}"[^>]*>`, 'i').exec(html);
  if (!opening) throw new Error('Selected category section is missing.');
  const expression = /<\/?section\b[^>]*>/gi;
  expression.lastIndex = opening.index;
  let depth = 0, match;
  while ((match = expression.exec(html))) {
    depth += /^<\/section/i.test(match[0]) ? -1 : 1;
    if (depth === 0) return { start: opening.index, end: expression.lastIndex };
  }
  throw new Error('Selected category section is unbalanced.');
}
