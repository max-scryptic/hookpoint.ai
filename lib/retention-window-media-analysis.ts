// Calls OpenAI's Responses API to describe the harvested visual/audio media
// for a retention window, once extraction has produced it. Structured JSON
// output (json_schema, strict) the same way lib/pacing-analysis.ts already
// analyses transcripts — this reuses the same OPENAI_API_KEY, just pointed at
// vision/audio-capable models instead of a text-only one.
//
// Snapshots are analysed one *window* at a time: every chunk harvested for
// that window goes into a single vision call, so the model can describe
// change across the window (a cut, a zoom, a new on-screen graphic) rather
// than judging isolated frames in a vacuum. Audio clips are already one row
// per window, so each gets its own call.
//
// Independent of extraction (lib/retention-window-media-extraction.ts): keyed
// off `analysis_status`, not `status`, so it only ever touches rows that have
// already finished extracting (`status = 'ready'`) but haven't been analysed
// yet, and can be re-run on its own without re-extracting anything.

import type { SupabaseClient } from "@supabase/supabase-js"

import { measureAudioClipStats } from "@/lib/media/video-extraction"
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
  getRetentionWindowMediaStorageProvider,
  getSnapshotAnalysisModel,
} from "@/lib/retention-window-media-config"
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import type { StorageProvider } from "@/lib/storage"

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

export interface SnapshotAnalysis {
  scene: SnapshotScene
  face_visible: boolean
  contains_text: boolean
  contains_code: boolean
  motion: "low" | "moderate" | "high"
  people_count: number
  camera_movement: CameraMovement
  on_screen_text: string | null
  notable_event: string | null
  description: string
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

export interface AudioAnalysis extends AudioAnalysisModelOutput {
  // Words per minute across the window's transcript (already stored in
  // retention_window_transcripts) — derived, not asked of the audio model,
  // since it's exact where a model's estimate would be a guess.
  speech_rate: number | null
  // ffmpeg volumedetect mean_volume in dB; null if measurement failed.
  average_volume: number | null
  // ffmpeg silencedetect coverage, 0-1; null if measurement failed.
  silence: number | null
}

// Split out from the fetch orchestration below so tests can inject a fake
// model call instead of hitting OpenAI, the same way
// RetentionWindowMediaExtractionDeps lets extraction tests inject a fake
// ffmpeg extractor.
export interface RetentionWindowMediaAnalyzer {
  // One call per window: every chunk's signed image URL in, one analysis per
  // chunkIndex out. Must return an entry for every chunkIndex passed in.
  analyzeSnapshots(
    images: { chunkIndex: number; imageUrl: string }[],
  ): Promise<Map<number, SnapshotAnalysis>>
  analyzeAudio(audio: {
    base64: string
    format: string
  }): Promise<AudioAnalysisModelOutput>
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
  const transcriptsByWindow =
    pendingAudio.length > 0
      ? new Map(
          (
            await getRetentionWindowTranscripts(admin, userId, analysedVideoId)
          ).map((transcript) => [transcript.retentionWindowId, transcript.transcript]),
        )
      : new Map<string, string>()

