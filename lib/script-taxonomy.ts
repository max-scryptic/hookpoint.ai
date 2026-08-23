// Structured, categorical read of a video's SCRIPT — the countable companion to
// the packaging taxonomy (lib/packaging-taxonomy.ts), but for the spoken
// content of the whole video rather than its title/thumbnail/hook. Where the
// pacing analysis (lib/pacing-analysis.ts) reads the script's *tempo* (how fast
// it moves, where it drags), this reads its *content and emotional texture*:
// what kind of content it is, how it is structured, what devices it uses and
// how it feels. A fixed vocabulary (formats, emotions, archetypes) plus a set
// of intrinsic 0-10 axes so scripts can be COMPARED across a library the same
// way packaging is: "your high-retention videos carry more levity and shift
// topic less often than your low-retention ones" is only computable over closed
// enums scored per video in isolation, never over prose.
//
// Same discipline as the packaging taxonomy: every ordinal is scored on THIS
// video alone (anchored 0/5/10), never relative to any other video, which is
// what lets two scripts be diffed into a story later with no model call at
// comparison time (see lib/script-comparison.ts). Input is the FULL transcript
// (like pacing, unlike packaging which only reads the 30s hook), so there is
// nothing to backfill from a source file; a stored taxonomy whose schemaVersion
// is below the current one is re-generated on its next detail-page visit (see
// lib/script-taxonomies.ts).

import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

// Bumped whenever `detail` or any stored field's shape changes. A stored
// taxonomy below this version is treated as stale and re-generated on its next
// detail-page visit (see lib/script-taxonomies.ts).
export const SCRIPT_TAXONOMY_SCHEMA_VERSION = 1

// --- vocabularies ------------------------------------------------------------

export const SCRIPT_FORMATS = [
  "story",
  "tutorial",
  "listicle",
  "essay_opinion",
  "review",
  "vlog",
  "interview",
  "explainer",
  "other",
] as const
export type ScriptFormat = (typeof SCRIPT_FORMATS)[number]

export const DOMINANT_EMOTIONS = [
  "excitement",
  "curiosity",
  "humor",
  "awe",
  "concern",
  "outrage",
  "warmth",
  "calm",
  "neutral",
] as const
export type DominantEmotion = (typeof DOMINANT_EMOTIONS)[number]

export const ARC_SHAPES = [
  "flat",
  "rising",
  "falling",
  "roller_coaster",
  "u_shaped",
] as const
export type ArcShape = (typeof ARC_SHAPES)[number]

export const HUMOR_STYLES = [
  "witty",
  "self_deprecating",
  "absurd",
  "sarcastic",
  "observational",
] as const
export type HumorStyle = (typeof HUMOR_STYLES)[number]

// The model reports "none" instead of null (strict structured outputs and
// nullable enums don't mix well); the stored taxonomy uses null.
const MODEL_HUMOR_STYLES = [...HUMOR_STYLES, "none"] as const

export const NARRATIVE_VOICES = [
  "first_person_story",
  "second_person_guide",
  "third_person_report",
  "impersonal",
] as const
export type NarrativeVoice = (typeof NARRATIVE_VOICES)[number]

export const PERSUASION_DEVICES = [
  "storytelling",
  "data_evidence",
  "authority",
  "social_proof",
  "analogy",
  "contrast",
  "urgency",
] as const
export type PersuasionDevice = (typeof PERSUASION_DEVICES)[number]
// The model may report "none"; it collapses to an empty list on the way in.
const MODEL_PERSUASION_DEVICES = [...PERSUASION_DEVICES, "none"] as const

export const SCRIPT_ARCHETYPES = [
  "educational_deep_dive",
  "entertainment_story",
  "hype",
  "calm_essay",
  "personal_vlog",
  "listicle_roundup",
  "opinion_take",
  "other",
] as const
export type ScriptArchetype = (typeof SCRIPT_ARCHETYPES)[number]

