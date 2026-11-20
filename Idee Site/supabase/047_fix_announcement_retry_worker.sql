-- 047: repair the announcement retry worker (cron "spotivity-announcement-retry").
-- In 030 the loop variable and the table alias were both named "c", so the
-- EXISTS subquery read the unassigned PL/pgSQL record instead of the row and
-- every run failed with "record c is not assigned yet". The retry of approved
-- panel campaigns therefore never ran. Same logic, loop variable renamed.
-- Safe to re-run. Apply as postgres.
begin;

create or replace function spotivity_private.wake_panel_announcements()
returns void language plpgsql security definer set search_path='' as $$
declare v_campaign record;
begin
 if not exists(select 1 from spotivity_private.announcement_panel_config where ready) then return; end if;
 for v_campaign in select ac.id from spotivity_private.announcement_campaigns ac where ac.created_by is not null and ac.status='approved'
  and ac.cancelled_at is null and ac.approved_until>statement_timestamp() and (ac.last_queued_at is null or ac.last_queued_at<statement_timestamp()-interval '2 minutes')
  and exists(select 1 from spotivity_private.announcement_recipients r where r.campaign_id=ac.id and r.status='pending')
  order by ac.created_at limit 5 for update of ac skip locked loop
  begin perform spotivity_private.queue_panel_announcement(v_campaign.id); exception when others then null; end;
 end loop;
end $$;
revoke all on function spotivity_private.wake_panel_announcements() from public, anon, authenticated, service_role;

insert into spotivity_private.migrations(version) values(47) on conflict(version) do nothing;
commit;
