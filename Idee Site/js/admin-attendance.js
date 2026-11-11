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
        container.attendanceRequest = request;
        const current = () => container.isConnected && container.attendanceRequest === request && isCurrent();
        const targets = [...container.querySelectorAll('[data-booking-attendance]')];
        const ids = [...new Set(targets.map(target => target.dataset.bookingAttendance).filter(Boolean))];
        if (!ids.length) return;
        const records = new Map(), pending = new Set();
        const elements = id => targets.filter(target => target.dataset.bookingAttendance === id && target.isConnected);
        function render(id, message = '') {
            const attendance = records.get(id);
            for (const target of elements(id)) {
                target.replaceChildren();
                const label = node('p', 'booking-attendance-label', `Prezență: ${attendance?.status === 'present' ? 'S-a prezentat' : attendance?.status === 'no_show' ? 'Nu s-a prezentat' : 'Nemarcată'}`);
                label.dataset.attendanceStatus = attendance?.status || 'unmarked';
                target.append(label);
                if (attendance?.can_mark) {
                    const actions = node('div', 'booking-attendance-actions');
                    for (const [value, title] of [['present', 'S-a prezentat'], ['no_show', 'Nu s-a prezentat']]) {
                        const button = node('button', 'booking-attendance-choice', title);
                        button.type = 'button'; button.dataset.attendanceChoice = value;
                        button.setAttribute('aria-pressed', String(attendance.status === value));
                        button.disabled = pending.has(id) || attendance.status === value;
                        button.addEventListener('click', () => void save(id, value));
                        actions.append(button);
                    }
                    target.append(actions);
                } else target.append(node('p', 'booking-attendance-help', 'Prezența se marchează după încheierea întregii rezervări.'));
                if (message) {
                    const status = node('p', 'booking-attendance-feedback', message);
                    status.setAttribute('role', 'status'); target.append(status);
                }
            }
        }
        async function save(id, status) {
            const previous = records.get(id);
            if (!current() || !previous?.can_mark || pending.has(id)) return;
            const question = status === 'no_show'
                ? 'Marchezi că acest client nu s-a prezentat la întreaga rezervare? Neprezentarea intră în totalul abaterilor, o singură dată pentru această rezervare, iar clientul primește un email de avertizare.'
                : previous.status === 'no_show'
                    ? 'Corectezi neprezentarea și marchezi „S-a prezentat”? Totalul abaterilor se recalculează, iar clientul primește un email de corectare.' : '';
            if (question && !window.confirm(question)) return;
            pending.add(id); render(id, 'Se salvează prezența…');
            try {
                const { data, error } = await db.rpc('set_booking_attendance', { p_booking_id: id, p_status: status, p_expected_revision: previous.revision });
                if (!current()) return;
                if (error || !data || data.booking_id !== id || data.status !== status || !Number.isInteger(data.revision)) throw error || new Error('invalid_response');
                records.set(id, { ...previous, status: data.status, revision: data.revision });
                pending.delete(id);
                render(id, data.email_queued ? 'Prezența a fost salvată. Emailul clientului a fost pus în coadă.' : 'Prezența a fost salvată.');
                window.dispatchEvent(new CustomEvent('spotivity:attendance-changed'));
            } catch (error) {
                if (!current()) return;
                pending.delete(id);
                render(id, error?.code === '40001' ? 'Prezența a fost modificată între timp. Reîncarcă rezervările înainte să salvezi.' : 'Prezența nu a putut fi salvată. Reîncarcă rezervările și încearcă din nou.');
            }
        }
        targets.forEach(target => { target.textContent = 'Se încarcă prezența…'; });
        try {
            for (let offset = 0; offset < ids.length; offset += 500) {
                const { data, error } = await db.rpc('get_booking_attendance', { p_booking_ids: ids.slice(offset, offset + 500) });
                if (!current()) return;
                if (error || !Array.isArray(data)) throw error || new Error('invalid_response');
                data.forEach(record => records.set(record.booking_id, record));
            }
            if (!current()) return;
            ids.forEach(id => {
                if (records.has(id)) render(id);
                else elements(id).forEach(target => { target.textContent = 'Prezența nu este disponibilă pentru această rezervare.'; });
            });
        } catch {
            if (current()) targets.filter(target => target.isConnected).forEach(target => { target.textContent = 'Prezența nu a putut fi încărcată. Reîncarcă rezervările.'; });
        }
    };
})();
