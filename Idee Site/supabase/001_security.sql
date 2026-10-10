-- Spotivity: run as postgres in Supabase SQL Editor, after reviewing README.md.
-- Transactional: invalid/ambiguous legacy data aborts the entire migration.
begin;
set local datestyle = 'ISO, YMD';

-- An existing public definer RPC or owner-run view can bypass table RLS.
-- Stop for review instead of silently breaking or trusting unknown interfaces.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) then raise exception 'Review exposed public SECURITY DEFINER RPCs before enabling this security model.'; end if;
  if exists (
    select 1 from pg_class v join pg_namespace vn on vn.oid = v.relnamespace
    join pg_rewrite rw on rw.ev_class = v.oid join pg_depend d on d.objid = rw.oid and d.classid = 'pg_rewrite'::regclass
    join pg_class t on t.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
    join pg_namespace tn on tn.oid = t.relnamespace
    where vn.nspname = 'public' and tn.nspname = 'public' and v.relkind in ('v','m')
      and t.relname in ('clienti','users_admin','rezervari','mesaje_chat')
      and (has_table_privilege('anon',v.oid,'SELECT') or has_table_privilege('authenticated',v.oid,'SELECT'))
      and (v.relkind = 'm' or not coalesce(v.reloptions,'{}') @> array['security_invoker=true'])
  ) then raise exception 'Review public views/materialized views that can expose private application data.'; end if;
end $$;

create schema if not exists spotivity_private;
revoke all on schema spotivity_private from public;
grant usage on schema spotivity_private to authenticated;
create table if not exists spotivity_private.migrations (
  version integer primary key, applied_at timestamptz not null default now()
);

-- Keep compatibility with the existing admin panel; never derive roles from user_metadata.
create table if not exists public.users_admin (
  id uuid primary key default gen_random_uuid(),
  nume_admin text not null,
  email text not null,
  is_super boolean not null default false,
  terenuri text not null default ''
);
alter table public.clienti add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.users_admin add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.rezervari add column if not exists client_user_id uuid references auth.users(id) on delete set null;
alter table public.rezervari add column if not exists starts_at timestamptz;
alter table public.rezervari add column if not exists cu_minge boolean not null default false;
alter table public.mesaje_chat add column if not exists client_user_id uuid references auth.users(id) on delete set null;

-- Never silently choose one identity or one court when legacy records are ambiguous.
do $$
begin
  if exists (select 1 from public.clienti group by lower(btrim(email)) having count(*) > 1)
     or exists (select 1 from public.users_admin group by lower(btrim(email)) having count(*) > 1)
     or exists (select 1 from auth.users where email is not null group by lower(btrim(email)) having count(*) > 1) then
    raise exception 'Duplicate profile/admin emails. Review them before migration.';
  end if;
  if exists (select 1 from public.terenuri group by nume having count(*) > 1)
     or exists (select 1 from public.terenuri where nume is null or btrim(nume) = '' or position(',' in nume) > 0) then
    raise exception 'Court names must be nonempty, unique, and contain no commas.';
  end if;
end $$;

update public.clienti c set user_id = u.id, email = lower(btrim(u.email))
from auth.users u where lower(btrim(c.email)) = lower(btrim(u.email)) and c.user_id is null
  and not exists (select 1 from spotivity_private.migrations where version = 1);
update public.users_admin a set user_id = u.id, email = lower(btrim(u.email))
from auth.users u where lower(btrim(a.email)) = lower(btrim(u.email)) and a.user_id is null
  and not exists (select 1 from spotivity_private.migrations where version = 1);
update public.rezervari r set client_user_id = u.id
from auth.users u where lower(btrim(r.email_client)) = lower(btrim(u.email)) and r.client_user_id is null
  and not exists (select 1 from spotivity_private.migrations where version = 1);
update public.mesaje_chat m set client_user_id = u.id
from auth.users u where lower(btrim(m.email_client)) = lower(btrim(u.email)) and m.client_user_id is null
  and not exists (select 1 from spotivity_private.migrations where version = 1);

