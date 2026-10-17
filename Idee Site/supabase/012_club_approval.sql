-- Spotivity: account-backed public applications and atomic superadmin approval.
-- Apply after 011 as postgres. Passwords stay exclusively in Supabase Auth;
-- the public Edge Function verifies identity before calling the service RPC.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 011 before 012_club_approval.sql.';
  end if;
  if exists (select 1 from (values (1),(3),(4),(5),(6),(7),(8),(9),(10),(11)) required(version)
    where not exists (select 1 from spotivity_private.migrations applied where applied.version=required.version)) then
    raise exception 'Apply migrations 001 through 011 before 012_club_approval.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=12)
     and exists(select 1 from pg_attribute where attrelid='public.cereri_baze_sportive'::regclass
       and attname in ('reserved_base_id','approved_base_id','approved_court_ids','preturi_solicitate') and not attisdropped) then
    raise exception 'Review existing unregistered club-approval columns before migration 012.';
  end if;
end
$prerequisite$;

create or replace function spotivity_private.club_application_prices_valid(prices jsonb, court_count integer)
returns boolean language plpgsql immutable set search_path='' as $$
declare entry jsonb; amount numeric;
begin
  if prices is null or jsonb_typeof(prices)<>'array' or court_count is null or court_count not between 1 and 20 then return false; end if;
  if jsonb_array_length(prices)<>court_count then return false; end if;
  for entry in select value from jsonb_array_elements(prices) loop
    if jsonb_typeof(entry)<>'number' then return false; end if;
    amount := entry::text::numeric;
    if amount<0 or amount>100000 or round(amount)<>amount then return false; end if;
  end loop;
  return true;
exception when numeric_value_out_of_range or invalid_text_representation then return false;
end
$$;

alter table public.cereri_baze_sportive
  add column if not exists reserved_base_id uuid not null default gen_random_uuid(),
  add column if not exists approved_base_id uuid references public.baze_sportive(id) on delete set null,
  add column if not exists approved_court_ids text[],
  add column if not exists preturi_solicitate jsonb;
create unique index if not exists spotivity_club_reserved_base on public.cereri_baze_sportive(reserved_base_id);
do $prices_constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.cereri_baze_sportive'::regclass
    and conname='spotivity_club_proposed_prices_valid') then
    alter table public.cereri_baze_sportive add constraint spotivity_club_proposed_prices_valid
      check(preturi_solicitate is null or spotivity_private.club_application_prices_valid(preturi_solicitate,jsonb_array_length(terenuri)));
  end if;
end
$prices_constraint$;
comment on table public.cereri_baze_sportive is
  'Private account-backed applications. Only current superadmins review them; approval atomically publishes the base and courts and grants scoped ordinary administration. Passwords are never stored here.';
comment on column public.cereri_baze_sportive.reserved_base_id is
  'Stable server-generated future base UUID, used to copy the application photo before atomic approval.';

-- The service wrapper is the sole application-insertion API. Its caller must
-- already have verified a new signup or an existing account password through
-- Supabase Auth. Browser-controlled IDs, metadata and passwords grant no role.
create or replace function public.submit_club_application(
  p_applicant_user_id uuid, p_request_id uuid, p_nume_baza text, p_nume_contact text, p_email text,
  p_telefon text, p_oras text, p_adresa text, p_link_maps text,
  p_terenuri jsonb, p_descriere text, p_poza_path text, p_prices jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  account_email text; saved_id uuid; previous_sub text; previous_claims text;
  existing_prices jsonb; existing_approved uuid;
begin
  select lower(btrim(email)) into account_email from auth.users where id=p_applicant_user_id;
  if p_applicant_user_id is null or account_email is null
     or lower(btrim(p_email)) is distinct from account_email then
    raise exception 'The application email must match the verified Auth account.' using errcode='42501';
  end if;
  if not spotivity_private.club_request_courts_valid(p_terenuri)
     or not spotivity_private.club_application_prices_valid(p_prices,jsonb_array_length(p_terenuri)) then
    raise exception 'Supply one whole-RON price between 0 and 100000 per court.' using errcode='22023';
  end if;
  previous_sub := current_setting('request.jwt.claim.sub',true);
  previous_claims := current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_applicant_user_id::text,true);
  saved_id := public.submit_club_request(p_request_id,p_nume_baza,p_nume_contact,p_email,p_telefon,
    p_oras,p_adresa,p_link_maps,p_terenuri,p_descriere,p_poza_path);
  select preturi_solicitate,approved_base_id into existing_prices,existing_approved
    from public.cereri_baze_sportive where id=saved_id for update;
  if existing_prices is not null and existing_prices is distinct from p_prices then
    raise exception 'Request identifier was already used with different prices.' using errcode='22023';
  end if;
  -- Clear both supported Auth claim sources only inside this trusted function.
  -- The immutable-review trigger otherwise forbids applicants editing prices.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  if existing_prices is null and existing_approved is null then
    update public.cereri_baze_sportive set preturi_solicitate=p_prices where id=saved_id;
  end if;
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  return saved_id;
exception when others then
  if previous_sub is not null or previous_claims is not null then
    perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  end if;
  raise;