export const ENGAGEMENT_DRIVERS = [
  "information",
  "story",
  "humor",
  "personality",
  "emotion",
  "controversy",
  "utility",
] as const
export type EngagementDriver = (typeof ENGAGEMENT_DRIVERS)[number]

// --- detail shapes -----------------------------------------------------------

// One beat of the topic map: roughly where the script moves onto a new subject,
// and a short lowercase label for it. Ordered by time. The value is that it can
// be laid over the retention curve to see whether topic shifts line up with
// drop-offs.
export interface ScriptSegment {
  approxStartSeconds: number
  label: string
}

export interface ScriptStructureDetail {
  // The number of distinct topic beats the script moves through.
  segmentCount: number
  // 0 = meandering and scattered across many threads; 10 = tightly single
  // threaded. A descriptor, not a quality score: neither end is "better".
  topicCohesion: number
  // 0 = everything resolved as it goes; 10 = leans hard on unresolved
  // questions / cliffhangers to pull the viewer forward.
  openLoops: number
  // 0 = the value is front-loaded (delivered early); 10 = back-loaded (held to
  // the end). A descriptor of where the payoff sits, not a quality score.
  payoffPlacement: number
  // Whether the script makes an explicit call to action (subscribe, comment,
  // check the description, buy...).
  hasCta: boolean
}

export interface ScriptSubstanceDetail {
  // 0 = very little actual information per minute; 10 = dense with ideas. This
  // is about *ideas*, distinct from pacing's words-per-minute tempo.
  substanceDensity: number
  // 0 = abstract and vague; 10 = full of concrete examples, numbers and names.
  concreteness: number
  // 0 = familiar, well-worn takes; 10 = fresh, contrarian or surprising ideas.
  noveltyOfIdeas: number
  // 0 = teaches nothing; 10 = highly instructive.
  educationalValue: number
  // 0 = not entertaining; 10 = highly entertaining. Kept separate from
  // educationalValue so a video can score high on both.
  entertainmentValue: number
  // 0 = no filler; 10 = heavy padding, throat-clearing and repeated points.
  fillerLevel: number
}

export interface ScriptEmotionDetail {
  dominantEmotion: DominantEmotion
  // 0 = flat and low-key throughout; 10 = high intensity / enthusiasm.
  energy: number
  // 0 = monotone, one register the whole way; 10 = a wide dynamic range of
  // feeling across the script.
  emotionalRange: number
  arcShape: ArcShape
  // 0 = impersonal; 10 = candid, vulnerable first-person disclosure across the
  // whole script (the packaging taxonomy scores this for the hook alone).
  vulnerability: number
}

export interface ScriptHumorDetail {
  // 0 = no levity; 10 = comedy throughout. Scored, never tallied: transcript
  // alone misses delivery, timing and visual humour, so a precise joke count
  // would be false precision.
  humorDensity: number
  // The dominant style of humour; null when there is essentially none.
  humorStyle: HumorStyle | null
}

export interface ScriptRhetoricDetail {
  narrativeVoice: NarrativeVoice
  // 0 = never addresses the viewer; 10 = constantly talks to "you".
  directAddress: number
  // The persuasion / engagement devices the script leans on.
  persuasionDevices: PersuasionDevice[]
  // 0 = nothing at stake in the content; 10 = high, vivid stakes or tension.
  stakes: number
  // 0 = no target viewer could see themselves in it; 10 = a target viewer
  // clearly can.
  relatability: number
}

export interface ScriptDriversDetail {
  scriptArchetype: ScriptArchetype
  primaryEngagementDriver: EngagementDriver
}

export interface ScriptDetail {
  structure: ScriptStructureDetail
  substance: ScriptSubstanceDetail
  emotion: ScriptEmotionDetail
  humor: ScriptHumorDetail
  rhetoric: ScriptRhetoricDetail
  drivers: ScriptDriversDetail
}

