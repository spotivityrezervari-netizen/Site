-- An unchanged manual contact must not acquire an account through the older
-- staff email normalizer. Apply after 042; no existing row or mail job changes.
begin;
do $guard$
declare registered boolean; item record;
begin
 if not exists(select 1 from spotivity_private.migrations where version=42)then raise exception 'Apply 042 before 043.';end if;
 if exists(select 1 from spotivity_private.migrations where version>43)then raise exception '043 is superseded; do not reapply.';end if;
 select exists(select 1 from spotivity_private.migrations where version=43)into registered;
 if not registered and(to_regprocedure('spotivity_private.preserve_manual_booking_identity()')is not null
  or exists(select 1 from pg_trigger where tgrelid='public.rezervari'::regclass and tgname='spotivity_booking_identity_guard'))then
  raise exception 'Review unregistered manual booking identity objects before 043.';
 end if;
 for item in select * from(values
  ('spotivity_private.guard_booking()','8fd57a72dde9ad5bc4ffa462a9018277'),
  ('spotivity_private.sync_reservation_account_identity()','a652d78136f8787b5d4d99e7c0e39a0b'))expected(signature,body_hash)loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
   and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v' and p.prorettype='trigger'::regtype
   and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=item.body_hash)then
   raise exception 'Review % before 043.',item.signature;
  end if;
 end loop;
 for item in select * from(values
  ('spotivity_booking_guard','spotivity_private.guard_booking()',23),
  ('spotivity_reservation_account_identity','spotivity_private.sync_reservation_account_identity()',29))expected(trigger_name,signature,trigger_type)loop
  if not exists(select 1 from pg_trigger t where t.tgrelid='public.rezervari'::regclass and t.tgname=item.trigger_name
   and not t.tgisinternal and t.tgenabled='O' and t.tgtype=item.trigger_type and t.tgnargs=0 and t.tgqual is null
   and t.tgfoid=to_regprocedure(item.signature))then raise exception 'Review % before 043.',item.trigger_name;end if;
 end loop;
 if registered and(not exists(select 1 from pg_proc p where p.oid=to_regprocedure('spotivity_private.preserve_manual_booking_identity()')
   and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v' and p.prorettype='trigger'::regtype
   and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))='931980eeda1fc2a2963fc3f3be58b387')
  or not exists(select 1 from pg_trigger t where t.tgrelid='public.rezervari'::regclass and t.tgname='spotivity_booking_identity_guard'
   and not t.tgisinternal and t.tgenabled='O' and t.tgtype=19 and t.tgnargs=0 and t.tgqual is null
   and t.tgfoid=to_regprocedure('spotivity_private.preserve_manual_booking_identity()')))then
  raise exception 'Review the manual booking identity guard before reapplying 043.';
 end if;
end
$guard$;

create or replace function spotivity_private.preserve_manual_booking_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid()is not null and pg_trigger_depth()=1
  and old.booking_group_id is null and new.booking_group_id is null
  and lower(btrim(new.email_client))is not distinct from lower(btrim(old.email_client))then
  -- Run after spotivity_booking_guard's legacy email lookup. The old row and
  -- 041's private UUID evidence retain identity unless staff changes contact.
  -- This also keeps genuine guests separate from a matching account mailbox.
  new.client_user_id:=old.client_user_id;
  new.email_client:=old.email_client;
 end if;
 return new;
end
$$;
drop trigger if exists spotivity_booking_identity_guard on public.rezervari;
create trigger spotivity_booking_identity_guard before update on public.rezervari
 for each row execute function spotivity_private.preserve_manual_booking_identity();
revoke all on function spotivity_private.preserve_manual_booking_identity()from public,anon,authenticated,service_role;
insert into spotivity_private.migrations(version)values(43)on conflict do nothing;
notify pgrst,'reload schema';
commit;
