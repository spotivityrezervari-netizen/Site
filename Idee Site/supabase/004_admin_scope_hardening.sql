-- Spotivity: harden ordinary-admin client ownership and Storage scope.
-- Apply after 001_security.sql and 003_court_hours.sql as postgres.
-- No business rows or webhook definitions are rewritten.
begin;
set local datestyle = 'ISO, YMD';
do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply 001_security.sql and 003_court_hours.sql first.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=1)
     or not exists(select 1 from spotivity_private.migrations where version=3) then
    raise exception 'Apply 001_security.sql and 003_court_hours.sql first.';
  end if;
end;
$prerequisite$;

create or replace function spotivity_private.guard_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare court public.terenuri%rowtype; owner_id uuid; owner_email text; new_slot boolean := false;
begin
  -- Historical courts may have been removed. A pure superadmin cancellation
  -- still needs to work without rebuilding or moving that historical slot.
  if tg_op = 'UPDATE' and auth.uid() is not null
     and spotivity_private.is_super_admin() and old.stare = 'activa' and new.stare = 'anulata'
     and (to_jsonb(new) - 'stare') is not distinct from (to_jsonb(old) - 'stare') then
    return new;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and pg_trigger_depth() = 1 and not spotivity_private.manages_court(old.teren) then
    if old.client_user_id is distinct from auth.uid()
       or (to_jsonb(new) - 'stare') is distinct from (to_jsonb(old) - 'stare')
       or old.stare <> 'activa' or new.stare <> 'anulata' then
      raise exception 'Only cancellation of your own active booking is allowed.';
    end if;
    return new;
  end if;
  new.starts_at := spotivity_private.booking_instant(new.data_str, new.ora);
  if new.stare is null or new.stare not in ('activa','anulata') then raise exception 'Invalid booking state.'; end if;
  if tg_op = 'INSERT' then
    new.timestamp_start := (extract(epoch from now()) * 1000)::bigint;
    new.created_at := now();
    new_slot := new.stare = 'activa';
  else
    new_slot := new.stare = 'activa' and (
      old.stare is distinct from 'activa' or old.teren is distinct from new.teren
      or old.data_str is distinct from new.data_str or old.ora is distinct from new.ora
    );
  end if;
  if new_slot and pg_trigger_depth() = 1 then
    select * into court from public.terenuri where nume = new.teren for share;
    if court.nume is null then raise exception 'Court does not exist.'; end if;
    if not (new.ora = any(court.ore_rezervabile)) then
      raise exception 'This hourly START slot is not enabled for the selected court.';
    end if;
  end if;
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if court.nume is null then
    select * into court from public.terenuri where nume = new.teren for share;
  end if;
  if court.nume is null then raise exception 'Court does not exist.'; end if;
  if spotivity_private.manages_court(new.teren) then
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    -- An ordinary admin must not fabricate a relationship to an unrelated
    -- Auth account by guessing its email. Keep such manual bookings as guests.
    if owner_id is not null and (spotivity_private.is_super_admin()
       or spotivity_private.can_read_client(owner_id) is true) then
      new.client_user_id := owner_id;
      new.email_client := owner_email;
    else
      new.client_user_id := null;
    end if;
    return new;
  end if;
  if tg_op <> 'INSERT' or spotivity_private.current_email() is null
     or (new.client_user_id is not null and new.client_user_id <> auth.uid())
     or (new.email_client is not null and lower(btrim(new.email_client)) <> spotivity_private.current_email())
     or new.stare <> 'activa' or court.este_activ is false
     or new.starts_at < now() + interval '1 hour'
     or new.data_str::date > (now() at time zone 'Europe/Bucharest')::date + 6 then
    raise exception 'Invalid booking identity, court, date, or lead time.';
  end if;
  if new.cu_minge and court.optiune_minge is not true then raise exception 'Ball rental is unavailable.'; end if;
  new.client_user_id := auth.uid();
  new.email_client := spotivity_private.current_email();
  new.sport := court.sport;
  new.pret_total := (court.pret + case when new.cu_minge then coalesce(court.pret_minge,15) else 0 end)::text
                    || case when new.cu_minge then ' RON (+Minge)' else ' RON' end;
  return new;
end $$;
create or replace function spotivity_private.guard_chat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; owner_email text;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if spotivity_private.is_super_admin() then
    select id, lower(btrim(email)) into owner_id, owner_email from auth.users
    where lower(btrim(email)) = lower(btrim(new.email_client));
    if owner_id is null then raise exception 'Chat requires an Auth client account.'; end if;
    new.client_user_id := owner_id; new.email_client := owner_email;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'citit') is distinct from (to_jsonb(old) - 'citit')
       or new.citit is not true or (
         not (old.expeditor = 'client' and spotivity_private.manages_court(old.teren))
         and not (old.expeditor = 'admin' and old.client_user_id = auth.uid())
       ) then raise exception 'Only the recipient may mark a message read; message content is immutable.'; end if;
    return new;
  end if;
  if spotivity_private.manages_court(new.teren) then
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
-- Decode only recognized public bucket paths. '+' is literal in URL paths.
create or replace function spotivity_private.court_image_object(image_url text)
returns text language plpgsql immutable set search_path = '' as $$
declare object_path text; output bytea := ''::bytea; i integer := 1; chunk text;
begin
  object_path := substring(image_url from '^https?://[^/]+/storage/v1/(?:object/public|render/image/public)/poze_terenuri/([^?#]+)');
  if object_path is null then return null; end if;
  while i <= char_length(object_path) loop
    chunk := substr(object_path,i,1);
    if chunk = '%' and substr(object_path,i+1,2) ~ '^[0-9A-Fa-f]{2}$' then
      output := output || decode(substr(object_path,i+1,2),'hex'); i := i+3;
    else
      output := output || convert_to(chunk,'UTF8'); i := i+1;
    end if;
  end loop;
  return convert_from(output,'UTF8');
exception when character_not_in_repertoire or untranslatable_character then
  return object_path;
end $$;

create or replace function spotivity_private.may_write_image(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select spotivity_private.is_super_admin() or (
    spotivity_private.is_court_admin()
    and split_part(object_name,'/',1) = auth.uid()::text
    and not exists (
      select 1 from public.terenuri t
      where spotivity_private.court_image_object(t.poza) = object_name
        and spotivity_private.manages_court(t.nume) is not true
    )
  )
$$;

-- An ALL-command anonymous guard also blocks SELECT. Restrict writes only;
-- public image delivery and metadata reads retain the intended read policy.
drop policy if exists spotivity_images_anon_write_guard on storage.objects;
drop policy if exists spotivity_images_anon_insert_guard on storage.objects;
drop policy if exists spotivity_images_anon_update_guard on storage.objects;
drop policy if exists spotivity_images_anon_delete_guard on storage.objects;
create policy spotivity_images_anon_insert_guard on storage.objects as restrictive
  for insert to anon with check (bucket_id <> 'poze_terenuri');
create policy spotivity_images_anon_update_guard on storage.objects as restrictive
  for update to anon using (bucket_id <> 'poze_terenuri') with check (bucket_id <> 'poze_terenuri');
create policy spotivity_images_anon_delete_guard on storage.objects as restrictive
  for delete to anon using (bucket_id <> 'poze_terenuri');

revoke all on function spotivity_private.guard_booking(), spotivity_private.guard_chat(),
  spotivity_private.court_image_object(text), spotivity_private.may_write_image(text)
  from public, anon, authenticated;
grant execute on function spotivity_private.may_write_image(text) to authenticated;
insert into spotivity_private.migrations(version) values(4) on conflict(version) do nothing;
commit;
