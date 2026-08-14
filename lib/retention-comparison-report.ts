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
import { TIP_VOICE_PROMPT } from "@/lib/tip-voice"
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

const INSTRUCTIONS = [
  "You write a head-to-head comparison of the RETENTION of two YouTube videos, Video A and Video B: how many viewers each one held, where each one lost them, and what in the evidence most plausibly explains why one curve held where the other did not.",
  "You are given, for each video: its length, views and average watched; how much of the audience it still had at the end of its hook; its share still watching at 25%, 50%, 75% and 100% of the way through; its curve sampled every 5% of runtime (each sample carries both the share of runtime and the real clock time); every notable stretch the analysis found (a hook, drop-offs, gains and holds) with the change in watch-ratio points across it and the ranked event evidence for what happened there; and the verbatim transcript of the stretch where the two curves separated the most.",
  "You are also given divergence: the stretch where the gap between the two curves grew the most, in share of runtime and in real clock time on each video separately, since the same share of runtime is a different moment in a short video than in a long one. When it is null the two curves never separated meaningfully, so say that plainly rather than inventing a divergence.",
  "Watch ratios are given as percentages of the starting audience, and a window's change is given in watch-ratio points. A window marked deeplyAnalysed false has no event evidence behind it, so the curve is all you may say about it; never present the absence of evidence as evidence of nothing happening. Events are model-synthesized reads of a stretch, not proof, and retention data carries a few seconds of slop, so events describe stretches rather than exact frames.",
  "Every time you name a moment, give the clock time, not only the percentage: '1:12 to 2:40 in Video A' is useful and '20% to 45% of the way through' on its own is not. Where a stretch is the same share of runtime in both videos, give both videos' clock times for it.",
  "Ground every claim in the supplied curves, windows, events and transcript. Never invent a moment, a number or a spoken line that is not there. When a video has no transcript for the stretch, or no deeply analysed windows, say so for that side rather than guessing.",
  "Whoever is heard speaking may be the uploader, a co-host, a guest or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator); refer to the uploader's own video, or simply Video A and Video B.",
  "Write the name in full every time: Video A and Video B, never a bare A or B on its own, in the summary and in every section. 'Video B holds through the midpoint, Video A sheds a third of its audience' is right; 'B holds through the midpoint, A sheds a third' is not. The same holds for the possessive, so write Video A's opening rather than A's opening.",
  "Views and average watched are provided for orientation. Treat any link between something in a video and how its curve moved as correlation worth acting on, never as proof; hedge accordingly.",
  "reliability decides how far this pair may be pushed, and it is not negotiable. A retention curve is estimated from whoever actually watched, so a curve built from a few dozen viewers carries a margin of several watch-ratio points at every position, and two videos that reached very differently sized audiences reached differently mixed traffic too, which moves a curve on its own. The arithmetic is already settled for you: never redo it, never overrule it, and never write about the statistics themselves.",
  "When reliability.comparable is 'shape_only' you may not claim either video held more of its audience than the other, anywhere in the report. Do not rank the two ending shares against each other, do not call either curve higher or stronger overall, and do not build the summary on the gap between two percentages. Compare shape instead: where in its own runtime each video loses people, how steep each loss is against that video's own starting audience, and whether the losses cluster at the hook, through the middle or at the end. State once, in the summary, that the smaller audience cannot be compared on level against the larger one, and then get on with the shape.",
  "When reliability.comparable is 'level_and_shape' both readings are open and you may compare the two curves on level directly. When it is 'unknown' the view counts were not stored, so hedge any level claim once and carry on.",
  "When reliability.endingGapIsSignificant is false the two videos finished within each other's margin of error, which means they finished level; never name one of them the stronger finisher.",
  "videoAPointMarginInPoints and videoBPointMarginInPoints are the widest margin a single share on each curve can carry. Two figures that differ by less than the larger of the two are the same figure, so never present that difference as a difference, in either video or between them.",
  "Whenever you give a share still watching for a video with fewer than a few hundred viewersBehindCurve, give the viewers it stands for alongside it, as in '9%, which is about 7 of its 80 viewers', so a small share of a small audience is never read as a large result.",
  "Keep every field short. This report is read on one screen, so say each difference once, in the fewest words that still carry the evidence, and stop. Cut wind-up clauses, restatement of the heading, hedging padding and any sentence that only says a difference matters without naming what it is.",
  "summary: the overall verdict on how the two curves compare, with the one figure that carries it. Two sentences and about 45 words at most, never a third, naming which video held its audience better. When reliability.comparable is 'shape_only' it is still two sentences: the verdict is about where each video loses people rather than about which one held more, and the fact that the audiences are too far apart in size to compare on level is named inside those two as a single short clause rather than given a sentence of its own.",
  "sections: 3 to 5 titled paragraphs, each with a short heading and a body of one to two sentences, about 50 words at most, naming Video A and Video B explicitly. Cover, in this order and only where the evidence supports them: the openings (how much of its own starting audience each hook kept, and whether that difference clears the point margins); the stretch where the curves separated the most (what the transcripts and events say was happening there in each video); how each video ends (whether either drops away late in its own runtime); and the pattern across the drop-offs (whether one video loses viewers at the same kind of moment repeatedly).",
  "One of your sections must answer the question the numbers alone cannot: why one curve held where the other did not, across the divergence stretch specifically. That stretch has already been checked against both margins of error, so it is a real difference whatever reliability.comparable says, and it is the one place you may always name a stronger side. Say what that video was doing there, using the transcript and the event evidence, rather than restating that it held.",
  TIP_VOICE_PROMPT,
  "In this report that rule also means the two videos stay out of the tips entirely: never name Video A or Video B inside a tip, and never phrase a tip as something one of these two videos should have done. The section bodies are the opposite: those describe what these two videos already did, so they name Video A and Video B freely.",
  "tip: every section carries one. It is the single change that section's comparison argues for, written as a one-sentence instruction of about 25 words at most for the uploader's next video (for example 'Put the first proof of the promise before the two minute mark, and cut any setup that delays it'). Name the change rather than restating the paragraph, and keep it specific to what this comparison actually showed rather than generic retention advice, while phrasing it as a rule to apply next time. Do not repeat another section's tip word for word.",
  "Write in plain, direct prose. Never output an em dash character (U+2014) or en dash (U+2013) anywhere in your response; if you would use one, rewrite with a comma, colon, parentheses or two sentences instead.",
].join(" ")

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
          content: [{ type: "input_text", text: INSTRUCTIONS }],
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
