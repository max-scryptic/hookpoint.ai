// Synthesizes cross-modal "events" for each retention window whose evidence
// has fully settled — the deterministic editing metrics, the already-computed
// per-snapshot vision analysis, and the audio analysis — into a handful of
// timestamped, narrated events explaining what plausibly drove that window's
// retention change. One more LLM call per window; it never touches raw media
// again — only the structured JSON/text evidence that extraction
// (lib/retention-window-media-extraction.ts) and analysis
// (lib/retention-window-media-analysis.ts) already produced, so this is a
// cheap text-only completion, not a second vision/audio call.
//
// Runs after analyzeRetentionWindowMedia in the same trigger (see
// lib/retention-window-media-trigger.ts): a window is only synthesized once
// its scene-cue scan, every one of its snapshots, and its audio clip have all
// *settled* (ready or failed) — not necessarily succeeded, since an event can
// still be synthesized from whatever evidence did come through. A window
// that hasn't settled yet is silently skipped and retried on a later trigger.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getAnalysedVideoTranscriptById } from "@/lib/analysed-videos"
import {
  getChannelEventHistory,
  type ChannelEventHistory,
} from "@/lib/channel-event-history"
import { runWithConcurrency } from "@/lib/concurrency"
import { recordLlmCallCost } from "@/lib/llm-calls"
import { responsesCallCost, type LlmCallCost } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import { recordRetentionWindowCost } from "@/lib/retention-window-costs"
import {
  getEventSynthesisModel,
  getRetentionWindowAiCallConcurrency,
} from "@/lib/retention-window-media-config"
import {
  callOpenAiResponses,
  computeSpeechRate,
  type AudioAnalysis,
  type SnapshotAnalysis,
} from "@/lib/retention-window-media-analysis"
import {
  getRetentionWindowAudioForVideo,
  getRetentionWindowSnapshotsForVideo,
} from "@/lib/retention-window-media"
import {
  claimPendingRetentionWindowEventSynthesisJobs,
  replaceRetentionWindowEvents,
  updateRetentionWindowEventSynthesisStatus,
  type RetentionWindowEventPrimaryEvidence,
  type RetentionWindowEventType,
  type SynthesizedEvent,
} from "@/lib/retention-window-events"
import { getRetentionAttribution } from "@/lib/retention-attributions"
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import type { WindowTranscriptTaxonomy } from "@/lib/retention-window-transcript-taxonomy"
import { getRetentionWindows } from "@/lib/retention-windows"
import { transcriptForSegment, type TranscriptCue } from "@/lib/youtube/youtube"
import type { MotionBucket } from "@/lib/media/scene-detection"
import { getSparseVideoFeatureBaseline } from "@/lib/video-feature-baseline"
import {
  computeAverageSceneCueMetrics,
  computeSceneCueMetrics,
  getRetentionWindowSceneCueScanStatuses,
  getVideoSceneCues,
  type SceneCueMetrics,
} from "@/lib/video-scene-cues"

export interface ContrastRange {
  fromSeconds: number
  toSeconds: number
}

export interface WindowContrastEvidence {
  controlRange: ContrastRange
  targetRange: ContrastRange
  controlEditing: SceneCueMetrics
  targetEditing: SceneCueMetrics
  editingDelta: {
    cutsPerMinute: number | null
    freezeCoverage: number
    blackCoverage: number
  }
  // References into `visual` below, avoiding a second copy of every frame in
  // the LLM payload while making the control/target split explicit.
  controlVisualChunkIndexes: number[]
  targetVisualChunkIndexes: number[]
  controlAudio: ContrastAudioSummary
  targetAudio: ContrastAudioSummary
  audioDelta: {
    averageVolumeDb: number | null
    silence: number | null
    speechRate: number | null
  }
  controlMotion: number | null
  targetMotion: number | null
  motionDelta: number | null
}

export interface ContrastAudioSummary {
  averageVolumeDb: number | null
  silence: number | null
  speechRate: number | null
}

