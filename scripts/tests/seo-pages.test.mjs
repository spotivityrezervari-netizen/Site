import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SPORTS, SEO_PATHS, PAGES_BASE_URL, PRODUCTION_BASE_URL, generateSeoFiles, validateCatalog } from '../seo-pages.mjs';
import { generateSourcePages } from '../generate-seo-pages.mjs';
import { snapshotFromPublicRows, publicCredentials } from '../refresh-seo-catalog.mjs';
import { buildPublic } from '../build-public.mjs';

const template = `<!doctype html><html lang="ro"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; script-src 'self'"><meta name="referrer" content="no-referrer"><title>Home</title><meta name="description" content="Home description"><meta property="og:title" content="Home"><meta property="og:description" content="Home description"><meta property="og:url" content="${PAGES_BASE_URL}"><meta property="og:image" content="${PAGES_BASE_URL}assets/imagini/logo.png"><link rel="canonical" href="${PAGES_BASE_URL}"><script src="js/main.js"></script></head><body><a id="home-brand" href="#top">Home</a><nav>${SPORTS.map(sport => `<a data-sport-target="${sport.sport}" href="terenuri/${sport.slug}/">${sport.sport}</a>`).join('')}</nav><main>${SPORTS.map((sport, index) => `<section data-home-sport="${sport.sport}"><div class="home-hero-copy"><div class="home-sport-heading"><h${index ? 2 : 1} id="sport-title-${sport.slug}" data-i18n="sport">${sport.sport}</h${index ? 2 : 1}></div><a class="card-sport home-reserve-button" data-sport="${sport.sport}" href="terenuri/${sport.slug}/">Rezervă</a></div><img src="assets/imagini/logo.png" loading="lazy"><div data-home-courts="${sport.sport}" aria-busy="true"></div></section>`).join('')}<section id="bases">Bases</section><section id="signup">Signup</section></main><div id="modal-terenuri">Existing booking modal</div></body></html>`;
const catalog = { version: 1, refreshedAt: '2026-11-08T09:00:00.000Z', courts: [{ id: 1, nume: 'Court & One', sport: 'Fotbal', oras: 'Reghin', pret: 150 }] };

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spotivity-seo-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const put = async (relative, content) => {
    await mkdir(path.dirname(path.join(repoRoot, relative)), { recursive: true });
    await writeFile(path.join(repoRoot, relative), content);
  };
  await put('Idee Site/index.html', template);
  await put('Idee Site/js/main.js', 'window.app=true;');
  await put('Idee Site/assets/imagini/logo.png', Buffer.from([0x89, 0x50]));
  await put('scripts/seo-public-catalog.json', JSON.stringify(catalog));
  await put('scripts/public-files.json', JSON.stringify({ version: 1, files: ['index.html', 'js/main.js', 'assets/imagini/logo.png', ...SEO_PATHS] }));
  await put('deploy/netlify/_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  return { repoRoot, put };
}

test('exact five categories have static unique metadata, one heading, related navigation and working relative resources', () => {
  const generated = generateSeoFiles({ template, catalog });
  assert.deepEqual([...generated.keys()], SEO_PATHS);
  for (const sport of SPORTS) {
    const relative = `terenuri/${sport.slug}/index.html`, html = generated.get(relative);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, new RegExp(`<h1 id="sport-title-${sport.slug}">Terenuri de ${sport.label}</h1>`));
    assert.ok(html.includes(`data-category-sport="${sport.sport}"`));
    assert.equal((html.match(/data-home-sport=/g) || []).length, 1);
    assert.ok(html.includes('<section id="bases">') && html.includes('<section id="signup">'));
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
    if (sport.sport === 'Fotbal') assert.ok(html.includes('Court &amp; One'));
    else assert.ok(html.includes('Momentan nu sunt terenuri publicate pentru acest sport.'));
  }
  const sitemap = generated.get('sitemap.xml');
  assert.equal((sitemap.match(/<loc>/g) || []).length, 6);
  assert.ok(generated.get('robots.txt').includes(`${PAGES_BASE_URL}sitemap.xml`));
});

