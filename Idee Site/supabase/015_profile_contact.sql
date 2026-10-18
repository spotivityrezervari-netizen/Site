-- Spotivity: recover missing contact phones without replacing saved edits.
-- Apply after 013 as postgres. Passwords, roles and existing contact values
-- are never copied from applications or changed by this migration.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null then
    raise exception 'Apply migrations 001 through 013 before 015_profile_contact.sql.';
  end if;
  if exists (select 1 from (values (1),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13)) required(version)
    where not exists (select 1 from spotivity_private.migrations applied where applied.version=required.version)) then
    raise exception 'Apply migrations 001 through 013 before 015_profile_contact.sql.';
  end if;
end
$prerequisite$;

-- Keep the existing Auth trigger and name/email behavior. A normal signup may
-- include contact metadata, but metadata never conveys an administrative role.
-- Use the same phone format and 50-character limit as profile editing (008).
create or replace function spotivity_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare contact_phone text := btrim(coalesce(new.raw_user_meta_data->>'telefon', ''));
begin
  if char_length(contact_phone) > 50
     or contact_phone !~ '^\+?[0-9 ().-]+$'
     or contact_phone ~ '[[:cntrl:]]'
     or char_length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    contact_phone := '';
  end if;
  insert into public.clienti(user_id, email, nume, telefon)
  values (new.id, lower(btrim(new.email)),
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'nume'), ''), split_part(new.email, '@', 1)), 200),
    contact_phone);
  return new;
end $$;

-- Only an exact Auth UUID and its current confirmed/contact email can supply
-- an application's phone. This also covers future existing accounts whose
-- profile was empty before they submitted a club application.
create or replace function spotivity_private.fill_missing_applicant_phone()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.solicitant_user_id is not null
     and char_length(new.telefon) <= 50
     and new.telefon ~ '^\+?[0-9 ().-]+$'
     and new.telefon !~ '[[:cntrl:]]'
     and char_length(regexp_replace(new.telefon,'[^0-9]','','g')) between 7 and 15 then
    update public.clienti c set telefon=btrim(new.telefon)
    from auth.users u
    where u.id=new.solicitant_user_id and c.user_id=u.id
      and lower(btrim(new.email))=lower(btrim(u.email))
      and lower(btrim(c.email))=lower(btrim(u.email))
      and (c.telefon is null or btrim(c.telefon) in ('','-'));
  end if;
  return new;
end $$;
do $contact_trigger$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.cereri_baze_sportive'::regclass
    and tgname='spotivity_club_request_contact' and not tgisinternal) then
    create trigger spotivity_club_request_contact after insert on public.cereri_baze_sportive
      for each row execute function spotivity_private.fill_missing_applicant_phone();
  end if;
end
$contact_trigger$;
revoke all on function spotivity_private.create_profile(), spotivity_private.fill_missing_applicant_phone()
  from public,anon,authenticated,service_role;

-- Metadata is a fallback only for an empty contact. If absent/invalid, recover
-- the latest valid application owned by that same Auth account and email.
-- Existing nonempty phones, names and the original private requests survive.
with candidates as (
  select c.user_id, source.phone
  from public.clienti c join auth.users u on u.id=c.user_id
  cross join lateral (
    select candidate.phone
    from (
      select btrim(u.raw_user_meta_data->>'telefon') phone, 0 priority,
        null::timestamptz created_at, null::uuid request_id
      union all
      select btrim(r.telefon), 1, r.created_at, r.id
      from public.cereri_baze_sportive r
      where r.solicitant_user_id=u.id
        and lower(btrim(r.email))=lower(btrim(u.email))
    ) candidate
    where char_length(candidate.phone) <= 50
      and candidate.phone ~ '^\+?[0-9 ().-]+$'
      and candidate.phone !~ '[[:cntrl:]]'
      and char_length(regexp_replace(candidate.phone,'[^0-9]','','g')) between 7 and 15
    order by candidate.priority, candidate.created_at desc nulls last, candidate.request_id desc
    limit 1
  ) source
  where (c.telefon is null or btrim(c.telefon) in ('','-'))
    and lower(btrim(c.email))=lower(btrim(u.email))
)
update public.clienti c set telefon=candidates.phone
from candidates where c.user_id=candidates.user_id
  and (c.telefon is null or btrim(c.telefon) in ('','-'));

insert into spotivity_private.migrations(version) values(15) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
