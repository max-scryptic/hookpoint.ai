// The written Packaging head-to-head: a model-authored explanation of WHY one
// of two videos out-performed the other on packaging alone. This is the point
// of the whole video-to-video comparison feature, so it is fed the real
// surfaces rather than only their scores:
//
//   - both thumbnails, as actual images (packaging craft has to be seen),
//   - both titles, verbatim,
//   - the full stored evidence for each video's first ten seconds
//     (lib/packaging-comparison-evidence.ts): the spoken opening and its
//     structured read, the already-described frames with their OCR text, the
//     editing metrics against the video's own baseline, the deterministic
//     acoustics, the synthesized retention events, and how the opening's
//     retention actually behaved,
//   - each video's stored packaging taxonomy, as the scored context the
//     deterministic tables below the report are built from,
//   - and views, as the only performance anchor.
//
// The paid audio read is excluded on purpose; see the evidence module's header.
//
// Unlike lib/packaging-comparison.ts (a pure diff of two stored taxonomies with
// no model call at view time), this is one vision call. It is made once, from
// the generate endpoint while the creator waits on the button, and stored on the
// video_comparisons row; the report page only ever reads it back. Nothing on the
// report page calls this, so a report is never re-written just because someone
// opened the page or switched to the Packaging tab.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any generated
// or literal text in this file. Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import { PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION } from "@/lib/comparison-report-versions"
import { recordLlmCallCost, type LlmLogContext } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { getOrGeneratePackagingAlignment } from "@/lib/packaging-alignments"
import {
  emptyHookEvidence,
  hasHookEvidence,
  loadPackagingHookEvidence,
  type PackagingHookEvidence,
} from "@/lib/packaging-comparison-evidence"
import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import { TIP_VOICE_PROMPT } from "@/lib/tip-voice"
import { savePackagingComparisonReport } from "@/lib/video-comparisons"
import {
  preferredViewCount,
  type TranscriptCue,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// The stored shape version, and its history, live in
// lib/comparison-report-versions.ts; re-exported here so this module stays the
// one import for everything about the packaging report.
export { PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION }

export const PACKAGING_REPORT_SURFACES = [
  "thumbnail",
  "title",
  "hook",
  "alignment",
] as const
export type PackagingReportSurface = (typeof PACKAGING_REPORT_SURFACES)[number]

export const PACKAGING_REPORT_SURFACE_LABEL: Record<
  PackagingReportSurface,
  string
> = {
  thumbnail: "Thumbnail",
  title: "Title",
  hook: "First 10 seconds",
  alignment: "How the three fit together",
}

// The short form, for the tab strip on the report where four labels have to sit
// on one row.
export const PACKAGING_REPORT_SURFACE_TAB_LABEL: Record<
  PackagingReportSurface,
  string
> = {
  thumbnail: "Thumbnail",
  title: "Title",
  hook: "Hook",
  alignment: "Alignment",
}

export type ReportSide = "a" | "b"

// Which video the packaging favours overall, and the headline reason.
export interface PackagingReportVerdict {
  strongerSide: ReportSide | "neither"
  summary: string
  confidence: number
}

// One surface, read on both videos and judged.
export interface PackagingReportSurfaceRead {
  surface: PackagingReportSurface
  strongerSide: ReportSide | "neither"
  aRead: string
  bRead: string
  whyItMatters: string
  // This surface's own "Try:" line, so every tab of the report closes on
  // something to do next rather than only the tabs the drivers happened to land
  // on. Written under the same forward-looking rules as a driver tip, and shown
  // only when no driver on this surface carried one. Optional only because
  // reports stored before schema version 5 predate it; the model always writes
  // one now.
  tip?: string
}

// One ranked reason the stronger video is stronger.
export interface PackagingReportDriver {
  label: string
  surface: PackagingReportSurface
  favours: ReportSide
  detail: string
  // Pointers back to the real inputs: a verbatim title, thumbnail text, a
  // frame at 0:04, a cuts-per-minute figure.
  evidence: string[]
  // The one change this driver's evidence argues for, rendered as the blue
  // "Try:" line under the driver. Both videos are already published, so this is
  // written as advice for the next video rather than as a fix to either of
  // them. Optional only because reports stored before schema version 2 predate
  // it; the model always writes one now.
  tip?: string
  confidence: number
}

// Something to try on the next upload. Rendered as an "Or:" line under the
// driver tips for the same surface, so it reads as one more thing to try rather
// than as a list of its own.
export interface PackagingReportRecommendation {
  surface: PackagingReportSurface
  // Which of the two videos the change was for, on reports stored before schema
  // version 3. Recommendations are now always advice for the next video, so
  // nothing writes this and nothing renders it.
  target?: ReportSide | "both"
  action: string
  rationale: string
  effort: "quick" | "rework"
}

export interface PackagingComparisonReport {
  verdict: PackagingReportVerdict
  surfaces: PackagingReportSurfaceRead[]
  drivers: PackagingReportDriver[]
  recommendations: PackagingReportRecommendation[]
  // The honest limits the model used to write out, on reports stored before
  // schema version 4. Nothing writes this and nothing renders it.
  caveats?: string[]
  schemaVersion: number
  model: string
  generatedAt: string
}

// One video's inputs to the report.
export interface PackagingComparisonReportSide {
  title: string | null
  thumbnailUrl: string | null
  views: number | null
  packagingTaxonomy: PackagingTaxonomy | null
  hook: PackagingHookEvidence
}

const MAX_SURFACES = 4
const MAX_DRIVERS = 6
const MIN_DRIVERS = 1
const MAX_RECOMMENDATIONS = 6
const MIN_RECOMMENDATIONS = 1
const MAX_EVIDENCE_PER_DRIVER = 4
// Enough to cover a ten second window even on a heavily cut opening; the
// dedupe in the evidence loader already collapses unchanged shots.
const MAX_VISUAL_FRAMES = 10
const MAX_HOOK_EVENTS = 3
// The spoken opening is ten seconds long, so this only guards against a
// pathological caption dump.
const MAX_HOOK_TRANSCRIPT_CHARS = 2_000

const surfaceEnum = [...PACKAGING_REPORT_SURFACES]

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "surfaces", "drivers", "recommendations"],
  properties: {
    verdict: {
      type: "object",
      additionalProperties: false,
      required: ["strongerSide", "summary", "confidence"],
      properties: {
        strongerSide: { type: "string", enum: ["a", "b", "neither"] },
        summary: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    surfaces: {
      type: "array",
      minItems: 1,
      maxItems: MAX_SURFACES,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "surface",
          "strongerSide",
          "aRead",
          "bRead",
          "whyItMatters",
          "tip",
        ],
        properties: {
          surface: { type: "string", enum: surfaceEnum },
          strongerSide: { type: "string", enum: ["a", "b", "neither"] },
          aRead: { type: "string" },
          bRead: { type: "string" },
          whyItMatters: { type: "string" },
          tip: { type: "string" },
        },
      },
    },
    drivers: {
      type: "array",
      minItems: MIN_DRIVERS,
      maxItems: MAX_DRIVERS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "surface",
          "favours",
          "detail",
          "evidence",
          "tip",
          "confidence",
        ],
        properties: {
          label: { type: "string" },
          surface: { type: "string", enum: surfaceEnum },
          favours: { type: "string", enum: ["a", "b"] },
          detail: { type: "string" },
          evidence: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_EVIDENCE_PER_DRIVER,
          },
          tip: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    recommendations: {
      type: "array",
      minItems: MIN_RECOMMENDATIONS,
      maxItems: MAX_RECOMMENDATIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["surface", "addsBeyondTip", "action", "rationale", "effort"],
        properties: {
          surface: { type: "string", enum: surfaceEnum },
          // Written before the action, since the model fills these keys in the
          // order they are declared: having to name what this adds to the tip
          // for the same surface is what stops the action being that tip
          // reworded. Never stored, so it costs the reader nothing.
          addsBeyondTip: { type: "string" },
          action: { type: "string" },
          rationale: { type: "string" },
          effort: { type: "string", enum: ["quick", "rework"] },
        },
      },
    },
  },
} as const

