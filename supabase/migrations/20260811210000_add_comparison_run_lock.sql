-- One run at a time per saved comparison.
--
-- Writing a head-to-head is three model calls billed to us, and the button that
-- starts them is not the only way to reach the endpoint: a second tab, a reload
-- landing on a picker that still says "Finish report", or two presses either
-- side of a navigation all arrive as separate requests. Before this column each
-- of those started its own full run against the same row, and whichever
-- finished last overwrote the rest. The creator saw one report; we paid for
-- several.
--
-- report_run_started_at is the claim. A run takes the row by stamping it, and
-- only a row that is unstamped, or stamped longer ago than a run could still be
-- alive, can be taken: a second request arriving mid-run is turned away instead
-- of duplicating the work. Postgres re-checks the predicate after the first
-- update commits, so two requests racing for the same row cannot both win.
--
-- The stamp is cleared when the run settles. A run that dies without clearing
-- it (a deploy that went away, a dropped connection) holds the row only until
-- the grace window passes rather than for ever, so a pair can never be left
-- permanently unfinishable. That window is the one the abandoned-run sweep
-- already uses (see ABANDONED_COMPARISON_GRACE_MS), which is comfortably longer
-- than the generate route's own 300 second cap.
alter table public.video_comparisons
  add column if not exists report_run_started_at timestamptz;

-- The claim and its release are ordinary updates from the creator's own client,
-- which already holds update rights on its own rows (see the script report
-- migration), so no new grant or policy is needed here.
