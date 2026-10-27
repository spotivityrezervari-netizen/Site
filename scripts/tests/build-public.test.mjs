import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPublic } from '../build-public.mjs';

const files = ['index.html', 'css/main.css', 'js/main.js', 'js/modules/public-auth.js', 'assets/imagini/logo.png'];
const ordinary = {
  'index.html': '<!doctype html><link rel="stylesheet" href="css/main.css?v=1"><script src="js/modules/public-auth.js"></script><script src="js/main.js"></script><img src="assets/imagini/logo.png">',
  'css/main.css': 'body { background-image: url(../assets/imagini/logo.png); }',
  'js/main.js': 'window.app = true;',
  'js/modules/public-auth.js': 'window.modules = {};',
  'assets/imagini/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
};

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spotivity-public-build-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const put = async (relative, content) => {
    await mkdir(path.dirname(path.join(repoRoot, relative)), { recursive: true });
    await writeFile(path.join(repoRoot, relative), content);
  };
  const manifest = async entries => put('scripts/public-files.json', JSON.stringify({ version: 1, files: entries }));
  for (const [relative, content] of Object.entries(ordinary)) await put(`Idee Site/${relative}`, content);
  await put('deploy/netlify/_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  await manifest(files);
  return { repoRoot, put, manifest, build: () => buildPublic({ repoRoot }), output: relative => path.join(repoRoot, 'dist', relative) };
}

async function tree(root, prefix = '') {
  const result = [];
  for (const item of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) result.push(...await tree(root, relative));
    else result.push(relative);
  }
  return result.sort();
}

test('artifact contains only reviewed browser files and the exact deployment headers', async t => {
  const f = await fixture(t);
  for (const relative of ['README.md', 'js/README.md', 'supabase/001_security.sql', 'supabase/tests/schema.sql', 'supabase/functions/app/index.ts', 'scripts/admin.js', '.env', '.git/config', 'js/new-debug.js', 'js/modules/private-helper.js', 'css/main.css.map', 'assets/imagini/private.json']) {
    await f.put(`Idee Site/${relative}`, 'excluded repository or development content');
  }
  const result = await f.build();
  assert.deepEqual(await tree(result.directory), [...files, '_headers'].sort());
  for (const [relative, content] of Object.entries(ordinary)) assert.deepEqual(await readFile(f.output(relative)), Buffer.from(content));
  assert.equal(await readFile(f.output('_headers'), 'utf8'), '/*\n  X-Content-Type-Options: nosniff\n');
});

test('rebuilding removes stale files rather than leaving a previously published backend source', async t => {
  const f = await fixture(t);
  await f.build();
  await f.put('dist/supabase/functions/app/index.ts', 'stale server source');
  await f.put('dist/js/removed-debug.js', 'stale script');
  await f.build();
  assert.deepEqual(await tree(f.output('')), [...files, '_headers'].sort());
});

test('a referenced new browser file requires an explicit manifest change', async t => {
  const f = await fixture(t);
  await f.put('Idee Site/js/new-feature.js', 'window.newFeature=true;');
  await f.put('Idee Site/index.html', ordinary['index.html'] + '<script src="js/new-feature.js"></script>');
  await assert.rejects(f.build, /not in the public manifest/);
  await f.manifest([...files, 'js/new-feature.js']);
  await f.build();
  assert.equal(await readFile(f.output('js/new-feature.js'), 'utf8'), 'window.newFeature=true;');
});

test('missing local CSS images fail the build before replacing a valid artifact', async t => {
  const f = await fixture(t);
  await f.build();
  await f.put('Idee Site/css/main.css', 'body{background:url(../assets/imagini/missing.png)}');
  await assert.rejects(f.build, /not in the public manifest/);
  assert.equal(await readFile(f.output('css/main.css'), 'utf8'), ordinary['css/main.css']);
});

test('source map references cannot be accidentally published', async t => {
  const f = await fixture(t);
  await f.put('Idee Site/js/main.js', 'window.app=true;\n//# sourceMappingURL=main.js.map');
  await assert.rejects(f.build, /Source map reference/);
});

