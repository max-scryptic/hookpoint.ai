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
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import { getRetentionWindows } from "@/lib/retention-windows"
import {
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
  editing: {
    cutCount: number
    cutsPerMinute: number | null
    freezeCoverage: number
    blackCoverage: number
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

  const [windows, snapshots, audioClips, sceneCueScanStatuses, cues, transcripts] =
    await Promise.all([
      getRetentionWindows(admin, userId, analysedVideoId),
      getRetentionWindowSnapshotsForVideo(admin, userId, analysedVideoId),
      getRetentionWindowAudioForVideo(admin, userId, analysedVideoId),
      getRetentionWindowSceneCueScanStatuses(admin, userId, analysedVideoId),
      getVideoSceneCues(admin, userId, analysedVideoId),
      getRetentionWindowTranscripts(admin, userId, analysedVideoId),
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
      const hasSnapshots = windowSnapshots.length > 0
      const snapshotsSettled = windowSnapshots.every((s) =>
        isSettled(s.analysisStatus),
      )
      const audioSettled = audio != null && isSettled(audio.analysisStatus)

      if (!scanSettled || !hasSnapshots || !snapshotsSettled || !audioSettled) {
        // The job was claimed before loading its evidence. Release it so the
        // next trigger can retry immediately when the final prerequisite
        // settles rather than waiting for the stale-processing lease.
        await updateRetentionWindowEventSynthesisStatus(admin, userId, job.id, {
          status: "pending",
        })
        return
      }

      try {
        const visual = windowSnapshots
          .filter((s) => s.analysisStatus === "ready" && s.analysis != null)
          .map((s) => ({
            chunkIndex: s.chunkIndex,
            timestampSeconds: s.timestampSeconds,
            ocrText: s.ocrText,
            analysis: s.analysis as SnapshotAnalysis,
          }))

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
          editing: {
            cutCount: metrics.cutCount,
            cutsPerMinute: metrics.cutsPerMinute,
            freezeCoverage: metrics.freezeCoverage,
            blackCoverage: metrics.blackCoverage,
          },
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
        ],
        properties: {
          event_type: { type: "string", enum: EVENT_TYPE_VALUES },
          timestamp_seconds: { type: "number" },
          narrative: { type: "string" },
          primary_evidence: { type: "string", enum: PRIMARY_EVIDENCE_VALUES },
        },
      },
    },
  },
} as const

const EVENT_SYNTHESIS_INSTRUCTIONS = [
  "You are given every piece of already-analysed evidence for one window of a YouTube video where audience retention rose or fell: the window's retention delta, its transcript, deterministic editing metrics (cut count/rate, freeze/black-frame coverage), a chronological list of already-described video frames (each with its own deterministic OCR text, ocrText — ground truth, not a guess), and an audio analysis of the clip.",
  "Identify the distinct, timestamped moments within the window that plausibly explain the retention change — a hard cut, a topic change in the transcript, a shift in pacing or energy, on-screen text or a graphic appearing/disappearing, a freeze or dead air, and so on. A single window commonly has more than one such moment.",
  "For each event, give: event_type (the best-fitting category), timestamp_seconds (must fall within the window's fromSeconds/toSeconds), a one- or two-sentence narrative tying the evidence to the retention change, and primary_evidence (which evidence source most explains it — use 'combined' only when multiple sources genuinely converge on the same moment).",
  "Only surface events actually supported by the evidence given — never invent frame content, transcript text, or audio characteristics that weren't provided. If nothing in the evidence plausibly explains the retention change, return an empty events array rather than guessing.",
].join(" ")

export const openAiRetentionWindowEventSynthesizer: RetentionWindowEventSynthesizer =
  {
    async synthesize(evidence) {
      const text = await callOpenAiResponses({
        model: getEventSynthesisModel(),
        reasoning: { effort: "low" },
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
        }>
      }

      return parsed.events.map((event) => ({
        eventType: event.event_type,
        timestampSeconds: event.timestamp_seconds,
        narrative: event.narrative,
        primaryEvidence: event.primary_evidence,
      }))
    },
  }
