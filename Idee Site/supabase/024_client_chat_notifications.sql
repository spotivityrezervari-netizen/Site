-- Private client notifications for staff replies in the existing chat.
-- No historical messages are backfilled and no chat or booking RLS is relaxed.
begin;
do $prerequisite$
begin
  if not exists(select 1 from spotivity_private.migrations where version=22) then
    raise exception 'Apply 021 and 022 before 024_client_chat_notifications.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=24)
    and to_regprocedure('spotivity_private.notification_payload_v23(uuid)') is not null then
    raise exception 'Review existing unregistered client-chat payload helper.';
  end if;
end
$prerequisite$;

-- Narrow the existing legacy webhook in the same transaction as installing
-- client outbox events. Keep its private destination, arguments and enabled
-- state; account-owned replies must not produce a second legacy email.
do $legacy_cutover$
declare legacy record; definition text; execute_at integer; when_at integer;
  prefix text; condition text; suffix text;
begin
  select t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition into legacy
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      join pg_namespace n on n.oid=p.pronamespace
    where t.tgrelid='public.mesaje_chat'::regclass and not t.tgisinternal
      and t.tgname='webhook-chat-nou' and p.proname='http_request'
      and n.nspname='supabase_functions';
  if not found or legacy.definition ~* 'new[.]client_user_id[[:space:]]+is[[:space:]]+null' then return; end if;
  definition:=legacy.definition;
  execute_at:=strpos(definition,' EXECUTE FUNCTION ');
  if execute_at=0 then raise exception 'Review the legacy chat trigger before cutover.'; end if;
  suffix:=substr(definition,execute_at);
  when_at:=strpos(definition,' WHEN ');
  if when_at>0 then
    prefix:=substr(definition,1,when_at-1);
    condition:=substr(definition,when_at+6,execute_at-when_at-6);
    definition:=prefix||' WHEN ((NEW.client_user_id IS NULL) AND ('||condition||'))'||suffix;
  else
    definition:=substr(definition,1,execute_at-1)||' WHEN (NEW.client_user_id IS NULL)'||suffix;
  end if;
  execute format('drop trigger %I on public.mesaje_chat',legacy.tgname);
  execute definition;
  if legacy.tgenabled='D' then execute format('alter table public.mesaje_chat disable trigger %I',legacy.tgname);
  elsif legacy.tgenabled='R' then execute format('alter table public.mesaje_chat enable replica trigger %I',legacy.tgname);
  elsif legacy.tgenabled='A' then execute format('alter table public.mesaje_chat enable always trigger %I',legacy.tgname);
  end if;
end
$legacy_cutover$;

alter table spotivity_private.notification_outbox
  drop constraint if exists notification_outbox_kind_check,
  drop constraint if exists notification_outbox_check;
alter table spotivity_private.notification_outbox add constraint notification_outbox_kind_check
  check(kind in ('booking_created_client','booking_created_owner','booking_cancelled_client',
    'booking_cancelled_owner','chat_owner','chat_client','account_welcome'));
alter table spotivity_private.notification_outbox add constraint notification_outbox_check
  check((kind in ('chat_owner','chat_client') and chat_id is not null and booking_id is null)
    or (kind='account_welcome' and booking_id is null and chat_id is null and recipient_user_id is not null)
    or (kind not in ('chat_owner','chat_client','account_welcome') and booking_id is not null and chat_id is null));

create or replace function spotivity_private.enqueue_chat_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner record;
begin
  if new.expeditor='client' then
    for owner in select * from spotivity_private.notification_owners(new.teren) loop
      insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,recipient_user_id,chat_id)
        values('chat_owner',new.id::text,owner.user_id::text,owner.user_id,new.id::text)
        on conflict do nothing;
    end loop;
  elsif new.expeditor='admin' and new.client_user_id is not null
    and exists(select 1 from auth.users u where u.id=new.client_user_id
      and u.email_confirmed_at is not null and u.email is not null and btrim(u.email)<>''
      and coalesce(to_jsonb(u)->>'deleted_at','')='')
    and exists(select 1 from public.terenuri t where t.nume=new.teren and t.are_chat is not false)
    and exists(select 1 from public.rezervari r where r.client_user_id=new.client_user_id and r.teren=new.teren) then
    insert into spotivity_private.notification_outbox(kind,event_key,recipient_key,recipient_user_id,chat_id)
      values('chat_client',new.id::text,new.client_user_id::text,new.client_user_id,new.id::text)
      on conflict do nothing;
  else return new;
  end if;
  perform spotivity_private.wake_notification_worker();
  return new;
end
$$;

do $payload_helper$
begin
  if not exists(select 1 from spotivity_private.migrations where version=24) then
    alter function spotivity_private.notification_payload(uuid) rename to notification_payload_v23;
  end if;
