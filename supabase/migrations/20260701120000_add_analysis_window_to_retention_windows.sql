-- Adds the padded "analysis window" each retention window should be examined
-- over when harvesting thumbnails/audio for AI analysis, distinct from the raw
-- from_seconds/to_seconds already stored (which record the detected hook/drop/
-- gain itself, not the context around it):
--   • hook     – the fixed opening, 0s to min(30s, duration). Set only on the
--                first hook row (window_index = 0); hook-delivery (index 1) is
--                already covered by that single combined window, so its
--                analysis columns stay null to avoid re-harvesting the same
--                stretch twice.
--   • drop_off – 30s before to 10s after the midpoint of the detected step.
--   • gain     – 10s before to 20s after the midpoint of the detected step.
-- Both clamped to [0, duration]. Null on a row means "no analysis window for
-- this row" (currently only the hook-delivery case).
--
-- A composite (id, user_id) unique key lets the new retention_window_snapshots
-- and retention_window_audio tables carry a composite foreign key back here, the
-- same way retention_windows itself references analysed_videos.

alter table public.retention_windows
  add constraint retention_windows_id_user_id_key unique (id, user_id);

alter table public.retention_windows
  add column analysis_from_seconds double precision,
  add column analysis_to_seconds double precision;

alter table public.retention_windows
  add constraint retention_windows_analysis_from_seconds_check
    check (analysis_from_seconds is null or analysis_from_seconds >= 0),
  add constraint retention_windows_analysis_window_check
    check (
      (analysis_from_seconds is null) = (analysis_to_seconds is null)
      and (analysis_to_seconds is null or analysis_to_seconds > analysis_from_seconds)
    );
