-- Lets the scheduled sweep through Vercel's Deployment Protection.
--
-- The project has Vercel Authentication enabled for everything except custom
-- domains, so a request from outside — which is what pg_net now is — is caught
-- by that auth layer and answered with a login redirect before it ever reaches
-- the route. Vercel's own cron invocations were exempt from this automatically;
-- an external scheduler is not, and this is the cost of that trade.
--
-- Two ways through, and this supports either:
--   * point deep_analysis_resume_url at a custom domain, which is exempt under
--     the project's current 'all_except_custom_domains' setting, or
--   * create a third Vault secret, deep_analysis_bypass_secret, holding the
--     project's Protection Bypass for Automation value — sent as the
--     x-vercel-protection-bypass header, which is exactly what that feature is
--     for.
--
-- The bypass secret stays optional: when it is absent the headers are built
-- without it, so a deployment reached over an exempt custom domain needs no
-- extra configuration, and one reached over a *.vercel.app URL only needs the
-- secret adding. Nothing else about the sweep changes.

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

  perform net.http_get(
    url := endpoint_url,
    headers := request_headers,
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function maintenance.resume_stalled_deep_analysis() from public;
revoke all on function maintenance.resume_stalled_deep_analysis() from anon, authenticated;
