-- Reconcile reviewed production fixes with reproducible Git migrations.
-- Apply after 026 as postgres. No booking, account, audit, notification or
-- allocation is rewritten. Existing rate-limit counters are preserved.
-- Optional accepted totals keep the existing RPC API backward compatible;
-- committed retries always resolve before price-change validation.
begin;

do $prerequisite$
declare reviewed record; function_oid oid;
begin
  if to_regclass('spotivity_private.migrations') is null
    or not exists(select 1 from spotivity_private.migrations where version=26) then
    raise exception 'Apply migrations 001 through 026 before migration 027.';
  end if;
  -- Accept only the reviewed Git and production implementations, including
  -- this migration on repeat application. Do not overwrite unknown changes.
  for reviewed in select * from (values
    ('public.create_booking_group(uuid, text, date, text[], boolean)',array['76a94680818564510c820a760c09931a']::text[]),
    ('public.create_guest_booking_group(uuid, text, date, text[], boolean, text, text, text)',array['9a2321d401e092ecdb18cf874fc54403']::text[]),
    ('public.list_late_cancellations(integer)',array['09b25bfd0655ae4e5664e2be62eeb10c','a142ac3a6bb2cb1a445367c45d9faaca']::text[]),
    ('spotivity_private.create_booking_group_internal(uuid, text, date, text[], boolean, uuid, text, text, text)',array['f476cd6ac7a75fa2c1d1565da033077f']::text[]),
    ('spotivity_private.record_late_customer_cancellations()',array['14e48c6aeca7933abb4f9b46e0860887','a2703505ff6cd784cde71b104e6efb7b']::text[]),
    ('public.consume_public_rate_limit(text, text, integer, integer)',array['810af5db6a4fb5ec1e1f7f2fac389dcd']::text[]),
    ('public.create_booking_group(uuid, text, date, text[], boolean, numeric)',array['cf3649b6cf8f6260ec75c14d65943918']::text[]),
    ('public.create_guest_booking_group(uuid, text, date, text[], boolean, text, text, text, numeric)',array['7bfe5995d0036481c951227d8ef5b349']::text[]),
    ('spotivity_private.create_booking_group_internal(uuid, text, date, text[], boolean, uuid, text, text, text, numeric)',array['2a370c1965bd9e80a44a9c3c67431754','ffff59ab41bf3f1b1a75204be1dfdf99']::text[])
  ) functions(signature,body_hashes) loop
    function_oid:=to_regprocedure(reviewed.signature);
    if function_oid is not null and not exists(select 1 from pg_proc p
      where p.oid=function_oid and p.proowner='postgres'::regrole and p.prosecdef
        and p.proconfig=array['search_path=""']::text[]
        and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=any(reviewed.body_hashes)) then
      raise exception 'Review the existing % implementation before migration 027.',reviewed.signature;
    end if;
  end loop;
end
$prerequisite$;

