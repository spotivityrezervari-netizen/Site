-- Spotivity: create a new court only inside an explicitly managed sports base.
-- Apply after 018 as postgres. Existing rows, role flags, court allocations,
-- booking rules, RLS policies, Storage objects and trigger objects are preserved.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 018 before 019_owner_court_creation.sql.';
  end if;
  if exists(select 1 from (values (1),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18)) required(version)
    where not exists(select 1 from spotivity_private.migrations applied where applied.version=required.version)) then
    raise exception 'Apply migrations 001 through 018 before 019_owner_court_creation.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=19)
    and (to_regprocedure('public.create_managed_court(uuid,text,text,integer,text[])') is not null
      or to_regprocedure('spotivity_private.allocate_created_court()') is not null
      or exists(select 1 from pg_trigger where tgrelid='public.terenuri'::regclass and tgname='spotivity_allocate_created_court')) then
    raise exception 'Review existing unregistered owner court-creation objects before migration 019.';
  end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('spotivity_private.guard_court()')
    and prosecdef and proconfig=array['search_path=""']::text[]
    and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
      case when exists(select 1 from spotivity_private.migrations where version=19) then 'aae994d2e6b8f61aa76a0fe8c5b622b2' else 'b0bde43cff54bd3bd73f47ba81f94640' end) then
    raise exception 'Review the existing guard_court function before migration 019; its definition or security differs.';
  end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('spotivity_private.guard_court_base()')
    and prosecdef and proconfig=array['search_path=""']::text[]
    and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
      case when exists(select 1 from spotivity_private.migrations where version=19) then 'e51b05efff72320aaf081367d157a843' else 'cfad06539b8062346bf7ace026872347' end) then
    raise exception 'Review the existing guard_court_base function before migration 019; its definition or security differs.';
  end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('spotivity_private.guard_admin()')
    and prosecdef and proconfig=array['search_path=""']::text[]
    and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
      case when exists(select 1 from spotivity_private.migrations where version=19) then '42c55071887a3987a31fa66d038c9d7e' else '42c55071887a3987a31fa66d038c9d7e' end) then
    raise exception 'Review the existing guard_admin function before migration 019; its definition or security differs.';
  end if;
  -- Reapplication must not replace a later change from another platform.
  if exists(select 1 from spotivity_private.migrations where version=19) then
    if not exists(select 1 from pg_proc where oid=to_regprocedure('public.create_managed_court(uuid,text,text,integer,text[])')
      and prosecdef and proconfig=array['search_path=""']::text[] and proowner='postgres'::regrole
      and prorettype='jsonb'::regtype
      and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))='bd2f8169c9f9b8d48f7e17bb1f94b80f') then
      raise exception 'Review the existing create_managed_court function before reapplying migration 019.';
    end if;
    if not exists(select 1 from pg_proc where oid=to_regprocedure('spotivity_private.allocate_created_court()')
      and prosecdef and proconfig=array['search_path=""']::text[] and proowner='postgres'::regrole
      and prorettype='trigger'::regtype
      and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))='c4e11000eca01262f689daad23ad498f') then
      raise exception 'Review the existing allocate_created_court function before reapplying migration 019.';
    end if;
    if not exists(select 1 from pg_trigger where tgrelid='public.terenuri'::regclass
      and tgname='spotivity_allocate_created_court' and not tgisinternal and tgenabled='O'
      and pg_get_triggerdef(oid)='CREATE TRIGGER spotivity_allocate_created_court AFTER INSERT ON public.terenuri FOR EACH ROW EXECUTE FUNCTION spotivity_private.allocate_created_court()') then
      raise exception 'Review the existing allocation trigger before reapplying migration 019.';
    end if;
    if has_function_privilege('anon','public.create_managed_court(uuid,text,text,integer,text[])','execute')
      or has_function_privilege('service_role','public.create_managed_court(uuid,text,text,integer,text[])','execute')
      or not has_function_privilege('authenticated','public.create_managed_court(uuid,text,text,integer,text[])','execute')
      or has_function_privilege('anon','spotivity_private.allocate_created_court()','execute')
      or has_function_privilege('authenticated','spotivity_private.allocate_created_court()','execute')
      or has_function_privilege('service_role','spotivity_private.allocate_created_court()','execute') then
      raise exception 'Review the existing creation function grants before reapplying migration 019.';
    end if;
  end if;
end
$prerequisite$;

-- These exceptions do not grant INSERT to the browser. Both the permissive
-- courts_insert and restrictive spotivity_boundary_terenuri_insert policies
-- continue to require a superadmin. Only the narrow definer RPC below inserts
-- for an ordinary admin, after locking the current role and explicit base grant.
create or replace function spotivity_private.guard_court() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.ore_rezervabile:=spotivity_private.normalize_court_hours(new.ore_rezervabile);
  if new.nume is null or btrim(new.nume)='' or position(',' in new.nume)>0
    or new.pret is null or new.pret<0 or new.pret_minge<0 then
    raise exception 'Invalid court name or price.';
  end if;
  if tg_op='UPDATE' and new.nume is distinct from old.nume
    and auth.uid() is not null and not spotivity_private.is_super_admin() then
    raise exception 'Only superadmins may rename courts.';
  end if;
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if tg_op='INSERT' then
      if new.baza_sportiva_id is null or spotivity_private.current_email() is null
        or not spotivity_private.manages_base(new.baza_sportiva_id) then
        raise exception 'New courts require an explicitly managed sports base.';
      end if;
    elsif not spotivity_private.manages_court(old.nume)
      or (to_jsonb(new)-array['pret','pret_minge','optiune_minge','poza','locatie','oras','este_activ','are_chat','ore_rezervabile'])
        is distinct from (to_jsonb(old)-array['pret','pret_minge','optiune_minge','poza','locatie','oras','este_activ','are_chat','ore_rezervabile']) then
      raise exception 'Admin may update only settings of assigned courts.';
    end if;
  end if;
  return new;
