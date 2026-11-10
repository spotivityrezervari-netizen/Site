-- Lifetime late-cancellation counts and an immutable customer-email snapshot.
-- Existing jobs, audit history, reservation rules and account status are untouched.
-- 031 only changes announcements and remains independent of this migration.
begin;

do $guard$
declare item record; applied boolean;
begin
  if not exists(select 1 from spotivity_private.migrations where version=27) then
    raise exception 'Apply 027 before 033.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=32) then
    raise exception 'Apply 032 before 033.';
  end if;
  if exists(select 1 from spotivity_private.migrations where version>33) then
    raise exception 'Migration 033 has been superseded; review before reapplying.';
  end if;
  select exists(select 1 from spotivity_private.migrations where version=33) into applied;
  if not applied and (
    to_regprocedure('spotivity_private.notification_payload_v32(uuid)') is not null
    or exists(select 1 from pg_attribute where attrelid='spotivity_private.late_cancellation_events'::regclass
      and attname in ('total_count','notification_event_key') and not attisdropped)
  ) then
    raise exception 'Review unregistered late-cancellation count objects before 033.';
  end if;
  -- These are normalized function-body hashes, not pg_get_functiondef hashes.
  -- The reviewed hosted definitions and the Git fixture have identical bodies.
  -- Reapplication accepts only the definitions installed by this migration.
  for item in select * from (values
    ('spotivity_private.record_late_customer_cancellations()',
      '14e48c6aeca7933abb4f9b46e0860887','9a798695fefbc2b924227bc9a2d3cb34','v','trigger'),
    ('public.list_late_cancellations(integer)',
      'a142ac3a6bb2cb1a445367c45d9faaca','43628efd8eb1144e7f7c9f43a8197fc7','s','jsonb'),
    ('spotivity_private.notification_payload(uuid)',
      'f1a95c66914764947150a055d7a670b9','8695dfd5a2791856ae03d80421d05d73','s','jsonb'),
    ('spotivity_private.enqueue_booking_cancellations()',
      'c451f1a62cdb7eb492a2c2379839e0ec','c451f1a62cdb7eb492a2c2379839e0ec','v','trigger')
  ) expected(signature,before_hash,after_hash,volatility,result_type) loop
    if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
      and p.proowner='postgres'::regrole and p.prosecdef
      and p.proconfig=array['search_path=""']::text[]
      and p.provolatile::text=item.volatility and p.prorettype=item.result_type::regtype
      and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
        case when applied then item.after_hash else item.before_hash end) then
      raise exception 'Review existing % before migration 033.',item.signature;
    end if;
  end loop;
  if applied and not exists(select 1 from pg_proc p
    where p.oid=to_regprocedure('spotivity_private.notification_payload_v32(uuid)')
      and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='s'
      and p.prorettype='jsonb'::regtype and p.proconfig=array['search_path=""']::text[]
      and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))='f1a95c66914764947150a055d7a670b9') then
    raise exception 'Review the preserved notification renderer before reapplying 033.';
  end if;
  -- The late audit runs after the existing outbox trigger. Its event key must
  -- match that trigger, including when staff previously released another hour.
  if not exists(select 1 from pg_trigger t
    where t.tgrelid='public.rezervari'::regclass and t.tgname='spotivity_booking_cancellation_notifications'
      and not t.tgisinternal and t.tgenabled='O'
      and pg_get_triggerdef(t.oid)='CREATE TRIGGER spotivity_booking_cancellation_notifications AFTER UPDATE ON public.rezervari REFERENCING OLD TABLE AS spotivity_notification_old_rows NEW TABLE AS spotivity_notification_new_rows FOR EACH STATEMENT EXECUTE FUNCTION spotivity_private.enqueue_booking_cancellations()')
    or not exists(select 1 from pg_trigger t
    where t.tgrelid='public.rezervari'::regclass and t.tgname='spotivity_late_customer_cancellations'
      and not t.tgisinternal and t.tgenabled='O'
      and pg_get_triggerdef(t.oid)='CREATE TRIGGER spotivity_late_customer_cancellations AFTER UPDATE ON public.rezervari REFERENCING OLD TABLE AS spotivity_late_old_rows NEW TABLE AS spotivity_late_new_rows FOR EACH STATEMENT EXECUTE FUNCTION spotivity_private.record_late_customer_cancellations()') then
    raise exception 'Review cancellation audit/outbox triggers before migration 033.';
  end if;