do $$
begin
  if exists (select 1 from public.users_admin a left join auth.users u on u.id = a.user_id
             where u.id is null or u.email_confirmed_at is null
                or lower(btrim(a.email)) is distinct from lower(btrim(u.email))) then
    raise exception 'Every existing admin must match an existing, confirmed Supabase Auth user. Audit roles first.';
  end if;
  if exists (select 1 from public.clienti c join auth.users u on u.id = c.user_id
             where lower(btrim(c.email)) is distinct from lower(btrim(u.email))) then
    raise exception 'A profile user_id/email does not match Auth.';
  end if;
end $$;

create unique index if not exists spotivity_clienti_user_id on public.clienti(user_id);
create unique index if not exists spotivity_clienti_email on public.clienti(lower(btrim(email)));
create unique index if not exists spotivity_admin_user_id on public.users_admin(user_id);
create unique index if not exists spotivity_admin_email on public.users_admin(lower(btrim(email)));
create unique index if not exists spotivity_teren_nume on public.terenuri(nume);
alter table public.users_admin alter column user_id set not null;

create or replace function spotivity_private.current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(btrim(email)) from auth.users
  where id = (select auth.uid()) and email_confirmed_at is not null
$$;
create or replace function spotivity_private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users_admin
    where user_id = (select auth.uid()) and is_super is true)
$$;
create or replace function spotivity_private.manages_court(court_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users_admin a
    where a.user_id = (select auth.uid()) and (
      a.is_super is true or exists (
        select 1 from unnest(string_to_array(a.terenuri, ',')) allocated
        where btrim(allocated) = court_name
      )
    ))
$$;
create or replace function spotivity_private.is_court_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select spotivity_private.is_super_admin() or exists (
    select 1 from public.terenuri t where spotivity_private.manages_court(t.nume)
  )
$$;
create or replace function spotivity_private.can_read_client(client_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select spotivity_private.is_super_admin() or client_id = (select auth.uid()) or exists (
    select 1 from public.rezervari r
    where r.client_user_id = client_id and spotivity_private.manages_court(r.teren)
  )
$$;

-- Existing browser dates omit the year. Convert using the recorded creation year,
-- matching the old frontend's December -> January rule. Review this conversion first.
create or replace function spotivity_private.legacy_booking_date(value text, created_ms bigint, created_on timestamptz)
returns date language plpgsql stable set search_path = '' as $$
declare
  anchor timestamp := coalesce(to_timestamp(created_ms::double precision / 1000), created_on, now()) at time zone 'Europe/Bucharest';
  parts text[];
  year_number integer;
  recovered date;
begin
  if value ~ '^\d{4}-\d{2}-\d{2}$' then return value::date; end if;
  parts := regexp_match(value, '^(Dum|Lun|Mar|Mie|Joi|Vin|Sâm), ([0-9]{2})\.([0-9]{2})$');
  if parts is null or (created_ms is null and created_on is null) then
    raise exception 'Cannot recover the year of legacy booking date %. Review the source data.', value;
  end if;
  year_number := extract(year from anchor)::integer;
  if extract(month from anchor) = 12 and parts[3] = '01' then year_number := year_number + 1; end if;
  recovered := make_date(year_number, parts[3]::integer, parts[2]::integer);
  if parts[1] <> (array['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'])[extract(dow from recovered)::integer + 1] then
    raise exception 'Legacy weekday/year mismatch for %. Review its intended year.', value;
  end if;
  return recovered;
end $$;
update public.rezervari
set data_str = spotivity_private.legacy_booking_date(data_str, timestamp_start, created_at)::text
where data_str !~ '^\d{4}-\d{2}-\d{2}$';

create or replace function spotivity_private.booking_instant(day_text text, hour_text text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
begin
  if day_text is null or day_text !~ '^\d{4}-\d{2}-\d{2}$'
     or hour_text is null or hour_text !~ '^(1[2-9]|2[0-2]):00$' then
    raise exception 'Use YYYY-MM-DD and an hourly slot between 12:00 and 22:00.';
  end if;
  return (day_text::date + hour_text::time) at time zone 'Europe/Bucharest';
end $$;
update public.rezervari set starts_at = spotivity_private.booking_instant(data_str, ora);
alter table public.rezervari alter column starts_at set not null;
create unique index if not exists spotivity_one_active_slot
  on public.rezervari(teren, starts_at) where stare = 'activa';
create index if not exists spotivity_booking_owner on public.rezervari(client_user_id, teren);
create index if not exists spotivity_chat_owner on public.mesaje_chat(client_user_id, teren);

-- RLS cannot hide individual columns in a row. Publish availability separately.
create table if not exists public.rezervari_disponibilitate (
  id text primary key,
  teren text not null,
  data_str text not null,
  ora text not null
);
create or replace function spotivity_private.sync_availability() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.rezervari_disponibilitate where id = old.id::text;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.id::text is distinct from old.id::text then
    delete from public.rezervari_disponibilitate where id = old.id::text;
  end if;
  delete from public.rezervari_disponibilitate where id = new.id::text;
  if new.stare = 'activa' then
    insert into public.rezervari_disponibilitate(id, teren, data_str, ora)
    values (new.id::text, new.teren, new.data_str, new.ora);
  end if;
  return new;
end $$;
drop trigger if exists spotivity_availability on public.rezervari;
create trigger spotivity_availability after insert or update or delete on public.rezervari
for each row execute function spotivity_private.sync_availability();
delete from public.rezervari_disponibilitate;
insert into public.rezervari_disponibilitate(id, teren, data_str, ora)
select id::text, teren, data_str, ora from public.rezervari where stare = 'activa';

-- Profiles are created by Auth, including when email confirmation is required.
create or replace function spotivity_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.clienti(user_id, email, nume, telefon)
  values (new.id, lower(btrim(new.email)),
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'nume'), ''), split_part(new.email, '@', 1)), 200),
    left(coalesce(new.raw_user_meta_data->>'telefon', ''), 30));
  return new;