const INSTRUCTIONS = [
  "You compare the PACKAGING of two YouTube videos, Video A and Video B, and explain why one of them plausibly out-performed the other. Packaging means the thumbnail, the title, the first ten seconds, and how tightly those three promise the same thing. Everything after the first ten seconds is out of scope.",
  "You are given, for each video: its verbatim title; its thumbnail as an image (Video A's image is supplied first, then Video B's, each labelled); its view count; its stored packaging read (a fixed taxonomy scored on that video alone at analysis time, with 0-10 axes and short verbatim spans); and hook, the full stored evidence for its first ten seconds.",
  "hook contains: retention (how the opening's watch ratio actually moved), transcript (the spoken opening, verbatim), transcriptTaxonomy (a structured read of those words), visual (frames already described by a vision pass, each with a timestamp, its deterministic OCR text as ground truth, and scored axes such as faceProminence, colorContrast, visualComplexity, textProminence, shotScale and motion), editing (cut count, cuts per minute, freeze and black coverage across the opening), audio (measured speech rate in words per minute, silence coverage and mean loudness; no listener judgement of tone), events (retention events already synthesized for this opening) and baseline (this video's own full-video averages). Judge editing, pacing and speech rate as deviations from that baseline, not in absolute terms.",
  "higherViewsSide names the video with more views, computed for you; do not do that arithmetic yourself. When it is null, views are unknown or tied, so compare which packaging reads stronger and say plainly that there is no performance anchor.",
  "Ground every claim in what you can actually see in the thumbnails or read in the supplied evidence. Never invent frame content, spoken lines, thumbnail text or numbers that were not given. When a video's evidence is missing (no frames, no transcript, no packaging read), say so for that side rather than guessing, and lean on what is present.",
  "Whoever is heard speaking may be the uploader, a co-host, a guest or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator). Address the uploader as you, about their own videos, and name the videos as Video A and Video B.",
  "Write the name in full every time: Video A and Video B, never a bare A or B on its own, in any sentence and any field. 'Video B makes the promise legible, Video A leads with a face' is right; 'B makes the promise legible, A leads with a face' is not. The same holds for the possessive, so write Video A's thumbnail rather than A's thumbnail.",
  "Views are one number about two videos, so treat every link between a packaging trait and performance as correlation worth acting on, never as proof. Thumbnails and titles are judged on click appeal, the opening ten seconds on whether it holds the promise those two made.",
  "verdict: strongerSide is the video whose packaging is the stronger play (or neither when they are genuinely close), summary is two to three sentences on why, and confidence is 0 to 1 in how strongly the evidence supports that verdict. Lower it when the two are close, when evidence is thin on one side, or when views are unknown.",
  "surfaces: one entry for each of thumbnail, title, hook and alignment that you have evidence for. aRead and bRead describe what that video's surface actually does, concretely (what is in the frame, what the title claims, what the opening says and shows). whyItMatters explains in one or two sentences why that difference would move clicks or hold the opening. Use surface 'alignment' for whether the title, thumbnail and opening promise one thing or pull apart.",
  "drivers: the ranked reasons the stronger video is stronger, most important first, one to six of them. label is a short phrase (for example 'Thumbnail is doing three things at once'). detail is one or two sentences. evidence is up to four short pointers back to the supplied inputs, quoting the real thing where possible (a verbatim title fragment, the thumbnail's overlaid words, 'frame at 0:04 is a wide shot with no face', 'one cut in the first ten seconds versus eleven per minute across the video'). Only emit a driver where the evidence genuinely supports it.",
  `Both the tips and the recommendations in this report are advice, so both are written under the rules that follow. ${TIP_VOICE_PROMPT}`,
  "In this report those rules also mean the two videos stay out of the advice entirely: never name Video A or Video B inside a tip or a recommendation, and never phrase advice as something one of these two videos should have done (for example 'Show the payoff itself in the first three seconds, not only in the title and thumbnail'). Your reads, drivers and evidence are the opposite: those describe what these two videos already did, so they name Video A and Video B freely.",
  "tip: every driver is a comparison you have evidence for, so every driver carries one. It is the single change that driver's evidence argues for, written as a one-sentence instruction for the uploader's next video (for example 'Cut the thumbnail to one subject and one line of text, sized to read at phone width'). Name the change rather than restating detail, and keep it specific to what this comparison actually showed rather than generic packaging advice, while phrasing it as a rule to apply next time.",
  "Every entry in surfaces carries a tip of its own as well, written under exactly those same rules: the single change that surface's comparison argues for, in one sentence, for the uploader's next video. Write one for every surface you cover, including the surfaces your drivers already speak to. The interface shows it only when no driver landed on that surface, so it has to stand on its own rather than continue a driver, and it must not repeat a driver tip for the same surface, in the same words or in different ones.",
  "recommendations: up to six further things to try on the next upload, ordered by expected payoff. Each is filed under the surface it changes, and the interface renders it as an 'Or:' line directly beneath that surface's tip, where the reader sees the two lines one under the other. addsBeyondTip is written first for that reason: before you write the action, say in a few words what this change adds that the tip for its surface, and any recommendation you have already written for that surface, did not already ask for. The same change in other words does not count, and neither does the same change at a different level of detail: 'State the payoff in the first sentence, then move into the proof' and 'Put the exact promised result in the first sentence, then spend the next line proving it' are one recommendation written twice, and a reader sees a page repeating itself. If you cannot name what a recommendation adds, you do not have one: leave it out. One recommendation that says something new beats six that circle the tips, so returning a single recommendation, or one for only some of the surfaces, is the right answer more often than not. addsBeyondTip is a check on your own writing and is never shown to anyone, so keep it blunt and do not write advice in it. action is the concrete change, phrased as a one-sentence instruction for the next video under exactly the same rules as tip, written to stand on its own and not beginning with 'Try' or 'Or'. rationale ties it back to what this comparison showed and may name the videos, since it is not shown as advice. effort is 'quick' for something settled while writing a title or building a thumbnail and 'rework' for anything needing a different shoot or edit.",
  "Write in plain, direct prose with no marketing filler. Never output an em dash character (U+2014) or en dash (U+2013) anywhere in your response; if you would use one, rewrite with a comma, colon, parentheses or two sentences instead.",
].join(" ")

