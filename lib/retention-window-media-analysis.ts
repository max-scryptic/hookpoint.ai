// Describes the harvested visual/audio media for a retention window, once
// extraction has produced it, reusing the same OPENAI_API_KEY as
// lib/pacing-analysis.ts. Snapshots go through the Responses API with
// structured JSON output (json_schema, strict). Audio goes through Chat
// Completions instead against an audio-capable model, since the Responses API
// has no audio-input content type and audio-capable chat models don't support
// json_schema — see callOpenAiChatCompletionsAudio below.
//
// Snapshots are analysed one *window* at a time: every chunk harvested for
// that window goes into a single vision call, so the model can describe
// change across the window (a cut, a zoom, a new on-screen graphic) rather
// than judging isolated frames in a vacuum. Audio clips are already one row
// per window, so each gets its own call.
//
// On-screen text is not asked of the vision model at all — it's already
// deterministic (retention_window_snapshots.ocr_text, extracted via
// lib/media/ocr.ts) and handed to the model as ground-truth context instead,
// the same don't-ask-a-model-to-guess-what-you-can-measure principle already
// applied to audio's loudness/silence below.
//
// Independent of extraction (lib/retention-window-media-extraction.ts): keyed
// off `analysis_status`, not `status`, so it only ever touches rows that have
// already finished extracting (`status = 'ready'`) but haven't been analysed
// yet, and can be re-run on its own without re-extracting anything.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getAnalysedVideoTranscriptById } from "@/lib/analysed-videos"
import { resolvePrompt } from "@/lib/prompts/resolve"
import { runWithConcurrency } from "@/lib/concurrency"
import {
  addLlmCallCost,
  chatCompletionsCallCost,
  responsesCallCost,
  type ChatCompletionsUsage,
  type LlmCallCost,
  type ResponsesUsage,
} from "@/lib/llm-cost"
import {
  measureAudioSignalBuckets,
  type AudioSignalBucket,
} from "@/lib/media/video-extraction"
import { recordLlmCallCost } from "@/lib/llm-calls"
import { recordRetentionWindowCost } from "@/lib/retention-window-costs"
import {
  claimRetentionWindowAudioPendingAnalysis,
  claimRetentionWindowSnapshotsPendingAnalysis,
  updateRetentionWindowAudioAnalysis,
  updateRetentionWindowSnapshotAnalysis,
  type RetentionWindowAudioClip,
  type RetentionWindowSnapshot,
} from "@/lib/retention-window-media"
import {
  getAnalysisMediaReadUrlExpirySeconds,
  getAudioAnalysisModel,
  getRetentionWindowAiCallConcurrency,
  getRetentionWindowMediaStorageProvider,
  getSnapshotAnalysisModel,
} from "@/lib/retention-window-media-config"
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import { getRetentionWindows, type PersistedRetentionWindow } from "@/lib/retention-windows"
import type { StorageProvider } from "@/lib/storage"
import {
  transcriptForSegment,
  type TranscriptCue,
} from "@/lib/youtube/youtube"

// Field names deliberately match the shape the product side already sketched
// out for these two schemas (scene/face_visible/... and
// speech_rate/average_volume/...) rather than the repo's usual camelCase, so
// the persisted JSON is a stable, directly-consumable contract on its own —
// not just an internal TS shape.

export type SnapshotScene =
  | "talking_head"
  | "screen_recording"
  | "b_roll"
  | "text_slide"
  | "gameplay"
  | "product_demo"
  | "animation"
  | "other"

export type CameraMovement = "static" | "pan" | "zoom" | "handheld" | "cut" | "unknown"

// How much of the frame the main subject occupies. "not_applicable" for frames
// with no clear subject (a full-screen graphic, a wide establishing shot with
// nothing central).
export type ShotScale = "close_up" | "medium" | "wide" | "not_applicable"

export type Brightness = "dark" | "medium" | "bright"

