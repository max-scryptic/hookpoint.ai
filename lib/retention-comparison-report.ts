// The written Retention head-to-head: a model-authored comparison of how two
// videos' retention curves actually behaved, and why one of them held. It is
// the same shape as the script head-to-head (a two sentence verdict plus a
// handful of titled sections, each closing on a "Try:" line) and it opens the
// Retention tab above the deterministic curve, hook and stretch cards.
//
// What it is fed, and why: the deterministic diff underneath it can say where
// the two curves separated, but it structurally cannot say why one of them
// held, because that answer lives in the evidence the two videos carry rather
// than in the arithmetic. So the model gets both curves (sampled), the
// checkpoint holds at 25/50/75/100%, the divergence stretch in real seconds on
// both sides, every deeply analysed window with its ranked event evidence, and
// the spoken transcript of the stretch where the gap grew the most, on both
// sides.
//
// Generated once, from the generate endpoint while the creator waits on the
// button, and stored on the video_comparisons row (see the 20260803120000
// migration). The report page only ever reads it back and never calls this, so
// a report is never re-written just because someone opened the page.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any generated
// or literal text in this file. Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import { RETENTION_COMPARISON_REPORT_SCHEMA_VERSION } from "@/lib/comparison-report-versions"
import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import {
  comparisonSampleSize,
  getRetentionComparison,
  watchRatioAt,
  type ComparisonVideo,
  type CurveDivergence,
  type RetentionComparisonData,
} from "@/lib/retention-comparison"
import {
  worstCasePointMargin,
  type ComparisonReliability,
} from "@/lib/retention-sample-size"
import { saveRetentionComparisonReport } from "@/lib/video-comparisons"
import type { RetentionPoint, TranscriptCue } from "@/lib/youtube/youtube"

// The stored shape version lives in lib/comparison-report-versions.ts;
// re-exported here so this module stays the one import for everything about the
// retention report.
export { RETENTION_COMPARISON_REPORT_SCHEMA_VERSION }

// One titled paragraph of the written comparison, plus the one change that
// paragraph argues for. Deliberately short: the tab strip stacks these panels,
// so a long body pushes the later sections off screen.
export interface RetentionComparisonReportSection {
  heading: string
  body: string
  // This section's own "Try:" line, so every section closes on something to do
  // next rather than only stating the difference. Both videos are already
  // published, so it is written as advice for the uploader's next video.
  tip?: string
}

export interface RetentionComparisonReport {
  // A two sentence overall verdict on how the two curves compare.
  summary: string
  // The per-theme body: the opening, the divergence stretch, the endings, the
  // pattern across the drop-offs, and why one curve held.
  sections: RetentionComparisonReportSection[]
  schemaVersion: number
  model: string
  generatedAt: string
}

const MAX_SECTIONS = 5
const MIN_SECTIONS = 3
// The curve, sampled every 5% of runtime, is enough shape for the model to
// describe without handing it hundreds of raw points.
const CURVE_SAMPLES = 20
// Where the checkpoint holds are read, which is also what the deterministic
// table under the report reports.
const CHECKPOINT_RATIOS = [0.25, 0.5, 0.75, 1] as const
// The divergence stretch can be most of a long video, so bound what each side
// contributes of it.
const MAX_DIVERGENCE_TRANSCRIPT_CHARS = 6_000
const MAX_EVENTS_PER_SIDE = 12

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
  sections: RetentionComparisonReportSection[]
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
        (s.tip === undefined || typeof s.tip === "string")
      )
    })
  )
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

// Watch ratios are 0..1 in the data and percentages everywhere a human reads
// them, so they are converted once, here, rather than left for the model to do.
function percent(value: number): number {
  return Math.round(value * 1000) / 10
}

// The curve as the model should see it: share still watching every 5% of the
// way through, with the real clock time of each sample so it can name moments
// in seconds rather than only in percentages.
export function curveSamplesForModel(
  curve: RetentionPoint[],
  durationSeconds: number,
): Array<{ atPercent: number; at: string; stillWatchingPercent: number }> {
  const samples: Array<{
    atPercent: number
    at: string
    stillWatchingPercent: number
  }> = []
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const ratio = i / CURVE_SAMPLES
    const watchRatio = watchRatioAt(curve, ratio)
    if (watchRatio == null) continue
    samples.push({
      atPercent: Math.round(ratio * 100),
      at: formatTimestamp(ratio * durationSeconds),
      stillWatchingPercent: percent(watchRatio),
    })
  }
  return samples
}

