-- Welcome emails join the existing private durable notification outbox.
-- Apply after 016 as postgres. Only accounts created after this migration's
-- first activation may enqueue a welcome, and only after email confirmation.
-- Existing users, including old unconfirmed users, are never backfilled.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null
    or not exists(select 1 from spotivity_private.migrations where version=16) then
    raise exception 'Apply 016_notification_outbox.sql before 021_account_welcome.sql.';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='auth.users'::regclass
    and attname='created_at' and not attisdropped) then
    raise exception 'The Auth users table must expose its trusted registration timestamp.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=21)
    and (to_regclass('spotivity_private.account_welcome_config') is not null
      or to_regprocedure('spotivity_private.notification_payload_v16(uuid)') is not null) then
    raise exception 'Review existing unregistered welcome notification objects before migration 021.';
  end if;
end
$prerequisite$;

create table if not exists spotivity_private.account_welcome_config(
  singleton boolean primary key default true check(singleton),
  activated_at timestamptz not null default statement_timestamp()
);
insert into spotivity_private.account_welcome_config(singleton) values(true) on conflict do nothing;
alter table spotivity_private.account_welcome_config enable row level security;
revoke all on spotivity_private.account_welcome_config from public,anon,authenticated,service_role;

alter table spotivity_private.notification_outbox
  drop constraint if exists notification_outbox_kind_check,
  drop constraint if exists notification_outbox_check;
alter table spotivity_private.notification_outbox add constraint notification_outbox_kind_check
  check(kind in ('booking_created_client','booking_created_owner',
    'booking_cancelled_client','booking_cancelled_owner','chat_owner','account_welcome'));
alter table spotivity_private.notification_outbox add constraint notification_outbox_check
  check((kind='chat_owner' and chat_id is not null and booking_id is null)
    or (kind='account_welcome' and booking_id is null and chat_id is null and recipient_user_id is not null)
    or (kind not in ('chat_owner','account_welcome') and booking_id is not null and chat_id is null));

-- The trusted Auth registration timestamp also prevents a later email change
-- from sending a welcome to an older account. There is no INSERT..SELECT backfill.
create or replace function spotivity_private.enqueue_account_welcome()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email_confirmed_at is null or new.email is null or btrim(new.email)=''
    or new.created_at is null
    or coalesce(to_jsonb(new)->>'deleted_at','')<>''
    or new.created_at < (select activated_at from spotivity_private.account_welcome_config where singleton) then
    return new;
  end if;
  insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,recipient_user_id)
    values('account_welcome',new.id::text,'account',new.id) on conflict do nothing;
  perform spotivity_private.wake_notification_worker();
  return new;
end
$$;
drop trigger if exists spotivity_account_welcome_event on auth.users;
create trigger spotivity_account_welcome_event after insert or update of email_confirmed_at,email on auth.users
for each row execute function spotivity_private.enqueue_account_welcome();

-- Keep the reviewed booking/chat payload implementation unchanged. The wrapper
-- adds only a service-side account branch and resolves the current verified
-- recipient at dispatch time; no email address or Auth credential is in a job.
do $payload_helper$
begin
  if not exists(select 1 from spotivity_private.migrations where version=21) then
    alter function spotivity_private.notification_payload(uuid) rename to notification_payload_v16;
  end if;
end
$payload_helper$;
create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job spotivity_private.notification_outbox%rowtype; person auth.users%rowtype;
  display_name text; first_name text;
begin
  select * into job from spotivity_private.notification_outbox where id=p_notification_id;
  if not found then return null; end if;
  if job.kind<>'account_welcome' then
    return spotivity_private.notification_payload_v16(p_notification_id);
  end if;
  select * into person from auth.users where id=job.recipient_user_id
    and email_confirmed_at is not null and email is not null and btrim(email)<>'';
  if not found or coalesce(to_jsonb(person)->>'deleted_at','')<>'' then return null; end if;
  display_name:=coalesce(nullif(btrim(person.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(person.raw_user_meta_data->>'nume'),''),
    nullif(btrim(person.raw_user_meta_data->>'name'),''),
    (select nullif(btrim(c.nume),'') from public.clienti c where c.user_id=person.id limit 1),'');
  first_name:=coalesce(nullif(btrim(person.raw_user_meta_data->>'given_name'),''),
    nullif(btrim(person.raw_user_meta_data->>'first_name'),''),
    split_part(regexp_replace(btrim(display_name),'\s+',' ','g'),' ',1));
  return jsonb_build_object('notification_id',job.id,'kind','account_welcome','booking_id',null,
    'recipient',jsonb_build_object('email',lower(btrim(person.email)),'name',display_name),
    'account',jsonb_build_object('firstName',coalesce(first_name,'')));
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
          'booking_cancelled_client','booking_cancelled_owner','chat_owner','account_welcome')))) then
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

revoke all on function spotivity_private.enqueue_account_welcome(),
  spotivity_private.notification_payload_v16(uuid),spotivity_private.notification_payload(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_booking_notifications(integer,integer,uuid,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.claim_booking_notifications(integer,integer,uuid,text[]) to service_role;
comment on table spotivity_private.account_welcome_config is
  'First activation boundary for welcome email eligibility. No existing Auth account is backfilled.';
comment on function spotivity_private.enqueue_account_welcome() is
  'One durable welcome event for a new confirmed Auth account, including Google. Never sends email synchronously.';
insert into spotivity_private.migrations(version) values(21) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
