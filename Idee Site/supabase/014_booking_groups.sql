-- Spotivity: atomic consecutive-hour bookings and a daily per-person sport limit.
-- Apply after 013. Existing reservations, identities and permissions are preserved.
-- Private guest contact data never appears in public availability. No Auth account
-- is created for a guest, and cancellation never deletes booking history.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 013 before 014_booking_groups.sql.';
  end if;
  if exists(select 1 from (values(1),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13)) required(version)
    where not exists(select 1 from spotivity_private.migrations m where m.version=required.version)) then
    raise exception 'Apply migrations 001 through 013 before 014_booking_groups.sql.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=14)
    and (to_regclass('spotivity_private.booking_groups') is not null
      or exists(select 1 from pg_attribute where attrelid='public.rezervari'::regclass
        and attname in ('booking_group_id','guest_name','guest_phone') and not attisdropped)) then
    raise exception 'Review existing unregistered booking-group objects before migration 014.';
  end if;
end
$prerequisite$;

create table if not exists spotivity_private.booking_groups(
  id uuid primary key,
  owner_auth_id uuid references auth.users(id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  court_id text not null,
  court_name text not null,
  sport text not null,
  booking_day date not null,
  hours text[] not null,
  with_ball boolean not null,
  total numeric not null,
  sealed boolean not null default false,
  status text not null default 'activa' check(status in ('activa','partial','anulata')),
  cancellation_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(cancellation_token_hash is null or cancellation_token_hash ~ '^[0-9a-f]{64}$')
);
alter table spotivity_private.booking_groups enable row level security;
revoke all on spotivity_private.booking_groups from public,anon,authenticated,service_role;

alter table public.rezervari
  add column if not exists booking_group_id uuid references spotivity_private.booking_groups(id),
  add column if not exists guest_name text,
  add column if not exists guest_phone text;
create index if not exists spotivity_booking_group_rows on public.rezervari(booking_group_id);
create index if not exists spotivity_booking_daily_identity on public.rezervari(data_str,sport,client_user_id)
  where stare='activa';
create index if not exists spotivity_booking_daily_email on public.rezervari(data_str,sport,lower(btrim(email_client)))
  where stare='activa';

create or replace function spotivity_private.booking_phone_digits(value text)
returns text language plpgsql immutable set search_path='' as $$
declare digits text;
begin
  if value is null or char_length(value)>50 or value !~ '^\+?[0-9 ().-]+$'
    or value ~ '[[:cntrl:]]' then return null; end if;
  digits:=regexp_replace(value,'[^0-9]','','g');
  if char_length(digits) not between 7 and 15 then return null; end if;
  if left(digits,2)='00' then digits:=substring(digits from 3); end if;
  if char_length(digits)=10 and left(digits,1)='0' then digits:='40'||substring(digits from 2); end if;
  if char_length(digits) not between 7 and 15 then return null; end if;
  return digits;
end
$$;

create or replace function spotivity_private.booking_group_result(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'booking_id',g.id,'court_id',g.court_id,'court_name',g.court_name,
    'sport',g.sport,'day',g.booking_day,'hours',g.hours,'total',g.total,
    'reservation_ids',coalesce((select jsonb_agg(r.id::text order by r.ora) from public.rezervari r where r.booking_group_id=g.id),'[]'::jsonb),
    'state',case
      when not exists(select 1 from public.rezervari r where r.booking_group_id=g.id and r.stare='activa') then 'anulata'
      when exists(select 1 from public.rezervari r where r.booking_group_id=g.id and r.stare='anulata') then 'partial'
      else 'activa' end
  ) from spotivity_private.booking_groups g where g.id=p_booking_id
$$;

create or replace function spotivity_private.create_booking_group_internal(
  p_request_id uuid,p_court_id text,p_day date,p_hours text[],p_with_ball boolean,
  p_owner_auth_id uuid,p_contact_name text,p_email text,p_phone text
)
returns jsonb language plpgsql security definer set search_path='' as $$
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

  -- All matching identities take shared ordered locks. Auth and guest requests
  -- with the same email/phone therefore serialize across courts and cities.
  for lock_key in select value from unnest(array[
    'email:'||p_email,
    case when p_owner_auth_id is not null then 'user:'||p_owner_auth_id::text end,
    case when phone_digits is not null then 'phone:'||phone_digits end
  ]) value where value is not null order by value loop
    perform pg_advisory_xact_lock(hashtextextended('spotivity-booking-day:'||p_day::text||':'||court.sport||':'||lock_key,0));
  end loop;
  if exists(select 1 from public.rezervari r
    left join auth.users u on u.id=r.client_user_id
    left join public.clienti c on c.user_id=r.client_user_id
    where r.stare='activa' and r.data_str=p_day::text and r.sport=court.sport
      and ((p_owner_auth_id is not null and r.client_user_id=p_owner_auth_id)
        or lower(btrim(r.email_client))=p_email or lower(btrim(u.email))=p_email
        or (phone_digits is not null and
          (spotivity_private.booking_phone_digits(r.guest_phone)=phone_digits
            or spotivity_private.booking_phone_digits(c.telefon)=phone_digits)))) then
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
$$;

create or replace function public.create_booking_group(
  p_request_id uuid,p_court_id text,p_day date,p_hours text[],p_with_ball boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare subject uuid:=auth.uid(); contact record;
begin
  if subject is null then raise exception 'Sign in before creating this booking.' using errcode='42501'; end if;
  select lower(btrim(u.email)) email,c.nume,c.telefon into contact
    from auth.users u left join public.clienti c on c.user_id=u.id
    where u.id=subject and u.email_confirmed_at is not null for share of u;
  if not found then raise exception 'A confirmed account is required.' using errcode='42501'; end if;
  return spotivity_private.create_booking_group_internal(p_request_id,p_court_id,p_day,p_hours,p_with_ball,
    subject,contact.nume,contact.email,contact.telefon);
end
$$;

create or replace function public.create_guest_booking_group(
  p_request_id uuid,p_court_id text,p_day date,p_hours text[],p_with_ball boolean,
  p_contact_name text,p_email text,p_phone text
)
returns jsonb language plpgsql security definer set search_path='' as $$
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
      null,p_contact_name,p_email,p_phone);
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  return result;
end
$$;

create or replace function spotivity_private.guard_booking_group() returns trigger
language plpgsql security definer set search_path='' as $$
declare booking spotivity_private.booking_groups%rowtype; current_court public.terenuri%rowtype;
begin
  if tg_op='UPDATE' and auth.uid() is not null and
    (new.booking_group_id,new.guest_name,new.guest_phone) is distinct from
    (old.booking_group_id,old.guest_name,old.guest_phone) then
    raise exception 'Booking group and guest contact are immutable.' using errcode='42501';
  end if;
  if new.booking_group_id is null then
    if tg_op='INSERT' and auth.uid() is not null and not spotivity_private.manages_court(new.teren) then
      raise exception 'Use create_booking_group to reserve consecutive hours.' using errcode='42501';
    end if;
    if auth.uid() is not null and (new.guest_name is not null or new.guest_phone is not null) then
      raise exception 'Guest contact is assigned only by the booking service.' using errcode='42501';
    end if;
    return new;
  end if;
  select * into booking from spotivity_private.booking_groups where id=new.booking_group_id;
  if not found then raise exception 'Unknown booking group.' using errcode='23503'; end if;
  if tg_op='INSERT' then
    select * into current_court from public.terenuri where id::text=booking.court_id;
    if booking.sealed or current_court.nume is distinct from new.teren
      or new.data_str is distinct from booking.booking_day::text or not(new.ora=any(booking.hours))
      or new.sport is distinct from booking.sport
      or (auth.uid() is not null and booking.owner_auth_id is distinct from auth.uid()) then
      raise exception 'Booking rows must belong to their original atomic request.' using errcode='42501';
    end if;
    new.client_user_id:=booking.owner_auth_id;
    new.email_client:=booking.contact_email;
    new.guest_name:=case when booking.owner_auth_id is null then booking.contact_name end;
    new.guest_phone:=case when booking.owner_auth_id is null then booking.contact_phone end;
  elsif auth.uid() is not null and pg_trigger_depth()=1 then
    if (new.teren,new.data_str,new.ora,new.sport) is distinct from
      (old.teren,old.data_str,old.ora,old.sport) then
      raise exception 'Grouped booking court, date and hours are immutable.' using errcode='42501';
    end if;
    -- The old staff guard can resolve an email to an Auth user. A guest's
    -- unverified address must never acquire that user's identity on cancel.
    new.client_user_id:=old.client_user_id;
    new.email_client:=old.email_client;
  end if;
  return new;
end
$$;
drop trigger if exists spotivity_booking_quota_guard on public.rezervari;
create trigger spotivity_booking_quota_guard before insert or update on public.rezervari
for each row execute function spotivity_private.guard_booking_group();

create or replace function spotivity_private.sync_booking_group_status() returns trigger
language plpgsql security definer set search_path='' as $$
declare group_id uuid; next_status text;
begin
  group_id:=case when tg_op='DELETE' then old.booking_group_id else new.booking_group_id end;
  if group_id is not null and exists(select 1 from spotivity_private.booking_groups where id=group_id and sealed) then
    next_status:=case
      when not exists(select 1 from public.rezervari r where r.booking_group_id=group_id and r.stare='activa') then 'anulata'
      when exists(select 1 from public.rezervari r where r.booking_group_id=group_id and r.stare='anulata') then 'partial'
      else 'activa' end;
    update spotivity_private.booking_groups set status=next_status,updated_at=statement_timestamp() where id=group_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
drop trigger if exists spotivity_booking_group_status on public.rezervari;
create trigger spotivity_booking_group_status after update or delete on public.rezervari
for each row execute function spotivity_private.sync_booking_group_status();

create or replace function public.get_booking_group_delivery(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select spotivity_private.booking_group_result(g.id)||jsonb_build_object(
    'email',g.contact_email,'phone',g.contact_phone,'contact_name',g.contact_name,
    'owner_auth_id',g.owner_auth_id,'created_at',g.created_at,'updated_at',g.updated_at,
    'slots',coalesce((select jsonb_agg(jsonb_build_object('id',r.id::text,'hour',r.ora,'state',r.stare,
      'starts_at',r.starts_at,'price',r.pret_total) order by r.ora)
      from public.rezervari r where r.booking_group_id=g.id),'[]'::jsonb)
  ) from spotivity_private.booking_groups g where g.id=p_booking_id
$$;

create or replace function public.attach_cancellation_token(p_booking_id uuid,p_token_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing_hash text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid cancellation token digest.' using errcode='22023';
  end if;
  select cancellation_token_hash into existing_hash from spotivity_private.booking_groups where id=p_booking_id for update;
  if not found then raise exception 'Unknown booking.' using errcode='22023'; end if;
  if existing_hash is not null and existing_hash<>p_token_hash then
    raise exception 'Cancellation token cannot be replaced.' using errcode='42501';
  end if;
  update spotivity_private.booking_groups set cancellation_token_hash=p_token_hash where id=p_booking_id;
  return true;
end
$$;

create or replace function public.preview_booking_cancellation(p_booking_id uuid,p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from spotivity_private.booking_groups where id=p_booking_id and cancellation_token_hash=p_token_hash) then
    raise exception 'Invalid cancellation link.' using errcode='42501';
  end if;
  return spotivity_private.booking_group_result(p_booking_id)||jsonb_build_object(
    'can_cancel',exists(select 1 from public.rezervari r where r.booking_group_id=p_booking_id
      and r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp()),
    'cancellable_hours',coalesce((select jsonb_agg(r.ora order by r.ora) from public.rezervari r
      where r.booking_group_id=p_booking_id and r.stare='activa' and r.starts_at+interval '1 hour'>statement_timestamp()),'[]'::jsonb)
  );
end
$$;

create or replace function spotivity_private.cancel_booking_group_internal(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_sub text; previous_claims text; changed integer;
begin
  perform 1 from spotivity_private.booking_groups where id=p_booking_id;
  if not found then raise exception 'Unknown booking.' using errcode='22023'; end if;
  -- Public wrappers validate the token or the real Auth owner first. Explicitly
  -- select unfinished hours: trusted privileges never weaken this rule.
  perform 1 from public.rezervari where booking_group_id=p_booking_id order by ora for update;
  perform 1 from spotivity_private.booking_groups where id=p_booking_id for update;
  if not exists(select 1 from public.rezervari where booking_group_id=p_booking_id and stare='activa') then
    return spotivity_private.booking_group_result(p_booking_id);
  end if;
  if not exists(select 1 from public.rezervari where booking_group_id=p_booking_id and stare='activa'
    and starts_at+interval '1 hour'>statement_timestamp()) then
    raise exception 'Completed bookings cannot be cancelled.' using errcode='42501';
  end if;
  previous_sub:=current_setting('request.jwt.claim.sub',true);
  previous_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',coalesce((nullif(previous_claims,'')::jsonb-'sub')::text,''),true);
  begin
    update public.rezervari set stare='anulata' where booking_group_id=p_booking_id and stare='activa'
      and starts_at+interval '1 hour'>statement_timestamp();
    get diagnostics changed=row_count;
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  return spotivity_private.booking_group_result(p_booking_id)||jsonb_build_object('cancelled_count',changed);
end
$$;

create or replace function public.cancel_booking_group_by_token(p_booking_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare booking spotivity_private.booking_groups%rowtype;
begin
  select * into booking from spotivity_private.booking_groups where id=p_booking_id;
  if not found or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or booking.cancellation_token_hash is distinct from p_token_hash then
    raise exception 'Invalid cancellation link.' using errcode='42501';
  end if;
  return spotivity_private.cancel_booking_group_internal(p_booking_id);
end
$$;

create or replace function public.cancel_owned_booking_group(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from spotivity_private.booking_groups
    where id=p_booking_id and owner_auth_id=auth.uid()) then
    raise exception 'Only the booking owner may cancel this booking.' using errcode='42501';
  end if;
  return spotivity_private.cancel_booking_group_internal(p_booking_id);
end
$$;

revoke all on function spotivity_private.booking_phone_digits(text),
  spotivity_private.booking_group_result(uuid),
  spotivity_private.create_booking_group_internal(uuid,text,date,text[],boolean,uuid,text,text,text),
  spotivity_private.guard_booking_group(),spotivity_private.sync_booking_group_status(),
  spotivity_private.cancel_booking_group_internal(uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_booking_group(uuid,text,date,text[],boolean),
  public.create_guest_booking_group(uuid,text,date,text[],boolean,text,text,text),
  public.get_booking_group_delivery(uuid),public.attach_cancellation_token(uuid,text),
  public.preview_booking_cancellation(uuid,text),public.cancel_booking_group_by_token(uuid,text),
  public.cancel_owned_booking_group(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_booking_group(uuid,text,date,text[],boolean) to authenticated;
grant execute on function public.cancel_owned_booking_group(uuid) to authenticated;
grant execute on function public.create_guest_booking_group(uuid,text,date,text[],boolean,text,text,text),
  public.get_booking_group_delivery(uuid),public.attach_cancellation_token(uuid,text),
  public.preview_booking_cancellation(uuid,text),public.cancel_booking_group_by_token(uuid,text) to service_role;

comment on table spotivity_private.booking_groups is
  'Atomic consecutive-hour booking metadata. Guest contact is unverified and never grants Auth ownership. Tokens are stored only as SHA-256 digests. No automatic historical deletion.';
comment on column public.rezervari.booking_group_id is
  'Private atomic booking identifier; each selected consecutive hour remains an individual availability row.';
insert into spotivity_private.migrations(version) values(14) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