test('untrusted public names/cities are escaped, private fields rejected, origins and malformed template refused', () => {
  const malicious = structuredClone(catalog);
  malicious.courts[0].nume = '<img src=x onerror="bad()">';
  malicious.courts[0].oras = '<script>alert(1)</script>';
  const html = generateSeoFiles({ template, catalog: malicious }).get('terenuri/fotbal/index.html');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;bad()&quot;&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  for (const key of ['email', 'telefon', 'admin_id', 'service_key']) {
    const privateCatalog = structuredClone(catalog);
    privateCatalog.courts[0][key] = 'private';
    assert.throws(() => validateCatalog(privateCatalog), /unapproved field/);
  }
  assert.throws(() => generateSeoFiles({ template, catalog, baseUrl: 'https://attacker.invalid/' }), /Unreviewed/);
  assert.throws(() => generateSeoFiles({ template: template.replace('data-home-sport="Volei"', 'data-home-sport="Other"'), catalog }), /five reviewed/);
  const duplicate = structuredClone(catalog); duplicate.courts.push(duplicate.courts[0]);
  assert.throws(() => validateCatalog(duplicate), /unapproved/);
});

test('catalog refresh projects only reviewed fields and active public memberships with anon credentials', () => {
  const row = { ...catalog.courts[0], email: 'private@example.test', telefon: 'private', poza: 'private-photo', este_activ: true };
  const result = snapshotFromPublicRows([row, { ...row, id: 2, este_activ: false }, { ...row, id: 3, baza_sportiva_id: 'inactive' }, { ...row, id: 4, baza_sportiva_id: 'active' }], [{ id: 'active', este_activa: true }], catalog.refreshedAt);
  assert.deepEqual(result.courts.map(court => court.id), [1, 4]);
  assert.deepEqual(Object.keys(result.courts[0]), ['id', 'nume', 'sport', 'oras', 'pret']);
  const key = role => `header.${Buffer.from(JSON.stringify({ role, ref: 'ndubcdwohqzgxpuiowye' })).toString('base64url')}.signature`;
  const config = role => `const supabaseUrl = 'https://ndubcdwohqzgxpuiowye.supabase.co'; const supabaseKey = '${key(role)}';`;
  assert.equal(publicCredentials(config('anon')).url, 'https://ndubcdwohqzgxpuiowye.supabase.co');
  assert.throws(() => publicCredentials(config('service_role')), /public anon/);
});

test('source generation is deterministic, checks drift, and production artifact rewrites only deployment metadata', async t => {
  const { repoRoot, put } = await fixture(t);
  await generateSourcePages({ repoRoot });
  await generateSourcePages({ repoRoot, check: true });
  const before = await readFile(path.join(repoRoot, 'Idee Site/terenuri/fotbal/index.html'));
  await generateSourcePages({ repoRoot });
  assert.deepEqual(await readFile(path.join(repoRoot, 'Idee Site/terenuri/fotbal/index.html')), before);
  await buildPublic({ repoRoot });
  const html = await readFile(path.join(repoRoot, 'dist/terenuri/fotbal/index.html'), 'utf8');
  const home = await readFile(path.join(repoRoot, 'dist/index.html'), 'utf8');
  assert.ok(html.includes(`href="${PRODUCTION_BASE_URL}terenuri/fotbal/"`));
  assert.ok(home.includes(`href="${PRODUCTION_BASE_URL}"`));
  assert.ok(home.includes(`<meta property="og:image" content="${PRODUCTION_BASE_URL}assets/imagini/avatar2.png">`));
  assert.doesNotMatch(html, /https:\/\/spotivityrezervari-netizen\.github\.io/);
  assert.ok((await readFile(path.join(repoRoot, 'dist/sitemap.xml'), 'utf8')).includes(`${PRODUCTION_BASE_URL}terenuri/tenis/`));
  await put('Idee Site/terenuri/fotbal/index.html', '<p>stale</p>');
  await assert.rejects(generateSourcePages({ repoRoot, check: true }), /stale/);
  await assert.rejects(buildPublic({ repoRoot }), /stale/);
  assert.equal(await readFile(path.join(repoRoot, 'dist/terenuri/fotbal/index.html'), 'utf8'), html);
});

test('generated category paths do not relax the allowlist or follow source symlinks', async t => {
  const { repoRoot, put } = await fixture(t);
  await generateSourcePages({ repoRoot });
  const manifestPath = path.join(repoRoot, 'scripts/public-files.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.files.push('terenuri/private/index.html');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(buildPublic({ repoRoot }), /Unsafe, unsupported/);
  manifest.files.pop(); manifest.files = manifest.files.filter(file => file !== 'sitemap.xml');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(buildPublic({ repoRoot }), /complete reviewed SEO/);
  await rm(path.join(repoRoot, 'Idee Site/terenuri/fotbal/index.html'));
  await put('private.html', 'private');
  await symlink(path.join(repoRoot, 'private.html'), path.join(repoRoot, 'Idee Site/terenuri/fotbal/index.html'));
  await assert.rejects(generateSourcePages({ repoRoot }), /regular file/);
});
