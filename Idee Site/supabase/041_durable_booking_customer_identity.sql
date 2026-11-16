-- Keep incident identity separate from live nullable Auth ownership.
-- Apply after040. No identity is inferred from an email, no account is restored,
-- and installation queues no mail. Previously deleted identities without UUID
-- evidence remain unresolved; reviewed attendance/late UUIDs remain authoritative.
begin;
do $guard$
declare registered boolean; item record;
begin
 if not exists(select 1 from spotivity_private.migrations where version=40)then raise exception 'Apply040 before041.';end if;
 if exists(select 1 from spotivity_private.migrations where version>41)then raise exception '041 is superseded; do not reapply.';end if;
 select exists(select 1 from spotivity_private.migrations where version=41)into registered;
 if not registered and(to_regclass('spotivity_private.reservation_account_identities')is not null
  or to_regprocedure('spotivity_private.guard_booking_customer_identity()')is not null
  or to_regprocedure('spotivity_private.sync_reservation_account_identity()')is not null
  or to_regprocedure('spotivity_private.notification_payload_v40(uuid)')is not null
  or exists(select 1 from pg_attribute where attrelid='spotivity_private.booking_groups'::regclass and attname='identity_user_id'and not attisdropped))then
  raise exception 'Review unregistered durable booking identity objects before041.';
 end if;
 for item in select * from(values
 ('public.set_booking_attendance(uuid,text,integer)','a205c184dffc2f8125b179e0c0c30bc0','bed1536300e36d274c560f775f763960'),
 ('public.set_legacy_booking_attendance(text,text,integer,text)','6c1a118ddd3d60fd46618825967cd6b0','dc35c2c8e6ed04c8805983eb41f2d8fa'),
 ('spotivity_private.materialize_manual_cancellation()','6f51ee6fccf6f4fcb5fe7b1e7bfc397d','ff6c46bba2c132e6f73219f688412471'),
 ('spotivity_private.record_late_customer_cancellations()','c6f6e0712e13527dc71b7f974c5183b6','829efdea4ba261c23eff875de429fd84'),
 ('spotivity_private.notification_payload(uuid)','b4ac3652b33e94694f2addeb574c1ae8','3a1810205af5ae4f297307b1aec196b8') )expected(signature,before_hash,after_hash)loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
   and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=case when registered then item.after_hash else item.before_hash end)then
   raise exception 'Review % before041.',item.signature;
  end if;
 end loop;
 if registered then
  for item in select * from(values
 ('spotivity_private.guard_booking_customer_identity()','e6bccbc7d1d6cfd069cb62aeac5c2b58'),
 ('spotivity_private.sync_reservation_account_identity()','a652d78136f8787b5d4d99e7c0e39a0b') )expected(signature,body_hash)loop
   if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
    and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
    and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=item.body_hash)then raise exception 'Review % before041.',item.signature;end if;
  end loop;
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('spotivity_private.notification_payload_v40(uuid)')
   and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))='b4ac3652b33e94694f2addeb574c1ae8')then raise exception 'Review the preserved notification payload before041.';end if;
 end if;
end
$guard$;

-- Freeze installation against writes while copying exact UUID evidence.
lock table public.rezervari,spotivity_private.booking_groups in share row exclusive mode;
do $install$
begin
 if not exists(select 1 from spotivity_private.migrations where version=41)then
  if exists(select 1 from spotivity_private.booking_groups b
   left join spotivity_private.booking_attendance a on a.booking_id=b.id
   left join spotivity_private.late_cancellation_events e on e.booking_id=b.id
   cross join lateral(values(b.owner_auth_id),(a.customer_user_id),(e.customer_user_id))identity(user_id)
   where identity.user_id is not null group by b.id having count(distinct identity.user_id)>1)then
   raise exception 'Review conflicting recorded booking account UUIDs before041.';
  end if;
  alter table spotivity_private.booking_groups add column identity_user_id uuid;
  update spotivity_private.booking_groups b set identity_user_id=coalesce(b.owner_auth_id,
   (select a.customer_user_id from spotivity_private.booking_attendance a where a.booking_id=b.id),
   (select e.customer_user_id from spotivity_private.late_cancellation_events e where e.booking_id=b.id));
  create table spotivity_private.reservation_account_identities(
   reservation_id text primary key,customer_user_id uuid not null
  );
  alter table spotivity_private.reservation_account_identities enable row level security;
  revoke all on spotivity_private.reservation_account_identities from public,anon,authenticated,service_role;
  insert into spotivity_private.reservation_account_identities(reservation_id,customer_user_id)
   select id::text,client_user_id from public.rezervari where client_user_id is not null;
 end if;
