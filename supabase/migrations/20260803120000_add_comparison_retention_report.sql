-- The generated Retention head-to-head for a saved video comparison. The
-- retention diff underneath it (the overlaid curves, the hook columns and the
-- stretch-by-stretch evidence) stays pure arithmetic recomputed on every open,
-- but the written comparison is a model-authored read of both curves, both
-- window sets with their ranked events, and the transcript of the stretch where
-- the two curves separated the most. Like the script and packaging reports it is
-- generated once, when the pair is generated, and stored here, so a re-open
-- reads it back rather than paying for it again.
alter table public.video_comparisons
  -- The full RetentionComparisonReport JSON
  -- (lib/retention-comparison-report.ts). null = not generated yet (or
  -- generation failed). The report page never writes this column: a missing
  -- report is filled in the next time the creator presses the button on that
  -- pair in the Video Comparator, which is free for a pair already paid for.
  add column if not exists retention_report jsonb;

-- The retention comparison is one more LLM call, so it needs to be a permitted
-- call_type in the cost log. Recreate the check constraint with it added,
-- keeping every previously permitted type.
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
      'packaging_comparison',
      'retention_comparison',
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis',
      'transcript_taxonomy'
    )
  );
