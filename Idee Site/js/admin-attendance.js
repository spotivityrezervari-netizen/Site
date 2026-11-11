/* Attendance is authorized and counted by SQL, never inferred in the browser. */
(() => {
    'use strict';
    const node = (tag, className, text) => {
        const result = document.createElement(tag);
        result.className = className;
        if (text !== undefined) result.textContent = text;
        return result;
    };
    window.loadBookingAttendanceControls = async function({ db, container, isCurrent = () => true }) {
        const request = Symbol('attendance');
        clearTimeout(container.attendanceTimer);
        container.attendanceRequest = request;
        const current = () => container.isConnected && container.attendanceRequest === request && isCurrent();
        const targets = [...container.querySelectorAll('[data-booking-attendance],[data-reservation-attendance]')];
        const keyOf = target => target.dataset.bookingAttendance ? `group:${target.dataset.bookingAttendance}` : `legacy:${target.dataset.reservationAttendance}`;
        const keys = [...new Set(targets.map(keyOf))];
        if (!keys.length) return;
        const records = new Map(), pending = new Set(), emails = new Map();
        const elements = key => targets.filter(target => keyOf(target) === key && target.isConnected);
        function render(id, message = '') {
            const attendance = records.get(id);
            for (const target of elements(id)) {
                target.replaceChildren();
                const label = node('p', 'booking-attendance-label', `Prezență: ${attendance?.status === 'present' ? 'S-a prezentat' : attendance?.status === 'no_show' ? 'Nu s-a prezentat' : 'Nemarcată'}`);
                label.dataset.attendanceStatus = attendance?.status || 'unmarked';
                target.append(label);
                if (attendance?.needs_email && attendance.can_mark) {
                    const label = node('label', 'booking-attendance-email', 'Emailul clientului');
                    const input = node('input', 'booking-attendance-email-input');
                    input.type = 'email'; input.autocomplete = 'off'; input.required = true; input.maxLength = 254;
                    input.pattern = '[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+';
                    input.placeholder = 'nume@exemplu.ro'; input.value = emails.get(id) || ''; input.disabled = pending.has(id);
                    input.addEventListener('input', () => emails.set(id, input.value));
                    label.append(input); target.append(label);
                    target.append(node('p', 'booking-attendance-help', 'Rezervarea nu are email. Completează adresa pentru identificarea clientului și trimiterea avertizării.'));
                }
                {
                    const actions = node('div', 'booking-attendance-actions');
                    for (const [value, title] of [['present', 'S-a prezentat'], ['no_show', 'Nu s-a prezentat']]) {
                        const button = node('button', 'booking-attendance-choice', title);
                        button.type = 'button'; button.dataset.attendanceChoice = value;
                        button.setAttribute('aria-pressed', String(attendance.status === value));
                        button.disabled = !attendance?.can_mark || pending.has(id) || attendance.status === value;
                        button.addEventListener('click', () => void save(id, value));
                        actions.append(button);
                    }
                    target.append(actions);
                }
                if (!attendance?.can_mark) {
                    const end = new Date(attendance?.ends_at || '');
                    const when = Number.isFinite(end.getTime()) ? new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Bucharest' }).format(end) : '';
                    target.append(node('p', 'booking-attendance-help', when ? `Prezența poate fi marcată după ${when}, ora României.` : 'Prezența se marchează după încheierea întregii rezervări.'));
                }
                if (message) {
                    const status = node('p', 'booking-attendance-feedback', message);
                    status.setAttribute('role', 'status'); target.append(status);
                }
            }
        }
        async function save(id, status) {
            const previous = records.get(id);
            if (!current() || !previous?.can_mark || pending.has(id)) return;
            let email = null;
            if (previous.needs_email) {
                const input = elements(id)[0]?.querySelector('input[type="email"]');
                if (input) input.value = input.value.trim();
                if (!input?.reportValidity()) return;
                email = input.value.trim().toLowerCase(); emails.set(id, email);
            }
            const question = status === 'no_show'
                ? 'Marchezi că acest client nu s-a prezentat la întreaga rezervare? Neprezentarea intră în totalul abaterilor, o singură dată pentru această rezervare, iar clientul primește un email de avertizare.'
                : previous.status === 'no_show'
                    ? 'Corectezi neprezentarea și marchezi „S-a prezentat”? Totalul abaterilor se recalculează, iar clientul primește un email de corectare.' : '';
            if (question && !window.confirm(question + (email ? `\nEmail client: ${email}` : ''))) return;
            pending.add(id); render(id, 'Se salvează prezența…');
            try {
                const legacy = id.startsWith('legacy:'), reference = id.slice(id.indexOf(':') + 1);
                const { data, error } = await db.rpc(legacy ? 'set_legacy_booking_attendance' : 'set_booking_attendance', {
                    ...(legacy ? { p_reservation_id: reference, p_email: email } : { p_booking_id: reference }), p_status: status, p_expected_revision: previous.revision
                });
                if (!current()) return;
                if (error || !data || (legacy ? data.reservation_id !== reference : data.booking_id !== reference) || data.status !== status || !Number.isInteger(data.revision)) throw error || new Error('invalid_response');
                records.set(id, { ...previous, status: data.status, revision: data.revision, needs_email: false });
                emails.delete(id);
                pending.delete(id);
                render(id, data.email_queued ? (status === 'no_show' ? 'Neprezentarea a fost adăugată la totalul abaterilor. Emailul clientului a fost pus în coadă.' : 'Prezența și totalul abaterilor au fost corectate. Emailul clientului a fost pus în coadă.') : 'Prezența a fost salvată.');
                window.dispatchEvent(new CustomEvent('spotivity:attendance-changed'));
            } catch (error) {
                if (!current()) return;
                pending.delete(id);
                render(id, error?.code === '40001' ? 'Prezența a fost modificată între timp. Reîncarcă rezervările înainte să salvezi.' : 'Prezența nu a putut fi salvată. Reîncarcă rezervările și încearcă din nou.');
            }
        }
        targets.forEach(target => { target.textContent = 'Se încarcă prezența…'; });
        try {
            for (const kind of ['group', 'legacy']) {
                const ids = keys.filter(key => key.startsWith(kind + ':')).map(key => key.slice(kind.length + 1));
                for (let offset = 0; offset < ids.length; offset += 500) {
                    const { data, error } = await db.rpc(kind === 'group' ? 'get_booking_attendance' : 'get_legacy_booking_attendance', {
                        [kind === 'group' ? 'p_booking_ids' : 'p_reservation_ids']: ids.slice(offset, offset + 500)
                    });
                    if (!current()) return;
                    if (error || !Array.isArray(data)) throw error || new Error('invalid_response');
                    data.forEach(record => records.set(`${kind}:${kind === 'group' ? record.booking_id : record.reservation_id}`, record));
                }
            }
            if (!current()) return;
            keys.forEach(id => {
                if (records.has(id)) render(id);
                else elements(id).forEach(target => { target.textContent = 'Prezența nu este disponibilă pentru această rezervare.'; });
            });
            if ([...records.values()].some(record => !record.can_mark && Number.isFinite(Date.parse(record.ends_at)))) {
                const refresh = () => {
                    if (!current()) return;
                    const editing = pending.size || [...emails.values()].some(value => value.trim()) || container.contains(document.activeElement) && document.activeElement.matches('input,select,textarea');
                    if (!editing && !document.hidden && container.getClientRects().length) void window.loadBookingAttendanceControls({ db, container, isCurrent });
                    else container.attendanceTimer = setTimeout(refresh, 60000);
                };
                container.attendanceTimer = setTimeout(refresh, 60000);
            }
        } catch {
            if (current()) targets.filter(target => target.isConnected).forEach(target => { target.textContent = 'Prezența nu a putut fi încărcată. Reîncarcă rezervările.'; });
        }
    };
})();
