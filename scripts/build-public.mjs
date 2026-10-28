// Publish only reviewed browser assets. Repository sources and secrets stay out
// of Netlify's web root; browser JavaScript remains inherently public.
import { constants } from 'node:fs';
import { lstat, open, mkdir, mkdtemp, rm, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetPath = /^(?:index\.html|css\/[A-Za-z0-9_-]+\.css|js\/(?:modules\/)?[A-Za-z0-9_-]+\.js|assets\/imagini\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|avif|gif|ico))$/;

async function readRegularFile(root, relative) {
  const parts = relative.split('/');
  let location = root;
  for (let i = 0; i < parts.length; i++) {
    location = path.join(location, parts[i]);
    const stat = await lstat(location);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Build input must be a regular file with no symlink components: ${relative}`);
    }
  }
  // Do not follow a leaf symlink even if it replaces a checked input mid-build.
  const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile(); }
  finally { await handle.close(); }
}

function assertNoPrivateMaterial(relative, content) {
  const privateValue = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\b(?:sb_secret_[A-Za-z0-9_-]{8,}|sbp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|nfp_[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/;
  if (privateValue.test(content)) throw new Error(`Private credential pattern in public input: ${relative}`);
  // A private Make webhook URL is itself an invocation credential. The browser
  // must call authenticated application endpoints rather than these URLs.
  if (/https?:\/\/hook\.(?:(?:eu|us)[0-9]+\.)?(?:make|integromat)\.com\/[A-Za-z0-9_-]{10,}/i.test(content)) {
    throw new Error(`Private webhook URL in public input: ${relative}`);
  }
  for (const match of content.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
    let payload;
    try { payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
    catch { throw new Error(`Unrecognized embedded JWT in public input: ${relative}`); }
    if (payload.role !== 'anon' || payload.sub || payload.session_id) {
      throw new Error(`Privileged or personal JWT in public input: ${relative}`);
    }
  }
  if (/sourceMappingURL\s*=/.test(content)) throw new Error(`Source map reference in public input: ${relative}`);
}

function assertLocalAsset(relative, reference, files) {
  if (!reference || /^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/|#)/.test(reference)) return;
  const target = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  if (!target) return;
  const resolved = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(relative), target));
  if (!files.has(resolved)) throw new Error(`Referenced browser asset is not in the public manifest: ${relative} -> ${resolved}`);
}

export async function buildPublic({ repoRoot = repositoryRoot } = {}) {
  repoRoot = path.resolve(repoRoot);
  const rootStat = await lstat(repoRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Repository root must be a real directory.');
  const manifestBytes = await readRegularFile(repoRoot, 'scripts/public-files.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.includes('index.html')) {
    throw new Error('Public manifest must have version 1, a files array, and index.html.');
  }
  const files = new Set();
  for (const relative of manifest.files) {
    if (typeof relative !== 'string' || !assetPath.test(relative) || files.has(relative)) {
      throw new Error(`Unsafe, unsupported, or duplicate public manifest entry: ${String(relative)}`);
    }
    files.add(relative);
  }
  const entries = [];
  for (const relative of files) {
    const content = await readRegularFile(repoRoot, `Idee Site/${relative}`);
    // Scan every file, including readable image metadata. This is a secondary
    // guard for known credential formats, not an exhaustive secret detector.
    const text = content.toString('utf8');
    assertNoPrivateMaterial(relative, text);
    if (/\.(?:html|css|js)$/.test(relative)) {
      if (relative.endsWith('.html')) {
        for (const tag of text.matchAll(/<(?:script|link|img)\b[^>]*>/gi)) {
          for (const attribute of tag[0].matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) assertLocalAsset(relative, attribute[1], files);
        }
      }
      if (relative.endsWith('.css')) {
        for (const reference of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) assertLocalAsset(relative, reference[1], files);
      }
    }
    entries.push([relative, content]);
  }
  const headers = await readRegularFile(repoRoot, 'deploy/netlify/_headers');
  assertNoPrivateMaterial('_headers', headers.toString('utf8'));
  entries.push(['_headers', headers]);

  const destination = path.join(repoRoot, 'dist');
  try {
    const existing = await lstat(destination);
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('dist must be a real generated directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await mkdtemp(path.join(repoRoot, '.public-build-'));
  try {
    for (const [relative, content] of entries) {
      const output = path.join(stage, relative);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, content);
    }
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return { directory: destination, files: entries.map(([relative]) => relative) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPublic().then(result => console.log(`Built ${result.files.length} reviewed public files in ${result.directory}`))
    .catch(error => { console.error(`Public build refused: ${error.message}`); process.exitCode = 1; });
}