function summarizeAudioRange(
  audio: AudioAnalysis | null,
  transcript: TranscriptCue[],
  range: ContrastRange,
): ContrastAudioSummary {
  const timeline = audio?.signal_timeline ?? []
  let coveredSeconds = 0
  let volumeWeighted = 0
  let volumeSeconds = 0
  let silenceWeighted = 0

  for (const bucket of timeline) {
    const overlap = Math.max(
      0,
      Math.min(bucket.to_seconds, range.toSeconds) -
        Math.max(bucket.from_seconds, range.fromSeconds),
    )
    if (overlap <= 0) continue
    coveredSeconds += overlap
    silenceWeighted += bucket.silence * overlap
    if (bucket.average_volume != null) {
      volumeWeighted += bucket.average_volume * overlap
      volumeSeconds += overlap
    }
  }

  return {
    averageVolumeDb:
      volumeSeconds > 0 ? volumeWeighted / volumeSeconds : null,
    silence: coveredSeconds > 0 ? silenceWeighted / coveredSeconds : null,
    speechRate: computeSpeechRate(
      transcriptForSegment(transcript, range.fromSeconds, range.toSeconds),
      range.fromSeconds,
      range.toSeconds,
    ),
  }
}

function summarizeMotionRange(
  buckets: MotionBucket[],
  range: ContrastRange,
): number | null {
  let weightedScore = 0
  let coveredSeconds = 0
  for (const bucket of buckets) {
    const overlap = Math.max(
      0,
      Math.min(bucket.toSeconds, range.toSeconds) -
        Math.max(bucket.fromSeconds, range.fromSeconds),
    )
    if (overlap <= 0) continue
    weightedScore += bucket.score * overlap
    coveredSeconds += overlap
  }
  return coveredSeconds > 0 ? weightedScore / coveredSeconds : null
}

// Builds the nearest fair pre-event comparison available inside the footage
// already harvested for a retention window. The target is the detected
// retention episode itself. Its control is an equally sized preceding range,
// with a 10s minimum (enough to observe pacing) and 30s maximum (keeps the
// comparison local), clamped to the padded analysis range. Hooks have no true
// pre-event footage and therefore deliberately return null.
export function buildWindowContrastRanges(params: {
  kind: string
  eventFromSeconds: number
  eventToSeconds: number
  analysisFromSeconds: number
  analysisToSeconds: number
}): { controlRange: ContrastRange; targetRange: ContrastRange } | null {
  if (params.kind === "hook") return null

  const targetFrom = Math.max(
    params.analysisFromSeconds,
    params.eventFromSeconds,
  )
  const targetTo = Math.min(params.analysisToSeconds, params.eventToSeconds)
  if (targetTo <= targetFrom) return null

  const desiredControlSeconds = Math.min(
    30,
    Math.max(10, targetTo - targetFrom),
  )
  const controlTo = targetFrom
  const controlFrom = Math.max(
    params.analysisFromSeconds,
    controlTo - desiredControlSeconds,
  )
  if (controlTo <= controlFrom) return null

  return {
    controlRange: { fromSeconds: controlFrom, toSeconds: controlTo },
    targetRange: { fromSeconds: targetFrom, toSeconds: targetTo },
  }
}

export type BaselineComparison = "below" | "at" | "above" | "unavailable"

// Where each of this window's measured values sits against this video's own
// baseline, decided in code rather than left to the model's own arithmetic on
// two raw numbers. It was doing that arithmetic badly: a hook with no cuts in a
// video that has almost no cuts anywhere came back narrated as "no cuts, which
// contrasts with your usual baseline of about 0 cuts per minute", asserting a
// contrast between two identical values. "at" states plainly that the window
// matches the norm, which is evidence AGAINST an explanation resting on that
// metric, not for one.
export interface BaselineDeviation {
  cutsPerMinute: BaselineComparison
  freezeCoverage: BaselineComparison
  blackCoverage: BaselineComparison
  speechRate: BaselineComparison
  motion: BaselineComparison
}

