-- Records that a user was active on a given calendar day (UTC), so the admin
-- dashboard can chart daily active users over time.
--
-- Why a dedicated table instead of auth.users.last_sign_in_at: that column only
-- ever holds the *most recent* sign-in, and - because this app uses long-lived
-- Google OAuth sessions - it rarely updates for an already-signed-in user (the
-- session refreshes silently without a fresh sign-in). It therefore cannot
-- answer "how many distinct users were active each day". This table captures one
-- row per user per UTC day; it is upserted at most once per user per day from
-- the session-refresh path (see proxy.ts), so a user active daily produces one
-- row per day and `count(*)` grouped by day is the distinct-active-user count.
create table public.user_daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Calendar day in UTC on which the user was seen. One row per user per day.
  activity_date date not null,
  -- Most recent moment we recorded activity within that day.
  last_seen_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

-- The dashboard groups by day across all users, so index the date for the
-- range scan.
create index user_daily_activity_date_idx
  on public.user_daily_activity (activity_date);

alter table public.user_daily_activity enable row level security;

-- A signed-in user may record and read only their own activity. The admin
-- dashboard reads through the service-role client, which bypasses RLS.
create policy "Users can record their own activity"
  on public.user_daily_activity
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own activity"
  on public.user_daily_activity
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can view their own activity"
  on public.user_daily_activity
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