export interface ScriptTaxonomy {
  // The dominant content format of the script.
  format: ScriptFormat
  // What the script is actually about, in one sentence.
  oneLineSummary: string
  // The topic map: where the script moves onto each new subject, ordered by
  // time. Empty when the script is too short or single-topic to segment.
  segments: ScriptSegment[]
  // 1-3 short lowercase content tags (e.g. "gear reviews", "productivity"),
  // consistent nouns for grouping videos by subject.
  topics: string[]
  // The enriched, comparison-grade read.
  detail: ScriptDetail
  // Deterministic word count of the transcript this was generated from, for
  // context alongside the model's reads. Computed locally, never by the model.
  wordCount: number
  // The `detail` shape version this row was generated against.
  schemaVersion: number
  model: string
  generatedAt: string
}

// True when a stored taxonomy carries a `detail` block at the current schema
// version. Older rows return false so callers can trigger a re-generation.
export function isCurrentScriptTaxonomy(taxonomy: ScriptTaxonomy): boolean {
  return (
    taxonomy.detail != null &&
    (taxonomy.schemaVersion ?? 0) >= SCRIPT_TAXONOMY_SCHEMA_VERSION
  )
}

const MAX_TOPICS = 3
const MAX_SEGMENTS = 12
const MAX_PERSUASION_DEVICES = 5

const ordinalSchema = { type: "integer", minimum: 0, maximum: 10 } as const

// --- schema ------------------------------------------------------------------

const DETAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["structure", "substance", "emotion", "humor", "rhetoric", "drivers"],
  properties: {
    structure: {
      type: "object",
      additionalProperties: false,
      required: [
        "segmentCount",
        "topicCohesion",
        "openLoops",
        "payoffPlacement",
        "hasCta",
      ],
      properties: {
        segmentCount: { type: "integer", minimum: 0 },
        topicCohesion: ordinalSchema,
        openLoops: ordinalSchema,
        payoffPlacement: ordinalSchema,
        hasCta: { type: "boolean" },
      },
    },
    substance: {
      type: "object",
      additionalProperties: false,
      required: [
        "substanceDensity",
        "concreteness",
        "noveltyOfIdeas",
        "educationalValue",
        "entertainmentValue",
        "fillerLevel",
      ],
      properties: {
        substanceDensity: ordinalSchema,
        concreteness: ordinalSchema,
        noveltyOfIdeas: ordinalSchema,
        educationalValue: ordinalSchema,
        entertainmentValue: ordinalSchema,
        fillerLevel: ordinalSchema,
      },
    },
    emotion: {
      type: "object",
      additionalProperties: false,
      required: [
        "dominantEmotion",
        "energy",
        "emotionalRange",
        "arcShape",
        "vulnerability",
      ],
      properties: {
        dominantEmotion: { type: "string", enum: [...DOMINANT_EMOTIONS] },
        energy: ordinalSchema,
        emotionalRange: ordinalSchema,
        arcShape: { type: "string", enum: [...ARC_SHAPES] },
        vulnerability: ordinalSchema,
      },
    },
    humor: {
      type: "object",
      additionalProperties: false,
      required: ["humorDensity", "humorStyle"],
      properties: {
        humorDensity: ordinalSchema,
        humorStyle: { type: "string", enum: [...MODEL_HUMOR_STYLES] },
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
        "relatability",
      ],
      properties: {
        narrativeVoice: { type: "string", enum: [...NARRATIVE_VOICES] },
        directAddress: ordinalSchema,
        persuasionDevices: {
          type: "array",
          items: { type: "string", enum: [...MODEL_PERSUASION_DEVICES] },
        },
        stakes: ordinalSchema,
        relatability: ordinalSchema,
      },
    },
    drivers: {
      type: "object",
      additionalProperties: false,
      required: ["scriptArchetype", "primaryEngagementDriver"],
      properties: {
        scriptArchetype: { type: "string", enum: [...SCRIPT_ARCHETYPES] },
        primaryEngagementDriver: {
          type: "string",
          enum: [...ENGAGEMENT_DRIVERS],
        },
      },
    },
  },
} as const

