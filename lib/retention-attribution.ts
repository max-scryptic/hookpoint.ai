// LLM attribution of a video's retention curve to its transcript: for each
// hook window, significant drop-off and retention gain, an explanation of what
// was likely happening (grounded in what was being said at that moment) plus a
// concrete tip where useful. This is the API-only, source-file-free counterpart
// to the deep-analysis events synthesized from harvested frames/audio - it
// reasons purely from the retention numbers and the caption transcript.
//
// Mirrors lib/pacing-analysis.ts: a single OpenAI Responses call with a strict
// JSON schema, one output entry per supplied moment, keyed by index.

import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import type { RetentionWindow } from "@/lib/retention-windows"
import {
  normaliseTipExamples,
  TIP_EXAMPLES_ARRAY_SCHEMA,
  type TipExample,
} from "@/lib/tip-examples"
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
// Bumped to 7 when a tip stopped being owed to every moment (see THE WARRANT
// below). Every stored attribution up to 6 was written under a prompt that
// demanded one per moment, so they all carry the tips this version exists to
// stop producing.
// Bumped to 8 when the hold instruction was rewritten. Version 7 told the model
// a hold was "the moment least likely to earn a tip, since nothing measurably
// changed", which is the wrong reading of a hold and produced a Holds section
// where no row ever carried advice. Every attribution stored at 7 was written
// under that instruction, so their holds are silent for a reason that no longer
// applies and they are regenerated.
// NOT bumped to 9 for the worked examples now written beside every tip (see
// lib/tip-example-voice.ts). A stored attribution's tips are still right, they
// simply carry no examples, and opening one asks /api/tips/examples for the
// three instead. A bump would regenerate every attribution in the product, at
// our cost, to replace advice that was not wrong.
export const RETENTION_ATTRIBUTION_SCHEMA_VERSION = 8

// THE WARRANT
//
// This pass reads a transcript. It has no picture and no sound, and the prompt
// says so outright. But plenty of retention moments are not caused by the words:
// a held frame, a jump cut, a sponsor bumper, a graphic that missed, a drop in
// energy. Asked for a tip at such a moment anyway, the model cannot answer "the
// cause is not in what I was given" - it can only reach for the nearest thing in
// the transcript and write advice about that. The output is not a wrong tip so
// much as a transcript-shaped rationalisation of a non-transcript cause, which
// is the failure that quietly costs the reader their trust in the tips that are
// right.
//
// So a tip is earned rather than owed. The model scores how far the supplied
// words actually justify the advice it wrote (tipWarrant), and anything under
// this threshold is dropped before it is stored. The explanation always stays:
// it says what was said, which is checkable against the transcript in front of
// it, and it is the part of a moment that is always worth reading.
//
// This mirrors what the deep-analysis path already does with insightScore
// against getDeepAnalysisMinimumInsightScore() - evidence earns the insight -
// with the difference that deep analysis can see the freeze frame and this
// cannot. A moment whose cause is visual is exactly the moment this pass should
// stay quiet about and that one should speak on.
//
// Expect this to remove a lot of tips. That is the point.
const MINIMUM_TIP_WARRANT = 0.6

// Fewest words a moment's transcript must carry before it is worth asking about.
// Below this there is nothing for an explanation to reference and nothing for a
// tip to be drawn from: a drop-off over four words of filler gets an invented
// reading of those four words, since the model is given no way to say "there is
// nothing here". Silence across a window is a real signal, but it belongs to the
// deep-analysis path, which can hear it; this one would have to make up words.
const MINIMUM_TRANSCRIPT_WORDS = 8

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length
}

