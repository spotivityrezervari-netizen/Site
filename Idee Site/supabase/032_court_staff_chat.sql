-- Court administrators alone handle administrative chat and chat-owner mail.
-- The superadmin keeps booking/base/account permissions and personal client history.
-- No chat messages, bookings, contacts, queued jobs or credentials are rewritten.
-- 031 is an independent final-domain cutover and is not required here.
begin;
do $guard$ declare item record; begin
 if not exists(select 1 from spotivity_private.migrations where version=30) then
  raise exception 'Apply 030 before 032.';
 end if;
 if exists(select 1 from spotivity_private.migrations where version>=32) then
  raise exception 'Migration 032 is already applied or superseded.';
 end if;
 if to_regprocedure('spotivity_private.manages_court_chat(text)') is not null
  or to_regprocedure('spotivity_private.chat_notification_owners(text)') is not null then
  raise exception 'Review unregistered court-staff chat helpers.';
 end if;
 for item in select * from (values
  ('spotivity_private.guard_chat()','22f02738bb0cd894554d4b641d13f068'),
  ('spotivity_private.enqueue_chat_notifications()','1e0909e0acdac33ae0341e77394be886'),
  ('spotivity_private.notification_payload(uuid)','e8e7f17580c64da1311ecb4bd944a322'),
  ('public.get_email_chat_context(text)','730963f6d1e74c6416702ae02e130bf6'),
  ('public.get_email_booking_context(uuid)','eec4b417715786c6fa7e47e9ef30d325')
 ) expected(signature,body_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
   and p.proowner='postgres'::regrole and p.prosecdef
   and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=item.body_hash) then
   raise exception 'Review existing % before migration 032.',item.signature;
  end if;
 end loop;
end $guard$;

create function spotivity_private.manages_court_chat(court_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not spotivity_private.is_super_admin()
  and spotivity_private.manages_court(court_name)
$$;
create function spotivity_private.chat_notification_owners(p_court_name text)
returns table(user_id uuid,email text,name text)
language sql stable security definer set search_path='' as $$
 select o.user_id,o.email,o.name from spotivity_private.notification_owners(p_court_name) o
 join public.users_admin a on a.user_id=o.user_id and a.is_super is false
 where not exists(select 1 from public.users_admin s join auth.users u on u.id=s.user_id
  where s.is_super is true and lower(btrim(u.email))=lower(btrim(o.email)))
$$;

-- AND boundaries keep administrative chat disabled for superadmins even if an
-- older permissive policy grants broad business administration elsewhere.
create policy spotivity_chat_staff_select on public.mesaje_chat as restrictive for select to authenticated
 using(client_user_id=(select auth.uid()) or spotivity_private.manages_court_chat(teren));
create policy spotivity_chat_staff_insert on public.mesaje_chat as restrictive for insert to authenticated
 with check(client_user_id=(select auth.uid()) or spotivity_private.manages_court_chat(teren));
create policy spotivity_chat_staff_update on public.mesaje_chat as restrictive for update to authenticated
 using(client_user_id=(select auth.uid()) or spotivity_private.manages_court_chat(teren))
 with check(client_user_id=(select auth.uid()) or spotivity_private.manages_court_chat(teren));
create policy spotivity_chat_staff_delete on public.mesaje_chat as restrictive for delete to authenticated
 using(spotivity_private.manages_court_chat(teren));

create or replace function spotivity_private.guard_chat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; owner_email text;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'citit') is distinct from (to_jsonb(old) - 'citit')
       or new.citit is not true or (
         not (old.expeditor = 'client' and spotivity_private.manages_court_chat(old.teren))
         and not (old.expeditor = 'admin' and old.client_user_id = auth.uid())
       ) then raise exception 'Only the recipient may mark a message read; message content is immutable.'; end if;
    return new;
  end if;
  if spotivity_private.manages_court_chat(new.teren) then
    if new.expeditor is distinct from 'admin' then raise exception 'Admins must send as admin.'; end if;
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    if owner_id is null or spotivity_private.can_read_client(owner_id) is not true
       or not exists (select 1 from public.rezervari
      where client_user_id = owner_id and teren = new.teren) then raise exception 'No client booking for this court.'; end if;
    new.client_user_id := owner_id; new.email_client := owner_email;
  else
    if new.expeditor is distinct from 'client' or spotivity_private.current_email() is null
       or (new.client_user_id is not null and new.client_user_id <> auth.uid())
       or lower(btrim(new.email_client)) is distinct from spotivity_private.current_email()
       or not exists (select 1 from public.rezervari
         where client_user_id = auth.uid() and teren = new.teren and stare = 'activa'
           and starts_at + interval '1 hour' > now())
       or not exists (select 1 from public.terenuri where nume = new.teren and are_chat is not false and este_activ is not false)
    then raise exception 'A current booking and an enabled chat are required.'; end if;
    new.client_user_id := auth.uid(); new.email_client := spotivity_private.current_email();
  end if;
  if new.mesaj is null or char_length(btrim(new.mesaj)) not between 1 and 4000 then raise exception 'Message must contain 1 to 4000 characters.'; end if;
  new.citit := false; new.created_at := now();
  return new;
