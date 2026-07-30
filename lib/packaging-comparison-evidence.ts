// Everything already known about one video's OPENING, assembled for the
// packaging head-to-head (lib/packaging-comparison-report.ts). The window is
// the initial hook, 0-10s: RETENTION_WINDOWS[0] in lib/youtube/youtube.ts,
// persisted as a retention_windows row with kind 'hook' and window_index 0.
// Hooks are the one window kind computeAnalysisWindow gives no padding to, so
// the frames, OCR text and editing metrics harvested for it cover exactly the
// first ten seconds, and deep-analysis window selection always retains it.
//
// Nothing here calls a model or touches raw media. Every field was produced
// earlier in the pipeline (deterministic measurement, or a prior call's stored
// output) and is simply read back, so assembling this bundle for two videos
// costs two rounds of cheap selects.
//
// The paid audio read (music, tone, energy, notable events) is deliberately
// left out: it is the most expensive evidence we hold and adds little to a
// packaging judgement. The deterministic acoustics measured alongside it
// (speech rate, silence coverage, mean loudness) are free to carry and are
// exactly what separates a punchy opening from a rambling one, so those do
// come through.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included) - it feeds the Video Comparator surface. Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import { dedupeAdjacentVisualFrames } from "@/lib/retention-window-event-synthesis"
import { getRetentionWindowEvents } from "@/lib/retention-window-events"
import {
  getRetentionWindowAudioForVideo,
  getRetentionWindowSnapshotsForVideo,
} from "@/lib/retention-window-media"
import type {
  AudioAnalysis,
  SnapshotAnalysis,
} from "@/lib/retention-window-media-analysis"
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import type { WindowTranscriptTaxonomy } from "@/lib/retention-window-transcript-taxonomy"
import { getRetentionWindows } from "@/lib/retention-windows"
import { getSparseVideoFeatureBaseline } from "@/lib/video-feature-baseline"
import {
  computeSceneCueMetrics,
  getVideoSceneCues,
  type SceneCueMetrics,
} from "@/lib/video-scene-cues"
import { transcriptForSegment, type TranscriptCue } from "@/lib/youtube/youtube"

// The initial hook window's bounds. Kept as constants rather than read off the
// window row so the transcript fallback below still covers the right span for a
// video whose hook window never made it into deep analysis.
export const HOOK_EVIDENCE_FROM_SECONDS = 0
export const HOOK_EVIDENCE_TO_SECONDS = 10

// How the opening's retention actually behaved. Null fields simply mean that
// figure was never computed for this video.
export interface HookRetentionEvidence {
  fromSeconds: number
  toSeconds: number
  // Signed change in watch ratio across the window; negative for losses.
  delta: number
  startWatchRatio: number | null
  endWatchRatio: number | null
  relativePerformance: number | null
  steepness: number | null
}

// One already-described frame from the opening, with the deterministic OCR text
// recognized off that exact frame (lib/media/ocr.ts) rather than the vision
// model's guess at it.
export interface HookVisualFrame {
  timestampSeconds: number
  ocrText: string | null
  analysis: SnapshotAnalysis
}

// The deterministic acoustics only. See the file header for why the paid audio
// read is excluded.
export interface HookAudioSignals {
  speechRate: number | null
  averageVolumeDb: number | null
  silence: number | null
}

// One synthesized retention event already written for the opening
// (lib/retention-window-event-synthesis.ts), carried as prior reasoning the
// comparison can build on rather than re-derive.
export interface HookEventEvidence {
  eventType: string
  timestampSeconds: number
  narrative: string
  primaryEvidence: string
  confidence: number | null
}

// This video's own full-video averages, so the opening's editing and pacing
// read as a deviation from the creator's norm rather than in absolute terms.
export interface HookBaseline {
  cutsPerMinute: number | null
  freezeCoverage: number | null
  blackCoverage: number | null
  speechRate: number | null
  motion: number | null
}

export interface PackagingHookEvidence {
  retention: HookRetentionEvidence | null
  // The spoken opening, verbatim.
  transcript: string | null
  // The structured read of those words, when one was generated.
  transcriptTaxonomy: WindowTranscriptTaxonomy | null
  // Chronological, with runs of visually identical frames collapsed.
  visual: HookVisualFrame[]
  editing: SceneCueMetrics | null
  audio: HookAudioSignals | null
  events: HookEventEvidence[]
  baseline: HookBaseline
}

// True when the bundle carries anything a model could actually reason over. A
// video with none of this contributes only its title and thumbnail.
export function hasHookEvidence(evidence: PackagingHookEvidence): boolean {
  return (
    (evidence.transcript != null && evidence.transcript.trim().length > 0) ||
    evidence.visual.length > 0 ||
    evidence.events.length > 0 ||
    evidence.retention != null
  )
}

export function emptyHookEvidence(): PackagingHookEvidence {
  return {
    retention: null,
    transcript: null,
    transcriptTaxonomy: null,
    visual: [],
    editing: null,
    audio: null,
    events: [],
    baseline: {
      cutsPerMinute: null,
      freezeCoverage: null,
      blackCoverage: null,
      speechRate: null,
      motion: null,
    },
  }
}

