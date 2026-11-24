-- 052: announcement emails use the company address and the final domain
-- (owner's request, 24.11.2026: Google Workspace, contact@spotivity.ro is the
-- official SRL address).
--  * Footer contact: contact@spotivity.ro instead of spotivity.rezervari@gmail.com.
--  * "Deschide Spotivity" link: https://spotivity.ro/. 031 (which only changed
--    this link) was never applied on production; 052 supersedes it, and 031's
--    own hash guard will refuse to run after 052.
-- Rendering only: no approvals, deliveries, recipient changes or account writes.
begin;
do $guard$ begin
 if not exists(select 1 from spotivity_private.migrations where version=30) then
  raise exception 'Apply 030 before 052.';
 end if;
 if exists(select 1 from spotivity_private.migrations where version=52) then
  raise exception 'Migration 052 is already applied or superseded.';
 end if;
 -- Accept only the reviewed renderers: 030 (live today) or 031 (final-domain links).
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('spotivity_private.announcement_mail(text,text,text)')
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='i'
   and p.proconfig=array['search_path=""']::text[]
   and md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n')) in ('6864c33f85d0fb3781bc8640d0e8e8de','d40b4fd4d71b92bcda942a7aef2f6ec3')) then
  raise exception 'Review the current announcement renderer before migration 052.';
 end if;
end $guard$;

create or replace function spotivity_private.announcement_mail(p_subject text,p_message text,p_image_path text default null)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'subject',p_subject,
  'text','Spotivity'||E'\n\n'||p_subject||E'\n\n'||p_message||E'\n\nhttps://spotivity.ro/\nContact: contact@spotivity.ro',
  'html','<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'||spotivity_private.announcement_escape(p_subject)||'</title></head>'
  ||'<body style="margin:0;padding:16px 8px;background:#edf2eb;color:#172b20;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
  ||'<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px"><tr><td style="padding:24px;overflow-wrap:anywhere;word-break:break-word">'
  ||'<p style="margin:0 0 20px;font-weight:bold;color:#366142">Spotivity</p><h1 style="margin:0 0 20px;font-size:24px;line-height:1.3">'||spotivity_private.announcement_escape(p_subject)||'</h1>'
  ||case when p_image_path is null then '' else '<img width="552" src="https://ndubcdwohqzgxpuiowye.supabase.co/storage/v1/object/public/announcement_images/'||spotivity_private.announcement_escape(p_image_path)||'" alt="'||spotivity_private.announcement_escape(p_subject)||'" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:10px;margin:0 0 20px">' end
  ||'<p style="margin:0 0 24px;font-size:16px;line-height:1.65">'||replace(spotivity_private.announcement_escape(p_message),E'\n','<br>')||'</p>'
  ||'<p><a href="https://spotivity.ro/" style="color:#366142">Deschide Spotivity</a></p><p style="font-size:13px;line-height:1.6;color:#526052">Contact: <a href="mailto:contact@spotivity.ro">contact@spotivity.ro</a></p>'
  ||'</td></tr></table></td></tr></table></body></html>')
$$;

revoke all on function spotivity_private.announcement_mail(text,text,text) from public,anon,authenticated,service_role;
insert into spotivity_private.migrations(version) values(52);
notify pgrst,'reload schema';
commit;
