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

import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// Mirrors the alignment's hook window: packaging is judged on what the
// opening communicates, not on retention behaviour.
const HOOK_WINDOW_SECONDS = 30

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
  model: string
  generatedAt: string
}

const MAX_TITLE_STYLES = 2
const MAX_TOPICS = 3

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
  },
} as const

function isEnumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

// What the model returns: the taxonomy fields with "none" standing in for a
// missing emotion, before the generation metadata is attached.
interface ModelTaxonomyOutput
  extends Omit<PackagingTaxonomy, "model" | "generatedAt" | "thumbnailEmotion"> {
  thumbnailEmotion: (typeof MODEL_EMOTIONS)[number]
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
    candidate.topics.every((topic) => typeof topic === "string")
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
      max_output_tokens: 1_000,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: [
                "You classify the packaging of a YouTube video — its title, its thumbnail image, and its spoken hook (the first ~30 seconds of transcript) — into a fixed taxonomy. Classify only from what you genuinely see and read; never invent elements that aren't there.",
                "titleStyles: the one or two styles the title leans on, dominant first. curiosity_gap withholds the payoff; how_to promises instruction; number_list leads with a count; question is phrased as one; negative_warning warns or leads with a mistake; result_claim states a concrete achieved result; challenge frames a constraint or dare; personal_story signals a first-person narrative; direct_label plainly names the content.",
                "thumbnailHasFace: whether a human face is clearly visible. thumbnailEmotion: the dominant facial expression, or \"none\" when there is no face. thumbnailTextWordCount: count the words of overlaid text readable on the thumbnail image itself (0 when it carries none).",
                "promiseType: the single promise the title and thumbnail together make to the viewer, choosing the closest fit.",
                "hookDelivery: whether the spoken hook picks up that promise — direct when the opening words immediately address it, delayed when it arrives later within the hook, absent when the hook never touches it (or there is no transcript).",
                "alignmentScore: 0 to 1, how tightly title, thumbnail and hook communicate one consistent promise (1.0 = all three say the same thing; 0.0 = they promise unrelated things).",
                "topics: 1 to 3 short lowercase content tags naming what the video is about (e.g. \"gear reviews\", \"video editing\", \"productivity\"). Prefer stable, reusable nouns a channel would repeat across uploads over one-off phrases.",
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
    model,
    generatedAt: new Date().toISOString(),
  }
}
