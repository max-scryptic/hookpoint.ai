-- What a saved head-to-head actually cost its creator.
--
-- Until now every comparison cost the same flat number of deep-dive credits, so
-- an abandoned run could be refunded that flat amount without asking. That stops
-- being true with the first-one-free rule: a paid creator's first ever
-- comparison is generated without spending a credit, and refunding the flat cost
-- for a run that was never charged would hand out credits that were never spent
-- (and, since the rolled-back row is deleted, would hand them out again on the
-- next press).
--
-- So each row records what it was charged. Zero means it was the free one, a
-- positive number is what was spent, and null means the row predates this column
-- (every one of those was charged the flat cost, which is what the refund paths
-- fall back to). Mirrors source_files.deep_credits_charged, which records the
-- same thing for a deep analysis.
alter table public.video_comparisons
  add column if not exists deep_credits_charged integer;

-- The value is written by the creator's own client on the insert that creates
-- the row, which already holds insert/update rights on its own rows (see the
-- video_comparisons and script report migrations), so no new grant or policy is
-- needed here.
