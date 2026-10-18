-- Transactional notification outbox. Apply after 014; no mail is sent until
-- a server operator explicitly configures and enables the Make scenarios.
-- The outbox, destinations and recipient lookup are service-only. No tokens or
-- credentials are stored in a notification job. Provider acceptance is recorded
-- as "submitted", never as proof of delivery to a person's mailbox.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null
    or not exists(select 1 from spotivity_private.migrations where version=14) then
    raise exception 'Apply 014_booking_groups.sql before 016_notification_outbox.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=16)
    and (to_regclass('spotivity_private.notification_outbox') is not null
      or to_regclass('spotivity_private.notification_config') is not null) then
    raise exception 'Review existing unregistered notification objects before migration 016.';
  end if;
end
$prerequisite$;

create table if not exists spotivity_private.notification_config(
  singleton boolean primary key default true check(singleton),
  ready boolean not null default false,
  booking_webhook_url text,
  chat_webhook_url text,
  updated_at timestamptz not null default now()
);
insert into spotivity_private.notification_config(singleton) values(true) on conflict do nothing;
alter table spotivity_private.notification_config enable row level security;
revoke all on spotivity_private.notification_config from public,anon,authenticated,service_role;

create table if not exists spotivity_private.notification_outbox(
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('booking_created_client','booking_created_owner',
    'booking_cancelled_client','booking_cancelled_owner','chat_owner')),
  event_key text not null,
  recipient_key text not null,
  recipient_user_id uuid,
  booking_id uuid,
  chat_id text,
  event_hours text[],
  status text not null default 'queued' check(status in ('queued','leased','retry','submitted','blocked','skipped')),
  attempts integer not null default 0 check(attempts>=0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  submitted_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kind,event_key,recipient_key),
  check((kind='chat_owner' and chat_id is not null and booking_id is null)
    or (kind<>'chat_owner' and booking_id is not null and chat_id is null))
);
alter table spotivity_private.notification_outbox enable row level security;
revoke all on spotivity_private.notification_outbox from public,anon,authenticated,service_role;
create index if not exists spotivity_notification_ready on spotivity_private.notification_outbox(available_at,created_at)
  where status in ('queued','retry','leased');

create or replace function spotivity_private.notification_owners(p_court_name text)
returns table(user_id uuid,email text,name text)
language sql stable security definer set search_path='' as $$
  with ordinary as (
    select a.user_id,lower(btrim(u.email)) as email,
      coalesce(nullif(btrim(a.nume_admin),''),split_part(u.email,'@',1)) as name
    from public.users_admin a join auth.users u on u.id=a.user_id
    where a.is_super is not true and u.email_confirmed_at is not null
      and u.email is not null and btrim(u.email)<>''
      and exists(select 1 from unnest(string_to_array(a.terenuri,',')) allocated
        where btrim(allocated)=p_court_name)
  )
  select * from ordinary
  union all
  select a.user_id,lower(btrim(u.email)),
    coalesce(nullif(btrim(a.nume_admin),''),split_part(u.email,'@',1))
  from public.users_admin a join auth.users u on u.id=a.user_id
  where a.is_super is true and u.email_confirmed_at is not null
    and u.email is not null and btrim(u.email)<>'' and not exists(select 1 from ordinary)
$$;

-- Optional pg_net wake-up. The request is queued transactionally by pg_net, so
-- rollback cannot dispatch an event which was never committed. Missing Vault or
-- pg_net leaves durable jobs queued for the service worker/cron to pick up.
create or replace function spotivity_private.wake_notification_worker()
returns void language plpgsql security definer set search_path='' as $$
declare worker_url text; worker_key text;
begin
  if not exists(select 1 from spotivity_private.notification_config where ready)
    or to_regclass('vault.decrypted_secrets') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1'
    into worker_url using 'spotivity_notifications_worker_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1'
    into worker_key using 'spotivity_notifications_service_key';
  if worker_url is null or worker_key is null
    or worker_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/booking-notifications$' then return; end if;
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=5000)'
    using worker_url,jsonb_build_object('action','dispatch'),
      jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_key);
