import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import {
  normaliseTipExamples,
  TIP_EXAMPLES_ARRAY_SCHEMA,
  type TipExample,
} from "@/lib/tip-examples"
import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

export type PacingRate =
  | "very_slow"
  | "slow"
  | "moderate"
  | "fast"
  | "very_fast"
export type InformationDensity = "low" | "moderate" | "high"
export type NarrativeProgression = "stalled" | "limited" | "steady" | "strong"
export type PacingChange = "decelerating" | "stable" | "accelerating" | "mixed"

export interface PacingWindow {
  id: string
  label: string
  kind: "hook" | "minute"
  startSeconds: number
  endSeconds: number
  wordCount: number
  wordsPerMinute: number
  role: string
  pace: PacingRate
  informationDensity: InformationDensity
  progression: NarrativeProgression
  pacingChange: PacingChange
  evidence: string[]
  possibleIssue: string | null
  confidence: number
}

export interface PacingAnalysis {
  overallPacing: string
  videoWidePatterns: string[]
  notableTransitions: Array<{
    atSeconds: number
    description: string
  }>
  slowOrRepetitiveStretches: Array<{
    startSeconds: number
    endSeconds: number
    reason: string
    suggestion: string
    // Three worked examples of the suggestion, written in the same call so the
    // transcript of the stretch is still in front of the model. Absent on
    // analyses stored before they existed, which the interface fills in from
    // /api/tips/examples when the tip is opened.
    examples?: TipExample[]
  }>
  windows: PacingWindow[]
  model: string
  generatedAt: string
}

interface PreparedWindow {
  id: string
  label: string
  kind: "hook" | "minute"
  startSeconds: number
  endSeconds: number
  wordCount: number
  wordsPerMinute: number
  transcript: TranscriptCue[]
}

interface ModelWindow {
  windowIndex: number
  role: string
  pace: PacingRate
  informationDensity: InformationDensity
  progression: NarrativeProgression
  pacingChange: PacingChange
  evidence: string[]
  possibleIssue: string | null
  confidence: number
}

interface ModelOutput {
  overallPacing: string
  videoWidePatterns: string[]
  notableTransitions: Array<{
    atSeconds: number
    description: string
  }>
  slowOrRepetitiveStretches: Array<{
    startSeconds: number
    endSeconds: number
    reason: string
    suggestion: string
    examples: unknown
  }>
  windows: ModelWindow[]
}

const PACING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overallPacing",
    "videoWidePatterns",
    "notableTransitions",
    "slowOrRepetitiveStretches",
    "windows",
  ],
  properties: {
    overallPacing: { type: "string" },
    videoWidePatterns: { type: "array", items: { type: "string" } },
    notableTransitions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["atSeconds", "description"],
        properties: {
          atSeconds: { type: "number" },
          description: { type: "string" },
        },
      },
    },
    slowOrRepetitiveStretches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "startSeconds",
          "endSeconds",
          "reason",
          "suggestion",
          "examples",
        ],
        properties: {
          startSeconds: { type: "number" },
          endSeconds: { type: "number" },
          reason: { type: "string" },
          suggestion: { type: "string" },
          examples: TIP_EXAMPLES_ARRAY_SCHEMA,
        },
      },
    },
    windows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "windowIndex",
          "role",
          "pace",
          "informationDensity",
          "progression",
          "pacingChange",
          "evidence",
          "possibleIssue",
          "confidence",
        ],
        properties: {
          windowIndex: { type: "integer" },
          role: { type: "string" },
          pace: {
            type: "string",
            enum: ["very_slow", "slow", "moderate", "fast", "very_fast"],
          },
          informationDensity: {
            type: "string",
            enum: ["low", "moderate", "high"],
          },
          progression: {
            type: "string",
            enum: ["stalled", "limited", "steady", "strong"],
          },
          pacingChange: {
            type: "string",
            enum: ["decelerating", "stable", "accelerating", "mixed"],
          },
          evidence: {
            type: "array",
            items: { type: "string" },
          },
          possibleIssue: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function transcriptInWindow(
  transcript: TranscriptCue[],
  startSeconds: number,
  endSeconds: number,
): TranscriptCue[] {
  return transcript
    .filter((cue) => {
      // Assign each cue to exactly one window by its midpoint. Caption cues are
      // short, and this avoids duplicating words when a cue crosses a boundary.
      const midpoint = (cue.startSeconds + cue.endSeconds) / 2
      return midpoint >= startSeconds && midpoint < endSeconds
    })
    .map((cue) => ({ ...cue, text: cue.text.trim() }))
    .filter((cue) => Boolean(cue.text))
}

export function buildPacingWindows(
  durationSeconds: number,
  transcript: TranscriptCue[],
): PreparedWindow[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []

  const boundaries: Array<{
    startSeconds: number
    endSeconds: number
    kind: "hook" | "minute"
  }> = [
    {
      startSeconds: 0,
      endSeconds: Math.min(30, durationSeconds),
      kind: "hook",
    },
  ]

  for (let startSeconds = 30; startSeconds < durationSeconds; startSeconds += 60) {
    boundaries.push({
      startSeconds,
      endSeconds: Math.min(startSeconds + 60, durationSeconds),
      kind: "minute",
    })
  }

  return boundaries.map((boundary, index) => {
    const windowTranscript = transcriptInWindow(
      transcript,
      boundary.startSeconds,
      boundary.endSeconds,
    )
    const text = windowTranscript.map((cue) => cue.text).join(" ")
    const wordCount = countWords(text)
    const windowDuration = boundary.endSeconds - boundary.startSeconds

    return {
      id: boundary.kind === "hook" ? "hook" : `minute-${index}`,
      label: boundary.kind === "hook" ? "Hook" : `Window ${index + 1}`,
      ...boundary,
      wordCount,
      wordsPerMinute:
        windowDuration > 0 ? Math.round((wordCount / windowDuration) * 60) : 0,
      transcript: windowTranscript,
    }
  })
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
    typeof candidate.overallPacing === "string" &&
    Array.isArray(candidate.videoWidePatterns) &&
    Array.isArray(candidate.notableTransitions) &&
    Array.isArray(candidate.slowOrRepetitiveStretches) &&
    Array.isArray(candidate.windows)
  )
}

