-- Compact deterministic visual-motion timeline generated in the same ffmpeg
-- decode as cut/freeze/black detection. Each item is
-- {fromSeconds, toSeconds, score}, where score is normalised YDIF (0..1).
-- Existing scans remain valid and read as an empty timeline until retried.
alter table public.retention_window_scene_cue_scans
  add column motion_buckets jsonb not null default '[]'::jsonb;

alter table public.retention_window_scene_cue_scans
  add constraint retention_window_scene_cue_scans_motion_buckets_array
  check (jsonb_typeof(motion_buckets) = 'array');
