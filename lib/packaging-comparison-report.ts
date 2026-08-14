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
//   - and a performance anchor, when the pair has earned one.
//
// THAT LAST CLAUSE
//
// This prompt used to be handed higherViewsSide unconditionally, as "the video
// with more views, computed for you", with no test of whether the two view
// counts could carry a verdict at all. Two videos three days apart on 1,100 and
// 73 views produced a confident packaging verdict resting on a 15x view gap,
// and a view gap conflates two things: how good the packaging was, and how
// often YouTube offered it at all. At 73 views there is no way to tell a
// thumbnail nobody clicked from a thumbnail nobody was shown.
//
// So the pair's comparability is settled first
// (lib/comparison-comparability.ts) and this report asks it the click question,
// which is answered from impressions and click-through where the reporting job
// has served them and from views where it has not. Only a pair that can carry
// an anchor gets one; otherwise the view counts are withheld and the report
// judges packaging craft on the thumbnails, titles and openings themselves,
// which is evidence this report has in abundance and never needed a view count
// to read.
//
// Note that this is a different question from the one the Script head-to-head
// asks of the same pair, and the same two videos can answer one and not the
// other. See ComparisonQuestion in the comparability module.
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

import {
  assessPairComparability,
  comparabilityForModel,
  COMPARABILITY_PROMPT,
  isAnchored,
  type PairComparability,
} from "@/lib/comparison-comparability"
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
  type TrafficSource,
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
  // The headline reason, in two sentences at most. Capped again at render time
  // (limitSentences in lib/copy-guardrails.ts), which is what settles the
  // longer verdicts stored before the prompt asked for two.
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

// A second thing to try on the next upload, filed under the surface it
// changes. Every surface now shows one tip and one only, so the model is no
// longer asked for these and no new report carries any. Reports already stored
// with them are still read rather than rewritten: on a report stored before
// schema version 2 there are no tips at all, and the first recommendation for
// a surface is the only advice that surface has.
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
  // Only on reports stored while the model was still asked for a second piece
  // of advice per surface. Nothing writes this now; see the interface above for
  // the one case that still renders it.
  recommendations?: PackagingReportRecommendation[]
  // The honest limits the model used to write out, on reports stored before
  // schema version 4. Nothing writes this and nothing renders it.
  caveats?: string[]
  // What this pair could honestly be compared on when the report was written,
  // stored alongside it so the page can show the reader the same limit the
  // model wrote under. Optional only because reports stored before schema
  // version 7 predate it.
  comparability?: PairComparability
  schemaVersion: number
  model: string
  generatedAt: string
}

// One video's inputs to the report.
export interface PackagingComparisonReportSide {
  title: string | null
  thumbnailUrl: string | null
  views: number | null
  // How often YouTube offered this video and how often that offer was taken.
  // This is the honest click anchor, and the reason the report no longer leans
  // on the raw view gap: a click-through rate is a proportion of impressions,
  // so it separates what the packaging did from how often the packaging was
  // shown, which a view count cannot. Null whenever the asynchronous reporting
  // job has not served them, which is common and simply narrows the verdict.
  impressions: number | null
  impressionClickThroughRate: number | null
  // Both used only to settle what this pair can be compared on; neither is
  // shown to the model. Null and empty are fine, and simply mean the pair falls
  // back to being judged on craft.
  averageViewPercentage: number | null
  trafficSources: TrafficSource[]
  packagingTaxonomy: PackagingTaxonomy | null
  hook: PackagingHookEvidence
}

const MAX_SURFACES = 4
const MAX_DRIVERS = 6
const MIN_DRIVERS = 1
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
  required: ["verdict", "surfaces", "drivers"],
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
  },
} as const

