// LLM read of a video's "packaging" — its title, thumbnail and opening hook —
// and how well the three align. This is a surface-level feature: the thumbnail
// is fetched as an image URL from the Data API, the title is metadata, and the
// hook is the first ~30 seconds of the caption transcript, so none of it needs
// the uploaded source file. A vision-capable OpenAI model looks at the actual
// thumbnail image alongside the title and hook text and reports what works and
// what could be better, plus explicit alignment judgments.

import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// The opening stretch treated as "the hook" for packaging-promise delivery.
const HOOK_WINDOW_SECONDS = 30

export type AlignmentRating = "strong" | "moderate" | "weak"

export interface AlignmentJudgment {
  rating: AlignmentRating
  assessment: string
}

export interface PackagingAlignment {
  // One or two sentences summarising how the packaging holds together.
  overall: string
  // Does the title match what the thumbnail shows/promises?
  titleThumbnailAlignment: AlignmentJudgment
  // Does the first ~30s deliver on the promise the title + thumbnail make?
  hookAlignment: AlignmentJudgment
  // What the model actually sees in the thumbnail image, so the creator can
  // sanity-check that the vision read is grounded.
  thumbnailObservations: string
  whatWorked: string[]
  whatCouldBeBetter: string[]
  model: string
  generatedAt: string
}

interface ModelOutput {
  overall: string
  titleThumbnailAlignment: AlignmentJudgment
  hookAlignment: AlignmentJudgment
  thumbnailObservations: string
  whatWorked: string[]
  whatCouldBeBetter: string[]
}

const RATING_ENUM = ["strong", "moderate", "weak"] as const

const JUDGMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rating", "assessment"],
  properties: {
    rating: { type: "string", enum: RATING_ENUM },
    assessment: { type: "string" },
  },
} as const

const PACKAGING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overall",
    "titleThumbnailAlignment",
    "hookAlignment",
    "thumbnailObservations",
    "whatWorked",
    "whatCouldBeBetter",
  ],
  properties: {
    overall: { type: "string" },
    titleThumbnailAlignment: JUDGMENT_SCHEMA,
    hookAlignment: JUDGMENT_SCHEMA,
    thumbnailObservations: { type: "string" },
    whatWorked: { type: "array", items: { type: "string" } },
    whatCouldBeBetter: { type: "array", items: { type: "string" } },
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

function isRating(value: unknown): value is AlignmentRating {
  return (
    typeof value === "string" &&
    (RATING_ENUM as readonly string[]).includes(value)
  )
}

function isJudgment(value: unknown): value is AlignmentJudgment {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<AlignmentJudgment>
  return isRating(candidate.rating) && typeof candidate.assessment === "string"
}

function isModelOutput(value: unknown): value is ModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelOutput>
  return (
    typeof candidate.overall === "string" &&
    isJudgment(candidate.titleThumbnailAlignment) &&
    isJudgment(candidate.hookAlignment) &&
    typeof candidate.thumbnailObservations === "string" &&
    Array.isArray(candidate.whatWorked) &&
    Array.isArray(candidate.whatCouldBeBetter)
  )
}

// Generates the packaging alignment, or null when there's no thumbnail to look
// at (the feature is fundamentally about the thumbnail, so without the image
// there's nothing distinctive to add over the pacing/attribution passes).
export async function generatePackagingAlignment(
  video: Pick<VideoDetails, "title" | "description" | "thumbnailUrl">,
  transcript: TranscriptCue[],
): Promise<PackagingAlignment | null> {
  if (!video.thumbnailUrl) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model =
    process.env.OPENAI_PACKAGING_MODEL ??
    process.env.OPENAI_SNAPSHOT_ANALYSIS_MODEL ??
    "gpt-5.4-mini"

  const hookText = transcriptForSegment(transcript, 0, HOOK_WINDOW_SECONDS)

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      max_output_tokens: 4_000,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: [
                "You review the packaging of a YouTube video: its title, its thumbnail image, and its spoken hook (the first ~30 seconds of transcript).",
                "You are shown the actual thumbnail image. Describe what you genuinely see in it under thumbnailObservations; do not guess at elements that aren't visible.",
                "Judge titleThumbnailAlignment: does the title and the thumbnail tell one coherent, compelling story, or do they compete / mismatch / leave the promise unclear?",
                "Judge hookAlignment: does the spoken hook immediately deliver on, or pay off, the curiosity/promise the title and thumbnail set up? A hook that wanders or buries the promise is weak alignment even if the title and thumbnail are strong.",
                "Rate each as strong, moderate or weak, with a one-to-two sentence assessment grounded in the specific title text, thumbnail contents and hook wording.",
                "whatWorked: 2-4 concise, specific strengths of the packaging. whatCouldBeBetter: 2-4 concrete, actionable improvements. Reference the real title/thumbnail/hook, never generic advice.",
                "If the hook transcript is empty, say so in hookAlignment rather than inventing what was said.",
                "Write a one-sentence overall summary of how the packaging holds together.",
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
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no packaging alignment text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelOutput(parsed)) {
    throw new Error("OpenAI returned an invalid packaging alignment")
  }

  return {
    overall: parsed.overall,
    titleThumbnailAlignment: parsed.titleThumbnailAlignment,
    hookAlignment: parsed.hookAlignment,
    thumbnailObservations: parsed.thumbnailObservations,
    whatWorked: parsed.whatWorked,
    whatCouldBeBetter: parsed.whatCouldBeBetter,
    model,
    generatedAt: new Date().toISOString(),
  }
}
