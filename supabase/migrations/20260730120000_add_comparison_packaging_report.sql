-- The generated Packaging head-to-head for a saved video comparison. Like the
-- script report (and unlike the deterministic packaging diff, which is
-- recomputed on the fly from each video's stored taxonomy), this is a written,
-- model-authored comparison: both thumbnails as images, both titles, and the
-- full stored evidence for each video's first ten seconds. It is generated once
-- when the pair is generated and stored here, so a re-open reads it back
-- rather than paying for it again.
alter table public.video_comparisons
  -- The full PackagingComparisonReport JSON
  -- (lib/packaging-comparison-report.ts). null = not generated yet (or
  -- generation failed). The report page never writes this column: a missing
  -- report is filled in the next time the creator presses the button on that
  -- pair in the Video Comparator, which is free for a pair already paid for.
  add column if not exists packaging_report jsonb;

-- The packaging comparison is one more LLM call, so it needs to be a permitted
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
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis',
      'transcript_taxonomy'
    )
  );
