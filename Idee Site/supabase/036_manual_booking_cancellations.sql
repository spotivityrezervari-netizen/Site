-- Give authenticated manual/legacy cancellations the same private snapshot,
-- incident and mail path as atomic bookings. Installation changes no old rows.
begin;
do $guard$
declare registered boolean;
begin
 if not exists(select 1 from spotivity_private.migrations where version=35)then raise exception 'Apply 035 before 036.';end if;
 select exists(select 1 from spotivity_private.migrations where version=36)into registered;
 if not registered and (to_regprocedure('spotivity_private.materialize_manual_cancellation()')is not null
  or to_regprocedure('spotivity_private.notification_payload_v35(uuid)')is not null
  or exists(select 1 from pg_trigger where tgrelid='public.rezervari'::regclass and tgname='zz_spotivity_manual_cancellation'))then
  raise exception 'Review unregistered manual cancellation objects.';
 end if;
 -- Run only after all existing row guards have validated the original request.
 if exists(select 1 from pg_trigger where tgrelid='public.rezervari'::regclass and not tgisinternal
  and(tgtype::integer&19)=19 and tgname collate "C">'zz_spotivity_manual_cancellation' collate "C")then
  raise exception 'Review subsequent reservation row guards before 036.';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure(case when registered then 'spotivity_private.notification_payload_v35(uuid)'else 'spotivity_private.notification_payload(uuid)'end)
  and proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=""']::text[]
  and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))='99d1ac481819add609d9171870b5b426')then
  raise exception 'Review the notification payload before 036.';
 end if;
 if registered and not exists(select 1 from pg_proc where oid=to_regprocedure('spotivity_private.notification_payload(uuid)')
  and proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=""']::text[]
  and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))='b4ac3652b33e94694f2addeb574c1ae8')then
  raise exception '036 notification payload has changed; do not overwrite it.';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('spotivity_private.enqueue_booking_event(uuid,text,text,text[])')
  and proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=""']::text[]
  and md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n'))=
   case when registered then 'ae423329dd6bf74615e3c6b28cceb7ad'else '71bc6fde5a56404a92207099e71a971b'end)then
  raise exception 'Review the booking notification enqueue helper before 036.';
 end if;
end
$guard$;

-- A deleted court has no current owner. Without this guard the generic
-- notification_owners(NULL) fallback queues a phantom superadmin job, even
-- though the later payload revalidation refuses it. Client mail is retained.
do $enqueue$
declare definition text;
begin
 if not exists(select 1 from spotivity_private.migrations where version=36)then
  definition:=pg_get_functiondef('spotivity_private.enqueue_booking_event(uuid,text,text,text[])'::regprocedure);
  execute replace(definition,
   'for owner in select * from spotivity_private.notification_owners(current_court_name) loop',
   'for owner in select * from spotivity_private.notification_owners(current_court_name) where current_court_name is not null loop');
 end if;
end
$enqueue$;

create or replace function spotivity_private.materialize_manual_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
declare b spotivity_private.booking_groups%rowtype; court public.terenuri%rowtype;
 historical_court text; email text; name text; price numeric; group_id uuid;
