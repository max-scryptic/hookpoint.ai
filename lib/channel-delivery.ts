// The DELIVERY read: how a video is actually made, on the same 0-10 scale the
// packaging and script taxonomies score every other axis on.
//
// Unlike those two, nothing here comes from a model. Every figure is measured
// off the source file by ffmpeg during deep analysis and stored on
// analysed_videos.deep_feature_baseline (lib/video-feature-baseline.ts): how
// often the edit cuts, how much the frame moves, how fast the words come, and
// how much of the runtime is a frozen or a black frame. That makes this the one
// taxonomy on the Channel Trends page carrying no inference at all, and the one
// that costs nothing to generate: the numbers are already sitting in the column
// by the time a video reaches the library.
//
// The baseline stores each figure in its own real unit (cuts per minute, words
// per minute, a 0..1 coverage share). The channel views cannot draw those: the
// radar, the paired bars and every contrast threshold are written against a
// 0-10 axis. So this module maps each unit onto that scale against a FIXED
// ceiling, documented per axis below.
//
// Fixed, never per-library. A percentile against the rest of the library would
// draw a fuller shape, but it would make every score a statement about the
// other videos rather than about this one, and the whole comparison discipline
// on this page rests on each video being scored in isolation (see the note at
// the top of lib/script-taxonomy.ts). A fixed ceiling keeps a 7 on cut rate
// meaning the same thing in March as in June, and the same thing on two
// different channels.
//
// Every axis here is a DESCRIPTOR: a fast cut rate is not better than a slow
// one, it is a different kind of video. The axis definitions in
// lib/channel-taxonomy-trends.ts mark them as such, and the page leaves the
// reading to the reader.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in this
// file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.test.ts.

// Bumped when the shape below changes. Nothing regenerates on it: the read is
// derived on every page load from a stored baseline rather than persisted, so a
// bump costs a render, not a re-analysis.
export const DELIVERY_READ_SCHEMA_VERSION = 1

// What a delivery read is derived from: the measured fields of a stored
// SparseVideoFeatureBaseline, and none of its bookkeeping.
//
// Declared structurally rather than as that type so a caller can project these
// fields straight out of the JSONB column and hand the projection over as it is.
// lib/channel-trends.ts does exactly that, which keeps the baseline's `ranges`
// array (one entry per sampled minute, and read by nothing here) out of a query
// that already runs across the whole library. A whole
// SparseVideoFeatureBaseline satisfies this too, so a caller holding one can
// pass it unchanged.
export interface DeliveryBaseline {
  cutsPerMinute?: number | null
  motion?: number | null
  speechRate?: number | null
  freezeCoverage?: number | null
  blackCoverage?: number | null
  sampledSeconds?: number | null
  videoDurationSeconds?: number | null
  generatedAt?: string | null
}

// --- scale ceilings ----------------------------------------------------------

// One cut every two seconds. Fast-cut retention editing lives around here, and
// the scene detector is deliberately generous about what counts as a cut (see
// the note on within-shot motion in lib/retention-window-media.ts), so a
// ceiling any higher would flatten every ordinary talking head into the floor
// of the axis.
export const CUTS_PER_MINUTE_CEILING = 30

// Mean luma difference between consecutive frames, as a share of full scale
// (signalstats YDIF / 255, see lib/media/scene-detection.ts). Real footage never
// comes near 1, so a ceiling of 1 would pin every video to the floor of the
// axis: a locked-off talking head measures around 0.012, and busy footage runs
// to roughly 0.15. Full scale is set inside the top of that range rather than
// above it, so the ordinary end of the axis has some resolution to separate two
// videos of one channel with; the genuinely high-motion end clamps at 10, which
// is the right reading for it. This is the least certain of the three ceilings,
// being set against a handful of measurements rather than a known unit: re-tune
// it here if it turns out to run hotter across real libraries, and nothing
// outside this file needs to change with it.
export const MOTION_CEILING = 0.1

// Words per minute. Conversational delivery runs 130-170, and 220 is a
// genuinely fast talker, which is what a 10 should mean.
export const SPEECH_RATE_CEILING = 220

