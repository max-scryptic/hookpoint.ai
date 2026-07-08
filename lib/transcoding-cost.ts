// Turns a transcoded video's duration into the dollar cost Qencode charged to
// produce its proxies, so the deep-analysis cost breakdown can show the
// transcoding spend alongside the per-window LLM costs (see lib/llm-cost.ts).
//
// Qencode bills transcoding by the minute of video. The default rate below
// (0.015 $/min — i.e. $0.15 for a 10-minute video) is an ESTIMATE and can be
// overridden at runtime via the QENCODE_TRANSCODING_USD_PER_MINUTE env var
// without a code change, the same way the LLM rate card can be. A transcoding
// cost is a per-video, one-time figure, unlike the per-window LLM costs.

// Dollars per minute of transcoded video. $0.15 / 10 min = $0.015/min.
const DEFAULT_USD_PER_MINUTE = 0.015

// Parsed fresh each call (not memoised) so an env override applied at runtime,
// or between tests, takes effect immediately — this is called at most once per
// rendered analysis, so re-reading a single env var is nothing.
export function transcodingCostPerMinuteUsd(): number {
  const raw = process.env.QENCODE_TRANSCODING_USD_PER_MINUTE
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_USD_PER_MINUTE
}

// The transcoding cost for a video of the given duration. Zero for an unknown
// or non-positive duration so a missing figure never invents a cost.
export function transcodingCostUsd(
  durationSeconds: number | null | undefined,
): number {
  if (durationSeconds == null || durationSeconds <= 0) return 0
  return (durationSeconds / 60) * transcodingCostPerMinuteUsd()
}
