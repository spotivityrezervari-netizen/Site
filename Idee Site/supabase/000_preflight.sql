-- Read-only inventory. Run in your own SQL Editor before reviewing/applying 001_security.sql.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('clienti','users_admin','terenuri','rezervari','mesaje_chat')
order by table_name, ordinal_position;

select c.relname as table_name, con.conname as constraint_name, pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('clienti','users_admin','terenuri','rezervari','mesaje_chat');
select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('clienti','users_admin','terenuri','rezervari','mesaje_chat');

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('clienti','users_admin','terenuri','rezervari','mesaje_chat');

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where (schemaname = 'public' and tablename in ('clienti','users_admin','terenuri','rezervari','mesaje_chat'))
or (schemaname = 'storage' and tablename = 'objects') order by schemaname,tablename,policyname;

select t.tgname as trigger_name, p.proname as function_name, n.nspname as function_schema
from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_call,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype);

select distinct v.relname as dependent_view, v.relkind, v.reloptions
from pg_class v join pg_namespace vn on vn.oid = v.relnamespace
join pg_rewrite rw on rw.ev_class = v.oid join pg_depend d on d.objid = rw.oid and d.classid = 'pg_rewrite'::regclass
join pg_class t on t.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
join pg_namespace tn on tn.oid = t.relnamespace
where vn.nspname = 'public' and tn.nspname = 'public' and v.relkind in ('v','m')
and t.relname in ('clienti','users_admin','rezervari','mesaje_chat');

select count(*) as legacy_date_rows from public.rezervari where data_str !~ '^\d{4}-\d{2}-\d{2}$';
select count(*) as duplicate_active_slot_groups from (
  select teren,data_str,ora from public.rezervari where stare='activa' group by teren,data_str,ora having count(*)>1
) duplicates;
select count(*) as duplicate_client_email_groups from (
  select lower(btrim(email)) from public.clienti group by lower(btrim(email)) having count(*)>1
) duplicates;
select count(*) as duplicate_court_name_groups from (
  select nume from public.terenuri group by nume having count(*)>1
) duplicates;
