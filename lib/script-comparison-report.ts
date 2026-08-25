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
  isAnchored,
  type PairComparability,
} from "@/lib/comparison-comparability"
import { SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION } from "@/lib/comparison-report-versions"
import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import {
  tipExamplesField,
  TIP_EXAMPLES_ARRAY_SCHEMA,
  type TipExample,
} from "@/lib/tip-examples"
import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import { getOrGenerateScriptTaxonomy } from "@/lib/script-taxonomies"
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

export type ScriptReportSide = "a" | "b"

// One theme of the written comparison, laid out the way the packaging
// head-to-head lays out a surface: what each video's script does on that theme,
// side by side, then the conclusion drawn from the pair, then the one change
// that conclusion argues for. Everything here is deliberately short: the tab
// stacks these panels, so a long section pushes the later ones off screen.
export interface ScriptComparisonReportSection {
  heading: string
  // What each video's script actually does on this theme, as a few short
  // points shown under that video's own column. They sit under a header that
  // already names the side, so they never name it themselves. Optional only
  // because reports stored before schema version 5 predate them, and those
  // render as the body paragraph alone.
  videoA?: string[]
  videoB?: string[]
  // Which of the two writes this theme better, judged on the writing itself
  // and never on which video performed better (see the comparability rules).
  // Optional for the same reason the two columns are.
  strongerSide?: ScriptReportSide | "neither"
  // The conclusion the columns add up to: what this theme does for a script in
  // general, rather than a restatement of what these two did. From schema
  // version 5 this names neither video, because the columns above it already
  // do. Reports stored earlier carry a paragraph comparing the two directly,
  // which still renders in the same place.
  body: string
  // This section's own "Try:" line, so every section of the report closes on
  // something to do next rather than only stating the difference. Both videos
  // are already published, so it is written as advice for the uploader's next
  // script rather than as a fix to either of them. Optional only because
  // reports stored before schema version 2 predate it; the model always writes
  // one now.
  tip?: string
  // Three worked examples of that tip, written in the same call so both
  // transcripts are still in front of the model. Absent, like the tip itself,
  // where there is nothing to carry: a report stored before examples existed
  // has the interface fill them in from /api/tips/examples on open.
  tipExamples?: TipExample[]
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
// How many points each video's column carries on a theme. Two or three is what
// a reader can take in across two columns at a glance; a fourth turns the panel
// into a wall and pushes the conclusion below the fold.
const MIN_SIDE_POINTS = 2
const MAX_SIDE_POINTS = 3
// Keep each transcript bounded so a very long video cannot blow the token
// budget. The head of a script carries the hook and setup that matter most.
const MAX_TRANSCRIPT_CHARS = 14_000

const sidePointsSchema = {
  type: "array",
  minItems: MIN_SIDE_POINTS,
  maxItems: MAX_SIDE_POINTS,
  items: { type: "string" },
} as const

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
        required: [
          "heading",
          "videoA",
          "videoB",
          "strongerSide",
          "body",
          "tip",
          "tipExamples",
        ],
        properties: {
          heading: { type: "string" },
          videoA: sidePointsSchema,
          videoB: sidePointsSchema,
          strongerSide: { type: "string", enum: ["a", "b", "neither"] },
          body: { type: "string" },
          tip: { type: "string" },
          tipExamples: TIP_EXAMPLES_ARRAY_SCHEMA,
        },
      },
    },
  },
} as const

interface ModelReportOutput {
  summary: string
  sections: ScriptComparisonReportSection[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isSideOrNeither(
  value: unknown,
): value is ScriptReportSide | "neither" {
  return value === "a" || value === "b" || value === "neither"
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
        // The per side columns and the craft verdict over them arrived at
        // schema version 5, so they are optional here: a report stored before
        // that still validates if it is ever fed back through.
        (s.videoA === undefined || isStringArray(s.videoA)) &&
        (s.videoB === undefined || isStringArray(s.videoB)) &&
        (s.strongerSide === undefined || isSideOrNeither(s.strongerSide)) &&
        // A report stored before schema version 2 carried no section tip, and
        // still validates if it is ever fed back through here.
        (s.tip === undefined || typeof s.tip === "string") &&
        // Examples arrived after the tip did, so a report stored without them
        // validates too.
        (s.tipExamples === undefined || Array.isArray(s.tipExamples))
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

// One video's column on a theme, trimmed and capped. Empty points are dropped
// rather than rendered as a blank bullet.
function sidePoints(points: string[] | undefined): string[] {
  return (points ?? [])
    .map((point) => point.trim())
    .filter((point) => point.length > 0)
    .slice(0, MAX_SIDE_POINTS)
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
// The prompt text lives in lib/prompts/defaults/comparison.ts and is
// resolved by the "script_comparison" key at send time, so an override saved in the admin
// Prompts page reaches the next call without a deploy (lib/prompts/resolve.ts).

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

  const instructions = await resolvePrompt("script_comparison")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // Six themes now carry two columns of points each on top of their
      // conclusion and their tip, so the ceiling that fitted the paragraph-only
      // shape would truncate a full report.
      // Up from 3,000: three to six sections, each now carrying three worked
      // examples of its tip on top of its two columns. A truncated response is
      // a failed report.
      max_output_tokens: 5_000,
      input: [
        {
          role: "developer",
          content: [
            { type: "input_text", text: instructions },
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
        const videoA = sidePoints(section.videoA)
        const videoB = sidePoints(section.videoB)
        return {
          heading: section.heading.trim(),
          // Each column is dropped rather than stored empty, for the same
          // reason the tip is: the renderer decides whether to draw the two
          // columns at all on a plain presence check.
          ...(videoA.length > 0 ? { videoA } : {}),
          ...(videoB.length > 0 ? { videoB } : {}),
          ...(section.strongerSide != null
            ? { strongerSide: section.strongerSide }
            : {}),
          body: section.body.trim(),
          // Dropped rather than stored empty, so the renderer's "has a tip"
          // test stays a simple presence check. The examples demonstrate the
          // tip, so they travel with it and go when it goes.
          ...(tip.length > 0
            ? { tip, ...tipExamplesField(section.tipExamples) }
            : {}),
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
