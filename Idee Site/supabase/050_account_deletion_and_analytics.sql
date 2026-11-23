-- 050: account deletion and superadmin analytics (owner's request, 23.11.2026).
--  * public.delete_my_account(text): a client deletes their own account from
--    "Profilul meu" or the menu, confirming with their name. Administrator
--    accounts cannot delete themselves.
--  * public.admin_list_accounts(text,integer,integer) and
--    public.admin_delete_account(uuid,text): the superadmin lists and deletes
--    accounts. Another superadmin and the caller's own account are refused.
--  * public.admin_analytics(): bookings, active clients, cancellations, late
--    cancellations, attendance and no-shows per court and in total for the
--    last 7 days, the last 30 days and all time. The superadmin sees every
--    court plus new/active accounts; an administrator only their own courts.
--    Also: the previous 7/30-day window and a day-by-day series (30 days).
-- Deleting an account removes the login, the profile, the admin rights and the
-- base allocations. Bookings, chat messages and statistics stay: their foreign
-- keys are ON DELETE SET NULL. An account with future active bookings is never
-- deleted; those bookings are cancelled first, through the normal flows.
-- A private log records when each booking is cancelled from now on; older
-- cancellations fall back to the late-cancellation time or the booking group's
-- last update. Additive only. Safe to re-run. Apply as postgres.
begin;
do $prerequisite$
begin
 if not exists(select 1 from spotivity_private.migrations where version=49) then raise exception 'Apply 049 before 050.'; end if;
 if exists(select 1 from spotivity_private.migrations where version>50) then raise exception '050 is superseded; do not reapply.'; end if;
end
$prerequisite$;

-- When a booking hour is cancelled. Written by a trigger; nobody reads it directly.
create table if not exists spotivity_private.booking_cancellation_log(
 reservation_id text primary key,
 cancelled_at timestamptz not null default statement_timestamp()
);
alter table spotivity_private.booking_cancellation_log enable row level security;
revoke all on spotivity_private.booking_cancellation_log from public,anon,authenticated,service_role;

create or replace function spotivity_private.log_booking_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into spotivity_private.booking_cancellation_log(reservation_id)
 select n.id::text from spotivity_cancel_new n join spotivity_cancel_old o on o.id=n.id
 where o.stare='activa' and n.stare='anulata'
 on conflict(reservation_id) do nothing;
 return null;
end
$$;
revoke all on function spotivity_private.log_booking_cancellation() from public,anon,authenticated,service_role;
drop trigger if exists zzz_spotivity_cancellation_log on public.rezervari;
create trigger zzz_spotivity_cancellation_log after update on public.rezervari
 referencing old table as spotivity_cancel_old new table as spotivity_cancel_new
 for each statement execute function spotivity_private.log_booking_cancellation();

-- Future active booking hours that still belong to an account.
create or replace function spotivity_private.account_future_bookings(p_user_id uuid)
returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.rezervari r
 where r.client_user_id=p_user_id and r.stare='activa'
   and r.starts_at+interval '1 hour'>statement_timestamp()
$$;
revoke all on function spotivity_private.account_future_bookings(uuid) from public,anon,authenticated,service_role;

create or replace function spotivity_private.delete_account_internal(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare future integer;
begin
 perform 1 from auth.users where id=p_user_id for update;
 if not found then raise exception 'account_not_found' using errcode='P0002'; end if;
 future:=spotivity_private.account_future_bookings(p_user_id);
 if future>0 then
  raise exception 'active_bookings:%',future using errcode='55000',
   hint='Cancel the account''s future bookings first.';
 end if;
 delete from public.baze_sportive_admini where user_id=p_user_id;
 -- Cascades to the profile (clienti), admin rights (users_admin), Auth
 -- identities and sessions; bookings and chat keep their rows with no account.
 delete from auth.users where id=p_user_id;
end
$$;
revoke all on function spotivity_private.delete_account_internal(uuid) from public,anon,authenticated,service_role;

create or replace function spotivity_private.confirm_name_key(p_value text)
returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(translate(btrim(coalesce(p_value,'')),
  'ĂăÂâÎîȘșŞşȚțŢţÁáÉéÍíÓóÖöŐőÚúÜüŰű','AaAaIiSsSsTtTtAaEeIiOoOoOoUuUuUu')),'\s+',' ','g')
$$;
revoke all on function spotivity_private.confirm_name_key(text) from public,anon,authenticated,service_role;

create or replace function public.delete_my_account(p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare me uuid:=auth.uid();expected text;
begin
 if me is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 -- Confirmation: the account's name exactly as "Profilul tău" shows it (the
 -- saved name, or the part of the email before @ when no name is saved).
 -- Case, spaces and Romanian/Hungarian diacritics are ignored.
 select coalesce(nullif(btrim(c.nume),''),split_part(u.email,'@',1)) into expected
 from auth.users u left join public.clienti c on c.user_id=u.id where u.id=me;
 if spotivity_private.confirm_name_key(p_confirm)='' or spotivity_private.confirm_name_key(p_confirm)<>spotivity_private.confirm_name_key(expected) then
  raise exception 'confirmation' using errcode='22023';
 end if;
 if exists(select 1 from public.users_admin where user_id=me) then
  raise exception 'admin_account' using errcode='42501',
   hint='Administrator accounts are deleted by the superadmin.';
 end if;
 perform spotivity_private.delete_account_internal(me);
 return jsonb_build_object('deleted',true);
end
$$;
revoke all on function public.delete_my_account(text) from public,anon,authenticated,service_role;
grant execute on function public.delete_my_account(text) to authenticated;

create or replace function public.admin_list_accounts(p_search text default '',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_search,'')));result jsonb;total integer;
begin
 if auth.uid() is null or not spotivity_private.is_super_admin() then raise exception 'Superadmin only.' using errcode='42501'; end if;
 if char_length(term)>200 then term:=left(term,200); end if;
 p_limit:=least(greatest(coalesce(p_limit,50),1),100);
 p_offset:=greatest(coalesce(p_offset,0),0);
 with accounts as(
  select u.id,lower(u.email) email,u.created_at,u.last_sign_in_at,c.nume,c.telefon,
   case when a.is_super then 'superadmin' when a.user_id is not null then 'admin' else 'client' end as role
  from auth.users u
  left join public.clienti c on c.user_id=u.id
  left join lateral(select x.user_id,bool_or(coalesce(x.is_super,false)) is_super from public.users_admin x where x.user_id=u.id group by x.user_id) a on true
  where term='' or position(term in lower(coalesce(u.email,'')))>0 or position(term in lower(coalesce(c.nume,'')))>0
 )
 select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'email',p.email,'name',p.nume,'phone',p.telefon,'role',p.role,
   'created_at',p.created_at,'last_sign_in_at',p.last_sign_in_at,
   'future_bookings',spotivity_private.account_future_bookings(p.id)) order by p.created_at desc nulls last,p.email)
   filter(where p.rn>p_offset and p.rn<=p_offset+p_limit),'[]'::jsonb)
 into total,result
 from(select accounts.*,row_number() over(order by created_at desc nulls last,email) rn from accounts) p;
 return jsonb_build_object('total',total,'items',result);
