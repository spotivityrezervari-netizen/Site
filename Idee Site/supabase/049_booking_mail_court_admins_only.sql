-- 049: booking emails go only to the ordinary administrators allocated to the
-- court. Until now spotivity_private.notification_owners() fell back to every
-- superadmin when a court had no allocated administrator, so the superadmin got
-- booking/cancellation mail for those courts. Owner's decision (20.11.2026): the
-- superadmin never receives booking mail; a court with no administrator sends
-- the email only to the client. Chat mail already excluded the superadmin (032).
-- Jobs already queued for a superadmin are no longer valid recipients and are
-- skipped by the payload check; nothing is resent. Safe to re-run. Apply as postgres.
begin;

create or replace function spotivity_private.notification_owners(p_court_name text)
returns table(user_id uuid, email text, name text)
language sql stable security definer set search_path='' as $$
  select a.user_id,lower(btrim(u.email)) as email,
    coalesce(nullif(btrim(a.nume_admin),''),split_part(u.email,'@',1)) as name
  from public.users_admin a join auth.users u on u.id=a.user_id
  where a.is_super is not true and u.email_confirmed_at is not null
    and u.email is not null and btrim(u.email)<>''
    and exists(select 1 from unnest(string_to_array(a.terenuri,',')) allocated
      where btrim(allocated)=p_court_name)
$$;
revoke all on function spotivity_private.notification_owners(text) from public, anon, authenticated, service_role;

insert into spotivity_private.migrations(version) values(49) on conflict(version) do nothing;
commit;
