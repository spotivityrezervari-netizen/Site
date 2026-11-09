import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { SPORTS, SEO_PATHS, PAGES_BASE_URL, PRODUCTION_BASE_URL, GENERATED_MARKER, generateSeoFiles, validateCatalog, seoPaths } from '../seo-pages.mjs';
import { generateSourcePages } from '../generate-seo-pages.mjs';
import { snapshotFromPublicRows, publicCredentials } from '../refresh-seo-catalog.mjs';
import { buildPublic } from '../build-public.mjs';
const require = createRequire(import.meta.url), paths = require('../../Idee Site/js/entity-paths.js');
const baseId = '00000000-0000-0000-0000-000000000001';
const template = `<!doctype html><html lang="ro"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; script-src 'self'"><meta name="referrer" content="no-referrer"><title>Home</title><meta name="description" content="Home description"><meta property="og:title" content="Home"><meta property="og:description" content="Home description"><meta property="og:url" content="${PAGES_BASE_URL}"><meta property="og:image" content="${PAGES_BASE_URL}assets/imagini/logo.png"><link rel="canonical" href="${PAGES_BASE_URL}"><script src="js/main.js"></script></head><body><a id="home-brand" href="#top">Home</a><nav>${SPORTS.map(sport => `<a data-sport-target="${sport.sport}" href="terenuri/${sport.slug}/">${sport.sport}</a>`).join('')}</nav><main>${SPORTS.map((sport, index) => `<section data-home-sport="${sport.sport}"><div class="home-hero-copy"><div class="home-sport-heading"><h${index ? 2 : 1} id="sport-title-${sport.slug}" data-i18n="sport">${sport.sport}</h${index ? 2 : 1}></div><button type="button" class="card-sport home-reserve-button" data-sport="${sport.sport}">Rezervă</button></div><img src="assets/imagini/logo.png" loading="lazy"><div data-home-courts="${sport.sport}" aria-busy="true"></div></section>`).join('')}<section id="bases"><div id="home-bases-directory">Bases</div></section><section id="signup">Signup</section></main><div id="modal-terenuri">Existing booking modal</div></body></html>`;
const catalog = { version: 2, refreshedAt: '2026-11-09T09:00:00.000Z', bases: [{ id: baseId, nume: 'Bază Ștefănești', oras: 'Reghin', descriere: 'Bază pentru sport și întâlniri cu prietenii.' }], courts: [{ id: 1, nume: 'Court & One', sport: 'Fotbal', oras: 'Reghin', pret: 150, baza_sportiva_id: baseId }] };
const courtPath = input => paths.courtPath(input, catalog.bases[0]);
async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spotivity-seo-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const put = async (relative, content) => { await mkdir(path.dirname(path.join(repoRoot, relative)), { recursive: true }); await writeFile(path.join(repoRoot, relative), content); };
  await put('Idee Site/index.html', template);
  await put('Idee Site/js/main.js', 'window.app=true;');
  await put('Idee Site/assets/imagini/logo.png', Buffer.from([0x89, 0x50]));
  await put('scripts/seo-public-catalog.json', JSON.stringify(catalog));
  await put('scripts/public-files.json', JSON.stringify({ version: 1, files: ['index.html', 'js/main.js', 'assets/imagini/logo.png', ...SEO_PATHS].sort() }));
  await put('deploy/netlify/_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  return { repoRoot, put };
}

test('five categories keep one static H1, original booking controls and real crawlable court links', () => {
  const generated = generateSeoFiles({ template, catalog });
  assert.deepEqual([...generated.keys()], seoPaths(catalog));
  for (const sport of SPORTS) {
    const relative = `terenuri/${sport.slug}/index.html`, html = generated.get(relative);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(html.includes(`<h1 id="sport-title-${sport.slug}">Terenuri de ${sport.label}</h1>`));
    assert.ok(html.includes(`data-category-sport="${sport.sport}"`));
    assert.equal((html.match(/data-home-sport=/g) || []).length, 1);
    assert.ok(html.includes('id="home-bases-directory"') && html.includes('<section id="signup">'));
    assert.ok(html.includes('<div id="modal-terenuri">'));
    assert.ok(html.includes(`<button type="button" class="card-sport home-reserve-button" data-sport="${sport.sport}">`));
    assert.ok(html.includes('<a id="home-brand" href="../../">'));
    assert.ok(html.includes('src="../../js/main.js"'));
    assert.ok(html.includes('loading="eager" fetchpriority="high"'));
    assert.ok(html.includes(`<title>${sport.title}</title>`));
    assert.ok(html.includes(`href="${PAGES_BASE_URL}terenuri/${sport.slug}/"`));
    assert.ok(html.includes('class="category-intro"') && html.includes('<noscript>'));
    assert.ok(html.includes('aria-current="page"'));
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
    assert.doesNotMatch(html, /<base\b|<script[^>]*>[^<]+<\/script>|\son\w+=/i);
    if (sport.sport === 'Fotbal') {
      assert.ok(html.includes('Court &amp; One'));
      assert.ok(html.includes(`href="../../${courtPath(catalog.courts[0])}"`));
      assert.match(html, /<a[^>]*class="home-court-card"[^>]*data-entity-court-id="1"/);
    } else assert.ok(html.includes('Momentan nu sunt terenuri publicate pentru acest sport.'));
  }
  assert.equal((generated.get('sitemap.xml').match(/<loc>/g) || []).length, 8);
  assert.ok(generated.get('robots.txt').includes(`${PAGES_BASE_URL}sitemap.xml`));
});

