-- The generated Script head-to-head report for a saved video comparison. Unlike
-- the retention and packaging comparisons (recomputed on the fly from each
-- video's stored taxonomy), the script report is a written, model-authored
-- comparison of the two full transcripts (with the packaging taxonomies as
-- context), so it is generated once when the pair is first created and stored
-- here. A re-open reads this stored report rather than paying for it again.
alter table public.video_comparisons
  -- The full ScriptComparisonReport JSON (lib/script-comparison-report.ts).
  -- null = not generated yet (or generation failed); a missing report is
  -- regenerated on the next report-page visit.
  add column if not exists script_report jsonb;

-- The report is written after the row is inserted (and re-tried lazily on the
-- report page), so the creator's own client needs to update its own rows.
grant update on public.video_comparisons to authenticated;

create policy "Creators can update their own video comparisons"
  on public.video_comparisons for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The script comparison is one more LLM call, so it needs to be a permitted
-- call_type in the cost log. Recreate the check constraint with it added.
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
      'event_synthesis'
    )
  );