// Assembles the opening's evidence for one video. Every read is best-effort and
// independent: a video with no source file (and therefore no harvested frames,
// no scene cues, no audio) still yields its retention numbers and its spoken
// opening, and a video with nothing at all yields an empty bundle rather than
// an error. `videoTranscript` is the whole video's cue list, used to recover
// the opening's words when the per-window transcript row is missing.
export async function loadPackagingHookEvidence(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  videoTranscript: TranscriptCue[],
): Promise<PackagingHookEvidence> {
  const [
    windows,
    transcripts,
    snapshots,
    audioClips,
    events,
    cues,
    sparseBaseline,
  ] = await Promise.all([
    getRetentionWindows(supabase, userId, analysedVideoId).catch(() => []),
    getRetentionWindowTranscripts(supabase, userId, analysedVideoId).catch(
      () => [],
    ),
    getRetentionWindowSnapshotsForVideo(
      supabase,
      userId,
      analysedVideoId,
    ).catch(() => []),
    getRetentionWindowAudioForVideo(supabase, userId, analysedVideoId).catch(
      () => [],
    ),
    getRetentionWindowEvents(supabase, userId, analysedVideoId).catch(() => []),
    getVideoSceneCues(supabase, userId, analysedVideoId).catch(() => []),
    getSparseVideoFeatureBaseline(supabase, userId, analysedVideoId).catch(
      () => null,
    ),
  ])

  const hook =
    windows.find(
      (window) => window.kind === "hook" && window.windowIndex === 0,
    ) ?? null

  // The spoken opening: the window's own clipped transcript when deep analysis
  // stored one, otherwise cut straight out of the video transcript so a video
  // that was never deep-analysed still contributes its opening words.
  const windowTranscript = hook
    ? transcripts.find((row) => row.retentionWindowId === hook.id)
    : undefined
  const fallbackTranscript = transcriptForSegment(
    videoTranscript,
    HOOK_EVIDENCE_FROM_SECONDS,
    HOOK_EVIDENCE_TO_SECONDS,
  )
  const transcript =
    windowTranscript?.transcript?.trim() ||
    fallbackTranscript?.trim() ||
    null

  const visual = hook
    ? dedupeAdjacentVisualFrames(
        snapshots
          .filter(
            (snapshot) =>
              snapshot.retentionWindowId === hook.id &&
              snapshot.analysisStatus === "ready" &&
              snapshot.analysis != null,
          )
          .map((snapshot) => ({
            chunkIndex: snapshot.chunkIndex,
            timestampSeconds: snapshot.timestampSeconds,
            ocrText: snapshot.ocrText,
            analysis: snapshot.analysis as SnapshotAnalysis,
          })),
      ).map(({ timestampSeconds, ocrText, analysis }) => ({
        timestampSeconds,
        ocrText,
        analysis,
      }))
    : []

  const hookAudio = hook
    ? audioClips.find(
        (clip) =>
          clip.retentionWindowId === hook.id &&
          clip.analysisStatus === "ready" &&
          clip.analysis != null,
      )
    : undefined
  const analysedAudio = hookAudio
    ? (hookAudio.analysis as AudioAnalysis)
    : null

  const editing =
    hook != null &&
    hook.analysisFromSeconds != null &&
    hook.analysisToSeconds != null
      ? computeSceneCueMetrics(
          cues.filter((cue) => cue.retentionWindowId === hook.id),
          hook.analysisFromSeconds,
          hook.analysisToSeconds,
        )
      : null

  return {
    retention: hook
      ? {
          fromSeconds: hook.fromSeconds,
          toSeconds: hook.toSeconds,
          delta: hook.delta,
          startWatchRatio: hook.startWatchRatio,
          endWatchRatio: hook.endWatchRatio,
          relativePerformance: hook.relativePerformance,
          steepness: hook.steepness,
        }
      : null,
    transcript,
    transcriptTaxonomy:
      windowTranscript?.taxonomyStatus === "ready" &&
      windowTranscript.taxonomy != null
        ? windowTranscript.taxonomy
        : null,
    visual,
    editing,
    audio: analysedAudio
      ? {
          speechRate: analysedAudio.speech_rate,
          averageVolumeDb: analysedAudio.average_volume,
          silence: analysedAudio.silence,
        }
      : null,
    events: hook
      ? events
          .filter((event) => event.retentionWindowId === hook.id)
          .map((event) => ({
            eventType: event.eventType,
            timestampSeconds: event.timestampSeconds,
            narrative: event.narrative,
            primaryEvidence: event.primaryEvidence,
            confidence: event.confidence,
          }))
      : [],
    baseline: {
      cutsPerMinute: sparseBaseline?.cutsPerMinute ?? null,
      freezeCoverage: sparseBaseline?.freezeCoverage ?? null,
      blackCoverage: sparseBaseline?.blackCoverage ?? null,
      speechRate: sparseBaseline?.speechRate ?? null,
      motion: sparseBaseline?.motion ?? null,
    },
  }
}
