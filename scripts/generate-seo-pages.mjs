// Generate reviewed source Pages documents and their exact public manifest.
// --check is read-only. Obsolete files are removed only when they carry our marker.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_MARKER, SEO_PATHS, generateSeoFiles, readReviewedFile } from './seo-pages.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function managedPages(root) {
  const result = [];
  async function walk(relative) {
    const directory = path.join(root, 'Idee Site', relative);
    let stat;
    try { stat = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Generated SEO directory must not contain symlinks.');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Generated SEO directory must not contain symlinks.');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name === 'index.html') {
        if ((await readReviewedFile(root, `Idee Site/${file}`)).includes(GENERATED_MARKER)) result.push(file);
      }
    }
  }
  await walk('terenuri');
  await walk('baze-sportive');
  return result;
}
async function writeReviewed(root, relative, content) {
  let directory = path.resolve(root);
  for (const part of relative.split('/').slice(0, -1)) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid generated SEO directory.');
    directory = path.join(directory, part);
    await mkdir(directory, { recursive: true });
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Generated SEO directory must not contain symlinks.');
  }
  const destination = path.join(directory, path.basename(relative));
  try {
    const stat = await lstat(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Generated SEO output must be a regular file.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { await handle.writeFile(content); } finally { await handle.close(); }
}
export async function generateSourcePages({ repoRoot = repositoryRoot, check = false } = {}) {
  const template = await readReviewedFile(repoRoot, 'Idee Site/index.html');
  const catalog = JSON.parse(await readReviewedFile(repoRoot, 'scripts/seo-public-catalog.json'));
  const files = generateSeoFiles({ template, catalog });
  const owned = await managedPages(repoRoot), obsolete = owned.filter(relative => !files.has(relative));
  const manifest = JSON.parse(await readReviewedFile(repoRoot, 'scripts/public-files.json'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.some(file => typeof file !== 'string') || new Set(manifest.files).size !== manifest.files.length) throw new Error('Invalid public manifest for source generation.');
  const replaced = new Set([...SEO_PATHS, ...owned, ...files.keys()]);
  const desiredManifest = { ...manifest, files: [...manifest.files.filter(relative => !replaced.has(relative)), ...files.keys()].sort() };
  if (check) {
    if (obsolete.length) throw new Error(`Obsolete generated SEO source: ${obsolete[0]}. Regenerate the public pages.`);
    if (JSON.stringify(manifest.files) !== JSON.stringify(desiredManifest.files)) throw new Error('Generated SEO public manifest is stale. Run node scripts/generate-seo-pages.mjs');
  }
  for (const [relative, content] of files) {
    if (check) {
      let current;
      try { current = await readReviewedFile(repoRoot, `Idee Site/${relative}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current !== content) throw new Error(`Generated SEO source is stale: ${relative}. Run node scripts/generate-seo-pages.mjs`);
    } else {
      if (relative.endsWith('.html') && !SEO_PATHS.includes(relative)) {
        try {
          const existing = await readReviewedFile(repoRoot, `Idee Site/${relative}`);
          if (!existing.includes(GENERATED_MARKER)) throw new Error(`Refusing to overwrite unowned SEO source: ${relative}`);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await writeReviewed(repoRoot, `Idee Site/${relative}`, content);
    }
  }
  if (!check) {
    // An explicit regeneration may retire prior names/removed inventory, but
    // never deletes unmarked contributor HTML or follows directory symlinks.
    for (const relative of obsolete) {
      const current = await readReviewedFile(repoRoot, `Idee Site/${relative}`);
      if (!current.includes(GENERATED_MARKER)) throw new Error('Obsolete SEO source changed during generation.');
      await unlink(path.join(repoRoot, 'Idee Site', relative));
      let parent = path.posix.dirname(relative);
      while (parent !== 'terenuri' && parent !== 'baze-sportive' && parent !== '.') {
        try { await rmdir(path.join(repoRoot, 'Idee Site', parent)); }
        catch (error) { if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) break; throw error; }
        parent = path.posix.dirname(parent);
      }
    }
    await writeReviewed(repoRoot, 'scripts/public-files.json', JSON.stringify(desiredManifest, null, 2) + '\n');
  }
  return [...files.keys()];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.some(argument => argument !== '--check')) throw new Error('Usage: node scripts/generate-seo-pages.mjs [--check]');
  generateSourcePages({ check: argumentsList.includes('--check') }).then(files => console.log(`Verified ${files.length} deterministic public SEO files${argumentsList.includes('--check') ? '' : ' for GitHub Pages'}.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
