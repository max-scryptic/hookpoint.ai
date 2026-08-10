// The written Script head-to-head: a model-authored comparison of two videos'
// full transcripts, with each video's packaging taxonomy (title/thumbnail/hook
// read) supplied as context. It is a prose report that reads both scripts
// directly and explains how they differ and what in the writing likely moved
// retention, and it is the whole of the Script tab: the deterministic taxonomy
// diff that used to render beneath it is no longer shown anywhere. It
// is generated once, from the generate endpoint while the creator waits on the
// button, and stored on the video_comparisons row (see the 20260726120000
// migration); the report page only ever reads it back and never calls this, so
// a report is never re-written just because someone opened the page.
//
// WHAT THE REPORT IS ALLOWED TO CLAIM
//
// This prompt used to receive both videos' views and average watched with only
// a "treat it as correlation" nudge attached, which is a tone instruction and
// not a constraint. Handed 19% average watched on 73 views against 16% on
// 1,100, it did the obvious thing: named the 73 view video the stronger
// retention play and pointed every tip at it. Neither the 3 point gap (well
// inside the margin a 73 view audience carries) nor the comparison itself (two
// very different traffic mixes) supported that.
//
// So the pair's comparability is settled first, in
// lib/comparison-comparability.ts, and it binds this report two ways: the
// shared rules go into the prompt, and, for a pair with no usable performance
// anchor, the per video performance figures are left out of the model input
// altogether. A number the model never receives cannot orient a tip.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any generated
// or literal text in this file. Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  assessPairComparability,
  comparabilityForModel,
  COMPARABILITY_PROMPT,
  isAnchored,
  type PairComparability,
} from "@/lib/comparison-comparability"
import { SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION } from "@/lib/comparison-report-versions"
import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import { getOrGenerateScriptTaxonomy } from "@/lib/script-taxonomies"
import { TIP_VOICE_PROMPT } from "@/lib/tip-voice"
import { saveScriptComparisonReport } from "@/lib/video-comparisons"
import {
  preferredViewCount,
  type TrafficSource,
  type TranscriptCue,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// The stored shape version lives in lib/comparison-report-versions.ts;
// re-exported here so this module stays the one import for everything about the
// script report.
export { SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION }

// One titled paragraph of the written comparison, plus the one change that
// paragraph argues for. The paragraph is deliberately short (one to two
// sentences): the tab stacks these cards, so a long body pushes the later
// sections off screen.
export interface ScriptComparisonReportSection {
  heading: string
  body: string
  // This section's own "Try:" line, so every section of the report closes on
  // something to do next rather than only stating the difference. Both videos
  // are already published, so it is written as advice for the uploader's next
  // script rather than as a fix to either of them. Optional only because
  // reports stored before schema version 2 predate it; the model always writes
  // one now.
  tip?: string
}

export interface ScriptComparisonReport {
  // A two sentence overall verdict on how the two scripts compare.
  summary: string
  // The per-theme body: structure, substance, hook, emotion, likely driver.
  sections: ScriptComparisonReportSection[]
  // What this pair could honestly be compared on when the report was written,
  // stored alongside it so the page can show the reader the same limit the
  // model wrote under without recomputing it from analytics. Optional only
  // because reports stored before schema version 4 predate it.
  comparability?: PairComparability
  schemaVersion: number
  model: string
  generatedAt: string
}

// One video's inputs to the comparison: its identity, the packaging context and
// the full transcript. `transcript` may be empty when the video has no
// captions, in which case that side contributes only its packaging read.
export interface ScriptComparisonReportSide {
  title: string | null
  views: number | null
  averageViewPercentage: number | null
  // Where this video's views came from, used to measure how differently the two
  // audiences were reached rather than infer it from the view gap alone. Empty
  // when YouTube reported no breakdown.
  trafficSources: TrafficSource[]
  packagingTaxonomy: PackagingTaxonomy | null
  transcript: TranscriptCue[]
}

const MAX_SECTIONS = 6
const MIN_SECTIONS = 3
// Keep each transcript bounded so a very long video cannot blow the token
// budget. The head of a script carries the hook and setup that matter most.
const MAX_TRANSCRIPT_CHARS = 14_000

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections"],
  properties: {
    summary: { type: "string" },
    sections: {
      type: "array",
      minItems: MIN_SECTIONS,
      maxItems: MAX_SECTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body", "tip"],
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          tip: { type: "string" },
        },
      },
    },
  },
} as const

