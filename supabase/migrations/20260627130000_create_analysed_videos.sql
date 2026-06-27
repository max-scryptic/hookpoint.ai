-- Stores the result of analysing a YouTube video for a user. Calling the
-- YouTube Data + Analytics APIs costs quota, so once a video is analysed we
-- persist everything we fetched (metadata, the full audience-retention curve,
-- computed drop-offs) and replay it from here instead of re-spending quota.
--
-- The JSONB payload columns are deliberately schema-light: the YouTube/Analytics
-- responses will grow as we build more into the analysis pipeline, and JSONB
-- lets us capture whatever we retrieve without a migration per new field.
--
-- `video_title` is the human-facing identifier we use to link a video to its
-- other associated tables; `video_id` is the stable YouTube ID we de-duplicate
-- and re-fetch on.
create table public.analysed_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  video_title text not null,
  date_analysed timestamptz not null default now(),
  -- Raw YouTube Data API video metadata (title, channel, duration, thumbnail…).
  video_details jsonb,
  -- Full audience-retention curve, so we can render the retention graph offline.
  retention jsonb,
  -- Steepest retention drop-offs derived from the curve.
  drop_offs jsonb,
  -- Catch-all for any additional analytics payloads we start fetching later.
  raw_analytics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Re-analysing the same video updates the existing row rather than duplicating.
  unique (user_id, video_id)
);

-- Title is the join key used by other per-video tables; index it for lookups.
create index analysed_videos_user_title_idx
  on public.analysed_videos (user_id, video_title);

alter table public.analysed_videos enable row level security;

create policy "Users can view their own analysed videos"
  on public.analysed_videos
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own analysed videos"
  on public.analysed_videos
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own analysed videos"
  on public.analysed_videos
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own analysed videos"
  on public.analysed_videos
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_analysed_videos_updated_at
  before update on public.analysed_videos
  for each row
  execute function private.set_updated_at();