interface ModelReportOutput {
  verdict: PackagingReportVerdict
  surfaces: PackagingReportSurfaceRead[]
  drivers: PackagingReportDriver[]
  // The model writes one more field per recommendation than the stored shape
  // keeps: addsBeyondTip is a guardrail against the same advice being written
  // twice, and normalisation drops it.
  recommendations: (PackagingReportRecommendation & {
    addsBeyondTip?: string
  })[]
}

function isSide(value: unknown): value is ReportSide {
  return value === "a" || value === "b"
}

function isSideOrNeither(value: unknown): value is ReportSide | "neither" {
  return isSide(value) || value === "neither"
}

function isSurface(value: unknown): value is PackagingReportSurface {
  return (
    typeof value === "string" &&
    (PACKAGING_REPORT_SURFACES as readonly string[]).includes(value)
  )
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export function isPackagingComparisonReportOutput(
  value: unknown,
): value is ModelReportOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>

  const verdict = candidate.verdict as Record<string, unknown> | undefined
  if (
    !verdict ||
    typeof verdict !== "object" ||
    !isSideOrNeither(verdict.strongerSide) ||
    typeof verdict.summary !== "string" ||
    !isUnitNumber(verdict.confidence)
  ) {
    return false
  }

  if (
    !Array.isArray(candidate.surfaces) ||
    !candidate.surfaces.every((surface) => {
      if (!surface || typeof surface !== "object") return false
      const s = surface as Record<string, unknown>
      return (
        isSurface(s.surface) &&
        isSideOrNeither(s.strongerSide) &&
        typeof s.aRead === "string" &&
        typeof s.bRead === "string" &&
        typeof s.whyItMatters === "string" &&
        // Optional so a report stored before schema version 5, when a surface
        // carried no tip of its own, still validates if it is ever fed back
        // through here.
        (s.tip === undefined || typeof s.tip === "string")
      )
    })
  ) {
    return false
  }

  if (
    !Array.isArray(candidate.drivers) ||
    !candidate.drivers.every((driver) => {
      if (!driver || typeof driver !== "object") return false
      const d = driver as Record<string, unknown>
      return (
        typeof d.label === "string" &&
        isSurface(d.surface) &&
        isSide(d.favours) &&
        typeof d.detail === "string" &&
        isStringArray(d.evidence) &&
        // Optional so a report stored before schema version 2 still validates
        // if it is ever fed back through here.
        (d.tip === undefined || typeof d.tip === "string") &&
        isUnitNumber(d.confidence)
      )
    })
  ) {
    return false
  }

  if (
    !Array.isArray(candidate.recommendations) ||
    !candidate.recommendations.every((recommendation) => {
      if (!recommendation || typeof recommendation !== "object") return false
      const r = recommendation as Record<string, unknown>
      return (
        isSurface(r.surface) &&
        // Optional so a report stored before schema version 3, when a
        // recommendation still named the video it was for, still validates if
        // it is ever fed back through here.
        (r.target === undefined || isSide(r.target) || r.target === "both") &&
        // Optional so a stored report, which never carries the guardrail
        // field, still validates if it is ever fed back through here.
        (r.addsBeyondTip === undefined || typeof r.addsBeyondTip === "string") &&
        typeof r.action === "string" &&
        typeof r.rationale === "string" &&
        (r.effort === "quick" || r.effort === "rework")
      )
    })
  ) {
    return false
  }

  return true
}

