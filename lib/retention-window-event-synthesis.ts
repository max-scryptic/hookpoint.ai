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
import { responsesCallCost, type LlmCallCost } from "@/lib/llm-cost"
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
  editing: {
    cutCount: number
    cutsPerMinute: number | null
    freezeCoverage: number
    blackCoverage: number
  }
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
          editing: {
            cutCount: metrics.cutCount,
            cutsPerMinute: metrics.cutsPerMinute,
            freezeCoverage: metrics.freezeCoverage,
            blackCoverage: metrics.blackCoverage,
          },
          baseline,
          visual,
          audio:
            audio.analysisStatus === "ready"
              ? (audio.analysis as AudioAnalysis)
              : null,
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

const EVENT_SYNTHESIS_INSTRUCTIONS = [
  "You are given every piece of already-analysed evidence for one window of a YouTube video where audience retention rose or fell: the window's retention delta, its transcript, deterministic editing metrics (cut count/rate, freeze/black-frame coverage), a chronological list of already-described video frames (each with its own deterministic OCR text, ocrText, ground truth, not a guess), and an audio analysis of the clip. You are also given baseline: this video's own sparse full-video averages (cutsPerMinute, freeze/black coverage, speech rate, and motion).",
  "Write each narrative to the uploader in the second person (you, your video), reviewing their own video. Whoever is heard speaking may be the uploader, a co-host, a guest, or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator, the host); frame it as the uploader's own video instead (say 'here you are still laying out the context', not 'he is still laying out the context').",
  "Identify the distinct, timestamped moments within the window that genuinely and non-obviously explain the retention change: a hard cut, a topic change in the transcript, a shift in pacing or energy, on-screen text or a graphic appearing/disappearing, a freeze or dead air, and so on. A single window can have more than one, but do not manufacture one per cut: most cuts and most frames are unremarkable.",
  "Judge editing and pacing as deviations from the given baseline, not in absolute terms: a static, low-cut, low-energy stretch only explains a drop when it is slower or flatter than this video's own norm, and a burst of cuts or rising energy only explains a gain when it is livelier than the norm. Where a metric drives an event, reference the deviation in the narrative (for example 'your cuts fall to about 2 per minute here versus roughly 11 across the video').",
  "For non-hook windows you are also given contrast: a target range covering the detected retention episode and the immediately preceding control range. It contains editing, deterministic audio, and deterministic visual-motion summaries for both ranges, target-minus-control deltas, and chunkIndex lists identifying which visual frames belong to each range. Motion is normalised 0..1 frame difference, so use it comparatively rather than assigning a universal good/bad threshold. Prefer this local comparison over a generic absolute judgment. Only attribute a change to editing, audio, speech rate, motion, or visuals when the target actually differs meaningfully from the control; unchanged evidence is evidence against that hypothesis. If the target has no sampled visual frame, audio coverage, or motion coverage, do not infer a change from missing data.",
  "You may also be given scriptExplanation: the transcript-only explanation the user has already been shown for this window. Your job is to add what the words alone cannot reveal. Only surface an event that ADDS a non-verbal cause (a cut, a freeze or dead air, an energy or pacing shift, a graphic appearing or disappearing) or that CONTRADICTS the script explanation. Never emit an event that merely restates scriptExplanation. When scriptExplanation is null, none has been generated yet, so surface the genuinely notable multimodal moments as usual.",
  "You may also be given channelHistory: a compact summary of the retention events previously synthesized across this uploader's other deeply analysed videos, covering how many videos it draws on, which event types recur in their hooks, drop-offs, and gains (with how many distinct videos each recurs in), and a few example narratives. Treat it as prior context about what habitually moves retention on this channel: when the local evidence supports an event that matches a recurring channel pattern, note the recurrence in the narrative (for example 'a pattern that shows up across your other videos as well') and let the convergence nudge confidence up slightly. Never surface an event on channel history alone, and never let history suppress a well-evidenced local event that breaks the pattern; the local evidence always decides whether an event exists. channelHistory is null when too few other videos have been deeply analysed to establish a trend.",
  "For each event, give: event_type (the best-fitting category), timestamp_seconds (must fall within the window's fromSeconds/toSeconds), a one- or two-sentence narrative tying the evidence to the retention change, primary_evidence (which evidence source most explains it; use 'combined' only when multiple sources genuinely converge on the same moment), and confidence (0..1: how strongly the supplied evidence supports both that this moment happened AND that it plausibly moved retention). Reserve confidence above 0.7 for moments where the evidence clearly converges, for example a hard cut plus an energy drop plus a matching retention step.",
  "Only surface events actually supported by the evidence given. Never invent frame content, transcript text, or audio characteristics that weren't provided. Prefer a few high-confidence, genuinely new events over many weak ones; if nothing clears a modest bar of being both well-supported and new, return an empty events array rather than padding.",
  'Never output an em dash character (U+2014) anywhere in your response; if you would use one, rewrite the phrase with a comma, colon, parentheses, or two separate sentences instead.',
].join(" ")

export const openAiRetentionWindowEventSynthesizer: RetentionWindowEventSynthesizer =
  {
    async synthesize(evidence) {
      const model = getEventSynthesisModel()
      const { text, usage } = await callOpenAiResponses({
        model,
        max_output_tokens: 2000,
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: EVENT_SYNTHESIS_INSTRUCTIONS }],
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
