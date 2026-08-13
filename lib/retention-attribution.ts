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
          "tipWarrant",
          "confidence",
        ],
        properties: {
          momentIndex: { type: "integer" },
          explanation: { type: "string" },
          tip: { type: ["string", "null"] },
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
// (no drop-offs/gains, or none carrying enough transcript to reason from —
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
                // The warrant. See THE WARRANT above for why a tip has to be
                // earned here rather than produced on demand.
                "Every moment gets an explanation. A tip is not owed one. You are reading a transcript with no picture and no sound, so a great many retention moments have a cause you cannot see: a held frame, a jump cut, a sponsor bumper, a graphic that did or did not land, a change in energy, a stretch where the picture stopped moving. Where that is the likelier story, the words in front of you cannot tell you what to advise, and a tip written anyway is a guess dressed up as analysis. Set tip to null and let the explanation stand on its own. Returning null is the expected outcome for a large share of moments and is never a failure to do the task.",
                "tipWarrant (0..1) is your own honest reading of how far the supplied words justify the tip you wrote, judged on the transcript alone. Score it 0.8 or above when what is said is itself the cause and the advice follows directly from it: a promise made and not delivered, a topic changing with nothing to signpost it, a tangent that runs long, a payoff landing exactly where viewers came back, a question held open across a stretch nobody left. Score it around 0.5 when the words are merely consistent with the retention move and so is anything you cannot see. Score it 0.2 or below when the transcript is thin, generic, or tells you nothing beyond the fact that talking was happening. Do not inflate the score to keep a tip alive, and do not write a tip you would score below 0.5. Set tipWarrant to 0 whenever tip is null.",
                "For a hook, explain how effectively the words create curiosity, establish the promise, and move toward delivering it, grounded in the supplied transcript. Where the wording of the opening is itself what holds or loses the viewer, give one concrete way to open a future video.",
                "For a drop_off, explain the most likely reason viewers left based on what was being said (e.g. a topic change, a slow tangent, an unmet promise, an ad or sponsor read, a natural stopping point), and where the words are the cause, give one concrete tip for handling that same situation differently in a future video. Where the transcript reads as ordinary continuous speech with no such turn in it, the cause is more likely something you were not shown: explain what was being said and set tip to null.",
                "For a gain, explain what likely pulled viewers back or made them re-watch. Where the transcript shows the thing that did it (a payoff arriving, a question finally answered, a turn in the story), give a tip telling the uploader how to deliberately set that same thing up again in their next videos. Where the words around the gain are unremarkable, what worked was probably visual or editorial and is not yours to name, so set tip to null rather than writing generic praise or telling them to reuse an approach you cannot identify.",
                // A hold is not a quiet moment, it is a stretch the audience sat
                // through in full, and it is usually the longest span on the
                // page. The instruction here used to open by calling it the
                // moment least likely to earn a tip; the model took that as the
                // answer rather than as a warning, and the Holds section went
                // out with an explanation on every row and advice on none. What
                // the warrant actually asks is whether the words in front of you
                // name the thing doing the holding, which for a hold they often
                // do, since holding an audience for a minute is usually a
                // property of the writing rather than of a single cut.
                "For a hold, the words were spoken across a stretch where the audience stayed put, so explain what in them likely kept people watching. Where the transcript names the technique doing it (a question left open, stakes being raised, a decision narrated as it is taken, a mistake admitted, a story working towards a payoff), give a tip on how to set that same technique up deliberately in a future video, the way you would for a gain. Set tip to null where the words across the hold are unremarkable and whatever held the audience is more likely something you were not shown.",
                // A moment is explained in isolation, so several moments with
                // one cause used to come back as one sentence repeated down the
                // page. lib/report-tip-uniqueness.ts drops a repeat at render
                // time, which costs that moment its tip, so it is worth asking
                // for distinct advice here where the moment can still keep one.
                // Stored attributions written before this instruction existed
                // are covered by that render-time pass, so this does not need a
                // schema version bump to take effect.
                "No two tips across all the moments may give the same advice. Several moments often share a cause, and each tip still has to be worth reading on its own: give a different concrete action rather than restating an earlier tip in other words. Where a moment leaves nothing new to suggest, set its tip to null instead.",
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
      const tip = analysis?.tip?.trim() ? analysis.tip.trim() : null
      // Scored on the transcript alone by the model that wrote the tip. A tip
      // with no score behind it (a malformed entry, a moment the model skipped)
      // has nothing vouching for it, so it is treated as unwarranted.
      const tipWarrant = clamp01(analysis?.tipWarrant ?? 0)
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
        tip: tip && tipWarrant >= MINIMUM_TIP_WARRANT ? tip : null,
        tipWarrant: tip ? tipWarrant : 0,
        confidence: clamp01(analysis?.confidence ?? 0),
      }
    }),
    model,
    generatedAt: new Date().toISOString(),
  }
}