end
$guard$;

alter table spotivity_private.late_cancellation_events
  add column if not exists total_count integer check(total_count>=1),
  add column if not exists notification_event_key text;
-- NULL snapshots deliberately preserve legacy audit rows and queued emails.
create index if not exists spotivity_late_cancellation_account_history
  on spotivity_private.late_cancellation_events(customer_user_id) where customer_user_id is not null;
create index if not exists spotivity_late_cancellation_guest_history
  on spotivity_private.late_cancellation_events(lower(btrim(customer_email))) where customer_user_id is null;

create or replace function spotivity_private.record_late_customer_cancellations()
returns trigger language plpgsql security definer set search_path='' as $$
declare event record; fingerprint text;
begin
  for event in
    select b.id as booking_id,b.owner_auth_id as customer_user_id,
      lower(btrim(b.contact_email)) as customer_email,b.contact_name,b.contact_phone,
      b.court_name,b.booking_day,min(n.starts_at) as first_cancelled_start,
      case when b.owner_auth_id is not null then 'account:'||b.owner_auth_id::text
        else 'guest:'||lower(btrim(b.contact_email)) end as identity_key
    from spotivity_late_new_rows n join spotivity_late_old_rows o on o.id=n.id
      join spotivity_private.booking_groups b on b.id=n.booking_group_id
    where n.stare='anulata' and o.stare='activa' and b.sealed
      and (current_setting('spotivity.client_cancellation_booking',true)=b.id::text
        or (auth.uid() is not null and b.owner_auth_id=auth.uid()
          and not spotivity_private.manages_court(o.teren)))
      and n.starts_at<statement_timestamp()+interval '1 hour'
      and n.starts_at+interval '1 hour'>statement_timestamp()
    group by b.id
    order by identity_key,b.id
  loop
    -- Serialize this identity before the separate counting statement. Under
    -- READ COMMITTED it sees a concurrent cancellation committed while waiting.
    -- Account UUIDs and guest mailboxes intentionally occupy different namespaces.
    perform pg_advisory_xact_lock(hashtextextended(event.identity_key,33033));
    select md5(array_to_string(array_agg(r.ora order by r.ora),',')) into fingerprint
      from public.rezervari r where r.booking_group_id=event.booking_id and r.stare='anulata';
    insert into spotivity_private.late_cancellation_events(
      booking_id,customer_user_id,customer_email,customer_name,customer_phone,
      court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds,
      total_count,notification_event_key)
    select event.booking_id,event.customer_user_id,event.customer_email,event.contact_name,event.contact_phone,
      event.court_name,event.booking_day,event.first_cancelled_start,statement_timestamp(),
      floor(extract(epoch from event.first_cancelled_start-statement_timestamp()))::integer,
      count(*)::integer+1,event.booking_id::text||':'||fingerprint
    from spotivity_private.late_cancellation_events e
    where (event.customer_user_id is not null and e.customer_user_id=event.customer_user_id)
      or (event.customer_user_id is null and e.customer_user_id is null
        and lower(btrim(e.customer_email))=event.customer_email)
    on conflict(booking_id) do nothing;
  end loop;
  return null;
end
$$;

do $wrap$
begin
  if to_regprocedure('spotivity_private.notification_payload_v32(uuid)') is null then
    alter function spotivity_private.notification_payload(uuid) rename to notification_payload_v32;
  end if;