export async function generatePacingAnalysis(
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  transcript: TranscriptCue[],
  logContext?: LlmLogContext,
): Promise<PacingAnalysis | null> {
  const windows = buildPacingWindows(video.durationSeconds, transcript)
  if (
    windows.length === 0 ||
    windows.every((window) => window.transcript.length === 0)
  ) {
    return null
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.OPENAI_PACING_MODEL ?? "gpt-4.1-mini"

  const instructions = await resolvePrompt("pacing")
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // Every stretch now carries three worked examples as well as its
      // suggestion, which is another 150 tokens or so each, so the floor is
      // above what five of them can need. A truncated response is a failed
      // analysis, and an unspent ceiling costs nothing.
      max_output_tokens: Math.min(
        32_000,
        Math.max(6_000, windows.length * 450),
      ),
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
                video: {
                  title: video.title,
                  durationSeconds: video.durationSeconds,
                },
                windows: windows.map((window, windowIndex) => ({
                  windowIndex,
                  startSeconds: window.startSeconds,
                  endSeconds: window.endSeconds,
                  wordCount: window.wordCount,
                  wordsPerMinute: window.wordsPerMinute,
                  transcript: window.transcript,
                })),
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "youtube_pacing_analysis",
          strict: true,
          schema: PACING_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI pacing analysis failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no pacing analysis text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelOutput(parsed)) {
    throw new Error("OpenAI returned an invalid pacing analysis")
  }

  // Log the call's cost to the account-wide LLM call log (best-effort).
  if (logContext) {
    await recordLlmCallCost(
      "pacing",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  const modelWindows = new Map(
    parsed.windows.map((window) => [window.windowIndex, window]),
  )
  if (modelWindows.size !== windows.length) {
    throw new Error("OpenAI did not analyse every pacing window")
  }

  return {
    overallPacing: parsed.overallPacing,
    videoWidePatterns: parsed.videoWidePatterns,
    notableTransitions: parsed.notableTransitions,
    // Normalised rather than trusted: the examples are the one part of this
    // response the interface renders verbatim, and a model that wrote four, or
    // wrote one with no text in it, must not reach a tab strip built for three.
    slowOrRepetitiveStretches: parsed.slowOrRepetitiveStretches.map(
      (stretch) => ({
        ...stretch,
        examples: normaliseTipExamples(stretch.examples),
      }),
    ),
    windows: windows.map((window, index) => {
      const analysis = modelWindows.get(index)
      if (!analysis) throw new Error(`Missing pacing window ${index}`)
      return {
        id: window.id,
        label: window.label,
        kind: window.kind,
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        wordCount: window.wordCount,
        wordsPerMinute: window.wordsPerMinute,
        role: analysis.role,
        pace: analysis.pace,
        informationDensity: analysis.informationDensity,
        progression: analysis.progression,
        pacingChange: analysis.pacingChange,
        evidence: analysis.evidence,
        possibleIssue: analysis.possibleIssue,
        confidence: Math.min(1, Math.max(0, analysis.confidence)),
      }
    }),
    model,
    generatedAt: new Date().toISOString(),
  }
}