const TAXONOMY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["format", "oneLineSummary", "segments", "topics", "detail"],
  properties: {
    format: { type: "string", enum: [...SCRIPT_FORMATS] },
    oneLineSummary: { type: "string" },
    segments: {
      type: "array",
      maxItems: MAX_SEGMENTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["approxStartSeconds", "label"],
        properties: {
          approxStartSeconds: { type: "number", minimum: 0 },
          label: { type: "string" },
        },
      },
    },
    topics: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: MAX_TOPICS,
    },
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

// The model's detail block, before the humour/persuasion sentinels are cleaned.
interface ModelDetailOutput {
  structure: ScriptStructureDetail
  substance: ScriptSubstanceDetail
  emotion: ScriptEmotionDetail
  humor: {
    humorDensity: number
    humorStyle: (typeof MODEL_HUMOR_STYLES)[number]
  }
  rhetoric: Omit<ScriptRhetoricDetail, "persuasionDevices"> & {
    persuasionDevices: (typeof MODEL_PERSUASION_DEVICES)[number][]
  }
  drivers: ScriptDriversDetail
}

function isModelStructureDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    typeof t.segmentCount === "number" &&
    t.segmentCount >= 0 &&
    isOrdinal(t.topicCohesion) &&
    isOrdinal(t.openLoops) &&
    isOrdinal(t.payoffPlacement) &&
    typeof t.hasCta === "boolean"
  )
}

function isModelSubstanceDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.substanceDensity) &&
    isOrdinal(t.concreteness) &&
    isOrdinal(t.noveltyOfIdeas) &&
    isOrdinal(t.educationalValue) &&
    isOrdinal(t.entertainmentValue) &&
    isOrdinal(t.fillerLevel)
  )
}

function isModelEmotionDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isEnumValue(DOMINANT_EMOTIONS, t.dominantEmotion) &&
    isOrdinal(t.energy) &&
    isOrdinal(t.emotionalRange) &&
    isEnumValue(ARC_SHAPES, t.arcShape) &&
    isOrdinal(t.vulnerability)
  )
}

function isModelHumorDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.humorDensity) && isEnumValue(MODEL_HUMOR_STYLES, t.humorStyle)
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
    isOrdinal(t.relatability)
  )
}

function isModelDriversDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isEnumValue(SCRIPT_ARCHETYPES, t.scriptArchetype) &&
    isEnumValue(ENGAGEMENT_DRIVERS, t.primaryEngagementDriver)
  )
}

function isModelDetailOutput(value: unknown): value is ModelDetailOutput {
  if (!value || typeof value !== "object") return false
  const d = value as Record<string, unknown>
  return (
    isModelStructureDetail(d.structure) &&
    isModelSubstanceDetail(d.substance) &&
    isModelEmotionDetail(d.emotion) &&
    isModelHumorDetail(d.humor) &&
    isModelRhetoricDetail(d.rhetoric) &&
    isModelDriversDetail(d.drivers)
  )
}

interface ModelSegment {
  approxStartSeconds: number
  label: string
}

function isModelSegment(value: unknown): value is ModelSegment {
  if (!value || typeof value !== "object") return false
  const s = value as Record<string, unknown>
  return (
    typeof s.approxStartSeconds === "number" &&
    s.approxStartSeconds >= 0 &&
    typeof s.label === "string"
  )
}

// What the model returns: the taxonomy fields with "none" sentinels still in
// place, before the generation metadata and computed word count are attached.
interface ModelTaxonomyOutput {
  format: ScriptFormat
  oneLineSummary: string
  segments: ModelSegment[]
  topics: string[]
  detail: ModelDetailOutput
}

export function isScriptTaxonomyOutput(
  value: unknown,
): value is ModelTaxonomyOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    isEnumValue(SCRIPT_FORMATS, candidate.format) &&
    typeof candidate.oneLineSummary === "string" &&
    Array.isArray(candidate.segments) &&
    candidate.segments.every(isModelSegment) &&
    Array.isArray(candidate.topics) &&
    candidate.topics.length >= 1 &&
    candidate.topics.every((topic) => typeof topic === "string") &&
    isModelDetailOutput(candidate.detail)
  )
}