end $$;
drop trigger if exists spotivity_auth_profile on auth.users;
create trigger spotivity_auth_profile after insert on auth.users
for each row execute function spotivity_private.create_profile();

create or replace function spotivity_private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and pg_trigger_depth() = 1 and not spotivity_private.is_super_admin() then
    if tg_op <> 'UPDATE' or old.user_id is distinct from auth.uid()
       or (to_jsonb(new) - array['nume','telefon']) is distinct from (to_jsonb(old) - array['nume','telefon']) then
      raise exception 'Clients may change only their own name and phone.';
    end if;
  end if;
  if char_length(new.nume) > 200 or char_length(new.telefon) > 30 then raise exception 'Profile field too long.'; end if;
  return new;
end $$;
drop trigger if exists spotivity_profile_guard on public.clienti;
create trigger spotivity_profile_guard before insert or update on public.clienti
for each row execute function spotivity_private.guard_profile();

create or replace function spotivity_private.guard_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target auth.users%rowtype;
begin
  if auth.uid() is not null and pg_trigger_depth() = 1 and not spotivity_private.is_super_admin() then raise exception 'Only superadmins manage roles.'; end if;
  select * into target from auth.users where lower(btrim(email)) = lower(btrim(new.email));
  if target.id is null or target.email_confirmed_at is null then raise exception 'Create and confirm the Auth account first.'; end if;
  if new.user_id is not null and new.user_id <> target.id then raise exception 'Admin identity does not match Auth email.'; end if;
  new.user_id := target.id;
  new.email := lower(btrim(target.email));
  if new.is_super is null then new.is_super := false; end if;
  if new.is_super then new.terenuri := 'ALL';
  else
    select string_agg(btrim(item), ',' order by btrim(item)) into new.terenuri
    from (select distinct unnest(string_to_array(coalesce(new.terenuri,''), ',')) item) names
    where btrim(item) <> '';
    if new.terenuri is null or exists (
      select 1 from unnest(string_to_array(new.terenuri, ',')) item
      where not exists (select 1 from public.terenuri t where t.nume = item)
    ) then raise exception 'Assign at least one existing court, using exact names.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists spotivity_admin_guard on public.users_admin;
create trigger spotivity_admin_guard before insert or update on public.users_admin
for each row execute function spotivity_private.guard_admin();
update public.users_admin set email = email;

