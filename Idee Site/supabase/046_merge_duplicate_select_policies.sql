-- Spotivity: performance only (Supabase advisor "multiple_permissive_policies").
-- For signed-in users each of these tables had TWO permissive SELECT policies
-- (public + staff) that Postgres evaluates for every row. They are merged into
-- one policy per role with exactly the same visibility:
--   anon          -> public rule only (unchanged)
--   authenticated -> public rule OR staff rule (same as the two policies before)
-- The RESTRICTIVE boundary policies are not touched. Apply after 045 as postgres.
begin;

do $prerequisite$
begin
  if not exists(select 1 from spotivity_private.migrations where version=45) then
    raise exception 'Apply 045 before 046_merge_duplicate_select_policies.sql.';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='baze_sportive' and policyname='bases_public')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='baze_sportive' and policyname='bases_staff')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='terenuri' and policyname='courts_public')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='terenuri' and policyname='courts_staff')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='rezervari_disponibilitate' and policyname='availability_read')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='rezervari_disponibilitate' and policyname='availability_staff') then
    raise exception 'Expected SELECT policies are missing; review before 046.';
  end if;
end
$prerequisite$;

-- Sports bases
alter policy bases_public on public.baze_sportive to anon;
alter policy bases_staff on public.baze_sportive to authenticated using (
  spotivity_private.manages_base(id)
  or ((este_activa is true) and exists(select 1 from public.terenuri t
    where t.baza_sportiva_id = baze_sportive.id and t.este_activ is not false))
);

-- Courts
alter policy courts_public on public.terenuri to anon;
alter policy courts_staff on public.terenuri to authenticated using (
  spotivity_private.manages_court(nume) or (este_activ is not false)
);

-- Public availability
alter policy availability_read on public.rezervari_disponibilitate to anon;
alter policy availability_staff on public.rezervari_disponibilitate to authenticated using (
  spotivity_private.manages_court(teren)
  or exists(select 1 from public.terenuri t where t.nume = rezervari_disponibilitate.teren and t.este_activ is not false)
);

insert into spotivity_private.migrations(version) values(46) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
