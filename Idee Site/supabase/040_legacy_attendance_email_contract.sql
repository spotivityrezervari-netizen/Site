-- Align historical/manual attendance contacts with the shared email contract.
-- Eligible unsnapshotted guest records may receive an explicit usable address;
-- saved contacts and account identity cannot be replaced. No data or mail backfill.
-- Apply after 039. Installation changes function definitions only.
begin;
do $guard$
declare registered boolean; item record;
begin
 if not exists(select 1 from spotivity_private.migrations where version=39)then raise exception 'Apply 039 before 040.';end if;
 if exists(select 1 from spotivity_private.migrations where version>40)then raise exception '040 is superseded; do not reapply.';end if;
 select exists(select 1 from spotivity_private.migrations where version=40)into registered;
 if to_regprocedure('spotivity_private.valid_booking_email(text)')is null then raise exception 'Review the shared email validator before 040.';end if;
 for item in select * from(values
 ('public.get_booking_attendance(uuid[])','bc744b0fce4eb6834116da76614cbb63','03e9cce6e18a8d414d0648485cdb2286'),
 ('public.set_booking_attendance(uuid,text,integer)','6949c60c2e8e29d40544a2a769d3fab6','a205c184dffc2f8125b179e0c0c30bc0'),
 ('public.get_legacy_booking_attendance(text[])','4bfc61b47fb7fcfbfcd05cf11c7c0ae8','142d58e36a59d97640a3b1180ee8d95c'),
 ('public.set_legacy_booking_attendance(text,text,integer,text)','beebb02a9a04722c502362f00b3e517e','6c1a118ddd3d60fd46618825967cd6b0') )expected(signature,before_hash,after_hash)
 loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
   and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=case when registered then item.after_hash else item.before_hash end)then
   raise exception 'Review % before 040.',item.signature;
  end if;
 end loop;
end
$guard$;
create or replace function public.get_booking_attendance(p_booking_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare super boolean; result jsonb;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can review attendance.' using errcode='42501'; end if;
 if p_booking_ids is null or cardinality(p_booking_ids)>500 then raise exception 'Provide at most 500 bookings.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('booking_id',b.id,'status',coalesce(a.status,'unmarked'),'revision',coalesce(a.revision,0),
 'marked_at',a.marked_at,'ends_at',(select max(r.starts_at+interval '1 hour') from spotivity_private.attendance_booking_slots(b.id) r where r.stare='activa'),'can_mark',exists(select 1 from spotivity_private.attendance_booking_slots(b.id) r where r.stare='activa' and r.email_client is distinct from 'Teren Blocat')
 and not exists(select 1 from spotivity_private.attendance_booking_slots(b.id) r where r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp()))),'[]'::jsonb)
 into result from spotivity_private.booking_groups b left join spotivity_private.booking_attendance a on a.booking_id=b.id
 where b.sealed and b.id=any(p_booking_ids) and (super or exists(select 1 from public.terenuri t where t.id::text=b.court_id and spotivity_private.manages_court(t.nume)));
 return result;
end
$$;

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

create or replace function public.get_legacy_booking_attendance(p_reservation_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare super boolean; result jsonb;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can review attendance.' using errcode='42501'; end if;
 if p_reservation_ids is null or cardinality(p_reservation_ids)>500 or exists(select 1 from unnest(p_reservation_ids)id where id is null or char_length(id)not between 1 and 80)then raise exception 'Provide at most 500 valid reservation references.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('reservation_id',r.id::text,'booking_id',l.booking_id,'status',coalesce(a.status,'unmarked'),'revision',coalesce(a.revision,0),
 'ends_at',r.starts_at+interval '1 hour','can_mark',r.stare='activa' and r.starts_at+interval '1 hour'<=statement_timestamp(),
 'needs_email',r.client_user_id is null and b.id is null and not spotivity_private.valid_booking_email(lower(btrim(coalesce(r.email_client,'')))))),'[]'::jsonb)
 into result from public.rezervari r left join spotivity_private.legacy_attendance_bookings l on l.reservation_id=r.id::text
 left join spotivity_private.booking_groups b on b.id=l.booking_id left join spotivity_private.booking_attendance a on a.booking_id=l.booking_id
 where r.id::text=any(p_reservation_ids) and r.booking_group_id is null and r.email_client is distinct from 'Teren Blocat'
 and (super or exists(select 1 from public.terenuri t where (l.booking_id is null and t.nume=r.teren or l.booking_id is not null and t.id::text=b.court_id) and spotivity_private.manages_court(t.nume)));
 return result;
end
$$;

create or replace function public.set_legacy_booking_attendance(p_reservation_id text,p_status text,p_expected_revision integer,p_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare super boolean; r public.rezervari%rowtype; t public.terenuri%rowtype; b spotivity_private.booking_groups%rowtype;
 booking_id uuid; email text; name text; price numeric; result jsonb;
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
 if r.client_user_id is not null then
  select lower(btrim(u.email)) into email from auth.users u where u.id=r.client_user_id and u.email_confirmed_at is not null;
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
 insert into spotivity_private.booking_groups(id,owner_auth_id,contact_name,contact_email,contact_phone,court_id,court_name,sport,booking_day,hours,with_ball,total,sealed,status)
 values(booking_id,r.client_user_id,left(name,200),email,r.guest_phone,coalesce(t.id::text,'legacy-removed:'||md5(r.teren)),r.teren,coalesce(t.sport,r.sport,'-'),(r.starts_at at time zone 'Europe/Bucharest')::date,array[r.ora],false,price,true,'activa');
 insert into spotivity_private.legacy_attendance_bookings(booking_id,reservation_id,created_by)values(booking_id,r.id::text,auth.uid());
 result:=public.set_booking_attendance(booking_id,p_status,p_expected_revision);
 return result||jsonb_build_object('reservation_id',r.id::text,'needs_email',false);
end
$$;
revoke all on function public.get_booking_attendance(uuid[]),
 public.set_booking_attendance(uuid,text,integer),
 public.get_legacy_booking_attendance(text[]),
 public.set_legacy_booking_attendance(text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_booking_attendance(uuid[]),
 public.set_booking_attendance(uuid,text,integer),
 public.get_legacy_booking_attendance(text[]),
 public.set_legacy_booking_attendance(text,text,integer,text) to authenticated;
insert into spotivity_private.migrations(version)values(40)on conflict do nothing;
notify pgrst,'reload schema';
commit;
