-- Adds a second, much smaller transcode output to normalisation: a 360p
-- "analysis proxy" produced by the same Qencode job as the 1080p playback
-- proxy. Frame/audio/scene-cue extraction decodes the source repeatedly, and
-- none of it needs playback resolution — decoding 360p instead of 1080p cuts
-- that CPU cost several-fold. Playback keeps using proxy_storage_path;
-- extraction prefers the analysis proxy when it exists and falls back to the
-- playback proxy or original otherwise (see resolveAnalysisSourceStoragePath).
--
-- Best-effort by design: the analysis proxy failing to land never fails
-- normalisation — the columns just stay null and extraction reads the
-- playback path instead.

alter table public.source_files
  -- Object key of the 360p analysis proxy in the source-files bucket. Null
  -- until the transcoder callback confirms it saved (or when the analysis
  -- output failed/was skipped — extraction then falls back to the playback
  -- proxy/original).
  add column analysis_proxy_storage_path text,
  -- Storage-reported size of the analysis proxy, recorded when the callback
  -- confirms it.
  add column analysis_proxy_size_bytes bigint;
