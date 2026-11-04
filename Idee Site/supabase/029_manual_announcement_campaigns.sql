-- Manual, audience-scoped announcement delivery for the private Make scenarios.
-- No emails are sent by this migration or by these RPCs. No existing account,
-- booking, notification, allocation or RLS policy is changed.
-- Provision independent random capability tokens outside SQL; store only their
-- SHA-256 hashes in announcement_credentials and keep their plaintext in Make.
begin;

do $prerequisite$
begin
  if to_regclass('spotivity_private.migrations') is null
    or not exists(select 1 from spotivity_private.migrations where version=27) then
    raise exception 'Apply migration 027 before migration 029.';
  end if;
  if exists(select 1 from spotivity_private.migrations where version>29) then
    raise exception 'Do not reapply migration 029 over a later migration.';
  end if;
  if not exists(select 1 from spotivity_private.migrations where version=29)
    and (to_regclass('spotivity_private.announcement_credentials') is not null
      or to_regclass('spotivity_private.announcement_campaigns') is not null
      or to_regclass('spotivity_private.announcement_recipients') is not null
      or to_regprocedure('public.announcement_preview(text,uuid,text,text)') is not null
      or to_regprocedure('public.announcement_approve(text,uuid,integer)') is not null
      or to_regprocedure('public.announcement_claim(text,uuid,uuid)') is not null
      or to_regprocedure('public.announcement_finish(text,uuid,uuid,uuid)') is not null) then
    raise exception 'Review unregistered announcement objects before migration 029.';
  end if;
end
$prerequisite$;

create table if not exists spotivity_private.announcement_credentials(
  audience text primary key check(audience in ('clients','admins')),
  token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default false
);
create table if not exists spotivity_private.announcement_campaigns(
  id uuid primary key,
  audience text not null check(audience in ('clients','admins')),
  subject text not null,
  message text not null,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  recipient_count integer not null check(recipient_count between 0 and 10000),
  status text not null default 'preview' check(status in ('preview','approved')),
  created_at timestamptz not null default statement_timestamp(),
  approved_at timestamptz,
  approved_until timestamptz,
  check((status='preview' and approved_at is null and approved_until is null)
    or (status='approved' and approved_at is not null and approved_until>approved_at))
);
create table if not exists spotivity_private.announcement_recipients(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references spotivity_private.announcement_campaigns(id),
  user_id uuid not null,
  to_email text not null check(to_email=lower(btrim(to_email)) and to_email<>''),
  status text not null default 'pending' check(status in ('pending','sending','sent','skipped')),
  skip_reason text,
  lease_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  unique(campaign_id,to_email),
  unique(campaign_id,user_id),
  check((status in ('pending','skipped') and lease_token is null)
    or (status in ('sending','sent') and lease_token is not null and claimed_at is not null)),
  check(status<>'sent' or sent_at is not null)
);
create index if not exists spotivity_announcement_pending
  on spotivity_private.announcement_recipients(campaign_id,status,id);
alter table spotivity_private.announcement_credentials enable row level security;
alter table spotivity_private.announcement_campaigns enable row level security;
alter table spotivity_private.announcement_recipients enable row level security;
revoke all on spotivity_private.announcement_credentials,
  spotivity_private.announcement_campaigns,spotivity_private.announcement_recipients
  from public,anon,authenticated,service_role;

create or replace function spotivity_private.authorize_announcement(p_audience text)
returns void language plpgsql security definer set search_path='' as $$
declare headers jsonb; capability text; digest text;
begin
  if p_audience is null or p_audience not in ('clients','admins') then
    raise exception 'Announcement access denied.' using errcode='42501';
  end if;
  begin
    headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
    capability:=headers->>'x-spotivity-announcement-key';
  exception when others then
    raise exception 'Announcement access denied.' using errcode='42501';
  end;
  if capability is null or char_length(capability) not between 32 and 256
    or capability ~ '[[:space:][:cntrl:]]' then
    raise exception 'Announcement access denied.' using errcode='42501';
  end if;
  digest:=encode(pg_catalog.sha256(convert_to(capability,'UTF8')),'hex');
  if not exists(select 1 from spotivity_private.announcement_credentials c
    where c.audience=p_audience and c.enabled and c.token_hash=digest) then
    raise exception 'Announcement access denied.' using errcode='42501';
  end if;
end
$$;