// Freeze and black coverage are already shares of the sampled runtime, so their
// own full scale is the ceiling: all of it.
export const COVERAGE_CEILING = 1

// --- shape -------------------------------------------------------------------

export interface DeliveryFigures {
  // How often the edit cuts.
  cutsPerMinute: number | null
  // How much the frame changes between consecutive frames.
  motion: number | null
  // How fast the words come.
  speechRate: number | null
  // How much of the sampled runtime is a held, unmoving frame.
  freezeCoverage: number | null
  // How much of it is black: fades and hard cuts to black.
  blackCoverage: number | null
}

export interface DeliveryRead {
  // The five figures on the 0-10 scale, one decimal. Called `detail` so the
  // channel profile builders see this the way they see an enriched packaging or
  // script read: a read carrying no `detail` is one too old to score axes on,
  // and is dropped from every profile rather than half-counted.
  detail: DeliveryFigures
  // The same five in their own units, so a readout can say "34 cuts/min"
  // instead of "8.2 on cut rate". Nothing draws these yet; they are here
  // because the scaled figure alone cannot be turned back into the measurement
  // it came from.
  raw: DeliveryFigures
  // Seconds of runtime ffmpeg actually measured. The baseline samples the video
  // rather than decoding all of it, so this is what the figures are true of.
  sampledSeconds: number | null
  // Runtime of the video the sample was taken from.
  videoDurationSeconds: number | null
  schemaVersion: number
  // When the baseline underneath was measured, carried through unchanged.
  generatedAt: string | null
}

// --- normalisation -----------------------------------------------------------

// One figure onto the 0-10 axis, clamped at both ends and held to a single
// decimal.
//
// The decimal matters: the model-scored taxonomies hand out integers, so their
// medians land on clean halves and a contrast either clears AXIS_MIN_DELTA or
// does not. A measured figure carries far more precision than that, and letting
// it through unrounded puts float noise either side of the same threshold, so it
// is rounded once here rather than compared raw.
function scale(value: number | null | undefined, ceiling: number): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const scaled = (value / ceiling) * 10
  return Math.round(Math.min(10, Math.max(0, scaled)) * 10) / 10
}

// Keeps a raw figure only when it is a usable number, so a null on the scaled
// side always has a null beside it rather than a stale measurement.
function rawFigure(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value
}

// The delivery read for one video, or null when there is nothing to read: no
// stored baseline, or a baseline whose every figure failed to measure. A
// partially measured baseline is kept, because each axis drops its own nulls and
// a video with a cut rate but no motion figure still belongs on the cut axis.
export function toDeliveryRead(
  baseline: DeliveryBaseline | null | undefined,
): DeliveryRead | null {
  if (baseline == null) return null

  const raw: DeliveryFigures = {
    cutsPerMinute: rawFigure(baseline.cutsPerMinute),
    motion: rawFigure(baseline.motion),
    speechRate: rawFigure(baseline.speechRate),
    freezeCoverage: rawFigure(baseline.freezeCoverage),
    blackCoverage: rawFigure(baseline.blackCoverage),
  }
  const detail: DeliveryFigures = {
    cutsPerMinute: scale(raw.cutsPerMinute, CUTS_PER_MINUTE_CEILING),
    motion: scale(raw.motion, MOTION_CEILING),
    speechRate: scale(raw.speechRate, SPEECH_RATE_CEILING),
    freezeCoverage: scale(raw.freezeCoverage, COVERAGE_CEILING),
    blackCoverage: scale(raw.blackCoverage, COVERAGE_CEILING),
  }
  if (Object.values(detail).every((value) => value == null)) return null

  return {
    detail,
    raw,
    sampledSeconds: rawFigure(baseline.sampledSeconds),
    videoDurationSeconds: rawFigure(baseline.videoDurationSeconds),
    schemaVersion: DELIVERY_READ_SCHEMA_VERSION,
    generatedAt: baseline.generatedAt ?? null,
  }
}