// The share still watching at a quarter, half, three quarters and the end. The
// same figures the checkpoint reading under the report is built from, so the
// prose and the numbers on the page cannot disagree.
export function checkpointsForModel(
  curve: RetentionPoint[],
  durationSeconds: number,
): Array<{ atPercent: number; at: string; stillWatchingPercent: number }> {
  return CHECKPOINT_RATIOS.flatMap((ratio) => {
    const watchRatio = watchRatioAt(curve, ratio)
    if (watchRatio == null) return []
    return [
      {
        atPercent: Math.round(ratio * 100),
        at: formatTimestamp(ratio * durationSeconds),
        stillWatchingPercent: percent(watchRatio),
      },
    ]
  })
}

// Every cue that overlaps a stretch of the video, rendered as timestamped lines
// ("[m:ss] text") and clipped to the character budget. Empty when the video has
// no captions or nothing was said across the stretch.
export function transcriptForStretch(
  cues: TranscriptCue[],
  fromSeconds: number,
  toSeconds: number,
): string {
  const lines: string[] = []
  let total = 0
  for (const cue of cues) {
    if (cue.endSeconds < fromSeconds || cue.startSeconds > toSeconds) continue
    const text = cue.text.trim()
    if (!text) continue
    const line = `[${formatTimestamp(cue.startSeconds)}] ${text}`
    if (total + line.length > MAX_DIVERGENCE_TRANSCRIPT_CHARS) break
    lines.push(line)
    total += line.length + 1
  }
  return lines.join("\n")
}

// Where a normalized stretch of the comparison falls on one video's clock. Both
// videos are compared by share of runtime, so the same stretch is a different
// span of seconds on each side, and that is exactly what the creator needs to
// be told.
export function stretchSeconds(
  divergence: CurveDivergence,
  durationSeconds: number,
): { fromSeconds: number; toSeconds: number } {
  return {
    fromSeconds: divergence.fromRatio * durationSeconds,
    toSeconds: divergence.toRatio * durationSeconds,
  }
}

// A compact, model-friendly view of one side: the curve and its checkpoints,
// what the opening held, and every notable stretch with the ranked event
// evidence for it. Windows that were never deeply analysed are still listed,
// flagged, so the model can see the shape of the curve there without being able
// to mistake a silent stretch for one with no evidence against it.
function sideForModel(
  video: ComparisonVideo,
  divergenceTranscript: string,
  divergenceWindow: { from: string; to: string } | null,
) {
  const { summary } = video
  const duration = summary.durationSeconds
  return {
    title: summary.title,
    durationSeconds: duration,
    length: formatTimestamp(duration),
    views: summary.views,
    // How many viewers this curve was estimated from, which is what decides how
    // much weight any level on it can carry. Given separately from `views`
    // because that figure prefers the public counter, over a slightly different
    // period than the curve.
    viewersBehindCurve: comparisonSampleSize(summary),
    averageViewPercentage: summary.averageViewPercentage,
    averageViewDuration:
      summary.averageViewDurationSeconds != null
        ? formatTimestamp(summary.averageViewDurationSeconds)
        : null,
    hook: {
      endsAt:
        video.hook != null ? formatTimestamp(video.hook.toSeconds) : "0:30",
      isFallbackWindow: video.hook == null,
      stillWatchingPercent:
        video.hookHoldRatio != null ? percent(video.hookHoldRatio) : null,
    },
    checkpoints: checkpointsForModel(video.curve, duration),
    curve: curveSamplesForModel(video.curve, duration),
    windows: video.windows.map((window) => ({
      kind: window.kind,
      from: formatTimestamp(window.fromSeconds),
      to: formatTimestamp(window.toSeconds),
      changeInPoints: percent(window.delta),
      belowSimilarVideos:
        window.relativePerformance != null
          ? window.relativePerformance < 0.5
          : null,
      deeplyAnalysed: window.deeplyAnalysed,
      events: window.events.map((event) => ({
        eventType: event.eventType,
        at:
          event.timestampSeconds != null
            ? formatTimestamp(event.timestampSeconds)
            : null,
        narrative: event.narrative,
        primaryEvidence: event.primaryEvidence,
        confidence: event.confidence,
      })),
    })),
    deeplyAnalysedWindowCount: video.deeplyAnalysedWindowCount,
    // What was actually said across the stretch where the gap grew the most,
    // which is the only place the evidence for "why one curve held" lives.
    divergenceStretch: divergenceWindow,
    divergenceTranscript: divergenceTranscript || null,
  }
}

