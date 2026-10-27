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

// Hide old rows only in default history lists; the dated staff calendar keeps
// the full stored history. The boundary is 30 days after the hourly slot ends.
window.bookingInRecentHistory = (row, now = Date.now()) => {
    const cutoff = Number(now) - 30 * 24 * 60 * 60 * 1000;
    const instant = Date.parse(row?.starts_at || '');
    if (Number.isFinite(instant)) return instant + 60 * 60 * 1000 >= cutoff;
    const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(row?.data_str || ''));
    const time = /^(\d{2}):(\d{2})$/.exec(String(row?.ora || ''));
    if (!civil || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return true;
    const end = new Date(0);
    end.setUTCFullYear(Number(civil[1]), Number(civil[2]) - 1, Number(civil[3]));
    end.setUTCHours(Number(time[1]) + 1, Number(time[2]), 0, 0);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(cutoff));
    const part = type => parts.find(p => p.type === type).value.padStart(type === 'year' ? 4 : 2, '0');
    const boundary = `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
    const finish = `${String(end.getUTCFullYear()).padStart(4, '0')}-${String(end.getUTCMonth()+1).padStart(2,'0')}-${String(end.getUTCDate()).padStart(2,'0')} ${String(end.getUTCHours()).padStart(2,'0')}:${String(end.getUTCMinutes()).padStart(2,'0')}`;
    return finish >= boundary;
};

// Bind the static navigation controls from trusted markup. No event attribute
// strings are interpreted, so CSP can reject all inline JavaScript handlers.
document.addEventListener('DOMContentLoaded', () => {
    const allowedModals = new Set(['modal-legal', 'modal-creeaza-cont', 'modal-rezervare-manuala', 'modal-istoric']);
    document.querySelectorAll('[data-open-modal]').forEach(button => {
        const id = button.dataset.openModal;
        if (!allowedModals.has(id)) return;
        button.addEventListener('click', () => {
            const modal = document.getElementById(id);
            if (modal) modal.style.display = 'flex';
        });
    });
    document.querySelectorAll('[data-admin-action]').forEach(button => {
        const actions = {
            'add-court': () => window.deschideModalAdaugaTeren(),
            'open-schedule': () => window.deschideProgramAdmin(),
            'reload-schedule': () => window.incarcaTabelProgram()
        };
        const action = actions[button.dataset.adminAction];
        if (Object.hasOwn(actions, button.dataset.adminAction)) button.addEventListener('click', action);
    });
});