create or replace function spotivity_private.guard_court() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.nume is null or btrim(new.nume) = '' or position(',' in new.nume) > 0
     or new.pret is null or new.pret < 0 or new.pret_minge < 0 then raise exception 'Invalid court name or price.'; end if;
  if tg_op = 'UPDATE' and new.nume is distinct from old.nume
     and auth.uid() is not null and not spotivity_private.is_super_admin() then
    raise exception 'Only superadmins may rename courts.';
  end if;
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if tg_op <> 'UPDATE' or not spotivity_private.manages_court(old.nume)
       or (to_jsonb(new) - array['pret','pret_minge','optiune_minge','poza','locatie','oras','este_activ','are_chat'])
          is distinct from (to_jsonb(old) - array['pret','pret_minge','optiune_minge','poza','locatie','oras','este_activ','are_chat']) then
      raise exception 'Admin may update only settings of assigned courts.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists spotivity_court_guard on public.terenuri;
create trigger spotivity_court_guard before insert or update on public.terenuri
for each row execute function spotivity_private.guard_court();

create or replace function spotivity_private.sync_court_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.rezervari set teren = new.nume where teren = old.nume;
  update public.mesaje_chat set teren = new.nume where teren = old.nume;
  update public.users_admin a set terenuri = (
    select string_agg(case when btrim(item) = old.nume then new.nume else btrim(item) end, ',')
    from unnest(string_to_array(a.terenuri, ',')) item
  ) where a.is_super is not true and exists (
    select 1 from unnest(string_to_array(a.terenuri, ',')) item where btrim(item) = old.nume
  );
  return new;
end $$;
drop trigger if exists spotivity_court_name on public.terenuri;
create trigger spotivity_court_name after update of nume on public.terenuri
for each row when (old.nume is distinct from new.nume) execute function spotivity_private.sync_court_name();

create or replace function spotivity_private.guard_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare court public.terenuri%rowtype; owner_id uuid; owner_email text;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and pg_trigger_depth() = 1 and not spotivity_private.manages_court(old.teren) then
    if old.client_user_id is distinct from auth.uid()
       or (to_jsonb(new) - 'stare') is distinct from (to_jsonb(old) - 'stare')
       or old.stare <> 'activa' or new.stare <> 'anulata'
       or old.starts_at < now() + interval '6 hours' then
      raise exception 'Only cancellation of your own booking at least 6 hours ahead is allowed.';
    end if;
    return new;
  end if;
  new.starts_at := spotivity_private.booking_instant(new.data_str, new.ora);
  if new.stare is null or new.stare not in ('activa','anulata') then raise exception 'Invalid booking state.'; end if;
  if tg_op = 'INSERT' then new.timestamp_start := (extract(epoch from now()) * 1000)::bigint; new.created_at := now(); end if;
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if; -- trusted SQL/controlled Auth email sync; RLS still applies.
  select * into court from public.terenuri where nume = new.teren;
  if court.nume is null then raise exception 'Court does not exist.'; end if;
  if spotivity_private.manages_court(new.teren) then
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    new.client_user_id := owner_id; -- manual bookings and "Teren Blocat" deliberately have no client identity.
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
drop trigger if exists spotivity_booking_guard on public.rezervari;
create trigger spotivity_booking_guard before insert or update on public.rezervari
for each row execute function spotivity_private.guard_booking();

create or replace function spotivity_private.guard_chat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; owner_email text;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if spotivity_private.is_super_admin() then
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    if owner_id is null then raise exception 'Chat requires an Auth client account.'; end if;
    new.client_user_id := owner_id; new.email_client := owner_email;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'citit') is distinct from (to_jsonb(old) - 'citit')
       or new.citit is not true or (
         not (old.expeditor = 'client' and spotivity_private.manages_court(old.teren))
         and not (old.expeditor = 'admin' and old.client_user_id = auth.uid())
       ) then raise exception 'Only the recipient may mark a message read; message content is immutable.'; end if;
    return new;
  end if;
  if spotivity_private.manages_court(new.teren) then
    if new.expeditor <> 'admin' then raise exception 'Admins must send as admin.'; end if;
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    if owner_id is null or not exists (select 1 from public.rezervari
      where client_user_id = owner_id and teren = new.teren) then raise exception 'No client booking for this court.'; end if;
    new.client_user_id := owner_id; new.email_client := owner_email;
  else
    if new.expeditor <> 'client' or spotivity_private.current_email() is null
       or (new.client_user_id is not null and new.client_user_id <> auth.uid())
       or lower(btrim(new.email_client)) is distinct from spotivity_private.current_email()
       or not exists (select 1 from public.rezervari
         where client_user_id = auth.uid() and teren = new.teren and stare = 'activa'
           and starts_at + interval '1 hour' > now())
       or not exists (select 1 from public.terenuri where nume = new.teren and are_chat is not false and este_activ is not false)
    then raise exception 'A current booking and an enabled chat are required.'; end if;
    new.client_user_id := auth.uid(); new.email_client := spotivity_private.current_email();
  end if;
  if new.mesaj is null or char_length(btrim(new.mesaj)) not between 1 and 4000 then raise exception 'Message must contain 1 to 4000 characters.'; end if;
  new.citit := false; new.created_at := now();
  return new;
