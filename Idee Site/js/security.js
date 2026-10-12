// Shared UI helpers. Authorization is enforced by Supabase RLS and SQL triggers.
window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
window.escapeJs = value => window.escapeHtml(JSON.stringify(String(value ?? '')).slice(1,-1).replace(/'/g,'\\u0027'));
window.safeUrl = (value, allowAssets = false) => {
    const text = String(value ?? '');
    if (allowAssets && /^assets\/[a-zA-Z0-9_./-]+$/.test(text) && !text.includes('..')) return text;
    try {
        const parsed = new URL(text);
        return ['https:','http:'].includes(parsed.protocol) ? parsed.href : '';
    } catch { return ''; }
};
window.siteDate = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Bucharest', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(date);
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
};
window.siteClock = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone:'Europe/Bucharest', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date());
    return {hour:Number(parts.find(p=>p.type==='hour').value), minute:Number(parts.find(p=>p.type==='minute').value)};
};
window.bookingEnded = (day, hour) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const clock = window.siteClock();
    const current = `${window.siteDate()} ${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`;
    return `${day} ${String(Number(hour.split(':')[0])+1).padStart(2,'0')}:00` <= current;
};

// Hourly START slots; an undefined field supports the pre-migration frontend.
window.bookingHourOptions = Array.from({length:14}, (_, i) => `${String(i+9).padStart(2,'0')}:00`);
window.getCourtBookingHours = court => {
    if (court?.ore_rezervabile === undefined) return window.bookingHourOptions.slice(3);
    if (!Array.isArray(court.ore_rezervabile)) return [];
    return window.bookingHourOptions.filter(hour => court.ore_rezervabile.includes(hour));
};
// Preserve hosting subdirectories for Auth confirmation and password recovery.
window.siteHomeUrl = () => new URL('./', window.location.href).href;
