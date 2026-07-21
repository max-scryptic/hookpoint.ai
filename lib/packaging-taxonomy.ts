// Structured, categorical read of a video's packaging — the countable
// companion to lib/packaging-alignment.ts. The alignment is prose written for
// one video's detail page; the taxonomy is a fixed vocabulary (title style,
// thumbnail composition, promise type, hook delivery, topics) so packaging
// can be COMPARED across a library: "your high-reach videos open on a
// curiosity-gap title with a face in the thumbnail; your low-reach ones
// don't" is only computable over closed enums, never over prose.
//
// Same surface-level inputs as the alignment (title, thumbnail image, first
// ~30s of transcript), so old videos can be backfilled without their source
// file. Stored inside the packaging_alignment JSONB column rather than its
// own column — the two are generated and read together.
//
// The v1 taxonomy (the flat fields below) answers "what kind of packaging is
// this". The v2 `detail` block answers "why would it earn a click" on a set
// of intrinsic 0-10 axes (specificity, curiosity, emotional charge, stakes,
// alignment...) scored per video in isolation, never relative to any other
// video. Scoring each video absolutely is what lets two of them be diffed into
// a story later, with no model call at comparison time (see
// lib/packaging-comparison.ts). `detail` is optional so v1 rows keep working
// and heal to v2 through the same backfill path.

import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// Mirrors the alignment's hook window: packaging is judged on what the
// opening communicates, not on retention behaviour.
const HOOK_WINDOW_SECONDS = 30

// Bumped whenever `detail`'s shape changes. A stored taxonomy whose version is
// below this is treated as stale and re-generated on its next detail-page
// visit (see lib/packaging-alignments.ts).
export const PACKAGING_TAXONOMY_SCHEMA_VERSION = 3

export const TITLE_STYLES = [
  "curiosity_gap",
  "how_to",
  "number_list",
  "question",
  "negative_warning",
  "result_claim",
  "challenge",
  "personal_story",
  "direct_label",
] as const
export type TitleStyle = (typeof TITLE_STYLES)[number]

export const THUMBNAIL_EMOTIONS = [
  "excited",
  "shocked",
  "happy",
  "serious",
  "other",
] as const
export type ThumbnailEmotion = (typeof THUMBNAIL_EMOTIONS)[number]

// The model reports "none" instead of null (strict structured outputs and
// nullable enums don't mix well); the stored taxonomy uses null.
const MODEL_EMOTIONS = [...THUMBNAIL_EMOTIONS, "none"] as const

export const PROMISE_TYPES = [
  "transformation",
  "result_reveal",
  "how_to",
  "list",
  "story",
  "challenge",
  "opinion",
  "comparison",
  "other",
] as const
export type PromiseType = (typeof PROMISE_TYPES)[number]

export const HOOK_DELIVERIES = ["direct", "delayed", "absent"] as const
// Whether the spoken opening picks up the promise the title and thumbnail
// made: immediately, eventually within the hook window, or not at all.
export type HookDelivery = (typeof HOOK_DELIVERIES)[number]

// --- v2 detail vocabularies --------------------------------------------------

export const PERSONAL_FRAMINGS = [
  "first_person_confession",
  "second_person_command",
  "third_person_story",
  "impersonal",
] as const
export type PersonalFraming = (typeof PERSONAL_FRAMINGS)[number]

export const EMOTIONAL_VALENCES = [
  "fear",
  "desire",
  "shock",
  "anger",
  "curiosity",
  "neutral",
] as const
export type EmotionalValence = (typeof EMOTIONAL_VALENCES)[number]

export const POWER_DEVICES = [
  "number",
  "negativity",
  "all_caps",
  "taboo",
  "superlative",
  "question",
] as const
export type PowerDevice = (typeof POWER_DEVICES)[number]
// The model may report "none"; it collapses to an empty list on the way in.
const MODEL_POWER_DEVICES = [...POWER_DEVICES, "none"] as const

export const SCENE_TYPES = [
  "talking_head_indoor",
  "outdoor",
  "screen_or_charts",
  "graphic",
  "b_roll",
  "other",
] as const
export type SceneType = (typeof SCENE_TYPES)[number]