// The stretch where the gap widened, expressed once for the whole comparison:
// in share of runtime, and in real seconds on each side.
function divergenceForModel(
  divergence: CurveDivergence | null,
  a: ComparisonVideo,
  b: ComparisonVideo,
) {
  if (divergence == null) return null
  const inA = stretchSeconds(divergence, a.summary.durationSeconds)
  const inB = stretchSeconds(divergence, b.summary.durationSeconds)
  return {
    widenedFor: divergence.widenedFor === "a" ? "Video A" : "Video B",
    fromPercent: Math.round(divergence.fromRatio * 100),
    toPercent: Math.round(divergence.toRatio * 100),
    inVideoA: `${formatTimestamp(inA.fromSeconds)} to ${formatTimestamp(inA.toSeconds)}`,
    inVideoB: `${formatTimestamp(inB.fromSeconds)} to ${formatTimestamp(inB.toSeconds)}`,
    gapChangeInPoints: percent(divergence.gapChange),
    // The gap change already cleared this margin, or the divergence would have
    // been withheld. Supplied so the report can size the difference honestly
    // rather than treat every reported divergence as equally solid.
    gapChangeMarginInPoints:
      divergence.gapChangeMargin != null
        ? percent(divergence.gapChangeMargin)
        : null,
    videoAWentFromPercent: percent(divergence.aFromRatio),
    videoAWentToPercent: percent(divergence.aToRatio),
    videoBWentFromPercent: percent(divergence.bFromRatio),
    videoBWentToPercent: percent(divergence.bToRatio),
  }
}

// A margin in watch-ratio points as a percentage, or null when it could not be
// computed because the view count is unknown.
function marginPercent(margin: number | null): number | null {
  return margin != null ? percent(margin) : null
}

// How far the pair may be pushed, decided server-side and handed to the model
// as a verdict rather than as raw inputs. The model cannot do the arithmetic
// that separates a real retention difference from sampling noise, so it is
// never asked to: the statistics are settled in lib/retention-sample-size.ts
// and arrive here already resolved.
function reliabilityForModel(reliability: ComparisonReliability) {
  return {
    comparable: reliability.comparable,
    caveats: reliability.caveats,
    videoAViewers: reliability.sampleSizeA,
    videoBViewers: reliability.sampleSizeB,
    // The widest margin any single share on each curve can carry. Two figures
    // closer together than this are the same figure.
    videoAPointMarginInPoints: marginPercent(
      worstCasePointMargin(reliability.sampleSizeA),
    ),
    videoBPointMarginInPoints: marginPercent(
      worstCasePointMargin(reliability.sampleSizeB),
    ),
    endingGapInPoints:
      reliability.endingGap != null ? percent(reliability.endingGap) : null,
    endingGapMarginInPoints:
      reliability.endingGapMargin != null
        ? percent(reliability.endingGapMargin)
        : null,
    endingGapIsSignificant: reliability.endingGapIsSignificant,
  }
}

// The whole comparison as the model receives it. Exported so a test can assert
// what the prompt is actually grounded in without a network call.
export function retentionComparisonForModel(
  data: RetentionComparisonData,
  transcriptA: TranscriptCue[],
  transcriptB: TranscriptCue[],
) {
  const divergence = data.divergence
  const stretchFor = (video: ComparisonVideo, cues: TranscriptCue[]) => {
    if (divergence == null) return { window: null, transcript: "" }
    const { fromSeconds, toSeconds } = stretchSeconds(
      divergence,
      video.summary.durationSeconds,
    )
    return {
      window: {
        from: formatTimestamp(fromSeconds),
        to: formatTimestamp(toSeconds),
      },
      transcript: transcriptForStretch(cues, fromSeconds, toSeconds),
    }
  }

  const inA = stretchFor(data.a, transcriptA)
  const inB = stretchFor(data.b, transcriptB)

  return {
    reliability: reliabilityForModel(data.reliability),
    divergence: divergenceForModel(divergence, data.a, data.b),
    videoA: sideForModel(data.a, inA.transcript, inA.window),
    videoB: sideForModel(data.b, inB.transcript, inB.window),
  }
}

