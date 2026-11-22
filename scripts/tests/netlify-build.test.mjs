import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { netlifyBuild } from '../netlify-build.mjs';
import { productionAppShell, NETLIFY_APP_REWRITES } from '../seo-pages.mjs';

async function repo(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spotivity-netlify-build-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, 'scripts'));
  await writeFile(path.join(repoRoot, 'scripts/seo-public-catalog.json'), '{"committed":true}\n');
  return repoRoot;
}

test('a successful refresh regenerates the pages before the public build', async t => {
  const repoRoot = await repo(t), calls = [];
  const result = await netlifyBuild({ repoRoot, log: () => {},
    refresh: async options => { calls.push(['refresh', options.repoRoot]); await writeFile(path.join(repoRoot, 'scripts/seo-public-catalog.json'), '{"fresh":true}\n'); return { courts: 3, bases: 1 }; },
    generate: async options => { calls.push(['generate', options.repoRoot]); },
    build: async options => { calls.push(['build', options.repoRoot]); return { files: [] }; } });
  assert.deepEqual(calls.map(([name]) => name), ['refresh', 'generate', 'build']);
  assert.ok(calls.every(([, root]) => root === repoRoot));
  assert.deepEqual(result, { files: [] });
  assert.equal(await readFile(path.join(repoRoot, 'scripts/seo-public-catalog.json'), 'utf8'), '{"fresh":true}\n');
});

test('a failed refresh or regeneration restores the committed snapshot and still builds', async t => {
  for (const failing of ['refresh', 'generate']) {
    const repoRoot = await repo(t), calls = [];
    let generated = 0;
    await netlifyBuild({ repoRoot, log: () => {},
      refresh: async () => {
        await writeFile(path.join(repoRoot, 'scripts/seo-public-catalog.json'), '{"half-written":true}\n');
        if (failing === 'refresh') throw new Error('offline');
        return { courts: 0, bases: 0 };
      },
      generate: async () => { calls.push('generate'); if (failing === 'generate' && generated++ === 0) throw new Error('bad catalog'); },
      build: async () => { calls.push('build'); return { files: [] }; } });
    assert.equal(await readFile(path.join(repoRoot, 'scripts/seo-public-catalog.json'), 'utf8'), '{"committed":true}\n', failing);
    assert.equal(calls.at(-1), 'build', failing);
  }
});

test('the production app shell is root-absolute, noindex and keeps external URLs', () => {
  const home = '<!doctype html><html><head><meta name="robots" content="index,follow"><link rel="canonical" href="https://example.test/"><meta property="og:url" content="x"><script id="spotivity-seo-data" type="application/ld+json">{}</script><link rel="stylesheet" href="css/a.css?v=1"><script src="https://cdn.jsdelivr.net/npm/x@1"></script><script src="js/a.js?v=2" defer></script></head><body><a id="home-brand" href="./">S</a><a href="#main">skip</a><a href="terenuri/fotbal/">F</a><img srcset="assets/imagini/a.webp"></body></html>';
  const shell = productionAppShell(home);
  assert.match(shell, /<meta name="robots" content="noindex,follow">/);
  assert.match(shell, /href="\/css\/a\.css\?v=1"/);
  assert.match(shell, /src="\/js\/a\.js\?v=2"/);
  assert.match(shell, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/x@1"/);
  assert.match(shell, /id="home-brand" href="\/"/);
  assert.match(shell, /href="#main"/);
  assert.match(shell, /href="\/terenuri\/fotbal\/"/);
  assert.match(shell, /srcset="\/assets\/imagini\/a\.webp"/);
  assert.match(shell, /<link rel="canonical" href="https:\/\/spotivity\.ro\/">/);
});

test('Netlify rewrites cover court, base and city addresses with non-forced 200s', () => {
  assert.ok(NETLIFY_APP_REWRITES.length === 4);
  for (const rule of NETLIFY_APP_REWRITES) assert.match(rule, /^\/(?:teren|terenuri|baze-sportive)\/(?::[a-z]+\/)*:[a-z]+ \/app\.html 200$/);
});
