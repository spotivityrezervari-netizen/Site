// Run after editing the shared homepage. --check verifies checked-in Pages
// documents without changing source; Netlify generates its own production URLs.
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSeoFiles, readReviewedFile } from './seo-pages.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function generateSourcePages({ repoRoot = repositoryRoot, check = false } = {}) {
  const template = await readReviewedFile(repoRoot, 'Idee Site/index.html');
  const catalog = JSON.parse(await readReviewedFile(repoRoot, 'scripts/seo-public-catalog.json'));
  const files = generateSeoFiles({ template, catalog });
  for (const [relative, html] of files) {
    if (check) {
      let current;
      try { current = await readReviewedFile(repoRoot, `Idee Site/${relative}`); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (current !== html) throw new Error(`Generated SEO source is stale: ${relative}. Run node scripts/generate-seo-pages.mjs`);
    } else {
      // Never follow an existing source directory/file symlink during writes.
      let directory = path.resolve(repoRoot);
      for (const part of ['Idee Site', ...relative.split('/').slice(0, -1)]) {
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
      try { await handle.writeFile(html); } finally { await handle.close(); }
    }
  }
  return [...files.keys()];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.some(argument => argument !== '--check')) throw new Error('Usage: node scripts/generate-seo-pages.mjs [--check]');
  generateSourcePages({ check: argumentsList.includes('--check') }).then(files => console.log(`Verified ${files.length} deterministic SEO documents${argumentsList.includes('--check') ? '' : ' for GitHub Pages'}.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
