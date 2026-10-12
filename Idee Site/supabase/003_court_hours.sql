-- Spotivity: configurable hourly START slots for each court.
-- Run as postgres after 001_security.sql. No bookings, availability rows, or
-- webhook objects are rewritten. Existing courts keep their 12:00–22:00 slots.
begin;
set local datestyle = 'ISO, YMD';

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply 001_security.sql before 003_court_hours.sql.';
  end if;
  if not exists (select 1 from spotivity_private.migrations where version = 1) then
    raise exception 'Apply 001_security.sql before 003_court_hours.sql.';
  end if;
end;
$prerequisite$;

alter table public.terenuri add column if not exists ore_rezervabile text[] not null
  default array['12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];
do $column_type$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.terenuri'::regclass and attname = 'ore_rezervabile'
      and not attisdropped and atttypid = 'text[]'::regtype
  ) then raise exception 'terenuri.ore_rezervabile must have type text[].'; end if;
end;
$column_type$;
alter table public.terenuri alter column ore_rezervabile set not null;
alter table public.terenuri alter column ore_rezervabile set default
  array['12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];

-- Pure validation/normalization only; no privileges or application data are read.
-- PostgreSQL's canonical empty array represents a court with no bookable slots.
create or replace function spotivity_private.normalize_court_hours(hours text[])
returns text[] language plpgsql immutable set search_path = '' as $$
begin
  if hours is null or (cardinality(hours) > 0 and
     (array_ndims(hours) <> 1 or array_lower(hours, 1) <> 1)) then
    raise exception 'Court hours must be a one-dimensional, one-based text array, or an empty array.';
  end if;
  if exists (select 1 from unnest(hours) slot
             where slot is null or slot !~ '^(09|1[0-9]|2[0-2]):00$') then
    raise exception 'Court hours must be hourly START slots between 09:00 and 22:00.';
  end if;
  if cardinality(hours) <> (select count(distinct slot) from unnest(hours) slot) then
    raise exception 'Court hours must not contain duplicates.';
  end if;
  return array(select slot from unnest(hours) slot order by slot);
end $$;
revoke all on function spotivity_private.normalize_court_hours(text[]) from public, anon, authenticated;
-- The CHECK constraint also runs under the writer's role. This pure helper is
-- callable by writers, while all trigger functions below remain private.
grant execute on function spotivity_private.normalize_court_hours(text[]) to authenticated, service_role;
do $hours_constraint$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.terenuri'::regclass
      and conname = 'spotivity_court_hours_canonical'
  ) then
    alter table public.terenuri add constraint spotivity_court_hours_canonical
      check (ore_rezervabile = spotivity_private.normalize_court_hours(ore_rezervabile));
  end if;
end;
$hours_constraint$;

-- Same existing court permissions; assigned admins may additionally edit hours.
create or replace function spotivity_private.guard_court() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.ore_rezervabile := spotivity_private.normalize_court_hours(new.ore_rezervabile);
  if new.nume is null or btrim(new.nume) = '' or position(',' in new.nume) > 0
     or new.pret is null or new.pret < 0 or new.pret_minge < 0 then raise exception 'Invalid court name or price.'; end if;
  if tg_op = 'UPDATE' and new.nume is distinct from old.nume
     and auth.uid() is not null and not spotivity_private.is_super_admin() then
    raise exception 'Only superadmins may rename courts.';
  end if;
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if tg_op <> 'UPDATE' or not spotivity_private.manages_court(old.nume)
       or (to_jsonb(new) - array['pret','pret_minge','optiune_minge','poza','locatie','oras','este_activ','are_chat','ore_rezervabile'])
          is distinct from (to_jsonb(old) - array['pret','pret_minge','optiune_minge','poza','locatie','oras','este_activ','are_chat','ore_rezervabile']) then
      raise exception 'Admin may update only settings of assigned courts.';
    end if;
  end if;
  return new;
end $$;

create or replace function spotivity_private.booking_instant(day_text text, hour_text text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
begin
  if day_text is null or day_text !~ '^\d{4}-\d{2}-\d{2}$'
     or hour_text is null or hour_text !~ '^(09|1[0-9]|2[0-2]):00$' then
    raise exception 'Use YYYY-MM-DD and an hourly START slot between 09:00 and 22:00.';
  end if;
  return (day_text::date + hour_text::time) at time zone 'Europe/Bucharest';
end $$;

-- Preserve identity, ownership, pricing, lead time and unlimited cancellation.
-- A shared row lock serializes a new booking with concurrent schedule edits.
-- Existing bookings stay valid after schedule changes; cancellations and trusted
-- Auth/court-name synchronization do not revalidate their historical hours.
create or replace function spotivity_private.guard_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare court public.terenuri%rowtype; owner_id uuid; owner_email text; new_slot boolean := false;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and pg_trigger_depth() = 1 and not spotivity_private.manages_court(old.teren) then
    if old.client_user_id is distinct from auth.uid()
       or (to_jsonb(new) - 'stare') is distinct from (to_jsonb(old) - 'stare')
       or old.stare <> 'activa' or new.stare <> 'anulata' then
      raise exception 'Only cancellation of your own active booking is allowed.';
    end if;
    return new;
  end if;
  new.starts_at := spotivity_private.booking_instant(new.data_str, new.ora);
  if new.stare is null or new.stare not in ('activa','anulata') then raise exception 'Invalid booking state.'; end if;
  if tg_op = 'INSERT' then
    new.timestamp_start := (extract(epoch from now()) * 1000)::bigint;
    new.created_at := now();
    new_slot := new.stare = 'activa';
  else
    new_slot := new.stare = 'activa' and (
      old.stare is distinct from 'activa' or old.teren is distinct from new.teren
      or old.data_str is distinct from new.data_str or old.ora is distinct from new.ora
    );
  end if;
  if new_slot and pg_trigger_depth() = 1 then
    select * into court from public.terenuri where nume = new.teren for share;
    if court.nume is null then raise exception 'Court does not exist.'; end if;
    if not (new.ora = any(court.ore_rezervabile)) then
      raise exception 'This hourly START slot is not enabled for the selected court.';
    end if;
  end if;
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if court.nume is null then
    select * into court from public.terenuri where nume = new.teren for share;
  end if;
  if court.nume is null then raise exception 'Court does not exist.'; end if;
  if spotivity_private.manages_court(new.teren) then
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    new.client_user_id := owner_id;
    if owner_id is not null then new.email_client := owner_email; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' or spotivity_private.current_email() is null
     or (new.client_user_id is not null and new.client_user_id <> auth.uid())
     or (new.email_client is not null and lower(btrim(new.email_client)) <> spotivity_private.current_email())
     or new.stare <> 'activa' or court.este_activ is false
     or new.starts_at < now() + interval '1 hour'
     or new.data_str::date > (now() at time zone 'Europe/Bucharest')::date + 6 then
    raise exception 'Invalid booking identity, court, date, or lead time.';
  end if;
  if new.cu_minge and court.optiune_minge is not true then raise exception 'Ball rental is unavailable.'; end if;
  new.client_user_id := auth.uid();
  new.email_client := spotivity_private.current_email();
  new.sport := court.sport;
  new.pret_total := (court.pret + case when new.cu_minge then coalesce(court.pret_minge,15) else 0 end)::text
                    || case when new.cu_minge then ' RON (+Minge)' else ' RON' end;
  return new;
end $$;
revoke all on function spotivity_private.guard_court(), spotivity_private.booking_instant(text,text),
  spotivity_private.guard_booking() from public, anon, authenticated;

insert into spotivity_private.migrations(version) values (3) on conflict (version) do nothing;
commit;