exception when others then
  -- Email transport is asynchronous; a wake-up problem must not undo a booking.
  -- Do not log SQLERRM, since it can include headers or a private webhook URL.
  return;
end
$$;

create or replace function spotivity_private.enqueue_booking_event(
  p_booking_id uuid,p_event_kind text,p_event_key text,p_event_hours text[] default null
)
returns void language plpgsql security definer set search_path='' as $$
declare booking spotivity_private.booking_groups%rowtype; owner record; current_court_name text;
begin
  select * into booking from spotivity_private.booking_groups where id=p_booking_id and sealed;
  if not found then return; end if;
  select nume into current_court_name from public.terenuri where id::text=booking.court_id;
  insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,booking_id,event_hours)
    values(p_event_kind||'_client',p_event_key,'client',booking.id,p_event_hours) on conflict do nothing;
  for owner in select * from spotivity_private.notification_owners(current_court_name) loop
    insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,recipient_user_id,booking_id,event_hours)
      values(p_event_kind||'_owner',p_event_key,owner.user_id::text,owner.user_id,booking.id,p_event_hours) on conflict do nothing;
  end loop;
  perform spotivity_private.wake_notification_worker();
end
$$;
create or replace function spotivity_private.enqueue_booking_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.sealed is true and old.sealed is false then
    perform spotivity_private.enqueue_booking_event(new.id,'booking_created',new.id::text);
  end if;
  return new;
end
$$;
drop trigger if exists spotivity_booking_notification_events on spotivity_private.booking_groups;
create trigger spotivity_booking_notification_events after update on spotivity_private.booking_groups
for each row execute function spotivity_private.enqueue_booking_notifications();

-- The group status may change once for every hourly reservation row. Aggregate
-- cancellation events after the whole UPDATE, using its transition tables, so
-- a three-hour cancellation produces one email per recipient with three hours.
create or replace function spotivity_private.enqueue_booking_cancellations()
returns trigger language plpgsql security definer set search_path='' as $$
declare event record; fingerprint text;
begin
  for event in select n.booking_group_id,array_agg(n.ora order by n.ora) as hours
    from spotivity_notification_new_rows n join spotivity_notification_old_rows o on o.id=n.id
    where n.booking_group_id is not null and n.stare='anulata' and o.stare is distinct from n.stare
    group by n.booking_group_id loop
    select md5(array_to_string(array_agg(r.ora order by r.ora),',')) into fingerprint
      from public.rezervari r where r.booking_group_id=event.booking_group_id and r.stare='anulata';
    perform spotivity_private.enqueue_booking_event(event.booking_group_id,'booking_cancelled',
      event.booking_group_id::text||':'||fingerprint,event.hours);
  end loop;
  return null;
end
$$;
drop trigger if exists spotivity_booking_cancellation_notifications on public.rezervari;
create trigger spotivity_booking_cancellation_notifications after update on public.rezervari
referencing old table as spotivity_notification_old_rows new table as spotivity_notification_new_rows
for each statement execute function spotivity_private.enqueue_booking_cancellations();

create or replace function spotivity_private.enqueue_chat_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner record;
begin
  if new.expeditor is distinct from 'client' then return new; end if;
  for owner in select * from spotivity_private.notification_owners(new.teren) loop
    insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,recipient_user_id,chat_id)
      values('chat_owner',new.id::text,owner.user_id::text,owner.user_id,new.id::text) on conflict do nothing;
  end loop;
  perform spotivity_private.wake_notification_worker();
  return new;
end
$$;
drop trigger if exists spotivity_chat_notification_events on public.mesaje_chat;
create trigger spotivity_chat_notification_events after insert on public.mesaje_chat
for each row execute function spotivity_private.enqueue_chat_notifications();

create or replace function public.get_booking_notification_config()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('ready',ready,'booking_webhook_url',booking_webhook_url,
    'chat_webhook_url',chat_webhook_url) from spotivity_private.notification_config where singleton
