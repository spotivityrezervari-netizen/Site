-- Spotivity: private sports-base applications and superadmin review.
-- Apply after 010_foot_tennis.sql as postgres. Submission requires a real
-- signed-in account. It never creates courts, bases, roles or reservations.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001, 003, 004, 005, 006, 007, 008, 009 and 010 before 011_club_requests.sql.';
  end if;
  if exists (
    select 1 from (values (1), (3), (4), (5), (6), (7), (8), (9), (10)) required(version)
    where not exists (select 1 from spotivity_private.migrations applied where applied.version = required.version)
  ) then
    raise exception 'Apply migrations 001, 003, 004, 005, 006, 007, 008, 009 and 010 before 011_club_requests.sql.';
  end if;
  if not exists (select 1 from spotivity_private.migrations where version = 11)
     and (to_regclass('public.cereri_baze_sportive') is not null
       or exists (select 1 from storage.buckets where id = 'cereri_baze_sportive')) then
    raise exception 'Review existing unregistered sports-base applications before migration 011.';
  end if;
end;
$prerequisite$;

create or replace function spotivity_private.club_request_courts_valid(courts jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare court jsonb;
begin
  if courts is null or jsonb_typeof(courts) <> 'array' then return false; end if;
  if jsonb_array_length(courts) not between 1 and 20 then return false; end if;
  for court in select value from jsonb_array_elements(courts) loop
    if jsonb_typeof(court) <> 'object'
       or jsonb_typeof(court->'nume') is distinct from 'string'
       or jsonb_typeof(court->'sport') is distinct from 'string'
       or char_length(btrim(court->>'nume')) not between 2 and 160
       or court->>'nume' ~ '[[:cntrl:]]'
       or court->>'sport' not in ('Fotbal','Baschet','Tenis','Volei','Tenis Picior')
       or (court - array['nume','sport']) <> '{}'::jsonb then return false; end if;
  end loop;
  return true;
end
$$;

create or replace function spotivity_private.club_request_maps_valid(url text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(char_length(url) between 10 and 2048 and url ~
    '^https://((www\.)?google\.(com|ro)/maps([/?#][^[:space:]]*)?|maps\.google\.(com|ro)/[^[:space:]]*|maps\.app\.goo\.gl/[A-Za-z0-9_-]+([?][^[:space:]]*)?|goo\.gl/maps/[A-Za-z0-9_-]+([?][^[:space:]]*)?)$'
    and url !~ '[[:cntrl:]]', false)
$$;

create or replace function spotivity_private.club_request_photo_owner(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif|gif)$'
    then split_part(object_name, '/', 1)::uuid else null end
$$;

create table if not exists public.cereri_baze_sportive (
  id uuid primary key,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  solicitant_user_id uuid references auth.users(id) on delete set null,
  nume_baza text not null check (char_length(btrim(nume_baza)) between 2 and 160 and nume_baza !~ '[[:cntrl:]]'),
  nume_contact text not null check (char_length(btrim(nume_contact)) between 2 and 160 and nume_contact !~ '[[:cntrl:]]'),
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and email !~ '[[:cntrl:]]'),
  telefon text not null check (char_length(telefon) <= 50 and telefon ~ '^\+?[0-9 ().-]+$' and char_length(regexp_replace(telefon, '[^0-9]', '', 'g')) between 7 and 15),
  oras text not null check (char_length(btrim(oras)) between 2 and 120 and oras !~ '[[:cntrl:]]'),
  adresa text check (char_length(adresa) <= 300 and adresa !~ '[[:cntrl:]]'),
  link_maps text not null check (spotivity_private.club_request_maps_valid(link_maps)),
  terenuri jsonb not null check (spotivity_private.club_request_courts_valid(terenuri)),
  descriere text check (char_length(descriere) <= 3000 and descriere !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  poza_path text check (poza_path is null or (spotivity_private.club_request_photo_owner(poza_path) is not null and split_part(poza_path,'/',2) = id::text)),
  stare text not null default 'noua' check (stare in ('noua','in_analiza','contactata','acceptata','respinsa','arhivata')),
  nota_interna text not null default '' check (char_length(nota_interna) <= 2000 and nota_interna !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  reviewer_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);
create index if not exists spotivity_club_requests_created on public.cereri_baze_sportive(created_at desc);
create index if not exists spotivity_club_requests_actor_created on public.cereri_baze_sportive(solicitant_user_id,created_at desc);
comment on table public.cereri_baze_sportive is
  'Private inbound applications. Only current database-backed superadmins can list/review them; accepted status does not publish a base or assign any role.';

create or replace function spotivity_private.may_use_club_request_draft_image(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and spotivity_private.club_request_photo_owner(object_name) = (select auth.uid())
    and not exists (select 1 from public.cereri_baze_sportive r where r.id::text = split_part(object_name,'/',2))
$$;

create or replace function spotivity_private.guard_club_request_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Nested Auth-FK ON DELETE SET NULL is allowed; role decisions always use
  -- users_admin.user_id, never browser-editable Auth metadata.
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    if not spotivity_private.is_super_admin()
       or (to_jsonb(new) - array['stare','nota_interna','updated_at','reviewer_user_id','reviewed_at'])
          is distinct from (to_jsonb(old) - array['stare','nota_interna','updated_at','reviewer_user_id','reviewed_at']) then
      raise exception 'Only superadmins may review applications; submitted details are immutable.';
    end if;
    if (new.updated_at,new.reviewer_user_id,new.reviewed_at) is distinct from
       (old.updated_at,old.reviewer_user_id,old.reviewed_at) then
      raise exception 'Review attribution is controlled by the server.';
    end if;
    if (new.stare,new.nota_interna) is distinct from (old.stare,old.nota_interna) then
      new.updated_at := statement_timestamp();
      new.reviewer_user_id := auth.uid();
      new.reviewed_at := statement_timestamp();
    end if;
  end if;
  return new;
end
$$;

do $review_trigger$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.cereri_baze_sportive'::regclass and tgname='spotivity_club_request_review' and not tgisinternal) then
    create trigger spotivity_club_request_review before update on public.cereri_baze_sportive
      for each row execute function spotivity_private.guard_club_request_review();
  end if;
end;
$review_trigger$;

alter table public.cereri_baze_sportive enable row level security;
revoke all on public.cereri_baze_sportive from public, anon, authenticated, service_role;
grant select on public.cereri_baze_sportive to authenticated;
grant update(stare,nota_interna) on public.cereri_baze_sportive to authenticated;
grant all on public.cereri_baze_sportive to service_role;
drop policy if exists spotivity_club_requests_read on public.cereri_baze_sportive;
drop policy if exists spotivity_club_requests_review on public.cereri_baze_sportive;
drop policy if exists spotivity_club_requests_read_guard on public.cereri_baze_sportive;
drop policy if exists spotivity_club_requests_review_guard on public.cereri_baze_sportive;
create policy spotivity_club_requests_read on public.cereri_baze_sportive for select to authenticated
  using (spotivity_private.is_super_admin());
create policy spotivity_club_requests_review on public.cereri_baze_sportive for update to authenticated
  using (spotivity_private.is_super_admin()) with check (spotivity_private.is_super_admin());
create policy spotivity_club_requests_read_guard on public.cereri_baze_sportive as restrictive for select to authenticated
  using (spotivity_private.is_super_admin());
create policy spotivity_club_requests_review_guard on public.cereri_baze_sportive as restrictive for update to authenticated
  using (spotivity_private.is_super_admin()) with check (spotivity_private.is_super_admin());

create or replace function public.submit_club_request(
  p_request_id uuid, p_nume_baza text, p_nume_contact text, p_email text,
  p_telefon text, p_oras text, p_adresa text, p_link_maps text,
  p_terenuri jsonb, p_descriere text, p_poza_path text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  subject uuid := auth.uid();
  existing public.cereri_baze_sportive%rowtype;
  photo_metadata jsonb;
  normalized_courts jsonb;
begin
  if subject is null or not exists (select 1 from auth.users where id=subject) then
    raise exception 'Authentication is required to submit a sports-base application.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception 'A request identifier is required.' using errcode='22023'; end if;
  p_nume_baza := btrim(p_nume_baza); p_nume_contact := btrim(p_nume_contact);
  p_email := lower(btrim(p_email)); p_telefon := btrim(p_telefon); p_oras := btrim(p_oras);
  p_adresa := nullif(btrim(p_adresa),''); p_link_maps := btrim(p_link_maps);
  p_descriere := nullif(btrim(p_descriere),''); p_poza_path := nullif(btrim(p_poza_path),'');
  if p_nume_baza is null or char_length(p_nume_baza) not between 2 and 160 or p_nume_baza ~ '[[:cntrl:]]'
     or p_nume_contact is null or char_length(p_nume_contact) not between 2 and 160 or p_nume_contact ~ '[[:cntrl:]]'
     or p_email is null or char_length(p_email) not between 3 and 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_email ~ '[[:cntrl:]]'
     or p_telefon is null or char_length(p_telefon)>50 or p_telefon !~ '^\+?[0-9 ().-]+$' or char_length(regexp_replace(p_telefon,'[^0-9]','','g')) not between 7 and 15
     or p_oras is null or char_length(p_oras) not between 2 and 120 or p_oras ~ '[[:cntrl:]]'
     or char_length(p_adresa)>300 or p_adresa ~ '[[:cntrl:]]'
     or not spotivity_private.club_request_maps_valid(p_link_maps)
     or not spotivity_private.club_request_courts_valid(p_terenuri)
     or char_length(p_descriere)>3000 or p_descriere ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'Check the required contact, city, Google Maps link and 1 to 20 supported courts.' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('nume',btrim(court->>'nume'),'sport',court->>'sport') order by position)
    into normalized_courts from jsonb_array_elements(p_terenuri) with ordinality as entries(court,position);
  -- Serialize only this submitter's requests/draft photos. No business-table
  -- locks and no global quota: one user's requests do not block another user.
  perform pg_advisory_xact_lock(hashtextextended(subject::text,11011));
  select * into existing from public.cereri_baze_sportive where id=p_request_id for update;
  if found then
    if existing.solicitant_user_id is distinct from subject then
      raise exception 'Request identifier is unavailable.' using errcode='22023';
    end if;
    if (existing.nume_baza,existing.nume_contact,existing.email,existing.telefon,existing.oras,existing.adresa,existing.link_maps,existing.terenuri,existing.descriere,existing.poza_path)
       is distinct from (p_nume_baza,p_nume_contact,p_email,p_telefon,p_oras,p_adresa,p_link_maps,normalized_courts,p_descriere,p_poza_path) then
      raise exception 'Request identifier was already used with different details.' using errcode='22023';
    end if;
    return existing.id;
  end if;
  if (select count(*) from public.cereri_baze_sportive where solicitant_user_id=subject and created_at>statement_timestamp()-interval '24 hours') >= 5 then
    raise exception 'At most five sports-base applications may be sent per account in 24 hours.' using errcode='P0001';
  end if;
  if p_poza_path is not null then
    if spotivity_private.club_request_photo_owner(p_poza_path) is distinct from subject
       or split_part(p_poza_path,'/',2) is distinct from p_request_id::text then
      raise exception 'Application photo must belong to this account and request.' using errcode='22023';
    end if;
    select metadata into photo_metadata from storage.objects
      where bucket_id='cereri_baze_sportive' and name=p_poza_path;
    if not found or photo_metadata is null
       or coalesce(photo_metadata->>'size','') !~ '^[0-9]+$'
       or coalesce(photo_metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp','image/avif','image/gif') then
      raise exception 'Upload an allowed application photo first.' using errcode='22023';
    end if;
    if (photo_metadata->>'size')::numeric not between 1 and 5242880 then
      raise exception 'Application photo must be at most 5 MB.' using errcode='22023';
    end if;
  end if;
  insert into public.cereri_baze_sportive(id,solicitant_user_id,nume_baza,nume_contact,email,telefon,oras,adresa,link_maps,terenuri,descriere,poza_path)
    values(p_request_id,subject,p_nume_baza,p_nume_contact,p_email,p_telefon,p_oras,p_adresa,p_link_maps,normalized_courts,p_descriere,p_poza_path);
  return p_request_id;
end
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cereri_baze_sportive','cereri_baze_sportive',false,5242880,
  array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Submitted images are immutable for the submitter. Draft images remain
-- visible/deletable to their uploader for safe Storage cleanup; no other user
-- can read them. Only a current superadmin may read submitted application photos.
drop policy if exists spotivity_club_images_read on storage.objects;
drop policy if exists spotivity_club_images_insert on storage.objects;
drop policy if exists spotivity_club_images_delete on storage.objects;
drop policy if exists spotivity_club_images_read_guard on storage.objects;
drop policy if exists spotivity_club_images_insert_guard on storage.objects;
drop policy if exists spotivity_club_images_update_guard on storage.objects;
drop policy if exists spotivity_club_images_delete_guard on storage.objects;
drop policy if exists spotivity_club_images_anon_guard on storage.objects;
create policy spotivity_club_images_read on storage.objects for select to authenticated
  using(bucket_id='cereri_baze_sportive' and (spotivity_private.is_super_admin() or spotivity_private.may_use_club_request_draft_image(name)));
create policy spotivity_club_images_insert on storage.objects for insert to authenticated
  with check(bucket_id='cereri_baze_sportive' and spotivity_private.may_use_club_request_draft_image(name));
create policy spotivity_club_images_delete on storage.objects for delete to authenticated
  using(bucket_id='cereri_baze_sportive' and spotivity_private.may_use_club_request_draft_image(name));
create policy spotivity_club_images_read_guard on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'cereri_baze_sportive' or spotivity_private.is_super_admin() or spotivity_private.may_use_club_request_draft_image(name));
create policy spotivity_club_images_insert_guard on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'cereri_baze_sportive' or spotivity_private.may_use_club_request_draft_image(name));
create policy spotivity_club_images_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'cereri_baze_sportive') with check(bucket_id<>'cereri_baze_sportive');
create policy spotivity_club_images_delete_guard on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'cereri_baze_sportive' or spotivity_private.may_use_club_request_draft_image(name));
create policy spotivity_club_images_anon_guard on storage.objects as restrictive for all to anon
  using(bucket_id<>'cereri_baze_sportive') with check(bucket_id<>'cereri_baze_sportive');

create or replace function spotivity_private.guard_club_request_image() returns trigger
language plpgsql security definer set search_path='' as $$
declare object_name text;
begin
  if tg_op='UPDATE' then
    if old.bucket_id<>'cereri_baze_sportive' and new.bucket_id<>'cereri_baze_sportive' then return new; end if;
  elsif tg_op='DELETE' then
    if old.bucket_id<>'cereri_baze_sportive' then return old; end if;
  elsif new.bucket_id<>'cereri_baze_sportive' then return new;
  end if;
  if auth.uid() is not null then
    if tg_op='UPDATE' then raise exception 'Application photos cannot be replaced or moved.'; end if;
    object_name := case when tg_op='DELETE' then old.name else new.name end;
    if spotivity_private.club_request_photo_owner(object_name) is distinct from auth.uid() then
      raise exception 'Application photo must belong to this account.';
    end if;
    -- Serialize with submit_club_request before checking the submitted row.
    -- Recheck with a fresh snapshot after waiting, closing submit/delete races.
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,11011));
    if exists(select 1 from public.cereri_baze_sportive where id::text=split_part(object_name,'/',2)) then
      raise exception 'Submitted application photos are immutable.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
do $image_trigger$
begin
  if not exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass and tgname='spotivity_club_request_image_guard' and not tgisinternal) then
    create trigger spotivity_club_request_image_guard before insert or update or delete on storage.objects
      for each row execute function spotivity_private.guard_club_request_image();
  end if;
end;
$image_trigger$;

revoke all on function spotivity_private.club_request_courts_valid(jsonb),
  spotivity_private.club_request_maps_valid(text), spotivity_private.club_request_photo_owner(text),
  spotivity_private.may_use_club_request_draft_image(text), spotivity_private.guard_club_request_review(),
  spotivity_private.guard_club_request_image(),
  public.submit_club_request(uuid,text,text,text,text,text,text,text,jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function spotivity_private.may_use_club_request_draft_image(text) to authenticated;
-- Check expressions also run for the reviewer's updated row.
grant execute on function spotivity_private.club_request_courts_valid(jsonb),
  spotivity_private.club_request_maps_valid(text), spotivity_private.club_request_photo_owner(text) to authenticated,service_role;
grant execute on function public.submit_club_request(uuid,text,text,text,text,text,text,text,jsonb,text,text) to authenticated;

insert into spotivity_private.migrations(version) values(11) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