  for (const windowSnapshots of groupByWindow(pendingSnapshots).values()) {
    try {
      const images = await Promise.all(
        windowSnapshots.map(async (snapshot) => ({
          chunkIndex: snapshot.chunkIndex,
          imageUrl: await deps.mediaStorage.createSignedReadUrl(
            snapshot.storagePath as string,
            expiry,
          ),
        })),
      )
      const results = await deps.analyzer.analyzeSnapshots(images)

      await Promise.all(
        windowSnapshots.map((snapshot) => {
          const analysis = results.get(snapshot.chunkIndex)
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
  }

  const audioModel = getAudioAnalysisModel()
  for (const audio of pendingAudio) {
    try {
      const analysis = await analyzeOneAudioClip(
        audio,
        transcriptsByWindow.get(audio.retentionWindowId) ?? null,
        deps,
      )
      await updateRetentionWindowAudioAnalysis(admin, userId, audio.id, {
        status: "ready",
        analysis,
        model: audioModel,
      })
    } catch (error) {
      console.error("Failed to analyse retention window audio", error)
      await updateRetentionWindowAudioAnalysis(admin, userId, audio.id, {
        status: "failed",
        error:
          error instanceof Error ? error.message : "Failed to analyse audio",
      }).catch(() => {})
    }
  }
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

async function analyzeOneAudioClip(
  audio: RetentionWindowAudioClip,
  transcript: string | null,
  deps: RetentionWindowMediaAnalysisDeps,
): Promise<AudioAnalysis> {
  const url = await deps.mediaStorage.createSignedReadUrl(
    audio.storagePath as string,
    getAnalysisMediaReadUrlExpirySeconds(),
  )
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch audio clip for analysis (${response.status})`,
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())

  const [modelOutput, stats] = await Promise.all([
    deps.analyzer.analyzeAudio({
      base64: bytes.toString("base64"),
      // Matches buildRetentionAudioObjectPath's fixed "audio.aac" extraction
      // output. If OpenAI's audio input ever rejects aac directly, extraction
      // would need to emit wav/mp3 instead rather than transcoding here.
      format: "aac",
    }),
    // Loudness/silence are measured deterministically via ffmpeg, so a
    // measurement failure shouldn't fail the whole row — just leave those two
    // fields null and keep the model-derived ones.
    measureAudioClipStats(url, audio.toSeconds - audio.fromSeconds).catch(
      () => ({ averageVolumeDb: null, silenceRatio: null }),
    ),
  ])

  return {
    ...modelOutput,
    speech_rate: computeSpeechRate(transcript, audio.fromSeconds, audio.toSeconds),
    average_volume: stats.averageVolumeDb,
    silence: stats.silenceRatio,
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
          "on_screen_text",
          "notable_event",
          "description",
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
          on_screen_text: { type: ["string", "null"] },
          notable_event: { type: ["string", "null"] },
          description: { type: "string" },
        },
      },
    },
  },
} as const

const AUDIO_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "music",
    "music_description",
    "speakers",
    "tone",
    "energy",
    "notable_events",
  ],
  properties: {
    music: { type: "boolean" },
    music_description: { type: ["string", "null"] },
    speakers: { type: "integer", minimum: 0 },
    tone: { type: "string" },
    energy: { type: "string", enum: ["low", "moderate", "high"] },
    notable_events: { type: "array", items: { type: "string" } },
  },
} as const

const SNAPSHOT_ANALYSIS_INSTRUCTIONS = [
  "You describe frames from one window of a YouTube video, in chunkIndex order (0 is earliest). Most frames are placed in flanking pairs just before and just after a detected hard cut or transition, so consecutive chunks often straddle a real edit rather than an arbitrary moment; a window with no detected cuts instead gets evenly spaced frames across it.",
  "For each chunk, classify: scene (best-fitting category), whether a face is visible, whether on-screen text/captions/graphics are present, whether source code is visible, the amount of on-screen motion, how many distinct people are visible, and the camera's behaviour relative to the surrounding chunks.",
  "Also give: on_screen_text (verbatim legible text/captions/overlays, or null if none), notable_event (a single thing distinguishing this chunk from its neighbours — a cut, a zoom, a graphic appearing, a change of location — or null if nothing stands out), and a short free-text description of the composition and action.",
  "Base every judgment only on what's visible in that chunk's image. Do not infer audio, speech, or viewer reaction.",
  "Return exactly one entry per supplied chunkIndex.",
].join(" ")

const AUDIO_ANALYSIS_INSTRUCTIONS = [
  "You describe the non-verbal audio characteristics of one short clip from a YouTube video: delivery tone and energy, background music, distinct speaker count, and notable audible events.",
  "The spoken words are already transcribed elsewhere, and loudness/silence are measured separately — do not transcribe speech, restate what is said, or estimate volume or silence here.",
  "Set music/music_description based only on audible background music, not speech. Estimate speakers as the number of distinct voices heard, not named identities.",
  "notable_events lists distinct audible occurrences worth flagging (laughter, a sudden volume or pace change, applause, a sound effect, an abrupt silence) — return an empty array if there's nothing notable.",
].join(" ")

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

async function callOpenAiResponses(body: Record<string, unknown>): Promise<string> {
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
  }
  const text = extractOutputText(json)
  if (!text) throw new Error("OpenAI returned no analysis text")
  return text
}

export const openAiRetentionWindowMediaAnalyzer: RetentionWindowMediaAnalyzer = {
  async analyzeSnapshots(images) {
    const text = await callOpenAiResponses({
      model: getSnapshotAnalysisModel(),
      reasoning: { effort: "low" },
      max_output_tokens: Math.min(16_000, Math.max(1_000, images.length * 300)),
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: SNAPSHOT_ANALYSIS_INSTRUCTIONS }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({ chunkIndexes: images.map((i) => i.chunkIndex) }),
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

    return new Map(
      parsed.chunks.map(({ chunkIndex, ...analysis }) => [chunkIndex, analysis]),
    )
  },

  async analyzeAudio({ base64, format }) {
    const text = await callOpenAiResponses({
      model: getAudioAnalysisModel(),
      reasoning: { effort: "low" },
      max_output_tokens: 1500,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: AUDIO_ANALYSIS_INSTRUCTIONS }],
        },
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: base64, format } }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "retention_window_audio_analysis",
          strict: true,
          schema: AUDIO_ANALYSIS_SCHEMA,
        },
      },
    })

    return JSON.parse(text) as AudioAnalysisModelOutput
  },
}
