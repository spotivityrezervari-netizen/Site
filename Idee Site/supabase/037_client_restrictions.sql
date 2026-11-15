-- Manual, auditable booking restrictions. No account is automatically banned,
-- signed out or deleted, and existing bookings/cancellations remain available.
-- Apply after 036. Restriction scopes use stable court IDs, not court names.
begin;
do $prerequisite$
begin
 if not exists(select 1 from spotivity_private.migrations where version=36) then raise exception 'Apply 036 before 037.'; end if;
 if exists(select 1 from spotivity_private.migrations where version>37) then raise exception '037 is superseded; do not reapply.'; end if;
 if not exists(select 1 from spotivity_private.migrations where version=37)
   and (to_regclass('spotivity_private.booking_restrictions') is not null
     or to_regclass('spotivity_private.booking_restriction_events') is not null
     or to_regprocedure('public.set_customer_booking_restriction(uuid,integer,boolean,boolean,text)') is not null) then
   raise exception 'Review unregistered client restriction objects before 037.';
 end if;
end
$prerequisite$;

create table if not exists spotivity_private.booking_restrictions(
 id uuid primary key default gen_random_uuid(),
 customer_user_id uuid, customer_email text not null, customer_name text, customer_phone text,
 identity_key text generated always as(case when customer_user_id is not null then 'account:'||customer_user_id::text else 'guest:'||customer_email end) stored,
 court_id text, scope_key text generated always as(coalesce(court_id,'*')) stored,
 source_booking_id uuid not null, incident_count integer not null check(incident_count>=3),
 expires_at timestamptz, revoked_at timestamptz,
 reason text not null default '' check(char_length(reason)<=300),
 created_by uuid not null, updated_by uuid not null,
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 unique(identity_key,scope_key),
 check(customer_email=lower(btrim(customer_email)) and char_length(customer_email)between 3 and 254),
 check(court_id is null or char_length(court_id)between 1 and 80)
);
create table if not exists spotivity_private.booking_restriction_events(
 id uuid primary key default gen_random_uuid(), restriction_id uuid not null references spotivity_private.booking_restrictions(id),
 action text not null check(action in ('restrict','revoke')), actor_user_id uuid not null,
 source_booking_id uuid, incident_count integer, expires_at timestamptz,
 reason text not null default '' check(char_length(reason)<=300),
 created_at timestamptz not null default statement_timestamp()
);
alter table spotivity_private.booking_restrictions enable row level security;
alter table spotivity_private.booking_restriction_events enable row level security;
revoke all on spotivity_private.booking_restrictions,spotivity_private.booking_restriction_events from public,anon,authenticated,service_role;
create index if not exists spotivity_restrictions_account on spotivity_private.booking_restrictions(customer_user_id,court_id) where revoked_at is null;
create index if not exists spotivity_restrictions_guest on spotivity_private.booking_restrictions(customer_email,court_id) where revoked_at is null;

