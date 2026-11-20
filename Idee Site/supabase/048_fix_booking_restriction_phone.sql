-- 048: repair the booking restriction guard (trigger spotivity_booking_restriction_guard
-- on public.rezervari). Since 037 (applied 15.11.2026) every new active booking
-- failed with "column reference "phone" is ambiguous": the PL/pgSQL variable
-- "phone" clashes with the real Supabase column auth.users.phone, which the
-- guard reads in its EXISTS subquery. The test schema had no auth.users.phone,
-- so the tests did not see it. Same logic, variable renamed to v_phone.
-- Safe to re-run. Apply as postgres.
begin;

create or replace function spotivity_private.enforce_booking_restriction()
returns trigger language plpgsql security definer set search_path='' as $$
declare court text; old_court text; v_phone text;
begin
 if new.stare<>'activa' or new.email_client='Teren Blocat' then return new;end if;
 select n.court_id into court from spotivity_private.court_name_registry n where n.court_name=new.teren;
 if court is null then return new;end if; -- existing court/RLS guards reject invalid new bookings.
 if tg_op='UPDATE' then
   select n.court_id into old_court from spotivity_private.court_name_registry n where n.court_name=old.teren;
   if old.stare='activa' and court is not distinct from old_court and new.client_user_id is not distinct from old.client_user_id
     and (new.data_str,new.ora,new.starts_at)is not distinct from(old.data_str,old.ora,old.starts_at)
     and (new.client_user_id is not null or (lower(btrim(new.email_client)),new.guest_phone)is not distinct from(lower(btrim(old.email_client)),old.guest_phone))then
     return new;
   end if;
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('spotivity-restrictions:global',37037));
 perform pg_advisory_xact_lock(hashtextextended('spotivity-restrictions:court:'||court,37037));
 v_phone:=spotivity_private.booking_phone_digits(new.guest_phone);
 if exists(select 1 from spotivity_private.booking_restrictions r
   where r.revoked_at is null and (r.expires_at is null or r.expires_at>statement_timestamp())
     and (r.court_id is null or r.court_id=court)
     and ((new.client_user_id is not null and r.customer_user_id=new.client_user_id)
       or (new.client_user_id is null and (
         (r.customer_user_id is null and (r.customer_email=lower(btrim(new.email_client))or(v_phone is not null and r.customer_phone=v_phone)))
         or (r.customer_user_id is not null and exists(select 1 from auth.users u
           left join public.clienti c on c.user_id=u.id
           where u.id=r.customer_user_id and u.email_confirmed_at is not null
             and (lower(btrim(u.email))=lower(btrim(new.email_client))
               or (v_phone is not null and spotivity_private.booking_phone_digits(c.telefon)=v_phone
                 and not exists(select 1 from public.clienti other join auth.users other_user on other_user.id=other.user_id
                   where other.user_id<>u.id and other_user.email_confirmed_at is not null and spotivity_private.booking_phone_digits(other.telefon)=v_phone))))
         )
       ))))then
   raise exception 'BOOKING_RESTRICTED: New reservations are restricted for this customer. Contact the court administrator.' using errcode='42501';
 end if;
 return new;
end
$$;
revoke all on function spotivity_private.enforce_booking_restriction() from public, anon, authenticated, service_role;

insert into spotivity_private.migrations(version) values(48) on conflict(version) do nothing;
commit;