// `floor` is the size below which a value is indistinguishable from nothing on
// that metric (a cut rate under half a cut per minute is "not cutting"). It
// does double duty: when both the window and the baseline sit under it the
// metric is flat across the whole video and this window cannot deviate from it
// in either direction, and it keeps the relative tolerance from collapsing to
// zero when the baseline itself is tiny, which would otherwise make every
// rounding difference read as a deviation.
export function compareToBaseline(
  value: number | null | undefined,
  baseline: number | null | undefined,
  options: { floor: number; tolerance?: number },
): BaselineComparison {
  if (value == null || baseline == null) return "unavailable"
  if (Math.abs(value) < options.floor && Math.abs(baseline) < options.floor) {
    return "at"
  }
  const spread = Math.max(Math.abs(baseline), options.floor)
  const delta = value - baseline
  if (Math.abs(delta) <= spread * (options.tolerance ?? 0.15)) return "at"
  return delta > 0 ? "above" : "below"
}

// The evidence bundle handed to the synthesis call for one window — every
// field here is already-computed (deterministic or a prior LLM call's
// output), never raw media.
export interface WindowEvidence {
  kind: string
  delta: number
  steepness: number | null
  relativePerformance: number | null
  fromSeconds: number
  toSeconds: number
  transcript: string | null
  // The script-only explanation already shown to the user for this window
  // (lib/retention-attribution.ts), when one has been generated. Given so the
  // synthesizer only surfaces events that ADD to or CONTRADICT it — a
  // visual/audio/editing cause the words alone can't reveal — rather than
  // restating a cause the free tier already gave. Null when no script
  // attribution exists yet for this video.
  scriptExplanation: string | null
  // This window's own structured transcript read (lib/retention-window-transcript-taxonomy.ts):
  // what the words in this span say and how they feel, on the same closed axes
  // the whole-video script taxonomy uses. Best-effort context, never a
  // prerequisite — null when it hasn't been generated (or failed/was skipped),
  // and synthesis never waits on it. Lets an event lean on, say, a topic shift
  // or an energy dip the words carry without re-deriving it from raw transcript.
  transcriptTaxonomy: WindowTranscriptTaxonomy | null
  editing: {
    cutCount: number
    cutsPerMinute: number | null
    freezeCoverage: number
    blackCoverage: number
  }
  // This window's own average motion (normalised 0..1 frame difference) over
  // the analysis range, so it can be compared against the video's motion
  // baseline on the same scale. Null when the scene-cue scan produced no
  // motion buckets covering the range.
  motion: number | null
  // This video's own averages, so editing and pacing are judged as deviations
  // from the creator's norm rather than in absolute terms: a static, low-cut
  // stretch only explains a drop when it's slower than the rest of the video.
  // Fields are null when there's nothing scanned/measured to average yet.
  baseline: {
    cutsPerMinute: number | null
    freezeCoverage: number | null
    blackCoverage: number | null
    speechRate: number | null
    motion: number | null
  }
  // The window-versus-baseline comparison already resolved into a direction,
  // so the narrative never has to (and never gets to) derive it from the raw
  // numbers itself. See BaselineDeviation.
  baselineDeviation: BaselineDeviation
  visual: {
    chunkIndex: number
    timestampSeconds: number
    // Deterministic OCR text for this exact frame (lib/media/ocr.ts), not the
    // vision model's own judgment — on_screen_text_change events can compare
    // this across chunks without needing the model to have transcribed it.
    ocrText: string | null
    analysis: SnapshotAnalysis
  }[]
  audio: AudioAnalysis | null
  // Local counterfactual: how the detected episode differs from the footage
  // immediately preceding it. Null for the opening hook, which has no prior
  // segment inside the video to use as a fair control.
  contrast: WindowContrastEvidence | null
  // Cross-video prior: a compact summary of the events previously synthesized
  // across this uploader's OTHER deeply-analysed videos (which event types
  // recur in hooks/drop-offs/gains and across how many videos, plus example
  // narratives). Context for framing recurring channel habits — never grounds
  // for inventing a local event. Null until enough other videos have been
  // deeply analysed to call anything a trend.
  channelHistory: ChannelEventHistory | null
}

