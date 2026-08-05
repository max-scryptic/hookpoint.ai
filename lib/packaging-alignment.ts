// LLM read of a video's "packaging" — its title, thumbnail and opening hook —
// and how well the three align. This is a surface-level feature: the thumbnail
// is fetched as an image URL from the Data API, the title is metadata, and the
// hook is the first ~30 seconds of the caption transcript, so none of it needs
// the uploaded source file. A vision-capable OpenAI model looks at the actual
// thumbnail image alongside the title and hook text and returns a short
// alignment summary plus the top strengths and improvements. The read stays
// strictly about packaging alignment (do the three communicate the same
// promise); retention, pacing and watch-through belong to the separate
// retention analysis, so the hook is judged only on what it communicates here.

import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import { TIP_VOICE_PROMPT } from "@/lib/tip-voice"
import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// The opening stretch treated as "the hook" for packaging-promise delivery.
const HOOK_WINDOW_SECONDS = 30

// Per-component feedback for one packaging element (title, thumbnail or hook),
// so the UI can surface each component on its own tab.
export interface PackagingComponentFeedback {
  // A short (3-6 word) characterisation of the component, e.g. "Direct
  // promise, strong emphasis". Used as the tab's subtitle.
  summary: string
  // The strongest point about this component, when there is one.
  whatWorked: string[]
  // The most useful improvement for this component, when there is one.
  whatCouldBeBetter: string[]
}

export type PackagingComponentKey = "title" | "thumbnail" | "hook"

export interface PackagingComponents {
  title: PackagingComponentFeedback
  thumbnail: PackagingComponentFeedback
  hook: PackagingComponentFeedback
}

export interface PackagingAlignment {
  // The alignment summary: one or two sentences giving an overview of how the
  // packaging holds together, briefly commenting on each component (title,
  // thumbnail, hook).
  overall: string
  // Per-component breakdown of what worked and what could be improved. Newly
  // generated alignments always include this.
  components?: PackagingComponents
  // Legacy flat fields kept for alignments generated before the per-component
  // breakdown existed; the UI falls back to these when `components` is absent.
  whatWorked?: string[]
  whatCouldBeBetter?: string[]
  // The categorical read of the same packaging (lib/packaging-taxonomy.ts),
  // generated alongside new alignments and backfilled onto older ones the
  // next time their detail page is opened. Absent until then.
  taxonomy?: PackagingTaxonomy
  model: string
  generatedAt: string
}

interface ModelComponentOutput {
  summary: string
  whatWorked: string[]
  whatCouldBeBetter: string[]
}

interface ModelOutput {
  overall: string
  title: ModelComponentOutput
  thumbnail: ModelComponentOutput
  hook: ModelComponentOutput
}

const IMPROVEMENT_PRIORITY = [
  /\bhook\b|\bopening\b|\bintro(?:duction)?\b|\bfirst\s+\d+\s+seconds?\b/i,
  /\btitle\b/i,
  /\bthumbnail\b/i,
] as const

// Keep packaging advice in the product's action order. The stable fallback
// preserves the model's order for advice that does not name one component.
export function prioritizePackagingImprovements(points: string[]): string[] {
  return points
    .map((point, index) => ({
      point,
      index,
      priority: IMPROVEMENT_PRIORITY.findIndex((pattern) => pattern.test(point)),
    }))
    .sort(
      (a, b) =>
        (a.priority === -1 ? IMPROVEMENT_PRIORITY.length : a.priority) -
          (b.priority === -1 ? IMPROVEMENT_PRIORITY.length : b.priority) ||
        a.index - b.index,
    )
    .map(({ point }) => point)
}

const COMPONENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "whatWorked", "whatCouldBeBetter"],
  properties: {
    summary: { type: "string" },
    whatWorked: {
      type: "array",
      items: { type: "string" },
      maxItems: 1,
    },
    whatCouldBeBetter: {
      type: "array",
      items: { type: "string" },
      maxItems: 1,
    },
  },
} as const

const PACKAGING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall", "title", "thumbnail", "hook"],
  properties: {
    overall: { type: "string" },
    title: COMPONENT_SCHEMA,
    thumbnail: COMPONENT_SCHEMA,
    hook: COMPONENT_SCHEMA,
  },
} as const

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

function isModelComponentOutput(value: unknown): value is ModelComponentOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelComponentOutput>
  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.whatWorked) &&
    Array.isArray(candidate.whatCouldBeBetter)
  )
}

function isModelOutput(value: unknown): value is ModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelOutput>
  return (
    typeof candidate.overall === "string" &&
    isModelComponentOutput(candidate.title) &&
    isModelComponentOutput(candidate.thumbnail) &&
    isModelComponentOutput(candidate.hook)
  )
}

