-- Administrator attendance, one incident per booking, and private email snapshots.
-- Apply once after 033. No existing attendance is inferred; no historical emails are queued.
begin;
do $guard$
declare item record;
begin
 if not exists(select 1 from spotivity_private.migrations where version=33) then raise exception 'Apply 033 before 034.'; end if;
 if exists(select 1 from spotivity_private.migrations where version>=34) then raise exception '034 already applied or superseded; do not reapply.'; end if;
 if to_regclass('spotivity_private.booking_attendance') is not null or to_regclass('spotivity_private.booking_attendance_events') is not null or to_regprocedure('spotivity_private.notification_payload_v33(uuid)') is not null then raise exception 'Review unregistered attendance objects.'; end if;
 for item in select * from (values
  ('spotivity_private.record_late_customer_cancellations()','9a798695fefbc2b924227bc9a2d3cb34'),
  ('public.list_late_cancellations(integer)','43628efd8eb1144e7f7c9f43a8197fc7'),
  ('spotivity_private.notification_payload(uuid)','8695dfd5a2791856ae03d80421d05d73'),
  ('public.claim_booking_notifications(integer,integer,uuid,text[])','487030d063f9152635d56132d14e6310')
 ) expected(signature,hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature) and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[] and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=item.hash) then raise exception 'Review % before 034.',item.signature; end if;
 end loop;
end
$guard$;
create table spotivity_private.booking_attendance(
 booking_id uuid primary key references spotivity_private.booking_groups(id) on delete cascade,
 status text not null check(status in ('present','no_show')), revision integer not null check(revision>0),
 customer_user_id uuid,customer_email text not null,customer_name text,customer_phone text,
 court_name text not null,booking_day date not null,starts_at timestamptz not null,
 marked_by uuid not null,marked_at timestamptz not null default statement_timestamp()
);
create table spotivity_private.booking_attendance_events(
 id uuid primary key default gen_random_uuid(),booking_id uuid not null references spotivity_private.booking_groups(id) on delete cascade,
 revision integer not null check(revision>0),status text not null check(status in ('present','no_show')),
 customer_user_id uuid,customer_email text not null,total_count integer not null check(total_count>=0),
 marked_by uuid not null,marked_at timestamptz not null default statement_timestamp(),unique(booking_id,revision)
);
alter table spotivity_private.booking_attendance enable row level security;
alter table spotivity_private.booking_attendance_events enable row level security;
revoke all on spotivity_private.booking_attendance,spotivity_private.booking_attendance_events from public,anon,authenticated,service_role;
create index spotivity_attendance_account on spotivity_private.booking_attendance(customer_user_id) where status='no_show' and customer_user_id is not null;
create index spotivity_attendance_guest on spotivity_private.booking_attendance(lower(btrim(customer_email))) where status='no_show' and customer_user_id is null;
-- One booking contributes one current incident, even after a partial late cancellation.
-- Correcting attendance restores a pre-existing late cancellation instead of deleting it.
create view spotivity_private.booking_incidents as
 select e.booking_id,e.customer_user_id,e.customer_email,e.customer_name,e.customer_phone,e.court_name,e.booking_day,
 e.first_cancelled_start,e.cancelled_at,e.lead_seconds,'late_cancellation'::text kind
 from spotivity_private.late_cancellation_events e
 where not exists(select 1 from spotivity_private.booking_attendance a where a.booking_id=e.booking_id and a.status='no_show')
 union all
 select a.booking_id,a.customer_user_id,a.customer_email,a.customer_name,a.customer_phone,a.court_name,a.booking_day,
 a.starts_at,a.marked_at,null::integer,'no_show'::text
 from spotivity_private.booking_attendance a where a.status='no_show';
revoke all on spotivity_private.booking_incidents from public,anon,authenticated,service_role;
create function spotivity_private.booking_incident_count(p_user uuid,p_email text)
returns integer language sql volatile security definer set search_path='' as $$
 select count(*)::integer from spotivity_private.booking_incidents e
 where (p_user is not null and e.customer_user_id=p_user)
 or (p_user is null and e.customer_user_id is null and lower(btrim(e.customer_email))=lower(btrim(p_email)))
$$;
create function public.get_booking_attendance(p_booking_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare super boolean; result jsonb;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can review attendance.' using errcode='42501'; end if;
 if p_booking_ids is null or cardinality(p_booking_ids)>500 then raise exception 'Provide at most 500 bookings.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('booking_id',b.id,'status',coalesce(a.status,'unmarked'),'revision',coalesce(a.revision,0),
 'marked_at',a.marked_at,'can_mark',exists(select 1 from public.rezervari r where r.booking_group_id=b.id and r.stare='activa' and r.email_client<>'Teren Blocat')
 and not exists(select 1 from public.rezervari r where r.booking_group_id=b.id and r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp()))),'[]'::jsonb)
 into result from spotivity_private.booking_groups b left join spotivity_private.booking_attendance a on a.booking_id=b.id
 where b.sealed and b.id=any(p_booking_ids) and (super or exists(select 1 from public.terenuri t where t.id::text=b.court_id and spotivity_private.manages_court(t.nume)));
 return result;
