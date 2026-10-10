-- Read-only diagnosis for the error:
-- "Review exposed public SECURITY DEFINER RPCs before enabling this security model."
-- Run separately in SQL Editor as postgres. No permissions or data are changed.
-- Review the definitions and dependencies before restricting any function.
select
  format('%I.%I(%s)', n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid)) as functie,
  pg_get_userbyid(p.proowner) as proprietar,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_poate_apela,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as utilizator_poate_apela,
  pg_get_functiondef(p.oid) as cod_sql
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  and (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
order by p.proname, p.oid;