end $$;
drop trigger if exists spotivity_chat_guard on public.mesaje_chat;
create trigger spotivity_chat_guard before insert or update on public.mesaje_chat
for each row execute function spotivity_private.guard_chat();

create or replace function spotivity_private.sync_auth_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.clienti set email = lower(btrim(new.email)) where user_id = new.id;
  update public.users_admin set email = lower(btrim(new.email)) where user_id = new.id;
  update public.rezervari set email_client = lower(btrim(new.email)) where client_user_id = new.id;
  update public.mesaje_chat set email_client = lower(btrim(new.email)) where client_user_id = new.id;
  return new;
end $$;
drop trigger if exists spotivity_auth_email on auth.users;
create trigger spotivity_auth_email after update of email on auth.users
for each row when (old.email is distinct from new.email) execute function spotivity_private.sync_auth_email();

-- Drop ALL old policies on the managed tables. Permissive policies combine with OR.
do $$
declare item record;
begin
  for item in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('clienti','users_admin','terenuri','rezervari','mesaje_chat','rezervari_disponibilitate')
  loop execute format('drop policy %I on %I.%I', item.policyname, item.schemaname, item.tablename); end loop;
end $$;
alter table public.clienti enable row level security;
alter table public.users_admin enable row level security;
alter table public.terenuri enable row level security;
alter table public.rezervari enable row level security;
alter table public.mesaje_chat enable row level security;
alter table public.rezervari_disponibilitate enable row level security;

revoke all on public.clienti, public.users_admin, public.terenuri, public.rezervari,
  public.mesaje_chat, public.rezervari_disponibilitate from public, anon, authenticated;
grant select on public.terenuri, public.rezervari_disponibilitate to anon, authenticated;
grant select, insert, update, delete on public.clienti, public.users_admin, public.terenuri,
  public.rezervari, public.mesaje_chat to authenticated;
grant all on public.clienti, public.users_admin, public.terenuri, public.rezervari,
  public.mesaje_chat, public.rezervari_disponibilitate to service_role;
-- Existing schemas may use integer identity/serial IDs rather than UUID defaults.
do $$
declare item record;
begin
  for item in select pg_get_serial_sequence('public.' || name, 'id') seq
    from unnest(array['clienti','users_admin','terenuri','rezervari','mesaje_chat']) name
  loop if item.seq is not null then execute format('grant usage on sequence %s to authenticated, service_role',item.seq); end if; end loop;
end $$;

create policy profiles_read on public.clienti for select to authenticated using (spotivity_private.can_read_client(user_id));
create policy profiles_insert on public.clienti for insert to authenticated with check (spotivity_private.is_super_admin());
create policy profiles_update on public.clienti for update to authenticated
  using (user_id = (select auth.uid()) or spotivity_private.is_super_admin())
  with check (user_id = (select auth.uid()) or spotivity_private.is_super_admin());
create policy profiles_delete on public.clienti for delete to authenticated using (spotivity_private.is_super_admin());
create policy admins_read on public.users_admin for select to authenticated
  using (user_id = (select auth.uid()) or spotivity_private.is_super_admin());
create policy admins_insert on public.users_admin for insert to authenticated with check (spotivity_private.is_super_admin());
create policy admins_update on public.users_admin for update to authenticated
  using (spotivity_private.is_super_admin()) with check (spotivity_private.is_super_admin());