test('manifest rejects non-browser sources, hidden files, traversal, duplicates and unknown formats', async t => {
  const f = await fixture(t);
  for (const candidate of ['supabase/functions/app/index.ts', 'supabase/001_security.sql', 'js/README.md', 'js/.env.js', 'js/modules/../server.js', '../private.js', '/js/main.js', 'css/main.css.map', 'js/server/private.js', 'assets/imagini/config.json', 'assets/imagini/active.svg', 'index.html']) {
    await f.manifest([...files, candidate]);
    await assert.rejects(f.build, /Unsafe, unsupported, or duplicate/);
  }
  await f.put('scripts/public-files.json', JSON.stringify({ version: 999, files }));
  await assert.rejects(f.build, /Public manifest/);
});

test('symlinked input files cannot expose a file outside the browser source', async t => {
  const f = await fixture(t);
  await f.put('private.js', 'private internal file');
  await rm(path.join(f.repoRoot, 'Idee Site/js/main.js'));
  await symlink(path.join(f.repoRoot, 'private.js'), path.join(f.repoRoot, 'Idee Site/js/main.js'));
  await assert.rejects(f.build, /no symlink components/);
});

test('symlinked parent directories are rejected even when their file names are allowlisted', async t => {
  const f = await fixture(t);
  await rm(path.join(f.repoRoot, 'Idee Site/js/modules'), { recursive: true });
  await f.put('private-modules/public-auth.js', 'private internal file');
  await symlink(path.join(f.repoRoot, 'private-modules'), path.join(f.repoRoot, 'Idee Site/js/modules'));
  await assert.rejects(f.build, /no symlink components/);
});

test('symlinked manifest and headers are rejected', async t => {
  const f = await fixture(t);
  await rm(path.join(f.repoRoot, 'deploy/netlify/_headers'));
  await f.put('private-headers', '/*\n  Secret: do-not-publish\n');
  await symlink(path.join(f.repoRoot, 'private-headers'), path.join(f.repoRoot, 'deploy/netlify/_headers'));
  await assert.rejects(f.build, /no symlink components/);
  await rm(path.join(f.repoRoot, 'deploy/netlify/_headers'));
  await f.put('deploy/netlify/_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  await rm(path.join(f.repoRoot, 'scripts/public-files.json'));
  await f.put('outside-manifest.json', JSON.stringify({ version: 1, files }));
  await symlink(path.join(f.repoRoot, 'outside-manifest.json'), path.join(f.repoRoot, 'scripts/public-files.json'));
  await assert.rejects(f.build, /no symlink components/);
});

test('symlinked dist is never recursively replaced or followed', async t => {
  const f = await fixture(t);
  await f.put('retained/important.txt', 'keep this');
  await symlink(path.join(f.repoRoot, 'retained'), path.join(f.repoRoot, 'dist'));
  await assert.rejects(f.build, /dist must be a real generated directory/);
  assert.equal(await readFile(path.join(f.repoRoot, 'retained/important.txt'), 'utf8'), 'keep this');
});

test('privileged or personal credentials refuse publication without printing their values', async t => {
  const f = await fixture(t);
  const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.fixtureSignature';
  for (const content of ['-----BEGIN PRIVATE KEY-----', 'sb_secret_' + 'exampleNotARealSecret'.repeat(2), 'sbp_' + '0'.repeat(40), jwt('service_role'), jwt('authenticated')]) {
    await f.put('Idee Site/js/main.js', content);
    await assert.rejects(f.build, error => {
      assert.match(error.message, /credential pattern|JWT/);
      assert.ok(!error.message.includes(content));
      return true;
    });
  }
  await f.put('Idee Site/js/main.js', jwt('anon'));
  await f.build();
  assert.equal(await readFile(f.output('js/main.js'), 'utf8'), jwt('anon'));
});

test('known private credentials embedded in image metadata are refused as well', async t => {
  const f = await fixture(t);
  await f.put('Idee Site/assets/imagini/logo.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from('Metadata: sb_secret_' + 'notARealCredential'.repeat(2)),
  ]));
  await assert.rejects(f.build, /Private credential pattern in public input: assets\/imagini\/logo.png/);
});