end
$$;

-- Keep the existing review controls, but a bare accepted label can no longer
-- bypass publication. Column grants expose no publication metadata to REST.
create or replace function spotivity_private.guard_club_request_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare publication_changed boolean; court_id text;
begin
  if auth.uid() is not null and pg_trigger_depth()=1 then
    if not spotivity_private.is_super_admin()
       or (to_jsonb(new)-array['stare','nota_interna','updated_at','reviewer_user_id','reviewed_at','approved_base_id','approved_court_ids'])
          is distinct from (to_jsonb(old)-array['stare','nota_interna','updated_at','reviewer_user_id','reviewed_at','approved_base_id','approved_court_ids']) then
      raise exception 'Only superadmins may review applications; submitted details are immutable.';
    end if;
    if (new.updated_at,new.reviewer_user_id,new.reviewed_at) is distinct from
       (old.updated_at,old.reviewer_user_id,old.reviewed_at) then
      raise exception 'Review attribution is controlled by the server.';
    end if;
    publication_changed := (new.approved_base_id,new.approved_court_ids) is distinct from (old.approved_base_id,old.approved_court_ids);
    if (old.approved_base_id is not null or old.approved_court_ids is not null)
       and (publication_changed or new.stare<>'acceptata') then
      raise exception 'An approved application cannot be rejected or linked to different resources.';
    end if;
    if publication_changed or (new.stare='acceptata' and old.stare is distinct from 'acceptata') then
      if new.stare<>'acceptata' or new.approved_base_id is distinct from new.reserved_base_id
         or new.approved_court_ids is null or cardinality(new.approved_court_ids)<>jsonb_array_length(new.terenuri)
         or array_position(new.approved_court_ids,null) is not null
         or cardinality(new.approved_court_ids)<>(select count(distinct id) from unnest(new.approved_court_ids) ids(id))
         or not exists(select 1 from public.baze_sportive where id=new.approved_base_id and este_activa)
         or not exists(select 1 from public.baze_sportive_admini where baza_id=new.approved_base_id and user_id=new.solicitant_user_id) then
        raise exception 'Use approval to publish the base, courts and scoped admin access together.';
      end if;
      foreach court_id in array new.approved_court_ids loop
        if not exists(select 1 from public.terenuri t join public.users_admin a on a.user_id=new.solicitant_user_id
          where t.id::text=court_id and t.baza_sportiva_id=new.approved_base_id and t.este_activ is true
            and (a.is_super is true or t.nume=any(string_to_array(a.terenuri,',')))) then
          raise exception 'Approval requires active courts and exact administrator permissions.';
        end if;
      end loop;
    end if;
    if (new.stare,new.nota_interna,new.approved_base_id,new.approved_court_ids) is distinct from
       (old.stare,old.nota_interna,old.approved_base_id,old.approved_court_ids) then
      new.updated_at:=statement_timestamp(); new.reviewer_user_id:=auth.uid(); new.reviewed_at:=statement_timestamp();
    end if;
  end if;
  return new;
end
$$;

