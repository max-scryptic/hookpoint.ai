// Structured, categorical read of ONE retention window's spoken transcript —
// the per-window companion to the whole-video script taxonomy
// (lib/script-taxonomy.ts). Where the script taxonomy reads the content and
// emotional texture of the entire script, this reads the same texture for the
// short span of a single window (its padded analysis range), so a hook, a
// drop-off, a gain or a hold can be described in the same closed vocabulary the
// script taxonomy uses: what is being said, how it feels, and how it is framed.
//
// It reuses the script taxonomy's own enums (dominant emotions, narrative
// voices, persuasion devices, engagement drivers) on purpose, so a window's
// read sits on the same coordinate system as the video-level script read and
// the two can be spoken about together. Every ordinal is scored on the window
// in isolation (anchored 0/5/10), never relative to any other window or video.
//
// Unlike the whole-video script taxonomy (a lazy load-or-generate off the
// detail page), this is part of the deep-analysis pipeline: it runs only for
// the bounded set of windows deep analysis selected (the same set that gets
// snapshots/audio), keyed off the transcript row's taxonomy_status the same way
// the media analysis is keyed off analysis_status. The orchestration here
// claims pending rows, generates, and records per-window + account-wide cost.

import type { SupabaseClient } from "@supabase/supabase-js"

import { runWithConcurrency } from "@/lib/concurrency"
import { recordLlmCallCost } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import { recordRetentionWindowCost } from "@/lib/retention-window-costs"
import { getRetentionWindowAiCallConcurrency } from "@/lib/retention-window-media-config"
import {
  claimRetentionWindowTranscriptsPendingTaxonomy,
  updateRetentionWindowTranscriptTaxonomy,
  type RetentionWindowTranscript,
} from "@/lib/retention-window-transcripts"
import { getRetentionWindows } from "@/lib/retention-windows"
import {
  DOMINANT_EMOTIONS,
  ENGAGEMENT_DRIVERS,
  NARRATIVE_VOICES,
  PERSUASION_DEVICES,
  type DominantEmotion,
  type EngagementDriver,
  type NarrativeVoice,
  type PersuasionDevice,
} from "@/lib/script-taxonomy"
import type { RetentionWindowKind } from "@/lib/retention-windows"

// Bumped whenever `detail` or any stored field's shape changes, so a row whose
// schemaVersion is below this can be re-pended and regenerated.
export const WINDOW_TRANSCRIPT_TAXONOMY_SCHEMA_VERSION = 1

// --- window-specific vocabulary ---------------------------------------------

// How the emotional energy of the spoken words moves across this one window —
// the short-span analog of the script taxonomy's whole-video arcShape.
export const EMOTIONAL_TRAJECTORIES = [
  "steady",
  "rising",
  "falling",
  "spike",
  "dip",
] as const
export type EmotionalTrajectory = (typeof EMOTIONAL_TRAJECTORIES)[number]

// The model reports "none" instead of null for the driver-less case; the stored
// value collapses "none" out of the persuasion list on the way in.
const MODEL_PERSUASION_DEVICES = [...PERSUASION_DEVICES, "none"] as const

// --- detail shapes -----------------------------------------------------------

export interface WindowTranscriptContentDetail {
  // 0 = very little actual information in this span; 10 = dense with ideas.
  substanceDensity: number
  // 0 = abstract and vague; 10 = concrete examples, numbers, names.
  concreteness: number
  // 0 = familiar, well-worn; 10 = fresh, contrarian or surprising.
  novelty: number
  // 0 = you cannot tell what is being said; 10 = crystal clear.
  clarity: number
}

export interface WindowTranscriptEmotionDetail {
  dominantEmotion: DominantEmotion
  // 0 = flat and low-key; 10 = high intensity / enthusiasm.
  energy: number
  // How the energy moves across the window (see EMOTIONAL_TRAJECTORIES).
  trajectory: EmotionalTrajectory
  // 0 = impersonal; 10 = candid, vulnerable first-person disclosure.
  vulnerability: number
}

export interface WindowTranscriptRhetoricDetail {
  narrativeVoice: NarrativeVoice
  // 0 = never addresses the viewer; 10 = constantly talks to "you".
  directAddress: number
  // The persuasion / engagement devices the words lean on within the window.
  persuasionDevices: PersuasionDevice[]
  // 0 = nothing at stake; 10 = high, vivid stakes or tension.
  stakes: number
  // Whether the span poses a direct question to the viewer.
  posesQuestion: boolean
}