end
$$;

create or replace function spotivity_private.guard_court_base() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if tg_op='INSERT' and new.baza_sportiva_id is not null then
      if spotivity_private.current_email() is null or not spotivity_private.manages_base(new.baza_sportiva_id) then
        raise exception 'New courts require an explicitly managed sports base.';
      end if;
    elsif tg_op='UPDATE' and new.baza_sportiva_id is distinct from old.baza_sportiva_id then
      raise exception 'Only superadmins may link or unlink courts and sports bases.';
    end if;
  end if;
  return new;
end
$$;

-- A fixed-column trusted trigger allocates exactly its new court to the
-- existing ordinary caller. The nested guard_admin still validates the Auth
-- identity and canonical court list; no role flag or other admin is changed.
create or replace function spotivity_private.allocate_created_court() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.users_admin%rowtype;
begin
  if auth.uid() is null or spotivity_private.is_super_admin() then return new; end if;
  if new.baza_sportiva_id is null or spotivity_private.current_email() is null
    or not spotivity_private.manages_base(new.baza_sportiva_id)
    or char_length(new.nume) not between 2 and 120 or new.nume ~ '[[:cntrl:]]'
    or position(',' in new.nume)>0 then
    raise exception 'The new court cannot be assigned to this administrator.';
  end if;
  select * into actor from public.users_admin where user_id=auth.uid() for update;
  if not found or actor.is_super is distinct from false then
    raise exception 'An existing ordinary administrator is required.';
  end if;
  update public.users_admin set terenuri=concat_ws(',',nullif(actor.terenuri,''),new.nume)
    where user_id=actor.user_id;
  return new;
end
$$;

-- Preserve all existing trigger objects, including this trigger on reapplication.
do $allocation_trigger$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.terenuri'::regclass
    and tgname='spotivity_allocate_created_court') then
    create trigger spotivity_allocate_created_court after insert on public.terenuri
    for each row execute function spotivity_private.allocate_created_court();
  end if;
end
$allocation_trigger$;

create or replace function public.create_managed_court(
  p_base_id uuid,p_name text,p_sport text,p_price integer,p_hours text[] default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.users_admin%rowtype;
  base public.baze_sportive%rowtype;
  identity auth.users%rowtype;
  created public.terenuri%rowtype;
  hours text[];
  court_location text;
begin
  if auth.uid() is null then raise exception 'Sign in before creating a court.' using errcode='42501'; end if;
  select * into identity from auth.users where id=auth.uid() for share;
  if not found or identity.email_confirmed_at is null then
    raise exception 'A confirmed Auth email is required.' using errcode='42501';
  end if;
  select * into actor from public.users_admin where user_id=identity.id for update;
  if not found or lower(btrim(actor.email)) is distinct from lower(btrim(identity.email)) then
    raise exception 'An existing administrator is required.' using errcode='42501';
  end if;
  if actor.is_super is not true then
    perform 1 from public.baze_sportive_admini where baza_id=p_base_id and user_id=identity.id for share;
    if not found then raise exception 'This sports base is not explicitly assigned to you.' using errcode='42501'; end if;
  end if;
  select * into base from public.baze_sportive where id=p_base_id for share;
  if not found then raise exception 'The sports base no longer exists.' using errcode='22023'; end if;
  p_name:=btrim(p_name);
  if p_name is null or char_length(p_name) not between 2 and 120
    or position(',' in p_name)>0 or p_name ~ '[[:cntrl:]]' then
    raise exception 'Court name must contain 2 to 120 characters, without commas or control characters.' using errcode='22023';
  end if;
  if p_sport is null or not exists(select 1 from public.site_sporturi where sport=p_sport) then
    raise exception 'Select a supported sport.' using errcode='22023';
  end if;
  if p_price is null or p_price not between 0 and 100000 then
    raise exception 'Court price must be a whole number between 0 and 100000 RON.' using errcode='22023';
  end if;
  hours:=spotivity_private.normalize_court_hours(coalesce(p_hours,
    array['12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00']));
  select nullif(btrim(t.locatie),'') into court_location from public.terenuri t
    where t.baza_sportiva_id=base.id and nullif(btrim(t.locatie),'') is not null order by t.nume,t.id limit 1;
  insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,poza,locatie,oras,este_activ,are_chat,baza_sportiva_id,ore_rezervabile)
    values(p_name,p_sport,p_price,0,false,null,coalesce(court_location,''),base.oras,true,true,base.id,hours)
    returning * into created;
  return to_jsonb(created)||jsonb_build_object('id',created.id::text);
end
$$;
comment on function public.create_managed_court(uuid,text,text,integer,text[]) is
  'Create and allocate only a new court in the current Auth administrator explicitly assigned sports base. Existing allocations and direct INSERT RLS stay unchanged.';
revoke all on function spotivity_private.guard_court(),spotivity_private.guard_court_base(),
  spotivity_private.allocate_created_court(),public.create_managed_court(uuid,text,text,integer,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.create_managed_court(uuid,text,text,integer,text[]) to authenticated;
insert into spotivity_private.migrations(version) values(19) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