end
$install$;
create or replace function spotivity_private.guard_booking_customer_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT'then
  new.identity_user_id:=coalesce(new.identity_user_id,new.owner_auth_id);
  if new.owner_auth_id is not null and new.identity_user_id is distinct from new.owner_auth_id then
   raise exception 'A booking must retain its original account identity.' using errcode='23514';
  end if;
 elsif new.identity_user_id is distinct from old.identity_user_id then
  raise exception 'The original booking account identity is immutable.' using errcode='42501';
 end if;
 return new;
end
$$;
create or replace function spotivity_private.sync_reservation_account_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE'then
  delete from spotivity_private.reservation_account_identities where reservation_id=old.id::text;return old;
 end if;
 if tg_op='UPDATE'and new.id is distinct from old.id then
  update spotivity_private.reservation_account_identities set reservation_id=new.id::text where reservation_id=old.id::text;
 end if;
 if new.client_user_id is not null then
  -- Preserve intentional staff assignment changes while the account exists.
  insert into spotivity_private.reservation_account_identities(reservation_id,customer_user_id)
   values(new.id::text,new.client_user_id)on conflict(reservation_id)do update set customer_user_id=excluded.customer_user_id;
 elsif tg_op='UPDATE'then
  if(old.client_user_id is not null and exists(select 1 from auth.users u where u.id=old.client_user_id))
    or(old.client_user_id is null and new.email_client is distinct from old.email_client)then
   -- An explicit staff contact replacement keeps its previous guest semantics.
   delete from spotivity_private.reservation_account_identities where reservation_id=new.id::text;
  elsif old.client_user_id is not null then
   -- FK SET NULL runs after Auth deletion. OLD is exact row identity evidence,
   -- including rows inserted immediately before this migration was installed.
   insert into spotivity_private.reservation_account_identities(reservation_id,customer_user_id)
    values(new.id::text,old.client_user_id)on conflict(reservation_id)do nothing;
  end if;
 end if;
 return new;
end
$$;
drop trigger if exists spotivity_booking_customer_identity on spotivity_private.booking_groups;
create trigger spotivity_booking_customer_identity before insert or update on spotivity_private.booking_groups
 for each row execute function spotivity_private.guard_booking_customer_identity();
drop trigger if exists spotivity_reservation_account_identity on public.rezervari;
create trigger spotivity_reservation_account_identity after insert or update or delete on public.rezervari
 for each row execute function spotivity_private.sync_reservation_account_identity();