type VisualFrame = WindowEvidence["visual"][number]

// True when two already-analysed frames represent the same visual state: every
// categorical judgment the vision model made matches and the deterministic OCR
// text is identical. The free-text notable_event/description are deliberately
// ignored — on a static talking head they narrate micro-motion ("his head dips
// a little lower") that reads as change without being any, which is exactly the
// redundancy this collapses. camera_movement is part of the comparison, so a
// frame the model tagged "cut" never merges with a neighbouring "static" one:
// a real transition's two flanking frames stay distinct while a false cut's
// (both "static") collapse.
function isSameVisualState(a: VisualFrame, b: VisualFrame): boolean {
  return (
    a.ocrText === b.ocrText &&
    a.analysis.scene === b.analysis.scene &&
    a.analysis.motion === b.analysis.motion &&
    a.analysis.camera_movement === b.analysis.camera_movement &&
    a.analysis.face_visible === b.analysis.face_visible &&
    a.analysis.contains_text === b.analysis.contains_text &&
    a.analysis.contains_code === b.analysis.contains_code &&
    a.analysis.people_count === b.analysis.people_count
  )
}

// Collapses runs of consecutive near-identical frames (see isSameVisualState)
// down to the first frame of each run, so the synthesis call isn't paid to
// re-read a handful of frames showing the same unchanged shot. Input must be in
// chronological (chunkIndex) order, which getRetentionWindowSnapshotsForVideo
// already guarantees. Only what's sent to the model is trimmed — the full set
// of harvested frames is still surfaced in the oversight UI
// (components/deep-analysis-evidence.tsx).
export function dedupeAdjacentVisualFrames(
  frames: VisualFrame[],
): VisualFrame[] {
  const kept: VisualFrame[] = []
  for (const frame of frames) {
    const prev = kept[kept.length - 1]
    if (prev && isSameVisualState(prev, frame)) continue
    kept.push(frame)
  }
  return kept
}

// The synthesized events plus the cost of the LLM call that produced them, so
// the orchestrator can persist per-window spend without the synthesizer
// needing a DB handle — mirrors AnalyzeSnapshotsResult on the analysis side.
export interface SynthesizeResult {
  events: SynthesizedEvent[]
  cost: LlmCallCost
}

// Split out so tests can inject a fake synthesizer instead of hitting
// OpenAI, the same way RetentionWindowMediaAnalyzer lets analysis tests do.
export interface RetentionWindowEventSynthesizer {
  synthesize(evidence: WindowEvidence): Promise<SynthesizeResult>
}

export interface RetentionWindowEventSynthesisDeps {
  synthesizer: RetentionWindowEventSynthesizer
}

export function defaultRetentionWindowEventSynthesisDeps(): RetentionWindowEventSynthesisDeps {
  return { synthesizer: openAiRetentionWindowEventSynthesizer }
}

function isSettled(status: string): boolean {
  return status === "ready" || status === "failed"
}

// Analysis only runs after extraction succeeds. A failed extraction therefore
// settles that evidence item even though its analysis_status remains pending:
// there will never be media for the analysis worker to claim.
function isMediaAnalysisSettled(media: {
  status: string
  analysisStatus: string
}): boolean {
  return media.status === "failed" || isSettled(media.analysisStatus)
}