const INSTRUCTIONS = [
  "You compare the PACKAGING of two YouTube videos, Video A and Video B, and explain why one of them plausibly out-performed the other. Packaging means the thumbnail, the title, the first ten seconds, and how tightly those three promise the same thing. Everything after the first ten seconds is out of scope.",
  "You are given, for each video: its verbatim title; its thumbnail as an image (Video A's image is supplied first, then Video B's, each labelled); its view count, but only where the pair has earned a performance anchor and null otherwise (see comparability below); its stored packaging read (a fixed taxonomy scored on that video alone at analysis time, with 0-10 axes and short verbatim spans); and hook, the full stored evidence for its first ten seconds.",
  "hook contains: retention (how the opening's watch ratio actually moved), transcript (the spoken opening, verbatim), transcriptTaxonomy (a structured read of those words), visual (frames already described by a vision pass, each with a timestamp, its deterministic OCR text as ground truth, and scored axes such as faceProminence, colorContrast, visualComplexity, textProminence, shotScale and motion), editing (cut count, cuts per minute, freeze and black coverage across the opening), audio (measured speech rate in words per minute, silence coverage and mean loudness; no listener judgement of tone), events (retention events already synthesized for this opening) and baseline (this video's own full-video averages). Judge editing, pacing and speech rate as deviations from that baseline, not in absolute terms.",
  COMPARABILITY_PROMPT,
  "The question this report asks of comparability is whether one of the two earned the click better, which is not the same question as whether one held its audience better and does not always have the same answer. In the anchored case you are given higherViewsSide, naming the video with more views, computed for you, and where impressions were available a click-through percentage for each side; do not do that arithmetic yourself. In every other case higherViewsSide is null and no view count reaches you at all, so judge which packaging reads stronger from the thumbnails, the titles and the openings themselves and say plainly, once, that there is no performance anchor behind it. That is not a weaker report: a thumbnail that buries its subject, a title that promises nothing specific and an opening that abandons what the two of them set up are all visible without knowing how either video did.",
  "Ground every claim in what you can actually see in the thumbnails or read in the supplied evidence. Never invent frame content, spoken lines, thumbnail text or numbers that were not given. When a video's evidence is missing (no frames, no transcript, no packaging read), say so for that side rather than guessing, and lean on what is present.",
  "Whoever is heard speaking may be the uploader, a co-host, a guest or a voiceover, so never pin what is said on a specific or gendered person (he, she, the creator). Address the uploader as you, about their own videos, and name the videos as Video A and Video B.",
  "Write the name in full every time: Video A and Video B, never a bare A or B on its own, in any sentence and any field. 'Video B makes the promise legible, Video A leads with a face' is right; 'B makes the promise legible, A leads with a face' is not. The same holds for the possessive, so write Video A's thumbnail rather than A's thumbnail.",
  "Views are one number about two videos, so treat every link between a packaging trait and performance as correlation worth acting on, never as proof. Thumbnails and titles are judged on click appeal, the opening ten seconds on whether it holds the promise those two made.",
  "verdict: strongerSide is the video whose packaging is the stronger play (or neither when they are genuinely close), summary is the verdict itself in two sentences at most, about 45 words, and never a third sentence, and confidence is 0 to 1 in how strongly the evidence supports that verdict. This is a judgement of the packaging itself, so it stays answerable in every mode; what changes is what stands behind it. Lower the confidence when the two are close, when evidence is thin on one side, and whenever comparability.anchor is not 'anchored', since no performance figure is backing you there.",
  "surfaces: one entry for each of thumbnail, title, hook and alignment that you have evidence for. aRead and bRead describe what that video's surface actually does, concretely (what is in the frame, what the title claims, what the opening says and shows). whyItMatters explains in one or two sentences why that difference would move clicks or hold the opening. Use surface 'alignment' for whether the title, thumbnail and opening promise one thing or pull apart.",
  "drivers: the ranked reasons the stronger video is stronger, most important first, one to six of them. label is a short phrase (for example 'Thumbnail is doing three things at once'). detail is one or two sentences. evidence is up to four short pointers back to the supplied inputs, quoting the real thing where possible (a verbatim title fragment, the thumbnail's overlaid words, 'frame at 0:04 is a wide shot with no face', 'one cut in the first ten seconds versus eleven per minute across the video'). Only emit a driver where the evidence genuinely supports it.",
  `The tips in this report are its advice, so every one of them is written under the rules that follow. ${TIP_VOICE_PROMPT}`,
  "In this report those rules also mean the two videos stay out of the advice entirely: never name Video A or Video B inside a tip, and never phrase advice as something one of these two videos should have done (for example 'Show the payoff itself in the first three seconds, not only in the title and thumbnail'). Your reads, drivers and evidence are the opposite: those describe what these two videos already did, so they name Video A and Video B freely.",
  "tip: every driver is a comparison you have evidence for, so every driver carries one. It is the single change that driver's evidence argues for, written as a one-sentence instruction for the uploader's next video (for example 'Cut the thumbnail to one subject and one line of text, sized to read at phone width'). Name the change rather than restating detail, and keep it specific to what this comparison actually showed rather than generic packaging advice, while phrasing it as a rule to apply next time.",
  "Every entry in surfaces carries a tip of its own as well, written under exactly those same rules: the single change that surface's comparison argues for, in one sentence, for the uploader's next video. Write one for every surface you cover, including the surfaces your drivers already speak to. This is the line the reader acts on, and the drivers themselves are never shown, so it has to stand on its own rather than continue a driver.",
  "The reader sees one piece of advice per surface and it is that surface's tip, so that tip has to be the single most valuable change you can name there. Nothing else you write reaches them as advice: do not hold a second suggestion for a surface back for anywhere else in your answer, because there is nowhere for it to go and nothing will show it.",
  "Write in plain, direct prose with no marketing filler. Never output an em dash character (U+2014) or en dash (U+2013) anywhere in your response; if you would use one, rewrite with a comma, colon, parentheses or two sentences instead.",
].join(" ")