-- The live table already uses this layout. CREATE IF NOT EXISTS plus the
-- compatibility check preserves its counters, primary key and expiry index.
create table if not exists spotivity_private.public_rate_limits(
  scope text not null,
  subject_hash text not null check(subject_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  window_seconds integer not null,
  expires_at timestamptz not null,
  requests integer not null check(requests>0),
  primary key(scope,subject_hash,window_start,window_seconds)
);
do $rate_layout$
begin
  if (select count(*) from pg_attribute
    where attrelid='spotivity_private.public_rate_limits'::regclass and attnum>0 and not attisdropped)<>6
    or exists(select 1 from (values
      ('scope','text'::regtype),('subject_hash','text'::regtype),
      ('window_start','timestamptz'::regtype),('window_seconds','integer'::regtype),
      ('expires_at','timestamptz'::regtype),('requests','integer'::regtype)
    ) expected(name,data_type) where not exists(select 1 from pg_attribute a
      where a.attrelid='spotivity_private.public_rate_limits'::regclass
        and a.attname=expected.name and a.atttypid=expected.data_type
        and a.attnotnull and not a.attisdropped)) then
    raise exception 'Review the existing public rate-limit table layout before migration 027.';
  end if;
end
$rate_layout$;
alter table spotivity_private.public_rate_limits enable row level security;
revoke all on spotivity_private.public_rate_limits from public,anon,authenticated,service_role;
create index if not exists spotivity_public_rate_expiry
  on spotivity_private.public_rate_limits(expires_at);

-- Remove only the superseded signatures. The new final argument is optional,
-- so existing callers still work without ambiguous PostgREST overloads.
-- No CASCADE: an unexpected dependency must be reviewed, never deleted.
drop function if exists public.create_booking_group(uuid,text,date,text[],boolean);
drop function if exists public.create_guest_booking_group(uuid,text,date,text[],boolean,text,text,text);
drop function if exists spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text);

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

  if p_expected_total is not null and (p_expected_total<0
    or p_expected_total::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'Invalid accepted booking total.' using errcode='22023';
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

CREATE OR REPLACE FUNCTION public.create_booking_group(p_request_id uuid, p_court_id text, p_day date, p_hours text[], p_with_ball boolean DEFAULT false, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare subject uuid:=auth.uid(); contact record;
begin
  if subject is null then raise exception 'Sign in before creating this booking.' using errcode='42501'; end if;
  select lower(btrim(u.email)) email,c.nume,c.telefon into contact
    from auth.users u left join public.clienti c on c.user_id=u.id
    where u.id=subject and u.email_confirmed_at is not null for share of u;
  if not found then raise exception 'A confirmed account is required.' using errcode='42501'; end if;
  return spotivity_private.create_booking_group_internal(p_request_id,p_court_id,p_day,p_hours,p_with_ball,
    subject,contact.nume,contact.email,contact.telefon,p_expected_total);
end
$function$;

CREATE OR REPLACE FUNCTION public.create_guest_booking_group(p_request_id uuid, p_court_id text, p_day date, p_hours text[], p_with_ball boolean, p_contact_name text, p_email text, p_phone text, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous_sub text; previous_claims text; result jsonb;
begin
  -- Only service_role can execute this RPC. The Edge Function validates/rate
  -- limits the guest submission; no supplied email proves Auth ownership.
  previous_sub:=current_setting('request.jwt.claim.sub',true);
  previous_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',coalesce((nullif(previous_claims,'')::jsonb-'sub')::text,''),true);
  begin
    result:=spotivity_private.create_booking_group_internal(p_request_id,p_court_id,p_day,p_hours,p_with_ball,
      null,p_contact_name,p_email,p_phone,p_expected_total);
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  return result;
end
$function$;

CREATE OR REPLACE FUNCTION spotivity_private.record_late_customer_cancellations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into spotivity_private.late_cancellation_events(
    booking_id,customer_user_id,customer_email,customer_name,customer_phone,
    court_name,booking_day,first_cancelled_start,cancelled_at,lead_seconds)
  select b.id,b.owner_auth_id,lower(btrim(b.contact_email)),b.contact_name,b.contact_phone,
    b.court_name,b.booking_day,min(n.starts_at),statement_timestamp(),
    floor(extract(epoch from min(n.starts_at)-statement_timestamp()))::integer
  from spotivity_late_new_rows n join spotivity_late_old_rows o on o.id=n.id
    join spotivity_private.booking_groups b on b.id=n.booking_group_id
  where n.stare='anulata' and o.stare='activa' and b.sealed
    and (current_setting('spotivity.client_cancellation_booking',true)=b.id::text
      or (auth.uid() is not null and b.owner_auth_id=auth.uid()
        and not spotivity_private.manages_court(o.teren)))
    and n.starts_at<statement_timestamp()+interval '1 hour'
    and n.starts_at+interval '1 hour'>statement_timestamp()
  group by b.id
  on conflict(booking_id) do nothing;
  return null;
end
$function$;

CREATE OR REPLACE FUNCTION public.list_late_cancellations(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select coalesce(jsonb_agg(row_data order by (row_data->>'count')::integer desc,
    row_data->>'last_cancelled_at' desc),'[]'::jsonb) into result from (
    select jsonb_build_object('email',(array_agg(lower(btrim(e.customer_email))
      order by e.cancelled_at desc,e.booking_id))[1],
      'identity_kind',case when e.customer_user_id is not null then 'account' else 'guest' end,
      'name',(array_agg(e.customer_name order by e.cancelled_at desc,e.booking_id))[1],
      'phone',(array_agg(e.customer_phone order by e.cancelled_at desc,e.booking_id))[1],
      'count',count(*)::integer,'frequent',count(*)>=3,
      'last_cancelled_at',max(e.cancelled_at),'last_court',
        (array_agg(e.court_name order by e.cancelled_at desc,e.booking_id))[1],
      'events',jsonb_agg(jsonb_build_object('booking_id',e.booking_id,'court_name',e.court_name,
        'booking_day',e.booking_day,'starts_at',e.first_cancelled_start,'cancelled_at',e.cancelled_at,
        'lead_minutes',floor(e.lead_seconds/60.0)::integer) order by e.cancelled_at desc,e.booking_id)
    ) as row_data from spotivity_private.late_cancellation_events e
    where e.cancelled_at>=statement_timestamp()-make_interval(days=>p_days)
      and (can_review_all or exists(
        -- Resolve the stable booking court ID first. Reusing a deleted court's
        -- display name must never grant access to its former customers.
        select 1 from spotivity_private.booking_groups b
        join public.terenuri t on t.id::text=b.court_id
        where b.id=e.booking_id and spotivity_private.manages_court(t.nume)
      ))
    group by e.customer_user_id,
      case when e.customer_user_id is null then lower(btrim(e.customer_email)) end
  ) customers;
  return jsonb_build_object('days',p_days,'frequent_threshold',3,'customers',result,
    'scope',case when can_review_all then 'all' else 'assigned_courts' end,
    'automatic_restrictions',false);
end
$function$;

CREATE OR REPLACE FUNCTION public.consume_public_rate_limit(p_scope text, p_subject_hash text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare expected_limit integer; counter record; consumed integer;
  observed_at timestamptz:=statement_timestamp(); bucket_start timestamptz;
begin
  expected_limit:=case p_scope when 'booking_guest' then 10 when 'booking_account' then 30
    when 'booking_cancellation' then 60 when 'club_application' then 20 end;
  if expected_limit is null or p_limit is distinct from expected_limit
    or p_window_seconds is distinct from 600 or p_subject_hash is null
    or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid public rate-limit policy.' using errcode='22023';
  end if;
  -- Bounded cleanup: keep at most an extra day of expired buckets without an
  -- unbounded DELETE in an unauthenticated request's execution path.
  delete from spotivity_private.public_rate_limits where ctid in (
    select ctid from spotivity_private.public_rate_limits
    where expires_at<observed_at-interval '1 day' order by expires_at limit 100
  );
  -- Spend the global budget before creating any caller-specific bucket. Once
  -- it is exhausted, rotating forged identifiers cannot grow persistent state.
  -- Rejected per-subject attempts also consume global budget by design.
  for counter in select * from (values
    ('_global',repeat('0',64),600,60),
    (p_scope,p_subject_hash,expected_limit,600)
  ) policies(scope,subject_hash,maximum,seconds) loop
    bucket_start:=to_timestamp(floor(extract(epoch from observed_at)/counter.seconds)*counter.seconds);
    consumed:=null;
    insert into spotivity_private.public_rate_limits(scope,subject_hash,window_start,window_seconds,expires_at,requests)
      values(counter.scope,counter.subject_hash,bucket_start,counter.seconds,
        bucket_start+make_interval(secs=>counter.seconds),1)
    on conflict(scope,subject_hash,window_start,window_seconds) do update
      set requests=spotivity_private.public_rate_limits.requests+1
      where spotivity_private.public_rate_limits.requests<counter.maximum
    returning requests into consumed;
    if consumed is null then return false; end if;
  end loop;
  return true;
end
$function$;
revoke all on function spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text,numeric),
  spotivity_private.record_late_customer_cancellations(),
  public.create_booking_group(uuid,text,date,text[],boolean,numeric),
  public.create_guest_booking_group(uuid,text,date,text[],boolean,text,text,text,numeric),
  public.list_late_cancellations(integer),public.consume_public_rate_limit(text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.create_booking_group(uuid,text,date,text[],boolean,numeric),
  public.list_late_cancellations(integer) to authenticated;
grant execute on function public.create_guest_booking_group(uuid,text,date,text[],boolean,text,text,text,numeric),
  public.consume_public_rate_limit(text,text,integer,integer) to service_role;
comment on table spotivity_private.public_rate_limits is
  'Private bounded shared rate-limit counters. Only the service RPC may consume budgets; hashes are not proof of Auth identity.';
comment on function public.create_booking_group(uuid,text,date,text[],boolean,numeric) is
  'Atomic Auth-UUID booking. Optional expected total rejects an unaccepted price change; stable committed retries return the original booking.';
comment on function public.consume_public_rate_limit(text,text,integer,integer) is
  'Service-only fixed policy budgets shared across workers. Exhaustion returns false; invalid caller policy is rejected.';
insert into spotivity_private.migrations(version) values(27) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