test('individual court and base documents contain real details, unique metadata, direct controls and related links without JavaScript', () => {
  const generated = generateSeoFiles({ template, catalog });
  const courtRoute = courtPath(catalog.courts[0]), baseRoute = paths.basePath(catalog.bases[0]);
  const court = generated.get(courtRoute + 'index.html'), base = generated.get(baseRoute + 'index.html');
  assert.match(court, /data-court-id="1"/);
  assert.match(court, /<h1 id="entity-title">Court &amp; One — Reghin<\/h1>/);
  assert.ok(courtRoute.startsWith('terenuri/fotbal/reghin-'));
  const courtTitle = court.match(/<title>([^<]*)<\/title>/)?.[1] || '';
  for (const label of ['Court &amp; One', 'Bază Ștefănești', 'Reghin']) assert.ok(courtTitle.includes(label));
  assert.ok(court.includes('150 Lei/oră') && court.includes('Reghin') && court.includes('Bază Ștefănești'));
  assert.ok(court.includes(`href="../../../${baseRoute}"`) && court.includes('data-entity-booking="1"'));
  assert.ok(court.includes(`href="${PAGES_BASE_URL}${courtRoute}"`) && court.includes('src="../../../js/main.js"'));
  assert.ok(base.includes(`data-base-id="${baseId}"`) && base.includes('data-entity-base='));
  assert.match(base, /<h1 id="entity-title">Bază Ștefănești — Reghin<\/h1>/);
  assert.ok(baseRoute.startsWith('baze-sportive/reghin-'));
  assert.match(base, /<title>Bază Ștefănești[^<]*Reghin[^<]*<\/title>/);
  assert.ok(base.includes(catalog.bases[0].descriere));
  assert.ok(base.includes(`href="../../${courtRoute}"`) && base.includes('data-entity-court-id="1"'));
  assert.ok(base.includes(`href="${PAGES_BASE_URL}${baseRoute}"`) && base.includes('src="../../js/main.js"'));
  for (const html of [court, base]) {
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(html.includes('id="home-bases-directory"') && html.includes('id="modal-terenuri"'));
    assert.ok(html.includes(GENERATED_MARKER) && html.includes('2026-11-09'));
    assert.doesNotMatch(html, /<base\b|\son\w+\s*=/i);
  }
  const index = generated.get('js/seo-route-index.js');
  assert.ok(index.includes(JSON.stringify(courtRoute)) && index.includes(JSON.stringify(baseRoute)));
  assert.doesNotMatch(index, /Bază|Court & One|150|descriere|email/);
});

test('every sport and identical or unusual names have safe unique stable-ID routes', () => {
  const input = structuredClone(catalog);
  input.courts = SPORTS.flatMap((sport, index) => [1, 2].map(copy => ({ id: index * 2 + copy, nume: 'Ștrand / .. / Ștefănești', sport: sport.sport, oras: 'Reghin', pret: null, baza_sportiva_id: baseId })));
  input.courts.push({ id: '00000000-0000-0000-0000-000000000099', nume: '<script>same name</script>', sport: 'Tenis de picior', oras: 'Reghin', pret: 0, baza_sportiva_id: null });
  const files = generateSeoFiles({ template, catalog: input });
  const routes = seoPaths(input).filter(relative => relative.startsWith('terenuri/') && relative.split('/').length === 4);
  assert.equal(routes.length, 11);
  assert.equal(new Set(routes).size, routes.length);
  for (const relative of routes) {
    assert.match(relative, /^terenuri\/[a-z-]+\/[a-z0-9-]+\/index\.html$/);
    assert.ok(!relative.includes('..') && !relative.includes('%'));
    assert.ok(relative.split('/')[2].startsWith('reghin-'));
    assert.ok(files.has(relative));
  }
  assert.ok(routes.some(relative => relative.includes('tenis-de-picior/')));
});

