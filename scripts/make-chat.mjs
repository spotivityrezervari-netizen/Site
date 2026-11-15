// Pure blueprint update. Destinations and credentials remain server-side.
export function addChatNotificationKinds(blueprint) {
  const result = structuredClone(blueprint);
  const router = result.flow?.find(module => module.module === 'builtin:BasicRouter');
  const route = router?.routes?.find(item => item.flow?.some(module => module.id === 11));
  if (route?.flow.map(module => module.id).join(',') !== '11,13,12'
      || result.metadata?.scenario?.sequential !== true || result.metadata?.scenario?.confidential !== true) throw new Error('Review the current notification route');
  const [exists, reserve, gmail] = route.flow;
  if (exists.module !== 'datastore:ExistRecord' || reserve.module !== 'datastore:AddRecord'
      || reserve.mapper?.overwrite !== false || gmail.module !== 'google-email:sendAnEmail'
      || JSON.stringify(gmail.mapper?.to) !== JSON.stringify(['{{1.to.email}}'])
      || gmail.mapper?.subject !== '{{1.subject}}' || gmail.mapper?.content !== '{{1.html}}'
      || gmail.mapper?.cc?.length || gmail.mapper?.bcc?.length) throw new Error('Unsafe notification mapping');
  const conditions = exists.filter?.conditions;
  const sample = conditions?.find(group => group.some(rule => rule.a === '{{1.kind}}' && rule.o === 'text:equal' && rule.b === 'booking_cancelled_client'));
  if (!sample || !['notification_id', 'to.email', 'subject', 'html'].every(field => sample.some(rule => rule.a === `{{1.${field}}}` && rule.o === 'exist'))) throw new Error('Missing server-rendered notification validation');
  for (const kind of ['chat_owner', 'chat_client']) {
    if (!conditions.some(group => group.some(rule => rule.a === '{{1.kind}}' && rule.o === 'text:equal' && rule.b === kind))) {
      conditions.push(sample.map(rule => rule.a === '{{1.kind}}' ? { ...rule, b: kind } : { ...rule }));
    }
  }
  return result;
}
