#!/usr/bin/env python3
"""Real PostgreSQL sessions in a disposable, network-isolated Docker container.

Run: python supabase/tests/booking-state-concurrency.test.py
Requires a cached postgres:17 image and local Docker. Never connects to hosted DBs.
SPOTIVITY_TEST_MIGRATION_MAX=40 reproduces the regression before migration042.
"""
import json
import os
import queue
import subprocess
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = 'spotivity-state-test-' + uuid.uuid4().hex[:12]
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
MAX_MIGRATION = int(os.environ.get('SPOTIVITY_TEST_MIGRATION_MAX', '42'))
sessions = []
started = False


def docker(*args, data=None, check=True):
    return subprocess.run(DOCKER + list(args), input=data, text=True,
                          capture_output=True, timeout=30, check=check)


def sql(query):
    result = docker('exec', '-i', NAME, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
                    '-U', 'postgres', '-d', 'scratch', data=query, check=False)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def session(app):
    process = subprocess.Popen(DOCKER + ['exec', '-i', '-e', 'PGAPPNAME=' + app,
        NAME, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'scratch'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1)
    sessions.append(process)
    return process


def expect_line(process, expected):
    output = queue.Queue()
    threading.Thread(target=lambda: output.put(process.stdout.readline().strip()), daemon=True).start()
    actual = output.get(timeout=10)
    assert actual == expected, (actual, expected)


def staff_session(app, person):
    process = session(app)
    user = '00000000-0000-0000-0000-' + str(person).zfill(12)
    process.stdin.write("begin isolation level read committed;set local statement_timeout='15s';select set_config('request.jwt.claim.sub','" + user + "',true);set local role authenticated;\n")
    process.stdin.flush()
    expect_line(process, user)
    return process


def expect_blocked(process, app):
    for _ in range(100):
        blocked = sql("select wait_event_type||':'||wait_event||':'||cardinality(pg_blocking_pids(pid)) from pg_stat_activity where application_name='" + app + "';")
        if blocked.startswith('Lock:') and blocked.endswith(':1'):
            return blocked
        assert process.poll() is None, 'Second request exited before waiting on the first'
        time.sleep(.025)
    raise AssertionError('Second request did not wait on the first')


try:
    docker('run', '--pull=never', '--rm', '-d', '--name', NAME, '--network', 'none',
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=scratch',
           'postgres:17', '-c', 'listen_addresses=')
    started = True
    for _ in range(100):
        initialized = 'PostgreSQL init process complete' in docker('logs', NAME).stdout
        ready = docker('exec', NAME, 'pg_isready', '-U', 'postgres', '-d', 'scratch', check=False)
        if initialized and ready.returncode == 0:
            break
        time.sleep(.1)
    else:
        raise AssertionError('Temporary PostgreSQL did not become ready')
    schema = (ROOT / 'tests/schema.sql').read_text() + """
    alter table auth.users add column created_at timestamptz not null default '2000-01-01',
        add column deleted_at timestamptz,add column banned_until timestamptz,
        add column is_anonymous boolean not null default false;
    """
    schema += '\n' + '\n'.join(path.read_text() for path in sorted(ROOT.glob('0*.sql'))
                              if 1 <= int(path.name[:3]) <= min(MAX_MIGRATION, 41))
    sql(schema)
    before = sql("select json_build_object('reservations',(select json_agg(r) from public.rezervari r),'groups',(select json_agg(g) from spotivity_private.booking_groups g),'jobs',(select json_agg(n) from spotivity_private.notification_outbox n));")
    if MAX_MIGRATION >= 42:
        migration = (ROOT / '042_concurrent_booking_group_status.sql').read_text()
        sql(migration)
        sql(migration)
        assert sql("select json_build_object('reservations',(select json_agg(r) from public.rezervari r),'groups',(select json_agg(g) from spotivity_private.booking_groups g),'jobs',(select json_agg(n) from spotivity_private.notification_outbox n));") == before, 'Installation/reapplication changes no business rows or mail'
    sql("""insert into auth.users(id,email,email_confirmed_at)values('00000000-0000-0000-0000-000000000005','second-staff@example.test',now());
        insert into public.users_admin(nume_admin,email,is_super,terenuri)values('Second Staff','second-staff@example.test',false,'Court A');""")
    booking = '10000000-0000-4000-8000-000000000001'
    sql("select public.create_guest_booking_group('" + booking + "','1',(current_date+3),array['16:00','17:00'],false,'Synthetic Guest','guest@example.test','0712345678',200);")
    a, b = staff_session('booking_state_A', 3), staff_session('booking_state_B', 5)
    a.stdin.write("update public.rezervari set stare='anulata' where booking_group_id='" + booking + "' and ora='16:00';select 'A_CANCELLED_FIRST_HOUR';\n")
    a.stdin.flush()
    expect_line(a, 'A_CANCELLED_FIRST_HOUR')
    b.stdin.write("update public.rezervari set stare='anulata' where booking_group_id='" + booking + "' and ora='17:00';commit;\n")
    b.stdin.close()
    blocked = expect_blocked(b, 'booking_state_B')
    a.stdin.write('commit;\n\\q\n')
    a.stdin.close()
    for process in [a, b]:
        process.wait(timeout=10)
        assert process.returncode == 0, process.stderr.read()
    observed = json.loads(sql("select json_build_object('persisted',b.status,'derived',spotivity_private.booking_group_result(b.id)->>'state','active_slots',(select count(*) from public.rezervari r where r.booking_group_id=b.id and r.stare='activa'),'total',b.total,'slot_prices',(select json_agg(r.pret_total order by r.ora) from public.rezervari r where r.booking_group_id=b.id)) from spotivity_private.booking_groups b where b.id='" + booking + "';"))
    assert observed['active_slots'] == 0, observed
    assert observed['persisted'] == observed['derived'] == 'anulata', observed
    assert observed['total'] == 200 and observed['slot_prices'] == ['100 RON', '100 RON'], observed
    context = sql("begin;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';set local role authenticated;select public.get_email_booking_context('" + booking + "')->>'status';commit;")
    assert context == 'anulata', context
    # A simultaneous attendance correction must keep its revision conflict and
    # emit no notice until the other administrator reloads the committed state.
    attendance_booking = '10000000-0000-4000-8000-000000000002'
    sql("select public.create_guest_booking_group('" + attendance_booking + "','1',(current_date+4),array['16:00'],false,'Attendance Guest','attendance@example.test','0712345678',100);")
    sql("alter table public.rezervari disable trigger spotivity_booking_guard;update public.rezervari set starts_at=statement_timestamp()-interval'2 hours'where booking_group_id='" + attendance_booking + "';alter table public.rezervari enable trigger spotivity_booking_guard;")
    a, b = staff_session('booking_attendance_A', 3), staff_session('booking_attendance_B', 5)
    a.stdin.write("do $$begin perform public.set_booking_attendance('" + attendance_booking + "','no_show',0);end$$;select 'A_RECORDED_ATTENDANCE';\n")
    a.stdin.flush()
    expect_line(a, 'A_RECORDED_ATTENDANCE')
    b.stdin.write("select public.set_booking_attendance('" + attendance_booking + "','present',0);commit;\n")
    b.stdin.close()
    attendance_wait = expect_blocked(b, 'booking_attendance_B')
    a.stdin.write('commit;\n\\q\n')
    a.stdin.close()
    a.wait(timeout=10)
    b.wait(timeout=10)
    assert a.returncode == 0, a.stderr.read()
    assert b.returncode != 0 and 'Attendance changed' in b.stderr.read(), 'Stale attendance must require a reload'
    attendance = json.loads(sql("select json_build_object('status',a.status,'revision',a.revision,'events',(select count(*)from spotivity_private.booking_attendance_events e where e.booking_id=a.booking_id),'jobs',(select count(*)from spotivity_private.notification_outbox n where n.booking_id=a.booking_id and n.kind='booking_attendance_client'))from spotivity_private.booking_attendance a where a.booking_id='" + attendance_booking + "';"))
    assert attendance == {'status': 'no_show', 'revision': 1, 'events': 1, 'jobs': 1}, attendance
    corrected = json.loads(sql("begin;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';set local role authenticated;select public.set_booking_attendance('" + attendance_booking + "','present',1);commit;"))
    assert corrected['revision'] == 2 and corrected['changed'] is True, corrected
    assert sql("select count(*)from spotivity_private.booking_incidents where booking_id='" + attendance_booking + "';") == '0'
    cutoff = docker('exec', '-i', NAME, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'scratch',
                    data="begin;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';set local role authenticated;update public.rezervari set stare='anulata'where booking_group_id='" + attendance_booking + "';commit;", check=False)
    assert cutoff.returncode != 0 and 'Completed bookings cannot be cancelled' in cutoff.stderr, cutoff.stderr
    print(json.dumps({'status': 'PASS', 'migrations_through': MAX_MIGRATION,
                      'observed_wait': blocked, 'booking': observed,
                      'attendance_wait': attendance_wait, 'stale_attendance': attendance,
                      'attendance_correction_revision': corrected['revision']}))
finally:
    for process in sessions:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
    if started:
        cleanup = docker('rm', '-f', '-v', NAME, check=False)
        assert cleanup.returncode == 0, cleanup.stderr
