-- Allow verified court administrators to review only their current courts.
-- Customer audit rows, bookings, cancellation rules and allocations stay intact.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.late_cancellation_events') is null
    or to_regclass('spotivity_private.booking_groups') is null
    or not exists(select 1 from spotivity_private.migrations where version=23) then
    raise exception 'Apply migration 023 before migration 025.';
  end if;
  if not exists(select 1 from pg_proc p
    where p.oid=to_regprocedure('public.list_late_cancellations(integer)')
      and p.prosecdef and p.provolatile='s' and p.prorettype='jsonb'::regtype
      and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
      and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
        case when exists(select 1 from spotivity_private.migrations where version=25)
          then '09b25bfd0655ae4e5664e2be62eeb10c' else 'd7148efe7c981978c794b9a835856a91' end) then
    raise exception 'Review the current late-cancellation RPC before applying migration 025.';
  end if;
end
$prerequisite$;

create or replace function public.list_late_cancellations(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; can_review_all boolean;
begin
  select a.is_super is true into can_review_all
  from public.users_admin a join auth.users u on u.id=a.user_id
  where a.user_id=auth.uid() and u.email_confirmed_at is not null;
  if not found then
    raise exception 'Only a verified administrator can review late cancellations.' using errcode='42501';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Review period must be between 1 and 365 days.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(row_data order by (row_data->>'count')::integer desc,
    row_data->>'last_cancelled_at' desc),'[]'::jsonb) into result from (
    select jsonb_build_object('email',lower(btrim(e.customer_email)),
      'name',(array_agg(e.customer_name order by e.cancelled_at desc,e.booking_id))[1],
      'phone',(array_agg(e.customer_phone order by e.cancelled_at desc,e.booking_id))[1],
      'count',count(*)::integer,'frequent',count(*)>=3,
      'last_cancelled_at',max(e.cancelled_at),'last_court',
        (array_agg(e.court_name order by e.cancelled_at desc,e.booking_id))[1],
      'events',jsonb_agg(jsonb_build_object('booking_id',e.booking_id,'court_name',e.court_name,
        'booking_day',e.booking_day,'starts_at',e.first_cancelled_start,'cancelled_at',e.cancelled_at,
        'lead_minutes',floor(e.lead_seconds/60.0)::integer) order by e.cancelled_at desc,e.booking_id)
    ) as row_data from spotivity_private.late_cancellation_events e
    where e.cancelled_at>=statement_timestamp()-make_interval(days=>p_days)
      and (can_review_all or exists(
        -- Resolve the stable booking court ID first. Reusing a deleted court's
        -- display name must never grant access to its former customers.
        select 1 from spotivity_private.booking_groups b
        join public.terenuri t on t.id::text=b.court_id
        where b.id=e.booking_id and spotivity_private.manages_court(t.nume)
      ))
    group by lower(btrim(e.customer_email))
  ) customers;
  return jsonb_build_object('days',p_days,'frequent_threshold',3,'customers',result,
    'scope',case when can_review_all then 'all' else 'assigned_courts' end,
    'automatic_restrictions',false);
end
$$;
revoke all on function public.list_late_cancellations(integer) from public,anon,authenticated,service_role;
grant execute on function public.list_late_cancellations(integer) to authenticated;
comment on function public.list_late_cancellations(integer) is
  'Verified current Auth administrator; superadmin sees all events, other admins only current assigned court IDs. Counts and contact snapshots are scoped before aggregation.';
insert into spotivity_private.migrations(version) values(25) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