$$;
create or replace function public.booking_notification_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('ready',coalesce((select ready and booking_webhook_url is not null
    from spotivity_private.notification_config where singleton),false))
$$;
create or replace function public.configure_booking_notifications(
  p_booking_webhook_url text,p_chat_webhook_url text,p_ready boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_ready is null or (p_ready and p_booking_webhook_url is null)
    or exists(select 1 from unnest(array[p_booking_webhook_url,p_chat_webhook_url]) url
      where url is not null and (char_length(url)>2048
        or url !~ '^https://hook\.(?:(?:eu|us)[0-9]+\.)?(?:make|integromat)\.com/[A-Za-z0-9_-]{10,}/?$')) then
    raise exception 'Provide valid HTTPS Make webhook destinations before enabling notifications.' using errcode='22023';
  end if;
  update spotivity_private.notification_config set ready=p_ready,
    booking_webhook_url=p_booking_webhook_url,chat_webhook_url=p_chat_webhook_url,
    updated_at=statement_timestamp() where singleton;
  if p_ready then perform spotivity_private.wake_notification_worker(); end if;
  return public.booking_notification_status();
end
$$;

create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job spotivity_private.notification_outbox%rowtype;
  booking spotivity_private.booking_groups%rowtype;
  message public.mesaje_chat%rowtype;
  destination record;
  court public.terenuri%rowtype;
  base_name text;
  payload jsonb;
  email text;
  customer_name text;
  selected_hours text[];
  remaining_hours text[];
  amount numeric;
begin
  select * into job from spotivity_private.notification_outbox where id=p_notification_id;
  if not found then return null; end if;
  if job.kind='chat_owner' then
    select * into message from public.mesaje_chat where id::text=job.chat_id and expeditor='client';
    if not found then return null; end if;
    select * into destination from spotivity_private.notification_owners(message.teren)
      where user_id=job.recipient_user_id;
    if not found then return null; end if;
    select coalesce(nullif(btrim(c.nume),''),split_part(u.email,'@',1)) into customer_name
      from auth.users u left join public.clienti c on c.user_id=u.id where u.id=message.client_user_id;
    return jsonb_build_object('notification_id',job.id,'kind',job.kind,'booking_id',null,
      'recipient',jsonb_build_object('email',destination.email,'name',destination.name),
      'chat',jsonb_build_object('courtName',message.teren,'customerName',coalesce(customer_name,'Client'),
        'preview',left(message.mesaj,600)));
  end if;
  select * into booking from spotivity_private.booking_groups where id=job.booking_id and sealed;
  if not found then return null; end if;
  if job.kind like 'booking_created_%' and booking.status='anulata' then return null; end if;
  select * into court from public.terenuri where id::text=booking.court_id;
  -- Once a court has disappeared, there is no authorized owner to notify.
  if job.kind like '%_owner' then
    if court.id is null then return null; end if;
    select * into destination from spotivity_private.notification_owners(court.nume)
      where user_id=job.recipient_user_id;
    if not found then return null; end if;
    payload:=jsonb_build_object('recipient',jsonb_build_object('email',destination.email,'name',destination.name));
  else
    if booking.owner_auth_id is not null then
      select lower(btrim(u.email)) into email from auth.users u
        where u.id=booking.owner_auth_id and u.email_confirmed_at is not null;
      if email is null then return null; end if;
    else email:=booking.contact_email; end if;
    payload:=jsonb_build_object('recipient',jsonb_build_object('email',email,'name',booking.contact_name));
  end if;
  select nume into base_name from public.baze_sportive where id=court.baza_sportiva_id;
  selected_hours:=booking.hours;
  amount:=booking.total;
  -- If staff released some hours before the first dispatch, the client still
  -- needs a confirmation and cancellation link for the hours that remain.
  if job.kind like 'booking_created_%' and booking.status='partial' then
    select array_agg(r.ora order by r.ora),coalesce(sum(substring(r.pret_total from '^([0-9]+(?:\.[0-9]+)?)')::numeric),0)
      into selected_hours,amount from public.rezervari r
      where r.booking_group_id=booking.id and r.stare='activa';
    if selected_hours is null then return null; end if;
  end if;
  -- A partial cancellation only describes slots actually released, never a
  -- completed hour that remains in booking history.
  if job.kind like 'booking_cancelled_%' then
    select array_agg(r.ora order by r.ora),coalesce(sum(substring(r.pret_total from '^([0-9]+(?:\.[0-9]+)?)')::numeric),0)
      into selected_hours,amount from public.rezervari r
      where r.booking_group_id=booking.id and r.stare='anulata' and r.ora=any(job.event_hours);
    if selected_hours is null then return null; end if;
    select array_agg(r.ora order by r.ora) into remaining_hours from public.rezervari r
      where r.booking_group_id=booking.id and r.stare='activa';
  end if;
  return payload||jsonb_build_object('notification_id',job.id,'kind',job.kind,'booking_id',booking.id,
    'booking',jsonb_build_object('id',booking.id,'courtName',coalesce(court.nume,booking.court_name),
      'sport',booking.sport,'baseName',coalesce(base_name,''),'city',coalesce(court.oras,''),
      'dayISO',booking.booking_day::text,'hours',selected_hours,'remainingHours',coalesce(to_jsonb(remaining_hours),'[]'::jsonb),'amountRON',amount,
      'customerName',booking.contact_name,'customerEmail',booking.contact_email,
      'customerPhone',coalesce(booking.contact_phone,'')));
end
$$;

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
          'booking_cancelled_client','booking_cancelled_owner','chat_owner')))) then
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