create policy admins_delete on public.users_admin for delete to authenticated using (spotivity_private.is_super_admin());
create policy courts_public on public.terenuri for select to anon, authenticated using (este_activ is not false);
create policy courts_staff on public.terenuri for select to authenticated using (spotivity_private.manages_court(nume));
create policy courts_insert on public.terenuri for insert to authenticated with check (spotivity_private.is_super_admin());
create policy courts_update on public.terenuri for update to authenticated
  using (spotivity_private.manages_court(nume)) with check (spotivity_private.manages_court(nume));
create policy courts_delete on public.terenuri for delete to authenticated using (spotivity_private.is_super_admin());
create policy bookings_read on public.rezervari for select to authenticated
  using (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren));
create policy bookings_insert on public.rezervari for insert to authenticated
  with check (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren));
create policy bookings_update on public.rezervari for update to authenticated
  using (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren))
  with check (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren));
create policy bookings_delete on public.rezervari for delete to authenticated using (spotivity_private.manages_court(teren));
create policy availability_read on public.rezervari_disponibilitate for select to anon, authenticated using (
  exists (select 1 from public.terenuri t where t.nume = teren and t.este_activ is not false)
);
create policy availability_staff on public.rezervari_disponibilitate for select to authenticated using (spotivity_private.manages_court(teren));
create policy chat_read on public.mesaje_chat for select to authenticated
  using (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren));
create policy chat_insert on public.mesaje_chat for insert to authenticated
  with check (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren));
create policy chat_update on public.mesaje_chat for update to authenticated
  using (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren))
  with check (client_user_id = (select auth.uid()) or spotivity_private.manages_court(teren));
create policy chat_delete on public.mesaje_chat for delete to authenticated using (spotivity_private.manages_court(teren));

-- Storage: a public bucket exposes image downloads, never upload/delete rights.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('poze_terenuri','poze_terenuri',true,5242880,array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function spotivity_private.may_write_image(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select spotivity_private.is_super_admin() or (
    spotivity_private.is_court_admin() and split_part(object_name,'/',1) = auth.uid()::text
  )
$$;
-- Restrictive guards also block existing global permissive Storage policies;
-- other buckets retain their existing policies and permissions.
drop policy if exists spotivity_images_read on storage.objects;
drop policy if exists spotivity_images_insert on storage.objects;
drop policy if exists spotivity_images_update on storage.objects;
drop policy if exists spotivity_images_delete on storage.objects;
drop policy if exists spotivity_images_insert_guard on storage.objects;
drop policy if exists spotivity_images_update_guard on storage.objects;
drop policy if exists spotivity_images_delete_guard on storage.objects;
drop policy if exists spotivity_images_anon_write_guard on storage.objects;
create policy spotivity_images_read on storage.objects for select to anon, authenticated using (bucket_id = 'poze_terenuri');
create policy spotivity_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'poze_terenuri' and spotivity_private.may_write_image(name));
create policy spotivity_images_update on storage.objects for update to authenticated
  using (bucket_id = 'poze_terenuri' and spotivity_private.may_write_image(name))
  with check (bucket_id = 'poze_terenuri' and spotivity_private.may_write_image(name));
create policy spotivity_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'poze_terenuri' and spotivity_private.may_write_image(name));
create policy spotivity_images_insert_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'poze_terenuri' or spotivity_private.may_write_image(name));
create policy spotivity_images_update_guard on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'poze_terenuri' or spotivity_private.may_write_image(name))
  with check (bucket_id <> 'poze_terenuri' or spotivity_private.may_write_image(name));
create policy spotivity_images_delete_guard on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'poze_terenuri' or spotivity_private.may_write_image(name));
create policy spotivity_images_anon_write_guard on storage.objects as restrictive for all to anon
  using (bucket_id <> 'poze_terenuri') with check (bucket_id <> 'poze_terenuri');

-- Functions are not callable through the public API; only policy helpers are executable.
revoke all on all functions in schema spotivity_private from public, anon, authenticated;
grant execute on function spotivity_private.is_super_admin(), spotivity_private.manages_court(text),
  spotivity_private.can_read_client(uuid), spotivity_private.may_write_image(text) to authenticated;

alter table public.rezervari replica identity default;
alter table public.mesaje_chat replica identity default;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rezervari_disponibilitate') then
      alter publication supabase_realtime add table public.rezervari_disponibilitate;
    end if;
  end if;
end $$;
insert into spotivity_private.migrations(version) values (1) on conflict (version) do nothing;
commit;
