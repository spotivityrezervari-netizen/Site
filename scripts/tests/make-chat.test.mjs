import test from 'node:test';
import assert from 'node:assert/strict';
import { addChatNotificationKinds } from '../make-chat.mjs';
const blueprint = () => ({ flow: [{ module: 'builtin:BasicRouter', routes: [{ flow: [
  { id: 11, module: 'datastore:ExistRecord', filter: { conditions: [[...['notification_id', 'to.email', 'subject', 'html'].map(field => ({ a: `{{1.${field}}}`, o: 'exist' })), { a: '{{1.kind}}', o: 'text:equal', b: 'booking_cancelled_client' }]] } },
  { id: 13, module: 'datastore:AddRecord', mapper: { overwrite: false } },
  { id: 12, module: 'google-email:sendAnEmail', mapper: { to: ['{{1.to.email}}'], subject: '{{1.subject}}', content: '{{1.html}}' } }
] }, { flow: [{ id: 201, module: 'json:TransformToJSON' }] }] }], metadata: { scenario: { sequential: true, confidential: true } } });
test('both chat audiences reuse sole server-validated recipient and preserve the existing routes and deduplication', () => {
  const before = blueprint(), original = structuredClone(before), result = addChatNotificationKinds(before);
  assert.deepEqual(before, original);
  const conditions = result.flow[0].routes[0].flow[0].filter.conditions;
  assert.deepEqual(conditions.slice(1).map(group => group.find(rule => rule.a === '{{1.kind}}').b), ['chat_owner', 'chat_client']);
  conditions.splice(1); assert.deepEqual(result, before);
  const updated = addChatNotificationKinds(before); assert.deepEqual(addChatNotificationKinds(updated), updated);
});
test('recipient expansion, weakened deduplication and missing template guards fail closed', () => {
  for (const change of [b => { b.flow[0].routes[0].flow[2].mapper.cc = ['other@example.test']; }, b => { b.flow[0].routes[0].flow[2].mapper.to = ['other@example.test']; }, b => { b.flow[0].routes[0].flow[1].mapper.overwrite = true; }, b => { b.metadata.scenario.sequential = false; }, b => { b.flow[0].routes[0].flow[0].filter.conditions[0].shift(); }]) {
    const input = blueprint(); change(input); assert.throws(() => addChatNotificationKinds(input));
  }
});
