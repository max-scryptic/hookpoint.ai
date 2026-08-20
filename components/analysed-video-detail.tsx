"use client"

import type { ComponentType } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlignHorizontalJustifyCenterIcon,
  AreaChartIcon,
  CheckCircle2Icon,
  GaugeIcon,
  ImageIcon,
  LightbulbIcon,
  ListChecksIcon,
  MinusIcon,
  PackageIcon,
  QuoteIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  TypeIcon,
} from "lucide-react"

import { HookIcon } from "@/components/hook-icon"
import {
  createFirstSaying,
  dedupePacingTips,
  dedupeSectionTips,
  type DeepWindowFeedback,
} from "@/lib/report-tip-uniqueness"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"
import type { DeepAnalysisEvidence } from "@/lib/deep-analysis-evidence"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { DeepAnalysisRecommendation } from "@/lib/deep-analysis-recommendations"
import {
  RetentionChart,
  type RetentionChartInsight,
} from "@/components/retention-chart"
import { RecommendationCallout } from "@/components/recommendation-callout"
import { RetentionEventsInfo } from "@/components/retention-events-info"
import {
  SourceVideoPlayer,
  SourceVideoThumbnail,
} from "@/components/source-video-thumbnail"
import { TryCallout } from "@/components/try-callout"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cleanCopy, limitSentences } from "@/lib/copy-guardrails"
import type { PacingAnalysis } from "@/lib/pacing-analysis"
import {
  prioritizePackagingImprovements,
  type PackagingAlignment,
  type PackagingComponentFeedback,
  type PackagingComponentKey,
} from "@/lib/packaging-alignment"
import type {
  RetentionAttribution,
  RetentionMomentAttribution,
  RetentionMomentKind,
} from "@/lib/retention-attribution"
import {
  computeMetadataHygiene,
  type HygieneStatus,
} from "@/lib/metadata-hygiene"
import type { RetentionWindow } from "@/lib/retention-windows"
import {
  netSubscribersGained,
  preferredViewCount,
  transcriptForSegment,
  transcriptSegmentEdges,
  type RetentionPoint,
  type TranscriptCue,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}

