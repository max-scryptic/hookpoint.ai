-- A heartbeat that kicks stalled deep-analysis pipelines back into motion.
--
-- The deep-analysis pipeline advances by being poked: each stage re-triggers the
-- next, and the report page re-triggers whatever is unsettled while someone is
-- watching it (see lib/retention-window-media-progress.ts). A run that stalls
-- with nobody watching has nothing to poke it, so this schedules the poke from
-- the database instead: every five minutes, pg_cron calls the resume endpoint
-- over HTTP through pg_net.
--
-- The endpoint and the shared secret it authenticates with are read out of Vault
-- rather than baked in here, so this migration carries no credentials and the
-- same schedule works against whichever deployment the secrets point at. Until
-- both secrets exist the function returns without calling anything, so a project
-- that has not been given them simply runs a no-op every five minutes.
--
-- The function lives in its own `maintenance` schema, which is revoked from the
-- public API roles: nothing here is reachable from the client.
--
-- Applied directly to the project on 2026-08-10 and captured as a file
-- afterwards, so a database rebuilt from this directory ends up with the same
-- schedule. The version matches the applied migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists maintenance;
revoke all on schema maintenance from public;
revoke all on schema maintenance from anon, authenticated;

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

select cron.unschedule('resume-stalled-deep-analysis')
where exists (
  select 1 from cron.job where jobname = 'resume-stalled-deep-analysis'
);

select cron.schedule(
  'resume-stalled-deep-analysis',
  '*/5 * * * *',
  $$select maintenance.resume_stalled_deep_analysis()$$
);
