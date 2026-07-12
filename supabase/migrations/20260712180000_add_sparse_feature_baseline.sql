alter table public.analysed_videos
  add column if not exists deep_feature_baseline jsonb;

comment on column public.analysed_videos.deep_feature_baseline is
  'Versioned deterministic video-wide feature baseline sampled from the analysis proxy; no model output.';
