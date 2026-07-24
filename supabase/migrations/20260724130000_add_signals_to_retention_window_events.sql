-- Adds a structured `signals` block to each synthesized retention-window event:
-- a deterministic, comparison-grade snapshot of the measured evidence at the
-- event's moment (editing/audio/motion metrics and their deviations from the
-- video's baseline and from the immediately preceding control range, plus the
-- vision read of the nearest sampled frame and a link back to it).
--
-- Until now an event kept only its prose narrative, coarse event_type,
-- primary_evidence and confidence: the actual measurements that produced the
-- narrative (the cut rate that fell, the energy drop, the graphic that
-- appeared, the frame it happened on) were computed once during synthesis and
-- then discarded. Persisting them alongside the narrative makes the numbers
-- behind every event queryable and comparable across the whole library, the
-- same move the packaging taxonomy made from prose to a scored `detail` block.
--
-- The block is captured deterministically at synthesis time (no extra model
-- tokens) from the evidence bundle the synthesizer already assembles. Nullable
-- so rows synthesized before this column existed read back cleanly; a
-- re-analyse of the video repopulates it.
alter table public.retention_window_events
  add column signals jsonb;

comment on column public.retention_window_events.signals is
  'Deterministic snapshot of the measured evidence at the event''s moment (editing/audio/motion deltas vs the video baseline and vs the preceding control, plus the vision read and chunk link of the nearest sampled frame). Captured at synthesis time so the data behind the narrative is queryable across the library. Null on rows synthesized before this column existed.';