// Synthesizes events for every window whose event-synthesis job is pending
// (or a stale failure) *and* whose evidence has settled. Best-effort per
// window — a bad OpenAI call or malformed response fails just that window's
// job, the same failure-isolation extraction/analysis already use.
export async function synthesizeRetentionWindowEvents(
  admin: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  deps: RetentionWindowEventSynthesisDeps = defaultRetentionWindowEventSynthesisDeps(),
): Promise<void> {
  const pendingJobs = await claimPendingRetentionWindowEventSynthesisJobs(
    admin,
    userId,
    analysedVideoId,
  )
  if (pendingJobs.length === 0) return

  const [
    windows,
    snapshots,
    audioClips,
    sceneCueScanStatuses,
    cues,
    transcripts,
    attribution,
    videoTranscript,
    sparseBaseline,
    channelHistory,
  ] = await Promise.all([
    getRetentionWindows(admin, userId, analysedVideoId),
    getRetentionWindowSnapshotsForVideo(admin, userId, analysedVideoId),
    getRetentionWindowAudioForVideo(admin, userId, analysedVideoId),
    getRetentionWindowSceneCueScanStatuses(admin, userId, analysedVideoId),
    getVideoSceneCues(admin, userId, analysedVideoId),
    getRetentionWindowTranscripts(admin, userId, analysedVideoId),
    // Best-effort: the script attribution is generated lazily when the report
    // page opens, so it may not exist yet when synthesis runs off the upload.
    // A missing (or failed) read just leaves scriptExplanation null — the
    // dedup reference is an enhancement, never a prerequisite.
    getRetentionAttribution(admin, userId, analysedVideoId).catch(() => null),
    getAnalysedVideoTranscriptById(admin, userId, analysedVideoId).catch(
      () => [],
    ),
    getSparseVideoFeatureBaseline(admin, userId, analysedVideoId).catch(() => null),
    // Best-effort like the attribution read: channel history enriches the
    // narratives but must never block or fail a window's synthesis.
    getChannelEventHistory(admin, userId, analysedVideoId).catch(() => null),
  ])

  const windowById = new Map(windows.map((w) => [w.id, w]))
  const snapshotsByWindow = new Map<string, typeof snapshots>()
  for (const snapshot of snapshots) {
    const group = snapshotsByWindow.get(snapshot.retentionWindowId)
    if (group) group.push(snapshot)
    else snapshotsByWindow.set(snapshot.retentionWindowId, [snapshot])
  }
  const audioByWindow = new Map(audioClips.map((a) => [a.retentionWindowId, a]))
  const scanByWindow = new Map(
    sceneCueScanStatuses.map((scan) => [scan.retentionWindowId, scan]),
  )
  const transcriptByWindow = new Map(
    transcripts.map((t) => [t.retentionWindowId, t.transcript]),
  )
  // Only ready taxonomies are handed to the synthesizer — a pending/failed/
  // skipped one contributes nothing and must never masquerade as a read.
  const transcriptTaxonomyByWindow = new Map(
    transcripts
      .filter((t) => t.taxonomyStatus === "ready" && t.taxonomy != null)
      .map((t) => [t.retentionWindowId, t.taxonomy as WindowTranscriptTaxonomy]),
  )

  // The script-only explanation the user was already shown for each window,
  // keyed the same way the attribution itself joins back onto a window: by
  // kind + windowIndex. Used purely as a dedup reference for the synthesizer.
  const scriptExplanationByWindow = new Map<string, string>()
  for (const moment of attribution?.moments ?? []) {
    if (moment.explanation) {
      scriptExplanationByWindow.set(
        `${moment.kind}:${moment.windowIndex}`,
        moment.explanation,
      )
    }
  }

  // This video's own baseline, computed once and shared by every window so
  // each event can be framed as a deviation from the norm. The editing side
  // reuses the same per-window averaging the retention chart's baseline uses;
  // the speech-rate side averages whatever audio clips have already analysed.
  const analysisRanges = windows
    .filter(
      (w) => w.analysisFromSeconds != null && w.analysisToSeconds != null,
    )
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
  const baseline = {
    cutsPerMinute: sparseBaseline?.cutsPerMinute ?? editingBaseline?.cutsPerMinute ?? null,
    freezeCoverage: sparseBaseline?.freezeCoverage ?? editingBaseline?.freezeCoverage ?? null,
    blackCoverage: sparseBaseline?.blackCoverage ?? editingBaseline?.blackCoverage ?? null,
    speechRate: sparseBaseline?.speechRate ?? speechRateBaseline,
    motion: sparseBaseline?.motion ?? null,
  }

  const model = getEventSynthesisModel()

  // Every window's synthesis call is independent (own evidence bundle, own
  // job row) — the same property that already lets extraction run
  // concurrently, so there's no reason to award one window's OpenAI call
  // exclusive use of the wait before starting the next.
  await runWithConcurrency(
    pendingJobs,
    getRetentionWindowAiCallConcurrency(),
    async (job) => {
      const window = windowById.get(job.retentionWindowId)
      if (
        !window ||
        window.analysisFromSeconds == null ||
        window.analysisToSeconds == null
      ) {
        // The window vanished or lost its analysis window since this job was
        // created — nothing to synthesize; leave the job pending rather than
        // erroring (createPendingRetentionWindowEventSynthesis will clean it
        // up on the next analyze).
        return
      }

      const windowSnapshots = snapshotsByWindow.get(job.retentionWindowId) ?? []
      const scan = scanByWindow.get(job.retentionWindowId)
      const scanStatus = scan?.status
      const audio = audioByWindow.get(job.retentionWindowId)

      const scanSettled = scanStatus != null && isSettled(scanStatus)
      // A failed scan cannot produce snapshot rows, but is still a final
      // evidence outcome. Likewise, a failed snapshot/audio extraction never
      // advances its analysis_status beyond pending and must settle here via
      // the extraction status instead.
      const hasSnapshotOutcome =
        windowSnapshots.length > 0 || scanStatus === "failed"
      const snapshotsSettled = windowSnapshots.every(isMediaAnalysisSettled)
      const audioSettled = audio != null && isMediaAnalysisSettled(audio)

      if (
        !scanSettled ||
        !hasSnapshotOutcome ||
        !snapshotsSettled ||
        !audioSettled
      ) {
        // The job was claimed before loading its evidence. Release it so the
        // next trigger can retry immediately when the final prerequisite
        // settles rather than waiting for the stale-processing lease.
        await updateRetentionWindowEventSynthesisStatus(admin, userId, job.id, {
          status: "pending",
        })
        return
      }

      try {
        const visual = dedupeAdjacentVisualFrames(
          windowSnapshots
            .filter((s) => s.analysisStatus === "ready" && s.analysis != null)
            .map((s) => ({
              chunkIndex: s.chunkIndex,
              timestampSeconds: s.timestampSeconds,
              ocrText: s.ocrText,
              analysis: s.analysis as SnapshotAnalysis,
            })),
        )

        // Overlapping windows can persist the same physical cut more than
        // once, tagged to each source window. Scope metrics to this job's own
        // scan so its target/control comparison never double-counts another
        // window's copy of the cue.
        const windowCues = cues.filter(
          (cue) => cue.retentionWindowId === job.retentionWindowId,
        )
        const metrics = computeSceneCueMetrics(
          windowCues,
          window.analysisFromSeconds,
          window.analysisToSeconds,
        )

        const contrastRanges = buildWindowContrastRanges({
          kind: window.kind,
          eventFromSeconds: window.fromSeconds,
          eventToSeconds: window.toSeconds,
          analysisFromSeconds: window.analysisFromSeconds,
          analysisToSeconds: window.analysisToSeconds,
        })
        const contrast: WindowContrastEvidence | null = contrastRanges
          ? (() => {
              const controlEditing = computeSceneCueMetrics(
                windowCues,
                contrastRanges.controlRange.fromSeconds,
                contrastRanges.controlRange.toSeconds,
              )
              const targetEditing = computeSceneCueMetrics(
                windowCues,
                contrastRanges.targetRange.fromSeconds,
                contrastRanges.targetRange.toSeconds,
              )
              const analysedAudio =
                audio.analysisStatus === "ready"
                  ? (audio.analysis as AudioAnalysis)
                  : null
              const controlAudio = summarizeAudioRange(
                analysedAudio,
                videoTranscript,
                contrastRanges.controlRange,
              )
              const targetAudio = summarizeAudioRange(
                analysedAudio,
                videoTranscript,
                contrastRanges.targetRange,
              )
              const controlMotion = summarizeMotionRange(
                scan?.motionBuckets ?? [],
                contrastRanges.controlRange,
              )
              const targetMotion = summarizeMotionRange(
                scan?.motionBuckets ?? [],
                contrastRanges.targetRange,
              )
              const subtractNullable = (
                target: number | null,
                control: number | null,
              ) =>
                target != null && control != null ? target - control : null
              return {
                ...contrastRanges,
                controlEditing,
                targetEditing,
                editingDelta: {
                  cutsPerMinute:
                    controlEditing.cutsPerMinute != null &&
                    targetEditing.cutsPerMinute != null
                      ? targetEditing.cutsPerMinute -
                        controlEditing.cutsPerMinute
                      : null,
                  freezeCoverage:
                    targetEditing.freezeCoverage -
                    controlEditing.freezeCoverage,
                  blackCoverage:
                    targetEditing.blackCoverage - controlEditing.blackCoverage,
                },
                controlVisualChunkIndexes: visual
                  .filter(
                    (frame) =>
                      frame.timestampSeconds >=
                        contrastRanges.controlRange.fromSeconds &&
                      frame.timestampSeconds <
                        contrastRanges.controlRange.toSeconds,
                  )
                  .map((frame) => frame.chunkIndex),
                targetVisualChunkIndexes: visual
                  .filter(
                    (frame) =>
                      frame.timestampSeconds >=
                        contrastRanges.targetRange.fromSeconds &&
                      frame.timestampSeconds <=
                        contrastRanges.targetRange.toSeconds,
                  )
                  .map((frame) => frame.chunkIndex),
                controlAudio,
                targetAudio,
                audioDelta: {
                  averageVolumeDb: subtractNullable(
                    targetAudio.averageVolumeDb,
                    controlAudio.averageVolumeDb,
                  ),
                  silence: subtractNullable(
                    targetAudio.silence,
                    controlAudio.silence,
                  ),
                  speechRate: subtractNullable(
                    targetAudio.speechRate,
                    controlAudio.speechRate,
                  ),
                },
                controlMotion,
                targetMotion,
                motionDelta: subtractNullable(targetMotion, controlMotion),
              }
            })()
          : null

        const windowAudio =
          audio.analysisStatus === "ready"
            ? (audio.analysis as AudioAnalysis)
            : null
        const windowMotion = summarizeMotionRange(scan?.motionBuckets ?? [], {
          fromSeconds: window.analysisFromSeconds,
          toSeconds: window.analysisToSeconds,
        })

        const evidence: WindowEvidence = {
          kind: window.kind,
          delta: window.delta,
          steepness: window.steepness,
          relativePerformance: window.relativePerformance,
          fromSeconds: window.analysisFromSeconds,
          toSeconds: window.analysisToSeconds,
          transcript: transcriptByWindow.get(job.retentionWindowId) ?? null,
          scriptExplanation:
            scriptExplanationByWindow.get(
              `${window.kind}:${window.windowIndex}`,
            ) ?? null,
          transcriptTaxonomy:
            transcriptTaxonomyByWindow.get(job.retentionWindowId) ?? null,
          editing: {
            cutCount: metrics.cutCount,
            cutsPerMinute: metrics.cutsPerMinute,
            freezeCoverage: metrics.freezeCoverage,
            blackCoverage: metrics.blackCoverage,
          },
          motion: windowMotion,
          baseline,
          baselineDeviation: {
            // Under half a cut per minute is not cutting at all; a video that
            // never cuts cannot have a stretch that "cuts less than usual".
            cutsPerMinute: compareToBaseline(
              metrics.cutsPerMinute,
              baseline.cutsPerMinute,
              { floor: 0.5 },
            ),
            freezeCoverage: compareToBaseline(
              metrics.freezeCoverage,
              baseline.freezeCoverage,
              { floor: 0.02 },
            ),
            blackCoverage: compareToBaseline(
              metrics.blackCoverage,
              baseline.blackCoverage,
              { floor: 0.02 },
            ),
            speechRate: compareToBaseline(
              windowAudio?.speech_rate,
              baseline.speechRate,
              { floor: 5 },
            ),
            motion: compareToBaseline(windowMotion, baseline.motion, {
              floor: 0.02,
            }),
          },
          visual,
          audio: windowAudio,
          contrast,
          channelHistory,
        }

        const { events, cost } = await deps.synthesizer.synthesize(evidence)

        await replaceRetentionWindowEvents(
          admin,
          userId,
          analysedVideoId,
          job.retentionWindowId,
          events,
        )
        await updateRetentionWindowEventSynthesisStatus(admin, userId, job.id, {
          status: "ready",
          model,
        })
        await recordRetentionWindowCost(admin, {
          userId,
          analysedVideoId,
          retentionWindowId: job.retentionWindowId,
          step: "event_synthesis",
          cost,
        }).catch((error) =>
          console.error("Failed to record event synthesis cost", error),
        )
        await recordLlmCallCost(
          "event_synthesis",
          cost,
          { userId, analysedVideoId },
          admin,
        )
      } catch (error) {
        console.error("Failed to synthesize retention window events", error)
        await updateRetentionWindowEventSynthesisStatus(admin, userId, job.id, {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Failed to synthesize events",
        }).catch(() => {})
      }
    },
  )
}

