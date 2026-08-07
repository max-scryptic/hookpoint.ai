// LLM attribution of a video's retention curve to its transcript: for each
// hook window, significant drop-off and retention gain, an explanation of what
// was likely happening (grounded in what was being said at that moment) plus a
// concrete tip where useful. This is the API-only, source-file-free counterpart
// to the deep-analysis events synthesized from harvested frames/audio — it
// reasons purely from the retention numbers and the caption transcript.
//
// Mirrors lib/pacing-analysis.ts: a single OpenAI Responses call with a strict
// JSON schema, one output entry per supplied moment, keyed by index.

import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import type { RetentionWindow } from "@/lib/retention-windows"
import { TIP_VOICE_PROMPT } from "@/lib/tip-voice"
import {
  transcriptForSegment,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

export type RetentionMomentKind = "hook" | "drop_off" | "gain" | "hold"

// Bumped to 5 when tips became strictly forward-looking: stored attributions
// generated under the old prompt can still say "re-cut this" about a video that
// is already live, so they need regenerating rather than serving from cache.
// Bumped to 6 when the shared tip voice (lib/tip-voice.ts) took over, which also
// bans a tip pointing back at the analysed video ("why this deck is
// mysterious"); attributions written before it read as notes on a published
// video rather than as advice, so they are regenerated too.
export const RETENTION_ATTRIBUTION_SCHEMA_VERSION = 6

export interface RetentionMomentAttribution {
  kind: RetentionMomentKind
  // Zero-based index within its kind, matching RetentionWindow.windowIndex so
  // the UI can join attribution back onto the drop-off / gain it describes.
  windowIndex: number
  fromSeconds: number
  toSeconds: number
  explanation: string
  // A concrete, actionable suggestion for the uploader's *next* videos. The
  // video being attributed is already published, so a tip that asks for a
  // re-edit or an A/B against the current cut is not something they can act on;
  // the prompt below forbids that framing. Gains always carry a tip (what proven
  // thing to keep doing); it may still be null for other kinds when there's
  // genuinely nothing worth changing.
  tip: string | null
  confidence: number
}

export interface RetentionAttribution {
  schemaVersion: number
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

// Builds the ordered list of moments handed to the model. Hooks first, then
// drop-offs and gains, each in the order they appear on screen. The transcript for a moment is
// taken over its padded analysis window when one exists (wider, so a mid-
// sentence drop still picks up its lead-in), falling back to the detected step.
export function prepareRetentionMoments(
  windows: RetentionWindow[],
  transcript: TranscriptCue[],
): PreparedMoment[] {
  const moments: PreparedMoment[] = []

  for (const kind of ["hook", "drop_off", "gain", "hold"] as const) {
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
  logContext?: LlmLogContext,
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
                "Write to the uploader in the second person (you, your video), reviewing their own video. Whoever is heard speaking may be the uploader, a co-host, a guest, or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator, the host); frame it as the uploader's own video instead (say 'here you are still laying out the context', not 'he is still laying out the context').",
                "Each moment is either a hook (one of the opening hook windows), a drop_off (viewers left), a gain (viewers returned or re-watched), or a hold (viewers stayed).",
                "Reason only from the supplied transcript, timestamps and retention numbers. Do not infer visuals, editing, music, thumbnails or vocal delivery; you cannot see or hear the video.",
                TIP_VOICE_PROMPT,
                "The explanation and the tip are written under different rules, so keep them apart. The explanation describes this video: it names what was said at that moment and may quote it. The tip never does; it is the advice for the next video, written to stand on its own.",
                "For a hook, explain how effectively the words create curiosity, establish the promise, and move toward delivering it. Ground the explanation in the supplied transcript and give one concrete way to open a future video so it holds viewers.",
                "For a drop_off, explain the most likely reason viewers left based on what was being said (e.g. a topic change, a slow tangent, an unmet promise, an ad or sponsor read, a natural stopping point), and give one concrete tip for handling that same situation differently in a future video.",
                "For a gain, explain what likely pulled viewers back or made them re-watch, and always give a concrete tip (never null for a gain): the explanation names the specific thing that worked here, and the tip tells the uploader how to deliberately set that same thing up again in their next videos rather than offering generic praise.",
                "For a hold, explain what in the supplied words likely sustained attention without a meaningful gain or loss, and set tip to a short note on what to keep doing in future videos.",
                // A moment is explained in isolation, so several moments with
                // one cause used to come back as one sentence repeated down the
                // page. lib/report-tip-uniqueness.ts drops a repeat at render
                // time, which costs that moment its tip, so it is worth asking
                // for distinct advice here where the moment can still keep one.
                // Stored attributions written before this instruction existed
                // are covered by that render-time pass, so this does not need a
                // schema version bump to take effect.
                "No two tips across all the moments may give the same advice. Several moments often share a cause, and each tip still has to be worth reading on its own: give a different concrete action rather than restating an earlier tip in other words. Where a moment genuinely leaves nothing new to suggest, set its tip to null instead (except on a gain, which always keeps one).",
                "relativePerformance (0..1) compares this moment to similar videos; below 0.5 is underperforming. Use it to judge severity, not as the explanation itself.",
                "Keep each explanation to 1-2 specific sentences that reference what is actually said. Never invent dialogue that isn't in the transcript.",
                "Return exactly one moments entry for every supplied moment, using its momentIndex. Write a one-sentence overview of the video's overall retention story.",
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
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no retention attribution text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelOutput(parsed)) {
    throw new Error("OpenAI returned an invalid retention attribution")
  }

  if (logContext) {
    await recordLlmCallCost(
      "retention_attribution",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  const byIndex = new Map(parsed.moments.map((moment) => [moment.momentIndex, moment]))

  return {
    schemaVersion: RETENTION_ATTRIBUTION_SCHEMA_VERSION,
    overview: parsed.overview,
    moments: moments.map((moment, index) => {
      const analysis = byIndex.get(index)
      const tip = analysis?.tip?.trim() ? analysis.tip : null
      return {
        kind: moment.kind,
        windowIndex: moment.windowIndex,
        fromSeconds: moment.fromSeconds,
        toSeconds: moment.toSeconds,
        explanation: analysis?.explanation ?? "",
        // A gain documents a proven pattern, so it must always leave the
        // uploader with something to reuse. If the model still returns no tip
        // despite the instruction, fall back to a deterministic reuse prompt so
        // the "Try:" recommendation never goes missing on a gain.
        tip:
          tip ??
          (moment.kind === "gain"
            ? "Note what worked in this moment and deliberately reuse the same approach in your next videos."
            : null),
        confidence: Math.min(1, Math.max(0, analysis?.confidence ?? 0)),
      }
    }),
    model,
    generatedAt: new Date().toISOString(),
  }
}