-- Profiles are not roles: all administrators also have a clienti row.
-- Guest booking contacts are deliberately never an announcement audience.
-- Exclude every admin UUID and current normalized admin mailbox from clients,
-- including an administrator whose account currently fails eligibility checks.
create or replace function spotivity_private.announcement_audience(p_audience text)
returns table(user_id uuid,to_email text)
language sql stable security definer set search_path='' as $$
  select distinct on (lower(btrim(u.email))) u.id,lower(btrim(u.email))
  from auth.users u
  where u.email is not null and btrim(u.email)<>''
    and u.email_confirmed_at is not null
    and coalesce(to_jsonb(u)->>'deleted_at','')=''
    and coalesce(nullif(to_jsonb(u)->>'banned_until','')::timestamptz,'-infinity'::timestamptz)<=statement_timestamp()
    and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false) is false
    and (
      (p_audience='clients'
        and exists(select 1 from public.clienti c where c.user_id=u.id)
        and not exists(select 1 from public.users_admin a where a.user_id=u.id)
        and not exists(select 1 from public.users_admin a join auth.users admin_user on admin_user.id=a.user_id
          where lower(btrim(admin_user.email))=lower(btrim(u.email))))
      or (p_audience='admins' and exists(select 1 from public.users_admin a where a.user_id=u.id))
    )
  order by lower(btrim(u.email)),u.id
$$;

create or replace function spotivity_private.announcement_fingerprint(p_audience text)
returns text language sql stable security definer set search_path='' as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(
    string_agg(a.user_id::text||':'||a.to_email,E'\n' order by a.to_email,a.user_id),''),'UTF8')),'hex')
  from spotivity_private.announcement_audience(p_audience) a
