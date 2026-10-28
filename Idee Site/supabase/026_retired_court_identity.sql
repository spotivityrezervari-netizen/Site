-- Preserve court identity across removal and renaming. A former court's name
-- or ID must never grant a new administrator its bookings, customers or chat.
-- No existing business row, allocation or cancellation rule is rewritten.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.booking_groups') is null
    or not exists(select 1 from spotivity_private.migrations where version=25) then
    raise exception 'Apply migration 025 before migration 026.';
  end if;
  if not exists(select 1 from pg_proc p
    where p.oid=to_regprocedure('spotivity_private.manages_court(text)')
      and p.prosecdef and p.provolatile='s' and p.prorettype='boolean'::regtype
      and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
      and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
        case when exists(select 1 from spotivity_private.migrations where version=26)
          then '5fe193c115f3a62b6f463d2e82321060' else 'c19bbd189565b0bbb0621e60a8167c90' end) then
    raise exception 'Review the current court-access helper before migration 026.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=26)
    and (to_regclass('spotivity_private.court_name_registry') is not null
      or to_regclass('spotivity_private.court_id_registry') is not null
      or to_regprocedure('spotivity_private.guard_court_identity()') is not null
      or exists(select 1 from pg_trigger where tgrelid='public.terenuri'::regclass
        and tgname='spotivity_court_identity')) then
    raise exception 'Review the existing unregistered court identity objects.';
  end if;
  if exists(select 1 from spotivity_private.migrations where version=26)
    and (not exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('spotivity_private.guard_court_identity()')
        and p.prosecdef and p.prorettype='trigger'::regtype
        and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
        and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))='281369a01e4bd151cad54b14f372d972')
      or not exists(select 1 from pg_trigger t
        where t.tgrelid='public.terenuri'::regclass and t.tgname='spotivity_court_identity'
          and not t.tgisinternal and t.tgtype=23 and t.tgenabled='O' and t.tgnargs=0
          and t.tgqual is null and t.tgfoid=to_regprocedure('spotivity_private.guard_court_identity()'))) then
    raise exception 'Review the current court identity guard before reapplying migration 026.';
  end if;
end
$prerequisite$;

-- Freeze court identity changes while building the registry. Booking/chat rows
-- remain untouched. Existing stable booking metadata is evidence, not a basis
-- for guessing which administrator owns ambiguous historical conversations.
lock table public.terenuri in share row exclusive mode;
do $historical_identity$
begin
  if exists(select 1 from public.terenuri t
    join spotivity_private.booking_groups b on b.court_name=t.nume
    where b.court_id is distinct from t.id::text) then
    raise exception 'A historical court name refers to another court ID. Review historical ownership before migration 026.';
  end if;
end
$historical_identity$;

create table if not exists spotivity_private.court_name_registry(
  court_name text primary key,
  court_id text,
  registered_at timestamptz not null default now()
);
comment on table spotivity_private.court_name_registry is
  'Permanent court name/ID reservations. NULL court_id means an orphaned name with unknown identity; never assign it automatically.';
alter table spotivity_private.court_name_registry enable row level security;
revoke all on spotivity_private.court_name_registry from public,anon,authenticated,service_role;
create index if not exists spotivity_court_registered_id
  on spotivity_private.court_name_registry(court_id) where court_id is not null;

-- Current identities and booking-group snapshots are authoritative. Conflicting
-- or otherwise unresolvable orphan names stay reserved with an unknown ID.
insert into spotivity_private.court_name_registry(court_name,court_id)
  select nume,id::text from public.terenuri on conflict(court_name) do nothing;
insert into spotivity_private.court_name_registry(court_name,court_id)
  select court_name,case when count(distinct court_id)=1 then min(court_id) end
  from spotivity_private.booking_groups
  where court_name is not null and btrim(court_name)<>''
  group by court_name on conflict(court_name) do nothing;
insert into spotivity_private.court_name_registry(court_name,court_id)
  select distinct court_name,null from (
    select teren as court_name from public.rezervari
    union select teren from public.mesaje_chat
    union select btrim(allocated) from public.users_admin a
      cross join lateral unnest(string_to_array(a.terenuri,',')) allocated
      where a.is_super is not true
  ) names where court_name is not null and btrim(court_name)<>''
  on conflict(court_name) do nothing;