// Compact human number: 12345 -> "12.3K", 2_400_000 -> "2.4M".
function formatCompactNumber(value: number | null): string {
  if (value == null) return "N/A"
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

// Thumbnail click-through rate as a percentage string. YouTube added this
// metric to the Analytics API in January 2026 and its docs are ambiguous on
// units, so this is defensive: a click-through rate can never exceed 100%, so a
// value <= 1 is a 0..1 fraction (scale up) and anything larger is already a
// 0..100 percentage. Either way a sane "4.8%" comes out.
function formatClickThroughRate(value: number): string {
  const percent = value <= 1 ? value * 100 : value
  return `${percent.toFixed(1)}%`
}

// Maps an insight marker's kind to the retention tab that holds its list, so a
// click on the chart can bring the matching tab forward.
const TAB_FOR_INSIGHT_KIND: Record<
  RetentionChartInsight["kind"],
  string
> = {
  hook: "hook",
  drop: "drop-offs",
  gain: "gains",
  hold: "holds",
  pacing: "pacing",
}

// When a retention insight marker on the chart is selected, the matching row in
// the list below is tinted in that insight's colour so the reader can see which
// item the moment they clicked relates to. The tint fades out again (via the
// always-on `transition-colors`) once the selection is cleared.
const ROW_HIGHLIGHT: Record<"hook" | "drop" | "gain" | "hold" | "pacing", string> = {
  hook: "bg-yellow-50 ring-1 ring-inset ring-yellow-400/40 dark:bg-yellow-500/10",
  drop: "bg-red-50 ring-1 ring-inset ring-red-400/40 dark:bg-red-500/10",
  gain: "bg-emerald-50 ring-1 ring-inset ring-emerald-400/40 dark:bg-emerald-500/10",
  hold: "bg-teal-50 ring-1 ring-inset ring-teal-400/40 dark:bg-teal-500/10",
  pacing: "bg-blue-50 ring-1 ring-inset ring-blue-400/40 dark:bg-blue-500/10",
}

function rowHighlightClass(
  kind: keyof typeof ROW_HIGHLIGHT,
  isHighlighted: boolean,
  base: string,
): string {
  return `${base} transition-colors ${isHighlighted ? ROW_HIGHLIGHT[kind] : ""}`
}

// How the page glides to a highlighted row when a chart marker is clicked. The
// native smooth `scrollIntoView` felt sudden, so we run our own eased animation
// that is a touch slower and gentler. The row lands centered in the viewport so
// the linked item reads as the focus of attention rather than being pinned to
// the top of the screen.
const HIGHLIGHT_SCROLL_DURATION_MS = 900

// Standard ease-in-out cubic: slow start, quick middle, slow settle — the shape
// that reads as a deliberate glide rather than a snap.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// Smoothly scrolls the window so `element` is vertically centered in the
// viewport. Skips the animation entirely for users who prefer reduced motion,
// and no-ops when the row is already about where it would land so a second
// click doesn't jitter the page.
function smoothScrollToElement(element: HTMLElement) {
  requestAnimationFrame(() => {
    const startY = window.scrollY
    const rect = element.getBoundingClientRect()
    const centerOffset = (window.innerHeight - rect.height) / 2
    const targetY = Math.max(0, rect.top + startY - centerOffset)
    const distance = targetY - startY
    if (Math.abs(distance) < 8) return

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    if (prefersReducedMotion) {
      window.scrollTo(0, targetY)
      return
    }

    let startTime: number | null = null
    const step = (timestamp: number) => {
      if (startTime === null) startTime = timestamp
      const progress = Math.min(
        1,
        (timestamp - startTime) / HIGHLIGHT_SCROLL_DURATION_MS,
      )
      window.scrollTo(0, startY + distance * easeInOutCubic(progress))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

// Glide the highlighted row into view when a chart marker is clicked, so the
// linked item is visible even if it sits lower in a long list.
function useHighlightScroll(highlightedId?: string | null) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlightedId && ref.current) {
      smoothScrollToElement(ref.current)
    }
  }, [highlightedId])
  return ref
}

// ---------------------------------------------------------------------------
// The Hook (fixed, always-on opening windows analysed for every video)
// ---------------------------------------------------------------------------

function RetentionWindows({
  windows,
  transcript,
  attribution,
  deepFeedback,
  highlightedId,
}: {
  windows: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
}) {
  const highlightedRef = useHighlightScroll(highlightedId)

  if (windows.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        No hook windows are available for this video.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y overflow-hidden rounded-xl border bg-card [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">
      {windows.map((window, index) => {
        const rowId = `hook-${window.windowKey ?? window.windowIndex}`
        const isHighlighted = rowId === highlightedId
        return (
          <li
            key={window.windowKey ?? window.windowIndex}
            ref={isHighlighted ? highlightedRef : undefined}
            className={rowHighlightClass(
              "hook",
              isHighlighted,
              "flex flex-col gap-2 p-4",
            )}
          >
            {window.outOfRange ? (
              <>
                <div className="flex min-h-[2.625rem] items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(window.fromSeconds)} –{" "}
                      {formatTimestamp(window.toSeconds)}
                    </span>
                    <ScriptSegmentTooltip
                      transcript={transcript}
                      fromSeconds={window.fromSeconds}
                      toSeconds={window.toSeconds}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  This video is too short to reach this window.
                </p>
              </>
            ) : (
              <WindowFeedback
                section="Retention: Hook"
                attribution={attribution.get(window.windowIndex)}
                deepFeedback={deepFeedback.get(window.windowIndex) ?? []}
                header={(tabs) => (
                  <div className="flex min-h-[2.625rem] flex-wrap items-center justify-between gap-x-2 gap-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="font-mono text-sm">
                        {formatTimestamp(window.fromSeconds)} –{" "}
                        {formatTimestamp(window.toSeconds)}
                      </span>
                      <ScriptSegmentTooltip
                        transcript={transcript}
                        fromSeconds={window.fromSeconds}
                        toSeconds={window.toSeconds}
                      />
                      {tabs}
                    </div>
                    <span
                      className={`text-sm font-medium ${
                        window.delta > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                      }`}
                    >
                      {window.delta > 0 ? "+" : "−"}
                      {(Math.abs(window.delta) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              />
            )}
          </li>
        )
      })}
      </ul>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function PacingAnalysisSection({
  analysis,
  transcript,
  hasTranscript,
  highlightedId,
}: {
  analysis: PacingAnalysis | null
  transcript: TranscriptCue[]
  hasTranscript: boolean
  highlightedId?: string | null
}) {
  const highlightedRef = useHighlightScroll(highlightedId)

  return (
    <>
      {!analysis ? (
        <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          {hasTranscript
            ? "Pacing analysis could not be generated right now. It will be retried the next time this report is opened."
            : "Pacing analysis is unavailable because this video has no timestamped transcript."}
        </div>
      ) : analysis.slowOrRepetitiveStretches.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          No slow or repetitive stretches stood out. The pacing holds up across
          this video.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">
          {/* Rendered in the order given, which dedupePacingTips has already put
              in chronological order. Sorting again here would be harmless today
              and wrong the moment the two lists disagree: the chart numbers its
              markers off that same array, and the numbers have to match. */}
          {analysis.slowOrRepetitiveStretches.map((stretch, index) => {
            const rowId = `pacing-${stretch.startSeconds}-${stretch.endSeconds}`
            const isHighlighted = rowId === highlightedId
            return (
            <li
              key={index}
              ref={isHighlighted ? highlightedRef : undefined}
              className={rowHighlightClass(
                "pacing",
                isHighlighted,
                "flex flex-col gap-2 p-4",
              )}
            >
              <div className="flex min-h-[2.625rem] items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(stretch.startSeconds)} –{" "}
                  {formatTimestamp(stretch.endSeconds)}
                </span>
                <ScriptSegmentTooltip
                  transcript={transcript}
                  fromSeconds={stretch.startSeconds}
                  toSeconds={stretch.endSeconds}
                />
              </div>
              <p className="pl-10 text-sm">{stretch.reason}</p>
              {stretch.suggestion && (
                <div className="pl-10">
                  <RecommendationCallout section="Pacing">
                    {stretch.suggestion}
                  </RecommendationCallout>
                </div>
              )}
            </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Drop-off list (significant drops)
// ---------------------------------------------------------------------------

// A small explanation + optional tip block, shared by the drop-off and gain
// lists, rendered from the LLM retention attribution when one is available for
// that window.
function AttributionNote({
  attribution,
  section,
}: {
  attribution: RetentionMomentAttribution | undefined
  section: string
}) {
  if (!attribution || attribution.explanation === "") return null
  return (
    <div className="pl-10">
      <ScriptFeedbackBody attribution={attribution} section={section} />
    </div>
  )
}

// The script attribution's inner content, without the row's left indent, so it
// can be reused both flat (AttributionNote) and inside the tabbed layout below.
function ScriptFeedbackBody({
  attribution,
  section,
}: {
  attribution: RetentionMomentAttribution
  section: string
}) {
  return (
    <>
      <p className="text-sm">{cleanCopy(attribution.explanation)}</p>
      {attribution.tip && (
        <div className="mt-2">
          <TryCallout section={`${section}: Script`}>
            {attribution.tip}
          </TryCallout>
        </div>
      )}
    </>
  )
}

function MultimodalInsight({
  insight,
}: {
  insight: RankedRetentionWindowEvent | undefined
}) {
  if (!insight) return null
  return (
    <div className="ml-10">
      <MultimodalInsightBody insight={insight} />
    </div>
  )
}

function MultimodalInsightBody({
  insight,
}: {
  insight: RankedRetentionWindowEvent
}) {
  return (
    <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-violet-500" />
      <div>
        <p>{cleanCopy(insight.narrative)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Multimodal evidence · {insight.evidenceQuality} confidence
        </p>
      </div>
    </div>
  )
}

function ActionableRecommendation({
  recommendation,
  section,
}: {
  recommendation: DeepAnalysisRecommendation | undefined
  section: string
}) {
  if (!recommendation) return null
  return (
    <div className="ml-10">
      <ActionableRecommendationBody
        recommendation={recommendation}
        section={section}
      />
    </div>
  )
}

function ActionableRecommendationBody({
  recommendation,
  section,
}: {
  recommendation: DeepAnalysisRecommendation
  section: string
}) {
  return (
    <>
      <TryCallout section={`${section}: Deep analysis`}>
        {recommendation.action}
      </TryCallout>
      <p className="mt-1 text-xs text-muted-foreground">
        {cleanCopy(recommendation.expectedPurpose)}
      </p>
    </>
  )
}

// The deep (multimodal) insight plus its actionable recommendation, formatted
// identically to ScriptFeedbackBody so every tab reads the same: the white
// evidence line, then the blue "Try:" tip. No bordered box, evidence-source
// caption or expected-purpose subtext — those would make the deep tab look
// unlike the Script tab it sits beside.
function DeepFeedbackBody({
  insight,
  recommendation,
  section,
}: {
  insight: RankedRetentionWindowEvent
  recommendation: DeepAnalysisRecommendation | undefined
  section: string
}) {
  return (
    <>
      <p className="text-sm">{cleanCopy(insight.narrative)}</p>
      {recommendation && (
        <div className="mt-2">
          <TryCallout section={`${section}: Deep analysis`}>
            {recommendation.action}
          </TryCallout>
        </div>
      )}
    </>
  )
}

// The tab label for a window's deep insight, named after whatever the insight is
// actually about (editing, pacing, audio, ...) so it reads as a distinct kind
// of feedback next to the transcript-only "Script" tab. Falls back to the
// evidence source when the event type is unspecific.
function deepFeedbackBaseTabLabel(insight: RankedRetentionWindowEvent): string {
  switch (insight.eventType) {
    case "scene_cut":
      return "Editing"
    case "visual_change":
      return "Visual"
    case "on_screen_text_change":
      return "On-screen text"
    case "pacing_change":
      return "Pacing"
    case "audio_change":
      return "Audio"
    case "topic_shift":
      return "Structure"
    default:
      break
  }
  switch (insight.primaryEvidence) {
    case "editing":
      return "Editing"
    case "visual":
      return "Visual"
    case "audio":
      return "Audio"
    case "transcript":
      return "Delivery"
    case "combined":
      return "Multimodal"
    default:
      return "Editing"
  }
}

function deepFeedbackTabLabel(
  insight: RankedRetentionWindowEvent,
  index: number,
  allFeedback: DeepWindowFeedback[],
): string {
  const label = deepFeedbackBaseTabLabel(insight)
  const matchingFeedback = allFeedback.filter(
    (feedback) => deepFeedbackBaseTabLabel(feedback.insight) === label,
  )
  const duplicateIndex = matchingFeedback.findIndex(
    (feedback) => feedback.insight.id === insight.id,
  )
  return matchingFeedback.length > 1 ? `${label} ${duplicateIndex + 1}` : label
}

// Reduce a window's raw per-event deep feedback to just the entries that earn
// their own tab. Only an insight that produced an actionable tip is worth a
// tab (the reasoning is shown above the tip inside it), and each distinct tip
// gets a single tab — several events in one window often synthesise the same
// recommendation, and a tipless event would render an empty tab.
function dedupeDeepFeedback(
  deepFeedback: DeepWindowFeedback[],
): DeepWindowFeedback[] {
  const seenTips = new Set<string>()

  return deepFeedback.filter(({ recommendation }) => {
    const tip = recommendation?.action.trim()
    if (!tip || seenTips.has(tip)) return false
    seenTips.add(tip)
    return true
  })
}

// Whether one of the window's deep tabs already carries this tip, in which case
// the Script tab drops its own copy of it: a tip measured off the frames and the
// audio is the better-evidenced version of the same advice, and it is the one
// that can show its working. lib/report-tip-uniqueness.ts settles this for the
// report as a whole, in the same direction and against near-duplicates rather
// than exact ones; this is the last check before the tabs are built.
function deepFeedbackCarriesTip(
  deepFeedback: DeepWindowFeedback[],
  tip: string,
): boolean {
  const wanted = tip.trim()
  return deepFeedback.some(
    ({ recommendation }) => recommendation?.action.trim() === wanted,
  )
}

// A window's feedback block, rendered together with the row's header so the
// Script/deep tab switcher can sit inline on the top row (after the transcript
// quote) rather than below it. `header` is given the tab list to place in that
// row — or null when there are no tabs to show — and returns the full header.
//
// The Script tab carries the transcript reading of the window: its explanation
// always, and its tip only when the transcript earned one — see THE WARRANT in
// lib/retention-attribution.ts. Each *unique* deep tip synthesised from the
// window's events then earns its own additional tab (reasoning above the tip);
// duplicate and tipless events are dropped so the switcher only ever holds
// distinct, actionable feedback. When just one source of feedback survives, it
// renders flat below the header exactly as before.
function WindowFeedback({
  header,
  attribution,
  deepFeedback,
  section,
}: {
  header: (tabs: React.ReactNode) => React.ReactNode
  attribution: RetentionMomentAttribution | undefined
  deepFeedback: DeepWindowFeedback[]
  // Which retention list this window belongs to ("Hook", "Drop-off", "Gain",
  // "Hold"), so a tip kept from it says where it was read.
  section: string
}) {
  const uniqueDeep = dedupeDeepFeedback(deepFeedback)
  const hasDeep = uniqueDeep.length > 0
  // The window's script feedback as it will actually be shown, or undefined when
  // there is none to show. A tip a deep tab already carries is dropped from it;
  // the explanation stays either way, so only the duplicated "Try:" line goes.
  const script =
    attribution == null || attribution.explanation === ""
      ? undefined
      : attribution.tip != null &&
          deepFeedbackCarriesTip(uniqueDeep, attribution.tip)
        ? { ...attribution, tip: null }
        : attribution

  if (script && hasDeep) {
    return (
      <Tabs defaultValue="script" className="gap-2">
        {header(
          <TabsList>
            <TabsTrigger value="script">Script</TabsTrigger>
            {uniqueDeep.map(({ insight }, index) => (
              <TabsTrigger key={insight.id} value={`deep-${insight.id}`}>
                {deepFeedbackTabLabel(insight, index, uniqueDeep)}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <TabsContent value="script" className="pl-10">
          <ScriptFeedbackBody attribution={script} section={section} />
        </TabsContent>
        {uniqueDeep.map(({ insight, recommendation }) => (
          <TabsContent
            key={insight.id}
            value={`deep-${insight.id}`}
            className="pl-10"
          >
            <DeepFeedbackBody
              insight={insight}
              recommendation={recommendation}
              section={section}
            />
          </TabsContent>
        ))}
      </Tabs>
    )
  }

  if (!script && uniqueDeep.length > 1) {
    const defaultValue = `deep-${uniqueDeep[0].insight.id}`
    return (
      <Tabs defaultValue={defaultValue} className="gap-2">
        {header(
          <TabsList>
            {uniqueDeep.map(({ insight }, index) => (
              <TabsTrigger key={insight.id} value={`deep-${insight.id}`}>
                {deepFeedbackTabLabel(insight, index, uniqueDeep)}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {uniqueDeep.map(({ insight, recommendation }) => (
          <TabsContent
            key={insight.id}
            value={`deep-${insight.id}`}
            className="pl-10"
          >
            <DeepFeedbackBody
              insight={insight}
              recommendation={recommendation}
              section={section}
            />
          </TabsContent>
        ))}
      </Tabs>
    )
  }

  return (
    <>
      {header(null)}
      <AttributionNote attribution={script} section={section} />
      <MultimodalInsight insight={uniqueDeep[0]?.insight} />
      <ActionableRecommendation
        recommendation={uniqueDeep[0]?.recommendation}
        section={section}
      />
    </>
  )
}

function DropList({
  drops,
  transcript,
  attribution,
  deepFeedback,
  highlightedId,
}: {
  // The significant *mid-video* drop-offs (kind = 'drop_off'). The Hook section
  // above already covers the opening, so these never overlap it.
  drops: RetentionWindow[]
  transcript: TranscriptCue[]
  // AI explanations/tips keyed by the drop-off's windowIndex, when generated.
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
}) {
  const highlightedRef = useHighlightScroll(highlightedId)

  if (drops.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        No abnormal drop-offs detected. Retention falls about as evenly as a
        typical video, with no single moment standing out.
      </div>
    )
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">
      {drops.map((drop, index) => {
        const rowId = `drop-${drop.windowIndex}`
        const isHighlighted = rowId === highlightedId
        return (
          <li
            key={`${drop.fromSeconds}-${index}`}
            ref={isHighlighted ? highlightedRef : undefined}
            className={rowHighlightClass(
              "drop",
              isHighlighted,
              "flex flex-col gap-2 p-4",
            )}
          >
            <WindowFeedback
              section="Retention: Drop-off"
              attribution={attribution.get(drop.windowIndex)}
              deepFeedback={deepFeedback.get(drop.windowIndex) ?? []}
              header={(tabs) => (
                <div className="flex min-h-[2.625rem] items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(drop.fromSeconds)} –{" "}
                      {formatTimestamp(drop.toSeconds)}
                    </span>
                    <ScriptSegmentTooltip
                      transcript={transcript}
                      fromSeconds={drop.fromSeconds}
                      toSeconds={drop.toSeconds}
                    />
                    {tabs}
                  </div>
                  <span className="text-sm font-medium text-destructive">
                    −{(Math.abs(drop.delta) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            />
          </li>
        )
      })}
    </ul>
  )
}

// A compact hover affordance that reveals the transcript segment for a window
// without spending vertical space on it in the card body. Renders nothing when
// the window has no spoken words. The excerpt is bracketed with ellipses to
// signal it's clipped from the wider script, except at the very start or end of
// the script, where there are no earlier/later words to stand in for.
function ScriptSegmentTooltip({
  transcript,
  fromSeconds,
  toSeconds,
}: {
  transcript: TranscriptCue[]
  fromSeconds: number
  toSeconds: number
}) {
  const text = transcriptForSegment(transcript, fromSeconds, toSeconds)
  if (!text) return null

  const { atStart, atEnd } = transcriptSegmentEdges(
    transcript,
    fromSeconds,
    toSeconds,
  )
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            aria-label="Show what was said in this window"
          />
        }
      >
        <QuoteIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">
        “{atStart ? "" : "…"}
        {text}
        {atEnd ? "" : "…"}”
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Gains list
// ---------------------------------------------------------------------------

function GainList({
  gains,
  transcript,
  attribution,
  deepFeedback,
  highlightedId,
}: {
  gains: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
}) {
  const highlightedRef = useHighlightScroll(highlightedId)

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">
      {gains.map((gain, index) => {
        const rowId = `gain-${gain.windowIndex}`
        const isHighlighted = rowId === highlightedId
        return (
          <li
            key={`${gain.fromSeconds}-${index}`}
            ref={isHighlighted ? highlightedRef : undefined}
            className={rowHighlightClass(
              "gain",
              isHighlighted,
              "flex flex-col gap-2 p-4",
            )}
          >
            <WindowFeedback
              section="Retention: Gain"
              attribution={attribution.get(gain.windowIndex)}
              deepFeedback={deepFeedback.get(gain.windowIndex) ?? []}
              header={(tabs) => (
                <div className="flex min-h-[2.625rem] items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(gain.fromSeconds)} –{" "}
                      {formatTimestamp(gain.toSeconds)}
                    </span>
                    <ScriptSegmentTooltip
                      transcript={transcript}
                      fromSeconds={gain.fromSeconds}
                      toSeconds={gain.toSeconds}
                    />
                    {tabs}
                  </div>
                  <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    +{(gain.delta * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            />
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Holds list (sustained, near-flat retention stretches)
// ---------------------------------------------------------------------------

function HoldList({
  holds,
  transcript,
  attribution,
  deepFeedback,
  highlightedId,
}: {
  holds: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
}) {
  const highlightedRef = useHighlightScroll(highlightedId)

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">
      {holds.map((hold, index) => {
        const rowId = `hold-${hold.windowIndex}`
        const isHighlighted = rowId === highlightedId
        const entering = hold.startWatchRatio ?? 0
        const leaving = hold.endWatchRatio ?? entering
        const retained = entering > 0 ? Math.min(1, leaving / entering) : 1
        return (
          <li
            key={rowId}
            ref={isHighlighted ? highlightedRef : undefined}
            className={rowHighlightClass(
              "hold",
              isHighlighted,
              "flex flex-col gap-2 p-4",
            )}
          >
            <WindowFeedback
              section="Retention: Hold"
              attribution={attribution.get(hold.windowIndex)}
              deepFeedback={deepFeedback.get(hold.windowIndex) ?? []}
              header={(tabs) => (
                <div className="flex min-h-[2.625rem] items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(hold.fromSeconds)} –{" "}
                      {formatTimestamp(hold.toSeconds)}
                    </span>
                    <ScriptSegmentTooltip
                      transcript={transcript}
                      fromSeconds={hold.fromSeconds}
                      toSeconds={hold.toSeconds}
                    />
                    {tabs}
                  </div>
                  <span className="text-sm font-medium text-teal-600 dark:text-teal-400">
                    {(retained * 100).toFixed(1)}% held
                  </span>
                </div>
              )}
            />
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Title / Thumbnail / Hook alignment (LLM + vision over the thumbnail)
// ---------------------------------------------------------------------------

// The model's read of the three surfaces a viewer meets. The alignment numbers
// the same analysis produces are deliberately not shown here: they belong to the
// surfaces that set a score against something (the packaging head-to-head and
// channel trends), not to one video's own report.
function PackagingAlignmentSection({
  alignment,
  hasThumbnail,
  hookQuote = null,
}: {
  alignment: PackagingAlignment | null
  hasThumbnail: boolean
  hookQuote?: string | null
}) {
  if (!alignment) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        {hasThumbnail
          ? "Title & thumbnail analysis could not be generated right now. It will be retried the next time this report is opened."
          : "Title & thumbnail analysis is unavailable because this video has no thumbnail image."}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">Summary</h3>
        <p className="text-sm text-muted-foreground">
          {/* Two sentences at most, like every other summary card: the
              per-surface tabs under it carry the detail. */}
          {limitSentences(cleanCopy(alignment.overall))}
        </p>
      </div>

      {alignment.components ? (
        <PackagingComponentTabs
          components={alignment.components}
          hookQuote={hookQuote}
        />
      ) : (
        // Older alignments were stored before the per-component breakdown
        // existed, so fall back to the flat two-column layout for them.
        <div className="grid gap-3 sm:grid-cols-2">
          <PointsCard
            title="What worked well"
            tone="good"
            points={(alignment.whatWorked ?? []).slice(0, 3)}
          />
          <PointsCard
            title="What could be improved"
            tone="warn"
            points={prioritizePackagingImprovements(
              alignment.whatCouldBeBetter ?? [],
            ).slice(0, 3)}
          />
        </div>
      )}
    </div>
  )
}

// The spoken opening line for the hook window, bracketed the same way as the
// per-window ScriptSegmentTooltip, so the Hook packaging card can surface it
// inline instead of leaving it behind a hover affordance.
function hookOpeningQuote(
  transcript: TranscriptCue[],
  fromSeconds: number,
  toSeconds: number,
): string | null {
  const text = transcriptForSegment(transcript, fromSeconds, toSeconds)
  if (!text) return null

  const { atStart, atEnd } = transcriptSegmentEdges(
    transcript,
    fromSeconds,
    toSeconds,
  )
  return `“${atStart ? "" : "…"}${text}${atEnd ? "" : "…"}”`
}

const PACKAGING_COMPONENT_META: Record<
  PackagingComponentKey,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  title: { label: "Title", icon: TypeIcon },
  thumbnail: { label: "Thumbnail", icon: ImageIcon },
  hook: { label: "Hook", icon: HookIcon },
}

const PACKAGING_COMPONENT_ORDER: PackagingComponentKey[] = [
  "title",
  "thumbnail",
  "hook",
]

// The three surfaces a viewer meets, in the same reading order as the packaging
// head-to-head (components/packaging-comparison.tsx). The head-to-head carries a
// fourth Alignment tab on top of these three; a single video's report does not,
// since a lone alignment score has nothing to be read against here.
function PackagingComponentTabs({
  components,
  hookQuote = null,
}: {
  components: NonNullable<PackagingAlignment["components"]>
  hookQuote?: string | null
}) {
  return (
    <Tabs defaultValue="title" className="w-full">
      <TabsList>
        {PACKAGING_COMPONENT_ORDER.map((key) => {
          const { label, icon: Icon } = PACKAGING_COMPONENT_META[key]
          return (
            <TabsTrigger key={key} value={key}>
              <Icon className="text-muted-foreground" />
              {label}
            </TabsTrigger>
          )
        })}
      </TabsList>

      {PACKAGING_COMPONENT_ORDER.map((key) => (
        <TabsContent key={key} value={key} className="w-full">
          <PackagingComponentCard
            label={PACKAGING_COMPONENT_META[key].label}
            feedback={components[key]}
            quote={key === "hook" ? hookQuote : null}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

// The purple name every packaging tab opens with.
function PackagingComponentBadge({ label }: { label: string }) {
  return (
    <span className="w-fit rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-sm font-semibold text-purple-700 dark:text-purple-300">
      {label}
    </span>
  )
}

function PackagingComponentCard({
  label,
  feedback,
  quote = null,
}: {
  label: string
  feedback: PackagingComponentFeedback
  // The spoken opening line for the Hook card. Rather than spending vertical
  // space on it in the card body, it's revealed in a tooltip when hovering the
  // speech-mark icon beside the badge.
  quote?: string | null
}) {
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PackagingComponentBadge label={label} />
          {quote && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                    aria-label="Show the spoken hook"
                  />
                }
              >
                <QuoteIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm italic">
                {quote}
              </TooltipContent>
            </Tooltip>
          )}
          {feedback.summary && (
            <span className="text-sm text-muted-foreground">
              {cleanCopy(feedback.summary)}
            </span>
          )}
        </div>
      </div>

      {feedback.whatWorked.length === 0 &&
      feedback.whatCouldBeBetter.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to flag.</p>
      ) : (
        // Mirror the retention rows: a plain description followed by the
        // borderless blue "Try:" callout, with no badges or coloured rules.
        <div className="flex flex-col gap-2">
          {feedback.whatWorked.slice(0, 1).map((point, index) => (
            <p key={index} className="text-sm">
              {cleanCopy(point)}
            </p>
          ))}
          {feedback.whatCouldBeBetter.slice(0, 1).map((point, index) => (
            <TryCallout key={index} section={`Packaging: ${label}`}>
              {point}
            </TryCallout>
          ))}
        </div>
      )}
    </div>
  )
}

function PointsCard({
  title,
  tone,
  points,
}: {
  title: string
  tone: "good" | "warn"
  points: string[]
}) {
  const dot =
    tone === "good"
      ? "bg-emerald-500 dark:bg-emerald-400"
      : "bg-amber-500 dark:bg-amber-400"
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {points.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing to flag.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {points.map((point, index) => (
            <li key={index} className="flex gap-2 text-sm">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />
              <span>{cleanCopy(point)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metadata hygiene (deterministic checks)
// ---------------------------------------------------------------------------

// A coloured dot alone left readers guessing — nothing on the card said what
// green meant, and the muted "info" dot read as an absent status rather than a
// deliberate "this is optional". Each status now carries a familiar icon *and*
// a plain-language word, so colour is reinforcement rather than the only signal
// (which also keeps it legible for colour-blind readers).
const HYGIENE_STATUS_META: Record<
  HygieneStatus,
  { icon: ComponentType<{ className?: string }>; label: string; tone: string }
> = {
  good: {
    icon: CheckCircle2Icon,
    label: "Looks good",
    tone: "text-emerald-600 dark:text-emerald-500",
  },
  warn: {
    icon: TriangleAlertIcon,
    label: "Worth fixing",
    tone: "text-amber-600 dark:text-amber-500",
  },
  info: {
    icon: LightbulbIcon,
    label: "Optional",
    tone: "text-muted-foreground",
  },
}

function MetadataHygieneSection({ video }: { video: VideoDetails }) {
  const hygiene = useMemo(() => computeMetadataHygiene(video), [video])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Quick packaging basics you can fix in YouTube Studio.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {hygiene.checks.map((check) => {
          const { icon: Icon, label, tone } = HYGIENE_STATUS_META[check.status]
          return (
            <li
              key={check.id}
              className="flex items-start gap-3 rounded-xl border bg-card p-4"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <span className="text-sm font-medium">{check.label}</span>
                  <span
                    className={`ml-auto shrink-0 text-xs font-medium ${tone}`}
                  >
                    {label}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {check.detail}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level detail
// ---------------------------------------------------------------------------

export function AnalysedVideoDetail({
  video,
  retention,
  retentionWindows,
  transcript = [],
  pacingAnalysis = null,
  retentionAttribution = null,
  packagingAlignment = null,
  analyticsSummary = null,
  deepAnalysisEvidence = null,
  showDeepRecommendations = true,
}: {
  video: VideoDetails
  retention: RetentionPoint[]
  retentionWindows: RetentionWindow[]
  transcript?: TranscriptCue[]
  pacingAnalysis?: PacingAnalysis | null
  retentionAttribution?: RetentionAttribution | null
  packagingAlignment?: PackagingAlignment | null
  scriptTaxonomy?: ScriptTaxonomy | null
  analyticsSummary?: VideoAnalyticsSummary | null
  deepAnalysisEvidence?: DeepAnalysisEvidence | null
  showDeepRecommendations?: boolean
}) {
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const [playbackWindow, setPlaybackWindow] = useState<{
    id: string
    fromSeconds: number
    toSeconds: number
  } | null>(null)
  const insightAreaRef = useRef<HTMLDivElement | null>(null)

  // Dismiss the open insight (returning the video to its thumbnail) when the
  // user clicks anywhere outside the video/chart area — not just inside the
  // chart itself — so scrolling down and clicking elsewhere on the page
  // closes it the same way clicking off inside the chart already does.
  useEffect(() => {
    if (!playbackWindow) return

    function handlePointerDown(event: PointerEvent) {
      if (!insightAreaRef.current) return
      if (!(event.target instanceof Node)) return
      if (!insightAreaRef.current.contains(event.target)) {
        setPlaybackWindow(null)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [playbackWindow])

  const hookWindows = retentionWindows.filter((w) => w.kind === "hook")
  // The opening hook line, surfaced next to the purple "Hook" badge in the
  // packaging section above so it reads without hovering the retention list.
  const firstHookWindow = hookWindows[0]
  const hookQuote = firstHookWindow
    ? hookOpeningQuote(
        transcript,
        firstHookWindow.fromSeconds,
        firstHookWindow.toSeconds,
      )
    : null
  const drops = retentionWindows.filter((w) => w.kind === "drop_off")
  const gains = retentionWindows.filter((w) => w.kind === "gain")
  const holds = retentionWindows.filter((w) => w.kind === "hold")
  const pacingStretches = pacingAnalysis?.slowOrRepetitiveStretches ?? []
  const defaultRetentionTab =
    hookWindows.length > 0
      ? "hook"
      : drops.length > 0
        ? "drop-offs"
        : gains.length > 0
          ? "gains"
          : holds.length > 0
            ? "holds"
            : pacingStretches.length > 0
              ? "pacing"
              : null

  // The retention tab is controlled so that clicking an insight marker on the
  // chart can switch to the tab holding that insight (see onInsightSelect).
  const [retentionTab, setRetentionTab] = useState<string | null>(
    defaultRetentionTab,
  )

  // Index the LLM attribution by kind + windowIndex so each hook/drop-off/gain card
  // can pick up its own explanation and tip.
  const attributionByKind = (
    kind: RetentionMomentKind,
  ): Map<number, RetentionMomentAttribution> => {
    const map = new Map<number, RetentionMomentAttribution>()
    for (const moment of retentionAttribution?.moments ?? []) {
      if (moment.kind === kind) map.set(moment.windowIndex, moment)
    }
    return map
  }
  const dropAttribution = attributionByKind("drop_off")
  const gainAttribution = attributionByKind("gain")
  const holdAttribution = attributionByKind("hold")
  const hookAttribution = attributionByKind("hook")
  const deepFeedbackByKind = (
    kind: RetentionMomentKind,
  ): Map<number, DeepWindowFeedback[]> => {
    const map = new Map<number, DeepWindowFeedback[]>()
    for (const evidence of deepAnalysisEvidence?.windows ?? []) {
      if (evidence.window.kind !== kind || evidence.events.length === 0) {
        continue
      }
      const recommendationsByEventId = new Map(
        (showDeepRecommendations ? evidence.recommendations : []).map(
          (recommendation) => [recommendation.sourceEventId, recommendation],
        ),
      )
      map.set(
        evidence.window.windowIndex,
        evidence.events.map((insight) => ({
          insight,
          recommendation: recommendationsByEventId.get(insight.id),
        })),
      )
    }
    return map
  }
  // No two tips on a report may say the same thing, and this is the only place
  // that holds every tip the page is about to render at once. The sections go
  // through in the order they are read, so where the same advice is reached
  // twice the first row keeps it and the later one shows its explanation alone.
  // See lib/report-tip-uniqueness.ts.
  const isFirstSaying = createFirstSaying()
  const hookSection = dedupeSectionTips(
    { attribution: hookAttribution, deepFeedback: deepFeedbackByKind("hook") },
    isFirstSaying,
  )
  const dropSection = dedupeSectionTips(
    { attribution: dropAttribution, deepFeedback: deepFeedbackByKind("drop_off") },
    isFirstSaying,
  )
  const gainSection = dedupeSectionTips(
    { attribution: gainAttribution, deepFeedback: deepFeedbackByKind("gain") },
    isFirstSaying,
  )
  const holdSection = dedupeSectionTips(
    { attribution: holdAttribution, deepFeedback: deepFeedbackByKind("hold") },
    isFirstSaying,
  )
  const dedupedPacingAnalysis = dedupePacingTips(pacingAnalysis, isFirstSaying)
  const chartInsights: RetentionChartInsight[] = [
    ...hookWindows
      .filter((window) => !window.outOfRange)
      .map((window) => {
        const endPercentage = Math.round((window.endWatchRatio ?? 0) * 100)
        const lostPercentage = Math.max(
          0,
          Math.round((window.startWatchRatio ?? 0) * 100) - endPercentage,
        )
        const said = transcriptForSegment(
          transcript,
          window.fromSeconds,
          window.toSeconds,
        )

        return {
          id: `hook-${window.windowKey ?? window.windowIndex}`,
          kind: "hook" as const,
          label: window.label ?? `Hook window ${window.windowIndex + 1}`,
          fromSeconds: window.fromSeconds,
          toSeconds: Math.min(window.toSeconds, video.durationSeconds),
          metric: `${lostPercentage}%`,
          metricLabel: "viewers lost",
          details: [
            `${endPercentage}% still watching at end`,
            ...(window.relativePerformance != null
              ? [`${Math.round(window.relativePerformance * 100)}% vs. similar videos`]
              : []),
          ],
          transcript: said
            ? said.length > 240
              ? `${said.slice(0, 240)}…`
              : said
            : undefined,
        }
      }),
    ...drops.map((window) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )

      return {
        id: `drop-${window.windowIndex}`,
        kind: "drop" as const,
        label: `Significant drop-off ${window.windowIndex + 1}`,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        metric: `−${(Math.abs(window.delta) * 100).toFixed(1)}%`,
        metricLabel: "audience retention",
        details: [
          ...(window.isAbnormallySteep
            ? [`${(window.steepness ?? 0).toFixed(1)}× steeper than normal`]
            : []),
          ...(window.relativePerformance != null
            ? [`${Math.round(window.relativePerformance * 100)}% vs. similar videos`]
            : []),
        ],
        transcript: said || undefined,
      }
    }),
    ...gains.map((window) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )

      return {
        id: `gain-${window.windowIndex}`,
        kind: "gain" as const,
        label: `Retention gain ${window.windowIndex + 1}`,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        metric: `+${(window.delta * 100).toFixed(1)}%`,
        metricLabel: "audience retention",
        transcript: said || undefined,
      }
    }),
    ...holds.map((window) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )
      const entering = window.startWatchRatio ?? 0
      const leaving = window.endWatchRatio ?? entering
      const retained = entering > 0 ? Math.min(1, leaving / entering) : 1

      return {
        id: `hold-${window.windowIndex}`,
        kind: "hold" as const,
        label: `Audience hold ${window.windowIndex + 1}`,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        metric: `${(retained * 100).toFixed(1)}%`,
        metricLabel: "of entering viewers held",
        details: [
          ...(window.relativePerformance != null
            ? [`${Math.round(window.relativePerformance * 100)}% vs. similar videos`]
            : []),
        ],
        transcript: said || undefined,
      }
    }),
    // Built from the deduped analysis rather than the raw one, so a marker is
    // numbered off the same ordered list its row is numbered off (see
    // dedupePacingTips) and carries the suggestion the row actually shows. Read
    // straight from the model instead, these markers were numbered by the
    // model's own ranking while the rows below were numbered chronologically.
    ...(dedupedPacingAnalysis?.slowOrRepetitiveStretches ?? []).map(
      (stretch, index) => ({
        id: `pacing-${stretch.startSeconds}-${stretch.endSeconds}`,
        kind: "pacing" as const,
        label: `Pacing opportunity ${index + 1}`,
        fromSeconds: stretch.startSeconds,
        toSeconds: stretch.endSeconds,
        recommendation: stretch.suggestion,
        transcript: stretch.reason,
      }),
    ),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div ref={insightAreaRef} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
          {/* Rendered even without a usable thumbnail (private and scheduled
              uploads have one YouTube won't serve), so the header keeps its
              shape and shows the placeholder rather than collapsing. */}
          <div className="shrink-0 sm:self-start">
            <SourceVideoThumbnail
              thumbnailUrl={video.thumbnailUrl}
              title={video.title}
            />
          </div>
          <div className="flex flex-1 flex-col">
            <h1 className="text-2xl font-semibold tracking-normal">
              {video.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Audience retention across this video, with the moments where you
              lost and held the most viewers.
            </p>
            {analyticsSummary && (
              <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 sm:mt-auto sm:pt-4">
                <Metric
                  label="Views"
                  value={formatCompactNumber(
                    preferredViewCount(video, analyticsSummary),
                  )}
                />
                <Metric
                  label="Subscribers gained"
                  value={formatCompactNumber(
                    netSubscribersGained(analyticsSummary),
                  )}
                />
                <Metric
                  label="Avg. view duration"
                  value={
                    analyticsSummary.averageViewDurationSeconds != null
                      ? formatTimestamp(
                          analyticsSummary.averageViewDurationSeconds,
                        )
                      : "N/A"
                  }
                />
                {analyticsSummary.impressionClickThroughRate != null && (
                  <Metric
                    label="Thumbnail CTR"
                    value={formatClickThroughRate(
                      analyticsSummary.impressionClickThroughRate,
                    )}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PackageIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Packaging</h2>
          </div>

          <Tabs defaultValue="packaging">
            <TabsList>
              <TabsTrigger value="packaging">
                <AlignHorizontalJustifyCenterIcon className="text-purple-600 dark:text-purple-400" />
                Title, Thumbnail &amp; Hook
              </TabsTrigger>
              <TabsTrigger value="metadata">
                <ListChecksIcon className="text-teal-600 dark:text-teal-400" />
                Metadata
              </TabsTrigger>
            </TabsList>

            <TabsContent value="packaging">
              <PackagingAlignmentSection
                alignment={packagingAlignment}
                hasThumbnail={Boolean(video.thumbnailUrl)}
                hookQuote={hookQuote}
              />
            </TabsContent>

            <TabsContent value="metadata">
              <MetadataHygieneSection video={video} />
            </TabsContent>
          </Tabs>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AreaChartIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Audience retention</h2>
          </div>
          {/* The chart and its insight lists share one positioning context so the
              floating source video can be `position: sticky` across both. It
              starts over the empty top-right of the chart (its highest point,
              page-wise) and, once the page scrolls far enough that it would slide
              off the top, pins just below the top of the viewport and rides down
              with the scroll — staying visible while the reader works through a
              long list — until the bottom of this section scrolls past. */}
          <div className="relative flex flex-col gap-3">
            {video.thumbnailUrl && (
              <div className="pointer-events-none absolute inset-0 z-20">
                <div className="sticky top-4 flex justify-end px-5 pt-5">
                  <div className="w-2/5 max-w-64">
                    <SourceVideoPlayer
                      videoId={video.id}
                      thumbnailUrl={video.thumbnailUrl}
                      title={video.title}
                      scrubTime={previewTime}
                      playbackWindow={playbackWindow}
                      onClose={() => setPlaybackWindow(null)}
                    />
                  </div>
                </div>
              </div>
            )}
            <RetentionChart
              points={retention}
              durationSeconds={video.durationSeconds}
              insights={chartInsights}
              selectedInsightId={playbackWindow?.id ?? null}
              onScrubTimeChange={setPreviewTime}
              onInsightSelect={(insight) => {
                setPlaybackWindow(
                  insight
                    ? {
                        id: insight.id,
                        fromSeconds: insight.fromSeconds,
                        toSeconds: insight.toSeconds,
                      }
                    : null,
                )
                // Bring the tab holding this insight forward so its highlighted
                // row is the one on show. Leave the tab as-is when clicking off.
                if (insight) setRetentionTab(TAB_FOR_INSIGHT_KIND[insight.kind])
              }}
            />

            {defaultRetentionTab && (
              <Tabs
                value={retentionTab ?? defaultRetentionTab}
                onValueChange={(value) => setRetentionTab(value as string)}
              >
              {/* The info affordance sits inline to the right of the tabs, so
                  the explanation of what each window is (and why some carry no
                  tip) is one click from the list it describes. */}
              <div className="flex items-center gap-1">
                <TabsList>
                  {hookWindows.length > 0 && (
                    <TabsTrigger value="hook">
                      <HookIcon className="text-yellow-500 dark:text-yellow-400" />
                      Hook
                    </TabsTrigger>
                  )}
                  {drops.length > 0 && (
                    <TabsTrigger value="drop-offs">
                      <TrendingDownIcon className="text-destructive" />
                      Drop-offs
                    </TabsTrigger>
                  )}
                  {gains.length > 0 && (
                    <TabsTrigger value="gains">
                      <TrendingUpIcon className="text-emerald-600 dark:text-emerald-400" />
                      Gains
                    </TabsTrigger>
                  )}
                  {holds.length > 0 && (
                    <TabsTrigger value="holds">
                      <MinusIcon className="text-teal-600 dark:text-teal-400" />
                      Holds
                    </TabsTrigger>
                  )}
                  {pacingStretches.length > 0 && (
                    <TabsTrigger value="pacing">
                      <GaugeIcon className="text-blue-600 dark:text-blue-400" />
                      Pacing
                    </TabsTrigger>
                  )}
                </TabsList>
                <RetentionEventsInfo />
              </div>

              {hookWindows.length > 0 && (
                <TabsContent value="hook">
                  <RetentionWindows
                    windows={hookWindows}
                    transcript={transcript}
                    attribution={hookSection.attribution}
                    deepFeedback={hookSection.deepFeedback}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {drops.length > 0 && (
                <TabsContent value="drop-offs">
                  <DropList
                    drops={drops}
                    transcript={transcript}
                    attribution={dropSection.attribution}
                    deepFeedback={dropSection.deepFeedback}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {gains.length > 0 && (
                <TabsContent value="gains">
                  <GainList
                    gains={gains}
                    transcript={transcript}
                    attribution={gainSection.attribution}
                    deepFeedback={gainSection.deepFeedback}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {holds.length > 0 && (
                <TabsContent value="holds">
                  <HoldList
                    holds={holds}
                    transcript={transcript}
                    attribution={holdSection.attribution}
                    deepFeedback={holdSection.deepFeedback}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {pacingStretches.length > 0 && (
                <TabsContent value="pacing">
                  <PacingAnalysisSection
                    analysis={dedupedPacingAnalysis}
                    transcript={transcript}
                    hasTranscript={transcript.length > 0}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}
            </Tabs>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