export interface WindowTranscriptFlowDetail {
  // 0 = stays on one subject; 10 = the subject changes within the window.
  // A topic shift landing on a drop-off is exactly what this makes countable.
  topicShift: number
  // Whether the words OPEN a curiosity loop / unresolved question in the span.
  openLoopOpened: boolean
  // Whether the words RESOLVE / pay off a loop in the span.
  openLoopResolved: boolean
  // Whether the span makes an explicit call to action (subscribe, comment,
  // check the description, a sponsor/ad read...).
  hasCta: boolean
  // 0 = no filler; 10 = heavy padding, throat-clearing, repeated points.
  fillerLevel: number
}

export interface WindowTranscriptDetail {
  content: WindowTranscriptContentDetail
  emotion: WindowTranscriptEmotionDetail
  rhetoric: WindowTranscriptRhetoricDetail
  flow: WindowTranscriptFlowDetail
  // The single main reason a viewer would keep watching this span.
  primaryEngagementDriver: EngagementDriver
}

export interface WindowTranscriptTaxonomy {
  // One sentence naming what is actually being said in this window.
  momentSummary: string
  detail: WindowTranscriptDetail
  // Deterministic word count of the window transcript, computed locally.
  wordCount: number
  schemaVersion: number
  model: string
  generatedAt: string
}

// True when a stored taxonomy is at the current schema version; older rows
// return false so callers can re-pend them.
export function isCurrentWindowTranscriptTaxonomy(
  taxonomy: WindowTranscriptTaxonomy,
): boolean {
  return (taxonomy.schemaVersion ?? 0) >= WINDOW_TRANSCRIPT_TAXONOMY_SCHEMA_VERSION
}

const MAX_PERSUASION_DEVICES = 5

const ordinalSchema = { type: "integer", minimum: 0, maximum: 10 } as const

// --- schema ------------------------------------------------------------------

const DETAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content", "emotion", "rhetoric", "flow", "primaryEngagementDriver"],
  properties: {
    content: {
      type: "object",
      additionalProperties: false,
      required: ["substanceDensity", "concreteness", "novelty", "clarity"],
      properties: {
        substanceDensity: ordinalSchema,
        concreteness: ordinalSchema,
        novelty: ordinalSchema,
        clarity: ordinalSchema,
      },
    },
    emotion: {
      type: "object",
      additionalProperties: false,
      required: ["dominantEmotion", "energy", "trajectory", "vulnerability"],
      properties: {
        dominantEmotion: { type: "string", enum: [...DOMINANT_EMOTIONS] },
        energy: ordinalSchema,
        trajectory: { type: "string", enum: [...EMOTIONAL_TRAJECTORIES] },
        vulnerability: ordinalSchema,
      },
    },
    rhetoric: {
      type: "object",
      additionalProperties: false,
      required: [
        "narrativeVoice",
        "directAddress",
        "persuasionDevices",
        "stakes",
        "posesQuestion",
      ],
      properties: {
        narrativeVoice: { type: "string", enum: [...NARRATIVE_VOICES] },
        directAddress: ordinalSchema,
        persuasionDevices: {
          type: "array",
          items: { type: "string", enum: [...MODEL_PERSUASION_DEVICES] },
        },
        stakes: ordinalSchema,
        posesQuestion: { type: "boolean" },
      },
    },
    flow: {
      type: "object",
      additionalProperties: false,
      required: [
        "topicShift",
        "openLoopOpened",
        "openLoopResolved",
        "hasCta",
        "fillerLevel",
      ],
      properties: {
        topicShift: ordinalSchema,
        openLoopOpened: { type: "boolean" },
        openLoopResolved: { type: "boolean" },
        hasCta: { type: "boolean" },
        fillerLevel: ordinalSchema,
      },
    },
    primaryEngagementDriver: {
      type: "string",
      enum: [...ENGAGEMENT_DRIVERS],
    },
  },
} as const

const TAXONOMY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["momentSummary", "detail"],
  properties: {
    momentSummary: { type: "string" },
    detail: DETAIL_SCHEMA,
  },
} as const

// --- validation --------------------------------------------------------------

function isEnumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return (
    typeof value === "string" && (values as readonly string[]).includes(value)
  )
}

function isOrdinal(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 10
}

