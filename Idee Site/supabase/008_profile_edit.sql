-- Spotivity: edit your own profile without changing the Auth identity.
-- Apply after 007_completed_booking_cancellation.sql as postgres.
-- Email changes must use Supabase Auth with Secure email change enabled;
-- the existing Auth email trigger synchronizes only the confirmed email.
-- Existing business rows and admin/base allocations are never rewritten.
-- Historical Auth accounts without a profile get only their missing row.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001, 003, 004, 005, 006 and 007 before 008_profile_edit.sql.';
  end if;
  if exists (
    select 1 from (values (1), (3), (4), (5), (6), (7)) required(version)
    where not exists (
      select 1 from spotivity_private.migrations applied
      where applied.version = required.version
    )
  ) then
    raise exception 'Apply migrations 001, 003, 004, 005, 006 and 007 before 008_profile_edit.sql.';
  end if;
end;
$prerequisite$;

create or replace function spotivity_private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  subject uuid := auth.uid();
  phone_digits text;
begin
  -- A direct browser UPDATE always belongs to its real Auth UUID, including
  -- when the account has an administrative role. Auth-triggered email sync
  -- runs nested, updates only contact email, and keeps its existing access.
  if subject is not null and pg_trigger_depth() = 1 then
    if tg_op = 'UPDATE' then
      if old.user_id is distinct from subject
         or (to_jsonb(new) - array['nume','telefon']) is distinct from
            (to_jsonb(old) - array['nume','telefon']) then
        raise exception 'Clients may change only their own name and phone.';
      end if;
    elsif not spotivity_private.is_super_admin() then
      raise exception 'Profiles are created by Supabase Auth.';
    end if;
  end if;

  -- Validate only fields being edited. Historical empty/short contact fields
  -- must not break a confirmed Auth email change or an unrelated profile edit.
  -- Auth signup and trusted profile creation keep their existing behavior.
  if tg_op = 'UPDATE' and new.nume is distinct from old.nume then
    new.nume := regexp_replace(new.nume, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if new.nume is null or char_length(new.nume) not between 2 and 200
       or new.nume ~ '[[:cntrl:]]' then
      raise exception 'Profile name must contain 2 to 200 characters.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.telefon is distinct from old.telefon then
    new.telefon := regexp_replace(new.telefon, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    phone_digits := regexp_replace(new.telefon, '[^0-9]', '', 'g');
    if new.telefon is null or char_length(new.telefon) > 50
       or new.telefon !~ '^\+?[0-9 ().-]+$'
       or char_length(phone_digits) not between 7 and 15 then
      raise exception 'Profile phone must contain 7 to 15 digits and at most 50 characters.';
    end if;
  end if;
  if tg_op = 'INSERT' and (char_length(new.nume) > 200 or char_length(new.telefon) > 50) then
    raise exception 'Profile field too long.';
  end if;
  return new;
end
$$;

-- Keep the existing trigger object and its enabled state. Add a restrictive
-- policy as well as replacing the managed permissive policy, so another
-- permissive policy cannot grant a signed-in admin/customer cross-user edits.
drop policy if exists profiles_update on public.clienti;
create policy profiles_update on public.clienti for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
drop policy if exists spotivity_profiles_update_guard on public.clienti;
create policy spotivity_profiles_update_guard on public.clienti as restrictive
  for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

revoke all on function spotivity_private.guard_profile()
  from public, anon, authenticated, service_role;

-- Auth accounts predating the signup trigger can have no clienti row. Never
-- adopt an existing same-email profile: only the Auth UUID proves ownership.
-- Keep the signup trigger's metadata defaults and caps for these historical
-- rows, including an empty phone when the account had no phone metadata.
do $missing_profiles$
begin
  if exists (
    select 1 from auth.users u
    join public.clienti c on lower(btrim(c.email)) = lower(btrim(u.email))
    where u.email is not null and btrim(u.email) <> ''
      and not exists (select 1 from public.clienti own where own.user_id = u.id)
  ) then
    raise exception 'Missing profile email conflicts with an existing profile. Review ownership before migration 008.';
  end if;
  if exists (
    select lower(btrim(u.email)) from auth.users u
    where u.email is not null and btrim(u.email) <> ''
      and not exists (select 1 from public.clienti own where own.user_id = u.id)
    group by lower(btrim(u.email)) having count(*) > 1
  ) then
    raise exception 'Missing profiles have duplicate normalized Auth emails. Review accounts before migration 008.';
  end if;

  insert into public.clienti(user_id, email, nume, telefon)
  select u.id, lower(btrim(u.email)),
    left(coalesce(nullif(btrim(u.raw_user_meta_data->>'nume'), ''), split_part(u.email, '@', 1)), 200),
    left(coalesce(u.raw_user_meta_data->>'telefon', ''), 30)
  from auth.users u
  where u.email is not null and btrim(u.email) <> ''
    and not exists (select 1 from public.clienti own where own.user_id = u.id)
  on conflict (user_id) do nothing;
end;
$missing_profiles$;

insert into spotivity_private.migrations(version) values (8)
  on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
