-- EXAMPLES ONLY: after 001_security.sql, replace .invalid addresses and real court names.
-- Create the Auth user FIRST in Authentication > Users, with a confirmed email.
-- SQL Editor runs as postgres and is a trusted administrative interface.

-- First superadmin (also the recovery route if all superadmins were removed):
insert into public.users_admin (user_id,nume_admin,email,is_super,terenuri)
select id,'Superadmin',email,true,'ALL' from auth.users
where lower(email) = 'inlocuieste-superadmin@example.invalid' and email_confirmed_at is not null
on conflict (user_id) do update set is_super = true, terenuri = 'ALL';

-- Ordinary admin: exact court names, separated by commas; names may not contain commas.
insert into public.users_admin (user_id,nume_admin,email,is_super,terenuri)
select id,'Admin terenuri',email,false,'Numele exact al terenului' from auth.users
where lower(email) = 'inlocuieste-admin@example.invalid' and email_confirmed_at is not null
on conflict (user_id) do update set is_super = false, terenuri = excluded.terenuri;

-- Check binding and confirmation (no passwords or tokens):
select a.nume_admin,a.user_id,a.email,a.is_super,a.terenuri,u.email_confirmed_at is not null as email_confirmed
from public.users_admin a join auth.users u on u.id = a.user_id;

-- Revoke a role without deleting the Auth account (run separately if needed):
-- delete from public.users_admin where user_id = '<AUTH-UUID>'::uuid;
