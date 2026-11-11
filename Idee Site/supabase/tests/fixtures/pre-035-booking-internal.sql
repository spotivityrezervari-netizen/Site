-- Reviewed production price/idempotency variant before attendance migration 035.
CREATE OR REPLACE FUNCTION spotivity_private.create_booking_group_internal(p_request_id uuid, p_court_id text, p_day date, p_hours text[], p_with_ball boolean, p_owner_auth_id uuid, p_contact_name text, p_email text, p_phone text, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  court public.terenuri%rowtype;
  existing spotivity_private.booking_groups%rowtype;
  normalized_hours text[];
  phone_digits text;
  lock_key text;
  hour_value text;
  hour_index integer:=0;
  group_total numeric;
begin
  if p_expected_total is not null and (p_expected_total<0
    or p_expected_total::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'Invalid accepted booking total.' using errcode='22023';
  end if;
  p_email:=lower(btrim(p_email));
  p_phone:=nullif(btrim(p_phone),'');
  p_contact_name:=coalesce(nullif(btrim(p_contact_name),''),split_part(p_email,'@',1));
  phone_digits:=spotivity_private.booking_phone_digits(p_phone);
  if p_request_id is null or p_court_id is null or char_length(p_court_id)>80
    or p_day is null or p_with_ball is null
    or p_email is null or char_length(p_email)>254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_email ~ '[[:cntrl:]]'
    or p_contact_name is null or char_length(p_contact_name) not between 1 and 200
    or p_contact_name ~ '[[:cntrl:]]'
    or (p_owner_auth_id is null and phone_digits is null)
    or p_hours is null or cardinality(p_hours) not between 1 and 14
    or exists(select 1 from unnest(p_hours) h where h is null or h !~ '^(09|1[0-9]|2[0-2]):00$')
    or cardinality(p_hours)<>(select count(distinct h) from unnest(p_hours) h) then
    raise exception 'Invalid booking details.' using errcode='22023';
  end if;
  select array_agg(h order by h) into normalized_hours from unnest(p_hours) h;
  if exists(select 1 from generate_subscripts(normalized_hours,1) n
    where n>1 and normalized_hours[n]::time-normalized_hours[n-1]::time<>interval '1 hour') then
    raise exception 'Choose consecutive hours on the same court.' using errcode='22023';
  end if;

  -- Repeated requests cannot create duplicate rows, resurrect a cancellation,
  -- or reuse someone else's identifier. No secret browser flag authorizes it.
  perform pg_advisory_xact_lock(hashtextextended('spotivity-booking-request:'||p_request_id::text,0));
  select * into existing from spotivity_private.booking_groups where id=p_request_id for update;
  if found then
    if existing.owner_auth_id is distinct from p_owner_auth_id
      or (existing.court_id,existing.booking_day,existing.hours,existing.with_ball)
        is distinct from (p_court_id,p_day,normalized_hours,p_with_ball)
      or (p_owner_auth_id is null and (existing.contact_name,existing.contact_email,existing.contact_phone)
        is distinct from (p_contact_name,p_email,p_phone)) then
      raise exception 'Booking request identifier was already used.' using errcode='23505';
    end if;
    if p_expected_total is not null and round(existing.total,2) is distinct from round(p_expected_total,2) then
      raise exception 'PRICE_CHANGED' using errcode='P0001';
    end if;
    return spotivity_private.booking_group_result(existing.id);
  end if;

  select * into court from public.terenuri where id::text=p_court_id for share;
  if not found or court.este_activ is false
    or court.sport not in ('Fotbal','Baschet','Tenis','Volei','Tenis Picior')
    or court.pret is null or court.pret<0
    or not (normalized_hours<@court.ore_rezervabile)
    or p_day>(statement_timestamp() at time zone 'Europe/Bucharest')::date+6
    or spotivity_private.booking_instant(p_day::text,normalized_hours[1])<statement_timestamp()+interval '1 hour'
    or (p_with_ball and court.optiune_minge is not true) then
    raise exception 'Court, date, hours or ball option are unavailable.' using errcode='22023';
  end if;

  -- Authenticated identity is the real Auth UUID. Guest email/phone are
  -- unverified contact claims; they must not consume another account's quota.
  -- Keeping the ordered locks preserves serialization for guest contact limits.
  for lock_key in select value from unnest(array[
    'email:'||p_email,
    case when p_owner_auth_id is not null then 'user:'||p_owner_auth_id::text end,
    case when phone_digits is not null then 'phone:'||phone_digits end
  ]) value where value is not null order by value loop
    perform pg_advisory_xact_lock(hashtextextended('spotivity-booking-day:'||p_day::text||':'||court.sport||':'||lock_key,0));
  end loop;
  if exists(select 1 from public.rezervari r
    where r.stare='activa' and r.data_str=p_day::text and r.sport=court.sport
      and ((p_owner_auth_id is not null and r.client_user_id=p_owner_auth_id)
        or (p_owner_auth_id is null and r.client_user_id is null
          and (lower(btrim(r.email_client))=p_email
            or (phone_digits is not null and spotivity_private.booking_phone_digits(r.guest_phone)=phone_digits)))) ) then
    raise exception 'Only one active booking per sport and day is allowed, in all cities.' using errcode='23505';
  end if;
  -- This durable guest limit includes cancelled groups. Idempotent retries
  -- returned above, so network retries never consume another allowance.
  if p_owner_auth_id is null then
    perform pg_advisory_xact_lock(hashtextextended('spotivity-guest-rate-email:'||p_email,0));
    perform pg_advisory_xact_lock(hashtextextended('spotivity-guest-rate-phone:'||phone_digits,0));
    if (select count(*) from spotivity_private.booking_groups g
      where g.owner_auth_id is null and g.created_at>statement_timestamp()-interval '24 hours'
        and (g.contact_email=p_email or spotivity_private.booking_phone_digits(g.contact_phone)=phone_digits))>=10 then
      raise exception 'Guest booking rate limit reached. Try again later.' using errcode='P0001';
    end if;
  end if;

  group_total:=court.pret*cardinality(normalized_hours)
    +case when p_with_ball then coalesce(court.pret_minge,15) else 0 end;
  if p_expected_total is not null and round(group_total,2) is distinct from round(p_expected_total,2) then
    raise exception 'PRICE_CHANGED' using errcode='P0001';
  end if;
  insert into spotivity_private.booking_groups(id,owner_auth_id,contact_name,contact_email,contact_phone,
    court_id,court_name,sport,booking_day,hours,with_ball,total)
  values(p_request_id,p_owner_auth_id,p_contact_name,p_email,p_phone,
    court.id::text,court.nume,court.sport,p_day,normalized_hours,p_with_ball,group_total);
  foreach hour_value in array normalized_hours loop
    hour_index:=hour_index+1;
    insert into public.rezervari(email_client,client_user_id,sport,teren,data_str,ora,pret_total,
      stare,cu_minge,booking_group_id,guest_name,guest_phone)
    values(p_email,p_owner_auth_id,court.sport,court.nume,p_day::text,hour_value,
      (court.pret+case when p_with_ball and hour_index=1 then coalesce(court.pret_minge,15) else 0 end)::text
        ||case when p_with_ball and hour_index=1 then ' RON (+Minge)' else ' RON' end,
      'activa',p_with_ball and hour_index=1,p_request_id,
      case when p_owner_auth_id is null then p_contact_name end,
      case when p_owner_auth_id is null then p_phone end);
  end loop;
  update spotivity_private.booking_groups set sealed=true,updated_at=statement_timestamp() where id=p_request_id;
  return spotivity_private.booking_group_result(p_request_id);
end
$function$;