export const THUMBNAIL_MOODS = [
  "serious",
  "celebratory",
  "alarming",
  "casual",
  "mysterious",
  "other",
] as const
export type ThumbnailMood = (typeof THUMBNAIL_MOODS)[number]

export const OPENING_TYPES = [
  "cold_open_story",
  "bold_claim",
  "question",
  "context_setup",
  "meta_intro",
] as const
export type OpeningType = (typeof OPENING_TYPES)[number]

export const CLICK_DRIVERS = [
  "curiosity",
  "specificity",
  "emotion",
  "identity",
  "authority",
  "novelty",
  "controversy",
] as const
export type ClickDriver = (typeof CLICK_DRIVERS)[number]

export const PACKAGING_ARCHETYPES = [
  "personal_stakes_confession",
  "warning",
  "tutorial",
  "listicle",
  "hype",
  "story",
  "opinion",
  "other",
] as const
export type PackagingArchetype = (typeof PACKAGING_ARCHETYPES)[number]

// Per-surface enriched read. Every ordinal is an integer 0-10 scored on the
// video in isolation; every span is a short verbatim quote from the real
// title / thumbnail text / opening line (or "" when there is nothing to
// quote). Comparison is a pure diff over these (lib/packaging-comparison.ts).
export interface PackagingTitleDetail {
  // 0 = abstract and generic; 10 = names concrete numbers, people, stakes.
  specificity: number
  // 0 = states everything; 10 = withholds the payoff, opening a loop.
  curiosityGap: number
  // 0 = flat; 10 = intense emotional pull.
  emotionalCharge: number
  emotionalValence: EmotionalValence
  // 0 = nothing on the line; 10 = high, vivid stakes.
  stakes: number
  personalFraming: PersonalFraming
  // 0 = no viewer could see themselves in it; 10 = a target viewer clearly can.
  relatability: number
  // 0 = familiar, well-worn; 10 = contrarian or pattern-breaking.
  novelty: number
  // 0 = you cannot tell what you'll get; 10 = the payoff is unmistakable.
  clarity: number
  // Who the title is for, in its own terms; "" when it targets no one.
  targetIdentity: string
  // The specific tokens carrying the specificity: numbers, ages, names, nouns.
  concreteAnchors: string[]
  // Attention mechanics literally present in the title.
  powerDevices: PowerDevice[]
  characterLength: number
}

export interface PackagingThumbnailDetail {
  // 0 = no face or tiny; 10 = a face dominating the frame.
  faceProminence: number
  eyeContact: boolean
  // 0 = neutral / no expression; 10 = an extreme expression.
  emotionIntensity: number
  sceneType: SceneType
  mood: ThumbnailMood
  // 0 = flat and muddy; 10 = high-contrast, thumbstopping.
  colorContrast: number
  // 0 = clean and single-subject; 10 = busy and crowded. Neither end is
  // "better"; it is a descriptor, not a score.
  visualComplexity: number
  // The overlaid text read off the image itself; "" when it carries none.
  textVerbatim: string
  // What the image alone promises, before the title is read.
  impliedPromise: string
}

export interface PackagingHookDetail {
  openingType: OpeningType
  // 0 = never reaches the title's promise inside the window; 10 = delivers it
  // in the first breath.
  payoffSpeed: number
  // 0 = the opening ignores the title's promise; 10 = it restates it head-on.
  restatesPromise: number
  // 0 = no tension set up; 10 = vivid stakes established immediately.
  stakesEstablished: number
  // 0 = impersonal; 10 = candid first-person disclosure.
  personalDisclosure: number
  // 0 = vague setup; 10 = concrete, specific detail up front.
  specificity: number
  // "hey guys, welcome back, before we start..." style throat-clearing.
  genericFiller: boolean
  // The literal opening line; "" when the hook transcript is empty.
  firstSentence: string
}

