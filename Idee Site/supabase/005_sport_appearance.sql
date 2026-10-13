-- Spotivity: public sport icons and backgrounds, without changing bookings.
-- Apply after 004_admin_scope_hardening.sql as postgres.
-- Existing court photos, hours, reservations, roles and Storage stay unchanged.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply 001_security.sql, 003_court_hours.sql and 004_admin_scope_hardening.sql first.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version = 1)
     or not exists(select 1 from spotivity_private.migrations where version = 3)
     or not exists(select 1 from spotivity_private.migrations where version = 4)
     or to_regprocedure('spotivity_private.is_super_admin()') is null then
    raise exception 'Apply 001_security.sql, 003_court_hours.sql and 004_admin_scope_hardening.sql first.';
  end if;
  if to_regclass('public.site_sporturi') is not null
     and not exists(select 1 from spotivity_private.migrations where version = 5) then
    raise exception 'Review the existing unregistered public.site_sporturi table before applying migration 005.';
  end if;
end;
$prerequisite$;

create table if not exists public.site_sporturi (
  sport text primary key,
  icona_url text not null,
  fundal_url text not null,
  ordine integer not null,
  constraint site_sporturi_sport_valid check (sport in ('Fotbal','Baschet','Tenis','Volei')),
  constraint site_sporturi_ordine_valid check (ordine between 1 and 4),
  -- Only local raster images or HTTPS URLs are allowed. No scripts, data URLs,
  -- credentials, path traversal or characters that can escape a CSS URL.
  constraint site_sporturi_icona_valid check (
    char_length(icona_url) between 1 and 2048 and (
      icona_url ~ '^assets/imagini/[A-Za-z0-9_-]+\.(png|jpe?g|webp|avif|gif)$'
      or icona_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?/[A-Za-z0-9_./~%?&=+,;:@!#-]*$'
    )
  ),
  constraint site_sporturi_fundal_valid check (
    char_length(fundal_url) between 1 and 2048 and (
      fundal_url ~ '^assets/imagini/[A-Za-z0-9_-]+\.(png|jpe?g|webp|avif|gif)$'
      or fundal_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?/[A-Za-z0-9_./~%?&=+,;:@!#-]*$'
    )
  )
);
comment on table public.site_sporturi is
  'Public visual configuration only. Court availability and permissions are enforced by the existing booking tables and policies.';

alter table public.site_sporturi enable row level security;
revoke all on public.site_sporturi from public, anon, authenticated, service_role;
grant select on public.site_sporturi to anon, authenticated;
grant insert, update, delete on public.site_sporturi to authenticated;
grant select, insert, update, delete on public.site_sporturi to service_role;

-- This migration owns only the new visual table. Rebuild its policies on rerun
-- so an older permissive policy cannot silently reopen writes to visitors.
do $policies$
declare item record;
begin
  for item in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'site_sporturi'
  loop
    execute format('drop policy %I on public.site_sporturi', item.policyname);
  end loop;
end;
$policies$;
create policy site_sporturi_read on public.site_sporturi for select
  to anon, authenticated using (true);
create policy site_sporturi_insert on public.site_sporturi for insert
  to authenticated with check ((select spotivity_private.is_super_admin()));
create policy site_sporturi_update on public.site_sporturi for update
  to authenticated using ((select spotivity_private.is_super_admin()))
  with check ((select spotivity_private.is_super_admin()));
create policy site_sporturi_delete on public.site_sporturi for delete
  to authenticated using ((select spotivity_private.is_super_admin()));

-- Exact case-sensitive repository filenames, including RealisBaschet.png.
-- Existing custom choices are retained if this migration is run again.
insert into public.site_sporturi(sport, icona_url, fundal_url, ordine) values
  ('Fotbal', 'assets/imagini/fotbalrealist.png', 'assets/imagini/RealistFotbal.png', 1),
  ('Baschet', 'assets/imagini/baschetrealist.png', 'assets/imagini/RealisBaschet.png', 2),
  ('Tenis', 'assets/imagini/tenisrealist.png', 'assets/imagini/RealistTenis.png', 3),
  ('Volei', 'assets/imagini/voleirealist.png', 'assets/imagini/RealistVolei.png', 4)
on conflict (sport) do nothing;

insert into spotivity_private.migrations(version) values (5)
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