end
$$;
create function public.set_booking_attendance(p_booking_id uuid,p_status text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b spotivity_private.booking_groups%rowtype; a spotivity_private.booking_attendance%rowtype;
 super boolean; identity_user uuid; identity_email text; first_start timestamptz; hours text[]; new_revision integer; total integer; event_id uuid; notify boolean;
begin
 select u.is_super is true into super from public.users_admin u join auth.users au on au.id=u.user_id where u.user_id=auth.uid() and au.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can record attendance.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('present','no_show') or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid attendance choice.' using errcode='22023'; end if;
 select * into b from spotivity_private.booking_groups where id=p_booking_id and sealed for update;
 if not found or not(super or exists(select 1 from public.terenuri t where t.id::text=b.court_id and spotivity_private.manages_court(t.nume))) then raise exception 'Booking unavailable or outside your courts.' using errcode='42501'; end if;
 select array_agg(r.ora order by r.starts_at),min(r.starts_at) into hours,first_start from public.rezervari r where r.booking_group_id=b.id and r.stare='activa' and r.email_client<>'Teren Blocat';
 if hours is null or exists(select 1 from public.rezervari r where r.booking_group_id=b.id and r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp()) then raise exception 'Attendance can be recorded only after the entire reservation has ended.' using errcode='22023'; end if;
 select * into a from spotivity_private.booking_attendance where booking_id=b.id;
 if a.status=p_status then return jsonb_build_object('booking_id',b.id,'status',a.status,'revision',a.revision,'changed',false,'email_queued',false); end if;
 if coalesce(a.revision,0)<>p_expected_revision then raise exception 'Attendance changed. Reload the reservation before saving.' using errcode='40001'; end if;
 identity_user:=case when a.booking_id is not null then a.customer_user_id else b.owner_auth_id end;
 identity_email:=case when a.booking_id is not null then a.customer_email else lower(btrim(b.contact_email)) end;
 perform pg_advisory_xact_lock(hashtextextended(case when identity_user is not null then 'account:'||identity_user::text else 'guest:'||identity_email end,33033));
 new_revision:=coalesce(a.revision,0)+1;
 notify:=p_status='no_show' or coalesce(a.status='no_show',false);
 insert into spotivity_private.booking_attendance(booking_id,status,revision,customer_user_id,customer_email,customer_name,customer_phone,court_name,booking_day,starts_at,marked_by,marked_at)
 values(b.id,p_status,new_revision,identity_user,identity_email,b.contact_name,b.contact_phone,b.court_name,b.booking_day,first_start,auth.uid(),statement_timestamp())
 on conflict(booking_id) do update set status=excluded.status,revision=excluded.revision,marked_by=excluded.marked_by,marked_at=excluded.marked_at;
 total:=spotivity_private.booking_incident_count(identity_user,identity_email);
 insert into spotivity_private.booking_attendance_events(booking_id,revision,status,customer_user_id,customer_email,total_count,marked_by)
 values(b.id,new_revision,p_status,identity_user,identity_email,total,auth.uid()) returning id into event_id;
 if notify then
  insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,booking_id,event_hours)
  values('booking_attendance_client',event_id::text,'client',b.id,hours) on conflict do nothing;
  perform spotivity_private.wake_notification_worker();
 end if;
 return jsonb_build_object('booking_id',b.id,'status',p_status,'revision',new_revision,'changed',true,'email_queued',notify);
end
$$;
alter table spotivity_private.late_cancellation_events add column incident_total_count integer check(incident_total_count>=1);

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
    if found then
      update spotivity_private.late_cancellation_events set incident_total_count=
        spotivity_private.booking_incident_count(event.customer_user_id,event.customer_email)
      where booking_id=event.booking_id;
    end if;
  end loop;
  return null;
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
    select e.* from spotivity_private.booking_incidents e
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
      'events',jsonb_agg(jsonb_build_object('booking_id',e.booking_id,'kind',e.kind,'court_name',e.court_name,
        'booking_day',e.booking_day,'starts_at',e.first_cancelled_start,'cancelled_at',e.cancelled_at,
        'lead_minutes',floor(e.lead_seconds/60.0)::integer) order by e.cancelled_at desc,e.booking_id)
    ) as row_data from counted e
    where e.cancelled_at>=statement_timestamp()-make_interval(days=>p_days)
    group by e.customer_user_id,
      case when e.customer_user_id is null then lower(btrim(e.customer_email)) end
  ) customers;
  return jsonb_build_object('days',p_days,'frequent_threshold',3,'customers',result,
    'scope',case when can_review_all then 'all' else 'assigned_courts' end,
    'automatic_restrictions',false,'combined_incidents',true);
end
$$;