export interface RetentionMomentAttribution {
  kind: RetentionMomentKind
  // Zero-based index within its kind, matching RetentionWindow.windowIndex so
  // the UI can join attribution back onto the drop-off / gain it describes.
  windowIndex: number
  fromSeconds: number
  toSeconds: number
  explanation: string
  // A concrete, actionable suggestion for the uploader's *next* videos, or null
  // for any moment whose words did not earn one (see THE WARRANT above). The
  // video being attributed is already published, so a tip that asks for a
  // re-edit or an A/B against the current cut is not something they can act on;
  // the prompt below forbids that framing.
  tip: string | null
  // Three worked examples of the tip, written in the same call so the
  // transcript spoken around the moment is still in front of the model. Empty
  // whenever there is no tip to demonstrate, and absent altogether on
  // attributions stored before examples existed, which the interface fills in
  // from /api/tips/examples when the tip is opened.
  tipExamples?: TipExample[]
  // The model's own reading of how far the supplied transcript justifies the tip
  // it wrote, 0..1. Kept after the gate has been applied so an admin can see
  // that a moment was quiet by choice, and at what score, rather than for want
  // of anything to say. 0 whenever the model wrote no tip at all.
  tipWarrant: number
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
  tipExamples: unknown
  tipWarrant: number
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
        required: [
          "momentIndex",
          "explanation",
          "tip",
          "tipExamples",
          "tipWarrant",
          "confidence",
        ],
        properties: {
          momentIndex: { type: "integer" },
          explanation: { type: "string" },
          tip: { type: ["string", "null"] },
          tipExamples: TIP_EXAMPLES_ARRAY_SCHEMA,
          tipWarrant: { type: "number", minimum: 0, maximum: 1 },
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
//
// A moment carrying fewer than MINIMUM_TRANSCRIPT_WORDS is left out entirely
// rather than sent along with an empty `said`. Asked about a moment with no
// words, the model still has to return an explanation and a tip for it, so what
// comes back is invented; the window keeps its retention figures and its deep
// analysis, and simply shows no script feedback.
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
        const said = transcriptForSegment(transcript, from, to)
        if (wordCount(said) < MINIMUM_TRANSCRIPT_WORDS) return
        moments.push({
          kind,
          windowIndex: window.windowIndex,
          fromSeconds: window.fromSeconds,
          toSeconds: window.toSeconds,
          deltaPercent: Number((window.delta * 100).toFixed(1)),
          relativePerformance: window.relativePerformance,
          said,
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
// (no drop-offs/gains, or none carrying enough transcript to reason from -
// attributing a moment with no words would just be invention).
export async function generateRetentionAttribution(
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  windows: RetentionWindow[],
  transcript: TranscriptCue[],
  logContext?: LlmLogContext,
): Promise<RetentionAttribution | null> {
  const moments = prepareRetentionMoments(windows, transcript)
  if (moments.length === 0) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model =
    process.env.OPENAI_RETENTION_ATTRIBUTION_MODEL ??
    process.env.OPENAI_PACING_MODEL ??
    "gpt-4.1-mini"

  const instructions = await resolvePrompt("retention_attribution")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // A moment that earns a tip now writes three worked examples with it, so
      // the per moment allowance is up from 500. A truncated response is a
      // failed analysis, and an unspent ceiling costs nothing.
      max_output_tokens: Math.min(32_000, Math.max(6_000, moments.length * 700)),
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
      const tip = analysis?.tip?.trim() ? analysis.tip.trim() : null
      // Scored on the transcript alone by the model that wrote the tip. A tip
      // with no score behind it (a malformed entry, a moment the model skipped)
      // has nothing vouching for it, so it is treated as unwarranted.
      const tipWarrant = clamp01(analysis?.tipWarrant ?? 0)
      // A tip the gate below drops takes its examples with it: they demonstrate
      // advice that is no longer being given.
      const keptTip = tip && tipWarrant >= MINIMUM_TIP_WARRANT ? tip : null
      return {
        kind: moment.kind,
        windowIndex: moment.windowIndex,
        fromSeconds: moment.fromSeconds,
        toSeconds: moment.toSeconds,
        explanation: analysis?.explanation ?? "",
        // The gate. A moment whose words did not earn advice keeps its
        // explanation and shows no "Try:" line - including a gain, which used to
        // fall back to a fixed "note what worked and reuse it" sentence. That
        // fallback fired precisely when the model had nothing to say, so it was
        // guaranteed to be filler every time it appeared.
        tip: keptTip,
        tipExamples: keptTip ? normaliseTipExamples(analysis?.tipExamples) : [],
        tipWarrant: tip ? tipWarrant : 0,
        confidence: clamp01(analysis?.confidence ?? 0),
      }
    }),
    model,
    generatedAt: new Date().toISOString(),
  }
}