export interface SnapshotAnalysis {
  scene: SnapshotScene
  face_visible: boolean
  contains_text: boolean
  contains_code: boolean
  motion: "low" | "moderate" | "high"
  people_count: number
  camera_movement: CameraMovement
  notable_event: string | null
  description: string
  // The visual-packaging axes below mirror the thumbnail read
  // (lib/packaging-taxonomy.ts PackagingThumbnailDetail) so a window's frames
  // can be judged on the same terms as the video's thumbnail — a face's pull,
  // contrast/complexity, on-screen-text dominance — rather than the coarse
  // booleans above. Every ordinal is 0-10 scored on the frame in isolation.
  // Optional so reads of snapshot rows analysed before these fields existed
  // still typecheck (the same tolerance signal_timeline gets on the audio side);
  // the JSON schema requires them on every new analysis.
  shot_scale?: ShotScale
  // 0 = no face or a tiny one; 10 = a face dominating the frame. 0 when no face.
  face_prominence?: number
  // Whether a visible subject is looking into the lens.
  eye_contact?: boolean
  // 0 = neutral / no expression; 10 = an extreme expression. 0 when no face.
  expression_intensity?: number
  // 0 = flat and muddy; 10 = high-contrast, thumbstopping.
  color_contrast?: number
  // 0 = clean, single-subject; 10 = busy and crowded. A descriptor, not a score.
  visual_complexity?: number
  // 0 = no on-screen text, or tiny; 10 = large text dominating the frame.
  // Complements contains_text (present at all) with how much it dominates.
  text_prominence?: number
  brightness?: Brightness
}

// The subset a model call can actually judge by ear — loudness and silence
// are measured deterministically instead (see AudioAnalysis below).
interface AudioAnalysisModelOutput {
  music: boolean
  music_description: string | null
  speakers: number
  tone: string
  energy: "low" | "moderate" | "high"
  notable_events: string[]
}

export interface AudioAnalysis {
  music: boolean | null
  music_description: string | null
  speakers: number | null
  tone: string | null
  energy: "low" | "moderate" | "high" | null
  notable_events: string[]
  model_analysis_status?: "ready" | "skipped"
  // Words per minute across the window's transcript (already stored in
  // retention_window_transcripts) — derived, not asked of the audio model,
  // since it's exact where a model's estimate would be a guess.
  speech_rate: number | null
  // ffmpeg volumedetect mean_volume in dB; null if measurement failed.
  average_volume: number | null
  // ffmpeg silencedetect coverage, 0-1; null if measurement failed.
  silence: number | null
  // Deterministic acoustic measurements on the source video's absolute
  // timeline. Optional keeps reads of pre-feature JSON rows compatible.
  signal_timeline?: Array<{
    from_seconds: number
    to_seconds: number
    average_volume: number | null
    silence: number
  }>
}

export interface AudioEscalationSignals {
  averageVolumeDeltaDb: number | null
  silenceDelta: number | null
  speechRateDelta: number | null
}

export function shouldRunPaidAudioAnalysis(
  kind: PersistedRetentionWindow["kind"],
  signals: AudioEscalationSignals,
): boolean {
  if (kind === "hook" || kind === "gain") return true
  // No acoustic comparison means uncertainty, not permission to skip.
  if (
    signals.averageVolumeDeltaDb == null ||
    signals.silenceDelta == null
  ) {
    return true
  }
  return (
    Math.abs(signals.averageVolumeDeltaDb) >= 3 ||
    Math.abs(signals.silenceDelta) >= 0.1 ||
    (signals.speechRateDelta != null &&
      Math.abs(signals.speechRateDelta) >= 30)
  )
}

// Split out from the fetch orchestration below so tests can inject a fake
// model call instead of hitting OpenAI, the same way
// RetentionWindowMediaExtractionDeps lets extraction tests inject a fake
// ffmpeg extractor.
// Each analyzer method returns its structured result alongside the cost of the
// LLM call that produced it, so the orchestrator can persist per-window spend
// without the analyzer needing a DB handle. cost carries the model + token
// counts even when its dollar figure is $0 (an unpriced model or a response
// that omitted its usage block).
export interface AnalyzeSnapshotsResult {
  analyses: Map<number, SnapshotAnalysis>
  cost: LlmCallCost
}

export interface AnalyzeAudioResult {
  analysis: AudioAnalysisModelOutput
  cost: LlmCallCost
}

export interface RetentionWindowMediaAnalyzer {
  // One call per window: every chunk's signed image URL in (plus its
  // deterministic OCR text, given as ground truth rather than asked of the
  // model — see lib/media/ocr.ts), one analysis per chunkIndex out. Must
  // return an entry for every chunkIndex passed in.
  analyzeSnapshots(
    images: { chunkIndex: number; imageUrl: string; ocrText: string | null }[],
  ): Promise<AnalyzeSnapshotsResult>
  analyzeAudio(audio: {
    base64: string
    format: string
  }): Promise<AnalyzeAudioResult>
}