do $registry_identity$
begin
  if exists(select 1 from public.terenuri t
    join spotivity_private.court_name_registry n on n.court_name=t.nume
    where n.court_id is distinct from t.id::text) then
    raise exception 'The registered court identity differs from the current court. Review before migration 026.';
  end if;
end
$registry_identity$;

-- Names can have several historical IDs, and a court can have several aliases.
-- Reserve every known ID independently so neither case can lose an identity.
create table if not exists spotivity_private.court_id_registry(
  court_id text primary key,
  registered_at timestamptz not null default now()
);
comment on table spotivity_private.court_id_registry is
  'Permanent unique court identity claims, retained after court deletion. Browser-supplied IDs cannot resurrect a previous tenant.';
alter table spotivity_private.court_id_registry enable row level security;
revoke all on spotivity_private.court_id_registry from public,anon,authenticated,service_role;
insert into spotivity_private.court_id_registry(court_id)
  select id::text from public.terenuri
  union select court_id from spotivity_private.booking_groups
  union select court_id from spotivity_private.court_name_registry where court_id is not null
  on conflict(court_id) do nothing;

create or replace function spotivity_private.manages_court(court_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.users_admin a
    where a.user_id=(select auth.uid()) and (
      a.is_super is true or exists(select 1 from public.terenuri t
        join spotivity_private.court_name_registry n on n.court_id=t.id::text
        where n.court_name=$1 and exists(
          select 1 from unnest(string_to_array(a.terenuri,',')) allocated
          where btrim(allocated)=t.nume
        ))
    ))
$$;

create or replace function spotivity_private.guard_court_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare registered_id text;
begin
  if tg_op='INSERT' then
    if exists(select 1 from spotivity_private.booking_groups where court_id=new.id::text) then
      raise exception 'This court identifier was already registered.' using errcode='23505';
    end if;
    -- The unique claim remains atomic across concurrent INSERT/DELETE and at
    -- stronger isolation levels; no snapshot-based lookup grants the identity.
    insert into spotivity_private.court_id_registry(court_id)
      values(new.id::text) on conflict(court_id) do nothing;
    if not found then
      raise exception 'This court identifier was already registered.' using errcode='23505';
    end if;
  end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'Court identifiers cannot be changed.' using errcode='23514';
    end if;
    if new.nume is not distinct from old.nume then return new; end if;
  end if;
  if new.nume is null then return new; end if;
  select court_id into registered_id from spotivity_private.court_name_registry
    where court_name=new.nume;
  if found then
    if registered_id is distinct from new.id::text then
      raise exception 'This court name is reserved for a previous court. Choose another name.' using errcode='23505';
    end if;
    -- Only UPDATE of the same live row may restore one of its own old aliases.
    return new;
  end if;
  -- Trusted maintenance may leave an orphan after the initial registry seed.
  -- Do not silently adopt it or another administrator's stale allocation.
  if exists(select 1 from public.rezervari where teren=new.nume)
    or exists(select 1 from public.mesaje_chat where teren=new.nume)
    or exists(select 1 from spotivity_private.booking_groups where court_name=new.nume)
    or exists(select 1 from public.users_admin a
      cross join lateral unnest(string_to_array(a.terenuri,',')) allocated
      where a.is_super is not true and btrim(allocated)=new.nume) then
    raise exception 'This court name has historical references. Choose another name.' using errcode='23505';
  end if;
  -- The unique name claim serializes concurrent court creation/renaming. The
  -- registry survives DELETE and is never exposed through the browser API.
  insert into spotivity_private.court_name_registry(court_name,court_id)
    values(new.nume,new.id::text) on conflict(court_name) do nothing;
  select court_id into registered_id from spotivity_private.court_name_registry
    where court_name=new.nume;
  if registered_id is distinct from new.id::text then
    raise exception 'This court name is reserved for another court.' using errcode='23505';
  end if;
  return new;
end
$$;
drop trigger if exists spotivity_court_identity on public.terenuri;
create trigger spotivity_court_identity before insert or update on public.terenuri
for each row execute function spotivity_private.guard_court_identity();
revoke all on function spotivity_private.guard_court_identity() from public,anon,authenticated,service_role;
comment on function spotivity_private.manages_court(text) is
  'Stable current court identity and current Auth UUID allocation, resolving historical aliases without name/ID reuse. Superadmin retains orphaned history access.';
insert into spotivity_private.migrations(version) values(26) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
