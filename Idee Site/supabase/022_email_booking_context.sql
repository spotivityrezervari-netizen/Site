-- Trusted email details and authenticated same-site booking links.
-- No booking ownership, cancellation rules or existing reservation rows change.
begin;
do $prerequisite$
begin
  if not exists(select 1 from spotivity_private.migrations where version=21) then
    raise exception 'Apply 021_account_welcome.sql before 022_email_booking_context.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=22)
    and to_regprocedure('spotivity_private.notification_payload_v21(uuid)') is not null then
    raise exception 'Review the existing email payload helper before migration 022.';
  end if;
end
$prerequisite$;

do $payload_helper$
begin
  if not exists(select 1 from spotivity_private.migrations where version=22) then
    alter function spotivity_private.notification_payload(uuid) rename to notification_payload_v21;
  end if;
end
$payload_helper$;
create or replace function spotivity_private.notification_payload(p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare payload jsonb; map_url text;
begin
  payload:=spotivity_private.notification_payload_v21(p_notification_id);
  if payload is null or not(payload ? 'booking') then return payload; end if;
  select t.locatie into map_url from spotivity_private.booking_groups g
    join public.terenuri t on t.id::text=g.court_id
    where g.id=(payload->>'booking_id')::uuid;
  if map_url is not null and spotivity_private.club_request_maps_valid(map_url) then
    payload:=jsonb_set(payload,'{booking,mapsURL}',to_jsonb(map_url));
  end if;
  return payload;
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
    'can_cancel',coalesce(own_booking,false) and jsonb_array_length(cancellable)>0,
    'cancellable_hours',case when own_booking then cancellable else '[]'::jsonb end);
end
$$;
revoke all on function spotivity_private.notification_payload(uuid),
  spotivity_private.notification_payload_v21(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_email_booking_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_email_booking_context(uuid) to authenticated;
insert into spotivity_private.migrations(version) values(22) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
