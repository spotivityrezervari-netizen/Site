// Build manual Make scenarios locally. This file never calls a remote API.
// Live module metadata: GET /api/v2/imt/apps/{http/4,json/1,util/1,builtin/1,google-email/4}.
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ANNOUNCEMENT_AUDIENCES = Object.freeze(['clients', 'admins']);
export const ANNOUNCEMENT_SCHEDULING = Object.freeze({ type: 'on-demand' });
const positiveID = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid ${name}`);
  return value;
};
const designer = (id, name) => ({ designer: { x: (id - 1) * 270, y: 0, name } });
const stopForReview = id => [{ id, module: 'builtin:Rollback', version: 1, parameters: {},
  mapper: {}, metadata: designer(id, 'Oprește la eroare; verificare manuală în registrul campaniei') }];

/**
 * Fixed-audience RPC contract (all POSTs require a dedicated keychain header):
 * announcement_preview(p_audience,p_campaign_id,p_subject,p_message) -> count,fingerprint,stage
 * announcement_approve(p_audience,p_campaign_id,p_expected_count) -> recipients:[{recipient_id}]
 * announcement_claim(p_audience,p_campaign_id,p_recipient_id) -> send,lease_token,to_email,subject,html,text
 * announcement_finish(p_audience,p_campaign_id,p_recipient_id,p_lease_token) -> sent
 * Secrets never enter this builder: supply only numeric credential IDs and the public anonymous key.
 */
export function buildAnnouncementScenario({ audience, keychainId, gmailConnectionId = 11897572,
  teamId = 2838814, supabaseUrl, anonKey, campaignId = randomUUID() } = {}) {
  if (!ANNOUNCEMENT_AUDIENCES.includes(audience)) throw new TypeError('Invalid fixed audience');
  positiveID(keychainId, 'keychain ID'); positiveID(gmailConnectionId, 'Gmail connection ID'); positiveID(teamId, 'team ID');
  if (!UUID.test(campaignId)) throw new TypeError('Invalid campaign UUID');
  const base = new URL(supabaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || !/^[a-z0-9]+\.supabase\.co$/.test(base.hostname) || base.port) throw new TypeError('Invalid Supabase origin');
  // Reject private Supabase keys rather than accidentally generating a public blueprint with one.
  let publicKey = false;
  if (typeof anonKey === 'string' && anonKey.split('.').length === 3) {
    try { const claims = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString()); publicKey = claims.role === 'anon' && !claims.sub && !claims.session_id; } catch { /* invalid public key */ }
  }
  if (!publicKey) throw new TypeError('Supply only the public Supabase anonymous JWT');

  const serialize = (id, name, object, filter) => ({ id, module: 'json:TransformToJSON', version: 1,
    parameters: {}, mapper: { object }, ...(filter ? { filter } : {}), metadata: designer(id, name) });
  const rpc = (id, name, functionName, serializedBy) => ({ id, module: 'http:MakeRequest', version: 4,
    parameters: { authenticationType: 'apiKey', apiKeyKeychain: keychainId },
    mapper: { url: `${base.origin}/rest/v1/rpc/${functionName}`, method: 'post',
      headers: [{ name: 'apikey', value: anonKey }, { name: 'Authorization', value: `Bearer ${anonKey}` }],
      contentType: 'json', inputMethod: 'jsonString', jsonStringBodyContent: `{{${serializedBy}.json}}`,
      parseResponse: true, stopOnHttpError: true, timeout: 40, allowRedirects: false,
      shareCookies: false, requestCompressedContent: true },
    onerror: stopForReview(id + 100), metadata: designer(id, name) });
  const common = { p_audience: audience, p_campaign_id: '{{1.id_campanie}}' };
  const sendGate = { name: 'TRIMITE confirmat și numărul destinatarilor verificat', conditions: [[
    { a: '{{1.mod}}', o: 'text:equal', b: 'TRIMITE' },
    { a: '{{3.data.count}}', o: 'number:equal', b: '{{1.numar_asteptat}}' },
    { a: '{{1.numar_asteptat}}', o: 'number:greater', b: '0' },
  ]] };
  const blueprint = {
    name: audience === 'clients' ? 'Spotivity — Anunț manual numai pentru clienți' : 'Spotivity — Anunț manual numai pentru administratori',
    flow: [
      { id: 1, module: 'util:SetVariables', version: 1, parameters: {}, mapper: { variables: [
        { name: 'mod', value: 'PREVIZUALIZARE' }, { name: 'id_campanie', value: campaignId },
        { name: 'subiect', value: '' }, { name: 'mesaj', value: '' }, { name: 'numar_asteptat', value: 0 },
      ] }, metadata: designer(1, 'Completează mesajul; previzualizează înainte de TRIMITE') },
      serialize(2, 'JSON sigur pentru previzualizare', { ...common, p_subject: '{{1.subiect}}', p_message: '{{1.mesaj}}' }),
      rpc(3, 'Previzualizează publicul actual — fără email', 'announcement_preview', 2),
      serialize(4, 'Confirmă explicit numărul previzualizat', { ...common, p_expected_count: '{{1.numar_asteptat}}' }, sendGate),
      rpc(5, 'Aprobă campania pentru publicul fix', 'announcement_approve', 4),
      { id: 6, module: 'builtin:BasicFeeder', version: 1, parameters: {}, mapper: { array: '{{5.data.recipients}}' }, metadata: designer(6, 'Un destinatar opac per pas') },
      serialize(7, 'JSON pentru reverificarea destinatarului', { ...common, p_recipient_id: '{{6.recipient_id}}' }),
      rpc(8, 'Reverifică rolul actual și rezervă o singură trimitere', 'announcement_claim', 7),
      { id: 9, module: 'google-email:sendAnEmail', version: 4, parameters: { __IMTCONN__: gmailConnectionId },
        filter: { name: 'Numai destinatarul autorizat acum', conditions: [[{ a: '{{8.data.send}}', o: 'boolean:equal', b: 'true' }]] },
        mapper: { to: ['{{8.data.to_email}}'], subject: '{{8.data.subject}}', bodyType: 'rawHtml', content: '{{8.data.html}}' },
        onerror: stopForReview(109), metadata: designer(9, 'Un singur email, fără CC/BCC și fără retry automat') },
      serialize(10, 'JSON pentru confirmarea trimiterii', { ...common, p_recipient_id: '{{6.recipient_id}}', p_lease_token: '{{8.data.lease_token}}' }),
      rpc(11, 'Marchează trimis numai după succesul Gmail', 'announcement_finish', 10),
    ],
    metadata: { instant: false, version: 1, scenario: { roundtrips: 1, maxErrors: 1,
      autoCommit: true, autoCommitTriggerLast: true, sequential: true, confidential: true,
      dataloss: false, dlq: false, freshVariables: true }, designer: { orphans: [] } },
  };
  const scheduling = { ...ANNOUNCEMENT_SCHEDULING };
  // POST /scenarios creates inactive. Activation is a separate operation and is
  // deliberately absent here; verify isActive=false with a read after creation.
  return { audience, blueprint, scheduling,
    createBody: { teamId, blueprint: JSON.stringify(blueprint), scheduling: JSON.stringify(scheduling) },
    updateBody: { blueprint: JSON.stringify(blueprint), scheduling: JSON.stringify(scheduling) } };
}

// Optional local-only CLI: config contains URL, PUBLIC anonKey and credential IDs.
// Never put tokens/keychain values into this config. The command cannot deploy or run scenarios.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [configFile, outputDirectory] = process.argv.slice(2);
  if (!configFile || !outputDirectory) throw new Error('Usage: node scripts/make-announcements.mjs PUBLIC_CONFIG.json OUTPUT_DIRECTORY');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  await mkdir(outputDirectory, { recursive: true });
  for (const audience of ANNOUNCEMENT_AUDIENCES) {
    const result = buildAnnouncementScenario({ ...config, audience, keychainId: config.keychainIds?.[audience] });
    await writeFile(path.join(outputDirectory, `${audience}.create.json`), JSON.stringify(result.createBody, null, 2) + '\n', { mode: 0o600 });
    await writeFile(path.join(outputDirectory, `${audience}.blueprint.json`), JSON.stringify(result.blueprint, null, 2) + '\n', { mode: 0o600 });
  }
}
