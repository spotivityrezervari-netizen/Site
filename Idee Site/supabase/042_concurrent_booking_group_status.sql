-- Serialize the derived group state before reading its retained slots.
-- Apply after 041. No existing business rows, prices or mail jobs are changed.
begin;
do $guard$
declare registered boolean;
begin
 if not exists(select 1 from spotivity_private.migrations where version=41)then raise exception 'Apply 041 before 042.';end if;
 if exists(select 1 from spotivity_private.migrations where version>42)then raise exception '042 is superseded; do not reapply.';end if;
 select exists(select 1 from spotivity_private.migrations where version=42)into registered;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('spotivity_private.sync_booking_group_status()')
  and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=""']::text[]
  and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=case when registered then 'a9ce8099efb4512ac9f5dfd392865043'else '1dc966ba4adafaf2a5a7f81ace111253'end)then
  raise exception 'Review the booking group status trigger before 042.';
 end if;
end
$guard$;
create or replace function spotivity_private.sync_booking_group_status()returns trigger
language plpgsql security definer set search_path='' as $$
declare group_id uuid; next_status text;
begin
  group_id:=case when tg_op='DELETE' then old.booking_group_id else new.booking_group_id end;
  if group_id is not null and exists(select 1 from spotivity_private.booking_groups where id=group_id and sealed) then
    -- A waiting cancellation must re-read the other request's committed slots.
    -- Keep the row lock and aggregate in separate volatile PL/pgSQL commands.
    perform 1 from spotivity_private.booking_groups where id=group_id for update;
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
revoke all on function spotivity_private.sync_booking_group_status()from public,anon,authenticated,service_role;
insert into spotivity_private.migrations(version)values(42)on conflict do nothing;
notify pgrst,'reload schema';
commit;
