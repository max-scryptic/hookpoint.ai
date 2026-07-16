"use client"

import type { ComponentType } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlignHorizontalJustifyCenterIcon,
  AreaChartIcon,
  GaugeIcon,
  ImageIcon,
  ListChecksIcon,
  MinusIcon,
  PackageIcon,
  QuoteIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TypeIcon,
} from "lucide-react"

import { HookIcon } from "@/components/hook-icon"
import type { DeepAnalysisEvidence } from "@/lib/deep-analysis-evidence"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { DeepAnalysisRecommendation } from "@/lib/deep-analysis-recommendations"
import {
  RetentionChart,
  type RetentionChartInsight,
} from "@/components/retention-chart"
import { RecommendationCallout } from "@/components/recommendation-callout"
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
import { computeMetadataHygiene } from "@/lib/metadata-hygiene"
import type { RetentionWindow } from "@/lib/retention-windows"
import {
  netSubscribersGained,
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
  deepInsights,
  recommendations,
  highlightedId,
}: {
  windows: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepInsights: Map<number, RankedRetentionWindowEvent>
  recommendations: Map<number, DeepAnalysisRecommendation>
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
                <div className="flex items-center justify-between gap-2">
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
                attribution={attribution.get(window.windowIndex)}
                insight={deepInsights.get(window.windowIndex)}
                recommendation={recommendations.get(window.windowIndex)}
                header={(tabs) => (
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
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
          {[...analysis.slowOrRepetitiveStretches]
            .sort((a, b) => a.startSeconds - b.startSeconds)
            .map((stretch, index) => {
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
              <div className="flex items-center gap-3">
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
                  <RecommendationCallout>
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
}: {
  attribution: RetentionMomentAttribution | undefined
}) {
  if (!attribution || attribution.explanation === "") return null
  return (
    <div className="pl-10">
      <ScriptFeedbackBody attribution={attribution} />
    </div>
  )
}

// The script attribution's inner content, without the row's left indent, so it
// can be reused both flat (AttributionNote) and inside the tabbed layout below.
function ScriptFeedbackBody({
  attribution,
}: {
  attribution: RetentionMomentAttribution
}) {
  return (
    <>
      <p className="text-sm">{attribution.explanation}</p>
      {attribution.tip && (
        <div className="mt-2">
          <TryCallout>{attribution.tip}</TryCallout>
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
        <p>{insight.narrative}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Multimodal evidence · {insight.evidenceQuality} confidence
        </p>
      </div>
    </div>
  )
}

function ActionableRecommendation({
  recommendation,
}: {
  recommendation: DeepAnalysisRecommendation | undefined
}) {
  if (!recommendation) return null
  return (
    <div className="ml-10">
      <ActionableRecommendationBody recommendation={recommendation} />
    </div>
  )
}

function ActionableRecommendationBody({
  recommendation,
}: {
  recommendation: DeepAnalysisRecommendation
}) {
  return (
    <>
      <TryCallout>{recommendation.action}</TryCallout>
      <p className="mt-1 text-xs text-muted-foreground">
        {recommendation.expectedPurpose}
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
}: {
  insight: RankedRetentionWindowEvent
  recommendation: DeepAnalysisRecommendation | undefined
}) {
  return (
    <>
      <p className="text-sm">{insight.narrative}</p>
      {recommendation && (
        <div className="mt-2">
          <TryCallout>{recommendation.action}</TryCallout>
        </div>
      )}
    </>
  )
}

// The tab label for a window's deep insight, named after whatever the insight is
// actually about (editing, pacing, audio, ...) so it reads as a distinct kind
// of feedback next to the transcript-only "Script" tab. Falls back to the
// evidence source when the event type is unspecific.
function deepFeedbackTabLabel(insight: RankedRetentionWindowEvent): string {
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

// A window's feedback block, rendered together with the row's header so the
// Script/deep tab switcher can sit inline on the top row (after the transcript
// quote) rather than below it. `header` is given the tab list to place in that
// row — or null when there are no tabs to show — and returns the full header.
//
// When the window has BOTH transcript-only script feedback AND a deep
// multimodal insight, the two are split across tabs so every tip stays visible
// without stacking into a tall, noisy column. When only one source is present,
// it renders flat below the header exactly as before.
function WindowFeedback({
  header,
  attribution,
  insight,
  recommendation,
}: {
  header: (tabs: React.ReactNode) => React.ReactNode
  attribution: RetentionMomentAttribution | undefined
  insight: RankedRetentionWindowEvent | undefined
  recommendation: DeepAnalysisRecommendation | undefined
}) {
  const hasScript = attribution != null && attribution.explanation !== ""
  const hasDeep = insight != null

  if (hasScript && hasDeep) {
    return (
      <Tabs defaultValue="script" className="gap-2">
        {header(
          <TabsList>
            <TabsTrigger value="script">Script</TabsTrigger>
            <TabsTrigger value="deep">
              {deepFeedbackTabLabel(insight)}
            </TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="script" className="pl-10">
          <ScriptFeedbackBody attribution={attribution} />
        </TabsContent>
        <TabsContent value="deep" className="pl-10">
          <DeepFeedbackBody insight={insight} recommendation={recommendation} />
        </TabsContent>
      </Tabs>
    )
  }

  return (
    <>
      {header(null)}
      <AttributionNote attribution={attribution} />
      <MultimodalInsight insight={insight} />
      <ActionableRecommendation recommendation={recommendation} />
    </>
  )
}

function DropList({
  drops,
  transcript,
  attribution,
  deepInsights,
  recommendations,
  highlightedId,
}: {
  // The significant *mid-video* drop-offs (kind = 'drop_off'). The Hook section
  // above already covers the opening, so these never overlap it.
  drops: RetentionWindow[]
  transcript: TranscriptCue[]
  // AI explanations/tips keyed by the drop-off's windowIndex, when generated.
  attribution: Map<number, RetentionMomentAttribution>
  deepInsights: Map<number, RankedRetentionWindowEvent>
  recommendations: Map<number, DeepAnalysisRecommendation>
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
              attribution={attribution.get(drop.windowIndex)}
              insight={deepInsights.get(drop.windowIndex)}
              recommendation={recommendations.get(drop.windowIndex)}
              header={(tabs) => (
                <div className="flex items-center justify-between gap-4">
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
  deepInsights,
  recommendations,
  highlightedId,
}: {
  gains: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepInsights: Map<number, RankedRetentionWindowEvent>
  recommendations: Map<number, DeepAnalysisRecommendation>
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
              attribution={attribution.get(gain.windowIndex)}
              insight={deepInsights.get(gain.windowIndex)}
              recommendation={recommendations.get(gain.windowIndex)}
              header={(tabs) => (
                <div className="flex items-center justify-between gap-4">
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
  highlightedId,
}: {
  holds: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
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
            <div className="flex items-center justify-between gap-4">
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
              </div>
              <span className="text-sm font-medium text-teal-600 dark:text-teal-400">
                {(retained * 100).toFixed(1)}% held
              </span>
            </div>

            <AttributionNote attribution={attribution.get(hold.windowIndex)} />
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Title / Thumbnail / Hook alignment (LLM + vision over the thumbnail)
// ---------------------------------------------------------------------------

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
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">Alignment Summary</h3>
        <p className="mt-2 text-sm text-muted-foreground">{alignment.overall}</p>
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
          <span className="rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-sm font-semibold text-purple-700 dark:text-purple-300">
            {label}
          </span>
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
              {feedback.summary}
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
              {point}
            </p>
          ))}
          {feedback.whatCouldBeBetter.slice(0, 1).map((point, index) => (
            <TryCallout key={index}>{point}</TryCallout>
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
              <span>{point}</span>
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

function MetadataHygieneSection({ video }: { video: VideoDetails }) {
  const hygiene = useMemo(() => computeMetadataHygiene(video), [video])

  const statusStyles: Record<
    (typeof hygiene.checks)[number]["status"],
    string
  > = {
    good: "bg-emerald-500 dark:bg-emerald-400",
    warn: "bg-amber-500 dark:bg-amber-400",
    info: "bg-muted-foreground/40",
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        {hygiene.goodCount} of {hygiene.scoredCount} metadata checks look
        healthy. These are quick packaging basics you can fix in YouTube Studio.
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {hygiene.checks.map((check) => (
          <li
            key={check.id}
            className="flex items-start gap-3 rounded-xl border bg-card p-4"
          >
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${statusStyles[check.status]}`}
            />
            <div>
              <div className="text-sm font-medium">{check.label}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {check.detail}
              </p>
            </div>
          </li>
        ))}
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
  const deepInsightsByKind = (
    kind: RetentionMomentKind,
  ): Map<number, RankedRetentionWindowEvent> => {
    const map = new Map<number, RankedRetentionWindowEvent>()
    for (const evidence of deepAnalysisEvidence?.windows ?? []) {
      if (evidence.window.kind === kind && evidence.events[0]) {
        map.set(evidence.window.windowIndex, evidence.events[0])
      }
    }
    return map
  }
  const hookDeepInsights = deepInsightsByKind("hook")
  const dropDeepInsights = deepInsightsByKind("drop_off")
  const gainDeepInsights = deepInsightsByKind("gain")
  const recommendationsByKind = (
    kind: RetentionMomentKind,
  ): Map<number, DeepAnalysisRecommendation> => {
    const map = new Map<number, DeepAnalysisRecommendation>()
    for (const evidence of deepAnalysisEvidence?.windows ?? []) {
      if (
        showDeepRecommendations &&
        evidence.window.kind === kind &&
        evidence.recommendations[0]
      ) {
        map.set(evidence.window.windowIndex, evidence.recommendations[0])
      }
    }
    return map
  }
  const hookRecommendations = recommendationsByKind("hook")
  const dropRecommendations = recommendationsByKind("drop_off")
  const gainRecommendations = recommendationsByKind("gain")
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
    ...(pacingAnalysis?.slowOrRepetitiveStretches ?? []).map(
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
          {video.thumbnailUrl && (
            <div className="shrink-0 sm:self-start">
              <SourceVideoThumbnail
                thumbnailUrl={video.thumbnailUrl}
                title={video.title}
              />
            </div>
          )}
          <div className="flex flex-1 flex-col">
            <h1 className="text-2xl font-semibold tracking-normal">
              {video.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Audience retention across this video, with the moments where you
              lost and held the most viewers.
            </p>
            {analyticsSummary && (
              <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-3 sm:mt-auto sm:pt-4">
                <Metric
                  label="Views"
                  value={formatCompactNumber(analyticsSummary.views)}
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

              {hookWindows.length > 0 && (
                <TabsContent value="hook">
                  <RetentionWindows
                    windows={hookWindows}
                    transcript={transcript}
                    attribution={hookAttribution}
                    deepInsights={hookDeepInsights}
                    recommendations={hookRecommendations}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {drops.length > 0 && (
                <TabsContent value="drop-offs">
                  <DropList
                    drops={drops}
                    transcript={transcript}
                    attribution={dropAttribution}
                    deepInsights={dropDeepInsights}
                    recommendations={dropRecommendations}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {gains.length > 0 && (
                <TabsContent value="gains">
                  <GainList
                    gains={gains}
                    transcript={transcript}
                    attribution={gainAttribution}
                    deepInsights={gainDeepInsights}
                    recommendations={gainRecommendations}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {holds.length > 0 && (
                <TabsContent value="holds">
                  <HoldList
                    holds={holds}
                    transcript={transcript}
                    attribution={holdAttribution}
                    highlightedId={playbackWindow?.id ?? null}
                  />
                </TabsContent>
              )}

              {pacingStretches.length > 0 && (
                <TabsContent value="pacing">
                  <PacingAnalysisSection
                    analysis={pacingAnalysis}
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