// --- normalisation -----------------------------------------------------------

// Drops the "none" sentinel and de-duplicates the reported persuasion devices.
function cleanPersuasionDevices(
  devices: (typeof MODEL_PERSUASION_DEVICES)[number][],
): PersuasionDevice[] {
  return [...new Set(devices)]
    .filter((device): device is PersuasionDevice => device !== "none")
    .slice(0, MAX_PERSUASION_DEVICES)
}

// Normalises the validated model detail into the stored shape (collapsing the
// humour sentinel to null, cleaning the persuasion-device sentinel).
function toScriptDetail(detail: ModelDetailOutput): ScriptDetail {
  return {
    structure: detail.structure,
    substance: detail.substance,
    emotion: detail.emotion,
    humor: {
      humorDensity: detail.humor.humorDensity,
      humorStyle:
        detail.humor.humorStyle === "none" ? null : detail.humor.humorStyle,
    },
    rhetoric: {
      ...detail.rhetoric,
      persuasionDevices: cleanPersuasionDevices(detail.rhetoric.persuasionDevices),
    },
    drivers: detail.drivers,
  }
}

function countWords(cues: TranscriptCue[]): number {
  return cues.reduce(
    (sum, cue) => sum + cue.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  )
}

// Renders the transcript as timestamped lines ("[m:ss] text") so the model can
// place segment boundaries in real time. Cues with no text are dropped.
function timestampedTranscript(cues: TranscriptCue[]): string {
  return cues
    .map((cue) => {
      const text = cue.text.trim()
      if (!text) return null
      const seconds = Math.max(0, Math.round(cue.startSeconds))
      const mins = Math.floor(seconds / 60)
      const secs = seconds % 60
      return `[${mins}:${String(secs).padStart(2, "0")}] ${text}`
    })
    .filter((line): line is string => line != null)
    .join("\n")
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

// --- generation --------------------------------------------------------------

// Classifies a video's script into the fixed taxonomy, or null when there is no
// transcript to read. One text call over the full transcript; callers own
// persistence and claiming.
export async function generateScriptTaxonomy(
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  transcript: TranscriptCue[],
  logContext?: LlmLogContext,
): Promise<ScriptTaxonomy | null> {
  const transcriptText = timestampedTranscript(transcript)
  if (!transcriptText) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.OPENAI_SCRIPT_MODEL ?? "gpt-4.1-mini"

  const instructions = await resolvePrompt("script_taxonomy")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 3_000,
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
                title: video.title,
                durationSeconds: video.durationSeconds,
                transcript: transcriptText,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "youtube_script_taxonomy",
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
      `OpenAI script taxonomy failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no script taxonomy text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isScriptTaxonomyOutput(parsed)) {
    throw new Error("OpenAI returned an invalid script taxonomy")
  }

  if (logContext) {
    await recordLlmCallCost(
      "script_taxonomy",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  return {
    format: parsed.format,
    oneLineSummary: parsed.oneLineSummary.trim(),
    segments: parsed.segments
      .map((segment) => ({
        approxStartSeconds: Math.max(0, Math.round(segment.approxStartSeconds)),
        label: segment.label.trim(),
      }))
      .filter((segment) => segment.label.length > 0)
      .sort((a, b) => a.approxStartSeconds - b.approxStartSeconds)
      .slice(0, MAX_SEGMENTS),
    topics: parsed.topics
      .map((topic) => topic.trim().toLowerCase())
      .filter((topic) => topic.length > 0)
      .slice(0, MAX_TOPICS),
    detail: toScriptDetail(parsed.detail),
    wordCount: countWords(transcript),
    schemaVersion: SCRIPT_TAXONOMY_SCHEMA_VERSION,
    model,
    generatedAt: new Date().toISOString(),
  }
}