begin
 -- Root maintenance, blocked slots, non-cancellations and already grouped
 -- reservations retain their previous behavior. No historical backfill occurs.
 if auth.uid()is null or old.booking_group_id is not null or new.booking_group_id is not null
  or old.stare<>'activa' or new.stare<>'anulata' or old.email_client='Teren Blocat'then return new;end if;
 if not(coalesce(old.client_user_id=auth.uid(),false)or spotivity_private.manages_court(old.teren))then return new;end if;
 -- Staff's old guard may normalize a contact and look up its Auth UUID.
 -- Cancellation must retain the original account/guest identity namespace.
 if(to_jsonb(new)-array['stare','client_user_id','email_client'])
   is distinct from(to_jsonb(old)-array['stare','client_user_id','email_client'])
  or lower(btrim(new.email_client))is distinct from lower(btrim(old.email_client))then return new;end if;
 new.client_user_id:=old.client_user_id;new.email_client:=old.email_client;
 select g.* into b from spotivity_private.legacy_attendance_bookings l
  join spotivity_private.booking_groups g on g.id=l.booking_id where l.reservation_id=old.id::text for update of g;
 if b.id is null then
  if old.client_user_id is not null then
   select lower(btrim(u.email))into email from auth.users u where u.id=old.client_user_id and u.email_confirmed_at is not null;
  else email:=lower(btrim(old.email_client));end if;
  -- Name-only manual records remain cancellable; no address is invented.
  if email is null or char_length(email)>254 or email~'[[:cntrl:]]'
   or email!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'then return new;end if;
  -- Later email validation also limits UTF-8 bytes and Unicode separators.
  -- Historical contacts which cannot receive mail must still be cancellable;
  -- never make their UPDATE fail by inventing an undeliverable new group.
  if to_regprocedure('spotivity_private.valid_booking_email(text)')is not null then
   if not spotivity_private.valid_booking_email(email)then return new;end if;
  end if;
  select n.court_id into historical_court from spotivity_private.court_name_registry n where n.court_name=old.teren;
  select t.* into court from public.terenuri t where t.id::text=historical_court;
  select nullif(btrim(c.nume),'')into name from public.clienti c where c.user_id=old.client_user_id;
  name:=coalesce(nullif(old.guest_name,''),name,split_part(email,'@',1),'Client');
  price:=replace(coalesce(substring(old.pret_total from '^([0-9]+(?:[.,][0-9]+)?)'),'0'),',','.')::numeric;
  group_id:=gen_random_uuid();
  -- Already sealed on INSERT deliberately avoids a booking_created email.
  insert into spotivity_private.booking_groups(id,owner_auth_id,contact_name,contact_email,contact_phone,
   court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status)
  values(group_id,old.client_user_id,left(name,200),email,old.guest_phone,
   coalesce(historical_court,court.id::text,'legacy-removed:'||md5(old.teren)),old.teren,
   coalesce(old.sport,court.sport,'-'),old.data_str::date,array[old.ora],coalesce(old.cu_minge,false),price,true,'anulata');
  insert into spotivity_private.legacy_attendance_bookings(booking_id,reservation_id,created_by)
   values(group_id,old.id::text,auth.uid());
 else group_id:=b.id;end if;
 -- Only this trusted trigger adds the group, after the immutable row guards.
 -- Existing statement triggers now see the new group and handle both counting
 -- and mail atomically, with their original event-key deduplication.
 new.booking_group_id:=group_id;
 return new;
end
$$;
revoke all on function spotivity_private.materialize_manual_cancellation()from public,anon,authenticated,service_role;
drop trigger if exists zz_spotivity_manual_cancellation on public.rezervari;
create trigger zz_spotivity_manual_cancellation before update on public.rezervari
 for each row execute function spotivity_private.materialize_manual_cancellation();

do $payload$ begin
 if to_regprocedure('spotivity_private.notification_payload_v35(uuid)')is null then
  alter function spotivity_private.notification_payload(uuid)rename to notification_payload_v35;
 end if;
end $payload$;
create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; original_total numeric;
begin
 payload:=spotivity_private.notification_payload_v35(p_notification_id);
 if payload is null then return null;end if;
 -- Manual snapshots preserve the exact amount, including legacy decimal commas.
 if payload->>'kind'in('booking_cancelled_client','booking_cancelled_owner')then
  select b.total into original_total from spotivity_private.notification_outbox n
   join spotivity_private.legacy_attendance_bookings l on l.booking_id=n.booking_id
   join spotivity_private.booking_groups b on b.id=l.booking_id
   where n.id=p_notification_id;
  if found then payload:=jsonb_set(payload,'{booking,amountRON}',to_jsonb(original_total));end if;
 end if;
 return payload;
end
$$;
revoke all on function spotivity_private.notification_payload(uuid),spotivity_private.notification_payload_v35(uuid)from public,anon,authenticated,service_role;
comment on table spotivity_private.legacy_attendance_bookings is 'Private single-row snapshot links for explicit staff attendance or authenticated manual/legacy cancellation. No invented customer identity or historical mail backfill; excluded from guest-create quotas.';
insert into spotivity_private.migrations(version)values(36)on conflict do nothing;
notify pgrst,'reload schema';
commit;
