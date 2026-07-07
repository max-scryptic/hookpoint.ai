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

import { runWithConcurrency } from "@/lib/concurrency"
import {
  getEventSynthesisModel,
  getRetentionWindowAiCallConcurrency,
} from "@/lib/retention-window-media-config"
import {
  callOpenAiResponses,
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
import {
  computeAverageSceneCueMetrics,
  computeSceneCueMetrics,
  getRetentionWindowSceneCueScanStatuses,
  getVideoSceneCues,
} from "@/lib/video-scene-cues"

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

// Split out so tests can inject a fake synthesizer instead of hitting
// OpenAI, the same way RetentionWindowMediaAnalyzer lets analysis tests do.
export interface RetentionWindowEventSynthesizer {
  synthesize(evidence: WindowEvidence): Promise<SynthesizedEvent[]>
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
  ])

  const windowById = new Map(windows.map((w) => [w.id, w]))
  const snapshotsByWindow = new Map<string, typeof snapshots>()
  for (const snapshot of snapshots) {
    const group = snapshotsByWindow.get(snapshot.retentionWindowId)
    if (group) group.push(snapshot)
    else snapshotsByWindow.set(snapshot.retentionWindowId, [snapshot])
  }
  const audioByWindow = new Map(audioClips.map((a) => [a.retentionWindowId, a]))
  const scanStatusByWindow = new Map(
    sceneCueScanStatuses.map((s) => [s.retentionWindowId, s.status]),
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
    cutsPerMinute: editingBaseline?.cutsPerMinute ?? null,
    freezeCoverage: editingBaseline?.freezeCoverage ?? null,
    blackCoverage: editingBaseline?.blackCoverage ?? null,
    speechRate: speechRateBaseline,
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
      const scanStatus = scanStatusByWindow.get(job.retentionWindowId)
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

        const metrics = computeSceneCueMetrics(
          cues,
          window.analysisFromSeconds,
          window.analysisToSeconds,
        )

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
        }

        const events = await deps.synthesizer.synthesize(evidence)

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
  "You are given every piece of already-analysed evidence for one window of a YouTube video where audience retention rose or fell: the window's retention delta, its transcript, deterministic editing metrics (cut count/rate, freeze/black-frame coverage), a chronological list of already-described video frames (each with its own deterministic OCR text, ocrText — ground truth, not a guess), and an audio analysis of the clip. You are also given baseline: this video's own averages (cutsPerMinute, freeze/black coverage, speech rate) across every analysed window.",
  "Write each narrative to the uploader in the second person (you, your video), reviewing their own video. Whoever is heard speaking may be the uploader, a co-host, a guest, or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator, the host); frame it as the uploader's own video instead (say 'here you are still laying out the context', not 'he is still laying out the context').",
  "Identify the distinct, timestamped moments within the window that genuinely and non-obviously explain the retention change — a hard cut, a topic change in the transcript, a shift in pacing or energy, on-screen text or a graphic appearing/disappearing, a freeze or dead air, and so on. A single window can have more than one, but do not manufacture one per cut: most cuts and most frames are unremarkable.",
  "Judge editing and pacing as deviations from the given baseline, not in absolute terms: a static, low-cut, low-energy stretch only explains a drop when it is slower or flatter than this video's own norm, and a burst of cuts or rising energy only explains a gain when it is livelier than the norm. Where a metric drives an event, reference the deviation in the narrative (for example 'your cuts fall to about 2 per minute here versus roughly 11 across the video').",
  "You may also be given scriptExplanation: the transcript-only explanation the user has already been shown for this window. Your job is to add what the words alone cannot reveal. Only surface an event that ADDS a non-verbal cause (a cut, a freeze or dead air, an energy or pacing shift, a graphic appearing or disappearing) or that CONTRADICTS the script explanation. Never emit an event that merely restates scriptExplanation. When scriptExplanation is null, none has been generated yet, so surface the genuinely notable multimodal moments as usual.",
  "For each event, give: event_type (the best-fitting category), timestamp_seconds (must fall within the window's fromSeconds/toSeconds), a one- or two-sentence narrative tying the evidence to the retention change, primary_evidence (which evidence source most explains it — use 'combined' only when multiple sources genuinely converge on the same moment), and confidence (0..1: how strongly the supplied evidence supports both that this moment happened AND that it plausibly moved retention). Reserve confidence above 0.7 for moments where the evidence clearly converges, for example a hard cut plus an energy drop plus a matching retention step.",
  "Only surface events actually supported by the evidence given — never invent frame content, transcript text, or audio characteristics that weren't provided. Prefer a few high-confidence, genuinely new events over many weak ones; if nothing clears a modest bar of being both well-supported and new, return an empty events array rather than padding.",
  'Never output an em dash character ("—") anywhere in your response; if you would use one, rewrite the phrase with a comma, colon, parentheses, or two separate sentences instead.',
].join(" ")

export const openAiRetentionWindowEventSynthesizer: RetentionWindowEventSynthesizer =
  {
    async synthesize(evidence) {
      const text = await callOpenAiResponses({
        model: getEventSynthesisModel(),
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

      return parsed.events.map((event) => ({
        eventType: event.event_type,
        timestampSeconds: event.timestamp_seconds,
        narrative: event.narrative,
        primaryEvidence: event.primary_evidence,
        confidence: Math.min(1, Math.max(0, event.confidence)),
      }))
    },
  }
