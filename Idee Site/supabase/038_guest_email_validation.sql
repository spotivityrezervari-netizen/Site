-- Keep new booking contacts inside the same email contract as the Edge API and
-- transactional renderer. Installation never edits old contacts or queues mail.
begin;
do $migration$
begin
 if exists(select 1 from spotivity_private.migrations where version=38) then
  if to_regprocedure('spotivity_private.valid_booking_email(text)') is null
    or not exists(select 1 from pg_trigger where tgrelid='spotivity_private.booking_groups'::regclass and tgname='spotivity_booking_email_guard' and not tgisinternal) then
   raise exception 'Review incomplete migration 038.';
  end if;
  return;
 end if;
 if not exists(select 1 from spotivity_private.migrations where version=35) then
  raise exception 'Apply 035 before 038.';
 end if;
 if to_regprocedure('spotivity_private.valid_booking_email(text)') is not null
   or to_regprocedure('spotivity_private.enforce_booking_email()') is not null
   or exists(select 1 from pg_trigger where tgrelid='spotivity_private.booking_groups'::regclass and tgname='spotivity_booking_email_guard' and not tgisinternal) then
  raise exception 'Review unregistered email validation objects before 038.';
 end if;
 execute $ddl$
 create function spotivity_private.valid_booking_email(p_email text)
 returns boolean language sql immutable set search_path='' as $body$
  select coalesce(octet_length(p_email)<=254
   and p_email ~ '^[^@]+@[^@]+\.[^@]+$'
   and p_email !~ U&'[\0001-\0020\007F-\009F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF<>]',false)
 $body$
 $ddl$;
 execute $ddl$
 create function spotivity_private.enforce_booking_email()
 returns trigger language plpgsql set search_path='' as $body$
 begin
  -- An unchanged historical contact must still be cancellable and reportable.
  if tg_op='INSERT' or new.contact_email is distinct from old.contact_email then
   if not spotivity_private.valid_booking_email(new.contact_email) then
    raise exception 'Invalid booking contact email.' using errcode='22023';
   end if;
  end if;
  return new;
 end
 $body$
 $ddl$;
 execute 'revoke all on function spotivity_private.valid_booking_email(text),spotivity_private.enforce_booking_email() from public,anon,authenticated,service_role';
 execute 'create trigger spotivity_booking_email_guard before insert or update of contact_email on spotivity_private.booking_groups for each row execute function spotivity_private.enforce_booking_email()';
 insert into spotivity_private.migrations(version)values(38);
end
$migration$;
commit;