export interface PackagingCrossDetail {
  // 0 = title and thumbnail promise unrelated things; 10 = they promise the
  // same one thing.
  titleThumbnailMatch: number
  // 0 = the opening never cashes the title's promise; 10 = it delivers it fully.
  hookDeliversPromise: number
  // The single promise all three surfaces make; "" when they do not agree.
  singleClearPromise: string
  // True when two surfaces actively fight each other (e.g. a warning title
  // over a celebratory thumbnail).
  contradiction: boolean
  // What contradicts, when `contradiction` is true; "" otherwise.
  contradictionNote: string
}

export interface PackagingDriversDetail {
  // Everything doing the pulling, dominant first.
  clickDrivers: ClickDriver[]
  primaryDriver: ClickDriver
  archetype: PackagingArchetype
  // 0 = evergreen / timeless topic that owes nothing to the moment; 10 = the
  // topic is riding a current trend, meme, news cycle or seasonal wave, so part
  // of the pull is timeliness rather than the packaging itself. A descriptor of
  // WHY a video may over- or under-index right now, not a quality judgement.
  trendRelevance: number
}

export interface PackagingDetail {
  title: PackagingTitleDetail
  thumbnail: PackagingThumbnailDetail
  hook: PackagingHookDetail
  cross: PackagingCrossDetail
  drivers: PackagingDriversDetail
}

export interface PackagingTaxonomy {
  // One or two styles the title leans on, dominant first.
  titleStyles: TitleStyle[]
  thumbnailHasFace: boolean
  // The dominant facial expression; null when no face is visible.
  thumbnailEmotion: ThumbnailEmotion | null
  // Words readable on the thumbnail image itself (overlaid text), 0 when the
  // thumbnail carries no text.
  thumbnailTextWordCount: number
  promiseType: PromiseType
  hookDelivery: HookDelivery
  // 0..1 — how tightly title, thumbnail and hook communicate one promise.
  alignmentScore: number
  // 1-3 short lowercase content tags (e.g. "gear reviews", "productivity"),
  // consistent nouns rather than full phrases, for grouping videos by topic.
  topics: string[]
  // The enriched, comparison-grade read. Absent on v1 rows generated before
  // it existed; those heal to the current version through the backfill path.
  detail?: PackagingDetail
  // The `detail` shape version this row was generated against. Absent = v1.
  schemaVersion?: number
  model: string
  generatedAt: string
}

// True when a stored taxonomy carries a `detail` block at the current schema
// version. Older rows return false so callers can trigger a re-generation.
export function isCurrentTaxonomy(taxonomy: PackagingTaxonomy): boolean {
  return (
    taxonomy.detail != null &&
    (taxonomy.schemaVersion ?? 1) >= PACKAGING_TAXONOMY_SCHEMA_VERSION
  )
}

const MAX_TITLE_STYLES = 2
const MAX_TOPICS = 3
const MAX_CONCRETE_ANCHORS = 6
const MAX_CLICK_DRIVERS = 4

const ordinalSchema = { type: "integer", minimum: 0, maximum: 10 } as const

const DETAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "thumbnail", "hook", "cross", "drivers"],
  properties: {
    title: {
      type: "object",
      additionalProperties: false,
      required: [
        "specificity",
        "curiosityGap",
        "emotionalCharge",
        "emotionalValence",
        "stakes",
        "personalFraming",
        "relatability",
        "novelty",
        "clarity",
        "targetIdentity",
        "concreteAnchors",
        "powerDevices",
        "characterLength",
      ],
      properties: {
        specificity: ordinalSchema,
        curiosityGap: ordinalSchema,
        emotionalCharge: ordinalSchema,
        emotionalValence: { type: "string", enum: [...EMOTIONAL_VALENCES] },
        stakes: ordinalSchema,
        personalFraming: { type: "string", enum: [...PERSONAL_FRAMINGS] },
        relatability: ordinalSchema,
        novelty: ordinalSchema,
        clarity: ordinalSchema,
        targetIdentity: { type: "string" },
        concreteAnchors: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_CONCRETE_ANCHORS,
        },
        powerDevices: {
          type: "array",
          items: { type: "string", enum: [...MODEL_POWER_DEVICES] },
        },
        characterLength: { type: "integer", minimum: 0 },
      },
    },
    thumbnail: {
      type: "object",
      additionalProperties: false,
      required: [
        "faceProminence",
        "eyeContact",
        "emotionIntensity",
        "sceneType",
        "mood",
        "colorContrast",
        "visualComplexity",
        "textVerbatim",
        "impliedPromise",
      ],
      properties: {
        faceProminence: ordinalSchema,
        eyeContact: { type: "boolean" },
        emotionIntensity: ordinalSchema,
        sceneType: { type: "string", enum: [...SCENE_TYPES] },
        mood: { type: "string", enum: [...THUMBNAIL_MOODS] },
        colorContrast: ordinalSchema,
        visualComplexity: ordinalSchema,
        textVerbatim: { type: "string" },
        impliedPromise: { type: "string" },
      },
    },
    hook: {
      type: "object",
      additionalProperties: false,
      required: [
        "openingType",
        "payoffSpeed",
        "restatesPromise",
        "stakesEstablished",
        "personalDisclosure",
        "specificity",
        "genericFiller",
        "firstSentence",
      ],
      properties: {
        openingType: { type: "string", enum: [...OPENING_TYPES] },
        payoffSpeed: ordinalSchema,
        restatesPromise: ordinalSchema,
        stakesEstablished: ordinalSchema,
        personalDisclosure: ordinalSchema,
        specificity: ordinalSchema,
        genericFiller: { type: "boolean" },
        firstSentence: { type: "string" },
      },
    },
    cross: {
      type: "object",
      additionalProperties: false,
      required: [
        "titleThumbnailMatch",
        "hookDeliversPromise",
        "singleClearPromise",
        "contradiction",
        "contradictionNote",
      ],
      properties: {
        titleThumbnailMatch: ordinalSchema,
        hookDeliversPromise: ordinalSchema,
        singleClearPromise: { type: "string" },
        contradiction: { type: "boolean" },
        contradictionNote: { type: "string" },
      },
    },
    drivers: {
      type: "object",
      additionalProperties: false,
      required: ["clickDrivers", "primaryDriver", "archetype", "trendRelevance"],
      properties: {
        clickDrivers: {
          type: "array",
          items: { type: "string", enum: [...CLICK_DRIVERS] },
          minItems: 1,
          maxItems: MAX_CLICK_DRIVERS,
        },
        primaryDriver: { type: "string", enum: [...CLICK_DRIVERS] },
        archetype: { type: "string", enum: [...PACKAGING_ARCHETYPES] },
        trendRelevance: ordinalSchema,
      },
    },
  },
} as const

const TAXONOMY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "titleStyles",
    "thumbnailHasFace",
    "thumbnailEmotion",
    "thumbnailTextWordCount",
    "promiseType",
    "hookDelivery",
    "alignmentScore",
    "topics",
    "detail",
  ],
  properties: {
    titleStyles: {
      type: "array",
      items: { type: "string", enum: [...TITLE_STYLES] },
      minItems: 1,
      maxItems: MAX_TITLE_STYLES,
    },
    thumbnailHasFace: { type: "boolean" },
    thumbnailEmotion: { type: "string", enum: [...MODEL_EMOTIONS] },
    thumbnailTextWordCount: { type: "integer", minimum: 0 },
    promiseType: { type: "string", enum: [...PROMISE_TYPES] },
    hookDelivery: { type: "string", enum: [...HOOK_DELIVERIES] },
    alignmentScore: { type: "number", minimum: 0, maximum: 1 },
    topics: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: MAX_TOPICS,
    },
    detail: DETAIL_SCHEMA,
  },
} as const

function isEnumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

