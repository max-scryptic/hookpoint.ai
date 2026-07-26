-- Per-window transcript taxonomy: a structured, categorical read of a single
-- retention window's spoken transcript (lib/retention-window-transcript-taxonomy.ts),
-- the per-window companion to the whole-video script taxonomy. It is part of the
-- deep-analysis pipeline, generated only for the bounded set of windows deep
-- analysis selects (the same windows that get snapshots/audio), so it lives on
-- the existing per-window transcript row alongside the clipped text.
--
-- taxonomy_status mirrors the analysis_status pattern on
-- retention_window_snapshots/audio, but is NULLABLE on purpose: null means "this
-- window is not part of deep analysis" (no taxonomy will ever be generated for
-- it), which is the resting state for the majority of windows that light
-- analysis still keeps but deep analysis did not select.
alter table public.retention_window_transcripts
  -- The full WindowTranscriptTaxonomy JSON; null until generated.
  add column if not exists taxonomy jsonb,
  -- null = not selected for deep analysis. Otherwise the generation lifecycle,
  -- matching the media analysis_status vocabulary (plus 'skipped' for an empty
  -- transcript that settled with nothing to read).
  add column if not exists taxonomy_status text
    check (
      taxonomy_status is null
      or taxonomy_status in ('pending', 'processing', 'ready', 'failed', 'skipped')
    ),
  -- The failure reason when taxonomy_status = 'failed'; null otherwise.
  add column if not exists taxonomy_error text,
  -- The model that produced the stored taxonomy; null until generated.
  add column if not exists taxonomy_model text;

-- Lets the pipeline claim pending rows cheaply (taxonomy_status = 'pending').
create index if not exists retention_window_transcripts_taxonomy_status_idx
  on public.retention_window_transcripts (analysed_video_id, taxonomy_status);

-- The per-window transcript taxonomy is one more deep-analysis LLM call, so its
-- cost is tracked per window. Recreate the retention_window_costs.step check
-- with the new step added.
alter table public.retention_window_costs
  drop constraint if exists retention_window_costs_step_check;

alter table public.retention_window_costs
  add constraint retention_window_costs_step_check check (
    step in ('snapshot', 'audio', 'event_synthesis', 'transcript_taxonomy')
  );

-- And a permitted call_type in the account-wide cost log. Recreate the check
-- constraint with it added (keeping every previously permitted type).
alter table public.cost_logs
  drop constraint if exists cost_logs_call_type_check;

alter table public.cost_logs
  add constraint cost_logs_call_type_check check (
    call_type in (
      'pacing',
      'packaging_alignment',
      'packaging_taxonomy',
      'script_taxonomy',
      'script_comparison',
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis',
      'transcript_taxonomy'
    )
  );
