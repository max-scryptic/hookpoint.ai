-- Surface-level analysis additions. All of these are derived purely from the
-- YouTube Data/Analytics APIs and the caption transcript - no source-file
-- upload required - so they are stored directly on the analysed_videos row
-- (as pacing_analysis originally was) rather than in their own normalized
-- tables. The user can promote any of these to a dedicated table later if a
-- feature earns it.

alter table public.analysed_videos
  -- Deterministic headline KPIs, engagement counts and traffic-source mix
  -- pulled from the YouTube Analytics API's non-retention reports. Refreshed
  -- opportunistically when missing (see lib/video-analytics.ts).
  add column if not exists analytics_summary jsonb,

  -- LLM attribution of the retention curve's drop-offs and gains to what was
  -- being said at each moment (explanations + tips). null = not generated yet.
  add column if not exists retention_attribution jsonb,
  add column if not exists retention_attribution_status text
    check (retention_attribution_status in ('processing', 'failed')),
  add column if not exists retention_attribution_claimed_at timestamptz,

  -- LLM read of title / thumbnail / hook alignment (what worked, what could be
  -- better). Uses a vision model over the thumbnail image. null = not generated.
  add column if not exists packaging_alignment jsonb,
  add column if not exists packaging_alignment_status text
    check (packaging_alignment_status in ('processing', 'failed')),
  add column if not exists packaging_alignment_claimed_at timestamptz;
