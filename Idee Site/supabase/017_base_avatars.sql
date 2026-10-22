-- Spotivity: an independent profile photo beside the sports-base cover.
-- Apply after 016 as postgres. Existing images, grants, role rows and bookings
-- are not rewritten. The existing Storage bucket and policies remain in force.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 016 before 017_base_avatars.sql.';
  end if;
  if exists (select 1 from (values (1),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16)) required(version)
    where not exists(select 1 from spotivity_private.migrations applied where applied.version=required.version)) then
    raise exception 'Apply migrations 001 through 016 before 017_base_avatars.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=17)
     and exists(select 1 from pg_attribute where attrelid='public.baze_sportive'::regclass
       and attname='poza_profil' and not attisdropped) then
    raise exception 'Review the existing unregistered sports-base profile photo column before migration 017.';
  end if;
end
$prerequisite$;

alter table public.baze_sportive add column if not exists poza_profil text;
comment on column public.baze_sportive.poza_profil is
  'Independent public profile image path in poze_baze_sportive: own base UUID/random UUID.raster extension. Null uses the public avatar fallback; poza remains the cover.';
do $avatar_constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.baze_sportive'::regclass
    and conname='spotivity_base_avatar_path_valid') then
    alter table public.baze_sportive add constraint spotivity_base_avatar_path_valid
      check(poza_profil is null or (
        poza_profil ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif|gif)$'
        and split_part(poza_profil,'/',1)=id::text
      ));
  end if;
end
$avatar_constraint$;

-- Extend the existing description/cover permission by one presentation field.
-- Court assignments alone still do not grant base-presentation permissions.
create or replace function spotivity_private.guard_base() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not spotivity_private.is_super_admin() then
    if tg_op<>'UPDATE' then
      raise exception 'Only superadmins may create or delete sports bases.';
    end if;
    if not spotivity_private.manages_base(old.id)
      or (to_jsonb(new)-array['descriere','poza','poza_profil','updated_at'])
        is distinct from (to_jsonb(old)-array['descriere','poza','poza_profil','updated_at']) then
      raise exception 'Authorized admins may edit only a sports-base description, cover and profile photo.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.poza is not null and (tg_op='INSERT' or new.poza is distinct from old.poza) then
    if spotivity_private.base_image_base(new.poza) is distinct from new.id then
      raise exception 'Sports-base photo must use its own base UUID and an allowed raster extension.';
    end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='poze_baze_sportive' and o.name=new.poza) then
      raise exception 'Upload the sports-base photo before assigning it.';
    end if;
  end if;
  if new.poza_profil is not null and (tg_op='INSERT' or new.poza_profil is distinct from old.poza_profil) then
    if spotivity_private.base_image_base(new.poza_profil) is distinct from new.id then
      raise exception 'Sports-base profile photo must use its own base UUID and an allowed raster extension.';
    end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='poze_baze_sportive' and o.name=new.poza_profil) then
      raise exception 'Upload the sports-base profile photo before assigning it.';
    end if;
  end if;
  new.updated_at:=statement_timestamp();
  return new;
end
$$;
revoke all on function spotivity_private.guard_base() from public,anon,authenticated,service_role;
comment on table public.baze_sportive_admini is
  'Explicit permission to edit one base description, cover and profile photo. Only superadmins assign it. No court, reservation, profile, chat or court-photo access is inherited.';

-- Keep the exact role/court/base boundaries and expose the additional public
-- presentation field to the already-authorized integrated management view.
create or replace function public.get_admin_access()
returns jsonb language sql stable security definer set search_path='' as $$
  with administrator as (
    select a.nume_admin,a.is_super is true as is_super
    from public.users_admin a where a.user_id=(select auth.uid())
  ), courts as (
    select t.id::text as id,t.nume,t.baza_sportiva_id
    from public.terenuri t where spotivity_private.manages_court(t.nume)
  ), bases as (
    select b.id,b.nume,b.oras,b.descriere,b.poza,b.poza_profil,b.este_activa,
      spotivity_private.manages_base(b.id) as can_edit_details
    from public.baze_sportive b
    where spotivity_private.manages_base(b.id)
      or exists(select 1 from courts c where c.baza_sportiva_id=b.id)
  )
  select jsonb_build_object(
    'is_super',coalesce((select a.is_super from administrator a),false),
    'nume_admin',(select a.nume_admin from administrator a),
    'can_manage',coalesce((select a.is_super from administrator a),false)
      or exists(select 1 from courts) or exists(select 1 from bases),
    'courts',coalesce((select jsonb_agg(to_jsonb(c) order by c.nume,c.id) from courts c),'[]'::jsonb),
    'bases',coalesce((select jsonb_agg(to_jsonb(b) order by b.nume,b.id) from bases b),'[]'::jsonb)
  )
$$;
comment on function public.get_admin_access() is
  'Current Auth UUID administration scope. Base description/cover/avatar grants do not grant court, booking, client or chat access.';
revoke all on function public.get_admin_access() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_access() to authenticated;

insert into spotivity_private.migrations(version) values(17) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
