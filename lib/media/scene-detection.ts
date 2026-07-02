// Detects video-editing cues — hard cuts, freeze-frames, and cuts-to-black —
// via a single ffmpeg pass over a whole source video. Purely deterministic
// (ffmpeg's own scene-change/freeze/black filters), no model involved: see
// lib/video-scene-cues.ts for how the resulting timestamps turn into
// cut-count/cuts-per-minute/freeze-and-black-coverage metrics for any window
// on demand.
//
// All three filters run in one -vf chain, not three separate ffmpeg
// invocations — the full-video decode is the expensive part, so it's worth
// paying for once. freezedetect/blackdetect pass every frame through
// unmodified (they just annotate stderr), so placing them ahead of
// select/showinfo — which drops every frame that isn't a detected cut — lets
// all three see the same single decode.

import { runFfmpegCapturingOutput } from "@/lib/media/ffmpeg"

// Downscaled before analysis: none of these filters need full resolution to
// tell a cut from a freeze from a black frame, and decoding at a fraction of
// the source's size is the main lever for keeping a whole-video pass fast.
// Never upscales a source narrower than this.
const SCENE_DETECTION_SCALE_WIDTH = 320

// ffmpeg scene-change score threshold (0-1) above which a frame transition
// counts as a hard cut. 0.4 is the commonly-used practical threshold for
// catching real cuts without flagging ordinary motion or panning.
const SCENE_CUT_SCORE_THRESHOLD = 0.4

// freezedetect: noise tolerance (dB, more negative = stricter) and the
// minimum span before a static frame counts as a "freeze" worth flagging,
// rather than an ordinarily still moment of a talking-head shot.
const FREEZE_NOISE_THRESHOLD_DB = -60
const FREEZE_MIN_DURATION_SECONDS = 1

// blackdetect: minimum span before a run of near-black frames counts as a
// cut-to-black. Matches the 0.3s sensitivity already used for silencedetect
// in video-extraction.ts.
const BLACK_MIN_DURATION_SECONDS = 0.3
const BLACK_PICTURE_THRESHOLD = 0.98
const BLACK_PIXEL_THRESHOLD = 0.1

export interface SceneCut {
  atSeconds: number
}

export interface SceneSpan {
  fromSeconds: number
  toSeconds: number
}

export interface SceneCueScanResult {
  cuts: SceneCut[]
  freezes: SceneSpan[]
  blacks: SceneSpan[]
}

export function buildSceneCueScanArgs(sourceUrl: string): string[] {
  const filters = [
    `scale='min(${SCENE_DETECTION_SCALE_WIDTH},iw)':-2`,
    `freezedetect=n=${FREEZE_NOISE_THRESHOLD_DB}dB:d=${FREEZE_MIN_DURATION_SECONDS}`,
    `blackdetect=d=${BLACK_MIN_DURATION_SECONDS}:pic_th=${BLACK_PICTURE_THRESHOLD}:pix_th=${BLACK_PIXEL_THRESHOLD}`,
    `select='gt(scene,${SCENE_CUT_SCORE_THRESHOLD})'`,
    "showinfo",
  ].join(",")

  return ["-i", sourceUrl, "-an", "-vf", filters, "-f", "null", "-"]
}

// Parses the stderr log lines showinfo/freezedetect/blackdetect write for a
// buildSceneCueScanArgs run.
//
// Cuts come from showinfo's `pts_time:` field on every frame `select` let
// through (i.e. every detected scene change) — no score is recorded since
// ffmpeg doesn't print `select`'s internal scene score to stderr.
//
// blackdetect logs one line per span with start/end already paired
// (`black_start:X black_end:Y`), so no pairing logic is needed. freezedetect
// instead logs `freeze_start`/`freeze_duration` as separate log lines in
// order, one pair per span; `durationSeconds` closes out a freeze still
// ongoing when the video ends, since ffmpeg only logs freeze_duration once a
// freeze *ends* and a freeze running to EOF would otherwise be dropped.
export function parseSceneCues(
  stderr: string,
  durationSeconds: number,
): SceneCueScanResult {
  const cuts = [
    ...stderr.matchAll(/Parsed_showinfo_\d+ @ [^\]]+\].*?pts_time:([\d.]+)/g),
  ].map((match) => ({ atSeconds: Number(match[1]) }))

  const freezeStarts = [
    ...stderr.matchAll(/freeze_start:\s*(-?\d+(?:\.\d+)?)/g),
  ].map((match) => Number(match[1]))
  const freezeDurations = [
    ...stderr.matchAll(/freeze_duration:\s*(\d+(?:\.\d+)?)/g),
  ].map((match) => Number(match[1]))
  const freezes: SceneSpan[] = freezeStarts.map((fromSeconds, index) => {
    const duration = freezeDurations[index]
    const toSeconds =
      duration != null
        ? fromSeconds + duration
        : Math.max(fromSeconds, durationSeconds)
    return { fromSeconds, toSeconds }
  })

  const blacks = [
    ...stderr.matchAll(
      /black_start:\s*(-?\d+(?:\.\d+)?)\s*black_end:\s*(-?\d+(?:\.\d+)?)/g,
    ),
  ].map((match) => ({
    fromSeconds: Number(match[1]),
    toSeconds: Number(match[2]),
  }))

  return { cuts, freezes, blacks }
}

// A whole-video decode can comfortably exceed the 30s default ffmpeg
// timeout even at the scale-down above — a long-form upload still has to be
// read frame-by-frame once. Overridable for unusually long sources.
const SCENE_CUE_SCAN_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function getSceneCueScanTimeoutMs(): number {
  const raw = process.env.SCENE_CUE_SCAN_TIMEOUT_MS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : SCENE_CUE_SCAN_DEFAULT_TIMEOUT_MS
}

// Runs the full-video scan against a signed source URL and returns the
// parsed cues. Bubbles ffmpeg failures/timeouts to the caller, which treats
// the whole scan as failed (see lib/video-scene-cue-scan.ts) rather than
// trying to salvage a partial decode.
export async function scanVideoSceneCues(
  sourceUrl: string,
  durationSeconds: number,
): Promise<SceneCueScanResult> {
  const { stderr } = await runFfmpegCapturingOutput(
    buildSceneCueScanArgs(sourceUrl),
    { timeoutMs: getSceneCueScanTimeoutMs() },
  )
  return parseSceneCues(stderr, durationSeconds)
}