end
$wrap$;
create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare payload jsonb; snapshot_count integer;
begin
  payload:=spotivity_private.notification_payload_v32(p_notification_id);
  if payload is null or payload->>'kind'<>'booking_cancelled_client' then return payload; end if;
  select e.total_count into snapshot_count
    from spotivity_private.notification_outbox n
    join spotivity_private.late_cancellation_events e on e.booking_id=n.booking_id
      and e.notification_event_key=n.event_key
    where n.id=p_notification_id and n.kind='booking_cancelled_client' and e.total_count is not null;
  if snapshot_count is null then return payload; end if;
  return payload||jsonb_build_object('late_cancellation',jsonb_build_object(
    'total_count',snapshot_count,'threshold',3,
    'warning','La mai mult de 3 neprezentări, riști închiderea contului.'));
end
$$;

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
  with authorized as materialized (
    select e.* from spotivity_private.late_cancellation_events e
    where can_review_all or exists(
      -- Current stable court IDs scope history before either count is computed.
      select 1 from spotivity_private.booking_groups b
      join public.terenuri t on t.id::text=b.court_id
      where b.id=e.booking_id and spotivity_private.manages_court(t.nume)
    )
  ), counted as (
    select e.*,count(*) over(partition by e.customer_user_id,
      case when e.customer_user_id is null then lower(btrim(e.customer_email)) end)::integer as lifetime_count
    from authorized e
  )
  select coalesce(jsonb_agg(row_data order by (row_data->>'count')::integer desc,
    row_data->>'last_cancelled_at' desc),'[]'::jsonb) into result from (
    select jsonb_build_object('email',(array_agg(lower(btrim(e.customer_email))
      order by e.cancelled_at desc,e.booking_id))[1],
      'identity_kind',case when e.customer_user_id is not null then 'account' else 'guest' end,
      'name',(array_agg(e.customer_name order by e.cancelled_at desc,e.booking_id))[1],
      'phone',(array_agg(e.customer_phone order by e.cancelled_at desc,e.booking_id))[1],
      'count',count(*)::integer,'frequent',count(*)>=3,'total_count',max(e.lifetime_count),
      'last_cancelled_at',max(e.cancelled_at),'last_court',
        (array_agg(e.court_name order by e.cancelled_at desc,e.booking_id))[1],
      'events',jsonb_agg(jsonb_build_object('booking_id',e.booking_id,'court_name',e.court_name,
        'booking_day',e.booking_day,'starts_at',e.first_cancelled_start,'cancelled_at',e.cancelled_at,
        'lead_minutes',floor(e.lead_seconds/60.0)::integer) order by e.cancelled_at desc,e.booking_id)
    ) as row_data from counted e
    where e.cancelled_at>=statement_timestamp()-make_interval(days=>p_days)
    group by e.customer_user_id,
      case when e.customer_user_id is null then lower(btrim(e.customer_email)) end
  ) customers;
  return jsonb_build_object('days',p_days,'frequent_threshold',3,'customers',result,
    'scope',case when can_review_all then 'all' else 'assigned_courts' end,
    'automatic_restrictions',false);
end
$$;

revoke all on function spotivity_private.record_late_customer_cancellations(),
  spotivity_private.notification_payload(uuid),spotivity_private.notification_payload_v32(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.list_late_cancellations(integer) from public,anon,authenticated,service_role;
grant execute on function public.list_late_cancellations(integer) to authenticated;
comment on column spotivity_private.late_cancellation_events.total_count is
  'Immutable all-time customer count at the first late cancellation of this booking; NULL for legacy audit rows. No no-show inference or automatic restriction.';
comment on column spotivity_private.late_cancellation_events.notification_event_key is
  'Exact existing cancellation outbox event for this snapshot. Legacy, later staff and other partial events never inherit the customer warning.';
comment on function public.list_late_cancellations(integer) is
  'Verified admin only. count/frequent/events retain the review period; total_count uses all history authorized by current court IDs, account UUID or separate guest email identity.';
insert into spotivity_private.migrations(version) values(33) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
