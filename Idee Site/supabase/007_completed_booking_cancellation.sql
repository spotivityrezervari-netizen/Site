-- Spotivity: completed one-hour reservations cannot be cancelled by a signed-in
-- client, court administrator or superadministrator. Future and ongoing slots
-- keep their existing cancellation permissions.
-- Apply after 006_sports_bases.sql as postgres. No business rows are rewritten.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001, 003, 004, 005 and 006 before 007_completed_booking_cancellation.sql.';
  end if;
  if exists (
    select 1 from (values (1), (3), (4), (5), (6)) required(version)
    where not exists (
      select 1 from spotivity_private.migrations applied
      where applied.version = required.version
    )
  ) then
    raise exception 'Apply migrations 001, 003, 004, 005 and 006 before 007_completed_booking_cancellation.sql.';
  end if;
end;
$prerequisite$;

create or replace function spotivity_private.guard_completed_booking_cancellation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Use the persisted instant: changing the date/hour/starts_at in this same
  -- UPDATE must not turn a completed reservation into a cancellable one.
  -- statement_timestamp also handles requests in a long-running transaction.
  -- Trusted SQL/service maintenance with no Auth subject retains its access.
  if auth.uid() is not null
     and old.stare = 'activa' and new.stare = 'anulata'
     and old.starts_at + interval '1 hour' <= statement_timestamp() then
    raise exception 'Completed bookings cannot be cancelled.';
  end if;
  return new;
end
$$;

-- Keep this separate from guard_booking so rerunning migration 004 cannot
-- restore cancellation of completed slots. Existing guards, availability
-- synchronization, permissions and webhook definitions remain in place.
drop trigger if exists spotivity_booking_completed_guard on public.rezervari;
create trigger spotivity_booking_completed_guard before update on public.rezervari
for each row execute function spotivity_private.guard_completed_booking_cancellation();

revoke all on function spotivity_private.guard_completed_booking_cancellation()
  from public, anon, authenticated, service_role;

insert into spotivity_private.migrations(version) values (7)
  on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