end $$;

create or replace function spotivity_private.enqueue_chat_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner record;
begin
  if new.expeditor='client' then
    for owner in select * from spotivity_private.chat_notification_owners(new.teren) loop
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

create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job spotivity_private.notification_outbox%rowtype; message public.mesaje_chat%rowtype;
  person auth.users%rowtype; court public.terenuri%rowtype; display_name text; base_name text;
begin
  select * into job from spotivity_private.notification_outbox where id=p_notification_id;
  if not found then return null; end if;
  -- Recheck even previously queued fallback jobs before any new service lease.
  if job.kind='chat_owner' and not exists(
    select 1 from public.mesaje_chat m cross join lateral spotivity_private.chat_notification_owners(m.teren) o
    where m.id::text=job.chat_id and m.expeditor='client' and o.user_id=job.recipient_user_id
  ) then return null; end if;
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
  owns_court:=spotivity_private.manages_court_chat(court.nume);
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

create or replace function public.get_email_booking_context(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare booking spotivity_private.booking_groups%rowtype; court public.terenuri%rowtype;
  owns_court boolean; own_booking boolean; cancellable jsonb; base_name text;
begin
  if auth.uid() is null or spotivity_private.current_email() is null then
    raise exception 'Booking access requires a verified account.' using errcode='42501';
  end if;
  select * into booking from spotivity_private.booking_groups where id=p_booking_id and sealed;
  if not found then raise exception 'Booking access unavailable.' using errcode='42501'; end if;
  select * into court from public.terenuri where id::text=booking.court_id;
  owns_court:=court.id is not null and spotivity_private.manages_court(court.nume);
  own_booking:=booking.owner_auth_id=auth.uid();
  if not coalesce(own_booking,false) and not owns_court then
    raise exception 'Booking access unavailable.' using errcode='42501';
  end if;
  select nume into base_name from public.baze_sportive where id=court.baza_sportiva_id;
  select coalesce(jsonb_agg(r.ora order by r.ora),'[]'::jsonb) into cancellable
    from public.rezervari r where r.booking_group_id=booking.id
      and r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp();
  return jsonb_build_object('booking_id',booking.id,'court_id',booking.court_id,
    'court_name',coalesce(court.nume,booking.court_name),'customer_email',booking.contact_email,
    'customer_name',booking.contact_name,'day',booking.booking_day,'hours',booking.hours,
    'total',booking.total,'sport',booking.sport,'base_name',coalesce(base_name,''),
    'city',coalesce(court.oras,''),'status',booking.status,'is_owner',owns_court,
    'can_chat',court.id is not null and court.are_chat is not false and not spotivity_private.is_super_admin(),
    'can_cancel',coalesce(own_booking,false) and jsonb_array_length(cancellable)>0,
    'cancellable_hours',case when own_booking then cancellable else '[]'::jsonb end);
end
$$;

revoke all on function spotivity_private.manages_court_chat(text),spotivity_private.chat_notification_owners(text)
 from public,anon,authenticated,service_role;
grant execute on function spotivity_private.manages_court_chat(text) to authenticated;
comment on function spotivity_private.chat_notification_owners(text) is
 'Only currently allocated ordinary court administrators; never a superadmin fallback. Booking notification owners remain unchanged.';
insert into spotivity_private.migrations(version) values(32);
notify pgrst,'reload schema';
commit;
