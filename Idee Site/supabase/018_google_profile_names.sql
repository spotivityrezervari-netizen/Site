-- Spotivity: use OAuth display names for newly created profiles only.
-- Apply after 017 as postgres. Existing profiles, Auth identities, roles,
-- grants, bookings, Storage policies and trigger objects are not rewritten.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 017 before 018_google_profile_names.sql.';
  end if;
  if exists(select 1 from (values (1),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17)) required(version)
    where not exists(select 1 from spotivity_private.migrations applied where applied.version=required.version)) then
    raise exception 'Apply migrations 001 through 017 before 018_google_profile_names.sql.';
  end if;
  if to_regprocedure('spotivity_private.create_profile()') is null then
    raise exception 'Review the missing Auth profile function before migration 018.';
  end if;
  -- The latest expected body is 015_profile_contact.sql, without surrounding
  -- ASCII whitespace. Stop rather than overwrite changes from another platform.
  if not exists(select 1 from spotivity_private.migrations where version=18)
    and (select md5(btrim(prosrc,E' \t\n\r')) from pg_proc
      where oid='spotivity_private.create_profile()'::regprocedure) is distinct from '8974fc1ff79a776f5212b9f6d980a143' then
    raise exception 'Review the existing Auth profile function before migration 018; it differs from migration 015.';
  end if;
  if exists(select 1 from pg_proc where oid='spotivity_private.create_profile()'::regprocedure
    and (not prosecdef or proconfig is distinct from array['search_path=""']::text[])) then
    raise exception 'Review the existing Auth profile function security before migration 018.';
  end if;
end
$prerequisite$;

-- Preserve the legacy registration name and phone behavior. Provider names are
-- display data only; they never convey an administrative role or base grant.
create or replace function spotivity_private.create_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  contact_phone text := btrim(coalesce(new.raw_user_meta_data->>'telefon',''));
  contact_name text := nullif(btrim(new.raw_user_meta_data->>'nume'),'');
  candidate text;
  provider_field text;
begin
  if contact_name is null then
    foreach provider_field in array array['full_name','name'] loop
      if jsonb_typeof(new.raw_user_meta_data->provider_field)='string' then
        candidate:=btrim(new.raw_user_meta_data->>provider_field);
        if char_length(candidate) between 2 and 200 and candidate !~ '[[:cntrl:]]' then
          contact_name:=candidate;
          exit;
        end if;
      end if;
    end loop;
  end if;
  if char_length(contact_phone)>50
    or contact_phone !~ '^\+?[0-9 ().-]+$'
    or contact_phone ~ '[[:cntrl:]]'
    or char_length(regexp_replace(contact_phone,'[^0-9]','','g')) not between 7 and 15 then
    contact_phone:='';
  end if;
  insert into public.clienti(user_id,email,nume,telefon)
  values(new.id,lower(btrim(new.email)),
    left(coalesce(contact_name,split_part(new.email,'@',1)),200),contact_phone);
  return new;
end
$$;

-- CREATE OR REPLACE preserves the function's existing owner and execute ACL.
insert into spotivity_private.migrations(version) values(18) on conflict(version) do nothing;
commit;