create or replace function public.set_customer_booking_restriction(
 p_booking_id uuid,p_days integer default 7,p_permanent boolean default false,p_global boolean default false,p_reason text default ''
)returns jsonb language plpgsql security definer set search_path='' as $$
declare super boolean; customer record; courts text[]; court text; total integer;
 until_at timestamptz; restriction_id uuid; ids uuid[]:='{}'::uuid[]; email text; phone text;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id
 where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can restrict bookings.' using errcode='42501'; end if;
 if p_booking_id is null or p_permanent is null or p_global is null
   or (not p_permanent and (p_days is null or p_days not between 1 and 365))
   or p_reason is null or char_length(p_reason)>300 or p_reason~'[[:cntrl:]]' then
   raise exception 'Choose a duration of 1 to 365 days or a permanent restriction.' using errcode='22023';
 end if;
 if p_global and not super then raise exception 'Only a superadministrator can restrict all courts.' using errcode='42501'; end if;
 select e.*,b.court_id into customer from spotivity_private.booking_incidents e
 join spotivity_private.booking_groups b on b.id=e.booking_id
 where e.booking_id=p_booking_id and (super or exists(select 1 from public.terenuri t where t.id::text=b.court_id and spotivity_private.manages_court(t.nume)));
 if not found then raise exception 'Customer incident is unavailable or outside your courts.' using errcode='42501'; end if;
 select array_agg(t.id::text order by t.id::text)into courts from public.terenuri t where super or spotivity_private.manages_court(t.nume);
 if not p_global and courts is null then raise exception 'No currently allocated courts.' using errcode='42501'; end if;
 select count(*)::integer into total from spotivity_private.booking_incidents e
 join spotivity_private.booking_groups b on b.id=e.booking_id
 where ((customer.customer_user_id is not null and e.customer_user_id=customer.customer_user_id)
    or (customer.customer_user_id is null and e.customer_user_id is null and lower(btrim(e.customer_email))=lower(btrim(customer.customer_email))))
   and (super or b.court_id=any(courts));
 if total<3 then raise exception 'Review at least 3 incidents before restricting a customer.' using errcode='22023'; end if;
 email:=lower(btrim(customer.customer_email));
 if customer.customer_user_id is not null then
   select lower(btrim(u.email))into email from auth.users u where u.id=customer.customer_user_id;
   email:=coalesce(email,lower(btrim(customer.customer_email)));
 end if;
 phone:=spotivity_private.booking_phone_digits(customer.customer_phone);
 until_at:=case when p_permanent then null else statement_timestamp()+make_interval(days=>p_days)end;
 -- Ordinary decisions serialize only their current courts. A global decision
 -- takes the exclusive counterpart of the booking guard's shared lock.
 if p_global then
   perform pg_advisory_xact_lock(hashtextextended('spotivity-restrictions:global',37037));courts:=array[null::text];
 else
   perform pg_advisory_xact_lock_shared(hashtextextended('spotivity-restrictions:global',37037));
   foreach court in array courts loop perform pg_advisory_xact_lock(hashtextextended('spotivity-restrictions:court:'||court,37037));end loop;
 end if;
 foreach court in array courts loop
   insert into spotivity_private.booking_restrictions(customer_user_id,customer_email,customer_name,customer_phone,court_id,source_booking_id,incident_count,expires_at,reason,created_by,updated_by)
   values(customer.customer_user_id,email,customer.customer_name,phone,court,p_booking_id,total,until_at,btrim(p_reason),auth.uid(),auth.uid())
   on conflict(identity_key,scope_key)do update set customer_email=excluded.customer_email,customer_name=excluded.customer_name,
     customer_phone=excluded.customer_phone,source_booking_id=excluded.source_booking_id,incident_count=excluded.incident_count,
     expires_at=excluded.expires_at,revoked_at=null,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=statement_timestamp()
   returning id into restriction_id;
   insert into spotivity_private.booking_restriction_events(restriction_id,action,actor_user_id,source_booking_id,incident_count,expires_at,reason)
   values(restriction_id,'restrict',auth.uid(),p_booking_id,total,until_at,btrim(p_reason));
   ids:=array_append(ids,restriction_id);
 end loop;
 return jsonb_build_object('restriction_ids',ids,'count',cardinality(ids),'scope',case when p_global then 'all'else 'assigned_courts'end,'permanent',p_permanent,'expires_at',until_at);
end
$$;

create or replace function public.list_customer_booking_restrictions()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare super boolean; result jsonb;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id
 where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can review restrictions.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('restriction_id',r.id,'identity_kind',case when r.customer_user_id is null then 'guest'else 'account'end,
   'email',r.customer_email,'name',r.customer_name,'phone',r.customer_phone,'court_id',r.court_id,
   'court_name',case when r.court_id is null then 'Toate terenurile'else coalesce(t.nume,'Teren retras')end,
   'global',r.court_id is null,'permanent',r.expires_at is null,'expires_at',r.expires_at,'reason',r.reason,
   'created_at',r.created_at,'updated_at',r.updated_at)order by r.updated_at desc,r.id),'[]'::jsonb)
 into result from spotivity_private.booking_restrictions r left join public.terenuri t on t.id::text=r.court_id
 where r.revoked_at is null and (r.expires_at is null or r.expires_at>statement_timestamp())
   and (super or (r.court_id is not null and t.id is not null and spotivity_private.manages_court(t.nume)));
 return jsonb_build_object('restrictions',result,'can_restrict_globally',super,'automatic_restrictions',false);
end
$$;

