// Pure blueprint transforms. No API requests, credentials or email sends.
import { buildAnnouncementScenario } from './make-announcements.mjs';
const clone = value => structuredClone(value);
const skip = id => [{ id, module: 'builtin:Ignore', version: 1, parameters: {}, mapper: {}, metadata: { designer: { name: 'Oprește acest destinatar; păstrează registrul SQL, fără retry Gmail' } } }];
const stop = id => [{ id, module: 'builtin:Rollback', version: 1, parameters: {}, mapper: {}, metadata: { designer: { name: 'Oprește la eroare; verifică rezultatul înainte de reluare' } } }];

export function reserveTransactionalNotification(blueprint) {
    const result = clone(blueprint);
    const router = result.flow?.find(m => m.module === 'builtin:BasicRouter');
    const route = router?.routes?.find(r => r.flow?.some(m => m.id === 11 && m.module === 'datastore:ExistRecord'));
    if (!route || route.flow.length !== 3 || route.flow.map(m => m.id).join(',') !== '11,12,13') throw new Error('Review the current transactional route before changing it');
    const [exists, gmail, reserve] = route.flow;
    if (gmail.module !== 'google-email:sendAnEmail' || reserve.module !== 'datastore:AddRecord'
        || reserve.mapper?.overwrite !== false || reserve.mapper?.key !== '{{1.notification_id}}'
        || !gmail.filter || result.metadata?.scenario?.sequential !== true) throw new Error('Unsafe or unexpected transaction transport');
    reserve.filter = gmail.filter; delete gmail.filter;
    reserve.metadata = { ...reserve.metadata, designer: { ...reserve.metadata?.designer, name: 'Rezervă ID înainte de Gmail; nu retrimite un rezultat incert' } };
    reserve.onerror = stop(1013); gmail.onerror = stop(1012);
    route.flow = [exists, reserve, gmail];
    // Raw-row webhook triggers are retired by SQL030. Keep only the normalized
    // server-rendered route; legacy HTML interpolations must not remain reachable.
    router.routes = [route];
    return result;
}

export function addPanelAnnouncementRoutes(blueprint, config) {
    const result = clone(blueprint);
    const router = result.flow?.find(m => m.module === 'builtin:BasicRouter');
    if (!router || !Array.isArray(router.routes) || router.routes.some(r => r.flow?.some(m => m.id >= 200))) throw new Error('Review existing announcement routes before applying');
    for (const [index, audience] of ['clients', 'admins'].entries()) {
        // Reuse validation and the tested public-key/private-keychain HTTP contract.
        const sample = buildAnnouncementScenario({ ...config, audience, keychainId: config.keychainIds?.[audience] });
        const offset = (index + 2) * 100;
        const design = (id, name) => ({ designer: { x: (id - offset - 1) * 270, y: 600 + index * 400, name } });
        const serialize = (id, name, object, filter) => ({ id, module: 'json:TransformToJSON', version: 1, parameters: {}, mapper: { object }, ...(filter ? { filter } : {}), metadata: design(id, name) });
        const rpc = (id, name, functionName, source) => {
            const module = clone(sample.blueprint.flow.find(m => m.id === 8));
            module.id = id; module.mapper.url = `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`;
            module.mapper.jsonStringBodyContent = `{{${source}.json}}`; module.onerror = skip(id + 1000); module.metadata = design(id, name);
            return module;
        };
        const common = { p_audience: audience, p_campaign_id: '{{1.campaign_id}}' };
        const pending = offset + 2, feeder = offset + 3, claim = offset + 5;
        const gmail = clone(sample.blueprint.flow.find(m => m.id === 9));
        gmail.id = offset + 6; gmail.filter.conditions[0][0].a = `{{${claim}.data.send}}`;
        gmail.mapper = { to: [`{{${claim}.data.to_email}}`], subject: `{{${claim}.data.subject}}`, bodyType: 'rawHtml', content: `{{${claim}.data.html}}` };
        gmail.onerror = skip(gmail.id + 1000); gmail.metadata = design(gmail.id, `Anunț ${audience} — destinatar reverificat în SQL`);
        router.routes.push({ flow: [
            serialize(offset + 1, `Anunțuri numai ${audience} — campanie aprobată de superadmin`, common, {
                name: `Campanie din panou numai ${audience}`, conditions: [[
                    { a: '{{1.kind}}', o: 'text:equal', b: `announcement_campaign_${audience}` },
                    { a: '{{1.campaign_id}}', o: 'exist' },
                ]] }),
            rpc(pending, 'Citește exclusiv destinatarii încă neprocesați', 'announcement_pending', offset + 1),
            { id: feeder, module: 'builtin:BasicFeeder', version: 1, parameters: {}, mapper: { array: `{{${pending}.data.recipients}}` }, metadata: design(feeder, 'Un ID opac de destinatar') },
            serialize(offset + 4, 'JSON pentru reverificarea rolului și rezervare', { ...common, p_recipient_id: `{{${feeder}.recipient_id}}` }),
            rpc(claim, 'Rezervă o singură trimitere; fără retry pentru sending/sent', 'announcement_claim', offset + 4),
            gmail,
            serialize(offset + 7, 'Confirmă doar după acceptarea Gmail', { ...common, p_recipient_id: `{{${feeder}.recipient_id}}`, p_lease_token: `{{${claim}.data.lease_token}}` }),
            rpc(offset + 8, 'Marchează acceptarea în registrul campaniei', 'announcement_finish', offset + 7),
        ] });
    }
    return result;
}