export interface RetentionWindowMediaAnalysisDeps {
  mediaStorage: StorageProvider
  analyzer: RetentionWindowMediaAnalyzer
}

export function defaultRetentionWindowMediaAnalysisDeps(): RetentionWindowMediaAnalysisDeps {
  return {
    mediaStorage: getRetentionWindowMediaStorageProvider(),
    analyzer: openAiRetentionWindowMediaAnalyzer,
  }
}

function groupByWindow(
  snapshots: RetentionWindowSnapshot[],
): Map<string, RetentionWindowSnapshot[]> {
  const byWindow = new Map<string, RetentionWindowSnapshot[]>()
  for (const snapshot of snapshots) {
    const group = byWindow.get(snapshot.retentionWindowId)
    if (group) group.push(snapshot)
    else byWindow.set(snapshot.retentionWindowId, [snapshot])
  }
  return byWindow
}

// Analyses every snapshot/audio row for a video that has finished extraction
// but not yet analysis. Best-effort per window/row — a bad OpenAI call fails
// just that window's snapshots (or that one audio row) and the run continues,
// the same failure-isolation extraction already uses.
//
// Rows are claimed (analysis_status flipped pending -> processing) before any
// LLM call goes out, not just read, so a second trigger racing this one (this
// function can be kicked off from several places for the same video — see
// lib/retention-window-media-trigger.ts) can't also pick up the same row and
// pay for the same analysis twice.
export async function analyzeRetentionWindowMedia(
  admin: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  deps: RetentionWindowMediaAnalysisDeps = defaultRetentionWindowMediaAnalysisDeps(),
): Promise<void> {
  const [pendingSnapshots, pendingAudio] = await Promise.all([
    claimRetentionWindowSnapshotsPendingAnalysis(admin, userId, analysedVideoId),
    claimRetentionWindowAudioPendingAnalysis(admin, userId, analysedVideoId),
  ])

  if (pendingSnapshots.length === 0 && pendingAudio.length === 0) return

  const snapshotModel = getSnapshotAnalysisModel()
  const expiry = getAnalysisMediaReadUrlExpirySeconds()
  const [windowTranscripts, videoTranscript, retentionWindows] =
    pendingAudio.length > 0
      ? await Promise.all([
          getRetentionWindowTranscripts(admin, userId, analysedVideoId),
          getAnalysedVideoTranscriptById(admin, userId, analysedVideoId).catch(
            () => [],
          ),
          getRetentionWindows(admin, userId, analysedVideoId),
        ])
      : [[], [], []]
  const transcriptsByWindow = new Map(
    windowTranscripts.map((item) => [item.retentionWindowId, item.transcript]),
  )
  const windowById = new Map(retentionWindows.map((window) => [window.id, window]))

  const concurrency = getRetentionWindowAiCallConcurrency()

  // Every window's vision call is fully independent (own rows, own storage
  // objects), the same property that already makes extraction safe to run
  // concurrently — running them one at a time here just adds wall-clock time
  // for no correctness benefit.
  await runWithConcurrency(
    Array.from(groupByWindow(pendingSnapshots).values()),
    concurrency,
    async (windowSnapshots) => {
      try {
        const images = await Promise.all(
          windowSnapshots.map(async (snapshot) => ({
            chunkIndex: snapshot.chunkIndex,
            imageUrl: await deps.mediaStorage.createSignedReadUrl(
              snapshot.storagePath as string,
              expiry,
            ),
            ocrText: snapshot.ocrText,
          })),
        )
        const results = await deps.analyzer.analyzeSnapshots(images)

        await Promise.all(
          windowSnapshots.map((snapshot) => {
            const analysis = results.analyses.get(snapshot.chunkIndex)
            if (!analysis) {
              throw new Error(
                `No analysis returned for chunk ${snapshot.chunkIndex}`,
              )
            }
            return updateRetentionWindowSnapshotAnalysis(admin, userId, snapshot.id, {
              status: "ready",
              analysis,
              model: snapshotModel,
            })
          }),
        )

        // One vision call covers the whole window, so its cost is recorded
        // once against the window, not per snapshot. Best-effort: never fail a
        // successful analysis just because the costing write did.
        await recordRetentionWindowCost(admin, {
          userId,
          analysedVideoId,
          retentionWindowId: windowSnapshots[0].retentionWindowId,
          step: "snapshot",
          cost: results.cost,
        }).catch((error) =>
          console.error("Failed to record snapshot analysis cost", error),
        )
        // Mirror into the account-wide LLM call log (best-effort; never throws).
        await recordLlmCallCost(
          "snapshot",
          results.cost,
          { userId, analysedVideoId },
          admin,
        )
      } catch (error) {
        console.error("Failed to analyse retention window snapshots", error)
        const message =
          error instanceof Error ? error.message : "Failed to analyse snapshots"
        await Promise.all(
          windowSnapshots.map((snapshot) =>
            updateRetentionWindowSnapshotAnalysis(admin, userId, snapshot.id, {
              status: "failed",
              error: message,
            }).catch(() => {}),
          ),
        )
      }
    },
  )

  const audioModel = getAudioAnalysisModel()
  await runWithConcurrency(pendingAudio, concurrency, async (audio) => {
    try {
      const { analysis, cost, usedPaidModel } = await analyzeOneAudioClip(
        audio,
        transcriptsByWindow.get(audio.retentionWindowId) ?? null,
        videoTranscript,
        windowById.get(audio.retentionWindowId) ?? null,
        deps,
      )
      await updateRetentionWindowAudioAnalysis(admin, userId, audio.id, {
        status: "ready",
        analysis,
        model: usedPaidModel ? audioModel : "deterministic-only",
      })
      if (cost) {
        await recordRetentionWindowCost(admin, {
          userId,
          analysedVideoId,
          retentionWindowId: audio.retentionWindowId,
          step: "audio",
          cost,
        }).catch((error) =>
          console.error("Failed to record audio analysis cost", error),
        )
        await recordLlmCallCost("audio", cost, { userId, analysedVideoId }, admin)
      }
    } catch (error) {
      console.error("Failed to analyse retention window audio", error)
      await updateRetentionWindowAudioAnalysis(admin, userId, audio.id, {
        status: "failed",
        error:
          error instanceof Error ? error.message : "Failed to analyse audio",
      }).catch(() => {})
    }
  })
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

// Words-per-minute across the window's own transcript span. Null when the
// window somehow has no transcript row yet (extraction and transcript
// clipping run independently, so this guards a timing edge case rather than
// the normal path).
export function computeSpeechRate(
  transcript: string | null,
  fromSeconds: number,
  toSeconds: number,
): number | null {
  if (transcript == null) return null
  const minutes = (toSeconds - fromSeconds) / 60
  if (minutes <= 0) return null
  return Math.round(countWords(transcript) / minutes)
}

function summarizeSignalRange(
  buckets: AudioSignalBucket[],
  fromSeconds: number,
  toSeconds: number,
): { averageVolumeDb: number | null; silence: number | null } {
  let covered = 0
  let silence = 0
  let volume = 0
  let volumeCovered = 0
  for (const bucket of buckets) {
    const overlap = Math.max(
      0,
      Math.min(bucket.toSeconds, toSeconds) -
        Math.max(bucket.fromSeconds, fromSeconds),
    )
    if (overlap <= 0) continue
    covered += overlap
    silence += bucket.silenceRatio * overlap
    if (bucket.averageVolumeDb != null) {
      volume += bucket.averageVolumeDb * overlap
      volumeCovered += overlap
    }
  }
  return {
    averageVolumeDb: volumeCovered > 0 ? volume / volumeCovered : null,
    silence: covered > 0 ? silence / covered : null,
  }
}

function audioEscalationSignals(
  window: PersistedRetentionWindow,
  buckets: AudioSignalBucket[],
  transcript: TranscriptCue[],
): AudioEscalationSignals {
  const targetFrom = window.fromSeconds
  const targetTo = window.toSeconds
  const desiredControl = Math.min(30, Math.max(10, targetTo - targetFrom))
  const controlFrom = Math.max(
    window.analysisFromSeconds ?? targetFrom,
    targetFrom - desiredControl,
  )
  const control = summarizeSignalRange(buckets, controlFrom, targetFrom)
  const target = summarizeSignalRange(buckets, targetFrom, targetTo)
  const controlSpeech = computeSpeechRate(
    transcriptForSegment(transcript, controlFrom, targetFrom),
    controlFrom,
    targetFrom,
  )
  const targetSpeech = computeSpeechRate(
    transcriptForSegment(transcript, targetFrom, targetTo),
    targetFrom,
    targetTo,
  )
  const subtract = (a: number | null, b: number | null) =>
    a != null && b != null ? a - b : null
  return {
    averageVolumeDeltaDb: subtract(
      target.averageVolumeDb,
      control.averageVolumeDb,
    ),
    silenceDelta: subtract(target.silence, control.silence),
    speechRateDelta: subtract(targetSpeech, controlSpeech),
  }
}

async function analyzeOneAudioClip(
  audio: RetentionWindowAudioClip,
  transcript: string | null,
  videoTranscript: TranscriptCue[],
  window: PersistedRetentionWindow | null,
  deps: RetentionWindowMediaAnalysisDeps,
): Promise<{
  analysis: AudioAnalysis
  cost: LlmCallCost | null
  usedPaidModel: boolean
}> {
  const url = await deps.mediaStorage.createSignedReadUrl(
    audio.storagePath as string,
    getAnalysisMediaReadUrlExpirySeconds(),
  )
  const signalBuckets = await measureAudioSignalBuckets(
    url,
    audio.toSeconds - audio.fromSeconds,
  ).catch(() => [])
  const absoluteBuckets = signalBuckets.map((bucket) => ({
    ...bucket,
    fromSeconds: audio.fromSeconds + bucket.fromSeconds,
    toSeconds: audio.fromSeconds + bucket.toSeconds,
  }))
  const signals = window
    ? audioEscalationSignals(window, absoluteBuckets, videoTranscript)
    : {
        averageVolumeDeltaDb: null,
        silenceDelta: null,
        speechRateDelta: null,
      }
  const usedPaidModel = window
    ? shouldRunPaidAudioAnalysis(window.kind, signals)
    : true
  let modelResult: AnalyzeAudioResult | null = null
  if (usedPaidModel) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch audio clip for analysis (${response.status})`,
      )
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    modelResult = await deps.analyzer.analyzeAudio({
      base64: bytes.toString("base64"),
      format: "mp3",
    })
  }

  const coveredSeconds = signalBuckets.reduce(
    (sum, bucket) => sum + (bucket.toSeconds - bucket.fromSeconds),
    0,
  )
  const silenceSeconds = signalBuckets.reduce(
    (sum, bucket) =>
      sum +
      bucket.silenceRatio * (bucket.toSeconds - bucket.fromSeconds),
    0,
  )
  const volumeBuckets = signalBuckets.filter(
    (bucket) => bucket.averageVolumeDb != null,
  )
  const volumeSeconds = volumeBuckets.reduce(
    (sum, bucket) => sum + (bucket.toSeconds - bucket.fromSeconds),
    0,
  )
  // Average linear amplitude, then return to dB. Arithmetic averaging dB
  // values would over-weight quiet buckets because dB is logarithmic.
  const averageAmplitude =
    volumeSeconds > 0
      ? volumeBuckets.reduce(
          (sum, bucket) =>
            sum +
            Math.pow(10, (bucket.averageVolumeDb as number) / 20) *
              (bucket.toSeconds - bucket.fromSeconds),
          0,
        ) / volumeSeconds
      : null

  return {
    analysis: {
      music: modelResult?.analysis.music ?? null,
      music_description: modelResult?.analysis.music_description ?? null,
      speakers: modelResult?.analysis.speakers ?? null,
      tone: modelResult?.analysis.tone ?? null,
      energy: modelResult?.analysis.energy ?? null,
      notable_events: modelResult?.analysis.notable_events ?? [],
      model_analysis_status: usedPaidModel ? "ready" : "skipped",
      speech_rate: computeSpeechRate(
        transcript,
        audio.fromSeconds,
        audio.toSeconds,
      ),
      average_volume:
        averageAmplitude != null && averageAmplitude > 0
          ? 20 * Math.log10(averageAmplitude)
          : null,
      silence: coveredSeconds > 0 ? silenceSeconds / coveredSeconds : null,
      signal_timeline: absoluteBuckets.map((bucket) => ({
        from_seconds: bucket.fromSeconds,
        to_seconds: bucket.toSeconds,
        average_volume: bucket.averageVolumeDb,
        silence: bucket.silenceRatio,
      })),
    },
    cost: modelResult?.cost ?? null,
    usedPaidModel,
  }
}

// --- OpenAI-backed default analyzer ---

const SNAPSHOT_SCENE_VALUES = [
  "talking_head",
  "screen_recording",
  "b_roll",
  "text_slide",
  "gameplay",
  "product_demo",
  "animation",
  "other",
] as const

const CAMERA_MOVEMENT_VALUES = [
  "static",
  "pan",
  "zoom",
  "handheld",
  "cut",
  "unknown",
] as const

const SHOT_SCALE_VALUES = [
  "close_up",
  "medium",
  "wide",
  "not_applicable",
] as const

const BRIGHTNESS_VALUES = ["dark", "medium", "bright"] as const

const snapshotOrdinalSchema = {
  type: "integer",
  minimum: 0,
  maximum: 10,
} as const

const SNAPSHOT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chunks"],
  properties: {
    chunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "chunkIndex",
          "scene",
          "face_visible",
          "contains_text",
          "contains_code",
          "motion",
          "people_count",
          "camera_movement",
          "notable_event",
          "description",
          "shot_scale",
          "face_prominence",
          "eye_contact",
          "expression_intensity",
          "color_contrast",
          "visual_complexity",
          "text_prominence",
          "brightness",
        ],
        properties: {
          chunkIndex: { type: "integer" },
          scene: { type: "string", enum: SNAPSHOT_SCENE_VALUES },
          face_visible: { type: "boolean" },
          contains_text: { type: "boolean" },
          contains_code: { type: "boolean" },
          motion: { type: "string", enum: ["low", "moderate", "high"] },
          people_count: { type: "integer", minimum: 0 },
          camera_movement: { type: "string", enum: CAMERA_MOVEMENT_VALUES },
          notable_event: { type: ["string", "null"] },
          description: { type: "string" },
          shot_scale: { type: "string", enum: SHOT_SCALE_VALUES },
          face_prominence: snapshotOrdinalSchema,
          eye_contact: { type: "boolean" },
          expression_intensity: snapshotOrdinalSchema,
          color_contrast: snapshotOrdinalSchema,
          visual_complexity: snapshotOrdinalSchema,
          text_prominence: snapshotOrdinalSchema,
          brightness: { type: "string", enum: BRIGHTNESS_VALUES },
        },
      },
    },
  },
} as const

// The prompt text for all four of these calls lives in
// lib/prompts/defaults/deep-analysis.ts and is resolved by key at send time, so
// an override saved in the admin Prompts page reaches the next call without a
// deploy (see lib/prompts/resolve.ts).

function extractOutputText(response: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}): string | null {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text
    }
  }
  return null
}

// Exported for reuse by lib/retention-window-event-synthesis.ts, which needs
// the same OpenAI Responses wrapper for its own (text-only) structured-output
// call rather than duplicating it. Returns the raw `usage` block alongside the
// text so the caller can cost the call (see lib/llm-cost.ts).
export async function callOpenAiResponses(
  body: Record<string, unknown>,
): Promise<{ text: string; usage: ResponsesUsage | null }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI media analysis failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const text = extractOutputText(json)
  if (!text) throw new Error("OpenAI returned no analysis text")
  return { text, usage: json.usage ?? null }
}

// Audio input isn't accepted by the Responses API at all (only
// input_text/input_image/input_file/etc. — see callOpenAiResponses above), so
// the audio clip goes through Chat Completions instead, against an
// audio-capable model. That family doesn't support response_format at all —
// not json_schema, and not even plain json_object (OpenAI rejects it with
// "response_format of type json_object is not supported with this model") —
// so no response_format is sent, and the caller (parseAudioAnalysis)
// re-checks the shape of whatever comes back instead of trusting a schema.
async function callOpenAiChatCompletionsAudio(
  body: Record<string, unknown>,
): Promise<{ text: string; usage: ChatCompletionsUsage | null }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI audio analysis failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: ChatCompletionsUsage
  }
  const text = json.choices?.[0]?.message?.content
  if (!text) throw new Error("OpenAI returned no analysis text")
  return { text, usage: json.usage ?? null }
}

// Pulls the first balanced {...} object out of a larger string, respecting
// string literals so a brace inside a quoted value doesn't end it early.
// Audio-capable chat models routinely wrap the requested JSON in a prose
// preamble ("Thank you for sharing these details... {json}") or a ```json
// fence despite being told not to, so the object is dug out of whatever comes
// back rather than requiring the whole response to be JSON — a failed audio
// row is terminal (the claim query never reclaims it), so salvaging a
// chatty-but-correct response is worth more than rejecting it. Returns null
// when there's no object to find at all (a purely prose reply).
function extractJsonObject(text: string): string | null {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}" && depth > 0) {
      depth--
      if (depth === 0 && start !== -1) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseAudioAnalysis(text: string): AudioAnalysisModelOutput {
  const json = extractJsonObject(text)
  if (json == null) {
    throw new Error(`OpenAI audio analysis returned non-JSON: ${text.slice(0, 500)}`)
  }

  let parsed: Partial<AudioAnalysisModelOutput>
  try {
    parsed = JSON.parse(json) as Partial<AudioAnalysisModelOutput>
  } catch {
    throw new Error(`OpenAI audio analysis returned non-JSON: ${text.slice(0, 500)}`)
  }

  if (
    typeof parsed.music !== "boolean" ||
    typeof parsed.speakers !== "number" ||
    typeof parsed.tone !== "string" ||
    (parsed.energy !== "low" && parsed.energy !== "moderate" && parsed.energy !== "high") ||
    !Array.isArray(parsed.notable_events)
  ) {
    throw new Error(
      `OpenAI audio analysis returned unexpected shape: ${text.slice(0, 500)}`,
    )
  }

  return {
    music: parsed.music,
    music_description: parsed.music_description ?? null,
    speakers: parsed.speakers,
    tone: parsed.tone,
    energy: parsed.energy,
    notable_events: parsed.notable_events,
  }
}

export const openAiRetentionWindowMediaAnalyzer: RetentionWindowMediaAnalyzer = {
  async analyzeSnapshots(images) {
    const model = getSnapshotAnalysisModel()
    const instructions = await resolvePrompt("snapshot")
    const { text, usage } = await callOpenAiResponses({
      model,
      reasoning: { effort: "low" },
      max_output_tokens: Math.min(16_000, Math.max(1_000, images.length * 450)),
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: instructions }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                chunks: images.map((image) => ({
                  chunkIndex: image.chunkIndex,
                  ocrText: image.ocrText,
                })),
              }),
            },
            ...images.map((image) => ({
              type: "input_image",
              image_url: image.imageUrl,
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "retention_window_snapshot_analysis",
          strict: true,
          schema: SNAPSHOT_ANALYSIS_SCHEMA,
        },
      },
    })

    const parsed = JSON.parse(text) as {
      chunks: Array<{ chunkIndex: number } & SnapshotAnalysis>
    }

    return {
      analyses: new Map(
        parsed.chunks.map(({ chunkIndex, ...analysis }) => [
          chunkIndex,
          analysis,
        ]),
      ),
      cost: responsesCallCost(model, usage),
    }
  },

  async analyzeAudio({ base64, format }) {
    const model = getAudioAnalysisModel()
    // Both turns are resolved up front: the retry below runs inside a catch, and
    // a prompt lookup failing there would mask the parse error that caused it.
    const [instructions, userPrompt, retryPrompt] = await Promise.all([
      resolvePrompt("audio"),
      resolvePrompt("audio_user_turn"),
      resolvePrompt("audio_retry_turn"),
    ])
    const request = (turnText: string) => ({
      model,
      modalities: ["text"],
      messages: [
        { role: "developer", content: instructions },
        {
          role: "user",
          content: [
            { type: "text", text: turnText },
            { type: "input_audio", input_audio: { data: base64, format } },
          ],
        },
      ],
    })

    const first = await callOpenAiChatCompletionsAudio(request(userPrompt))
    const firstCost = chatCompletionsCallCost(model, first.usage)
    try {
      return { analysis: parseAudioAnalysis(first.text), cost: firstCost }
    } catch {
      // The model answered the clip in prose instead of emitting JSON, and a
      // failed audio row is terminal (never reclaimed), so re-ask once with a
      // blunter instruction before giving up on this window. The first attempt
      // was still billed, so its cost folds into the retry's.
      const second = await callOpenAiChatCompletionsAudio(request(retryPrompt))
      return {
        analysis: parseAudioAnalysis(second.text),
        cost: addLlmCallCost(
          firstCost,
          chatCompletionsCallCost(model, second.usage),
        ),
      }
    }
  },
}
