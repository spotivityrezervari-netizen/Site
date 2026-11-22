// Netlify build: refresh the public catalog, regenerate the SEO pages, then run
// the reviewed public build. Courts and bases added since the last commit get
// their own generated page on every deploy, without a manual regeneration.
// If the live refresh or the regeneration fails, the committed snapshot and
// pages are restored and the build continues with them (never a broken deploy).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshCatalog } from './refresh-seo-catalog.mjs';
import { generateSourcePages } from './generate-seo-pages.mjs';
import { buildPublic } from './build-public.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function netlifyBuild({ repoRoot = repositoryRoot, refresh = refreshCatalog, generate = generateSourcePages, build = buildPublic, log = console.log } = {}) {
  const snapshotFile = path.join(repoRoot, 'scripts/seo-public-catalog.json');
  const committed = await readFile(snapshotFile, 'utf8');
  try {
    const result = await refresh({ repoRoot });
    await generate({ repoRoot });
    log(`SEO catalog refreshed for this deploy: ${result.courts} courts, ${result.bases} bases.`);
  } catch (error) {
    log(`SEO catalog refresh skipped (${error.message}); using the committed snapshot.`);
    await writeFile(snapshotFile, committed);
    await generate({ repoRoot });
  }
  return build({ repoRoot });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  netlifyBuild().then(result => console.log(`Built ${result.files.length} reviewed public files in ${result.directory}`))
    .catch(error => { console.error(`Public build refused: ${error.message}`); process.exitCode = 1; });
}
