// Aggregates every piece of "deep analysis" evidence a video's retention
// windows have accumulated so far — synthesized events, clipped transcripts,
// harvested snapshots (with signed read URLs) and the harvested audio clip
// (with a signed read URL) — grouped by window, for the analysis detail
// page's evidence breakdown (components/deep-analysis-evidence.tsx).
//
// Purely read-only: it never triggers extraction/analysis/synthesis, just
// renders whatever lib/retention-window-media-trigger.ts has produced so far,
// however partial.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  assignGlobalInsightRanks,
  evaluateRetentionWindowInsights,
  type RankedRetentionWindowEvent,
  type SuppressedRetentionWindowEvent,
} from "@/lib/deep-analysis-insight-ranking"
import {
  getDeepAnalysisMaxInsightsPerWindow,
  getDeepAnalysisMaxRecommendationsPerWindow,
  getDeepAnalysisMinimumInsightScore,
} from "@/lib/deep-analysis-config"
import {
  compileDeepAnalysisRecommendations,
  dedupeDeepAnalysisRecommendations,
  type DeepAnalysisRecommendation,
} from "@/lib/deep-analysis-recommendations"

import {
  getDeepAnalysisInsightFeedbackForVideo,
  type DeepAnalysisInsightFeedback,
} from "@/lib/deep-analysis-insight-feedback"
import {
  getRetentionWindowCostsForVideo,
  type RetentionWindowCost,
} from "@/lib/retention-window-costs"
import { transcodingCostUsd } from "@/lib/transcoding-cost"
import { getRetentionWindowMediaStorageProvider } from "@/lib/retention-window-media-config"
import type { AudioAnalysis } from "@/lib/retention-window-media-analysis"
import {
  getRetentionWindowAudioForVideo,
  getRetentionWindowSnapshotsForVideo,
  type RetentionWindowAudioClip,
  type RetentionWindowSnapshot,
} from "@/lib/retention-window-media"
import {
  getRetentionWindowEvents,
  type RetentionWindowEvent,
} from "@/lib/retention-window-events"
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import {
  getRetentionWindows,
  type PersistedRetentionWindow,
} from "@/lib/retention-windows"
import {
  computeAverageSceneCueMetrics,
  computeSceneCueMetrics,
  getVideoSceneCues,
  type SceneCueMetrics,
} from "@/lib/video-scene-cues"
import { getSparseVideoFeatureBaseline } from "@/lib/video-feature-baseline"

// Long enough to cover a single page view without needing to be refreshed,
// the same reasoning the source-file playback URL (60 minutes) already uses.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60

export interface DeepAnalysisSnapshotView extends RetentionWindowSnapshot {
  imageUrl: string | null
}

export interface DeepAnalysisAudioView extends RetentionWindowAudioClip {
  audioUrl: string | null
}

// This video's own averages across every scanned/analysed window, so each
// window's editing and pacing can be read as a deviation from the creator's
// norm rather than in absolute terms — the same baseline the event
// synthesizer is handed (lib/retention-window-event-synthesis.ts). Fields are
// null when nothing has been scanned/measured to average yet.
export interface DeepAnalysisBaseline {
  cutsPerMinute: number | null
  freezeCoverage: number | null
  blackCoverage: number | null
  speechRate: number | null
  motion: number | null
}

export interface WindowEvidence {
  window: PersistedRetentionWindow
  displayLabel: string
  events: RankedRetentionWindowEvent[]
  recommendations: DeepAnalysisRecommendation[]
  suppressedInsights: SuppressedRetentionWindowEvent[]
  transcript: string | null
  snapshots: DeepAnalysisSnapshotView[]
  audio: DeepAnalysisAudioView | null
  // Deterministic cut/freeze/black metrics for this window's analysis range
  // (lib/media/scene-detection.ts via video_scene_cues). Null when the window
  // has no analysis range to scan over.
  editing: SceneCueMetrics | null
  // Shared video-wide baseline (identical on every window) so editing/pacing
  // can be shown as a deviation from the creator's norm.
  baseline: DeepAnalysisBaseline
  // What each of this window's LLM calls cost, and their sum. Empty/0 for a
  // window analysed before cost tracking existed (or whose costing writes
  // failed) — those simply render no cost figure.
  costs: RetentionWindowCost[]
  totalCostUsd: number
  feedback: DeepAnalysisInsightFeedback | null
}

