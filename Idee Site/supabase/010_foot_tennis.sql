-- Spotivity: a separate Tenis Picior visual category and a new football hero.
-- Apply after 009_base_photos.sql as postgres. The canonical court/booking
-- sport remains 'Tenis Picior'; the frontend displays 'Tenis de picior'.
-- No court, booking, profile, role, Storage object or allocation is rewritten.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001, 003, 004, 005, 006, 007, 008 and 009 before 010_foot_tennis.sql.';
  end if;
  if exists (
    select 1 from (values (1), (3), (4), (5), (6), (7), (8), (9)) required(version)
    where not exists (
      select 1 from spotivity_private.migrations applied
      where applied.version = required.version
    )
  ) then
    raise exception 'Apply migrations 001, 003, 004, 005, 006, 007, 008 and 009 before 010_foot_tennis.sql.';
  end if;
end;
$prerequisite$;

-- Change only the managed category/order checks. Existing image validation,
-- public reads, superadmin writes, grants and all other constraints stay intact.
alter table public.site_sporturi drop constraint if exists site_sporturi_sport_valid;
alter table public.site_sporturi add constraint site_sporturi_sport_valid
  check (sport in ('Fotbal','Baschet','Tenis','Volei','Tenis Picior'));
alter table public.site_sporturi drop constraint if exists site_sporturi_ordine_valid;
alter table public.site_sporturi add constraint site_sporturi_ordine_valid
  check (ordine between 1 and 5);

do $initial_visuals$
begin
  -- Apply the requested defaults once. Reapplying this migration must not
  -- overwrite later superadmin changes or recreate deliberately removed rows.
  if not exists (select 1 from spotivity_private.migrations where version = 10) then
    insert into public.site_sporturi(sport, icona_url, fundal_url, ordine)
    values ('Tenis Picior', 'assets/imagini/fotbalrealist.png',
      'assets/imagini/RealistTenispicior.png', 5)
    on conflict (sport) do nothing;

    update public.site_sporturi
      set fundal_url = 'assets/imagini/RealistFotbal1.png'
      where sport = 'Fotbal';
  end if;
end;
$initial_visuals$;

insert into spotivity_private.migrations(version) values (10)
  on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
