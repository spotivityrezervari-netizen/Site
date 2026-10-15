-- Spotivity: sports-base photos for the base's explicitly assigned admins.
-- Apply after 008_profile_edit.sql as postgres. Existing photos, court/admin
-- allocations, reservations, profiles, chat and webhook definitions stay intact.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001, 003, 004, 005, 006, 007 and 008 before 009_base_photos.sql.';
  end if;
  if exists (
    select 1 from (values (1), (3), (4), (5), (6), (7), (8)) required(version)
    where not exists (
      select 1 from spotivity_private.migrations applied
      where applied.version = required.version
    )
  ) then
    raise exception 'Apply migrations 001, 003, 004, 005, 006, 007 and 008 before 009_base_photos.sql.';
  end if;
  if not exists (select 1 from spotivity_private.migrations where version = 9)
     and exists (
       select 1 from pg_attribute where attrelid = 'public.baze_sportive'::regclass
         and attname = 'poza' and not attisdropped
     ) then
    raise exception 'Review the existing unregistered sports-base photo column before migration 009.';
  end if;
end;
$prerequisite$;

alter table public.baze_sportive add column if not exists poza text;
comment on column public.baze_sportive.poza is
  'Public poze_baze_sportive object path: base UUID/random UUID.raster extension. Null means no base photo.';
do $photo_constraint$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.baze_sportive'::regclass
      and conname = 'spotivity_base_photo_path_valid'
  ) then
    alter table public.baze_sportive add constraint spotivity_base_photo_path_valid
    check (poza is null or (
      poza ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif|gif)$'
      and split_part(poza, '/', 1) = id::text
    ));
  end if;
end;
$photo_constraint$;

-- Bucket settings are enforced by the Storage API for the actual upload,
-- independently of the browser's file picker and declared filename extension.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('poze_baze_sportive', 'poze_baze_sportive', true, 5242880,
  array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function spotivity_private.base_image_base(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif|gif)$'
    then split_part(object_name, '/', 1)::uuid else null end
$$;

create or replace function spotivity_private.may_write_base_image(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.baze_sportive b
    where b.id = spotivity_private.base_image_base(object_name)
      and spotivity_private.manages_base(b.id)
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
       or (to_jsonb(new) - array['descriere','poza','updated_at'])
          is distinct from (to_jsonb(old) - array['descriere','poza','updated_at']) then
      raise exception 'Authorized admins may edit only a sports-base description and photo.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.poza is not null and (tg_op = 'INSERT' or new.poza is distinct from old.poza) then
    if spotivity_private.base_image_base(new.poza) is distinct from new.id then
      raise exception 'Sports-base photo must use its own base UUID and an allowed raster extension.';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'poze_baze_sportive' and o.name = new.poza
    ) then
      raise exception 'Upload the sports-base photo before assigning it.';
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end
$$;
comment on table public.baze_sportive_admini is
  'Explicit permission to edit one base description and base photo. Only superadmins assign it. No court, reservation, profile, chat or court-photo access is inherited.';

-- Keep public image reads independent from private policy helpers. The bucket
-- is public for downloads; uploads, replacements, moves and deletions require
-- the Auth UUID's current explicit base permission (or superadmin role).
drop policy if exists spotivity_base_images_read on storage.objects;
drop policy if exists spotivity_base_images_insert on storage.objects;
drop policy if exists spotivity_base_images_update on storage.objects;
drop policy if exists spotivity_base_images_delete on storage.objects;
drop policy if exists spotivity_base_images_insert_guard on storage.objects;
drop policy if exists spotivity_base_images_update_guard on storage.objects;
drop policy if exists spotivity_base_images_delete_guard on storage.objects;
drop policy if exists spotivity_base_images_anon_insert_guard on storage.objects;
drop policy if exists spotivity_base_images_anon_update_guard on storage.objects;
drop policy if exists spotivity_base_images_anon_delete_guard on storage.objects;

create policy spotivity_base_images_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'poze_baze_sportive');
create policy spotivity_base_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'poze_baze_sportive' and spotivity_private.may_write_base_image(name));
create policy spotivity_base_images_update on storage.objects for update to authenticated
  using (bucket_id = 'poze_baze_sportive' and spotivity_private.may_write_base_image(name))
  with check (bucket_id = 'poze_baze_sportive' and spotivity_private.may_write_base_image(name));
create policy spotivity_base_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'poze_baze_sportive' and spotivity_private.may_write_base_image(name));

-- Existing global permissive Storage policies must not reopen this bucket.
-- Check both the old and the new object path when moving/replacing a row.
create policy spotivity_base_images_insert_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'poze_baze_sportive' or spotivity_private.may_write_base_image(name));
create policy spotivity_base_images_update_guard on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'poze_baze_sportive' or spotivity_private.may_write_base_image(name))
  with check (bucket_id <> 'poze_baze_sportive' or spotivity_private.may_write_base_image(name));
create policy spotivity_base_images_delete_guard on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'poze_baze_sportive' or spotivity_private.may_write_base_image(name));
create policy spotivity_base_images_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'poze_baze_sportive');
create policy spotivity_base_images_anon_update_guard on storage.objects as restrictive for update to anon
  using (bucket_id <> 'poze_baze_sportive') with check (bucket_id <> 'poze_baze_sportive');
create policy spotivity_base_images_anon_delete_guard on storage.objects as restrictive for delete to anon
  using (bucket_id <> 'poze_baze_sportive');

revoke all on function spotivity_private.base_image_base(text),
  spotivity_private.may_write_base_image(text), spotivity_private.guard_base()
  from public, anon, authenticated, service_role;
grant execute on function spotivity_private.may_write_base_image(text) to authenticated;

insert into spotivity_private.migrations(version) values (9)
  on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
