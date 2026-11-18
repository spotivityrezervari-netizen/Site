-- Spotivity: a photo in the "new sport" court request (follows 044).
-- The admin uploads the photo to the existing public bucket poze_terenuri under
-- their own folder (same rules as ordinary court photos). The request stores the
-- public URL; on approval it becomes the court photo. Apply after 044 as postgres.
-- Additive: one nullable column; the request RPC gains an optional p_photo
-- argument and the approval RPC copies the photo. No existing data changes.
begin;

do $prerequisite$
begin
  if not exists(select 1 from spotivity_private.migrations where version=44) then
    raise exception 'Apply 044_new_sport_court_requests.sql before 045.';
  end if;
  if to_regprocedure('spotivity_private.court_image_object(text)') is null then
    raise exception 'Required helper spotivity_private.court_image_object(text) is missing.';
  end if;
end
$prerequisite$;

alter table public.cereri_teren_sport_nou add column if not exists poza text
  check (poza is null or char_length(poza)<=500);

-- The 6-argument version from 044 is replaced by one with an optional photo.
drop function if exists public.request_new_sport_court(uuid,text,text,integer,text[],text);

create or replace function public.request_new_sport_court(
  p_base_id uuid,p_name text,p_sport text,p_price integer,p_hours text[] default null,p_message text default null,p_photo text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  identity auth.users%rowtype; actor public.users_admin%rowtype; base public.baze_sportive%rowtype;
  created public.cereri_teren_sport_nou%rowtype; hours text[]; photo_object text;
begin
  if auth.uid() is null then raise exception 'Conectează-te înainte de a trimite cererea.' using errcode='42501'; end if;
  select * into identity from auth.users where id=auth.uid() for share;
  if not found or identity.email_confirmed_at is null then
    raise exception 'Este necesar un email confirmat.' using errcode='42501';
  end if;
  select * into actor from public.users_admin where user_id=identity.id for share;
  if not found or lower(btrim(actor.email)) is distinct from lower(btrim(identity.email)) then
    raise exception 'Doar administratorii pot trimite cereri.' using errcode='42501';
  end if;
  if actor.is_super is true then
    raise exception 'Superadminii adaugă terenul direct, fără cerere.' using errcode='22023';
  end if;
  perform 1 from public.baze_sportive_admini where baza_id=p_base_id and user_id=identity.id for share;
  if not found then raise exception 'Această bază sportivă nu îți este alocată.' using errcode='42501'; end if;
  select * into base from public.baze_sportive where id=p_base_id for share;
  if not found then raise exception 'Baza sportivă nu mai există.' using errcode='22023'; end if;
  p_name:=btrim(p_name);
  if p_name is null or char_length(p_name) not between 2 and 120 or position(',' in p_name)>0 or p_name ~ '[[:cntrl:]]' then
    raise exception 'Numele terenului trebuie să aibă 2–120 caractere, fără virgulă.' using errcode='22023';
  end if;
  if exists(select 1 from public.terenuri where lower(nume)=lower(p_name))
    or exists(select 1 from public.cereri_teren_sport_nou where lower(nume_teren)=lower(p_name) and stare='in_asteptare') then
    raise exception 'Există deja un teren sau o cerere cu acest nume. Alege alt nume.' using errcode='22023';
  end if;
  if p_sport is null or not exists(select 1 from public.site_sporturi where sport=p_sport) then
    raise exception 'Alege un sport disponibil.' using errcode='22023';
  end if;
  if exists(select 1 from public.terenuri where baza_sportiva_id=base.id and sport=p_sport) then
    raise exception 'Baza are deja acest sport. Poți adăuga terenul direct, fără cerere.' using errcode='22023';
  end if;
  if exists(select 1 from public.cereri_teren_sport_nou where baza_id=base.id and sport=p_sport and stare='in_asteptare') then
    raise exception 'Există deja o cerere în așteptare pentru acest sport la această bază.' using errcode='22023';
  end if;
  if p_price is null or p_price not between 0 and 100000 then
    raise exception 'Tariful trebuie să fie un număr întreg între 0 și 100000 lei.' using errcode='22023';
  end if;
  p_message:=nullif(btrim(p_message),'');
  if p_message is not null and (char_length(p_message)>1000 or p_message ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception 'Mesajul poate avea cel mult 1000 de caractere.' using errcode='22023';
  end if;
  -- The photo must be an uploaded object in poze_terenuri inside the caller's own folder.
  p_photo:=nullif(btrim(p_photo),'');
  if p_photo is not null then
    photo_object:=spotivity_private.court_image_object(p_photo);
    if char_length(p_photo)>500 or photo_object is null
      or split_part(photo_object,'/',1) is distinct from identity.id::text
      or not exists(select 1 from storage.objects o where o.bucket_id='poze_terenuri' and o.name=photo_object) then
      raise exception 'Fotografia nu a putut fi verificată. Încarc-o din nou.' using errcode='22023';
    end if;
  end if;
  if (select count(*) from public.cereri_teren_sport_nou where solicitant_user_id=identity.id and created_at>now()-interval '24 hours')>=10 then
    raise exception 'Ai trimis prea multe cereri azi. Încearcă din nou mâine.' using errcode='54000';
  end if;
  hours:=spotivity_private.normalize_court_hours(coalesce(p_hours,
    array['12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00']));
  insert into public.cereri_teren_sport_nou(solicitant_user_id,solicitant_email,baza_id,nume_teren,sport,pret,ore_rezervabile,mesaj,poza)
    values(identity.id,lower(btrim(identity.email)),base.id,p_name,p_sport,p_price,coalesce(hours,'{}'),p_message,p_photo)
    returning * into created;
  return to_jsonb(created);
end
$$;

-- Same as 044, plus: the approved court gets the request photo.
create or replace function public.approve_new_sport_court_request(p_request_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  request public.cereri_teren_sport_nou%rowtype; base public.baze_sportive%rowtype;
  requester public.users_admin%rowtype; created public.terenuri%rowtype;
  court_location text; assigned_names text;
begin
  if auth.uid() is null or not spotivity_private.is_super_admin()
    or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Doar superadminii pot aproba cererile.' using errcode='42501';
  end if;
  select * into request from public.cereri_teren_sport_nou where id=p_request_id for update;
  if not found then raise exception 'Cererea nu mai există.' using errcode='22023'; end if;
  if request.stare='aprobata' then
    return jsonb_build_object('request_id',request.id,'status','aprobata','court_id',request.teren_creat_id::text);
  end if;
  if request.stare<>'in_asteptare' then raise exception 'Cererea a fost deja respinsă.' using errcode='22023'; end if;
  p_note:=nullif(btrim(p_note),'');
  if p_note is not null and (char_length(p_note)>1000 or p_note ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception 'Nota poate avea cel mult 1000 de caractere.' using errcode='22023';
  end if;
  select * into base from public.baze_sportive where id=request.baza_id for share;
  if not found then raise exception 'Baza sportivă nu mai există.' using errcode='22023'; end if;
  select * into requester from public.users_admin where user_id=request.solicitant_user_id for update;
  if not found or requester.is_super is true
    or not exists(select 1 from public.baze_sportive_admini where baza_id=base.id and user_id=request.solicitant_user_id) then
    raise exception 'Solicitantul nu mai administrează această bază. Respinge cererea.' using errcode='22023';
  end if;
  if exists(select 1 from public.terenuri where lower(nume)=lower(request.nume_teren)) then
    raise exception 'Între timp a apărut un teren cu același nume. Respinge cererea și cere alt nume.' using errcode='22023';
  end if;
  select nullif(btrim(t.locatie),'') into court_location from public.terenuri t
    where t.baza_sportiva_id=base.id and nullif(btrim(t.locatie),'') is not null order by t.nume,t.id limit 1;
  insert into public.terenuri(nume,sport,pret,pret_minge,optiune_minge,poza,locatie,oras,este_activ,are_chat,baza_sportiva_id,ore_rezervabile)
    values(request.nume_teren,request.sport,request.pret,0,false,request.poza,coalesce(court_location,''),base.oras,true,true,base.id,request.ore_rezervabile)
    returning * into created;
  select string_agg(name,',' order by name) into assigned_names from (
    select distinct btrim(name) name from unnest(string_to_array(coalesce(requester.terenuri,''),',')||array[created.nume]) names(name)
    where btrim(name)<>''
  ) names;
  update public.users_admin set terenuri=assigned_names where user_id=requester.user_id;
  update public.cereri_teren_sport_nou set stare='aprobata',motiv_decizie=p_note,decis_de=auth.uid(),decis_la=now(),teren_creat_id=created.id
    where id=request.id;
  return jsonb_build_object('request_id',request.id,'status','aprobata','court_id',created.id::text,'court_name',created.nume);
end
$$;

revoke all on function public.request_new_sport_court(uuid,text,text,integer,text[],text,text),
  public.approve_new_sport_court_request(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.request_new_sport_court(uuid,text,text,integer,text[],text,text),
  public.approve_new_sport_court_request(uuid,text) to authenticated;

insert into spotivity_private.migrations(version) values(45) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