function toComponentFeedback(
  output: ModelComponentOutput,
): PackagingComponentFeedback {
  return {
    summary: output.summary,
    whatWorked: output.whatWorked.slice(0, 1),
    whatCouldBeBetter: output.whatCouldBeBetter.slice(0, 1),
  }
}

// Generates the packaging alignment, or null when there's no thumbnail to look
// at (the feature is fundamentally about the thumbnail, so without the image
// there's nothing distinctive to add over the pacing/attribution passes).
export async function generatePackagingAlignment(
  video: Pick<VideoDetails, "title" | "description" | "thumbnailUrl">,
  transcript: TranscriptCue[],
  logContext?: LlmLogContext,
): Promise<PackagingAlignment | null> {
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
      max_output_tokens: 4_000,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: [
                "You review the packaging of a YouTube video: its title, its thumbnail image, and its spoken hook (the first ~30 seconds of transcript). Your only concern is packaging alignment: whether the title, thumbnail and hook are all communicating and promising the same thing, so a viewer takes away one clear, consistent message across the three. This is not a retention review: never comment on pacing, watch-through, how long viewers stay, or how well the hook holds attention over time, because that is covered separately in the retention analysis. You are shown the actual thumbnail image; ground everything in what you genuinely see, read and hear, never in guesses about elements that aren't there.",
                "Write to the uploader in the second person (you, your video, your hook, your title, your thumbnail), reviewing their own packaging. Whoever is heard speaking in the hook may be the uploader, a co-host, a guest, or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator, the host); frame it as the uploader's own hook instead (say 'your hook is still laying out the context', not 'he is still laying out the context').",
                "overall: write a one-to-two sentence alignment summary that judges how well the three components communicate the same message and briefly notes what each one (title, thumbnail, hook) contributes to that shared promise. For example: 'Your packaging is cohesive but low-specificity: the title signals a casual comeback, the thumbnail reinforces that same personal \"I'm back\" vibe, and your hook opens on the exact same message, so all three line up on what they promise even if none of them is especially specific about it.'",
                "Then break the feedback down per component, returning a separate object for title, thumbnail and hook. For each component: summary is a short 3-to-6 word characterisation of that component (for example the title as 'Direct promise, strong emphasis'); whatWorked contains exactly one concise, specific strength, framed as how well that component fits and reinforces the shared message of the other two; whatCouldBeBetter contains exactly one concrete, actionable improvement to that component, drawn from what this packaging showed but written for the video the uploader makes next, so it reads as a rule to apply to a title, thumbnail or hook that does not exist yet rather than as a fix to the one you were given. Keep every point about its own component only, ground summary and whatWorked in the real title/thumbnail/hook, and never give generic advice. For the hook specifically, judge only what it communicates and promises relative to the title and thumbnail; never comment on its retention, pacing, or ability to hold attention. Use an empty list only when there genuinely is no useful point to make, and never return more than one item in either list.",
                // whatCouldBeBetter is the one field here that reaches the page
                // as a "Try:" tip, so it is written under the site-wide tip
                // voice: advice for the next video, never a note on this one.
                // overall, summary and whatWorked are the opposite, and stay
                // descriptions of the packaging actually supplied.
                `Exactly one of these fields is advice: whatCouldBeBetter. It is shown to the uploader behind a "Try:" label as a tip, so it is written under the rules that follow, which apply to it and to nothing else here. ${TIP_VOICE_PROMPT} Your overall, summary and whatWorked fields are the opposite: those describe the title, thumbnail and hook you were actually given, so they refer to them freely.`,
                "If the hook transcript is empty, work from the title and thumbnail alone rather than inventing what was said.",
                'Never output an em dash character (U+2014) anywhere in your response; if you would use one, rewrite the phrase with a comma, colon, parentheses, or two separate sentences instead.',
              ].join(" "),
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
                descriptionExcerpt: (video.description ?? "").slice(0, 500),
                hookTranscript: hookText,
              }),
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
          name: "youtube_packaging_alignment",
          strict: true,
          schema: PACKAGING_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI packaging alignment failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no packaging alignment text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelOutput(parsed)) {
    throw new Error("OpenAI returned an invalid packaging alignment")
  }

  if (logContext) {
    await recordLlmCallCost(
      "packaging_alignment",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  return {
    overall: parsed.overall,
    components: {
      title: toComponentFeedback(parsed.title),
      thumbnail: toComponentFeedback(parsed.thumbnail),
      hook: toComponentFeedback(parsed.hook),
    },
    model,
    generatedAt: new Date().toISOString(),
  }
}