interface ModelDetailOutput {
  content: WindowTranscriptContentDetail
  emotion: WindowTranscriptEmotionDetail
  rhetoric: Omit<WindowTranscriptRhetoricDetail, "persuasionDevices"> & {
    persuasionDevices: (typeof MODEL_PERSUASION_DEVICES)[number][]
  }
  flow: WindowTranscriptFlowDetail
  primaryEngagementDriver: EngagementDriver
}

function isModelContentDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.substanceDensity) &&
    isOrdinal(t.concreteness) &&
    isOrdinal(t.novelty) &&
    isOrdinal(t.clarity)
  )
}

function isModelEmotionDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isEnumValue(DOMINANT_EMOTIONS, t.dominantEmotion) &&
    isOrdinal(t.energy) &&
    isEnumValue(EMOTIONAL_TRAJECTORIES, t.trajectory) &&
    isOrdinal(t.vulnerability)
  )
}

function isModelRhetoricDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isEnumValue(NARRATIVE_VOICES, t.narrativeVoice) &&
    isOrdinal(t.directAddress) &&
    Array.isArray(t.persuasionDevices) &&
    t.persuasionDevices.every((d) => isEnumValue(MODEL_PERSUASION_DEVICES, d)) &&
    isOrdinal(t.stakes) &&
    typeof t.posesQuestion === "boolean"
  )
}

function isModelFlowDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.topicShift) &&
    typeof t.openLoopOpened === "boolean" &&
    typeof t.openLoopResolved === "boolean" &&
    typeof t.hasCta === "boolean" &&
    isOrdinal(t.fillerLevel)
  )
}

function isModelDetailOutput(value: unknown): value is ModelDetailOutput {
  if (!value || typeof value !== "object") return false
  const d = value as Record<string, unknown>
  return (
    isModelContentDetail(d.content) &&
    isModelEmotionDetail(d.emotion) &&
    isModelRhetoricDetail(d.rhetoric) &&
    isModelFlowDetail(d.flow) &&
    isEnumValue(ENGAGEMENT_DRIVERS, d.primaryEngagementDriver)
  )
}

interface ModelTaxonomyOutput {
  momentSummary: string
  detail: ModelDetailOutput
}

export function isWindowTranscriptTaxonomyOutput(
  value: unknown,
): value is ModelTaxonomyOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.momentSummary === "string" &&
    isModelDetailOutput(candidate.detail)
  )
}

// --- normalisation -----------------------------------------------------------

function cleanPersuasionDevices(
  devices: (typeof MODEL_PERSUASION_DEVICES)[number][],
): PersuasionDevice[] {
  return [...new Set(devices)]
    .filter((device): device is PersuasionDevice => device !== "none")
    .slice(0, MAX_PERSUASION_DEVICES)
}

function toWindowTranscriptDetail(
  detail: ModelDetailOutput,
): WindowTranscriptDetail {
  return {
    content: detail.content,
    emotion: detail.emotion,
    rhetoric: {
      ...detail.rhetoric,
      persuasionDevices: cleanPersuasionDevices(detail.rhetoric.persuasionDevices),
    },
    flow: detail.flow,
    primaryEngagementDriver: detail.primaryEngagementDriver,
  }
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

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

const WINDOW_KIND_CONTEXT: Record<RetentionWindowKind, string> = {
  hook: "the opening hook, where viewers decide whether to keep watching",
  drop_off: "a stretch where audience retention fell",
  gain: "a stretch where audience retention rose (replays or returning viewers)",
  hold: "a long, flat stretch where retention held steady",
}

// --- generation --------------------------------------------------------------

// The cost of the LLM call, returned alongside the taxonomy so the orchestrator
// can persist per-window spend without the generator needing a DB handle.
export interface GenerateWindowTranscriptTaxonomyResult {
  taxonomy: WindowTranscriptTaxonomy
  cost: ReturnType<typeof responsesCallCost>
}

// Reads one window's transcript into the fixed taxonomy. Returns null when the
// window has no spoken words to read (an empty transcript). Callers own
// persistence, claiming and cost logging (both the per-window figure and the
// account-wide LLM call log), so this stays a pure generate-and-cost step.
export async function generateWindowTranscriptTaxonomy(params: {
  kind: RetentionWindowKind
  transcript: string
}): Promise<GenerateWindowTranscriptTaxonomyResult | null> {
  const transcript = params.transcript.trim()
  if (!transcript) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.OPENAI_SCRIPT_MODEL ?? "gpt-4.1-mini"

  const instructions = await resolvePrompt("transcript_taxonomy")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 1_500,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: instructions,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                windowContext: WINDOW_KIND_CONTEXT[params.kind],
                transcript,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "retention_window_transcript_taxonomy",
          strict: true,
          schema: TAXONOMY_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI window transcript taxonomy failed (${response.status}): ${detail.slice(
        0,
        500,
      )}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) {
    throw new Error("OpenAI returned no window transcript taxonomy text")
  }

  const parsed: unknown = JSON.parse(outputText)
  if (!isWindowTranscriptTaxonomyOutput(parsed)) {
    throw new Error("OpenAI returned an invalid window transcript taxonomy")
  }

  const cost = responsesCallCost(model, json.usage)

  return {
    taxonomy: {
      momentSummary: parsed.momentSummary.trim(),
      detail: toWindowTranscriptDetail(parsed.detail),
      wordCount: countWords(transcript),
      schemaVersion: WINDOW_TRANSCRIPT_TAXONOMY_SCHEMA_VERSION,
      model,
      generatedAt: new Date().toISOString(),
    },
    cost,
  }
}

