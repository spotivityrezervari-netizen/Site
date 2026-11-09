// Explicit maintainer action, separate from offline generation/builds. Fetches
// only public allowlisted fields with the browser anon identity, never staff data.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPORTS, readReviewedFile, validateCatalog } from './seo-pages.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const PUBLIC_HOST = 'https://ndubcdwohqzgxpuiowye.supabase.co';
export function publicCredentials(source) {
  const url = source.match(/const supabaseUrl = '([^']+)'/)?.[1];
  const key = source.match(/const supabaseKey = '([^']+)'/)?.[1];
  let payload;
  try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { /* Refuse below. */ }
  if (url !== PUBLIC_HOST || payload?.role !== 'anon' || payload.sub || payload.session_id || payload.ref !== 'ndubcdwohqzgxpuiowye') {
    throw new Error('Catalog refresh requires the reviewed public anon configuration.');
  }
  return { url, key };
}

export function snapshotFromPublicRows(courts, bases, refreshedAt = new Date().toISOString()) {
  if (!Array.isArray(courts) || !Array.isArray(bases)) throw new Error('Invalid public catalog response.');
  const activeBases = new Set(bases.filter(base => base.este_activa === true).map(base => String(base.id).toLowerCase()));
  const snapshot = { version: 2, refreshedAt,
    bases: bases.filter(base => base.este_activa === true).map(base => ({
      id: base.id, nume: base.nume, oras: base.oras, descriere: base.descriere ?? ''
    })),
    courts: courts.filter(court => court.este_activ === true &&
      (court.baza_sportiva_id === null || court.baza_sportiva_id === undefined || activeBases.has(String(court.baza_sportiva_id).toLowerCase()))).map(court => ({
      id: court.id, nume: court.nume, sport: court.sport === 'Tenis de picior' ? 'Tenis Picior' : court.sport,
      oras: court.oras, pret: court.pret === null || court.pret === undefined ? null : Number(court.pret),
      baza_sportiva_id: court.baza_sportiva_id ?? null
    })) };
  const referencedBases = new Set(snapshot.courts.map(court => String(court.baza_sportiva_id).toLowerCase()));
  snapshot.bases = snapshot.bases.filter(base => referencedBases.has(String(base.id).toLowerCase()));
  const normalized = validateCatalog(snapshot);
  snapshot.bases = normalized.bases;
  snapshot.courts = normalized.courts;
  return snapshot;
}

export async function refreshCatalog({ repoRoot = repositoryRoot } = {}) {
  const { url, key } = publicCredentials(await readReviewedFile(repoRoot, 'Idee Site/js/db.js'));
  async function readAll(table, fields, activeColumn) {
    const rows = [], seen = new Set();
    for (;;) {
      const endpoint = new URL(`/rest/v1/${table}`, url);
      endpoint.search = new URLSearchParams({ select: fields, [activeColumn]: 'eq.true', order: 'id.asc', offset: String(rows.length), limit: '1000' }).toString();
      let response;
      try {
        response = await run('curl', ['--fail', '--silent', '--show-error', '--max-time', '30',
          '--header', `apikey: ${key}`, '--header', `Authorization: Bearer ${key}`, endpoint.href], { maxBuffer: 4 * 1024 * 1024 });
      } catch { throw new Error(`Cannot refresh public ${table}; no snapshot was written.`); }
      const page = JSON.parse(response.stdout);
      if (!Array.isArray(page)) throw new Error(`Invalid public ${table} list.`);
      if (!page.length) break;
      const fingerprint = JSON.stringify(page.map(row => row.id));
      if (seen.has(fingerprint) || rows.length + page.length > 100000) throw new Error('Public catalog pagination failed.');
      seen.add(fingerprint);
      rows.push(...page);
    }
    return rows;
  }
  const [courts, bases] = await Promise.all([
    readAll('terenuri', 'id,nume,sport,oras,pret,este_activ,baza_sportiva_id', 'este_activ'),
    readAll('baze_sportive', 'id,nume,oras,descriere,este_activa', 'este_activa')
  ]);
  const snapshot = snapshotFromPublicRows(courts, bases);
  await readReviewedFile(repoRoot, 'scripts/seo-public-catalog.json'); // refuse existing symlinks
  const handle = await open(path.join(repoRoot, 'scripts/seo-public-catalog.json'), constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
  try { await handle.writeFile(JSON.stringify(snapshot, null, 2) + '\n'); } finally { await handle.close(); }
  return { bases: snapshot.bases.length, courts: snapshot.courts.length, sports: SPORTS.filter(({ sport }) => snapshot.courts.some(court => court.sport === sport)).length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/refresh-seo-catalog.mjs');
  refreshCatalog().then(result => console.log(`Refreshed ${result.bases} public bases and ${result.courts} public courts across ${result.sports} sports. Regenerate and review the SEO pages before pushing.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
