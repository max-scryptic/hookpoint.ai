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
  type RetentionSectionFeedback,
} from "@/lib/report-tip-uniqueness"
import {
  hasWindowTip,
  resolveWindowFeedback,
} from "@/lib/retention-window-feedback"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"
import type { DeepAnalysisEvidence } from "@/lib/deep-analysis-evidence"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { DeepAnalysisRecommendation } from "@/lib/deep-analysis-recommendations"
import {
  RetentionChart,
  type RetentionChartInsight,
} from "@/components/retention-chart"
import { FirstTipHintProvider } from "@/components/first-tip-hint"
import {
  HintCallout,
  HintTargetGlow,
  useOnboardingHint,
} from "@/components/onboarding-hints"
import {
  ALIGNMENT_PART_LABEL,
  PackagingAlignmentScore,
} from "@/components/packaging-alignment-score"
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
import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
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

// Standard ease-in-out cubic: slow start, quick middle, slow settle - the shape
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
  footageTabsHint = false,
}: {
  windows: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
  // Whether the footage-tabs coach mark is still owed. The list hangs it off
  // its first tabbed row; see firstTabbedRowIndex above.
  footageTabsHint?: boolean
}) {
  const highlightedRef = useHighlightScroll(highlightedId)
  const hintRowIndex = footageTabsHint
    ? firstTabbedRowIndex(windows, attribution, deepFeedback)
    : -1

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
                      {formatTimestamp(window.fromSeconds)} -{" "}
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
                anchorsFootageTabsHint={index === hintRowIndex}
                header={(tabs) => (
                  <div className="flex min-h-[2.625rem] flex-wrap items-center justify-between gap-x-2 gap-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="font-mono text-sm">
                        {formatTimestamp(window.fromSeconds)} -{" "}
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

// What sits under the curve when every window the report found was dropped for
// carrying no tip. Without it the section would simply end at the chart, leaving
// a creator to guess whether the analysis had failed, was still running, or had
// read the video and found nothing to say about it.
//
// The second sentence is the honest next step rather than an apology: a light
// analysis reads the transcript alone, so the most common reason a whole curve
// comes back silent is that the words never explain the moments.
function NoRetentionTips({
  deepAnalysisComplete,
}: {
  deepAnalysisComplete: boolean
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
      No moment on this curve produced advice worth acting on. The hook, the
      drop-offs and the flat stretches were all read,{" "}
      {deepAnalysisComplete
        ? "and none of them gave the analysis enough to write a tip from."
        : "but the script alone did not explain any of them well enough to write a tip from. Uploading the source file runs the deeper analysis over your frames, audio and cuts, which can account for moments the words cannot."}
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
                  {formatTimestamp(stretch.startSeconds)} -{" "}
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
                  <RecommendationCallout
                    section="Pacing"
                    examples={stretch.examples}
                  >
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
  attribution: RetentionMomentAttribution | null | undefined
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
          <TryCallout
            section={`${section}: Script`}
            examples={attribution.tipExamples}
          >
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
      <TryCallout
        section={`${section}: Deep analysis`}
        examples={recommendation.examples}
      >
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
// evidence line, then the blue tip. No bordered box, evidence-source
// caption or expected-purpose subtext - those would make the deep tab look
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
          <TryCallout
            section={`${section}: Deep analysis`}
            examples={recommendation.examples}
          >
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

// Whether a window's feedback renders as a tab switcher rather than as a single
// flat block - the same condition WindowFeedback branches on below, asked ahead
// of the render. The footage-tabs hint needs it: there is no point offering to
// explain tabs on a report that has none.
function rendersFeedbackTabs(
  attribution: RetentionMomentAttribution | undefined,
  deepFeedback: DeepWindowFeedback[],
): boolean {
  const { script, deep } = resolveWindowFeedback(attribution, deepFeedback)
  return (script != null ? 1 : 0) + deep.length > 1
}

// Which row of a list carries the footage-tabs coach mark: the first one in it
// that actually grew tabs, or -1 where none did. Only the open retention tab's
// list is mounted, so each list answering for itself leaves exactly one bubble
// on screen - on something the creator can see.
function firstTabbedRowIndex(
  windows: RetentionWindow[],
  attribution: Map<number, RetentionMomentAttribution>,
  deepFeedback: Map<number, DeepWindowFeedback[]>,
): number {
  return windows.findIndex(
    (window) =>
      !window.outOfRange &&
      rendersFeedbackTabs(
        attribution.get(window.windowIndex),
        deepFeedback.get(window.windowIndex) ?? [],
      ),
  )
}

// The mark a footage tab wears until the creator opens one: a small pulsing
// dot, the same signal an unread item carries elsewhere. Paired with the
// callout hung under the first of these strips, which is what actually says
// what the tabs are - a dot on its own can only draw the eye, not explain.
function NewFootageTabDot({ shown }: { shown: boolean }) {
  if (!shown) return null
  return (
    <span
      aria-hidden="true"
      className="size-1.5 animate-pulse rounded-full bg-primary"
    />
  )
}

// The callout that explains those dots, hung off the tab strip it points at the
// way the chart's coach mark hangs off its marker: absolutely placed, so it
// floats over the row's feedback instead of pushing the lists down the page
// when it appears - and leaves nothing to settle back when it goes.
//
// It sits below the strip rather than above it so the tabs themselves stay
// clickable: opening one is what the hint is asking for.
function FootageTabsHintCallout({
  shown,
  onDismiss,
}: {
  shown: boolean
  onDismiss: () => void
}) {
  if (!shown) return null
  return (
    <div className="absolute top-full left-0 z-20 mt-2 w-max">
      <HintCallout
        title="New tabs, read from your footage"
        arrow={{ side: "top", align: "start" }}
        onDismiss={onDismiss}
      >
        These each hold a conclusion the deeper analysis drew from your frames
        and audio, alongside what the script alone says. Open one to see its
        evidence.
      </HintCallout>
    </div>
  )
}

// A window's feedback block, rendered together with the row's header so the
// Script/deep tab switcher can sit inline on the top row (after the transcript
// quote) rather than below it. `header` is given the tab list to place in that
// row - or null when there are no tabs to show - and returns the full header.
//
// The Script tab carries the transcript reading of the window - its explanation
// and the tip under it - but only where the transcript earned a tip of its own
// (see THE WARRANT in lib/retention-attribution.ts) that no deep tab already
// says better. Each *unique* deep tip synthesised from the window's events then
// earns its own tab (reasoning above the tip); duplicate and tipless events are
// dropped so the switcher only ever holds distinct, actionable feedback. When
// just one source of feedback survives, it renders flat below the header
// exactly as before. resolveWindowFeedback settles all of this.
function WindowFeedback({
  header,
  attribution,
  deepFeedback,
  section,
  anchorsFootageTabsHint = false,
}: {
  header: (tabs: React.ReactNode) => React.ReactNode
  attribution: RetentionMomentAttribution | undefined
  deepFeedback: DeepWindowFeedback[]
  // Which retention list this window belongs to ("Hook", "Drop-off", "Gain",
  // "Hold"), so a tip kept from it says where it was read.
  section: string
  // Whether this row is the one carrying the footage-tabs coach mark. Every
  // tabbed row wears the dots, but the bubble that explains them belongs on
  // exactly one of them - the first in the list on show, chosen by the list.
  anchorsFootageTabsHint?: boolean
}) {
  // Until the creator has opened one, the tabs the deeper analysis added are
  // marked as new and any of them being opened is what retires that hint for
  // good. See ONBOARDING_HINTS in lib/onboarding-hints.ts.
  const footageTabsHint = useOnboardingHint("deep_analysis_window_tabs")
  const onTabChange = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("deep-")) {
      footageTabsHint.dismiss()
    }
  }
  // The window's feedback as it will actually be shown: the script reading only
  // where it still has a tip of its own to give, and one entry per distinct deep
  // tip. Everything tipless has already been dropped, so nothing below has to
  // ask again whether a tab is worth drawing.
  const { script, deep: uniqueDeep } = resolveWindowFeedback(
    attribution,
    deepFeedback,
  )
  const hasDeep = uniqueDeep.length > 0

  if (script && hasDeep) {
    return (
      <Tabs defaultValue="script" className="gap-2" onValueChange={onTabChange}>
        {header(
          // Sized to the tab strip (w-fit), so the glow hung on it traces the
          // tabs rather than the width of the header row they sit in.
          <div className="relative w-fit">
            <TabsList>
              <TabsTrigger value="script">Script</TabsTrigger>
              {uniqueDeep.map(({ insight }, index) => (
                <TabsTrigger key={insight.id} value={`deep-${insight.id}`}>
                  <NewFootageTabDot shown={footageTabsHint.pending} />
                  {deepFeedbackTabLabel(insight, index, uniqueDeep)}
                </TabsTrigger>
              ))}
            </TabsList>
            <HintTargetGlow
              shown={anchorsFootageTabsHint && footageTabsHint.pending}
            />
            <FootageTabsHintCallout
              shown={anchorsFootageTabsHint && footageTabsHint.pending}
              onDismiss={footageTabsHint.dismiss}
            />
          </div>
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
      <Tabs
        defaultValue={defaultValue}
        className="gap-2"
        onValueChange={onTabChange}
      >
        {header(
          <div className="relative w-fit">
            <TabsList>
              {uniqueDeep.map(({ insight }, index) => (
                <TabsTrigger key={insight.id} value={`deep-${insight.id}`}>
                  <NewFootageTabDot shown={footageTabsHint.pending} />
                  {deepFeedbackTabLabel(insight, index, uniqueDeep)}
                </TabsTrigger>
              ))}
            </TabsList>
            <HintTargetGlow
              shown={anchorsFootageTabsHint && footageTabsHint.pending}
            />
            <FootageTabsHintCallout
              shown={anchorsFootageTabsHint && footageTabsHint.pending}
              onDismiss={footageTabsHint.dismiss}
            />
          </div>
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
  footageTabsHint = false,
}: {
  // The significant *mid-video* drop-offs (kind = 'drop_off') that carry a tip;
  // the caller has already dropped the rest, and numbers the chart's markers off
  // this same list. The Hook section above already covers the opening, so these
  // never overlap it.
  drops: RetentionWindow[]
  transcript: TranscriptCue[]
  // AI explanations/tips keyed by the drop-off's windowIndex, when generated.
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
  footageTabsHint?: boolean
}) {
  const highlightedRef = useHighlightScroll(highlightedId)
  const hintRowIndex = footageTabsHint
    ? firstTabbedRowIndex(drops, attribution, deepFeedback)
    : -1

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
              anchorsFootageTabsHint={index === hintRowIndex}
              header={(tabs) => (
                <div className="flex min-h-[2.625rem] items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(drop.fromSeconds)} -{" "}
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
  footageTabsHint = false,
}: {
  gains: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
  footageTabsHint?: boolean
}) {
  const highlightedRef = useHighlightScroll(highlightedId)
  const hintRowIndex = footageTabsHint
    ? firstTabbedRowIndex(gains, attribution, deepFeedback)
    : -1

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
              anchorsFootageTabsHint={index === hintRowIndex}
              header={(tabs) => (
                <div className="flex min-h-[2.625rem] items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(gain.fromSeconds)} -{" "}
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
  footageTabsHint = false,
}: {
  // Only the holds carrying a tip: the caller has already dropped the rest, the
  // way it does for every retention list (see THE ROWS ARE THE TIPS, where
  // `holds` is built). Rows are numbered by position here, so this must be the
  // same list the chart's hold markers were built from.
  holds: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
  highlightedId?: string | null
  footageTabsHint?: boolean
}) {
  const highlightedRef = useHighlightScroll(highlightedId)
  const hintRowIndex = footageTabsHint
    ? firstTabbedRowIndex(holds, attribution, deepFeedback)
    : -1

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
              anchorsFootageTabsHint={index === hintRowIndex}
              header={(tabs) => (
                <div className="flex min-h-[2.625rem] items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {formatTimestamp(hold.fromSeconds)} -{" "}
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

// The model's read of the three surfaces a viewer meets, one per tab, with the
// alignment score this video was given at analysis time behind a fourth tab
// after them, all of it headed by the two-sentence summary of the packaging as
// a whole.
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
      <PackagingSummary summary={alignment.overall} />

      {alignment.components ? (
        <PackagingComponentTabs
          components={alignment.components}
          taxonomy={alignment.taxonomy}
          hookQuote={hookQuote}
        />
      ) : (
        // Older alignments were stored before the per-component breakdown
        // existed, so there is no tab bar to hang the alignment read off:
        // fall back to the flat two-column layout, with the alignment card
        // heading it the way it used to head the tabs.
        <>
          {alignment.taxonomy && (
            <AlignmentCard taxonomy={alignment.taxonomy} titled />
          )}
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
        </>
      )}
    </div>
  )
}

// What the three surfaces add up to, in the box that heads the packaging tabs,
// the same way the packaging head-to-head and the retention head-to-head head
// their own sections (components/packaging-comparison.tsx,
// components/retention-head-to-head.tsx).
//
// Two sentences is the whole budget (limitSentences, capped at
// SUMMARY_SENTENCE_LIMIT), and the cap is the point rather than a safety net: a
// creator opening this section wants the verdict at a glance, and a paragraph
// walking through the title, then the thumbnail, then the hook only restates
// what the three tabs under it already say, one surface per tab. The prompt is
// asked for the short version too (PACKAGING_ALIGNMENT_PROMPT); this trims the
// summaries stored before it was, which no prompt can reach.
function PackagingSummary({ summary }: { summary: string }) {
  if (!summary.trim()) return null
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">Summary</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {limitSentences(cleanCopy(summary))}
      </p>
    </div>
  )
}

// How tightly this video's title, thumbnail and hook promise one thing, drawn
// as the same readout channel trends puts behind a library-wide average and the
// packaging head-to-head puts in each of its two columns
// (components/packaging-alignment-score.tsx), so the number a creator meets here
// is visibly the number those pages are averaging and ranking.
//
// It sits behind the fourth packaging tab, so it is normally framed by the same
// badge the other three tabs open with; `titled` gives it the plain heading it
// wore when it headed the section instead, for the older alignments that have no
// tab bar to sit in.
function AlignmentCard({
  taxonomy,
  titled = false,
}: {
  taxonomy: PackagingTaxonomy
  titled?: boolean
}) {
  // Stored 0..1, printed 0-10 to one decimal, the same scaling the channel
  // average uses, so 0.78 reads as 7.8 on both pages.
  const score = Math.round(taxonomy.alignmentScore * 100) / 10

  // The two links the headline is made of. Both come off the enriched (v2)
  // taxonomy, so a video analysed before that existed shows the headline alone.
  const cross = taxonomy.detail?.cross
  const parts = cross
    ? [
        {
          label: ALIGNMENT_PART_LABEL.titleThumbnailMatch,
          value: cross.titleThumbnailMatch,
        },
        {
          label: ALIGNMENT_PART_LABEL.hookDeliversPromise,
          value: cross.hookDeliversPromise,
        },
      ]
    : []

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border bg-card p-4">
      {titled ? (
        <h3 className="text-sm font-medium">Alignment</h3>
      ) : (
        <PackagingComponentBadge label="Alignment" />
      )}
      <PackagingAlignmentScore score={score} parts={parts} />
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

// The three surfaces a viewer meets, then how well they agree, in the same
// reading order and behind the same glyphs as the packaging head-to-head
// (components/packaging-comparison.tsx) and the channel-wide packaging strip
// (components/channel-trends-packaging-tabs.tsx), so a creator meets the same
// four objects wherever the product talks about packaging. Alignment comes last
// because it is about the other three rather than a surface of its own, and it
// is dropped where the video has no stored taxonomy to score.
function PackagingComponentTabs({
  components,
  taxonomy = null,
  hookQuote = null,
}: {
  components: NonNullable<PackagingAlignment["components"]>
  taxonomy?: PackagingTaxonomy | null
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
        {taxonomy && (
          <TabsTrigger value="alignment">
            <AlignHorizontalJustifyCenterIcon className="text-muted-foreground" />
            Alignment
          </TabsTrigger>
        )}
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

      {taxonomy && (
        <TabsContent value="alignment" className="w-full">
          <AlignmentCard taxonomy={taxonomy} />
        </TabsContent>
      )}
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
            <TryCallout
              key={index}
              section={`Packaging: ${label}`}
              examples={feedback.examples}
            >
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

// A coloured dot alone left readers guessing - nothing on the card said what
// green meant. A familiar icon per status carries the verdict visually: a tick
// for fine, a warning triangle for worth fixing, a bulb for optional. The
// plain-language word stays as the icon's accessible name so colour and glyph
// are reinforcement rather than the only signal (which keeps it legible for
// colour-blind and screen-reader users) without a visible badge crowding the
// card's top-right corner.
const HYGIENE_STATUS_META: Record<
  HygieneStatus,
  {
    icon: ComponentType<{ className?: string }>
    label: string
    tone: string
  }
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
      <ul className="grid gap-4 sm:grid-cols-2">
        {hygiene.checks.map((check) => {
          const { icon: Icon, label, tone } = HYGIENE_STATUS_META[check.status]
          return (
            <li
              key={check.id}
              // A grid rather than a flex row so the detail lines up under the
              // title rather than under the icon: the icon owns the first
              // column, and the detail starts in the second alongside it.
              className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 rounded-xl border bg-card p-4"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
              <span className="min-w-0 text-sm font-medium">
                {check.label}
                <span className="sr-only"> - {label}</span>
              </span>
              <p className="col-start-2 text-sm text-muted-foreground">
                {check.detail}
              </p>
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
  deepAnalysisComplete = false,
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
  // Whether this video's uploaded footage has been through the deeper analysis
  // and settled. Both coach marks below wait for it: that is the render where
  // the report gains everything they point at, and it arrives on its own (the
  // status poll refreshes the route when a run lands) while the creator is
  // reading. Pointing at the tabs any earlier would point at nothing, and
  // teaching playback while the analysis still ran would spend the one showing
  // each hint gets on half the news.
  deepAnalysisComplete?: boolean
}) {
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const [playbackWindow, setPlaybackWindow] = useState<{
    id: string
    fromSeconds: number
    toSeconds: number
  } | null>(null)
  const insightAreaRef = useRef<HTMLDivElement | null>(null)

  // The two things a finished analysis of an upload leaves behind that nothing
  // on the page otherwise announces: highlights that play their moment back,
  // and the tabs it adds to each window. Each is pointed at once and never
  // again - see ONBOARDING_HINTS in lib/onboarding-hints.ts.
  const playbackHint = useOnboardingHint("retention_insight_playback")
  const footageTabsHint = useOnboardingHint("deep_analysis_window_tabs")

  // Dismiss the open insight (returning the video to its thumbnail) when the
  // user clicks anywhere outside the video/chart area - not just inside the
  // chart itself - so scrolling down and clicking elsewhere on the page
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

  const detectedHooks = retentionWindows.filter((w) => w.kind === "hook")
  // The opening hook line, surfaced next to the purple "Hook" badge in the
  // packaging section above so it reads without hovering the retention list.
  // Read off every hook window detected rather than off the rows below, since
  // it quotes the opening rather than reporting a finding about it.
  const firstHookWindow = detectedHooks[0]
  const hookQuote = firstHookWindow
    ? hookOpeningQuote(
        transcript,
        firstHookWindow.fromSeconds,
        firstHookWindow.toSeconds,
      )
    : null
  const detectedDrops = retentionWindows.filter((w) => w.kind === "drop_off")
  const detectedGains = retentionWindows.filter((w) => w.kind === "gain")
  const detectedHolds = retentionWindows.filter((w) => w.kind === "hold")

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

  // THE ROWS ARE THE TIPS. A window earns a place in these lists only when the
  // analysis had advice to give about it, and every count below reads off the
  // filtered lists: the chart marks only these windows, a retention tab appears
  // only if one of its windows survived, and the rows are numbered by position
  // in the list rather than by the index of the window on the curve.
  //
  // The measurement on its own is not a finding. A creator looking at the curve
  // can already see that retention fell at 1:29 and held flat at 8:40; what they
  // came here for is what to do about it. A row that gives them a timestamp, a
  // percentage they can read off the chart and a sentence restating both is
  // noise between the rows that actually help, and it makes the report look
  // longer than its analysis is. See hasWindowTip for the several reasons a
  // window reaches this point with no tip on it.
  const windowsWithTips = (
    windows: RetentionWindow[],
    section: RetentionSectionFeedback,
  ) =>
    windows.filter((window) =>
      hasWindowTip(
        section.attribution.get(window.windowIndex),
        section.deepFeedback.get(window.windowIndex) ?? [],
      ),
    )
  const hookWindows = windowsWithTips(detectedHooks, hookSection)
  const drops = windowsWithTips(detectedDrops, dropSection)
  const gains = windowsWithTips(detectedGains, gainSection)
  const holds = windowsWithTips(detectedHolds, holdSection)
  // Same rule for the pacing list, which carries its tip inline rather than in a
  // feedback block: a stretch whose suggestion the uniqueness pass blanked has
  // nothing left to act on. Filtered off the deduped analysis so the rows and the
  // chart's pacing markers are numbered off one list (see dedupePacingTips).
  const pacingStretches = (
    dedupedPacingAnalysis?.slowOrRepetitiveStretches ?? []
  ).filter((stretch) => stretch.suggestion.trim() !== "")
  const pacingAnalysisWithTips = dedupedPacingAnalysis
    ? {
        ...dedupedPacingAnalysis,
        slowOrRepetitiveStretches: pacingStretches,
      }
    : null
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

  // Whether any window below actually renders a tab switcher. The footage tabs
  // only appear where the deeper analysis reached distinct, actionable
  // conclusions, so a report can have a finished analysis and still show none -
  // and a callout explaining tabs that aren't there would be worse than silence.
  //
  // Where they do appear, the list on show hangs the callout off its own first
  // tabbed row, so the bubble always points at tabs the creator can see.
  const showFootageTabsHint =
    footageTabsHint.pending &&
    deepAnalysisComplete &&
    [hookSection, dropSection, gainSection, holdSection].some(
      ({ attribution, deepFeedback }) =>
        [...deepFeedback.entries()].some(([windowIndex, feedback]) =>
          rendersFeedbackTabs(attribution.get(windowIndex), feedback),
        ),
    )

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
    // Numbered off `drops` - the drop-offs that earned a row - rather than off
    // the window index, so "Significant drop-off 2" is the second row of the
    // list the marker jumps to. Same for the gains and holds below.
    ...drops.map((window, index) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )

      return {
        id: `drop-${window.windowIndex}`,
        kind: "drop" as const,
        label: `Significant drop-off ${index + 1}`,
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
    ...gains.map((window, index) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )

      return {
        id: `gain-${window.windowIndex}`,
        kind: "gain" as const,
        label: `Retention gain ${index + 1}`,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        metric: `+${(window.delta * 100).toFixed(1)}%`,
        metricLabel: "audience retention",
        transcript: said || undefined,
      }
    }),
    ...holds.map((window, index) => {
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
        label: `Audience hold ${index + 1}`,
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
    // Built from the deduped, tip-carrying stretches rather than the raw ones,
    // so a marker is numbered off the same ordered list its row is numbered off
    // (see dedupePacingTips) and carries the suggestion the row actually shows.
    // Read straight from the model instead, these markers were numbered by the
    // model's own ranking while the rows below were numbered chronologically.
    ...pacingStretches.map(
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

  // Once the footage has been analysed, point at the first highlight on the
  // curve: nothing else on the page says that clicking one now plays that
  // moment back. Read here rather than inline below because the tip coach mark
  // stands down while it is up.
  const showPlaybackHint =
    playbackHint.pending && deepAnalysisComplete && chartInsights.length > 0

  // Whether the report's first tip wears the mark saying that a tip opens.
  //
  // It stands down while either footage coach mark is on screen. Those two
  // announce something that has just landed and are worth the one showing they
  // get; this one is about advice that has been on the page since the report
  // was opened and will be there on the next report too. Three bubbles at once
  // over one report teaches none of them.
  const showTipActionsHint = !showPlaybackHint && !showFootageTabsHint

  return (
    <FirstTipHintProvider enabled={showTipActionsHint}>
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
                with the scroll - staying visible while the reader works through a
                long list - until the bottom of this section scrolls past. */}
            <div className="relative flex flex-col gap-3">
              {video.thumbnailUrl && (
                <div className="pointer-events-none absolute inset-0 z-20">
                  <div className="sticky top-4 flex justify-end px-5 pt-5">
                    <div className="w-1/2 max-w-84">
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
                hint={
                  showPlaybackHint
                    ? {
                        insightId: chartInsights[0].id,
                        render: (arrow) => (
                          <HintCallout
                            title="Your footage is in"
                            arrow={arrow}
                            onDismiss={playbackHint.dismiss}
                          >
                            Click a highlight to watch that exact moment back from
                            the file you uploaded.
                          </HintCallout>
                        ),
                      }
                    : null
                }
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
                  // Opening a highlight is the thing the hint was asking for, so
                  // it has served its purpose whether or not it was read.
                  if (insight) playbackHint.dismiss()
                }}
              />

              {!defaultRetentionTab && (
                <NoRetentionTips deepAnalysisComplete={deepAnalysisComplete} />
              )}

              {defaultRetentionTab && (
                <Tabs
                  value={retentionTab ?? defaultRetentionTab}
                  onValueChange={(value) => setRetentionTab(value as string)}
                >
                {/* The info affordance sits inline to the right of the tabs, so
                    the explanation of how a window is picked (and what it takes
                    to earn a tip) is one click from the list it describes. */}
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
                      footageTabsHint={showFootageTabsHint}
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
                      footageTabsHint={showFootageTabsHint}
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
                      footageTabsHint={showFootageTabsHint}
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
                      footageTabsHint={showFootageTabsHint}
                    />
                  </TabsContent>
                )}

                {pacingStretches.length > 0 && (
                  <TabsContent value="pacing">
                    <PacingAnalysisSection
                      analysis={pacingAnalysisWithTips}
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
    </FirstTipHintProvider>
  )
}
