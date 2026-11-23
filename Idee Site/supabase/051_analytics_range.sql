-- 051: "Analitice" for any period and any court (owner's request, 23.11.2026:
-- "selectarea perioadei să se deschidă mai multe, ca la oraș, și pentru
-- fiecare teren, inclusiv toate, pentru fiecare administrator cu terenul lui").
--  * public.admin_analytics_range(p_from date, p_to date, p_court text):
--    counts between two Romanian calendar days (inclusive), optionally for one
--    court, plus the window of the same length just before, a series per day
--    (or per month for ranges longer than 62 days) and the courts the caller
--    may pick. p_from null = from the first recorded activity ("Total").
--    The superadmin may pick any court and also sees new/active accounts; an
--    administrator only their own courts (anything else is refused).
--  * The counting rules are the ones of admin_analytics() (050), moved into
--    spotivity_private.analytics_events()/analytics_courts(). 050 is unchanged.
-- Additive only. Safe to re-run. Apply as postgres.
begin;
do $prerequisite$
begin
 if not exists(select 1 from spotivity_private.migrations where version=50) then raise exception 'Apply 050 before 051.'; end if;
 if exists(select 1 from spotivity_private.migrations where version>51) then raise exception '051 is superseded; do not reapply.'; end if;
end
$prerequisite$;

-- Every court that has or had bookings, with its sport and city.
create or replace function spotivity_private.analytics_courts()
returns table(court text,sport text,oras text,active boolean)
language sql stable security definer set search_path='' as $$
 select t.nume,t.sport,t.oras,coalesce(t.este_activ,true) from public.terenuri t where t.nume is not null
 union
 select distinct r.teren,null::text,null::text,false from public.rezervari r
  where r.teren is not null and coalesce(r.email_client,'')<>'Teren Blocat'
    and not exists(select 1 from public.terenuri t where t.nume=r.teren)
$$;
revoke all on function spotivity_private.analytics_courts() from public,anon,authenticated,service_role;

-- One row per counted event: what, on which court, when, and the key that is
-- counted once (a booking group, or a customer for "active_clients").
create or replace function spotivity_private.analytics_events(p_now timestamptz)
returns table(kind text,court text,ts timestamptz,ekey text)
language sql stable security definer set search_path='' as $$
 with slots as(
  select r.teren court,r.stare,r.starts_at,r.id::text rid,
   coalesce(r.booking_group_id::text,l.booking_id::text,'r'||r.id::text) bkey,
   coalesce(r.client_user_id::text,lower(btrim(r.email_client))) customer,
   coalesce(g.created_at,r.created_at::timestamptz) created
  from public.rezervari r
  left join spotivity_private.legacy_attendance_bookings l on r.booking_group_id is null and l.reservation_id=r.id::text
  left join spotivity_private.booking_groups g on g.id=r.booking_group_id
  where coalesce(r.email_client,'')<>'Teren Blocat' and r.teren is not null
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
  group by s.court,s.bkey having max(s.starts_at)+interval '1 hour'<=p_now
 ), noshow as(
  select e.court,e.bkey,e.ts from ended e join spotivity_private.booking_attendance a
   on a.booking_id::text=e.bkey and a.status='no_show'
 )
 select 'bookings',court,ts,bkey from booked
 union all select 'active_clients',court,ts,customer from booked where customer is not null
 union all select 'cancelled',court,ts,bkey from cancelled
 union all select 'late',e.court_name,e.cancelled_at,e.booking_id::text from spotivity_private.late_cancellation_events e
 union all select 'present',e.court,e.ts,e.bkey from ended e where not exists(select 1 from noshow n where n.bkey=e.bkey)
 union all select 'no_show',court,ts,bkey from noshow
$$;
revoke all on function spotivity_private.analytics_events(timestamptz) from public,anon,authenticated,service_role;

create or replace function public.admin_analytics_range(p_from date default null,p_to date default null,p_court text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 now_at timestamptz:=statement_timestamp();
 v_today date:=(statement_timestamp() at time zone 'Europe/Bucharest')::date;
 v_super boolean;v_from date;v_to date;v_len integer;v_pfrom date;v_pto date;v_bucket text;
 v_court text:=nullif(btrim(coalesce(p_court,'')),'');result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.users_admin where user_id=auth.uid()) then
  raise exception 'Administrators only.' using errcode='42501';
 end if;
 v_super:=spotivity_private.is_super_admin();
 if v_court is not null and not (v_super or spotivity_private.manages_court(v_court)) then
  raise exception 'Court not allowed.' using errcode='42501';
 end if;
 v_to:=least(coalesce(p_to,v_today),v_today);
 if p_from is null then
  -- "Total": from the first recorded activity in the caller's scope.
  select least(min((e.ts at time zone 'Europe/Bucharest')::date),
   case when v_super and v_court is null then (select min((u.created_at at time zone 'Europe/Bucharest')::date) from auth.users u) end)
  into v_from
  from spotivity_private.analytics_events(now_at) e
  where (v_court is null or e.court=v_court) and (v_super or spotivity_private.manages_court(e.court));
  v_from:=least(coalesce(v_from,v_to),v_to);
 else
  v_from:=p_from;
  if v_from>v_to then raise exception 'invalid_range' using errcode='22023'; end if;
  v_len:=v_to-v_from+1;
  v_pto:=v_from-1;v_pfrom:=v_from-v_len;
 end if;
 v_bucket:=case when v_to-v_from+1<=62 then 'day' else 'month' end;

 with sc as(
  select c.* from spotivity_private.analytics_courts() c where v_super or spotivity_private.manages_court(c.court)
 ), pick as(
  select * from sc where v_court is null or sc.court=v_court
 ), ev as(
  select e.kind,e.court,e.ekey,(e.ts at time zone 'Europe/Bucharest')::date d
  from spotivity_private.analytics_events(now_at) e join pick p on p.court=e.court
  where (e.ts at time zone 'Europe/Bucharest')::date between coalesce(v_pfrom,v_from) and v_to
 ), cur as(
  select * from ev where ev.d between v_from and v_to
 ), kinds(kind) as(
  values('bookings'),('active_clients'),('cancelled'),('late'),('present'),('no_show')
 ), buckets as(
  select g::date b from generate_series(
   case when v_bucket='day' then v_from else date_trunc('month',v_from)::date end,
   v_to::timestamp,case when v_bucket='day' then interval '1 day' else interval '1 month' end) g
 ), counted as(
  select cur.kind,case when v_bucket='day' then cur.d else date_trunc('month',cur.d)::date end b,count(distinct cur.ekey)::integer n
  from cur group by 1,2
 ), users_in as(
  select (u.created_at at time zone 'Europe/Bucharest')::date d,u.last_sign_in_at from auth.users u
 )
 select jsonb_build_object(
  'generated_at',now_at,
  'today',v_today,
  'from',v_from,
  'to',v_to,
  'previous',case when v_pfrom is null then null else jsonb_build_object('from',v_pfrom,'to',v_pto) end,
  'bucket',v_bucket,
  'buckets',(select jsonb_agg(b order by b) from buckets),
  'scope',case when v_super then 'all' else 'own' end,
  'court',v_court,
  'court_options',coalesce((select jsonb_agg(jsonb_build_object('court',sc.court,'sport',sc.sport,'city',sc.oras,'active',sc.active) order by sc.active desc,sc.sport nulls last,sc.court) from sc),'[]'::jsonb),
  'totals',(select jsonb_object_agg(k.kind,jsonb_build_object(
    'n',(select count(distinct cur.ekey) from cur where cur.kind=k.kind),
    'p',case when v_pfrom is null then null else (select count(distinct ev.ekey) from ev where ev.kind=k.kind and ev.d between v_pfrom and v_pto) end,
    'series',(select jsonb_agg(coalesce(c.n,0) order by b.b) from buckets b left join counted c on c.kind=k.kind and c.b=b.b)))
   from kinds k),
  'courts',coalesce((select jsonb_agg(jsonb_build_object('court',p.court,'sport',p.sport,'city',p.oras,'active',p.active,
    'stats',(select jsonb_object_agg(k.kind,(select count(distinct cur.ekey) from cur where cur.kind=k.kind and cur.court=p.court)) from kinds k))
    order by p.active desc,p.court) from pick p),'[]'::jsonb),
  -- Accounts belong to the whole site, not to a court: superadmin only.
  'users',case when v_super then jsonb_build_object(
    'n',(select count(*) from users_in where users_in.d between v_from and v_to),
    'p',case when v_pfrom is null then null else (select count(*) from users_in where users_in.d between v_pfrom and v_pto) end,
    'series',(select jsonb_agg((select count(*) from users_in where case when v_bucket='day' then users_in.d=b.b else date_trunc('month',users_in.d)::date=b.b end) order by b.b) from buckets b)) end,
  'active_users',case when v_super then jsonb_build_object(
    'n',(select count(*) from users_in where (users_in.last_sign_in_at at time zone 'Europe/Bucharest')::date between v_from and v_to)) end)
 into result;
 return result;
end
$$;
revoke all on function public.admin_analytics_range(date,date,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_analytics_range(date,date,text) to authenticated;

insert into spotivity_private.migrations(version) values(51) on conflict(version) do nothing;
commit;
