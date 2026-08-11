-- Lets the resume heartbeat past Vercel's deployment protection.
--
-- The heartbeat scheduled by the migration before this one calls the resume
-- endpoint with nothing but its shared secret, which is enough for the endpoint
-- itself but not enough to reach it: a deployment behind Vercel's protection
-- turns the request away before the app ever sees it. Sending the bypass token
-- as a header is what gets the heartbeat through.
--
-- The token is read out of Vault like the other two, and it is the only optional
-- one: a deployment that is not protected simply never has it, and the request
-- goes out with the Authorization header alone. Everything else about the
-- function is unchanged.
--
-- Applied directly to the project on 2026-08-10 and captured as a file
-- afterwards, so a database rebuilt from this directory ends up with the same
-- function. The version matches the applied migration.

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
