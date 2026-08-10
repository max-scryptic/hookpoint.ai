-- Schedules the deep-analysis resume sweep from Postgres rather than from
-- Vercel's cron.
--
-- The sweep itself is an HTTP endpoint in the app
-- (/api/cron/resume-deep-analysis); this only decides how often something
-- calls it. Vercel would be the obvious scheduler, but its Hobby plan allows
-- cron jobs to run at most once per day and *fails the deployment* for any
-- expression more frequent than that — and a sweep that runs daily is worse
-- than useless here, since a video stalled just after a sweep would sit on
-- "Processing…" for the best part of a day. pg_cron has no such limit, runs
-- identically whatever the app is deployed on, and makes the interval a value
-- that can be retuned with one SQL statement instead of a redeploy.
--
-- Configuration lives in Vault rather than in this file, because one half of it
-- is a shared secret and migrations are committed to the repository. Both
-- secrets must be created for the sweep to do anything (see the comment on
-- maintenance.resume_stalled_deep_analysis) — until then every tick is a
-- deliberate no-op rather than a failing job.

-- pg_cron registers itself under pg_catalog and exposes its API in the `cron`
-- schema; pg_net registers wherever the search_path points but always exposes
-- its API in the `net` schema. Both are referenced by those API schemas below,
-- which is what makes the qualified names in this file correct regardless of
-- where the extensions themselves ended up.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Deliberately not `public`: functions there are reachable through PostgREST,
-- and nothing outside the scheduler has any business invoking this.
create schema if not exists maintenance;
revoke all on schema maintenance from public;
revoke all on schema maintenance from anon, authenticated;

-- Calls the app's resume-sweep endpoint, if and only if it has been configured.
--
-- Requires two Vault secrets, which are intentionally NOT created here:
--   deep_analysis_resume_url    - full URL of the endpoint, e.g.
--                                 https://<your-app>/api/cron/resume-deep-analysis
--   deep_analysis_cron_secret   - must equal the app's CRON_SECRET env var
--
-- With either missing the function returns without making a request, so
-- scheduling this before the secrets exist is safe: the job simply does nothing
-- until it is configured, instead of erroring every five minutes.
--
-- The request is fire-and-forget by nature — pg_net queues it and returns an id
-- immediately, and the endpoint itself responds as soon as it has decided what
-- to resume, doing the actual work in the background. Nothing here waits for or
-- inspects the outcome; the endpoint's own logging is the record of what it did.
create or replace function maintenance.resume_stalled_deep_analysis()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint_url text;
  cron_secret text;
begin
  select decrypted_secret into endpoint_url
  from vault.decrypted_secrets
  where name = 'deep_analysis_resume_url';

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'deep_analysis_cron_secret';

  if endpoint_url is null or cron_secret is null then
    return;
  end if;

  perform net.http_get(
    url := endpoint_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function maintenance.resume_stalled_deep_analysis() from public;
revoke all on function maintenance.resume_stalled_deep_analysis() from anon, authenticated;

-- Every five minutes: comfortably above the pipeline's own three-minute lease
-- staleness window, so a sweep never races a run that is merely between
-- heartbeats, and short enough that a stall nobody is watching is measured in
-- minutes. Unscheduled first so re-running this migration cannot end up with
-- two copies of the job.
select cron.unschedule('resume-stalled-deep-analysis')
where exists (
  select 1 from cron.job where jobname = 'resume-stalled-deep-analysis'
);

select cron.schedule(
  'resume-stalled-deep-analysis',
  '*/5 * * * *',
  $$select maintenance.resume_stalled_deep_analysis()$$
);