create or replace function public.revoke_customer_booking_restriction(p_restriction_id uuid,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare super boolean; restriction spotivity_private.booking_restrictions%rowtype;
begin
 select a.is_super is true into super from public.users_admin a join auth.users u on u.id=a.user_id
 where a.user_id=auth.uid() and u.email_confirmed_at is not null;
 if not found then raise exception 'Only a verified administrator can revoke restrictions.' using errcode='42501'; end if;
 if p_restriction_id is null or p_reason is null or char_length(p_reason)>300 or p_reason~'[[:cntrl:]]' then raise exception 'Invalid restriction choice.' using errcode='22023';end if;
 select * into restriction from spotivity_private.booking_restrictions where id=p_restriction_id;
 if not found or not(super or (restriction.court_id is not null and exists(select 1 from public.terenuri t where t.id::text=restriction.court_id and spotivity_private.manages_court(t.nume))))then
   raise exception 'Restriction unavailable or outside your courts.' using errcode='42501';
 end if;
 if restriction.court_id is null then perform pg_advisory_xact_lock(hashtextextended('spotivity-restrictions:global',37037));
 else
   perform pg_advisory_xact_lock_shared(hashtextextended('spotivity-restrictions:global',37037));
   perform pg_advisory_xact_lock(hashtextextended('spotivity-restrictions:court:'||restriction.court_id,37037));
 end if;
 select * into restriction from spotivity_private.booking_restrictions where id=p_restriction_id for update;
 if restriction.revoked_at is not null then return jsonb_build_object('restriction_id',restriction.id,'changed',false);end if;
 update spotivity_private.booking_restrictions set revoked_at=statement_timestamp(),updated_at=statement_timestamp(),updated_by=auth.uid()where id=restriction.id;
 insert into spotivity_private.booking_restriction_events(restriction_id,action,actor_user_id,source_booking_id,incident_count,expires_at,reason)
 values(restriction.id,'revoke',auth.uid(),restriction.source_booking_id,restriction.incident_count,restriction.expires_at,btrim(p_reason));
 return jsonb_build_object('restriction_id',restriction.id,'changed',true);
end
$$;

create or replace function spotivity_private.enforce_booking_restriction()
returns trigger language plpgsql security definer set search_path='' as $$
declare court text; old_court text; phone text;
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
 phone:=spotivity_private.booking_phone_digits(new.guest_phone);
 if exists(select 1 from spotivity_private.booking_restrictions r
   where r.revoked_at is null and (r.expires_at is null or r.expires_at>statement_timestamp())
     and (r.court_id is null or r.court_id=court)
     and ((new.client_user_id is not null and r.customer_user_id=new.client_user_id)
       or (new.client_user_id is null and (
         (r.customer_user_id is null and (r.customer_email=lower(btrim(new.email_client))or(phone is not null and r.customer_phone=phone)))
         or (r.customer_user_id is not null and exists(select 1 from auth.users u
           left join public.clienti c on c.user_id=u.id
           where u.id=r.customer_user_id and u.email_confirmed_at is not null
             and (lower(btrim(u.email))=lower(btrim(new.email_client))
               or (phone is not null and spotivity_private.booking_phone_digits(c.telefon)=phone
                 and not exists(select 1 from public.clienti other join auth.users other_user on other_user.id=other.user_id
                   where other.user_id<>u.id and other_user.email_confirmed_at is not null and spotivity_private.booking_phone_digits(other.telefon)=phone))))
         )
       ))))then
   raise exception 'BOOKING_RESTRICTED: New reservations are restricted for this customer. Contact the court administrator.' using errcode='42501';
 end if;
 return new;
end
$$;
drop trigger if exists spotivity_booking_restriction_guard on public.rezervari;
create trigger spotivity_booking_restriction_guard before insert or update on public.rezervari
 for each row execute function spotivity_private.enforce_booking_restriction();
revoke all on function spotivity_private.enforce_booking_restriction()from public,anon,authenticated,service_role;
revoke all on function public.set_customer_booking_restriction(uuid,integer,boolean,boolean,text),public.list_customer_booking_restrictions(),public.revoke_customer_booking_restriction(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.set_customer_booking_restriction(uuid,integer,boolean,boolean,text),public.list_customer_booking_restrictions(),public.revoke_customer_booking_restriction(uuid,text)to authenticated;
insert into spotivity_private.migrations(version)values(37)on conflict(version)do nothing;
commit;