test('untrusted public text is escaped and private fields, duplicates, foreign memberships and malformed input are rejected', () => {
  const malicious = structuredClone(catalog);
  malicious.courts[0].nume = '<img src=x onerror="bad()">';
  malicious.courts[0].oras = '<script>alert(1)</script>';
  malicious.bases[0].descriere = '<iframe src="javascript:bad()">private-looking text</iframe>';
  const generated = generateSeoFiles({ template, catalog: malicious });
  const court = generated.get(paths.courtPath(malicious.courts[0], malicious.bases[0]) + 'index.html');
  const base = generated.get(paths.basePath(malicious.bases[0]) + 'index.html');
  assert.ok(court.includes('&lt;img src=x onerror=&quot;bad()&quot;&gt;') && court.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(base.includes('&lt;iframe src=&quot;javascript:bad()&quot;&gt;'));
  assert.doesNotMatch(court + base, /<img src=x|<script>alert|<iframe/);
  for (const collection of ['courts', 'bases']) for (const key of ['email', 'telefon', 'admin_id', 'service_key']) {
    const input = structuredClone(catalog); input[collection][0][key] = 'private';
    assert.throws(() => validateCatalog(input), /unapproved field/);
  }
  const foreign = structuredClone(catalog); foreign.courts[0].baza_sportiva_id = '00000000-0000-0000-0000-000000000999';
  assert.throws(() => validateCatalog(foreign), /unapproved/);
  const duplicate = structuredClone(catalog); duplicate.courts.push(duplicate.courts[0]);
  assert.throws(() => validateCatalog(duplicate), /unapproved/);
  assert.throws(() => generateSeoFiles({ template, catalog, baseUrl: 'https://attacker.invalid/' }), /Unreviewed/);
  assert.throws(() => generateSeoFiles({ template: template.replace('data-home-sport="Volei"', 'data-home-sport="Other"'), catalog }), /five reviewed/);
});

test('anonymous refresh projects approved public fields and excludes inactive bases, courts and empty unpublished profiles', () => {
  const court = { ...catalog.courts[0], email: 'private@example.test', telefon: 'private', poza: 'private-photo', este_activ: true };
  const activeBase = { ...catalog.bases[0], este_activa: true, admin_email: 'private@example.test' };
  const inactiveBaseId = '00000000-0000-0000-0000-000000000002';
  const emptyBaseId = '00000000-0000-0000-0000-000000000003';
  const result = snapshotFromPublicRows([court, { ...court, id: 2, este_activ: false }, { ...court, id: 3, baza_sportiva_id: inactiveBaseId }, { ...court, id: 4, baza_sportiva_id: null }], [activeBase, { ...activeBase, id: inactiveBaseId, este_activa: false }, { ...activeBase, id: emptyBaseId }], catalog.refreshedAt);
  assert.deepEqual(result.courts.map(row => row.id), [1, 4]);
  assert.deepEqual(result.bases.map(row => row.id), [baseId]);
  assert.deepEqual(Object.keys(result.courts[0]), ['id', 'nume', 'sport', 'oras', 'pret', 'baza_sportiva_id']);
  assert.deepEqual(Object.keys(result.bases[0]), ['id', 'nume', 'oras', 'descriere']);
  assert.doesNotMatch(JSON.stringify(result), /private|email|telefon|poza/);
  const key = role => `header.${Buffer.from(JSON.stringify({ role, ref: 'ndubcdwohqzgxpuiowye' })).toString('base64url')}.signature`;
  const config = role => `const supabaseUrl = 'https://ndubcdwohqzgxpuiowye.supabase.co'; const supabaseKey = '${key(role)}';`;
  assert.equal(publicCredentials(config('anon')).url, 'https://ndubcdwohqzgxpuiowye.supabase.co');
  assert.throws(() => publicCredentials(config('service_role')), /public anon/);
});

test('replacement metacharacters in public names and descriptions remain literal text without duplicated markup', () => {
  const input = structuredClone(catalog);
  const name = "$& $1 $` $' & <name>";
  input.courts[0].nume = name;
  input.bases[0].nume = name;
  input.bases[0].descriere = name;
  const generated = generateSeoFiles({ template, catalog: input });
  for (const [relative, html] of generated) if (relative.endsWith('.html')) {
    assert.equal((html.match(/<title\b/g) || []).length, 1, relative);
    assert.equal((html.match(/<main\b/g) || []).length, 1, relative);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, relative);
    assert.doesNotMatch(html, /<name>/, relative);
  }
  const html = generated.get(paths.courtPath(input.courts[0], input.bases[0]) + 'index.html');
  assert.ok(html.includes('<h1 id="entity-title">$&amp; $1 $` $&#39; &amp; &lt;name&gt; — Reghin</h1>'));
  assert.ok(generated.get(paths.basePath(input.bases[0]) + 'index.html').includes('<p class="entity-description">$&amp; $1 $` $&#39; &amp; &lt;name&gt;</p>'));
});

