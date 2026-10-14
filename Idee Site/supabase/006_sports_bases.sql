-- Spotivity: sports bases and explicit description-editing permissions.
-- Apply after 005_sport_appearance.sql as postgres. No bases are invented and
-- existing courts, allocations, reservations, chats and photos are preserved.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001, 003, 004 and 005 before 006_sports_bases.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version = 1)
     or not exists(select 1 from spotivity_private.migrations where version = 3)
     or not exists(select 1 from spotivity_private.migrations where version = 4)
     or not exists(select 1 from spotivity_private.migrations where version = 5)
     or to_regprocedure('spotivity_private.is_super_admin()') is null then
    raise exception 'Apply migrations 001, 003, 004 and 005 before 006_sports_bases.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version = 6)
     and (to_regclass('public.baze_sportive') is not null
       or to_regclass('public.baze_sportive_admini') is not null
       or to_regprocedure('public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])') is not null
       or exists(select 1 from pg_attribute
         where attrelid = 'public.terenuri'::regclass
           and attname = 'baza_sportiva_id' and not attisdropped)) then
    raise exception 'Review existing unregistered sports-base tables or court membership before applying migration 006.';
  end if;
end;
$prerequisite$;

create table if not exists public.baze_sportive (
  id uuid primary key default gen_random_uuid(),
  nume text not null,
  oras text not null,
  descriere text not null default '',
  este_activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spotivity_baza_nume_valid check (
    char_length(nume) <= 160 and char_length(btrim(nume)) > 0
  ),
  constraint spotivity_baza_oras_valid check (
    char_length(oras) <= 120 and char_length(btrim(oras)) > 0
  ),
  -- This is a short public description, rendered as text by the frontend.
  constraint spotivity_baza_descriere_valid check (char_length(descriere) <= 2000)
);
comment on table public.baze_sportive is
  'Sports-base directory. Public only when active and containing an active court. No reservation or court-management permission is inherited.';

alter table public.terenuri add column if not exists baza_sportiva_id uuid
  references public.baze_sportive(id) on delete set null;
create index if not exists spotivity_terenuri_baza on public.terenuri(baza_sportiva_id);
create index if not exists spotivity_baze_oras_nume on public.baze_sportive(oras, nume);

create table if not exists public.baze_sportive_admini (
  baza_id uuid not null references public.baze_sportive(id) on delete cascade,
  user_id uuid not null references public.users_admin(user_id) on delete cascade,
  primary key (baza_id, user_id)
);
create index if not exists spotivity_baza_admin_user on public.baze_sportive_admini(user_id, baza_id);
comment on table public.baze_sportive_admini is
  'Explicit permission to edit one base description. Only superadmins assign it. It does not grant court, reservation, profile, chat or photo access.';

create or replace function spotivity_private.manages_base(base_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users_admin a
    where a.user_id = (select auth.uid()) and (
      a.is_super is true or exists (
        select 1 from public.baze_sportive_admini p
        where p.user_id = a.user_id and p.baza_id = base_id
      )
    )
  )
$$;

create or replace function spotivity_private.guard_base() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if tg_op <> 'UPDATE' then
      raise exception 'Only superadmins may create or delete sports bases.';
    end if;
    if not spotivity_private.manages_base(old.id)
       or (to_jsonb(new) - array['descriere','updated_at'])
          is distinct from (to_jsonb(old) - array['descriere','updated_at']) then
      raise exception 'Authorized admins may edit only a sports-base description.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- Clients cannot choose an arbitrary update timestamp, including when they
  -- send an unchanged description. The same stamp is used throughout a query.
  new.updated_at := statement_timestamp();
  return new;
end
$$;
drop trigger if exists spotivity_base_guard on public.baze_sportive;
create trigger spotivity_base_guard before insert or update or delete on public.baze_sportive
for each row execute function spotivity_private.guard_base();

create or replace function spotivity_private.guard_court_base() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if (tg_op = 'INSERT' and new.baza_sportiva_id is not null)
       or (tg_op = 'UPDATE' and new.baza_sportiva_id is distinct from old.baza_sportiva_id) then
      raise exception 'Only superadmins may link or unlink courts and sports bases.';
    end if;
  end if;
  return new;
end
$$;
-- Add a separate guard; do not replace the existing settings/hours guard.
drop trigger if exists spotivity_court_base_guard on public.terenuri;
create trigger spotivity_court_base_guard before insert or update on public.terenuri
for each row execute function spotivity_private.guard_court_base();

create or replace function spotivity_private.guard_base_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    raise exception 'Only superadmins may assign sports-base description permissions.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
drop trigger if exists spotivity_base_permission_guard on public.baze_sportive_admini;
create trigger spotivity_base_permission_guard before insert or update or delete on public.baze_sportive_admini
for each row execute function spotivity_private.guard_base_permission();

alter table public.baze_sportive enable row level security;
alter table public.baze_sportive_admini enable row level security;
revoke all on public.baze_sportive, public.baze_sportive_admini from public, anon, authenticated, service_role;
grant select on public.baze_sportive to anon, authenticated;
grant insert, update, delete on public.baze_sportive to authenticated;
grant select, insert, update, delete on public.baze_sportive_admini to authenticated;
grant select, insert, update, delete on public.baze_sportive, public.baze_sportive_admini to service_role;

