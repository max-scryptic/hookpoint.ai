-- Adds a second, independent pipeline stage to retention_window_snapshots and
-- retention_window_audio: AI analysis of the harvested media itself (visual
-- description/on-screen text for snapshots, tone/music/energy for audio),
-- separate from `status`/`storage_path`/`error`, which only ever describe
-- whether the media was successfully extracted from the source video.
--
-- A row can be `status = 'ready'` (extraction succeeded) while
-- `analysis_status = 'pending'` (analysis hasn't run yet) — that's the normal
-- state right after extraction. Rows start `analysis_status = 'pending'`
-- alongside `status`, but analysis only actually runs once `status = 'ready'`
-- (see lib/retention-window-media-analysis.ts), since there's nothing to
-- analyse until the media exists.

alter table public.retention_window_snapshots
  add column analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'ready', 'failed')),
  add column analysis jsonb,
  add column analysis_model text,
  add column analysis_error text,
  add column analyzed_at timestamptz;

alter table public.retention_window_audio
  add column analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'ready', 'failed')),
  add column analysis jsonb,
  add column analysis_model text,
  add column analysis_error text,
  add column analyzed_at timestamptz;

-- Both extraction and analysis triggers query "what's left to do" by status,
-- so index the pair the same way the existing pending-extraction lookups are
-- (implicitly) indexed by the table's user_id/analysed_video_id indexes.
create index retention_window_snapshots_analysis_status_idx
  on public.retention_window_snapshots (analysis_status)
  where analysis_status = 'pending';
create index retention_window_audio_analysis_status_idx
  on public.retention_window_audio (analysis_status)
  where analysis_status = 'pending';
