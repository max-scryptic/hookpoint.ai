-- Guards the LLM-calling parts of the analysis pipeline (pacing analysis,
-- retention-window snapshot analysis, retention-window audio analysis)
-- against being invoked twice for the same not-yet-analysed work.
--
-- These are triggered from several independent places (the /api/analyze
-- route, the dashboard page's render-time backfill, and the Qencode
-- normalisation webhook) that can legitimately fire close together — two
-- browser tabs, a page refresh while the first request is still generating,
-- a retried webhook. Without a claim step, two concurrent callers can both
-- read "not yet analysed" and both call out to the LLM for identical work
-- before either write lands.
--
-- 'processing' is an in-flight claim, not a real analysis outcome: a caller
-- atomically flips pending -> processing (an UPDATE ... WHERE analysis_status
-- = 'pending' only succeeds for whichever caller's statement commits first),
-- does the LLM call, then writes 'ready'/'failed' same as before. A claim
-- older than the staleness window below is treated as abandoned (e.g. the
-- caller was killed by a function timeout) and can be reclaimed, so a stuck
-- claim doesn't block analysis forever — the same self-healing tradeoff
-- source-file normalisation already makes with its own 'processing' state.

-- Looks up and drops whichever constraint currently enforces analysis_status's
-- allowed values, by inspecting its definition rather than assuming a name —
-- Postgres's auto-generated name for an inline column check isn't guaranteed
-- across versions, and getting this wrong (e.g. via a silent `if exists`)
-- would leave the old, narrower constraint in place rejecting 'processing'.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.retention_window_snapshots'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%analysis_status%';

  if cname is null then
    raise exception 'Could not find the analysis_status check constraint on retention_window_snapshots';
  end if;

  execute format(
    'alter table public.retention_window_snapshots drop constraint %I',
    cname
  );
end $$;

alter table public.retention_window_snapshots
  add constraint retention_window_snapshots_analysis_status_check
    check (analysis_status in ('pending', 'processing', 'ready', 'failed'));

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.retention_window_audio'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%analysis_status%';

  if cname is null then
    raise exception 'Could not find the analysis_status check constraint on retention_window_audio';
  end if;

  execute format(
    'alter table public.retention_window_audio drop constraint %I',
    cname
  );
end $$;

alter table public.retention_window_audio
  add constraint retention_window_audio_analysis_status_check
    check (analysis_status in ('pending', 'processing', 'ready', 'failed'));

-- Pacing analysis has no per-row status table to piggyback on (it's a single
-- report per video), so it gets its own claim column on analysed_videos.
-- null = nothing in flight (either never attempted, or already saved to
-- pacing_analyses — that table is the source of truth for "done").
alter table public.analysed_videos
  add column pacing_analysis_status text
    check (pacing_analysis_status in ('processing', 'failed')),
  add column pacing_analysis_claimed_at timestamptz;