-- These two new tables belong to this migration. Rebuild their policies on
-- rerun to remove any accidental permissive policy, while preserving data.
do $policies$
declare item record;
begin
  for item in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('baze_sportive','baze_sportive_admini')
  loop
    execute format('drop policy %I on public.%I', item.policyname, item.tablename);
  end loop;
end;
$policies$;

-- Separate public and staff policies: anonymous readers never execute a
-- private admin helper. Existing court RLS and visibility stay unchanged.
create policy bases_public on public.baze_sportive for select to anon, authenticated
  using (este_activa is true and exists (
    select 1 from public.terenuri t
    where t.baza_sportiva_id = baze_sportive.id and t.este_activ is not false
  ));
create policy bases_staff on public.baze_sportive for select to authenticated
  using (spotivity_private.manages_base(id));
create policy bases_insert on public.baze_sportive for insert to authenticated
  with check ((select spotivity_private.is_super_admin()));
create policy bases_update on public.baze_sportive for update to authenticated
  using (spotivity_private.manages_base(id)) with check (spotivity_private.manages_base(id));
create policy bases_delete on public.baze_sportive for delete to authenticated
  using ((select spotivity_private.is_super_admin()));
create policy base_permissions_read on public.baze_sportive_admini for select to authenticated
  using (user_id = (select auth.uid()) or (select spotivity_private.is_super_admin()));
create policy base_permissions_insert on public.baze_sportive_admini for insert to authenticated
  with check ((select spotivity_private.is_super_admin()));
create policy base_permissions_update on public.baze_sportive_admini for update to authenticated
  using ((select spotivity_private.is_super_admin())) with check ((select spotivity_private.is_super_admin()));
create policy base_permissions_delete on public.baze_sportive_admini for delete to authenticated
  using ((select spotivity_private.is_super_admin()));

revoke all on function spotivity_private.manages_base(uuid), spotivity_private.guard_base(),
  spotivity_private.guard_court_base(), spotivity_private.guard_base_permission()
  from public, anon, authenticated, service_role;
grant execute on function spotivity_private.manages_base(uuid) to authenticated;

-- One transaction saves the base, the complete court list and description
-- editors. This is SECURITY INVOKER: the caller must pass the same table RLS
-- and guards as ordinary REST writes. No browser receives privileged execution.
create or replace function public.save_sports_base(
  p_id uuid,
  p_nume text,
  p_oras text,
  p_descriere text,
  p_este_activa boolean,
  p_court_ids text[],
  p_admin_ids uuid[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  saved_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if auth.uid() is null or not spotivity_private.is_super_admin() then
    raise exception 'Only authenticated superadmins may manage sports bases.';
  end if;
  -- Missing lists must never accidentally remove all courts or permissions.
  -- Empty arrays are intentional and supported when creating an empty base.
  if p_court_ids is null or p_admin_ids is null
     or array_position(p_court_ids, null) is not null
     or array_position(p_admin_ids, null) is not null then
    raise exception 'Supply complete court and description-editor lists.';
  end if;
  if p_id is not null then
    perform 1 from public.baze_sportive where id = p_id for update;
    if not found then raise exception 'The sports base no longer exists.'; end if;
  end if;

  -- Lock old and requested memberships in a stable order before validating
  -- them. A concurrent save cannot take a court from a different sports base.
  perform t.id from public.terenuri t
    where t.baza_sportiva_id = saved_id or t.id::text = any(p_court_ids)
    order by t.id::text for update;
  if exists (
    select 1 from unnest(p_court_ids) requested(id)
    where not exists (select 1 from public.terenuri t where t.id::text = requested.id)
  ) then raise exception 'At least one selected court no longer exists.'; end if;
  if exists (
    select 1 from public.terenuri t
    where t.id::text = any(p_court_ids)
      and t.baza_sportiva_id is not null and t.baza_sportiva_id <> saved_id
  ) then raise exception 'Unlink the court from its existing sports base first.'; end if;

  perform a.user_id from public.users_admin a
    where a.user_id = any(p_admin_ids) order by a.user_id for key share;
  if exists (
    select 1 from unnest(p_admin_ids) requested(id)
    where not exists (select 1 from public.users_admin a where a.user_id = requested.id)
  ) then raise exception 'At least one selected administrator no longer exists.'; end if;

  if p_id is null then
    insert into public.baze_sportive(id, nume, oras, descriere, este_activa)
      values(saved_id, btrim(p_nume), btrim(p_oras), p_descriere, p_este_activa);
  else
    update public.baze_sportive
      set nume = btrim(p_nume), oras = btrim(p_oras),
          descriere = p_descriere, este_activa = p_este_activa
      where id = saved_id;
  end if;
  update public.terenuri set baza_sportiva_id = null
    where baza_sportiva_id = saved_id and not (id::text = any(p_court_ids));
  update public.terenuri set baza_sportiva_id = saved_id
    where id::text = any(p_court_ids) and baza_sportiva_id is distinct from saved_id;
  delete from public.baze_sportive_admini
    where baza_id = saved_id and not (user_id = any(p_admin_ids));
  insert into public.baze_sportive_admini(baza_id, user_id)
    select saved_id, requested.id from unnest(p_admin_ids) requested(id)
    on conflict(baza_id, user_id) do nothing;
  return saved_id;
end
$$;
revoke all on function public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_sports_base(uuid,text,text,text,boolean,text[],uuid[]) to authenticated;

insert into spotivity_private.migrations(version) values (6) on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
