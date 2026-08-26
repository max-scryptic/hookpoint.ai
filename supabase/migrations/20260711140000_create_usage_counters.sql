-- Per-billing-window usage tallies. Each row counts one user's consumption
-- within a single usage window, identified by (user_id, period_start). The
-- period_start is the start of the monthly window the app computed at
-- consumption time:
--   • monthly paid plans → billing_subscriptions.current_period_start
--   • annual paid plans  → monthly slice anchored to current_period_start
--   • Free plan          → monthly window anchored to account creation
-- Because the window start is part of the key, a new window simply lands on a
-- new row that starts at zero - that is how limits "reset" on the billing date
-- without any scheduled job to clear counters.
--
-- Locked down exactly like billing_customers/billing_subscriptions: RLS on, no
-- policies, so only the service-role admin client (server-side) can touch it.
create table public.usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Start of the billing window this tally belongs to.
  period_start timestamptz not null,
  -- Shallow (YouTube-API) analyses started in this window.
  video_analyses_used integer not null default 0 check (video_analyses_used >= 0),
  -- Deep-dive credits spent in this window (1 credit = 1 minute of source video).
  deep_credits_used integer not null default 0 check (deep_credits_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

alter table public.usage_counters enable row level security;

-- No policies on purpose: deny all access to anon/authenticated.

create trigger set_public_usage_counters_updated_at
  before update on public.usage_counters
  for each row
  execute function private.set_updated_at();

-- Atomically add to a user's tally for a window, creating the row on first use.
-- Runs as a single upsert so concurrent analyses/uploads can't lose an
-- increment to a read-modify-write race. SECURITY DEFINER + a pinned empty
-- search_path so it always resolves public.usage_counters regardless of caller,
-- and returns the new running totals so callers can enforce a ceiling.
create or replace function public.increment_usage_counters(
  p_user_id uuid,
  p_period_start timestamptz,
  p_video_analyses integer,
  p_deep_credits integer
)
returns table (video_analyses_used integer, deep_credits_used integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  insert into public.usage_counters as uc (
    user_id, period_start, video_analyses_used, deep_credits_used
  )
  values (
    p_user_id,
    p_period_start,
    greatest(p_video_analyses, 0),
    greatest(p_deep_credits, 0)
  )
  on conflict (user_id, period_start) do update
    set video_analyses_used =
          uc.video_analyses_used + greatest(p_video_analyses, 0),
        deep_credits_used =
          uc.deep_credits_used + greatest(p_deep_credits, 0)
  returning uc.video_analyses_used, uc.deep_credits_used;
end;
$$;

-- Only the service role should ever call this; deny the public API roles.
revoke all on function public.increment_usage_counters(
  uuid, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.increment_usage_counters(
  uuid, timestamptz, integer, integer
) to service_role;
