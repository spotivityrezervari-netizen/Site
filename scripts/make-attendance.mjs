// Pure transform; no credentials, webhook destinations or provider calls.
export function addAttendanceNotificationKind(blueprint) {
    const result = structuredClone(blueprint);
    const router = result.flow?.find(module => module.module === 'builtin:BasicRouter');
    const route = router?.routes?.find(item => item.flow?.some(module => module.id === 11));
    if (route?.flow.map(module => module.id).join(',') !== '11,13,12'
        || result.metadata?.scenario?.sequential !== true || result.metadata?.scenario?.confidential !== true) throw new Error('Review the current transactional route');
    const [exists, reserve, gmail] = route.flow;
    if (exists.module !== 'datastore:ExistRecord' || reserve.module !== 'datastore:AddRecord'
        || reserve.mapper?.overwrite !== false || gmail.module !== 'google-email:sendAnEmail'
        || JSON.stringify(gmail.mapper?.to) !== JSON.stringify(['{{1.to.email}}'])
        || gmail.mapper?.subject !== '{{1.subject}}' || gmail.mapper?.content !== '{{1.html}}'
        || gmail.mapper?.cc?.length || gmail.mapper?.bcc?.length) throw new Error('Unexpected email destination or content');
    const conditions = exists.filter?.conditions;
    const sample = conditions?.find(group => group.some(rule => rule.a === '{{1.kind}}' && rule.o === 'text:equal' && rule.b === 'booking_cancelled_client'));
    if (!sample || !['notification_id', 'to.email', 'subject', 'html'].every(field => sample.some(rule => rule.a === `{{1.${field}}}` && rule.o === 'exist'))) throw new Error('Missing normalized notification validation');
    if (!conditions.some(group => group.some(rule => rule.a === '{{1.kind}}' && rule.o === 'text:equal' && rule.b === 'booking_attendance_client'))) {
        conditions.push(sample.map(rule => rule.a === '{{1.kind}}' ? { ...rule, b: 'booking_attendance_client' } : { ...rule }));
    }
    return result;
}