function isOrdinal(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 10
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

// The model's detail block, before enum arrays are narrowed and cleaned. Its
// shape matches PackagingDetail except powerDevices may include "none".
interface ModelDetailOutput {
  title: Omit<PackagingTitleDetail, "powerDevices"> & {
    powerDevices: (typeof MODEL_POWER_DEVICES)[number][]
  }
  thumbnail: PackagingThumbnailDetail
  hook: PackagingHookDetail
  cross: PackagingCrossDetail
  drivers: PackagingDriversDetail
}

function isModelTitleDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.specificity) &&
    isOrdinal(t.curiosityGap) &&
    isOrdinal(t.emotionalCharge) &&
    isEnumValue(EMOTIONAL_VALENCES, t.emotionalValence) &&
    isOrdinal(t.stakes) &&
    isEnumValue(PERSONAL_FRAMINGS, t.personalFraming) &&
    isOrdinal(t.relatability) &&
    isOrdinal(t.novelty) &&
    isOrdinal(t.clarity) &&
    typeof t.targetIdentity === "string" &&
    isStringArray(t.concreteAnchors) &&
    Array.isArray(t.powerDevices) &&
    t.powerDevices.every((d) => isEnumValue(MODEL_POWER_DEVICES, d)) &&
    typeof t.characterLength === "number" &&
    t.characterLength >= 0
  )
}

function isModelThumbnailDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.faceProminence) &&
    typeof t.eyeContact === "boolean" &&
    isOrdinal(t.emotionIntensity) &&
    isEnumValue(SCENE_TYPES, t.sceneType) &&
    isEnumValue(THUMBNAIL_MOODS, t.mood) &&
    isOrdinal(t.colorContrast) &&
    isOrdinal(t.visualComplexity) &&
    typeof t.textVerbatim === "string" &&
    typeof t.impliedPromise === "string"
  )
}

function isModelHookDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isEnumValue(OPENING_TYPES, t.openingType) &&
    isOrdinal(t.payoffSpeed) &&
    isOrdinal(t.restatesPromise) &&
    isOrdinal(t.stakesEstablished) &&
    isOrdinal(t.personalDisclosure) &&
    isOrdinal(t.specificity) &&
    typeof t.genericFiller === "boolean" &&
    typeof t.firstSentence === "string"
  )
}

function isModelCrossDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    isOrdinal(t.titleThumbnailMatch) &&
    isOrdinal(t.hookDeliversPromise) &&
    typeof t.singleClearPromise === "string" &&
    typeof t.contradiction === "boolean" &&
    typeof t.contradictionNote === "string"
  )
}

function isModelDriversDetail(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  return (
    Array.isArray(t.clickDrivers) &&
    t.clickDrivers.length >= 1 &&
    t.clickDrivers.every((d) => isEnumValue(CLICK_DRIVERS, d)) &&
    isEnumValue(CLICK_DRIVERS, t.primaryDriver) &&
    isEnumValue(PACKAGING_ARCHETYPES, t.archetype) &&
    isOrdinal(t.trendRelevance)
  )
}

function isModelDetailOutput(value: unknown): value is ModelDetailOutput {
  if (!value || typeof value !== "object") return false
  const d = value as Record<string, unknown>
  return (
    isModelTitleDetail(d.title) &&
    isModelThumbnailDetail(d.thumbnail) &&
    isModelHookDetail(d.hook) &&
    isModelCrossDetail(d.cross) &&
    isModelDriversDetail(d.drivers)
  )
}

// What the model returns: the taxonomy fields with "none" standing in for a
// missing emotion, and the enriched detail block, before the generation
// metadata is attached.
interface ModelTaxonomyOutput
  extends Omit<
    PackagingTaxonomy,
    "model" | "generatedAt" | "thumbnailEmotion" | "detail" | "schemaVersion"
  > {
  thumbnailEmotion: (typeof MODEL_EMOTIONS)[number]
  detail: ModelDetailOutput
}

export function isPackagingTaxonomyOutput(
  value: unknown,
): value is ModelTaxonomyOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.titleStyles) &&
    candidate.titleStyles.length >= 1 &&
    candidate.titleStyles.every((style) => isEnumValue(TITLE_STYLES, style)) &&
    typeof candidate.thumbnailHasFace === "boolean" &&
    isEnumValue(MODEL_EMOTIONS, candidate.thumbnailEmotion) &&
    typeof candidate.thumbnailTextWordCount === "number" &&
    candidate.thumbnailTextWordCount >= 0 &&
    isEnumValue(PROMISE_TYPES, candidate.promiseType) &&
    isEnumValue(HOOK_DELIVERIES, candidate.hookDelivery) &&
    typeof candidate.alignmentScore === "number" &&
    candidate.alignmentScore >= 0 &&
    candidate.alignmentScore <= 1 &&
    Array.isArray(candidate.topics) &&
    candidate.topics.length >= 1 &&
    candidate.topics.every((topic) => typeof topic === "string") &&
    isModelDetailOutput(candidate.detail)
  )
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

