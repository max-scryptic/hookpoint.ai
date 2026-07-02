-- Timestamped, deterministic video-editing cues (cuts, freeze-frames,
-- black-frames) detected by ffmpeg — no LLM involved — over a retention
-- window's own padded analysis range (analysis_from_seconds/
-- analysis_to_seconds, computed alongside the window in
-- lib/retention-windows.ts), the same [from, to] span already harvested for
-- snapshots/audio. Scoped per window rather than a whole-video decode: a
-- full-video pass has to read and decode every byte/frame of the source
-- (cost scales with total video length, not the number of interesting
-- moments), and can exceed the 300s budget the routes that trigger this
-- already run under. A bounded per-window seek+decode, reusing the same
-- ffmpeg pattern (and even the same signed source URL) already used for
-- snapshots/audio, stays cheap and bounded regardless of video length.
--
-- retention_window_scene_cue_scans tracks the one scan per window
-- (pending/ready/failed, mirroring retention_window_audio's status). Its
-- detected events land in video_scene_cues, one row per cut/freeze/black
-- span, tagged with the window that produced them — so cut-count,
-- cuts-per-minute, and freeze/black coverage for any [from, to] range are
-- computed on read from that table (see lib/video-scene-cues.ts), and an
-- approximate video-wide baseline is just the average across whichever
-- windows have already been scanned, rather than a dedicated full-video pass.

create table public.retention_window_scene_cue_scans (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null unique,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_seconds double precision not null check (from_seconds >= 0),
  to_seconds double precision not null check (to_seconds > from_seconds),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade
);

create table public.video_scene_cues (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null,
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
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade
);

create index retention_window_scene_cue_scans_user_id_idx
  on public.retention_window_scene_cue_scans (user_id);
create index retention_window_scene_cue_scans_analysed_video_id_idx
  on public.retention_window_scene_cue_scans (analysed_video_id);

create index video_scene_cues_user_id_idx
  on public.video_scene_cues (user_id);
create index video_scene_cues_retention_window_id_idx
  on public.video_scene_cues (retention_window_id);
-- Serves "every cue for this video" (metrics across all scanned windows).
create index video_scene_cues_video_kind_range_idx
  on public.video_scene_cues (analysed_video_id, kind, from_seconds);

grant select, insert, update, delete
  on public.retention_window_scene_cue_scans to authenticated;
grant select, insert, update, delete
  on public.video_scene_cues to authenticated;

alter table public.retention_window_scene_cue_scans enable row level security;
alter table public.video_scene_cues enable row level security;

create policy "Users can view their own scene cue scans"
  on public.retention_window_scene_cue_scans for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own scene cue scans"
  on public.retention_window_scene_cue_scans for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own scene cue scans"
  on public.retention_window_scene_cue_scans for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own scene cue scans"
  on public.retention_window_scene_cue_scans for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view their own video scene cues"
  on public.video_scene_cues for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own video scene cues"
  on public.video_scene_cues for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own video scene cues"
  on public.video_scene_cues for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_retention_window_scene_cue_scans_updated_at
  before update on public.retention_window_scene_cue_scans
  for each row execute function private.set_updated_at();