// --- OpenAI-backed default synthesizer ---

const EVENT_TYPE_VALUES = [
  "scene_cut",
  "topic_shift",
  "visual_change",
  "audio_change",
  "pacing_change",
  "on_screen_text_change",
  "other",
] as const satisfies readonly RetentionWindowEventType[]

const PRIMARY_EVIDENCE_VALUES = [
  "editing",
  "visual",
  "audio",
  "transcript",
  "combined",
] as const satisfies readonly RetentionWindowEventPrimaryEvidence[]

const EVENT_SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "event_type",
          "timestamp_seconds",
          "narrative",
          "primary_evidence",
          "confidence",
        ],
        properties: {
          event_type: { type: "string", enum: EVENT_TYPE_VALUES },
          timestamp_seconds: { type: "number" },
          narrative: { type: "string" },
          primary_evidence: { type: "string", enum: PRIMARY_EVIDENCE_VALUES },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

// The prompt text lives in lib/prompts/defaults/deep-analysis.ts and is
// resolved by the "event_synthesis" key at send time, so an override saved in the admin
// Prompts page reaches the next call without a deploy (lib/prompts/resolve.ts).

export const openAiRetentionWindowEventSynthesizer: RetentionWindowEventSynthesizer =
  {
    async synthesize(evidence) {
      const model = getEventSynthesisModel()
      const instructions = await resolvePrompt("event_synthesis")
      const { text, usage } = await callOpenAiResponses({
        model,
        max_output_tokens: 2000,
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: instructions }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(evidence) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "retention_window_events",
            strict: true,
            schema: EVENT_SYNTHESIS_SCHEMA,
          },
        },
      })

      const parsed = JSON.parse(text) as {
        events: Array<{
          event_type: RetentionWindowEventType
          timestamp_seconds: number
          narrative: string
          primary_evidence: RetentionWindowEventPrimaryEvidence
          confidence: number
        }>
      }

      return {
        events: parsed.events.map((event) => ({
          eventType: event.event_type,
          timestampSeconds: event.timestamp_seconds,
          narrative: event.narrative,
          primaryEvidence: event.primary_evidence,
          confidence: Math.min(1, Math.max(0, event.confidence)),
        })),
        cost: responsesCallCost(model, usage),
      }
    },
  }