interface ModelReportOutput {
  verdict: PackagingReportVerdict
  surfaces: PackagingReportSurfaceRead[]
  drivers: PackagingReportDriver[]
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

  // Nothing checks recommendations: the model is no longer asked for a second
  // piece of advice per surface, and a stored report that still carries some
  // passes on the fields above, which is what a report fed back through here
  // needs.
  return true
}

// The side with more views, or null when views are unknown or tied. Computed
// here so the model is handed the answer rather than asked to derive it.
//
// `anchored` is what stops a view gap being handed over as a verdict it cannot
// support. Two videos on 1,100 and 73 views have a perfectly well defined
// higher side, and naming it tells the report nothing about their packaging: it
// reports how the two were distributed. For any pair that has not earned a
// performance anchor this returns null, which the prompt already knows how to
// handle since it is the same value an unknown or tied pair produces.
export function higherViewsSide(
  a: Pick<PackagingComparisonReportSide, "views">,
  b: Pick<PackagingComparisonReportSide, "views">,
  anchored = true,
): ReportSide | null {
  if (!anchored) return null
  if (a.views == null || b.views == null || a.views === b.views) return null
  return a.views > b.views ? "a" : "b"
}

// The pair's comparability, read off the two sides. Exported so a test can
// assert the verdict on its own.
export function packagingComparability(
  a: PackagingComparisonReportSide,
  b: PackagingComparisonReportSide,
): PairComparability {
  return assessPairComparability({
    viewsA: a.views,
    viewsB: b.views,
    averageWatchedPercentA: a.averageViewPercentage,
    averageWatchedPercentB: b.averageViewPercentage,
    trafficSourcesA: a.trafficSources,
    trafficSourcesB: b.trafficSources,
    impressionsA: a.impressions,
    impressionsB: b.impressions,
    clickThroughRateA: a.impressionClickThroughRate,
    clickThroughRateB: b.impressionClickThroughRate,
  })
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
// `anchored` decides whether this side's view count travels with it. For a pair
// that cannot be compared on performance it is withheld: the rules forbid
// ranking the two videos by how they did, and withholding the number a ranking
// would be built from is what makes that hold rather than merely ask.
//
// hook.retention stays in both modes on purpose. It measures how this one
// video's own opening behaved against its own starting audience, so it is not a
// comparison between the two videos and carries none of the traffic mix problem
// that the view counts do.
export function packagingSideForModel(
  side: PackagingComparisonReportSide,
  anchored = true,
) {
  const { hook } = side
  return {
    title: side.title,
    views: anchored ? side.views : null,
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

// The whole comparison as the model receives it, comparability first so the
// verdict is read before the evidence it governs. Exported so a test can assert
// that a pair with no performance anchor really does travel without its view
// counts, rather than only being told not to rank on them.
export function packagingComparisonForModel(
  a: PackagingComparisonReportSide,
  b: PackagingComparisonReportSide,
  comparability: PairComparability,
) {
  const anchored = isAnchored(comparability, "click")
  return {
    comparability: comparabilityForModel(comparability, "click"),
    higherViewsSide: higherViewsSide(a, b, anchored),
    videoA: packagingSideForModel(a, anchored),
    videoB: packagingSideForModel(b, anchored),
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
  const comparability = packagingComparability(a, b)
  const payload = packagingComparisonForModel(a, b, comparability)

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
            { type: "input_text", text: JSON.stringify(payload) },
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

  return normalizePackagingComparisonReport(parsed, model, comparability)
}

// Trims, clamps and caps the validated model output into the stored shape.
// Exported so tests can exercise the normalisation without a network call.
export function normalizePackagingComparisonReport(
  parsed: ModelReportOutput,
  model: string,
  comparability?: PairComparability,
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
    // Omitted rather than stored undefined, so a report normalised without a
    // verdict (which only the existing tests do) matches the stored shape of a
    // report written before version 7 rather than inventing a null one.
    ...(comparability != null ? { comparability } : {}),
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
    impressions: row.analytics_summary?.impressions ?? null,
    impressionClickThroughRate:
      row.analytics_summary?.impressionClickThroughRate ?? null,
    averageViewPercentage: row.analytics_summary?.averageViewPercentage ?? null,
    trafficSources: row.analytics_summary?.trafficSources ?? [],
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