end
$$;
revoke all on function public.admin_list_accounts(text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_accounts(text,integer,integer) to authenticated;

create or replace function public.admin_delete_account(p_user_id uuid,p_confirm_email text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare target_email text;
begin
 if auth.uid() is null or not spotivity_private.is_super_admin() then raise exception 'Superadmin only.' using errcode='42501'; end if;
 if p_user_id is null or p_user_id=auth.uid() then raise exception 'own_account' using errcode='42501'; end if;
 select lower(btrim(email)) into target_email from auth.users where id=p_user_id;
 if target_email is null then raise exception 'account_not_found' using errcode='P0002'; end if;
 if target_email<>lower(btrim(coalesce(p_confirm_email,''))) then raise exception 'confirmation' using errcode='22023'; end if;
 if exists(select 1 from public.users_admin where user_id=p_user_id and is_super) then
  raise exception 'superadmin_account' using errcode='42501';
 end if;
 perform spotivity_private.delete_account_internal(p_user_id);
 return jsonb_build_object('deleted',true,'email',target_email);
end
$$;
revoke all on function public.admin_delete_account(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_delete_account(uuid,text) to authenticated;

-- Counts for three windows. A booking is one booking group (several
-- consecutive hours count once); "Teren Blocat" entries are not bookings.
-- The superadmin sees every court plus account totals; an ordinary
-- administrator sees only the courts allocated to them, and no account totals.
create or replace function public.admin_analytics()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare now_at timestamptz:=statement_timestamp();v_d7 timestamptz:=statement_timestamp()-interval '7 days';
 v_d30 timestamptz:=statement_timestamp()-interval '30 days';result jsonb;v_super boolean;
 v_today date:=(statement_timestamp() at time zone 'Europe/Bucharest')::date;
begin
 if auth.uid() is null or not exists(select 1 from public.users_admin where user_id=auth.uid()) then
  raise exception 'Administrators only.' using errcode='42501';
 end if;
 v_super:=spotivity_private.is_super_admin();
 with slots as(
  select r.teren court,r.stare,r.starts_at,r.id::text rid,
   coalesce(r.booking_group_id::text,l.booking_id::text,'r'||r.id::text) bkey,
   coalesce(r.client_user_id::text,lower(btrim(r.email_client))) customer,
   coalesce(g.created_at,r.created_at::timestamptz) created
  from public.rezervari r
  left join spotivity_private.legacy_attendance_bookings l on r.booking_group_id is null and l.reservation_id=r.id::text
  left join spotivity_private.booking_groups g on g.id=r.booking_group_id
  where coalesce(r.email_client,'')<>'Teren Blocat' and r.teren is not null
 ), courts as(
  select t.nume court,t.sport,t.oras,coalesce(t.este_activ,true) active from public.terenuri t where t.nume is not null
  union
  select distinct s.court,null,null,false from slots s
   where not exists(select 1 from public.terenuri t where t.nume=s.court)
 ), scope as(
  select c.* from courts c where v_super or spotivity_private.manages_court(c.court)
 ), booked as(
  select s.court,s.bkey,min(s.created) ts,min(s.customer) customer from slots s group by s.court,s.bkey
 ), cancelled as(
  select s.court,s.bkey,max(coalesce(cl.cancelled_at,lc.cancelled_at,g.updated_at,s.starts_at)) ts
  from slots s
  left join spotivity_private.booking_cancellation_log cl on cl.reservation_id=s.rid
  left join spotivity_private.booking_groups g on g.id::text=s.bkey
  left join spotivity_private.late_cancellation_events lc on lc.booking_id::text=s.bkey
  where s.stare='anulata' group by s.court,s.bkey
 ), ended as(
  select s.court,s.bkey,min(s.starts_at) ts from slots s where s.stare='activa'
  group by s.court,s.bkey having max(s.starts_at)+interval '1 hour'<=now_at
 ), noshow as(
  select e.court,e.bkey,e.ts from ended e join spotivity_private.booking_attendance a
   on a.booking_id::text=e.bkey and a.status='no_show'
 ), events as(
  select 'bookings' kind,court,ts,bkey ekey from booked
  union all select 'active_clients',court,ts,customer from booked where customer is not null
  union all select 'cancelled',court,ts,bkey from cancelled
  union all select 'late',e.court_name,e.cancelled_at,e.booking_id::text from spotivity_private.late_cancellation_events e
  union all select 'present',e.court,e.ts,e.bkey from ended e where not exists(select 1 from noshow n where n.bkey=e.bkey)
  union all select 'no_show',court,ts,bkey from noshow
 ), scoped as(
  select ev.* from events ev join scope c on c.court=ev.court
 ), kinds(kind) as(
  values('bookings'),('active_clients'),('cancelled'),('late'),('present'),('no_show')
 ), windows as(
  select ev.court,ev.kind,
   count(distinct ev.ekey) filter(where ev.ts>=v_d7)::integer d7,
   count(distinct ev.ekey) filter(where ev.ts>=v_d30)::integer d30,
   count(distinct ev.ekey)::integer total
  from scoped ev group by ev.court,ev.kind
 ), per_court as(
  select c.court,c.sport,c.oras,c.active,
   jsonb_object_agg(k.kind,jsonb_build_object('d7',coalesce(w.d7,0),'d30',coalesce(w.d30,0),'all',coalesce(w.total,0))) stats
  from scope c cross join kinds k
  left join windows w on w.court=c.court and w.kind=k.kind
  group by c.court,c.sport,c.oras,c.active
 ), totals as(
  -- Distinct across courts: a client active on two courts counts once.
  select jsonb_object_agg(k.kind,jsonb_build_object(
   'd7',(select count(distinct ev.ekey) from scoped ev where ev.kind=k.kind and ev.ts>=v_d7),
   'd30',(select count(distinct ev.ekey) from scoped ev where ev.kind=k.kind and ev.ts>=v_d30),
   'all',(select count(distinct ev.ekey) from scoped ev where ev.kind=k.kind),
   -- The window just before: compared with d7 / d30 in the charts.
   'p7',(select count(distinct ev.ekey) from scoped ev where ev.kind=k.kind and ev.ts>=v_d7-interval '7 days' and ev.ts<v_d7),
   'p30',(select count(distinct ev.ekey) from scoped ev where ev.kind=k.kind and ev.ts>=v_d30-interval '30 days' and ev.ts<v_d30))) stats
  from kinds k
 ), days as(
  -- The last 30 calendar days in Romania, oldest first, today last.
  select (v_today-g)::date as day from generate_series(0,29) g
 ), daily_counts as(
  select ev.kind,(ev.ts at time zone 'Europe/Bucharest')::date as day,count(distinct ev.ekey)::integer n
  from scoped ev where ev.ts>=now_at-interval '31 days' group by 1,2
 ), daily as(
  select jsonb_object_agg(x.kind,x.series) series from(
   select k.kind,jsonb_agg(coalesce(dc.n,0) order by d.day) series
   from kinds k cross join days d
   left join daily_counts dc on dc.kind=k.kind and dc.day=d.day
   group by k.kind) x
 )
 select jsonb_build_object(
  'generated_at',now_at,
  'scope',case when v_super then 'all' else 'own' end,
  'today',v_today,
  'daily',(select series from daily),
  'users',case when v_super then (select jsonb_build_object('d7',count(*) filter(where u.created_at>=v_d7),'d30',count(*) filter(where u.created_at>=v_d30),'all',count(*),
    'p7',count(*) filter(where u.created_at>=v_d7-interval '7 days' and u.created_at<v_d7),
    'p30',count(*) filter(where u.created_at>=v_d30-interval '30 days' and u.created_at<v_d30),
    'daily',(select jsonb_agg((select count(*) from auth.users x where (x.created_at at time zone 'Europe/Bucharest')::date=(v_today-g)) order by g desc) from generate_series(0,29) g)) from auth.users u) end,
  'active_users',case when v_super then (select jsonb_build_object('d7',count(*) filter(where u.last_sign_in_at>=v_d7),'d30',count(*) filter(where u.last_sign_in_at>=v_d30),'all',count(*) filter(where u.last_sign_in_at is not null)) from auth.users u) end,
  'totals',(select stats from totals),
  'courts',coalesce((select jsonb_agg(jsonb_build_object('court',p.court,'sport',p.sport,'city',p.oras,'active',p.active,'stats',p.stats) order by p.active desc,p.court) from per_court p),'[]'::jsonb))
 into result;
 return result;
end
$$;
revoke all on function public.admin_analytics() from public,anon,authenticated,service_role;
grant execute on function public.admin_analytics() to authenticated;

insert into spotivity_private.migrations(version) values(50) on conflict(version) do nothing;
commit;
