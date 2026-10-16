-- Minimal disposable Supabase-compatible fixture. Never run on the real project.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table auth.users (
  id uuid primary key, email text unique not null,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'
);
create table public.clienti(id uuid primary key default gen_random_uuid(), nume text, email text, telefon text);
create table public.users_admin(id uuid primary key default gen_random_uuid(), nume_admin text, email text, is_super boolean default false, terenuri text);
create table public.terenuri (
  id bigint generated always as identity primary key, nume text, sport text,
  pret numeric, pret_minge numeric, optiune_minge boolean, poza text,
  locatie text, oras text, este_activ boolean default true, are_chat boolean default true
);
create table public.rezervari (
  id uuid primary key default gen_random_uuid(), email_client text, sport text,
  teren text, data_str text, ora text, pret_total text, stare text,
  timestamp_start bigint, created_at timestamptz default now()
);
create table public.mesaje_chat (
  id uuid primary key default gen_random_uuid(), email_client text, teren text,
  expeditor text, mesaj text, citit boolean default false, created_at timestamptz default now()
);
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
-- Deliberately unsafe legacy policies: the migration must override them.
create policy unsafe_profiles on public.clienti for all to public using(true) with check(true);
create policy unsafe_admins on public.users_admin for all to public using(true) with check(true);
create policy unsafe_bookings on public.rezervari for all to public using(true) with check(true);
create policy unsafe_storage on storage.objects for all to public using(true) with check(true);
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000001','alice@example.test',now()),
 ('00000000-0000-0000-0000-000000000002','bob@example.test',now()),
 ('00000000-0000-0000-0000-000000000003','admin@example.test',now()),
 ('00000000-0000-0000-0000-000000000004','super@example.test',now());
insert into public.clienti(nume,email,telefon) values
 ('Alice','alice@example.test','111'),('Bob','bob@example.test','222');
insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,este_activ) values
 ('Court A','Fotbal',100,15,true,true),('Court B','Tenis',200,null,false,true),('Hidden Court','Volei',50,0,false,false);
insert into public.users_admin(nume_admin,email,is_super,terenuri) values
 ('Manager','admin@example.test',false,' Court A '),('Super','super@example.test',true,'ALL');
-- Legacy date, inferred from its recorded creation year. No production information.
insert into public.rezervari(email_client,sport,teren,data_str,ora,pret_total,stare,timestamp_start,created_at)
 values ('alice@example.test','Fotbal','Court A','Lun, 05.01','12:00','100 RON','anulata',1767225600000,'2026-01-01');
