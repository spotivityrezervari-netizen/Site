import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveTransactionalNotification, addPanelAnnouncementRoutes } from '../make-panel-mail.mjs';
const jwt = 'header.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.signature';
const original = { flow: [{ id: 1, module: 'gateway:CustomWebHook' }, { id: 10, module: 'builtin:BasicRouter', routes: [{ flow: [
    { id: 11, module: 'datastore:ExistRecord', mapper: { key: '{{1.notification_id}}' } },
    { id: 12, module: 'google-email:sendAnEmail', filter: { conditions: [[{ a: '{{11.exist}}', o: 'text:equal', b: 'false' }]] } },
    { id: 13, module: 'datastore:AddRecord', mapper: { key: '{{1.notification_id}}', overwrite: false } },
] }, { flow: [{ id: 4, module: 'google-email:sendAnEmail', filter: { conditions: [[{ a: '{{1.notification_id}}', o: 'notexist' }]] } }] }] }], metadata: { scenario: { sequential: true } } };
const config = { supabaseUrl: 'https://fixture.supabase.co', anonKey: jwt, keychainIds: { clients: 1, admins: 2 } };
test('transaction ID is durably reserved before Gmail, with sequential execution and error stop', () => {
    const result = reserveTransactionalNotification(original), flow = result.flow[1].routes[0].flow;
    assert.deepEqual(flow.map(m => m.id), [11, 13, 12]); assert.deepEqual(flow[1].filter, original.flow[1].routes[0].flow[1].filter);
    assert.equal(flow[1].mapper.overwrite, false); assert.equal(flow[2].filter, undefined); assert.equal(flow[2].onerror[0].module, 'builtin:Rollback');
    assert.deepEqual(original.flow[1].routes[0].flow.map(m => m.id), [11, 12, 13]);
    assert.throws(() => reserveTransactionalNotification(result), /Review/);
});
test('separate audience routes get addresses/content only from scoped RPCs and require a claim', () => {
    const reserved = reserveTransactionalNotification(original), result = addPanelAnnouncementRoutes(reserved, config);
    assert.deepEqual(result.flow[1].routes.slice(0, 1), reserved.flow[1].routes);
    for (const [index, audience] of ['clients', 'admins'].entries()) {
        const route = result.flow[1].routes[index + 1].flow;
        assert.equal(route[0].filter.conditions[0][0].b, `announcement_campaign_${audience}`);
        assert.equal(route[0].mapper.object.p_audience, audience);
        const rpcs = route.filter(m => m.module === 'http:MakeRequest');
        assert.deepEqual(rpcs.map(m => m.mapper.url.split('/').at(-1)), ['announcement_pending', 'announcement_claim', 'announcement_finish']);
        assert.ok(rpcs.every(m => m.parameters.apiKeyKeychain === config.keychainIds[audience] && m.mapper.allowRedirects === false));
        const gmail = route.find(m => m.module === 'google-email:sendAnEmail');
        assert.match(gmail.filter.conditions[0][0].a, /data.send/); assert.match(gmail.mapper.to[0], /data.to_email/);
        assert.equal(gmail.mapper.cc, undefined); assert.equal(gmail.mapper.bcc, undefined);
        assert.equal(gmail.onerror[0].module, 'builtin:Ignore');
        assert.ok(!JSON.stringify(route).includes('{{1.to')); assert.ok(!JSON.stringify(route).includes('{{1.html'));
    }
    assert.throws(() => addPanelAnnouncementRoutes(result, config), /Review/);
});
test('rejects privileged keys and unreviewed transport structures', () => {
    assert.throws(() => addPanelAnnouncementRoutes(original, { ...config, anonKey: 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.sig' }), /public/);
    assert.throws(() => reserveTransactionalNotification({ ...original, metadata: { scenario: { sequential: false } } }), /Unsafe/);
});
