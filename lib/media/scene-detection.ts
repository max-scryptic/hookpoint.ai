// Detects video-editing cues — hard cuts, freeze-frames, and cuts-to-black —
// within one retention window's analysis range, via a single ffmpeg pass over
// just that span. Purely deterministic (ffmpeg's own scene-change/freeze/
// black filters), no model involved: see lib/video-scene-cues.ts for how the
// resulting timestamps turn into cut-count/cuts-per-minute/freeze-and-black
// coverage metrics for any window on demand.
//
// Scoped to a window (like extractThumbnail/extractAudioSegment) rather than
// the whole video: a full-video decode has to read every frame of the
// source, so its cost scales with total video length rather than the number
// of interesting moments, and can exceed the timeout budget the routes that
// trigger extraction already run under for anything but a short video. `-ss`
// before `-i` seeks directly instead of decoding from the start, the same
// trick the other extraction functions already rely on.
//
// All three filters run in one -vf chain, not three separate ffmpeg
// invocations, since freezedetect/blackdetect pass every frame through
// unmodified (they just annotate stderr) — placing them ahead of
// select/showinfo (which drops every frame that isn't a detected cut) lets
// one decode of the window feed all three.

import { runFfmpegCapturingOutput } from "@/lib/media/ffmpeg"

// Downscaled before analysis: none of these filters need full resolution to
// tell a cut from a freeze from a black frame, and it cuts the cost of the
// per-pixel comparisons the filters make. Never upscales a source narrower
// than this.
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

// `-copyts` keeps every reported timestamp (pts_time, freeze_start,
// black_start/end) in the source video's own absolute timeline instead of
// rebasing to zero at the seek point — the default ffmpeg behaviour for a
// trimmed output. Without it, every parsed timestamp would need `fromSeconds`
// manually added back on, and would be wrong by however much `-ss` overshot
// while seeking to the nearest keyframe.
export function buildSceneCueScanArgs(
  sourceUrl: string,
  fromSeconds: number,
  toSeconds: number,
): string[] {
  const filters = [
    `scale='min(${SCENE_DETECTION_SCALE_WIDTH},iw)':-2`,
    `freezedetect=n=${FREEZE_NOISE_THRESHOLD_DB}dB:d=${FREEZE_MIN_DURATION_SECONDS}`,
    `blackdetect=d=${BLACK_MIN_DURATION_SECONDS}:pic_th=${BLACK_PICTURE_THRESHOLD}:pix_th=${BLACK_PIXEL_THRESHOLD}`,
    `select='gt(scene,${SCENE_CUT_SCORE_THRESHOLD})'`,
    "showinfo",
  ].join(",")

  return [
    "-ss",
    String(Math.max(0, fromSeconds)),
    "-i",
    sourceUrl,
    "-t",
    String(Math.max(0, toSeconds - fromSeconds)),
    "-an",
    "-copyts",
    "-vf",
    filters,
    "-f",
    "null",
    "-",
  ]
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
// order, one pair per span; `windowToSeconds` closes out a freeze still
// ongoing when the scanned window ends, since ffmpeg only logs
// freeze_duration once a freeze *ends* and a freeze running past the window
// would otherwise be dropped.
export function parseSceneCues(
  stderr: string,
  windowToSeconds: number,
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
        : Math.max(fromSeconds, windowToSeconds)
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

// Runs the scan against a signed source URL for [fromSeconds, toSeconds] and
// returns the parsed cues. Bubbles ffmpeg failures/timeouts to the caller,
// which treats the whole window's scan as failed (see
// lib/retention-window-media-extraction.ts) rather than trying to salvage a
// partial decode. No custom timeout: a single window's span is small enough
// (same order of magnitude as the audio/snapshot extraction already sharing
// this budget) that the default ffmpeg timeout is enough.
export async function scanVideoSceneCues(
  sourceUrl: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<SceneCueScanResult> {
  const { stderr } = await runFfmpegCapturingOutput(
    buildSceneCueScanArgs(sourceUrl, fromSeconds, toSeconds),
  )
  return parseSceneCues(stderr, toSeconds)
}