create or replace function public.set_booking_attendance(p_booking_id uuid,p_status text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b spotivity_private.booking_groups%rowtype; a spotivity_private.booking_attendance%rowtype;
 super boolean; identity_user uuid; identity_email text; first_start timestamptz; hours text[]; new_revision integer; total integer; event_id uuid; notify boolean;
begin
 select u.is_super is true into super from public.users_admin u join auth.users au on au.id=u.user_id where u.user_id=auth.uid() and au.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can record attendance.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('present','no_show') or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid attendance choice.' using errcode='22023'; end if;
 select * into b from spotivity_private.booking_groups where id=p_booking_id and sealed for update;
 if not found or not(super or exists(select 1 from public.terenuri t where t.id::text=b.court_id and spotivity_private.manages_court(t.nume))) then raise exception 'Booking unavailable or outside your courts.' using errcode='42501'; end if;
 select array_agg(r.ora order by r.starts_at),min(r.starts_at) into hours,first_start from spotivity_private.attendance_booking_slots(b.id) r where r.stare='activa' and r.email_client is distinct from 'Teren Blocat';
 if hours is null or exists(select 1 from spotivity_private.attendance_booking_slots(b.id) r where r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp()) then raise exception 'Attendance can be recorded only after the entire reservation has ended.' using errcode='22023'; end if;
 select * into a from spotivity_private.booking_attendance where booking_id=b.id;
 if a.status=p_status then return jsonb_build_object('booking_id',b.id,'status',a.status,'revision',a.revision,'changed',false,'email_queued',false); end if;
 if coalesce(a.revision,0)<>p_expected_revision then raise exception 'Attendance changed. Reload the reservation before saving.' using errcode='40001'; end if;
 identity_user:=case when a.booking_id is not null then a.customer_user_id else b.identity_user_id end;
 identity_email:=case when a.booking_id is not null then a.customer_email else lower(btrim(b.contact_email)) end;
 perform pg_advisory_xact_lock(hashtextextended(case when identity_user is not null then 'account:'||identity_user::text else 'guest:'||identity_email end,33033));
 new_revision:=coalesce(a.revision,0)+1;
 notify:=(p_status='no_show' or coalesce(a.status='no_show',false))
  and (identity_user is null or (b.owner_auth_id=identity_user and exists(select 1 from auth.users u
    where u.id=identity_user and u.email_confirmed_at is not null and coalesce(to_jsonb(u)->>'deleted_at','')='')));
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

create or replace function public.set_legacy_booking_attendance(p_reservation_id text,p_status text,p_expected_revision integer,p_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare super boolean; r public.rezervari%rowtype; t public.terenuri%rowtype; b spotivity_private.booking_groups%rowtype;
 booking_id uuid; identity_user uuid; email text; name text; price numeric; result jsonb;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can record attendance.' using errcode='42501'; end if;
 if p_reservation_id is null or char_length(p_reservation_id)not between 1 and 80 or p_status is null or p_status not in ('present','no_show') or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid attendance choice.' using errcode='22023'; end if;
 select * into r from public.rezervari where id::text=p_reservation_id and booking_group_id is null for update;
 if not found or r.email_client='Teren Blocat' then raise exception 'Reservation unavailable or outside your courts.' using errcode='42501'; end if;
 select g.* into b from spotivity_private.legacy_attendance_bookings l join spotivity_private.booking_groups g on g.id=l.booking_id where l.reservation_id=r.id::text;
 select * into t from public.terenuri where (b.id is null and nume=r.teren) or (b.id is not null and id::text=b.court_id);
 if not(super or (t.id is not null and spotivity_private.manages_court(t.nume) and (b.id is null or t.id::text=b.court_id)))then raise exception 'Reservation unavailable or outside your courts.' using errcode='42501'; end if;
 if r.stare<>'activa' or r.starts_at is null or r.starts_at+interval '1 hour'>statement_timestamp()then raise exception 'Attendance can be recorded only after the entire reservation has ended.' using errcode='22023'; end if;
 if b.id is not null then
  if p_email is not null and nullif(btrim(p_email),'')is not null and lower(btrim(p_email))<>b.contact_email then raise exception 'The saved contact cannot be replaced when recording attendance.' using errcode='22023'; end if;
  result:=public.set_booking_attendance(b.id,p_status,p_expected_revision);
  return result||jsonb_build_object('reservation_id',r.id::text,'needs_email',false);
 end if;
 identity_user:=coalesce(r.client_user_id,(select i.customer_user_id from spotivity_private.reservation_account_identities i where i.reservation_id=r.id::text));
 if identity_user is not null then
  select lower(btrim(u.email)) into email from auth.users u where u.id=identity_user and u.email_confirmed_at is not null;
  -- A deleted account remains an account incident. Retain its historical
  -- contact without treating that address as proof of any current account.
  if email is null and r.client_user_id is null then email:=lower(btrim(r.email_client));end if;
  if email is null then raise exception 'A verified account email is required.' using errcode='22023'; end if;
  if nullif(btrim(p_email),'')is not null and lower(btrim(p_email))<>email then raise exception 'The account email cannot be replaced.' using errcode='22023'; end if;
 else
  email:=lower(btrim(r.email_client));
  if not spotivity_private.valid_booking_email(email) then email:=lower(btrim(p_email));
  elsif nullif(btrim(p_email),'')is not null and lower(btrim(p_email))<>email then raise exception 'The booking email cannot be replaced.' using errcode='22023'; end if;
 end if;
 if not spotivity_private.valid_booking_email(email) then raise exception 'Provide the client email before recording attendance.' using errcode='22023'; end if;
 select nullif(btrim(c.nume),'') into name from public.clienti c where c.user_id=r.client_user_id;
 name:=coalesce(nullif(r.guest_name,''),name,nullif(case when r.email_client like '%@%'then split_part(email,'@',1)else r.email_client end,''),'Client');
 price:=replace(coalesce(substring(r.pret_total from '^([0-9]+(?:[.,][0-9]+)?)'),'0'),',','.')::numeric;
 booking_id:=gen_random_uuid();
 -- INSERT already sealed does not fire the UPDATE-only booking-confirmation trigger.
 insert into spotivity_private.booking_groups(id,owner_auth_id,identity_user_id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status)
 values(booking_id,r.client_user_id,identity_user,left(name,200),email,r.guest_phone,coalesce(t.id::text,'legacy-removed:'||md5(r.teren)),r.teren,coalesce(t.sport,r.sport,'-'),(r.starts_at at time zone 'Europe/Bucharest')::date,array[r.ora],false,price,true,'activa');
 insert into spotivity_private.legacy_attendance_bookings(booking_id,reservation_id,created_by)values(booking_id,r.id::text,auth.uid());
 result:=public.set_booking_attendance(booking_id,p_status,p_expected_revision);
 return result||jsonb_build_object('reservation_id',r.id::text,'needs_email',false);
end
$$;

create or replace function spotivity_private.materialize_manual_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
declare b spotivity_private.booking_groups%rowtype; court public.terenuri%rowtype;
 historical_court text; email text; name text; price numeric; group_id uuid; identity_user uuid;
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
  identity_user:=coalesce(old.client_user_id,(select i.customer_user_id from spotivity_private.reservation_account_identities i where i.reservation_id=old.id::text));
  if identity_user is not null then
   select lower(btrim(u.email))into email from auth.users u where u.id=identity_user and u.email_confirmed_at is not null;
   if email is null and old.client_user_id is null then email:=lower(btrim(old.email_client));end if;
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
  insert into spotivity_private.booking_groups(id,owner_auth_id,identity_user_id,contact_name,contact_email,contact_phone,
   court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status)
  values(group_id,old.client_user_id,identity_user,left(name,200),email,old.guest_phone,
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

create or replace function spotivity_private.record_late_customer_cancellations()
returns trigger language plpgsql security definer set search_path='' as $$
declare event record; fingerprint text;
begin
  for event in
    select b.id as booking_id,b.identity_user_id as customer_user_id,
      lower(btrim(b.contact_email)) as customer_email,b.contact_name,b.contact_phone,
      b.court_name,b.booking_day,min(n.starts_at) as first_cancelled_start,
      case when b.identity_user_id is not null then 'account:'||b.identity_user_id::text
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

do $payload$begin
 if to_regprocedure('spotivity_private.notification_payload_v40(uuid)')is null then
  alter function spotivity_private.notification_payload(uuid)rename to notification_payload_v40;
 end if;
end $payload$;
create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- A deleted Auth owner must not become a guest mail recipient, including
 -- jobs queued before deletion. Current court-owner notifications still apply.
 if exists(select 1 from spotivity_private.notification_outbox n
  join spotivity_private.booking_groups b on b.id=n.booking_id
  where n.id=p_notification_id and n.kind in('booking_created_client','booking_cancelled_client','booking_attendance_client')
    and b.identity_user_id is not null and b.owner_auth_id is distinct from b.identity_user_id)then return null;end if;
 return spotivity_private.notification_payload_v40(p_notification_id);
end
$$;
revoke all on function spotivity_private.guard_booking_customer_identity(),spotivity_private.sync_reservation_account_identity(),
 spotivity_private.notification_payload(uuid),spotivity_private.notification_payload_v40(uuid),
 spotivity_private.materialize_manual_cancellation(),spotivity_private.record_late_customer_cancellations()
 from public,anon,authenticated,service_role;
revoke all on function public.set_booking_attendance(uuid,text,integer),public.set_legacy_booking_attendance(text,text,integer,text)
 from public,anon,authenticated,service_role;
grant execute on function public.set_booking_attendance(uuid,text,integer),public.set_legacy_booking_attendance(text,text,integer,text)to authenticated;
comment on column spotivity_private.booking_groups.identity_user_id is 'Immutable original account UUID for incident identity; independent of nullable live Auth ownership. NULL never proves an account association.';
comment on table spotivity_private.reservation_account_identities is 'Private exact reservation account UUID fallback after Auth deletion; tracks explicit manual identity edits, follows row ID changes and is removed with its reservation. Never inferred from contacts.';
insert into spotivity_private.migrations(version)values(41)on conflict do nothing;
notify pgrst,'reload schema';
commit;