alter function spotivity_private.notification_payload(uuid) rename to notification_payload_v33;
create function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare payload jsonb; job spotivity_private.notification_outbox%rowtype; event spotivity_private.booking_attendance_events%rowtype; total integer; email text;
begin
 select * into job from spotivity_private.notification_outbox where id=p_notification_id;
 if not found then return null; end if;
 if job.kind='booking_attendance_client' then
  select e.* into event from spotivity_private.booking_attendance_events e join spotivity_private.booking_attendance a on a.booking_id=e.booking_id and a.revision=e.revision and a.status=e.status
  where e.id::text=job.event_key and e.booking_id=job.booking_id;
  if not found then return null; end if;
  if event.customer_user_id is not null then
   select lower(btrim(u.email)) into email from auth.users u where u.id=event.customer_user_id and u.email_confirmed_at is not null;
   if email is null then return null; end if;
  else email:=event.customer_email; end if;
  payload:=spotivity_private.notification_payload_v33(p_notification_id);
  if payload is null then return null; end if;
  payload:=jsonb_set(payload,'{recipient,email}',to_jsonb(email));
  payload:=jsonb_set(payload,'{booking,hours}',to_jsonb(job.event_hours));
  return payload||jsonb_build_object('attendance',jsonb_build_object('status',event.status,'total_count',event.total_count,'threshold',3,
   'warning','La mai mult de 3 neprezentări sau anulări târzii, riști închiderea contului.'));
 end if;
 payload:=spotivity_private.notification_payload_v33(p_notification_id);
 if job.kind='booking_cancelled_client' and payload is not null then
  select e.incident_total_count into total from spotivity_private.late_cancellation_events e where e.booking_id=job.booking_id and e.notification_event_key=job.event_key;
  if total is not null then payload:=jsonb_set(payload,'{late_cancellation}',(payload->'late_cancellation')||jsonb_build_object('incident_total_count',total)); end if;
 end if;
 return payload;
end
$$;
alter table spotivity_private.notification_outbox drop constraint notification_outbox_kind_check;
alter table spotivity_private.notification_outbox add constraint notification_outbox_kind_check check(kind in (
 'booking_created_client','booking_created_owner','booking_cancelled_client','booking_cancelled_owner','booking_attendance_client','chat_owner','chat_client','account_welcome'));

create or replace function public.claim_booking_notifications(
  p_limit integer default 10,p_lease_seconds integer default 120,p_booking_id uuid default null,
  p_kinds text[] default null
)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare candidate spotivity_private.notification_outbox%rowtype; payload jsonb; lease uuid;
begin
  if p_limit is null or p_limit not between 1 and 20 or p_lease_seconds is null
    or p_lease_seconds not between 30 and 300 or (p_kinds is not null and
      (cardinality(p_kinds)<1 or exists(select 1 from unnest(p_kinds) k
        where k is null or k not in ('booking_created_client','booking_created_owner',
          'booking_cancelled_client','booking_cancelled_owner','chat_owner','chat_client','account_welcome','booking_attendance_client')))) then
    raise exception 'Invalid notification lease parameters.' using errcode='22023';
  end if;
  for candidate in select * from spotivity_private.notification_outbox n
    where ((n.status in ('queued','retry') and n.available_at<=statement_timestamp())
      or (n.status='leased' and n.leased_until<=statement_timestamp()))
      and (p_booking_id is null or n.booking_id=p_booking_id)
      and (p_kinds is null or n.kind=any(p_kinds))
    order by n.created_at,n.id for update skip locked limit p_limit loop
    if candidate.attempts>=8 then
      update spotivity_private.notification_outbox set status='blocked',last_error_code='attempt_limit',
        lease_token=null,leased_until=null,updated_at=statement_timestamp() where id=candidate.id;
      continue;
    end if;
    payload:=spotivity_private.notification_payload(candidate.id);
    if payload is null then
      update spotivity_private.notification_outbox set status='skipped',last_error_code='recipient_or_event_unavailable',
        lease_token=null,leased_until=null,updated_at=statement_timestamp() where id=candidate.id;
      continue;
    end if;
    lease:=gen_random_uuid();
    update spotivity_private.notification_outbox set status='leased',attempts=attempts+1,
      lease_token=lease,leased_until=statement_timestamp()+make_interval(secs=>p_lease_seconds),
      updated_at=statement_timestamp() where id=candidate.id;
    return next payload||jsonb_build_object('lease_token',lease,'attempt',candidate.attempts+1);
  end loop;
end
$$;

revoke all on function spotivity_private.booking_incident_count(uuid,text),spotivity_private.record_late_customer_cancellations(),
 spotivity_private.notification_payload(uuid),spotivity_private.notification_payload_v33(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_booking_attendance(uuid[]),public.set_booking_attendance(uuid,text,integer),public.list_late_cancellations(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_booking_attendance(uuid[]),public.set_booking_attendance(uuid,text,integer),public.list_late_cancellations(integer) to authenticated;
revoke all on function public.claim_booking_notifications(integer,integer,uuid,text[]) from public,anon,authenticated;
grant execute on function public.claim_booking_notifications(integer,integer,uuid,text[]) to service_role;
comment on table spotivity_private.booking_attendance is 'Current administrator-confirmed attendance. No-shows count once per booking; corrections remove only the no-show, preserving any late cancellation.';
comment on table spotivity_private.booking_attendance_events is 'Immutable attendance audit and notification counts. Revisioned notifications prevent duplicate sends and skip superseded unsent reports.';
insert into spotivity_private.migrations(version) values(34);
notify pgrst,'reload schema';
commit;
