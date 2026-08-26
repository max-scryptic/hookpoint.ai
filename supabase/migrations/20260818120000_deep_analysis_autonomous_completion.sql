-- Letting a deep analysis finish without anyone watching it.
--
-- The pipeline runs as one best-effort pass per serverless invocation. A long
-- video's extraction routinely outlives that invocation, and when the platform
-- kills it there is no catch block, no lease release and no queue: the run row
-- sits 'running' until the staleness sweep reclaims it and its rows sit
-- 'pending' with nothing left to claim them. Recovery depended entirely on the
-- owner reopening the report page, because that page's progress poll was the
-- only thing that ever re-kicked the pipeline. Production runs show the shape
-- of it: a run dying in `extraction`, eight silent minutes, then a 19-second
-- run - the one the returning user's poll started - finishing everything.
--
-- Two things replace that user. A pass now hands its leftovers to a fresh
-- invocation before its budget runs out (recorded here as the 'paused' status),
-- and a scheduled sweep resumes whatever stalled anyway. This migration adds
-- the columns those need, and schedules the sweep from the database itself
-- rather than from a hosting-plan-dependent cron.

-- A pass that stopped early to hand over is neither ready nor failed: the
-- analysis is still coming, so the report keeps its processing badge instead of
-- showing a retry prompt. It holds no lease - only 'running' does - so the next
-- invocation can claim the video immediately.
alter table public.deep_analysis_pipeline_runs
  drop constraint if exists deep_analysis_pipeline_runs_status_check;

alter table public.deep_analysis_pipeline_runs
  add constraint deep_analysis_pipeline_runs_status_check
    check (status in ('running', 'ready', 'paused', 'failed'));

-- How much deep-analysis work the pass left behind, counted across every table
-- the pipeline writes rows into. This is how the watchdog tells a video that is
-- still inching forward from one that is genuinely stuck: consecutive passes
-- leaving *exactly* the same amount behind mean the remaining rows are ones no
-- stage can claim, and resuming them for ever would burn money to no effect.
-- Null means the pass couldn't measure it (it was killed, or the count failed),
-- which says nothing either way and is ignored rather than read as no progress.
alter table public.deep_analysis_pipeline_runs
  add column if not exists unsettled_after integer;

comment on column public.deep_analysis_pipeline_runs.unsettled_after is
  'Rows still awaiting a pipeline stage when this pass ended; null when unmeasured.';

-- The sweep reads the latest runs per video on every tick.
create index if not exists deep_analysis_pipeline_runs_video_recent_idx
  on public.deep_analysis_pipeline_runs (analysed_video_id, started_at desc);

-- The scheduler. pg_cron + pg_net live in the database, so the watchdog's
-- cadence doesn't depend on the hosting plan's cron granularity, and it keeps
-- ticking for preview deployments and self-hosted runs alike.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema public;

create schema if not exists maintenance;
revoke all on schema maintenance from public;

-- Calls the app's watchdog endpoint. Configuration lives in Vault rather than
-- in this function, so the same migration works across environments and no
-- secret is ever written into a migration file or a cron job's command text:
--
--   select vault.create_secret(
--     'https://<your-app-host>/api/cron/resume-deep-analysis',
--     'deep_analysis_resume_url');
--   select vault.create_secret('<same value as DEEP_ANALYSIS_CRON_SECRET>',
--     'deep_analysis_cron_secret');
--   -- only for deployments behind Vercel deployment protection:
--   select vault.create_secret('<VERCEL_AUTOMATION_BYPASS_SECRET>',
--     'deep_analysis_bypass_secret');
--
-- Until both required secrets exist the function returns without calling
-- anything, so applying this migration to an environment that hasn't been
-- configured yet is inert rather than noisy.
create or replace function maintenance.resume_stalled_deep_analysis()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint_url text;
  cron_secret text;
  bypass_secret text;
  request_headers jsonb;
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

  request_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || cron_secret
  );

  select decrypted_secret into bypass_secret
  from vault.decrypted_secrets
  where name = 'deep_analysis_bypass_secret';

  if bypass_secret is not null then
    request_headers := request_headers
      || jsonb_build_object('x-vercel-protection-bypass', bypass_secret);
  end if;

  -- Fire and forget: pg_net queues the request and returns immediately. The
  -- endpoint answers as soon as it has dispatched the work, so nothing here
  -- waits on a pipeline pass.
  perform net.http_get(
    url := endpoint_url,
    headers := request_headers,
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function maintenance.resume_stalled_deep_analysis() from public;

-- Every five minutes: often enough that a stalled analysis finishes while its
-- owner is still in the app, rare enough that a video whose pass is genuinely
-- running is almost never poked (a live lease and a 90-second cooldown make an
-- overlapping tick a no-op anyway). Rescheduling is idempotent - cron.schedule
-- updates the job when the name already exists.
select cron.schedule(
  'resume-stalled-deep-analysis',
  '*/5 * * * *',
  $$select maintenance.resume_stalled_deep_analysis()$$
);
