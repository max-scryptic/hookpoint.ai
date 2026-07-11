-- Records how many deep-dive credits were charged for a source file's deep
-- analysis, so the charge is applied exactly once per uploaded file. Deep
-- analysis of a source file costs roughly one credit per minute of footage; we
-- charge when the upload lands (see lib/source-files/upload-service) and stamp
-- the amount here. A null means "not charged yet"; re-triggering or retrying the
-- deep analysis of an already-charged file re-runs it without spending more
-- credits (the user already paid for that footage this window).
alter table public.source_files
  add column deep_credits_charged integer;