$$;
create or replace function spotivity_private.announcement_escape(value text)
returns text language sql immutable set search_path='' as $$
  select replace(replace(replace(replace(replace(value,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')
$$;
create or replace function spotivity_private.announcement_summary(p_campaign_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('campaign_id',c.id,'audience',c.audience,'status',c.status,
    'count',c.recipient_count,'fingerprint',c.fingerprint,'created_at',c.created_at,
    'approved_until',c.approved_until,
    'expired',case when c.status='approved' then c.approved_until<=statement_timestamp() else c.created_at+interval '24 hours'<=statement_timestamp() end,
    'manual_reconcile',exists(select 1 from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='sending'),
    'stale',c.fingerprint is distinct from spotivity_private.announcement_fingerprint(c.audience),
    'stage',jsonb_build_object(
      'pending',(select count(*) from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='pending'),
      'sending',(select count(*) from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='sending'),
      'sent',(select count(*) from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='sent'),
      'skipped',(select count(*) from spotivity_private.announcement_recipients r where r.campaign_id=c.id and r.status='skipped')))
  from spotivity_private.announcement_campaigns c where c.id=p_campaign_id
$$;

create or replace function public.announcement_preview(
  p_audience text,p_campaign_id uuid,p_subject text,p_message text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign spotivity_private.announcement_campaigns%rowtype;
  audience_ids uuid[]; audience_emails text[]; audience_count integer; fingerprint text;
begin
  perform spotivity_private.authorize_announcement(p_audience);
  p_subject:=btrim(p_subject);
  p_message:=btrim(replace(replace(p_message,E'\r\n',E'\n'),E'\r',E'\n'));
  if p_campaign_id is null or p_subject is null or char_length(p_subject) not between 1 and 180
    or p_subject ~ '[[:cntrl:]]' or p_message is null or char_length(p_message) not between 1 and 20000
    or p_message ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'Provide a campaign UUID, a subject of 1 to 180 characters and a plain-text message of 1 to 20000 characters.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('spotivity-announcement:'||p_campaign_id::text,0));
  select * into campaign from spotivity_private.announcement_campaigns where id=p_campaign_id for update;
  if found then
    if (campaign.audience,campaign.subject,campaign.message) is distinct from (p_audience,p_subject,p_message) then
      raise exception 'Campaign identifier already belongs to different content or audience.' using errcode='22023';
    end if;
    return spotivity_private.announcement_summary(campaign.id);
  end if;
  -- Collect one bounded, consistent recipient snapshot in a single query.
  select array_agg(a.user_id order by a.to_email,a.user_id),
    array_agg(a.to_email order by a.to_email,a.user_id),count(*)::integer,
    encode(pg_catalog.sha256(convert_to(coalesce(string_agg(a.user_id::text||':'||a.to_email,E'\n' order by a.to_email,a.user_id),''),'UTF8')),'hex')
    into audience_ids,audience_emails,audience_count,fingerprint
  from (select * from spotivity_private.announcement_audience(p_audience) limit 10001) a;
  if audience_count>10000 then raise exception 'The announcement audience exceeds the manual campaign limit.' using errcode='22023'; end if;
  insert into spotivity_private.announcement_campaigns(id,audience,subject,message,fingerprint,recipient_count)
    values(p_campaign_id,p_audience,p_subject,p_message,fingerprint,audience_count);
  insert into spotivity_private.announcement_recipients(campaign_id,user_id,to_email)
    select p_campaign_id,a.user_id,a.to_email from unnest(audience_ids,audience_emails) a(user_id,to_email);
  return spotivity_private.announcement_summary(p_campaign_id);
end
$$;

create or replace function public.announcement_approve(
  p_audience text,p_campaign_id uuid,p_expected_count integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign spotivity_private.announcement_campaigns%rowtype;
begin
  perform spotivity_private.authorize_announcement(p_audience);
  select * into campaign from spotivity_private.announcement_campaigns where id=p_campaign_id for update;
  if not found or campaign.audience is distinct from p_audience then
    raise exception 'Announcement campaign unavailable.' using errcode='42501';
  end if;
  if p_expected_count is null or p_expected_count<>campaign.recipient_count
    or campaign.fingerprint is distinct from spotivity_private.announcement_fingerprint(p_audience) then
    raise exception 'Announcement preview changed. Create a new campaign and review it before approval.' using errcode='40001';
  end if;
  if (campaign.status='preview' and campaign.created_at+interval '24 hours'<=statement_timestamp())
    or (campaign.status='approved' and campaign.approved_until<=statement_timestamp()) then
    raise exception 'Announcement approval expired. Create a new campaign.' using errcode='22023';
  end if;
  if campaign.status='preview' then
    update spotivity_private.announcement_campaigns set status='approved',
      approved_at=statement_timestamp(),approved_until=statement_timestamp()+interval '24 hours'
      where id=campaign.id;
  end if;
  return jsonb_build_object('campaign_id',campaign.id,'audience',campaign.audience,'status','approved',
    'count',campaign.recipient_count,'recipients',coalesce((select jsonb_agg(jsonb_build_object('recipient_id',r.id) order by r.id)
      from spotivity_private.announcement_recipients r where r.campaign_id=campaign.id),'[]'::jsonb));
end
$$;

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
  plain_text:='Spotivity'||E'\n\n'||campaign.subject||E'\n\n'||campaign.message||E'\n\n'||'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/'||E'\n'||'Contact: spotivity.rezervari@gmail.com';
  html:='<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>'
    ||spotivity_private.announcement_escape(campaign.subject)||'</title></head><body style="margin:0;padding:24px;background:#edf2eb;color:#172b20;font-family:Arial,sans-serif">'
    ||'<main style="max-width:620px;margin:auto;padding:28px;background:#fff;border-radius:16px"><p style="font-weight:bold">Spotivity</p><h1 style="font-size:24px">'
    ||spotivity_private.announcement_escape(campaign.subject)||'</h1><p style="line-height:1.6">'
    ||replace(spotivity_private.announcement_escape(campaign.message),E'\n','<br>')
    ||'</p><p><a href="https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/">Deschide Spotivity</a></p><p style="font-size:13px;color:#526052">Contact: <a href="mailto:spotivity.rezervari@gmail.com">spotivity.rezervari@gmail.com</a></p></main></body></html>';
  return jsonb_build_object('send',true,'recipient_id',recipient.id,'lease_token',lease,
    'to_email',recipient.to_email,'subject',campaign.subject,'html',html,'text',plain_text);
end
$$;

create or replace function public.announcement_finish(
  p_audience text,p_campaign_id uuid,p_recipient_id uuid,p_lease_token uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare recipient spotivity_private.announcement_recipients%rowtype;
begin
  perform spotivity_private.authorize_announcement(p_audience);
  if not exists(select 1 from spotivity_private.announcement_campaigns c
    where c.id=p_campaign_id and c.audience=p_audience) then
    raise exception 'Announcement campaign unavailable.' using errcode='42501';
  end if;
  select * into recipient from spotivity_private.announcement_recipients
    where id=p_recipient_id and campaign_id=p_campaign_id for update;
  if not found or p_lease_token is null or recipient.lease_token is distinct from p_lease_token
    or recipient.status not in ('sending','sent') then
    raise exception 'Announcement delivery acknowledgement unavailable.' using errcode='42501';
  end if;
  if recipient.status='sending' then
    update spotivity_private.announcement_recipients set status='sent',sent_at=statement_timestamp() where id=recipient.id;
  end if;
  return jsonb_build_object('sent',true,'campaign_id',p_campaign_id,'recipient_id',recipient.id);
end
$$;

revoke all on function spotivity_private.authorize_announcement(text),
  spotivity_private.announcement_audience(text),spotivity_private.announcement_fingerprint(text),
  spotivity_private.announcement_escape(text),spotivity_private.announcement_summary(uuid),
  public.announcement_preview(text,uuid,text,text),public.announcement_approve(text,uuid,integer),
  public.announcement_claim(text,uuid,uuid),public.announcement_finish(text,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
-- PostgREST's public project key identifies the request; the independent scoped
-- capability authorizes it. None of these grants exposes a private table.
grant execute on function public.announcement_preview(text,uuid,text,text),
  public.announcement_approve(text,uuid,integer),public.announcement_claim(text,uuid,uuid),
  public.announcement_finish(text,uuid,uuid,uuid) to anon,authenticated,service_role;
comment on table spotivity_private.announcement_campaigns is
  'Manual audience/message snapshots only. Approval expires after 24 hours. New accounts are never automatically added.';
comment on table spotivity_private.announcement_recipients is
  'One mailbox per campaign. Sending is never automatically retried: reconcile ambiguous Gmail acceptance manually before creating another campaign.';
insert into spotivity_private.migrations(version) values(29) on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