create or replace function public.finish_booking_notification(
  p_notification_id uuid,p_lease_token uuid,p_outcome text,
  p_error_code text default null,p_retry_seconds integer default 60
)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if p_outcome is null or p_outcome not in ('submitted','retry','blocked')
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_:-]{1,80}$')
    or p_retry_seconds is null or p_retry_seconds not between 10 and 86400 then
    raise exception 'Invalid notification outcome.' using errcode='22023';
  end if;
  update spotivity_private.notification_outbox set status=p_outcome,
    submitted_at=case when p_outcome='submitted' then statement_timestamp() else submitted_at end,
    available_at=case when p_outcome='retry' then statement_timestamp()+make_interval(secs=>p_retry_seconds) else available_at end,
    last_error_code=p_error_code,lease_token=null,leased_until=null,updated_at=statement_timestamp()
    where id=p_notification_id and status='leased' and lease_token=p_lease_token;
  get diagnostics changed=row_count;
  return changed=1;
end
$$;

revoke all on function spotivity_private.notification_owners(text),
  spotivity_private.wake_notification_worker(),spotivity_private.enqueue_booking_notifications(),
  spotivity_private.enqueue_booking_event(uuid,text,text,text[]),spotivity_private.enqueue_booking_cancellations(),
  spotivity_private.enqueue_chat_notifications(),spotivity_private.notification_payload(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_booking_notification_config(),public.booking_notification_status(),
  public.configure_booking_notifications(text,text,boolean),
  public.claim_booking_notifications(integer,integer,uuid,text[]),
  public.finish_booking_notification(uuid,uuid,text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_booking_notification_config(),public.booking_notification_status(),
  public.configure_booking_notifications(text,text,boolean),
  public.claim_booking_notifications(integer,integer,uuid,text[]),
  public.finish_booking_notification(uuid,uuid,text,text,integer) to service_role;

comment on table spotivity_private.notification_outbox is
  'Private at-least-once email jobs. Stable id is the Make deduplication key. submitted means webhook accepted, not mailbox delivered. No raw cancellation tokens.';
comment on function public.configure_booking_notifications(text,text,boolean) is
  'Server operator only. Enable after Make scenarios deduplicate notification_id and send to the authorized to.email. No provider credentials are accepted.';
insert into spotivity_private.migrations(version) values(16) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
