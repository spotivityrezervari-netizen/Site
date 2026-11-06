-- Superadmin announcement composer. Only explicit approval queues delivery.
-- Existing audience capabilities, accounts and transactional notification jobs stay intact.
begin;
do $guard$ begin
  if not exists(select 1 from spotivity_private.migrations where version=29) then
    raise exception 'Apply 029 before 030.';
  end if;
  if exists(select 1 from spotivity_private.migrations where version>=30) then
    raise exception 'Migration 030 is already applied or superseded.';
  end if;
  if to_regclass('spotivity_private.announcement_panel_config') is not null
    or exists(select 1 from storage.buckets where id='announcement_images') then
    raise exception 'Review unregistered announcement panel objects.';
  end if;
end $guard$;

alter table spotivity_private.announcement_campaigns
  add column created_by uuid,
  add column image_path text,
  add column cancelled_at timestamptz,
  add column last_queued_at timestamptz;
create table spotivity_private.announcement_panel_config(
  singleton boolean primary key default true check(singleton),
  ready boolean not null default false
);
insert into spotivity_private.announcement_panel_config(singleton) values(true);
alter table spotivity_private.announcement_panel_config enable row level security;
revoke all on spotivity_private.announcement_panel_config from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('announcement_images','announcement_images',true,5242880,array['image/jpeg','image/png']);

create function spotivity_private.require_announcement_superadmin()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not spotivity_private.is_super_admin() then
    raise exception 'Only the current superadmin may manage announcements.' using errcode='42501';
  end if;
end $$;
create function spotivity_private.may_insert_announcement_image(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and spotivity_private.is_super_admin()
    and split_part(object_name,'/',1)=auth.uid()::text
    and object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
    and not exists(select 1 from spotivity_private.announcement_campaigns c
      where c.id::text=split_part(object_name,'/',2))
$$;
create policy announcement_image_insert on storage.objects for insert to authenticated
with check(bucket_id='announcement_images' and spotivity_private.may_insert_announcement_image(name));
-- No UPDATE/DELETE policy: images frozen in previews cannot change after approval.
create policy announcement_image_super_read on storage.objects for select to authenticated
using(bucket_id='announcement_images' and spotivity_private.is_super_admin());

-- Existing Storage policies are permissive ORs. Enforce immutability with a
-- trigger as well, including any pre-existing general superadmin policy.
create function spotivity_private.guard_announcement_image()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' and old.bucket_id='announcement_images'
   and exists(select 1 from spotivity_private.announcement_campaigns where image_path=old.name) then
  raise exception 'A frozen announcement image cannot be changed or removed.' using errcode='42501';
 end if;
 if tg_op<>'DELETE' and new.bucket_id='announcement_images' and auth.uid() is not null
   and not spotivity_private.may_insert_announcement_image(new.name) then
  raise exception 'Upload announcement images only as the current superadmin.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger spotivity_announcement_image_guard before insert or update or delete on storage.objects
 for each row execute function spotivity_private.guard_announcement_image();

-- Retire raw-row webhooks: normalized outbox notifications already cover both
-- tables, and the old admin-chat webhook otherwise sends a second email.
do $legacy$ declare item record; begin
 for item in select t.tgname,t.tgrelid::regclass as relation,p.proname,n.nspname
  from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
  where (t.tgrelid='public.mesaje_chat'::regclass and t.tgname='webhook-chat-nou')
    or (t.tgrelid='public.rezervari'::regclass and t.tgname='webhook_reervare_noua') loop
  if item.proname<>'http_request' or item.nspname<>'supabase_functions' then
   raise exception 'Review the changed legacy webhook before retiring it.';
  end if;
  execute format('drop trigger %I on %s',item.tgname,item.relation);
 end loop;
end $legacy$;

create function spotivity_private.announcement_mail(p_subject text,p_message text,p_image_path text default null)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'subject',p_subject,
  'text','Spotivity'||E'\n\n'||p_subject||E'\n\n'||p_message||E'\n\nhttps://spotivityrezervari-netizen.github.io/Site/Idee%20Site/\nContact: spotivity.rezervari@gmail.com',
  'html','<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'||spotivity_private.announcement_escape(p_subject)||'</title></head>'
  ||'<body style="margin:0;padding:16px 8px;background:#edf2eb;color:#172b20;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
  ||'<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px"><tr><td style="padding:24px;overflow-wrap:anywhere;word-break:break-word">'
  ||'<p style="margin:0 0 20px;font-weight:bold;color:#366142">Spotivity</p><h1 style="margin:0 0 20px;font-size:24px;line-height:1.3">'||spotivity_private.announcement_escape(p_subject)||'</h1>'
  ||case when p_image_path is null then '' else '<img width="552" src="https://ndubcdwohqzgxpuiowye.supabase.co/storage/v1/object/public/announcement_images/'||spotivity_private.announcement_escape(p_image_path)||'" alt="'||spotivity_private.announcement_escape(p_subject)||'" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:10px;margin:0 0 20px">' end
  ||'<p style="margin:0 0 24px;font-size:16px;line-height:1.65">'||replace(spotivity_private.announcement_escape(p_message),E'\n','<br>')||'</p>'
  ||'<p><a href="https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/" style="color:#366142">Deschide Spotivity</a></p><p style="font-size:13px;line-height:1.6;color:#526052">Contact: <a href="mailto:spotivity.rezervari@gmail.com">spotivity.rezervari@gmail.com</a></p>'
  ||'</td></tr></table></td></tr></table></body></html>')
