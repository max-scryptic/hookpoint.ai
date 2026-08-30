// The Video Planner's packaging read: the same title / thumbnail / hook
// alignment the published-video report gives (lib/packaging-alignment.ts), run
// against footage nobody has seen yet.
//
// Two things make it a separate call rather than a reuse of that one:
//
//   • There can be up to three titles. The whole reason a creator enters more
//     than one is to be told which of them fits the thumbnail and the hook
//     best, so the titles are judged against each other in a single call. Three
//     independent runs of the published-video prompt could not do that: each
//     one would only ever see its own title.
//   • The advice points forwards. On a published report an improvement is a
//     rule for the next video, because this one is already out. Here the video
//     is still editable, so every improvement is a change to make before
//     publishing, and is written that way.
//
// The hook is transcribed from the uploaded footage rather than read from
// captions (lib/video-plans/hook-transcript.ts) - there are no captions for a
// video that has not been published.

import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import {
  normaliseTipExamples,
  TIP_EXAMPLES_ARRAY_SCHEMA,
  type TipExample,
} from "@/lib/tip-examples"

// The model's read of one candidate title, against the thumbnail and hook it
// would ship beside.
export interface VideoPlanTitleRead {
  // The title this read is about, echoed back so the UI never has to line up
  // two arrays by index to know which title it is showing.
  title: string
  // A short (3-6 word) characterisation, e.g. "Direct promise, low specificity".
  summary: string
  // 0-10, how tightly this title agrees with the thumbnail and the hook. Same
  // scale the published report prints its alignment on, so a creator reads one
  // number in both places.
  alignmentScore: number
  // The strongest thing about this title next to the other two surfaces.
  whatWorks: string
  // The one change worth making before publishing, or "" when there is none.
  whatToChange: string
  // Rewrites of this title with that change applied, ready to paste.
  examples: TipExample[]
}

// Feedback on a surface that has only one candidate: the thumbnail, or the
// hook. Same shape as the published report's per-component feedback, minus the
// list wrappers - a plan gives one strength and one change, not a ranked set.
export interface VideoPlanSurfaceRead {
  summary: string
  whatWorks: string
  whatToChange: string
  examples: TipExample[]
}

export interface VideoPlanPackaging {
  // Two short sentences on how the packaging holds together as a whole.
  overall: string
  // One read per candidate title, in the order the creator entered them.
  titles: VideoPlanTitleRead[]
  // Index into `titles` of the one the model would ship. Always a valid index:
  // normalisation clamps it, so a single-title plan recommends that title.
  recommendedTitleIndex: number
  // Why that one, in a sentence.
  recommendedTitleReason: string
  thumbnail: VideoPlanSurfaceRead
  hook: VideoPlanSurfaceRead
  model: string
  generatedAt: string
}

const SURFACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "whatWorks", "whatToChange", "examples"],
  properties: {
    summary: { type: "string" },
    whatWorks: { type: "string" },
    whatToChange: { type: "string" },
    examples: TIP_EXAMPLES_ARRAY_SCHEMA,
  },
} as const

const TITLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "alignmentScore",
    "whatWorks",
    "whatToChange",
    "examples",
  ],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    alignmentScore: { type: "number" },
    whatWorks: { type: "string" },
    whatToChange: { type: "string" },
    examples: TIP_EXAMPLES_ARRAY_SCHEMA,
  },
} as const

const PACKAGING_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overall",
    "titles",
    "recommendedTitleIndex",
    "recommendedTitleReason",
    "thumbnail",
    "hook",
  ],
  properties: {
    overall: { type: "string" },
    titles: { type: "array", items: TITLE_SCHEMA },
    recommendedTitleIndex: { type: "integer" },
    recommendedTitleReason: { type: "string" },
    thumbnail: SURFACE_SCHEMA,
    hook: SURFACE_SCHEMA,
  },
} as const

interface ModelSurfaceOutput {
  summary: string
  whatWorks: string
  whatToChange: string
  examples: unknown
}

// Exported because alignTitleReads takes it: the reconciliation between what
// the model returned and what the creator actually typed is the part most worth
// testing directly.
export interface ModelTitleOutput extends ModelSurfaceOutput {
  title: string
  alignmentScore: number
}

interface ModelOutput {
  overall: string
  titles: ModelTitleOutput[]
  recommendedTitleIndex: number
  recommendedTitleReason: string
  thumbnail: ModelSurfaceOutput
  hook: ModelSurfaceOutput
}

function isSurfaceOutput(value: unknown): value is ModelSurfaceOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelSurfaceOutput>
  return (
    typeof candidate.summary === "string" &&
    typeof candidate.whatWorks === "string" &&
    typeof candidate.whatToChange === "string"
  )
}

