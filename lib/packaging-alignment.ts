// LLM read of a video's "packaging" — its title, thumbnail and opening hook —
// and how well the three align. This is a surface-level feature: the thumbnail
// is fetched as an image URL from the Data API, the title is metadata, and the
// hook is the first ~30 seconds of the caption transcript, so none of it needs
// the uploaded source file. A vision-capable OpenAI model looks at the actual
// thumbnail image alongside the title and hook text and returns a short
// alignment summary plus the top strengths and improvements.

import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// The opening stretch treated as "the hook" for packaging-promise delivery.
const HOOK_WINDOW_SECONDS = 30

export interface PackagingAlignment {
  // The alignment summary: one or two sentences giving an overview of how the
  // packaging holds together, briefly commenting on each component (title,
  // thumbnail, hook).
  overall: string
  // The top strengths of the packaging (up to 3).
  whatWorked: string[]
  // The top improvements worth making (up to 3).
  whatCouldBeBetter: string[]
  model: string
  generatedAt: string
}

interface ModelOutput {
  overall: string
  whatWorked: string[]
  whatCouldBeBetter: string[]
}

const PACKAGING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall", "whatWorked", "whatCouldBeBetter"],
  properties: {
    overall: { type: "string" },
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

function isModelOutput(value: unknown): value is ModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelOutput>
  return (
    typeof candidate.overall === "string" &&
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
                "You review the packaging of a YouTube video: its title, its thumbnail image, and its spoken hook (the first ~30 seconds of transcript). You are shown the actual thumbnail image; ground everything in what you genuinely see, read and hear, never in guesses about elements that aren't there.",
                "overall: write a one-to-two sentence alignment summary that gives an overview of how the packaging holds together and briefly comments on each component (title, thumbnail, hook). For example: 'The packaging is cohesive but low-specificity: the title signals a casual comeback, the thumbnail reinforces a personal \"I'm back\" vibe, and the hook starts with that same energy but spends the opening on context instead of a sharper payoff.'",
                "whatWorked: the top 3 concise, specific strengths of the packaging, most important first. whatCouldBeBetter: the top 3 concrete, actionable improvements, most important first. Reference the real title/thumbnail/hook, never generic advice. Return fewer than 3 only when there genuinely are fewer, and never more than 3.",
                "If the hook transcript is empty, work from the title and thumbnail alone rather than inventing what was said.",
                'Never output an em dash character ("—") anywhere in your response; if you would use one, rewrite the phrase with a comma, colon, parentheses, or two separate sentences instead.',
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
    whatWorked: parsed.whatWorked.slice(0, 3),
    whatCouldBeBetter: parsed.whatCouldBeBetter.slice(0, 3),
    model,
    generatedAt: new Date().toISOString(),
  }
}
