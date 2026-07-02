-- Timestamped, deterministic video-editing cues (cuts, freeze-frames,
-- black-frames) detected by a single ffmpeg pass over a whole source video —
-- no LLM involved. Stored as individual timestamped rows rather than
-- per-retention-window aggregates so that:
--   • the expensive full-video decode only ever has to run once per video,
--     independent of how retention windows are padded/redefined later;
--   • derived metrics (cut count, cuts-per-minute, freeze/black coverage) can
--     be computed on the fly for *any* [from, to] range — including the
--     retention window itself, its padded analysis window, or the video's
--     own overall baseline for comparison — by querying this table, instead
--     of re-running ffmpeg per window.
--
-- `scene_cue_scan_status` on analysed_videos tracks the one full-video scan:
-- 'pending' as soon as a video is analysed, flipped to 'processing' while a
-- trigger holds the claim, then 'ready' or 'failed'. Mirrors the
-- pending/processing/ready/failed claim already used for
-- retention_window_snapshots/audio's analysis_status.
alter table public.analysed_videos
  add column if not exists scene_cue_scan_status text not null default 'pending'
    check (scene_cue_scan_status in ('pending', 'processing', 'ready', 'failed')),
  add column if not exists scene_cue_scan_error text,
  add column if not exists scene_cue_scanned_at timestamptz;

create table public.video_scene_cues (
  id uuid primary key default gen_random_uuid(),
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cut', 'freeze', 'black')),
  from_seconds double precision not null check (from_seconds >= 0),
  -- Equal to from_seconds for a 'cut' (an instantaneous event, not a span);
  -- the end of the frozen/black span for 'freeze'/'black'.
  to_seconds double precision not null check (to_seconds >= from_seconds),
  -- ffmpeg's scene-change score (0-1) for a 'cut'; null for freeze/black,
  -- whose filters don't emit a comparable score.
  score double precision,
  created_at timestamptz not null default now(),
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade
);

create index video_scene_cues_user_id_idx
  on public.video_scene_cues (user_id);
-- Serves both "every cue for this video" and "cues of kind X for this video
-- in range [from, to]" — the shape every metrics query uses.
create index video_scene_cues_video_kind_range_idx
  on public.video_scene_cues (analysed_video_id, kind, from_seconds);

grant select, insert, update, delete
  on public.video_scene_cues to authenticated;

alter table public.video_scene_cues enable row level security;

create policy "Users can view their own video scene cues"
  on public.video_scene_cues for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own video scene cues"
  on public.video_scene_cues for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.analysed_videos
      where id = analysed_video_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own video scene cues"
  on public.video_scene_cues for delete to authenticated
  using ((select auth.uid()) = user_id);