// --- orchestration -----------------------------------------------------------

// Split out so tests can inject a fake generator instead of hitting OpenAI, the
// same way the media analyzer/synthesizer are injectable.
export interface WindowTranscriptTaxonomyGenerator {
  generate(params: {
    kind: RetentionWindowKind
    transcript: string
  }): Promise<GenerateWindowTranscriptTaxonomyResult | null>
}

export interface RetentionWindowTranscriptTaxonomyDeps {
  generator: WindowTranscriptTaxonomyGenerator
}

export function defaultRetentionWindowTranscriptTaxonomyDeps(): RetentionWindowTranscriptTaxonomyDeps {
  return { generator: { generate: generateWindowTranscriptTaxonomy } }
}

// Generates a transcript taxonomy for every window whose transcript row is
// pending taxonomy (only the deep-analysis-selected windows are ever marked
// pending — see saveRetentionWindowTranscripts). Best-effort per row: a bad
// OpenAI call fails just that window's taxonomy and the run continues, the same
// failure-isolation the media analysis and event synthesis already use.
//
// Rows are claimed (taxonomy_status pending -> processing) before any LLM call
// goes out, so a second trigger racing this one can't pay for the same window
// twice.
export async function analyzeRetentionWindowTranscriptTaxonomies(
  admin: SupabaseClient,
  userId: string,
  analysedVideoId: string,
  deps: RetentionWindowTranscriptTaxonomyDeps = defaultRetentionWindowTranscriptTaxonomyDeps(),
): Promise<void> {
  const pending = await claimRetentionWindowTranscriptsPendingTaxonomy(
    admin,
    userId,
    analysedVideoId,
  )
  if (pending.length === 0) return

  const windows = await getRetentionWindows(admin, userId, analysedVideoId)
  const kindByWindow = new Map(windows.map((w) => [w.id, w.kind]))

  await runWithConcurrency(
    pending,
    getRetentionWindowAiCallConcurrency(),
    async (row: RetentionWindowTranscript) => {
      try {
        const kind = kindByWindow.get(row.retentionWindowId) ?? "hold"
        const result = await deps.generator.generate({
          kind,
          transcript: row.transcript,
        })

        // An empty transcript yields no taxonomy — a real, settled outcome, not
        // a failure. Mark it 'skipped' so it neither blocks the pipeline nor is
        // retried forever.
        if (!result) {
          await updateRetentionWindowTranscriptTaxonomy(admin, userId, row.id, {
            status: "skipped",
          })
          return
        }

        await updateRetentionWindowTranscriptTaxonomy(admin, userId, row.id, {
          status: "ready",
          taxonomy: result.taxonomy,
          model: result.taxonomy.model,
        })
        await recordRetentionWindowCost(admin, {
          userId,
          analysedVideoId,
          retentionWindowId: row.retentionWindowId,
          step: "transcript_taxonomy",
          cost: result.cost,
        }).catch((error) =>
          console.error("Failed to record transcript taxonomy cost", error),
        )
        // Mirror into the account-wide LLM call log (best-effort; never throws).
        await recordLlmCallCost(
          "transcript_taxonomy",
          result.cost,
          { userId, analysedVideoId },
          admin,
        )
      } catch (error) {
        console.error("Failed to generate window transcript taxonomy", error)
        await updateRetentionWindowTranscriptTaxonomy(admin, userId, row.id, {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate transcript taxonomy",
        }).catch(() => {})
      }
    },
  )
}