interface ModelReportOutput {
  summary: string
  sections: ScriptComparisonReportSection[]
}

function isModelReportOutput(value: unknown): value is ModelReportOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.sections) &&
    candidate.sections.length > 0 &&
    candidate.sections.every((section) => {
      if (!section || typeof section !== "object") return false
      const s = section as Record<string, unknown>
      return (
        typeof s.heading === "string" &&
        typeof s.body === "string" &&
        // A report stored before schema version 2 carried no section tip, and
        // still validates if it is ever fed back through here.
        (s.tip === undefined || typeof s.tip === "string")
      )
    })
  )
}

// Renders the transcript as timestamped lines ("[m:ss] text"), clipped to the
// character budget so the model always sees the opening. Empty cues are
// dropped; returns an empty string when there is nothing spoken.
function timestampedTranscript(cues: TranscriptCue[]): string {
  const lines: string[] = []
  let total = 0
  for (const cue of cues) {
    const text = cue.text.trim()
    if (!text) continue
    const seconds = Math.max(0, Math.round(cue.startSeconds))
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    const line = `[${mins}:${String(secs).padStart(2, "0")}] ${text}`
    if (total + line.length > MAX_TRANSCRIPT_CHARS) break
    lines.push(line)
    total += line.length + 1
  }
  return lines.join("\n")
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

// A compact, model-friendly view of one side. The packaging taxonomy is passed
// through as-is (it is already a small structured object) so the model can
// ground hook/title observations in the same read the packaging tab uses.
//
// `anchored` decides whether this side's performance figures travel with it.
// For a pair that cannot be compared on performance they are withheld: the
// rules in the prompt forbid ranking the two videos, and withholding the two
// numbers a ranking would be built from is what makes that rule hold rather
// than merely ask. Everything else about the side is unchanged, so the report
// loses none of its ability to describe what each script does.
export function scriptSideForModel(
  side: ScriptComparisonReportSide,
  anchored: boolean,
) {
  return {
    title: side.title,
    views: anchored ? side.views : null,
    averageViewPercentage: anchored ? side.averageViewPercentage : null,
    packaging: side.packagingTaxonomy ?? null,
    transcript: timestampedTranscript(side.transcript),
  }
}

// Exported so a test can assert what the prompt actually binds the report to
// without a network call.
export const SCRIPT_COMPARISON_INSTRUCTIONS = [
  "You write a head-to-head comparison of the SCRIPTS (the spoken content) of two YouTube videos, Video A and Video B, reading both full timestamped transcripts. Each video also comes with a packaging read (its title/thumbnail/hook taxonomy) that you may use as context for the opening and framing. Your job is to explain how the two scripts differ in what they SAY and how they FEEL, and what in the writing most plausibly moved audience retention.",
  "Ground every claim in what is genuinely in the transcripts; never invent lines that are not there, and use the packaging read only as supporting context, not as the main evidence. When a video's transcript is missing, say so plainly for that side rather than guessing at its content.",
  "Whoever is heard speaking may be the uploader, a co-host, a guest or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator); refer to the uploader's own video, or simply Video A and Video B.",
  "Write the name in full every time: Video A and Video B, never a bare A or B on its own, in the summary and in every section. 'Video B front-loads the payoff, Video A holds it back' is right; 'B front-loads the payoff, A holds it back' is not. The same holds for the possessive, so write Video A's opening rather than A's opening.",
  COMPARABILITY_PROMPT,
  "In this report, where the pair is anchored, views and averageViewPercentage come through for orientation and every link you draw between a script trait and performance is still correlation worth noting rather than proof, so hedge accordingly. Where it is not, those two fields arrive null on both videos by design, and the script evidence is the whole of what you have to argue from, which is enough: what a script does with its structure, its payoffs and its asides is visible in the transcript without any performance figure at all.",
  "Keep every field short. This report is read on one screen, so say each difference once, in the fewest words that still carry the evidence, and stop. Cut wind-up clauses, restatement of the heading, hedging padding and any sentence that only says a difference matters without naming what it is. A body that names the concrete difference in two sentences beats a longer one that circles it.",
  "summary: two sentences, about 45 words at most, on how the two scripts compare. When comparability.anchor is 'anchored' that includes which reads as the stronger retention play. Otherwise this is the one place the pair's limit is named, in a single short clause, and the rest of the summary says what the two scripts are each doing differently.",
  "sections: 3 to 6 titled paragraphs. Give each a short heading (e.g. Structure, Substance and payoff, Hook and opening, Emotion and energy, Likely retention driver) and a body of one to two sentences, about 50 words at most, comparing the two videos on that theme, naming Video A and Video B explicitly.",
  TIP_VOICE_PROMPT,
  "In this report that rule also means the two videos stay out of the tips entirely: never name Video A or Video B inside a tip, and never phrase a tip as something one of these two scripts should have done. The section bodies are the opposite: those describe what these two scripts already did, so they name Video A and Video B freely.",
  "tip: every section carries one. It is the single change that section's comparison argues for, written as a one-sentence instruction of about 25 words at most for the uploader's next script (for example 'State the payoff you are building to within the first fifteen seconds, then keep every aside under one sentence'). Name the change rather than restating the paragraph, and keep it specific to what this comparison actually showed rather than generic scripting advice, while phrasing it as a rule to apply next time. Do not repeat another section's tip word for word.",
  "Write in plain, direct prose. Never output an em dash character (U+2014) or en dash (U+2013) anywhere in your response; if you would use one, rewrite with a comma, colon, parentheses or two sentences instead.",
].join(" ")

// The whole comparison as the model receives it, comparability first so the
// verdict is read before the evidence it governs. Exported so a test can assert
// that a pair with no performance anchor really does travel without its
// performance figures, rather than only being told not to use them.
export function scriptComparisonForModel(
  a: ScriptComparisonReportSide,
  b: ScriptComparisonReportSide,
  comparability: PairComparability,
) {
  const anchored = isAnchored(comparability, "watch")
  return {
    comparability: comparabilityForModel(comparability, "watch"),
    videoA: scriptSideForModel(a, anchored),
    videoB: scriptSideForModel(b, anchored),
  }
}

// The pair's comparability, read off the two sides. Exported for the same
// reason: the verdict is what the whole report hangs on, so it is testable on
// its own.
export function scriptComparability(
  a: ScriptComparisonReportSide,
  b: ScriptComparisonReportSide,
): PairComparability {
  return assessPairComparability({
    viewsA: a.views,
    viewsB: b.views,
    averageWatchedPercentA: a.averageViewPercentage,
    averageWatchedPercentB: b.averageViewPercentage,
    trafficSourcesA: a.trafficSources,
    trafficSourcesB: b.trafficSources,
  })
}

// Writes the head-to-head from both scripts. Returns null (without calling
// OpenAI) when neither video has a transcript to read, so the caller can leave
// the report unset and fall back to the deterministic tables alone. Callers own
// persistence.
export async function generateScriptComparisonReport(
  a: ScriptComparisonReportSide,
  b: ScriptComparisonReportSide,
  logContext?: LlmLogContext,
): Promise<ScriptComparisonReport | null> {
  const comparability = scriptComparability(a, b)
  const payload = scriptComparisonForModel(a, b, comparability)
  if (!payload.videoA.transcript && !payload.videoB.transcript) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model =
    process.env.OPENAI_SCRIPT_COMPARISON_MODEL ??
    process.env.OPENAI_SCRIPT_MODEL ??
    "gpt-4.1-mini"

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 2_000,
      input: [
        {
          role: "developer",
          content: [
            { type: "input_text", text: SCRIPT_COMPARISON_INSTRUCTIONS },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(payload) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "script_comparison_report",
          strict: true,
          schema: REPORT_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI script comparison failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no script comparison text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelReportOutput(parsed)) {
    throw new Error("OpenAI returned an invalid script comparison report")
  }

  if (logContext) {
    await recordLlmCallCost(
      "script_comparison",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  return {
    summary: parsed.summary.trim(),
    sections: parsed.sections
      .map((section) => {
        const tip = section.tip?.trim() ?? ""
        return {
          heading: section.heading.trim(),
          body: section.body.trim(),
          // Dropped rather than stored empty, so the renderer's "has a tip"
          // test stays a simple presence check.
          ...(tip.length > 0 ? { tip } : {}),
        }
      })
      .filter((section) => section.heading.length > 0 && section.body.length > 0)
      .slice(0, MAX_SECTIONS),
    comparability,
    schemaVersion: SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
    model,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Orchestration

interface ComparisonVideoRow {
  id: string
  video_title: string | null
  video_details: Pick<
    VideoDetails,
    "title" | "durationSeconds" | "viewCount"
  > | null
  transcript: TranscriptCue[] | null
  analytics_summary: VideoAnalyticsSummary | null
  packaging_taxonomy: PackagingTaxonomy | null
}

// Loads both videos, makes sure each has an up to date script taxonomy (so the
// deterministic comparison tables populate even for a video whose detail page
// was never opened), then writes and stores the narrative report. Returns the
// report, or null when it could not be generated (no transcripts, or the pair's
// videos are missing / not owned by the user). Best-effort throughout: a
// per-video taxonomy failure never blocks the narrative, and the narrative is
// what this function ultimately returns and stores.
export async function buildAndStoreScriptComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  videoAId: string,
  videoBId: string,
  logContext?: LlmLogContext,
): Promise<ScriptComparisonReport | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(
      "id, video_title, video_details, transcript, analytics_summary, packaging_taxonomy:packaging_alignment->taxonomy",
    )
    .eq("user_id", userId)
    .in("id", [videoAId, videoBId])

  if (error) {
    throw new Error(
      `Failed to load videos for script comparison: ${error.message}`,
    )
  }

  const rows = (data ?? []) as unknown as ComparisonVideoRow[]
  const rowA = rows.find((row) => row.id === videoAId)
  const rowB = rows.find((row) => row.id === videoBId)
  if (!rowA || !rowB) return null

  // Backfill each video's script taxonomy so the head-to-head tables have data.
  // A failure or a missing transcript just leaves that side's tables sparse; it
  // never blocks the narrative below.
  await Promise.all(
    [rowA, rowB].map((row) =>
      getOrGenerateScriptTaxonomy(
        supabase,
        userId,
        row.id,
        {
          title: row.video_details?.title ?? row.video_title ?? "",
          durationSeconds: row.video_details?.durationSeconds ?? 0,
        },
        row.transcript ?? [],
      ).catch((taxonomyError) => {
        console.error(
          "Failed to backfill script taxonomy for comparison",
          taxonomyError,
        )
        return null
      }),
    ),
  )

  const toSide = (row: ComparisonVideoRow): ScriptComparisonReportSide => ({
    title: row.video_title ?? row.video_details?.title ?? null,
    views: preferredViewCount(row.video_details, row.analytics_summary),
    averageViewPercentage: row.analytics_summary?.averageViewPercentage ?? null,
    trafficSources: row.analytics_summary?.trafficSources ?? [],
    packagingTaxonomy: row.packaging_taxonomy,
    transcript: row.transcript ?? [],
  })

  const report = await generateScriptComparisonReport(
    toSide(rowA),
    toSide(rowB),
    logContext,
  )
  if (report == null) return null

  await saveScriptComparisonReport(supabase, userId, comparisonId, report)
  return report
}