end
$payload_helper$;
create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job spotivity_private.notification_outbox%rowtype; message public.mesaje_chat%rowtype;
  person auth.users%rowtype; court public.terenuri%rowtype; display_name text; base_name text;
begin
  select * into job from spotivity_private.notification_outbox where id=p_notification_id;
  if not found then return null; end if;
  if job.kind<>'chat_client' then return spotivity_private.notification_payload_v23(p_notification_id); end if;
  select * into message from public.mesaje_chat where id::text=job.chat_id and expeditor='admin'
    and client_user_id=job.recipient_user_id;
  if not found then return null; end if;
  select * into person from auth.users where id=message.client_user_id
    and email_confirmed_at is not null and email is not null and btrim(email)<>'';
  if not found or coalesce(to_jsonb(person)->>'deleted_at','')<>''
    or coalesce(nullif(to_jsonb(person)->>'banned_until','')::timestamptz,'-infinity'::timestamptz)>statement_timestamp() then return null; end if;
  select * into court from public.terenuri where nume=message.teren and are_chat is not false;
  if not found or not exists(select 1 from public.rezervari r
    where r.client_user_id=person.id and r.teren=message.teren) then return null; end if;
  select nume into base_name from public.baze_sportive where id=court.baza_sportiva_id;
  select nullif(btrim(c.nume),'') into display_name from public.clienti c where c.user_id=person.id limit 1;
  display_name:=coalesce(display_name,nullif(btrim(person.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(person.raw_user_meta_data->>'nume'),''),nullif(btrim(person.raw_user_meta_data->>'name'),''),'');
  return jsonb_build_object('notification_id',job.id,'kind','chat_client','booking_id',null,
    'recipient',jsonb_build_object('email',lower(btrim(person.email)),'name',display_name),
    'chat',jsonb_build_object('courtName',message.teren,'baseName',coalesce(base_name,''),
      'customerName',display_name,'preview',left(message.mesaj,600),'messageID',message.id::text));
end
$$;

create or replace function public.get_email_chat_context(p_message_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare message public.mesaje_chat%rowtype; person auth.users%rowtype;
  court public.terenuri%rowtype; owns_court boolean; display_name text; base_name text;
begin
  if auth.uid() is null or spotivity_private.current_email() is null
    or p_message_id is null or char_length(p_message_id)>36
    or p_message_id !~ '^([1-9][0-9]{0,19}|[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$' then
    raise exception 'Conversation access unavailable.' using errcode='42501';
  end if;
  select * into message from public.mesaje_chat where id::text=lower(p_message_id);
  if not found then raise exception 'Conversation access unavailable.' using errcode='42501'; end if;
  select * into court from public.terenuri where nume=message.teren;
  if not found then raise exception 'Conversation access unavailable.' using errcode='42501'; end if;
  owns_court:=spotivity_private.manages_court(court.nume);
  if not owns_court and (message.client_user_id is distinct from auth.uid() or court.are_chat is false) then
    raise exception 'Conversation access unavailable.' using errcode='42501';
  end if;
  select * into person from auth.users where id=message.client_user_id
    and email_confirmed_at is not null and email is not null and btrim(email)<>'';
  if not found or coalesce(to_jsonb(person)->>'deleted_at','')<>'' then
    raise exception 'Conversation access unavailable.' using errcode='42501';
  end if;
  if not owns_court and not exists(select 1 from public.rezervari r
    where r.client_user_id=person.id and r.teren=message.teren) then
    raise exception 'Conversation access unavailable.' using errcode='42501';
  end if;
  select nullif(btrim(c.nume),'') into display_name from public.clienti c where c.user_id=person.id limit 1;
  select nume into base_name from public.baze_sportive where id=court.baza_sportiva_id;
  return jsonb_build_object('message_id',message.id::text,'court_id',court.id::text,'court_name',court.nume,
    'customer_email',lower(btrim(person.email)),'customer_name',coalesce(display_name,''),
    'base_name',coalesce(base_name,''),'is_owner',owns_court);
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
          'booking_cancelled_client','booking_cancelled_owner','chat_owner','chat_client','account_welcome')))) then
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

revoke all on function spotivity_private.enqueue_chat_notifications(),
  spotivity_private.notification_payload(uuid),spotivity_private.notification_payload_v23(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_email_chat_context(text) from public,anon,authenticated,service_role;
grant execute on function public.get_email_chat_context(text) to authenticated;
revoke all on function public.claim_booking_notifications(integer,integer,uuid,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.claim_booking_notifications(integer,integer,uuid,text[]) to service_role;
comment on function public.get_email_chat_context(text) is
  'Authenticated same-site chat link. Resolves actual message ownership or current staff court allocation; the URL grants no permission.';
insert into spotivity_private.migrations(version) values(24) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
