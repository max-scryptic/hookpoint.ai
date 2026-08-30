// Turns a transcribed runtime into the dollar cost OpenAI charged for it, so
// the cost log can show transcription spend alongside the LLM calls and the
// Qencode transcodes (see lib/transcoding-cost.ts, which this mirrors).
//
// Transcription is billed per minute of audio rather than per token, which is
// why it is its own cost type rather than a row on the LLM rate card in
// lib/llm-cost.ts: there are no token counts to price.

// Published per-minute rates, as of August 2026. whisper-1 is the one the
// planner uses (it is the only model that returns timestamps); the gpt-4o
// transcription models are listed so a rate is still found if the model is
// overridden to one of them.
const USD_PER_MINUTE_BY_MODEL: Record<string, number> = {
  "whisper-1": 0.006,
  "gpt-4o-transcribe": 0.006,
  "gpt-4o-mini-transcribe": 0.003,
}

// The fallback rate for a model with no entry above, deliberately the dearer of
// the published rates so an unknown model is over-estimated rather than
// recorded as free.
const DEFAULT_USD_PER_MINUTE = 0.006

// Parsed fresh each call (not memoised) so an env override applied at runtime,
// or between tests, takes effect immediately - this is called once per
// transcribed video, so re-reading one env var is nothing.
export function transcriptionCostPerMinuteUsd(model: string): number {
  const raw = process.env.OPENAI_TRANSCRIPTION_USD_PER_MINUTE
  const parsed = raw != null ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return USD_PER_MINUTE_BY_MODEL[model] ?? DEFAULT_USD_PER_MINUTE
}

// The transcription cost for audio of the given duration. Zero for an unknown
// or non-positive duration so a missing figure never invents a cost.
export function transcriptionCostUsd(
  durationSeconds: number | null | undefined,
  model: string,
): number {
  if (durationSeconds == null || durationSeconds <= 0) return 0
  return (durationSeconds / 60) * transcriptionCostPerMinuteUsd(model)
}