function isModelOutput(value: unknown): value is ModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelOutput>
  return (
    typeof candidate.overall === "string" &&
    typeof candidate.recommendedTitleReason === "string" &&
    typeof candidate.recommendedTitleIndex === "number" &&
    Array.isArray(candidate.titles) &&
    candidate.titles.every(
      (title) =>
        isSurfaceOutput(title) &&
        typeof (title as ModelTitleOutput).title === "string" &&
        typeof (title as ModelTitleOutput).alignmentScore === "number",
    ) &&
    isSurfaceOutput(candidate.thumbnail) &&
    isSurfaceOutput(candidate.hook)
  )
}

function toSurfaceRead(output: ModelSurfaceOutput): VideoPlanSurfaceRead {
  const whatToChange = output.whatToChange.trim()
  return {
    summary: output.summary,
    whatWorks: output.whatWorks,
    whatToChange,
    // Examples demonstrate the change, so a surface with nothing to change
    // carries none whatever the model returned.
    examples: whatToChange ? normaliseTipExamples(output.examples) : [],
  }
}

// Clamps a 0-10 score into range. The schema can ask for a number but not for a
// bounded one, and a score outside the scale would be drawn off the end of the
// meter it is rendered on.
function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(10, Math.max(0, Math.round(value * 10) / 10))
}

// Reconciles the model's title reads with the titles actually submitted.
//
// The model is asked to echo each title back, but the stored plan is what the
// creator typed, so the submitted list wins on both wording and order: a read
// is matched to its title by position, and its `title` field is overwritten
// with the submitted spelling. A model that returns too few reads simply loses
// the missing ones rather than shifting every later read onto the wrong title.
export function alignTitleReads(
  submitted: string[],
  reads: ModelTitleOutput[],
): VideoPlanTitleRead[] {
  return submitted.slice(0, reads.length).map((title, index) => {
    const read = reads[index]
    const surface = toSurfaceRead(read)
    return {
      title,
      summary: surface.summary,
      alignmentScore: clampScore(read.alignmentScore),
      whatWorks: surface.whatWorks,
      whatToChange: surface.whatToChange,
      examples: surface.examples,
    }
  })
}

// Keeps the recommendation pointing at a title that exists. A model naming an
// out-of-range index would otherwise leave the report with no recommendation to
// render, so it falls back to the first title, which is the one the creator led
// with.
export function clampRecommendedIndex(index: number, count: number): number {
  if (count === 0) return 0
  if (!Number.isInteger(index) || index < 0 || index >= count) return 0
  return index
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

export interface GeneratePackagingPlanInput {
  titles: string[]
  // The thumbnail as a data URI. The image lives in a private bucket, so it is
  // sent inline rather than as a URL: a signed URL would have to be reachable
  // by OpenAI's fetcher, and handing a third party a live key to our storage to
  // save a base64 encode is a poor trade.
  thumbnailDataUri: string
  // The spoken opening, transcribed from the footage. Empty when the opening
  // had no speech in it, which the prompt is told to work around rather than
  // invent around.
  hookTranscript: string
}

// Generates the packaging read for a plan. Throws on a model or transport
// failure; the caller records that against the plan.
export async function generateVideoPlanPackaging(
  input: GeneratePackagingPlanInput,
  logContext?: LlmLogContext,
): Promise<VideoPlanPackaging> {
  if (input.titles.length === 0) {
    throw new Error("A video plan needs at least one title to review")
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  // Shares the published report's model by default: it is the same reading of
  // the same three surfaces, and a planner that scored packaging differently
  // from the report would be worse than useless.
  const model =
    process.env.OPENAI_VIDEO_PLAN_PACKAGING_MODEL ??
    process.env.OPENAI_PACKAGING_MODEL ??
    "gpt-4.1-mini"

  const instructions = await resolvePrompt("video_plan_packaging")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // Up to three title reads plus two surface reads, each carrying three
      // worked examples alongside its own prose.
      max_output_tokens: 8_000,
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
                titles: input.titles,
                hookTranscript: input.hookTranscript,
              }),
            },
            { type: "input_image", image_url: input.thumbnailDataUri },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "video_plan_packaging",
          strict: true,
          schema: PACKAGING_PLAN_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI video plan packaging failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) {
    throw new Error("OpenAI returned no video plan packaging text")
  }

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelOutput(parsed)) {
    throw new Error("OpenAI returned an invalid video plan packaging read")
  }

  if (logContext) {
    await recordLlmCallCost(
      "video_plan_packaging",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  const titles = alignTitleReads(input.titles, parsed.titles)

  return {
    overall: parsed.overall,
    titles,
    recommendedTitleIndex: clampRecommendedIndex(
      parsed.recommendedTitleIndex,
      titles.length,
    ),
    recommendedTitleReason: parsed.recommendedTitleReason,
    thumbnail: toSurfaceRead(parsed.thumbnail),
    hook: toSurfaceRead(parsed.hook),
    model,
    generatedAt: new Date().toISOString(),
  }
}