$$;
create function spotivity_private.announcement_panel_summary(p_campaign_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select spotivity_private.announcement_summary(c.id)||jsonb_build_object(
  'subject',c.subject,'message',c.message,'created_by',c.created_by,'image_path',c.image_path,
  'image_url',case when c.image_path is not null then 'https://ndubcdwohqzgxpuiowye.supabase.co/storage/v1/object/public/announcement_images/'||c.image_path end,
  'cancelled_at',c.cancelled_at,'last_queued_at',c.last_queued_at)
 from spotivity_private.announcement_campaigns c where c.id=p_campaign_id
$$;
create function public.admin_announcement_preview(
 p_campaign_id uuid,p_audience text,p_subject text,p_message text,p_image_path text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c spotivity_private.announcement_campaigns%rowtype;
 ids uuid[]; emails text[]; n integer; fingerprint text;
begin
 perform spotivity_private.require_announcement_superadmin();
 p_subject:=btrim(p_subject);
 p_message:=btrim(replace(replace(p_message,E'\r\n',E'\n'),E'\r',E'\n'));
 p_image_path:=nullif(p_image_path,'');
 if p_campaign_id is null or p_audience is null or p_audience not in ('clients','admins')
  or p_subject is null or char_length(p_subject) not between 1 and 180 or p_subject ~ '[[:cntrl:]]'
  or p_message is null or char_length(p_message) not between 1 and 20000 or p_message ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' then
  raise exception 'Invalid announcement content.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('spotivity-announcement:'||p_campaign_id::text,0));
 select * into c from spotivity_private.announcement_campaigns where id=p_campaign_id for update;
 if found then
  if c.created_by is distinct from auth.uid()
    or (c.audience,c.subject,c.message,c.image_path) is distinct from (p_audience,p_subject,p_message,p_image_path) then
   raise exception 'Campaign UUID already belongs to another immutable preview.' using errcode='22023';
  end if;
  return spotivity_private.announcement_panel_summary(c.id);
 end if;
 if (select count(*) from spotivity_private.announcement_campaigns where created_by=auth.uid() and created_at>statement_timestamp()-interval '1 hour')>=100 then
  raise exception 'Too many announcement previews. Try again later.' using errcode='54000';
 end if;
 if p_image_path is not null and (
  not spotivity_private.may_insert_announcement_image(p_image_path)
  or split_part(p_image_path,'/',2)<>p_campaign_id::text
  or not exists(select 1 from storage.objects o where o.bucket_id='announcement_images' and o.name=p_image_path
    and o.metadata->>'mimetype' in ('image/jpeg','image/png')
    and case when o.metadata->>'size' ~ '^[0-9]{1,8}$' then (o.metadata->>'size')::bigint between 1 and 5242880 else false end)
 ) then raise exception 'Upload a valid JPEG or PNG for this preview first.' using errcode='22023'; end if;
 select array_agg(a.user_id order by a.to_email,a.user_id),array_agg(a.to_email order by a.to_email,a.user_id),count(*)::integer,
  encode(sha256(convert_to(coalesce(string_agg(a.user_id::text||':'||a.to_email,E'\n' order by a.to_email,a.user_id),''),'UTF8')),'hex')
  into ids,emails,n,fingerprint from (select * from spotivity_private.announcement_audience(p_audience) limit 10001) a;
 if n>10000 then raise exception 'Announcement recipient limit exceeded.' using errcode='22023'; end if;
 insert into spotivity_private.announcement_campaigns(id,audience,subject,message,fingerprint,recipient_count,created_by,image_path)
  values(p_campaign_id,p_audience,p_subject,p_message,fingerprint,n,auth.uid(),p_image_path);
 insert into spotivity_private.announcement_recipients(campaign_id,user_id,to_email)
  select p_campaign_id,a.id,a.email from unnest(ids,emails) a(id,email);
 return spotivity_private.announcement_panel_summary(p_campaign_id);
end $$;

create function spotivity_private.queue_panel_announcement(p_campaign_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare webhook text; audience text;
begin
 select c.audience into audience from spotivity_private.announcement_campaigns c
  where c.id=p_campaign_id and c.created_by is not null and c.status='approved'
    and c.cancelled_at is null and c.approved_until>statement_timestamp()
    and exists(select 1 from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='pending');
 if not found then return; end if;
 if not exists(select 1 from spotivity_private.announcement_panel_config where ready)
  or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
  raise exception 'Announcement transport is not ready.' using errcode='55000';
 end if;
 select booking_webhook_url into webhook from spotivity_private.notification_config where singleton and ready;
 if webhook is null or webhook !~ '^https://hook\.(?:(?:eu|us)[0-9]+\.)?(?:make|integromat)\.com/[A-Za-z0-9_-]{10,}/?$' then
  raise exception 'Announcement transport is not ready.' using errcode='55000';
 end if;
 execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=5000)'
  using webhook,jsonb_build_object('kind','announcement_campaign_'||audience,'campaign_id',p_campaign_id),jsonb_build_object('Content-Type','application/json');
 update spotivity_private.announcement_campaigns set last_queued_at=statement_timestamp() where id=p_campaign_id;
end $$;
create function public.admin_announcement_send(p_campaign_id uuid,p_expected_count integer,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c spotivity_private.announcement_campaigns%rowtype;
begin
 perform spotivity_private.require_announcement_superadmin();
 select * into c from spotivity_private.announcement_campaigns where id=p_campaign_id for update;
 if not found or c.created_by is null then raise exception 'Panel campaign unavailable.' using errcode='42501'; end if;
 if p_expected_count is null or p_expected_count<>c.recipient_count or p_expected_count<1
  or p_fingerprint is null or p_fingerprint<>c.fingerprint then raise exception 'Review the exact preview before sending.' using errcode='40001'; end if;
 if c.cancelled_at is not null or (c.status='preview' and c.created_at+interval '24 hours'<=statement_timestamp())
  or (c.status='approved' and c.approved_until<=statement_timestamp()) then raise exception 'Campaign cancelled or expired.' using errcode='22023'; end if;
 if c.status='preview' then
  if c.fingerprint is distinct from spotivity_private.announcement_fingerprint(c.audience) then
   raise exception 'Audience changed. Create a new preview before sending.' using errcode='40001';
  end if;
  update spotivity_private.announcement_campaigns set status='approved',approved_at=statement_timestamp(),
   approved_until=statement_timestamp()+interval '24 hours' where id=c.id;
 end if;
 if c.last_queued_at is null or c.last_queued_at<statement_timestamp()-interval '30 seconds' then
  perform spotivity_private.queue_panel_announcement(c.id);
 end if;
 return spotivity_private.announcement_panel_summary(c.id);
end $$;
create function public.admin_announcement_cancel(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform spotivity_private.require_announcement_superadmin();
 perform 1 from spotivity_private.announcement_campaigns where id=p_campaign_id and created_by is not null for update;
 if not found then raise exception 'Panel campaign unavailable.' using errcode='42501'; end if;
 update spotivity_private.announcement_campaigns set cancelled_at=coalesce(cancelled_at,statement_timestamp()) where id=p_campaign_id;
 update spotivity_private.announcement_recipients set status='skipped',skip_reason='cancelled_by_superadmin'
  where campaign_id=p_campaign_id and status='pending';
 return spotivity_private.announcement_panel_summary(p_campaign_id);
end $$;
create function public.admin_announcement_history(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform spotivity_private.require_announcement_superadmin();
 return jsonb_build_object('ready',coalesce((select p.ready and n.ready from spotivity_private.announcement_panel_config p cross join spotivity_private.notification_config n where p.singleton and n.singleton),false),
  'campaigns',coalesce((select jsonb_agg(spotivity_private.announcement_panel_summary(c.id) order by c.created_at desc,c.id desc)
    from (select * from spotivity_private.announcement_campaigns where created_by is not null
      and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 21) c),'[]'::jsonb));
end $$;
create function public.announcement_pending(p_audience text,p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform spotivity_private.authorize_announcement(p_audience);
 if not exists(select 1 from spotivity_private.announcement_campaigns where id=p_campaign_id and audience=p_audience
  and status='approved' and cancelled_at is null and approved_until>statement_timestamp() and created_by is not null) then
  return jsonb_build_object('recipients','[]'::jsonb);
 end if;
 return jsonb_build_object('recipients',coalesce((select jsonb_agg(jsonb_build_object('recipient_id',id) order by id)
  from spotivity_private.announcement_recipients where campaign_id=p_campaign_id and status='pending'),'[]'::jsonb));
end $$;
create function spotivity_private.wake_panel_announcements()
returns void language plpgsql security definer set search_path='' as $$
declare c record;
begin
 if not exists(select 1 from spotivity_private.announcement_panel_config where ready) then return; end if;
 for c in select id from spotivity_private.announcement_campaigns c where created_by is not null and status='approved'
  and cancelled_at is null and approved_until>statement_timestamp() and (last_queued_at is null or last_queued_at<statement_timestamp()-interval '2 minutes')
  and exists(select 1 from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='pending')
  order by created_at limit 5 for update skip locked loop
  begin perform spotivity_private.queue_panel_announcement(c.id); exception when others then null; end;
 end loop;
end $$;

create or replace function public.announcement_claim(
  p_audience text,p_campaign_id uuid,p_recipient_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign spotivity_private.announcement_campaigns%rowtype;
  recipient spotivity_private.announcement_recipients%rowtype; lease uuid; html text; plain_text text;
begin
  perform spotivity_private.authorize_announcement(p_audience);
  select * into campaign from spotivity_private.announcement_campaigns where id=p_campaign_id for share;
  if not found or campaign.audience is distinct from p_audience then
    raise exception 'Announcement campaign unavailable.' using errcode='42501';
  end if;
  select * into recipient from spotivity_private.announcement_recipients
    where id=p_recipient_id and campaign_id=campaign.id for update;
  if not found then raise exception 'Announcement recipient unavailable.' using errcode='42501'; end if;
  if recipient.status<>'pending' then
    return jsonb_build_object('send',false,'recipient_id',recipient.id,'status',recipient.status);
  end if;
  if campaign.status<>'approved' then
    return jsonb_build_object('send',false,'recipient_id',recipient.id,'status','not_approved');
  end if;
  if campaign.approved_until<=statement_timestamp() then
    update spotivity_private.announcement_recipients set status='skipped',skip_reason='approval_expired' where id=recipient.id;
    return jsonb_build_object('send',false,'recipient_id',recipient.id,'status','approval_expired');
  end if;
  if not exists(select 1 from spotivity_private.announcement_audience(p_audience) a
    where a.user_id=recipient.user_id and a.to_email=recipient.to_email) then
    update spotivity_private.announcement_recipients set status='skipped',skip_reason='audience_changed' where id=recipient.id;
    return jsonb_build_object('send',false,'recipient_id',recipient.id,'status','audience_changed');
  end if;
  lease:=gen_random_uuid();
  update spotivity_private.announcement_recipients set status='sending',lease_token=lease,claimed_at=statement_timestamp()
    where id=recipient.id;
  return jsonb_build_object('send',true,'recipient_id',recipient.id,'lease_token',lease,
    'to_email',recipient.to_email)||spotivity_private.announcement_mail(campaign.subject,campaign.message,campaign.image_path);
end
$$;

revoke all on function spotivity_private.require_announcement_superadmin(),
 spotivity_private.may_insert_announcement_image(text),spotivity_private.guard_announcement_image(),spotivity_private.announcement_mail(text,text,text),
 spotivity_private.announcement_panel_summary(uuid),spotivity_private.queue_panel_announcement(uuid),
 spotivity_private.wake_panel_announcements(),public.admin_announcement_preview(uuid,text,text,text,text),
 public.admin_announcement_send(uuid,integer,text),public.admin_announcement_cancel(uuid),
 public.admin_announcement_history(timestamptz,uuid),public.announcement_pending(text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function spotivity_private.may_insert_announcement_image(text),
 public.admin_announcement_preview(uuid,text,text,text,text),public.admin_announcement_send(uuid,integer,text),
 public.admin_announcement_cancel(uuid),public.admin_announcement_history(timestamptz,uuid) to authenticated;
grant execute on function public.announcement_pending(text,uuid) to anon,authenticated,service_role;
-- pg_cron is optional in disposable tests; hosted projects recover queued work.
do $cron$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  execute 'select cron.schedule($1,$2,$3)' using 'spotivity-announcement-retry','*/2 * * * *','select spotivity_private.wake_panel_announcements()';
 end if;
end $cron$;
insert into spotivity_private.migrations(version) values(30);
notify pgrst,'reload schema';
commit;
