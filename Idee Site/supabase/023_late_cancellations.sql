-- Private review of customer-initiated late cancellations. No booking rule,
-- account status, reservation history or owner allocation is changed.
begin;
do $prerequisite$
begin
  if to_regclass('spotivity_private.booking_groups') is null
    or not exists(select 1 from spotivity_private.migrations where version=16) then
    raise exception 'Apply booking groups and notification outbox before migration 023.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=23)
    and to_regprocedure('spotivity_private.cancel_booking_group_internal_v14(uuid)') is not null then
    raise exception 'Review unregistered late-cancellation wrapper before applying migration 023.';
  end if;
end
$prerequisite$;

create table if not exists spotivity_private.late_cancellation_events(
  booking_id uuid primary key,
  customer_user_id uuid,
  customer_email text not null,
  customer_name text not null,
  customer_phone text,
  court_name text not null,
  booking_day date not null,
  first_cancelled_start timestamptz not null,
  cancelled_at timestamptz not null,
  lead_seconds integer not null check(lead_seconds<3600)
);
alter table spotivity_private.late_cancellation_events enable row level security;
revoke all on spotivity_private.late_cancellation_events from public,anon,authenticated,service_role;
create index if not exists spotivity_late_cancellation_recent
  on spotivity_private.late_cancellation_events(cancelled_at,lower(btrim(customer_email)));

-- Existing public cancellation wrappers first authorize the real Auth owner or
-- verify the private email capability. A scoped marker survives the original
-- implementation temporarily clearing Auth claims. Staff row updates never
-- acquire this marker and cannot be blamed on the customer.
do $wrap$
begin
  if to_regprocedure('spotivity_private.cancel_booking_group_internal_v14(uuid)') is null then
    alter function spotivity_private.cancel_booking_group_internal(uuid)
      rename to cancel_booking_group_internal_v14;
  end if;
end
$wrap$;
create or replace function spotivity_private.cancel_booking_group_internal(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_marker text; result jsonb; permitted boolean;
begin
  previous_marker:=current_setting('spotivity.client_cancellation_booking',true);
  select auth.uid() is null or owner_auth_id=auth.uid() into permitted
    from spotivity_private.booking_groups where id=p_booking_id;
  perform set_config('spotivity.client_cancellation_booking',
    case when permitted then p_booking_id::text else '' end,true);
  begin
    result:=spotivity_private.cancel_booking_group_internal_v14(p_booking_id);
  exception when others then
    perform set_config('spotivity.client_cancellation_booking',coalesce(previous_marker,''),true);
    raise;
  end;
  perform set_config('spotivity.client_cancellation_booking',coalesce(previous_marker,''),true);
  return result;
end
$$;

create or replace function spotivity_private.record_late_customer_cancellations()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into spotivity_private.late_cancellation_events(
    booking_id,customer_user_id,customer_email,customer_name,customer_phone,
    court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds)
  select b.id,b.owner_auth_id,lower(btrim(b.contact_email)),b.contact_name,b.contact_phone,
    b.court_name,b.booking_day,min(n.starts_at),statement_timestamp(),
    floor(extract(epoch from min(n.starts_at)-statement_timestamp()))::integer
  from spotivity_late_new_rows n join spotivity_late_old_rows o on o.id=n.id
    join spotivity_private.booking_groups b on b.id=n.booking_group_id
  where n.stare='anulata' and o.stare='activa' and b.sealed
    and current_setting('spotivity.client_cancellation_booking',true)=b.id::text
    and n.starts_at<statement_timestamp()+interval '1 hour'
    and n.starts_at+interval '1 hour'>statement_timestamp()
  group by b.id
  on conflict(booking_id) do nothing;
  return null;
end
$$;
drop trigger if exists spotivity_late_customer_cancellations on public.rezervari;
create trigger spotivity_late_customer_cancellations after update on public.rezervari
  referencing old table as spotivity_late_old_rows new table as spotivity_late_new_rows
  for each statement execute function spotivity_private.record_late_customer_cancellations();

create or replace function public.list_late_cancellations(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.users_admin a
    join auth.users u on u.id=a.user_id where a.user_id=auth.uid()
      and a.is_super is true and u.email_confirmed_at is not null) then
    raise exception 'Only the site superadmin can review late cancellations.' using errcode='42501';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Review period must be between 1 and 365 days.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(row_data order by (row_data->>'count')::integer desc,
    row_data->>'last_cancelled_at' desc),'[]'::jsonb) into result from (
    select jsonb_build_object('email',lower(btrim(customer_email)),
      'name',(array_agg(customer_name order by cancelled_at desc,booking_id))[1],
      'phone',(array_agg(customer_phone order by cancelled_at desc,booking_id))[1],
      'count',count(*)::integer,'frequent',count(*)>=3,
      'last_cancelled_at',max(cancelled_at),'last_court',
        (array_agg(court_name order by cancelled_at desc,booking_id))[1],
      'events',jsonb_agg(jsonb_build_object('booking_id',booking_id,'court_name',court_name,
        'booking_day',booking_day,'starts_at',first_cancelled_start,'cancelled_at',cancelled_at,
        'lead_minutes',floor(lead_seconds/60.0)::integer) order by cancelled_at desc,booking_id)
    ) as row_data from spotivity_private.late_cancellation_events
    where cancelled_at>=statement_timestamp()-make_interval(days=>p_days)
    group by lower(btrim(customer_email))
  ) customers;
  return jsonb_build_object('days',p_days,'frequent_threshold',3,'customers',result,
    'automatic_restrictions',false);
end
$$;
revoke all on function spotivity_private.cancel_booking_group_internal(uuid),
  spotivity_private.cancel_booking_group_internal_v14(uuid),
  spotivity_private.record_late_customer_cancellations()
  from public,anon,authenticated,service_role;
revoke all on function public.list_late_cancellations(integer) from public,anon,authenticated,service_role;
grant execute on function public.list_late_cancellations(integer) to authenticated;
comment on table spotivity_private.late_cancellation_events is
  'Private customer-initiated late cancellation audit; once per booking, no automatic ban, no historical backfill. Staff cancellations are excluded.';
insert into spotivity_private.migrations(version) values(23) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