// A video's full deep-analysis evidence plus the video-level cost roll-up: the
// per-window evidence, the one-time Qencode transcoding cost, the summed LLM
// spend across every window, and their grand total. The transcoding cost sits
// at the video level (not per window) because it's charged once to produce the
// proxies every window is then analysed from.
export interface DeepAnalysisEvidence {
  windows: WindowEvidence[]
  // One-time Qencode transcoding cost for this video's proxies, derived from
  // its duration. 0 when the source wasn't transcoded (the original was kept)
  // or its duration is unknown.
  transcodingCostUsd: number
  // Sum of every window's LLM spend.
  llmCostUsd: number
  // transcodingCostUsd + llmCostUsd — the full cost of deep-analysing the video.
  totalCostUsd: number
}

const KIND_ORDER: Record<PersistedRetentionWindow["kind"], number> = {
  hook: 0,
  drop_off: 1,
  gain: 2,
}

function windowDisplayLabel(window: PersistedRetentionWindow): string {
  if (window.kind === "hook") return window.label ?? "Hook"
  const ordinal = window.windowIndex + 1
  return window.kind === "drop_off" ? `Drop-off #${ordinal}` : `Gain #${ordinal}`
}

// Loads a video's full evidence set and groups it by window, skipping any
// window nothing has been harvested or synthesized for yet (e.g. a hook
// window with no analysis range, or a window whose media is still pending).
// Windows are ordered hook, then drop-off, then gain — each by windowIndex —
// matching the order the rest of the detail page presents them in.
//
// `transcodedDurationSeconds` is the duration of the video Qencode transcoded,
// used to derive the one-time transcoding cost; pass null when the source
// wasn't transcoded (the original was kept) so no transcoding cost is charged.
export async function getDeepAnalysisEvidence(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  transcodedDurationSeconds: number | null = null,
): Promise<DeepAnalysisEvidence> {
  const [
    windows,
    events,
    transcripts,
    snapshots,
    audioClips,
    costs,
    cues,
    feedbackByWindow,
    sparseBaseline,
  ] =
    await Promise.all([
      getRetentionWindows(supabase, userId, analysedVideoId),
      getRetentionWindowEvents(supabase, userId, analysedVideoId),
      getRetentionWindowTranscripts(supabase, userId, analysedVideoId),
      getRetentionWindowSnapshotsForVideo(supabase, userId, analysedVideoId),
      getRetentionWindowAudioForVideo(supabase, userId, analysedVideoId),
      getRetentionWindowCostsForVideo(supabase, userId, analysedVideoId),
      getVideoSceneCues(supabase, userId, analysedVideoId),
      getDeepAnalysisInsightFeedbackForVideo(supabase, userId, analysedVideoId),
      getSparseVideoFeatureBaseline(supabase, userId, analysedVideoId).catch(
        () => null,
      ),
    ])

  // The video-wide baseline, computed once and shared by every window — the
  // same averaging the synthesizer uses: editing over each analysed window's
  // own metrics, speech rate over whatever audio clips have analysed.
  const analysisRanges = windows
    .filter((w) => w.analysisFromSeconds != null && w.analysisToSeconds != null)
    .map((w) => ({
      fromSeconds: w.analysisFromSeconds as number,
      toSeconds: w.analysisToSeconds as number,
    }))
  const editingBaseline = computeAverageSceneCueMetrics(cues, analysisRanges)
  const speechRates = audioClips
    .filter((a) => a.analysisStatus === "ready" && a.analysis != null)
    .map((a) => (a.analysis as AudioAnalysis).speech_rate)
    .filter((rate): rate is number => rate != null)
  const speechRateBaseline =
    speechRates.length > 0
      ? Math.round(
          speechRates.reduce((sum, rate) => sum + rate, 0) / speechRates.length,
        )
      : null
  const baseline: DeepAnalysisBaseline = {
    cutsPerMinute:
      sparseBaseline?.cutsPerMinute ?? editingBaseline?.cutsPerMinute ?? null,
    freezeCoverage:
      sparseBaseline?.freezeCoverage ??
      editingBaseline?.freezeCoverage ??
      null,
    blackCoverage:
      sparseBaseline?.blackCoverage ?? editingBaseline?.blackCoverage ?? null,
    speechRate: sparseBaseline?.speechRate ?? speechRateBaseline,
    motion: sparseBaseline?.motion ?? null,
  }

  const eventsByWindow = new Map<string, RetentionWindowEvent[]>()
  for (const event of events) {
    const group = eventsByWindow.get(event.retentionWindowId)
    if (group) group.push(event)
    else eventsByWindow.set(event.retentionWindowId, [event])
  }

  const transcriptByWindow = new Map(
    transcripts.map((t) => [t.retentionWindowId, t.transcript]),
  )

  const snapshotsByWindow = new Map<string, RetentionWindowSnapshot[]>()
  for (const snapshot of snapshots) {
    const group = snapshotsByWindow.get(snapshot.retentionWindowId)
    if (group) group.push(snapshot)
    else snapshotsByWindow.set(snapshot.retentionWindowId, [snapshot])
  }

  const audioByWindow = new Map(audioClips.map((a) => [a.retentionWindowId, a]))

  const costsByWindow = new Map<string, RetentionWindowCost[]>()
  for (const cost of costs) {
    const group = costsByWindow.get(cost.retentionWindowId)
    if (group) group.push(cost)
    else costsByWindow.set(cost.retentionWindowId, [cost])
  }

  const mediaStorage = getRetentionWindowMediaStorageProvider()

  async function signedUrlFor(storagePath: string | null): Promise<string | null> {
    if (!storagePath) return null
    try {
      return await mediaStorage.createSignedReadUrl(
        storagePath,
        SIGNED_URL_EXPIRY_SECONDS,
      )
    } catch (error) {
      console.error("Failed to sign deep analysis media URL", error)
      return null
    }
  }

  const sortedWindows = [...windows].sort((a, b) => {
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    return kindDiff !== 0 ? kindDiff : a.windowIndex - b.windowIndex
  })

  const result: WindowEvidence[] = []
  for (const window of sortedWindows) {
    const rawWindowEvents = eventsByWindow.get(window.id) ?? []
    const transcript = transcriptByWindow.get(window.id) ?? null
    const windowSnapshots = snapshotsByWindow.get(window.id) ?? []
    const audio = audioByWindow.get(window.id) ?? null
    const windowCosts = costsByWindow.get(window.id) ?? []

    if (
      rawWindowEvents.length === 0 &&
      transcript == null &&
      windowSnapshots.length === 0 &&
      audio == null
    ) {
      continue
    }

    const snapshotViews: DeepAnalysisSnapshotView[] = await Promise.all(
      windowSnapshots.map(async (snapshot) => ({
        ...snapshot,
        imageUrl:
          snapshot.status === "ready"
            ? await signedUrlFor(snapshot.storagePath)
            : null,
      })),
    )

    const audioView: DeepAnalysisAudioView | null = audio
      ? {
          ...audio,
          audioUrl: audio.status === "ready" ? await signedUrlFor(audio.storagePath) : null,
        }
      : null

    const editing =
      window.analysisFromSeconds != null && window.analysisToSeconds != null
        ? computeSceneCueMetrics(
            cues,
            window.analysisFromSeconds,
            window.analysisToSeconds,
          )
        : null

    const insightEvaluation = evaluateRetentionWindowInsights({
      events: rawWindowEvents,
      window,
      minimumScore: getDeepAnalysisMinimumInsightScore(),
      maxInsights: getDeepAnalysisMaxInsightsPerWindow(),
      evidence: {
        hasEditing: editing != null,
        hasVisual: windowSnapshots.some(
          (snapshot) =>
            snapshot.analysisStatus === "ready" && snapshot.analysis != null,
        ),
        hasAudio: audio?.analysisStatus === "ready" && audio.analysis != null,
        hasTranscript: transcript != null && transcript.trim().length > 0,
      },
    })
    const windowEvents = insightEvaluation.ranked
    const analysedAudio =
      audio?.analysisStatus === "ready" && audio.analysis != null
        ? (audio.analysis as AudioAnalysis)
        : null
    const recommendations = compileDeepAnalysisRecommendations({
      events: windowEvents,
      window,
      editing,
      baseline,
      audio: analysedAudio,
      maxRecommendations: getDeepAnalysisMaxRecommendationsPerWindow(),
    })

    result.push({
      window,
      displayLabel: windowDisplayLabel(window),
      events: windowEvents,
      recommendations,
      suppressedInsights: insightEvaluation.suppressed,
      transcript,
      snapshots: snapshotViews,
      audio: audioView,
      editing,
      baseline,
      costs: windowCosts,
      totalCostUsd: windowCosts.reduce((sum, cost) => sum + cost.costUsd, 0),
      feedback: feedbackByWindow.get(window.id) ?? null,
    })
  }

  assignGlobalInsightRanks(result.map((window) => window.events))
  dedupeDeepAnalysisRecommendations(
    result.map((window) => window.recommendations),
  )

  const llmCostUsd = result.reduce((sum, w) => sum + w.totalCostUsd, 0)
  const transcodingCost = transcodingCostUsd(transcodedDurationSeconds)

  return {
    windows: result,
    transcodingCostUsd: transcodingCost,
    llmCostUsd,
    totalCostUsd: transcodingCost + llmCostUsd,
  }
}