// The prompt text lives in lib/prompts/defaults/comparison.ts and is
// resolved by the "retention_comparison" key at send time, so an override saved in the admin
// Prompts page reaches the next call without a deploy (lib/prompts/resolve.ts).

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

// True when a side carries enough curve for the comparison to say anything at
// all. Windows and transcripts are enrichment; the curve is the spine.
function hasCurve(video: ComparisonVideo): boolean {
  return video.curve.length > 0
}

// Trims and caps the validated model output into the stored shape. Exported so
// tests can exercise the normalisation without a network call.
export function normalizeRetentionComparisonReport(
  parsed: ModelReportOutput,
  model: string,
): RetentionComparisonReport {
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
    schemaVersion: RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
    model,
    generatedAt: new Date().toISOString(),
  }
}

// Writes the retention head-to-head from both curves, both window sets and the
// transcript of the stretch where they separated. Returns null (without calling
// OpenAI) when neither video has a curve to read, so the caller can leave the
// report unset and the tab falls back to the deterministic cards alone. Callers
// own persistence.
export async function generateRetentionComparisonReport(
  data: RetentionComparisonData,
  transcriptA: TranscriptCue[],
  transcriptB: TranscriptCue[],
  logContext?: LlmLogContext,
): Promise<RetentionComparisonReport | null> {
  if (!hasCurve(data.a) && !hasCurve(data.b)) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model =
    process.env.OPENAI_RETENTION_COMPARISON_MODEL ??
    process.env.OPENAI_SCRIPT_COMPARISON_MODEL ??
    "gpt-4.1-mini"

  const payload = retentionComparisonForModel(data, transcriptA, transcriptB)
  // The ranked events are already capped per window by the comparison builder;
  // this is the backstop for a video carrying a great many windows.
  for (const side of [payload.videoA, payload.videoB]) {
    let budget = MAX_EVENTS_PER_SIDE
    for (const window of side.windows) {
      window.events = window.events.slice(0, Math.max(0, budget))
      budget -= window.events.length
    }
  }

  const instructions = await resolvePrompt("retention_comparison")

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
          content: [{ type: "input_text", text: instructions }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(payload) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "retention_comparison_report",
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
      `OpenAI retention comparison failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no retention comparison text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isModelReportOutput(parsed)) {
    throw new Error("OpenAI returned an invalid retention comparison report")
  }

  if (logContext) {
    await recordLlmCallCost(
      "retention_comparison",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  return normalizeRetentionComparisonReport(parsed, model)
}

// ---------------------------------------------------------------------------
// Orchestration

// Builds the same comparison the Retention tab renders, pulls both transcripts
// for the divergence stretch, writes the head-to-head and stores it. Returns
// the report, or null when it could not be generated (no curves, or the pair's
// videos are missing / not owned by the user). The transcripts are best-effort:
// a video with no captions simply contributes no spoken evidence.
export async function buildAndStoreRetentionComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  videoAId: string,
  videoBId: string,
  logContext?: LlmLogContext,
): Promise<RetentionComparisonReport | null> {
  const [data, transcripts] = await Promise.all([
    getRetentionComparison(supabase, userId, videoAId, videoBId),
    supabase
      .from("analysed_videos")
      .select("id, transcript")
      .eq("user_id", userId)
      .in("id", [videoAId, videoBId]),
  ])
  if (data == null) return null

  if (transcripts.error) {
    // Spoken evidence narrows the report rather than blocking it, so a failed
    // transcript read is logged and the comparison is written without it.
    console.error(
      "Failed to load transcripts for retention comparison",
      transcripts.error,
    )
  }

  const rows = (transcripts.data ?? []) as Array<{
    id: string
    transcript: TranscriptCue[] | null
  }>
  const transcriptFor = (id: string): TranscriptCue[] =>
    rows.find((row) => row.id === id)?.transcript ?? []

  const report = await generateRetentionComparisonReport(
    data,
    transcriptFor(videoAId),
    transcriptFor(videoBId),
    logContext,
  )
  if (report == null) return null

  await saveRetentionComparisonReport(supabase, userId, comparisonId, report)
  return report
}
