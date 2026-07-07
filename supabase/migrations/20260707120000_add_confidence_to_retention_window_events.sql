-- Adds a per-event confidence (0..1) to retention_window_events, so the
-- synthesis call can rank how strongly the evidence supports each event and
-- the product can threshold/sort on it. This is the same 0..1 confidence the
-- script-only retention attribution (analysed_videos.retention_attribution)
-- already carries per moment, now on the multimodal events too, so a weak
-- "true but who-cares" event can be told apart from one worth raising.
--
-- Nullable so events synthesized before this column existed read back cleanly
-- as "unranked" rather than failing the check; a re-run of the window's
-- synthesis job repopulates it.
alter table public.retention_window_events
  add column confidence double precision
    check (confidence is null or (confidence >= 0 and confidence <= 1));
