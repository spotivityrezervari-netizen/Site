-- Spotivity: server-derived administration scope for the integrated site.
-- Apply after 012 as postgres. Existing role rows, court allocations, base
-- grants, reservations, photographs and Auth accounts are not rewritten.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 012 before 013_admin_integration.sql.';
  end if;
  if exists (select 1 from (values (1),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) required(version)
    where not exists (select 1 from spotivity_private.migrations applied where applied.version=required.version)) then
    raise exception 'Apply migrations 001 through 012 before 013_admin_integration.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=13)
     and to_regprocedure('public.get_admin_access()') is not null then
    raise exception 'Review the existing unregistered get_admin_access function before migration 013.';
  end if;
end
$prerequisite$;

-- A fresh call reflects approvals and revocations without signing in again.
-- Neither user-editable Auth metadata nor an email supplied by the browser
-- participates in authorization. Base presentation rights and court rights
-- deliberately remain independent, including for partially allocated bases.
create or replace function public.get_admin_access()
returns jsonb language sql stable security definer set search_path='' as $$
  with administrator as (
    select a.nume_admin, a.is_super is true as is_super
    from public.users_admin a where a.user_id=(select auth.uid())
  ), courts as (
    select t.id::text as id, t.nume, t.baza_sportiva_id
    from public.terenuri t where spotivity_private.manages_court(t.nume)
  ), bases as (
    select b.id, b.nume, b.oras, b.descriere, b.poza, b.este_activa,
      spotivity_private.manages_base(b.id) as can_edit_details
    from public.baze_sportive b
    where spotivity_private.manages_base(b.id)
      or exists(select 1 from courts c where c.baza_sportiva_id=b.id)
  )
  select jsonb_build_object(
    'is_super', coalesce((select a.is_super from administrator a),false),
    'nume_admin', (select a.nume_admin from administrator a),
    'can_manage', coalesce((select a.is_super from administrator a),false)
      or exists(select 1 from courts) or exists(select 1 from bases),
    'courts', coalesce((select jsonb_agg(to_jsonb(c) order by c.nume,c.id) from courts c),'[]'::jsonb),
    'bases', coalesce((select jsonb_agg(to_jsonb(b) order by b.nume,b.id) from bases b),'[]'::jsonb)
  )
$$;
comment on function public.get_admin_access() is
  'Current Auth UUID administration scope. Base description/photo grants do not grant court, booking, client or chat access.';
revoke all on function public.get_admin_access() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_access() to authenticated;

-- Keep the managed permissive policies and existing column/trigger guards.
-- Restrictive counterparts prevent another permissive policy from silently
-- reopening global actions or data outside the current court/base allocation.
do $boundaries$
declare rule record; policy_name text; statement text;
begin
  for rule in select * from (values
    ('users_admin','select','user_id=(select auth.uid()) or (select spotivity_private.is_super_admin())',null),
    ('users_admin','insert',null,'(select spotivity_private.is_super_admin())'),
    ('users_admin','update','(select spotivity_private.is_super_admin())','(select spotivity_private.is_super_admin())'),
    ('users_admin','delete','(select spotivity_private.is_super_admin())',null),
    ('baze_sportive_admini','select','user_id=(select auth.uid()) or (select spotivity_private.is_super_admin())',null),
    ('baze_sportive_admini','insert',null,'(select spotivity_private.is_super_admin())'),
    ('baze_sportive_admini','update','(select spotivity_private.is_super_admin())','(select spotivity_private.is_super_admin())'),
    ('baze_sportive_admini','delete','(select spotivity_private.is_super_admin())',null),
    ('baze_sportive','select','spotivity_private.manages_base(id) or (este_activa is true and exists(select 1 from public.terenuri t where t.baza_sportiva_id=baze_sportive.id and t.este_activ is not false))',null),
    ('baze_sportive','insert',null,'(select spotivity_private.is_super_admin())'),
    ('baze_sportive','update','spotivity_private.manages_base(id)','spotivity_private.manages_base(id)'),
    ('baze_sportive','delete','(select spotivity_private.is_super_admin())',null),
    ('terenuri','select','este_activ is not false or spotivity_private.manages_court(nume)',null),
    ('terenuri','insert',null,'(select spotivity_private.is_super_admin())'),
    ('terenuri','update','spotivity_private.manages_court(nume)','spotivity_private.manages_court(nume)'),
    ('terenuri','delete','(select spotivity_private.is_super_admin())',null),
    ('rezervari','select','client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)',null),
    ('rezervari','insert',null,'client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)'),
    ('rezervari','update','client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)','client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)'),
    ('rezervari','delete','spotivity_private.manages_court(teren)',null),
    ('mesaje_chat','select','client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)',null),
    ('mesaje_chat','insert',null,'client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)'),
    ('mesaje_chat','update','client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)','client_user_id=(select auth.uid()) or spotivity_private.manages_court(teren)'),
    ('mesaje_chat','delete','spotivity_private.manages_court(teren)',null),
    ('clienti','select','spotivity_private.can_read_client(user_id)',null),
    ('clienti','insert',null,'(select spotivity_private.is_super_admin())'),
    ('clienti','update','user_id=(select auth.uid())','user_id=(select auth.uid())'),
    ('clienti','delete','(select spotivity_private.is_super_admin())',null),
    ('site_sporturi','insert',null,'(select spotivity_private.is_super_admin())'),
    ('site_sporturi','update','(select spotivity_private.is_super_admin())','(select spotivity_private.is_super_admin())'),
    ('site_sporturi','delete','(select spotivity_private.is_super_admin())',null)
  ) definitions(table_name,command_name,using_expression,check_expression)
  loop
    execute format('alter table public.%I enable row level security',rule.table_name);
    policy_name:='spotivity_boundary_'||rule.table_name||'_'||rule.command_name;
    execute format('drop policy if exists %I on public.%I',policy_name,rule.table_name);
    statement:=format('create policy %I on public.%I as restrictive for %s to authenticated',policy_name,rule.table_name,rule.command_name);
    if rule.using_expression is not null then statement:=statement||' using ('||rule.using_expression||')'; end if;
    if rule.check_expression is not null then statement:=statement||' with check ('||rule.check_expression||')'; end if;
    execute statement;
  end loop;
end
$boundaries$;

-- 007 already forbids cancellation, including changing the time in that same
-- request. Close the two-request reschedule-then-cancel and direct DELETE
-- alternatives as well. Keep 007's trigger intact and retain trusted service
-- maintenance without an Auth subject. No historical reservation is edited.
create or replace function spotivity_private.guard_completed_booking_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and old.stare='activa'
     and old.starts_at+interval '1 hour'<=statement_timestamp() then
    if tg_op='DELETE' then
      raise exception 'Completed bookings cannot be removed.';
    end if;
    if (new.stare,new.data_str,new.ora,new.starts_at) is distinct from
       (old.stare,old.data_str,old.ora,old.starts_at) then
      raise exception 'Completed bookings cannot be cancelled or rescheduled.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
drop trigger if exists spotivity_booking_history_guard on public.rezervari;
create trigger spotivity_booking_history_guard before update or delete on public.rezervari
for each row execute function spotivity_private.guard_completed_booking_history();
revoke all on function spotivity_private.guard_completed_booking_history() from public,anon,authenticated,service_role;

insert into spotivity_private.migrations(version) values(13) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