create or replace function public.approve_club_request(
  p_request_id uuid, p_prices jsonb, p_photo_path text default null,
  p_expected_updated_at timestamptz default null, p_nota text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  application public.cereri_baze_sportive%rowtype; applicant auth.users%rowtype;
  admin public.users_admin%rowtype; court jsonb; ordinal integer:=0;
  court_name text; stem text; suffix text; created_court_id text;
  created_court_ids text[]:='{}'; created_court_names text[]:='{}'; assigned_names text;
  image_metadata jsonb; original_image_metadata jsonb; image_extension text;
begin
  if auth.uid() is null or not spotivity_private.is_super_admin()
     or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Only authenticated superadmins may approve applications.' using errcode='42501';
  end if;
  select * into application from public.cereri_baze_sportive where id=p_request_id for update;
  if not found then raise exception 'The application no longer exists.' using errcode='22023'; end if;
  if application.approved_base_id is not null then
    return jsonb_build_object('request_id',application.id,'base_id',application.approved_base_id,'court_ids',application.approved_court_ids,'status','acceptata');
  end if;
  if application.approved_court_ids is not null then
    raise exception 'The previously approved base was deleted. This application cannot publish it again.' using errcode='22023';
  end if;
  if p_expected_updated_at is not null and application.updated_at is distinct from p_expected_updated_at then
    raise exception 'The application changed. Reload it before approving.' using errcode='40001';
  end if;
  if application.stare in ('respinsa','arhivata') then
    raise exception 'Reopen the application before approving it.' using errcode='22023';
  end if;
  if not spotivity_private.club_application_prices_valid(p_prices,jsonb_array_length(application.terenuri)) then
    raise exception 'Supply one whole-RON price between 0 and 100000 per court.' using errcode='22023';
  end if;
  if p_nota is not null and (char_length(p_nota)>2000 or p_nota ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception 'The internal note must contain at most 2000 characters.' using errcode='22023';
  end if;
  select * into applicant from auth.users where id=application.solicitant_user_id for update;
  if not found or applicant.email_confirmed_at is null then
    raise exception 'The applicant must have a confirmed Auth email before receiving admin access.' using errcode='22023';
  end if;
  if lower(btrim(applicant.email)) is distinct from lower(btrim(application.email)) then
    raise exception 'The application email must match the confirmed Auth account.' using errcode='22023';
  end if;
  p_photo_path:=nullif(btrim(p_photo_path),'');
  if application.poza_path is null and p_photo_path is not null then
    raise exception 'This application has no submitted photo.' using errcode='22023';
  end if;
  if application.poza_path is not null then
    if p_photo_path is null or spotivity_private.base_image_base(p_photo_path) is distinct from application.reserved_base_id then
      raise exception 'Copy the submitted photo to the reserved base before approval.' using errcode='22023';
    end if;
    image_extension:=substring(p_photo_path from '\.([^.]+)$');
    select metadata into image_metadata from storage.objects where bucket_id='poze_baze_sportive' and name=p_photo_path;
    select metadata into original_image_metadata from storage.objects where bucket_id='cereri_baze_sportive' and name=application.poza_path;
    if image_metadata is null or original_image_metadata is null
       or coalesce(image_metadata->>'size','') !~ '^[0-9]+$'
       or (image_metadata->>'size')::numeric not between 1 and 5242880
       or image_metadata->>'size' is distinct from original_image_metadata->>'size'
       or image_metadata->>'mimetype' is distinct from original_image_metadata->>'mimetype'
       or image_metadata->>'mimetype' is distinct from (case image_extension
         when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'png' then 'image/png'
         when 'webp' then 'image/webp' when 'avif' then 'image/avif' when 'gif' then 'image/gif' else '' end) then
      raise exception 'The copied application photo must be a matching raster image of at most 5 MB.' using errcode='22023';
    end if;
  end if;
  insert into public.baze_sportive(id,nume,oras,descriere,este_activa,poza)
    values(application.reserved_base_id,application.nume_baza,application.oras,left(coalesce(application.descriere,''),2000),true,p_photo_path);
  for court in select value from jsonb_array_elements(application.terenuri) loop
    ordinal:=ordinal+1;
    stem:=btrim(replace(application.nume_baza||' — '||(court->>'nume'),',',' · '));
    suffix:=' ['||left(replace(application.id::text,'-',''),8)||'-'||ordinal::text||']';
    court_name:=left(stem,160-char_length(suffix))||suffix;
    if exists(select 1 from public.terenuri where nume=court_name) then
      suffix:=' ['||replace(gen_random_uuid()::text,'-','')||'-'||ordinal::text||']';
      court_name:=left(stem,160-char_length(suffix))||suffix;
    end if;
    insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,locatie,oras,este_activ,are_chat,baza_sportiva_id)
      values(court_name,court->>'sport',(p_prices->>(ordinal-1))::numeric,0,false,application.link_maps,application.oras,true,true,application.reserved_base_id)
      returning id::text into created_court_id;
    created_court_ids:=array_append(created_court_ids,created_court_id);
    created_court_names:=array_append(created_court_names,court_name);
  end loop;
  select * into admin from public.users_admin where user_id=applicant.id for update;
  if found then
    if admin.is_super is not true then
      select string_agg(name,',' order by name) into assigned_names from (
        select distinct btrim(name) name from unnest(string_to_array(coalesce(admin.terenuri,''),',')||created_court_names) names(name)
        where btrim(name)<>''
      ) names;
      update public.users_admin set terenuri=assigned_names where user_id=applicant.id;
    end if;
  else
    insert into public.users_admin(nume_admin,email,user_id,is_super,terenuri)
      values(application.nume_contact,lower(btrim(applicant.email)),applicant.id,false,array_to_string(created_court_names,','));
  end if;
  insert into public.baze_sportive_admini(baza_id,user_id) values(application.reserved_base_id,applicant.id)
    on conflict(baza_id,user_id) do nothing;
  update public.cereri_baze_sportive set stare='acceptata',approved_base_id=application.reserved_base_id,approved_court_ids=created_court_ids,
    nota_interna=coalesce(p_nota,nota_interna) where id=application.id;
  return jsonb_build_object('request_id',application.id,'base_id',application.reserved_base_id,'court_ids',created_court_ids,'status','acceptata');
end
$$;

create or replace function public.reject_club_request(
  p_request_id uuid,p_nota text default '',p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare application public.cereri_baze_sportive%rowtype;
begin
  if auth.uid() is null or not spotivity_private.is_super_admin()
     or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Only authenticated superadmins may reject applications.' using errcode='42501';
  end if;
  select * into application from public.cereri_baze_sportive where id=p_request_id for update;
  if not found then raise exception 'The application no longer exists.' using errcode='22023'; end if;
  if application.approved_base_id is not null or application.approved_court_ids is not null then
    raise exception 'An approved application cannot be rejected.' using errcode='22023';
  end if;
  if p_expected_updated_at is not null and application.updated_at is distinct from p_expected_updated_at then
    raise exception 'The application changed. Reload it before rejecting.' using errcode='40001';
  end if;
  p_nota:=coalesce(p_nota,'');
  if char_length(p_nota)>2000 or p_nota ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'The internal note must contain at most 2000 characters.' using errcode='22023';
  end if;
  update public.cereri_baze_sportive set stare='respinsa',nota_interna=p_nota where id=application.id;
  return jsonb_build_object('request_id',application.id,'status','respinsa');
end
$$;

revoke all on function spotivity_private.club_application_prices_valid(jsonb,integer),
  public.submit_club_application(uuid,uuid,text,text,text,text,text,text,text,jsonb,text,text,jsonb),
  public.approve_club_request(uuid,jsonb,text,timestamptz,text),public.reject_club_request(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function spotivity_private.club_application_prices_valid(jsonb,integer) to authenticated,service_role;
grant execute on function public.submit_club_application(uuid,uuid,text,text,text,text,text,text,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.approve_club_request(uuid,jsonb,text,timestamptz,text),public.reject_club_request(uuid,text,timestamptz) to authenticated;
revoke execute on function public.submit_club_request(uuid,text,text,text,text,text,text,text,jsonb,text,text) from authenticated;

insert into spotivity_private.migrations(version) values(12) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
