-- Normalises the retention "windows" surfaced for each analysed video into a
-- dedicated table, the same way pacing_windows holds per-window pacing rows.
-- Three kinds share the table:
--   • hook     – the two fixed opening windows (Initial Hook, Hook Delivery),
--                always reported, measuring only viewers lost.
--   • drop_off – the significant mid-video drop-offs worth a creator's
--                attention (steeper than this video's own decline, or
--                underperforming similar videos).
--   • gain     – the moments retention rose (re-watched / replayed segments).
-- Storing them as rows lets us query and compare hooks, drops and gains across
-- videos (e.g. the dashboard KPI totals) instead of re-deriving them from the
-- raw curve every time. `delta` is the signed change in watch ratio across the
-- window: negative for losses (hook, drop_off), positive for gains.

-- A composite (id, user_id) key lets retention_windows carry a composite
-- foreign key, so a row can never point at another user's analysed video.
alter table public.analysed_videos
  add constraint analysed_videos_id_user_id_key unique (id, user_id);

create table public.retention_windows (
  id uuid primary key default gen_random_uuid(),
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('hook', 'drop_off', 'gain')),
  window_index integer not null check (window_index >= 0),
  -- Stable identifier for the fixed hook windows ('initial-hook' /
  -- 'hook-delivery'); null for detected drop-offs and gains.
  window_key text,
  -- Human-readable name for hook windows; null for drop-offs and gains.
  label text,
  from_seconds double precision not null check (from_seconds >= 0),
  to_seconds double precision not null check (to_seconds >= from_seconds),
  -- Retention entering/leaving the window. Only meaningful for hook windows,
  -- which are a continuous opening funnel; null for drop-offs and gains, whose
  -- magnitude lives in `delta`.
  start_watch_ratio double precision,
  end_watch_ratio double precision,
  -- Signed change in absolute watch ratio across the window: < 0 for losses,
  -- > 0 for gains.
  delta double precision not null,
  -- YouTube's relativeRetentionPerformance for the window (hook + drop_off);
  -- null when YouTube reports none, or for gains.
  relative_performance double precision,
  -- How many times steeper a drop is than this video's median step decline.
  -- Only set for drop_off rows.
  steepness double precision check (steepness is null or steepness >= 0),
  -- True when a drop_off was surfaced for being abnormally steep (as opposed to
  -- only underperforming similar videos). Null for hook and gain rows.
  is_abnormally_steep boolean,
  -- True when the video is too short to actually reach a fixed hook window, so
  -- its figures are not meaningful. Always false for drop-offs and gains.
  out_of_range boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade,
  unique (analysed_video_id, kind, window_index)
);

create index retention_windows_user_id_idx
  on public.retention_windows (user_id);
create index retention_windows_analysed_video_id_idx
  on public.retention_windows (analysed_video_id);

grant select, insert, update, delete
  on public.retention_windows to authenticated;

alter table public.retention_windows enable row level security;

create policy "Users can view their own retention windows"
  on public.retention_windows for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own retention windows"
  on public.retention_windows for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.analysed_videos
      where id = analysed_video_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own retention windows"
  on public.retention_windows for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.analysed_videos
      where id = analysed_video_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own retention windows"
  on public.retention_windows for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_retention_windows_updated_at
  before update on public.retention_windows
  for each row execute function private.set_updated_at();

-- Drop-offs now live in retention_windows (kind = 'drop_off'); the JSONB column
-- they used to share with the raw curve is no longer read.
alter table public.analysed_videos
  drop column if exists drop_offs;