// The side with more views, or null when views are unknown or tied. Computed
// here so the model is handed the answer rather than asked to derive it.
export function higherViewsSide(
  a: Pick<PackagingComparisonReportSide, "views">,
  b: Pick<PackagingComparisonReportSide, "views">,
): ReportSide | null {
  if (a.views == null || b.views == null || a.views === b.views) return null
  return a.views > b.views ? "a" : "b"
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

// A compact, model-friendly view of one side. The taxonomy and the transcript
// taxonomy pass through as-is (both are already small structured objects); the
// frames are trimmed and timestamped so the model can talk about "the frame at
// 0:04" without counting.
export function packagingSideForModel(side: PackagingComparisonReportSide) {
  const { hook } = side
  return {
    title: side.title,
    views: side.views,
    hasThumbnailImage: side.thumbnailUrl != null,
    packaging: side.packagingTaxonomy ?? null,
    hook: {
      retention: hook.retention,
      transcript:
        hook.transcript != null
          ? hook.transcript.slice(0, MAX_HOOK_TRANSCRIPT_CHARS)
          : null,
      transcriptTaxonomy: hook.transcriptTaxonomy,
      visual: hook.visual.slice(0, MAX_VISUAL_FRAMES).map((frame) => ({
        at: formatTimestamp(frame.timestampSeconds),
        timestampSeconds: frame.timestampSeconds,
        ocrText: frame.ocrText,
        analysis: frame.analysis,
      })),
      editing: hook.editing,
      audio: hook.audio,
      events: hook.events.slice(0, MAX_HOOK_EVENTS).map((event) => ({
        at: formatTimestamp(event.timestampSeconds),
        eventType: event.eventType,
        narrative: event.narrative,
        primaryEvidence: event.primaryEvidence,
        confidence: event.confidence,
      })),
      baseline: hook.baseline,
    },
  }
}

// True when a side carries enough for the comparison to say anything at all.
function sideHasSubstance(side: PackagingComparisonReportSide): boolean {
  return (
    side.packagingTaxonomy != null ||
    side.thumbnailUrl != null ||
    hasHookEvidence(side.hook)
  )
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

function packagingComparisonModel(): string {
  return (
    process.env.OPENAI_PACKAGING_COMPARISON_MODEL ??
    process.env.OPENAI_PACKAGING_MODEL ??
    "gpt-5.4-mini"
  )
}

// Reasoning effort is only a valid parameter on the reasoning-model family, so
// it is sent for those and omitted for anything else this is pointed at. Low
// effort matches the snapshot vision call, which reads images under the same
// kind of structured-output contract.
function reasoningFor(model: string): Record<string, unknown> {
  return model.startsWith("gpt-5") ? { reasoning: { effort: "low" } } : {}
}

// Writes the packaging head-to-head from both thumbnails, titles and openings.
// Returns null (without calling OpenAI) when neither video carries anything to
// compare, so the caller can leave the report unset and fall back to the
// deterministic tables alone. Callers own persistence.
export async function generatePackagingComparisonReport(
  a: PackagingComparisonReportSide,
  b: PackagingComparisonReportSide,
  logContext?: LlmLogContext,
): Promise<PackagingComparisonReport | null> {
  if (!sideHasSubstance(a) && !sideHasSubstance(b)) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = packagingComparisonModel()

  // The thumbnails ride alongside the JSON as real images, each announced by a
  // label so the model never has to guess which side it is looking at.
  const thumbnailContent: Array<Record<string, unknown>> = []
  for (const [side, input] of [
    ["A", a],
    ["B", b],
  ] as const) {
    if (!input.thumbnailUrl) continue
    thumbnailContent.push({
      type: "input_text",
      text: `Thumbnail of Video ${side}:`,
    })
    thumbnailContent.push({
      type: "input_image",
      image_url: input.thumbnailUrl,
    })
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...reasoningFor(model),
      max_output_tokens: 4_000,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: INSTRUCTIONS }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                higherViewsSide: higherViewsSide(a, b),
                videoA: packagingSideForModel(a),
                videoB: packagingSideForModel(b),
              }),
            },
            ...thumbnailContent,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "packaging_comparison_report",
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
      `OpenAI packaging comparison failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no packaging comparison text")

  const parsed: unknown = JSON.parse(outputText)
  if (!isPackagingComparisonReportOutput(parsed)) {
    throw new Error("OpenAI returned an invalid packaging comparison report")
  }

  if (logContext) {
    await recordLlmCallCost(
      "packaging_comparison",
      responsesCallCost(model, json.usage),
      logContext,
    )
  }

  return normalizePackagingComparisonReport(parsed, model)
}

// Trims, clamps and caps the validated model output into the stored shape.
// Exported so tests can exercise the normalisation without a network call.
export function normalizePackagingComparisonReport(
  parsed: ModelReportOutput,
  model: string,
): PackagingComparisonReport {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return {
    verdict: {
      strongerSide: parsed.verdict.strongerSide,
      summary: parsed.verdict.summary.trim(),
      confidence: clamp(parsed.verdict.confidence),
    },
    surfaces: parsed.surfaces
      .map((surface) => {
        const tip = surface.tip?.trim() ?? ""
        return {
          surface: surface.surface,
          strongerSide: surface.strongerSide,
          aRead: surface.aRead.trim(),
          bRead: surface.bRead.trim(),
          whyItMatters: surface.whyItMatters.trim(),
          // Dropped rather than stored empty, so the renderer's "has a tip"
          // test is a plain presence check.
          ...(tip.length > 0 ? { tip } : {}),
        }
      })
      .filter(
        (surface) =>
          surface.aRead.length > 0 ||
          surface.bRead.length > 0 ||
          surface.whyItMatters.length > 0 ||
          (surface.tip?.length ?? 0) > 0,
      )
      .slice(0, MAX_SURFACES),
    drivers: parsed.drivers
      .map((driver) => ({
        label: driver.label.trim(),
        surface: driver.surface,
        favours: driver.favours,
        detail: driver.detail.trim(),
        evidence: driver.evidence
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, MAX_EVIDENCE_PER_DRIVER),
        // Dropped rather than stored empty, so the renderer's "has a tip" test
        // is a plain presence check.
        ...(driver.tip != null && driver.tip.trim().length > 0
          ? { tip: driver.tip.trim() }
          : {}),
        confidence: clamp(driver.confidence),
      }))
      .filter((driver) => driver.label.length > 0 || driver.detail.length > 0)
      .slice(0, MAX_DRIVERS),
    recommendations: parsed.recommendations
      .map((recommendation) => ({
        surface: recommendation.surface,
        action: recommendation.action.trim(),
        rationale: recommendation.rationale.trim(),
        effort: recommendation.effort,
      }))
      .filter((recommendation) => recommendation.action.length > 0)
      .slice(0, MAX_RECOMMENDATIONS),
    schemaVersion: PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
    model,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Orchestration

interface ComparisonVideoRow {
  id: string
  video_title: string | null
  video_details: VideoDetails | null
  transcript: TranscriptCue[] | null
  analytics_summary: VideoAnalyticsSummary | null
  packaging_taxonomy: PackagingTaxonomy | null
}

// Loads both videos, makes sure each has an up to date packaging taxonomy (so
// the deterministic tables populate even for a video whose detail page was
// never opened), gathers each opening's evidence, then writes and stores the
// report. Returns the report, or null when it could not be generated (nothing
// to compare, or the pair's videos are missing / not owned by the user).
// Best-effort throughout: a per-video taxonomy or evidence failure narrows the
// report rather than blocking it.
export async function buildAndStorePackagingComparisonReport(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  videoAId: string,
  videoBId: string,
  logContext?: LlmLogContext,
): Promise<PackagingComparisonReport | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(
      "id, video_title, video_details, transcript, analytics_summary, packaging_taxonomy:packaging_alignment->taxonomy",
    )
    .eq("user_id", userId)
    .in("id", [videoAId, videoBId])

  if (error) {
    throw new Error(
      `Failed to load videos for packaging comparison: ${error.message}`,
    )
  }

  const rows = (data ?? []) as unknown as ComparisonVideoRow[]
  const rowA = rows.find((row) => row.id === videoAId)
  const rowB = rows.find((row) => row.id === videoBId)
  if (!rowA || !rowB) return null

  // Heal each video's packaging read first: an older row (or one whose
  // analysis page was never opened) otherwise contributes no scored context at
  // all. A failure here just leaves that side's taxonomy as stored.
  const taxonomies = await Promise.all(
    [rowA, rowB].map(async (row) => {
      const details = row.video_details
      if (!details?.thumbnailUrl) return row.packaging_taxonomy
      try {
        const alignment = await getOrGeneratePackagingAlignment(
          supabase,
          userId,
          row.id,
          {
            title: details.title ?? row.video_title ?? "",
            description: details.description ?? "",
            thumbnailUrl: details.thumbnailUrl,
          },
          row.transcript ?? [],
        )
        return alignment?.taxonomy ?? row.packaging_taxonomy
      } catch (taxonomyError) {
        console.error(
          "Failed to backfill packaging taxonomy for comparison",
          taxonomyError,
        )
        return row.packaging_taxonomy
      }
    }),
  )

  const [hookA, hookB] = await Promise.all(
    [rowA, rowB].map((row) =>
      loadPackagingHookEvidence(
        supabase,
        userId,
        row.id,
        row.transcript ?? [],
      ).catch((evidenceError) => {
        console.error(
          "Failed to load hook evidence for packaging comparison",
          evidenceError,
        )
        return emptyHookEvidence()
      }),
    ),
  )

  const toSide = (
    row: ComparisonVideoRow,
    taxonomy: PackagingTaxonomy | null,
    hook: PackagingHookEvidence,
  ): PackagingComparisonReportSide => ({
    title: row.video_title ?? row.video_details?.title ?? null,
    thumbnailUrl: row.video_details?.thumbnailUrl ?? null,
    views: preferredViewCount(row.video_details, row.analytics_summary),
    packagingTaxonomy: taxonomy,
    hook,
  })

  const report = await generatePackagingComparisonReport(
    toSide(rowA, taxonomies[0], hookA),
    toSide(rowB, taxonomies[1], hookB),
    logContext,
  )
  if (report == null) return null

  await savePackagingComparisonReport(supabase, userId, comparisonId, report)
  return report
}