test('source and route index generation is deterministic, drift guarded, with production-only metadata rewrites', async t => {
  const { repoRoot, put } = await fixture(t);
  await generateSourcePages({ repoRoot }); await generateSourcePages({ repoRoot, check: true });
  const relative = courtPath(catalog.courts[0]) + 'index.html', before = await readFile(path.join(repoRoot, 'Idee Site', relative));
  await generateSourcePages({ repoRoot });
  assert.deepEqual(await readFile(path.join(repoRoot, 'Idee Site', relative)), before);
  await buildPublic({ repoRoot });
  const html = await readFile(path.join(repoRoot, 'dist', relative), 'utf8');
  assert.ok(html.includes(`href="${PRODUCTION_BASE_URL}${courtPath(catalog.courts[0])}"`));
  assert.doesNotMatch(html, /https:\/\/spotivityrezervari-netizen\.github\.io/);
  assert.ok((await readFile(path.join(repoRoot, 'dist/index.html'), 'utf8')).includes(`href="${PRODUCTION_BASE_URL}"`));
  assert.ok((await readFile(path.join(repoRoot, 'dist/sitemap.xml'), 'utf8')).includes(PRODUCTION_BASE_URL + paths.basePath(catalog.bases[0])));
  await put('Idee Site/js/seo-route-index.js', 'window.spotivitySeoRoutes={};');
  await assert.rejects(generateSourcePages({ repoRoot, check: true }), /stale/);
  await assert.rejects(buildPublic({ repoRoot }), /stale/);
  assert.equal(await readFile(path.join(repoRoot, 'dist', relative), 'utf8'), html);
});

test('regeneration retires only owned removed/renamed entity files and their manifest entries', async t => {
  const { repoRoot, put } = await fixture(t);
  await generateSourcePages({ repoRoot });
  const oldRelative = courtPath(catalog.courts[0]) + 'index.html';
  const foreignRelative = 'terenuri/fotbal/contributor-page/index.html';
  await put('Idee Site/' + foreignRelative, '<h1>A contributor page remains untouched</h1>');
  const changed = structuredClone(catalog); changed.courts[0].nume = 'Renamed Court';
  await put('scripts/seo-public-catalog.json', JSON.stringify(changed));
  await assert.rejects(generateSourcePages({ repoRoot, check: true }), /Obsolete/);
  await generateSourcePages({ repoRoot }); await generateSourcePages({ repoRoot, check: true });
  await assert.rejects(access(path.join(repoRoot, 'Idee Site', oldRelative)), { code: 'ENOENT' });
  assert.ok((await readFile(path.join(repoRoot, 'Idee Site', foreignRelative), 'utf8')).includes('contributor'));
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'scripts/public-files.json')));
  assert.ok(!manifest.files.includes(oldRelative));
  const current = paths.courtPath(changed.courts[0], changed.bases[0]) + 'index.html';
  assert.ok(manifest.files.includes(current));
  await buildPublic({ repoRoot });
  await assert.rejects(access(path.join(repoRoot, 'dist', foreignRelative)), { code: 'ENOENT' });
});

test('exact generated routes do not loosen manifest paths or overwrite foreign files or follow symlinks', async t => {
  const { repoRoot, put } = await fixture(t);
  const entityRelative = courtPath(catalog.courts[0]) + 'index.html';
  await put('Idee Site/' + entityRelative, '<h1>Unowned contributor document</h1>');
  await assert.rejects(generateSourcePages({ repoRoot }), /unowned/);
  await rm(path.join(repoRoot, 'Idee Site', entityRelative));
  await generateSourcePages({ repoRoot });
  const manifestPath = path.join(repoRoot, 'scripts/public-files.json'), manifest = JSON.parse(await readFile(manifestPath));
  manifest.files.push('terenuri/private/index.html'); await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(buildPublic({ repoRoot }), /Unsafe, unsupported/);
  manifest.files.pop(); manifest.files = manifest.files.filter(file => file !== 'sitemap.xml'); await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(buildPublic({ repoRoot }), /complete reviewed SEO/);
  await rm(path.join(repoRoot, 'Idee Site/terenuri/fotbal/index.html'));
  await put('private.html', 'private');
  await symlink(path.join(repoRoot, 'private.html'), path.join(repoRoot, 'Idee Site/terenuri/fotbal/index.html'));
  await assert.rejects(generateSourcePages({ repoRoot }), /symlink/);
});
