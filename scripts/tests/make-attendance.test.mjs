import test from 'node:test';
import assert from 'node:assert/strict';
import { addAttendanceNotificationKind } from '../make-attendance.mjs';
const blueprint = () => ({ flow: [{ module: 'builtin:BasicRouter', routes: [{ flow: [
    { id: 11, module: 'datastore:ExistRecord', filter: { conditions: [[...['notification_id', 'to.email', 'subject', 'html'].map(field => ({ a: `{{1.${field}}}`, o: 'exist' })), { a: '{{1.kind}}', o: 'text:equal', b: 'booking_cancelled_client' }]] } },
    { id: 13, module: 'datastore:AddRecord', mapper: { overwrite: false } },
    { id: 12, module: 'google-email:sendAnEmail', mapper: { to: ['{{1.to.email}}'], subject: '{{1.subject}}', content: '{{1.html}}' } }
] }, { flow: [{ id: 201, module: 'json:TransformToJSON' }] }] }], metadata: { scenario: { sequential: true, confidential: true } } });
test('attendance reuses server-rendered mail, preserves every route and existing deduplication, and is idempotent', () => {
    const before = blueprint(), copy = structuredClone(before), after = addAttendanceNotificationKind(before);
    assert.deepEqual(before, copy);
    const route = after.flow[0].routes[0];
    assert.equal(route.flow[0].filter.conditions.length, 2);
    route.flow[0].filter.conditions.pop();
    assert.deepEqual(after, before);
    const configured = addAttendanceNotificationKind(before);
    assert.deepEqual(addAttendanceNotificationKind(configured), configured);
});
test('unsafe recipients, content mapping or processing settings are rejected before updating Make', () => {
    for (const change of [b => { b.metadata.scenario.sequential = false; }, b => { b.metadata.scenario.confidential = false; }, b => { b.flow[0].routes[0].flow[2].mapper.to = ['other@example.test']; }, b => { b.flow[0].routes[0].flow[2].mapper.bcc = ['hidden@example.test']; }]) {
        const value = blueprint(); change(value); assert.throws(() => addAttendanceNotificationKind(value));
    }
});
