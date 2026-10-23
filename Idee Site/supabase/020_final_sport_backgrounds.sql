-- Spotivity: replace the three requested sport backgrounds with final assets.
-- Apply after visual migrations 005 and 010 as postgres. Icons, ordering,
-- other sports, bookings, profiles, roles and permissions remain unchanged.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null
     or to_regclass('public.site_sporturi') is null then
    raise exception 'Apply visual migrations 005 and 010 before 020_final_sport_backgrounds.sql.';
  end if;
  if exists(select 1 from (values (5),(10)) required(version)
    where not exists(select 1 from spotivity_private.migrations applied
      where applied.version=required.version)) then
    raise exception 'Apply visual migrations 005 and 010 before 020_final_sport_backgrounds.sql.';
  end if;
end
$prerequisite$;

-- Serialize concurrent migration runs and visual edits while the first update
-- is recorded. Reapplying must retain later superadmin image choices/deletions.
lock table public.site_sporturi in share row exclusive mode;
do $initial_visuals$
declare changed integer;
begin
  if not exists(select 1 from spotivity_private.migrations where version=20) then
    if (select count(*) from public.site_sporturi
      where sport in ('Fotbal','Baschet','Tenis')) <> 3 then
      raise exception 'Expected all three existing sports Fotbal, Baschet and Tenis before migration 020.';
    end if;
    update public.site_sporturi configured
      set fundal_url=requested.image
      from (values
        ('Fotbal','assets/imagini/FotbalFinal.jpeg'),
        ('Baschet','assets/imagini/BaschetFinal.jpeg'),
        ('Tenis','assets/imagini/TenisFINAL.jpeg')
      ) requested(sport,image)
      where configured.sport=requested.sport;
    get diagnostics changed=row_count;
    if changed <> 3 then
      raise exception 'Expected exactly three updated sport backgrounds, found %.',changed;
    end if;
    insert into spotivity_private.migrations(version) values(20);
  end if;
end
$initial_visuals$;
commit;