// Drops the "none" sentinel and de-duplicates the reported power devices.
function cleanPowerDevices(
  devices: (typeof MODEL_POWER_DEVICES)[number][],
): PowerDevice[] {
  return [...new Set(devices)].filter(
    (device): device is PowerDevice => device !== "none",
  )
}

// Normalises the validated model detail into the stored shape (cleaning the
// power-device sentinel, trimming the anchor list).
function toPackagingDetail(detail: ModelDetailOutput): PackagingDetail {
  return {
    ...detail,
    title: {
      ...detail.title,
      concreteAnchors: detail.title.concreteAnchors
        .map((anchor) => anchor.trim())
        .filter((anchor) => anchor.length > 0)
        .slice(0, MAX_CONCRETE_ANCHORS),
      powerDevices: cleanPowerDevices(detail.title.powerDevices),
    },
  }
}

// Classifies a video's packaging into the fixed taxonomy, or null when there
// is no thumbnail to look at. One small vision call; callers own persistence
// and claiming.
export async function generatePackagingTaxonomy(
  video: Pick<VideoDetails, "title" | "thumbnailUrl">,
  transcript: TranscriptCue[],
): Promise<PackagingTaxonomy | null> {
  if (!video.thumbnailUrl) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.OPENAI_PACKAGING_MODEL ?? "gpt-4.1-mini"

  const hookText = transcriptForSegment(transcript, 0, HOOK_WINDOW_SECONDS)

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 2_000,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: [
                "You classify the packaging of a YouTube video, its title, its thumbnail image, and its spoken hook (the first ~30 seconds of transcript), into a fixed taxonomy. Classify only from what you genuinely see and read; never invent elements that aren't there.",
                "titleStyles: the one or two styles the title leans on, dominant first. curiosity_gap withholds the payoff; how_to promises instruction; number_list leads with a count; question is phrased as one; negative_warning warns or leads with a mistake; result_claim states a concrete achieved result; challenge frames a constraint or dare; personal_story signals a first-person narrative; direct_label plainly names the content.",
                "thumbnailHasFace: whether a human face is clearly visible. thumbnailEmotion: the dominant facial expression, or \"none\" when there is no face. thumbnailTextWordCount: count the words of overlaid text readable on the thumbnail image itself (0 when it carries none).",
                "promiseType: the single promise the title and thumbnail together make to the viewer, choosing the closest fit.",
                "hookDelivery: whether the spoken hook picks up that promise: direct when the opening words immediately address it, delayed when it arrives later within the hook, absent when the hook never touches it (or there is no transcript).",
                "alignmentScore: 0 to 1, how tightly title, thumbnail and hook communicate one consistent promise (1.0 = all three say the same thing; 0.0 = they promise unrelated things).",
                "topics: 1 to 3 short lowercase content tags naming what the video is about (e.g. \"gear reviews\", \"video editing\", \"productivity\"). Prefer stable, reusable nouns a channel would repeat across uploads over one-off phrases.",
                "Then fill the `detail` object. Score every 0-10 field on THIS video alone, never in comparison to any other video, and never think about how many views it got. Anchor the scale: 0 means the quality is absent, 5 means it is moderately present, 10 means it is as strong as this element could plausibly be. Be willing to use the full range and to give low scores; most videos are not 8s.",
                "detail.title: specificity (0 abstract and generic, 10 names concrete numbers, people or stakes); curiosityGap (0 tells everything, 10 withholds the payoff and opens a loop); emotionalCharge (0 flat, 10 intense pull) and emotionalValence (the dominant feeling: fear, desire, shock, anger, curiosity, or neutral); stakes (0 nothing on the line, 10 high vivid stakes); personalFraming (first_person_confession like 'I did X', second_person_command like 'STOP doing X', third_person_story, or impersonal); relatability (0 no viewer sees themselves, 10 a target viewer clearly does); novelty (0 familiar and well-worn, 10 contrarian or pattern-breaking); clarity (0 you cannot tell what you'll get, 10 the payoff is unmistakable); targetIdentity (who it is for in the title's own words, or \"\"); concreteAnchors (the literal specific tokens that carry the specificity: numbers, ages, names, dollar amounts, distinctive nouns; empty when none); powerDevices (mechanics literally present: number, negativity, all_caps, taboo, superlative, question; report [\"none\"] when there are none); characterLength (the title's length in characters).",
                "detail.thumbnail: faceProminence (0 no or tiny face, 10 a face filling the frame); eyeContact (is the subject looking at the viewer); emotionIntensity (0 neutral, 10 extreme expression); sceneType (talking_head_indoor, outdoor, screen_or_charts, graphic, b_roll, other); mood (serious, celebratory, alarming, casual, mysterious, other); colorContrast (0 flat and muddy, 10 high-contrast and thumbstopping); visualComplexity (0 clean single-subject, 10 busy and crowded; this is a descriptor, neither end is better); textVerbatim (the overlaid words read off the image, or \"\"); impliedPromise (what the image alone would lead a viewer to expect, before the title).",
                "detail.hook: openingType (cold_open_story, bold_claim, question, context_setup, meta_intro); payoffSpeed (0 the opening never reaches the title's promise inside the window, 10 it delivers it in the first breath); restatesPromise (0 the opening ignores the title's promise, 10 it restates it head-on); stakesEstablished (0 no tension set up, 10 vivid stakes immediately); personalDisclosure (0 impersonal, 10 candid first-person disclosure); specificity (0 vague setup, 10 concrete detail up front); genericFiller (true if it opens with throat-clearing like 'hey guys welcome back, before we start'); firstSentence (the literal opening line, or \"\" when there is no transcript).",
                "detail.cross: titleThumbnailMatch (0 title and thumbnail promise unrelated things, 10 they promise the same one thing); hookDeliversPromise (0 the opening never cashes the title's promise, 10 it delivers it fully); singleClearPromise (the one promise all three surfaces make, or \"\" when they do not agree); contradiction (true when two surfaces actively fight, e.g. a warning title over a celebratory thumbnail) and contradictionNote (what contradicts, or \"\").",
                "detail.drivers: clickDrivers (1 to 4 of curiosity, specificity, emotion, identity, authority, novelty, controversy that are doing the pulling, dominant first); primaryDriver (the single dominant one); archetype (personal_stakes_confession, warning, tutorial, listicle, hype, story, opinion, other); trendRelevance (0 the topic is evergreen and timeless, owing nothing to the moment; 10 the topic is clearly riding a current trend, meme, news cycle or seasonal wave, so some of the pull is timeliness rather than the packaging; judge only the topic's tie to a current wave, not how good the video is, and when unsure lean lower).",
                "If the hook transcript is empty, score the hook and cross fields from the title and thumbnail alone rather than inventing what was said.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({ title: video.title, hookTranscript: hookText }),
            },
            {
              type: "input_image",
              image_url: video.thumbnailUrl,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "youtube_packaging_taxonomy",
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
      `OpenAI packaging taxonomy failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no packaging taxonomy text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isPackagingTaxonomyOutput(parsed)) {
    throw new Error("OpenAI returned an invalid packaging taxonomy")
  }

  return {
    ...parsed,
    titleStyles: parsed.titleStyles.slice(0, MAX_TITLE_STYLES),
    thumbnailEmotion:
      parsed.thumbnailHasFace && parsed.thumbnailEmotion !== "none"
        ? parsed.thumbnailEmotion
        : null,
    topics: parsed.topics
      .map((topic) => topic.trim().toLowerCase())
      .filter((topic) => topic.length > 0)
      .slice(0, MAX_TOPICS),
    detail: toPackagingDetail(parsed.detail),
    schemaVersion: PACKAGING_TAXONOMY_SCHEMA_VERSION,
    model,
    generatedAt: new Date().toISOString(),
  }
}
