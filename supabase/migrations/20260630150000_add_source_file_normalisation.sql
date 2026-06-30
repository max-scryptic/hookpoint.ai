-- Adds the "normalisation" stage to a source file: after a raw upload validates,
-- we hand the original off to a managed transcoder (Qencode) which produces a
-- 1080p H.264 "proxy" written back into the same bucket. Once the proxy lands we
-- delete the (potentially 4K, multi-GB) original. The proxy then serves both
-- playback and the future frame/audio extraction — nothing downstream needs the
-- full-resolution master.
--
-- The original upload columns (storage_path, file_size_bytes) keep pointing at
-- the master until it's deleted; playback resolves to proxy_storage_path when a
-- proxy exists and falls back to the original otherwise, so the file stays
-- playable the whole time (during upload, during transcode, and after).

alter table public.source_files
  -- Object key of the normalised 1080p proxy in the source-files bucket. Null
  -- until the transcoder reports the proxy saved. Once set, this is the path
  -- playback and extraction use.
  add column proxy_storage_path text,
  -- Storage-reported size of the proxy, recorded when the callback confirms it.
  add column proxy_size_bytes bigint,
  -- Lifecycle of the transcode step, independent of the upload lifecycle:
  --   pending    - uploaded/validated but not yet handed to the transcoder
  --   processing - submitted to the transcoder, awaiting its callback
  --   ready      - proxy saved and verified; original deleted
  --   failed     - the transcode errored; the original is kept as the fallback
  --   skipped    - normalisation isn't configured/enabled for this environment
  add column normalisation_status text not null default 'pending'
    check (normalisation_status in (
      'pending', 'processing', 'ready', 'failed', 'skipped'
    )),
  -- Which managed transcoder produced (or is producing) the proxy, e.g. 'qencode'.
  add column normalisation_provider text,
  -- The transcoder-side job id, stored so the (unauthenticated, server-to-server)
  -- status callback can find the row it belongs to.
  add column normalisation_task_token text,
  -- Human-readable failure detail from the transcoder, surfaced for debugging.
  add column normalisation_error text,
  -- When the original master was deleted after a successful proxy. Null = the
  -- original is still in storage (not yet normalised, or normalisation failed).
  add column original_deleted_at timestamptz;

-- The callback looks rows up by the transcoder job id, so index it. Partial
-- index keeps it small — only rows with an in-flight/finished job have a token.
create index source_files_normalisation_task_token_idx
  on public.source_files (normalisation_task_token)
  where normalisation_task_token is not null;
