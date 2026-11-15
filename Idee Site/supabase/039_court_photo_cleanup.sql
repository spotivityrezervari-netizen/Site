-- A failed/uncertain browser save must never delete a committed or shared photo.
-- Apply before the corresponding admin-courts.js cleanup code. No objects are
-- removed by this migration; Storage API deletions retain their usual checks.
begin;
do $guard$
begin
 if not exists(select 1 from spotivity_private.migrations where version=4) then
  raise exception 'Apply 004 before 039.';
 end if;
 if exists(select 1 from spotivity_private.migrations where version>39) then
  raise exception '039 is superseded; do not reapply.';
 end if;
 if to_regprocedure('spotivity_private.court_image_object(text)') is null
  or to_regprocedure('spotivity_private.may_write_image(text)') is null then
  raise exception 'Court image authorization helpers are missing.';
 end if;
end
$guard$;

create or replace function spotivity_private.may_delete_court_image(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
  and object_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$'
  and spotivity_private.may_write_image(object_name)
  and not exists(select 1 from public.terenuri t
   where spotivity_private.court_image_object(t.poza)=object_name)
$$;
revoke all on function spotivity_private.may_delete_court_image(text) from public,anon,authenticated,service_role;
grant execute on function spotivity_private.may_delete_court_image(text) to authenticated;

-- Restrictive policy covers old permissive policies too, including superadmin.
-- The definer helper sees references on hidden/unallocated courts as well.
drop policy if exists spotivity_images_unreferenced_delete_guard on storage.objects;
create policy spotivity_images_unreferenced_delete_guard on storage.objects as restrictive
 for delete to authenticated using(bucket_id<>'poze_terenuri'
  or spotivity_private.may_delete_court_image(name));

insert into spotivity_private.migrations(version)values(39)on conflict(version)do nothing;
commit;
