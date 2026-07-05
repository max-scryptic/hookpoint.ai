// LLM attribution of a video's retention curve to its transcript: for each
// significant drop-off and each retention gain, an explanation of what was
// likely happening (grounded in what was being said at that moment) plus, for
// drop-offs, a concrete tip. This is the API-only, source-file-free counterpart
// to the deep-analysis events synthesized from harvested frames/audio — it
// reasons purely from the retention numbers and the caption transcript.
//
// Mirrors lib/pacing-analysis.ts: a single OpenAI Responses call with a strict
// JSON schema, one output entry per supplied moment, keyed by index.

import type { RetentionWindow } from "@/lib/retention-windows"
import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

export type RetentionMomentKind = "drop_off" | "gain"

export interface RetentionMomentAttribution {
  kind: RetentionMomentKind
  // Zero-based index within its kind, matching RetentionWindow.windowIndex so
  // the UI can join attribution back onto the drop-off / gain it describes.
  windowIndex: number
  fromSeconds: number
  toSeconds: number
  explanation: string
  // A concrete, actionable suggestion. Null when there's nothing worth
  // changing (e.g. a healthy gain that just documents what to keep doing).
  tip: string | null
  confidence: number
}

export interface RetentionAttribution {
  // One or two sentences framing the video's overall retention story.
  overview: string
  moments: RetentionMomentAttribution[]
  model: string
  generatedAt: string
}

interface PreparedMoment {
  kind: RetentionMomentKind
  windowIndex: number
  fromSeconds: number
  toSeconds: number
  deltaPercent: number
  relativePerformance: number | null
  said: string
}

interface ModelMoment {
  momentIndex: number
  explanation: string
  tip: string | null
  confidence: number
}

interface ModelOutput {
  overview: string
  moments: ModelMoment[]
}

const ATTRIBUTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "moments"],
  properties: {
    overview: { type: "string" },
    moments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["momentIndex", "explanation", "tip", "confidence"],
        properties: {
          momentIndex: { type: "integer" },
          explanation: { type: "string" },
          tip: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

// Builds the ordered list of moments handed to the model. Drop-offs first, then
// gains, each in the order they appear on screen. The transcript for a moment is
// taken over its padded analysis window when one exists (wider, so a mid-
// sentence drop still picks up its lead-in), falling back to the detected step.
export function prepareRetentionMoments(
  windows: RetentionWindow[],
  transcript: TranscriptCue[],
): PreparedMoment[] {
  const moments: PreparedMoment[] = []

  for (const kind of ["drop_off", "gain"] as const) {
    windows
      .filter((window) => window.kind === kind && !window.outOfRange)
      .sort((a, b) => a.windowIndex - b.windowIndex)
      .forEach((window) => {
        const from = window.analysisFromSeconds ?? window.fromSeconds
        const to = window.analysisToSeconds ?? window.toSeconds
        moments.push({
          kind,
          windowIndex: window.windowIndex,
          fromSeconds: window.fromSeconds,
          toSeconds: window.toSeconds,
          deltaPercent: Number((window.delta * 100).toFixed(1)),
          relativePerformance: window.relativePerformance,
          said: transcriptForSegment(transcript, from, to),
        })
      })
  }

  return moments
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

function isModelOutput(value: unknown): value is ModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelOutput>
  return (
    typeof candidate.overview === "string" && Array.isArray(candidate.moments)
  )
}

// Generates the retention attribution, or null when there's nothing to attribute
// (no drop-offs/gains, or none with any transcript to reason from — attributing
// a moment with no words would just be invention).
export async function generateRetentionAttribution(
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  windows: RetentionWindow[],
  transcript: TranscriptCue[],
): Promise<RetentionAttribution | null> {
  const moments = prepareRetentionMoments(windows, transcript)
  if (moments.length === 0 || moments.every((moment) => moment.said === "")) {
    return null
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model =
    process.env.OPENAI_RETENTION_ATTRIBUTION_MODEL ??
    process.env.OPENAI_PACING_MODEL ??
    "gpt-4.1-mini"

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: Math.min(32_000, Math.max(4_000, moments.length * 500)),
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: [
                "You explain YouTube audience-retention moments using the transcript spoken around them.",
                "Each moment is either a drop_off (viewers left) or a gain (viewers returned or re-watched).",
                "Reason only from the supplied transcript, timestamps and retention numbers. Do not infer visuals, editing, music, thumbnails or vocal delivery — you cannot see or hear the video.",
                "For a drop_off, explain the most likely reason viewers left based on what was being said (e.g. a topic change, a slow tangent, an unmet promise, an ad or sponsor read, a natural stopping point), and give one concrete tip to reduce that loss next time.",
                "For a gain, explain what likely pulled viewers back or made them re-watch, and set tip to a short note on what to keep doing — or null if there's nothing actionable.",
                "relativePerformance (0..1) compares this moment to similar videos; below 0.5 is underperforming. Use it to judge severity, not as the explanation itself.",
                "Keep each explanation to 1-2 specific sentences that reference what is actually said. Never invent dialogue that isn't in the transcript.",
                "Return exactly one moments entry for every supplied moment, using its momentIndex. Write a one-sentence overview of the video's overall retention story.",
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
                video: {
                  title: video.title,
                  durationSeconds: video.durationSeconds,
                },
                moments: moments.map((moment, momentIndex) => ({
                  momentIndex,
                  kind: moment.kind,
                  fromSeconds: Math.round(moment.fromSeconds),
                  toSeconds: Math.round(moment.toSeconds),
                  retentionChangePercent: moment.deltaPercent,
                  relativePerformance: moment.relativePerformance,
                  transcript: moment.said,
                })),
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "youtube_retention_attribution",
          strict: true,
          schema: ATTRIBUTION_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI retention attribution failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no retention attribution text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelOutput(parsed)) {
    throw new Error("OpenAI returned an invalid retention attribution")
  }

  const byIndex = new Map(parsed.moments.map((moment) => [moment.momentIndex, moment]))

  return {
    overview: parsed.overview,
    moments: moments.map((moment, index) => {
      const analysis = byIndex.get(index)
      return {
        kind: moment.kind,
        windowIndex: moment.windowIndex,
        fromSeconds: moment.fromSeconds,
        toSeconds: moment.toSeconds,
        explanation: analysis?.explanation ?? "",
        tip: analysis?.tip ?? null,
        confidence: Math.min(1, Math.max(0, analysis?.confidence ?? 0)),
      }
    }),
    model,
    generatedAt: new Date().toISOString(),
  }
}
