import Link from "next/link"
import {
  AreaChartIcon,
  ChevronDownIcon,
  ImageIcon,
  LibraryIcon,
  LockIcon,
  MinusIcon,
  PackageIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UserPlusIcon,
} from "lucide-react"

import {
  insightCopy,
  packagingFeatureLabel,
} from "@/components/channel-trends-copy"
import {
  EventTypeBadge,
  formatEventTypeLabel,
} from "@/components/event-type-badge"
import { HookIcon } from "@/components/hook-icon"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  EARLY_TRENDS_VIDEO_THRESHOLD,
  ESTABLISHED_TRENDS_VIDEO_THRESHOLD,
  SIGNAL_STRONG_THRESHOLD,
  type ChannelInsight,
  type ChannelKindTrends,
  type ChannelPackagingPatterns,
  type ChannelRecurrence,
  type ChannelRecurrenceRow,
  type ChannelSignatureRow,
  type ChannelSubscriberConversion,
  type ChannelTrend,
  type ChannelTrendsData,
  type ChannelVideo,
  type PackagingFeatureContrast,
  type PackagingReachVideo,
  type PackagingTopicReach,
  type SubscriberPattern,
  type SubscriberVideoRow,
} from "@/lib/channel-trends"
import { stripEmDashes } from "@/lib/copy-guardrails"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"

// The Channel Trends page body: the library header, then two titled
// sections. Retention holds the insight cards (written feedback for the few
// patterns that earned it), the drop-vs-gain signature chart, the recurrence
// strip across recent uploads, and the full per-type breakdown as an
// appendix. Packaging holds which uploads earn reach and which convert
// viewers into subscribers. Purely presentational; all aggregation and
// gating lives in lib/channel-trends.ts, all insight copy in
// components/channel-trends-copy.ts.
//
// COPY GUARDRAIL: no em dashes (U+2014), ever, in any text on this page.
// Hyphens are fine. See lib/copy-guardrails.ts; enforced by
// lib/__tests__/copy-guardrails.test.ts.

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function LibraryStats({ data }: { data: ChannelTrendsData }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile label="Videos in your library" value={data.libraryVideoCount} />
      <StatTile label="Retention windows analysed" value={data.windowCount} />
      <StatTile label="Retention events collected" value={data.eventCount} />
    </div>
  )
}

// The progressive-unlock meter. Building toward EARLY it counts down to the
// first trends; from EARLY it counts toward full strength; at ESTABLISHED it
// becomes a quiet confirmation instead of a bar.
function StageProgress({ data }: { data: ChannelTrendsData }) {
  if (data.stage === "established") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm">
        <SparklesIcon className="size-4 shrink-0 text-primary" />
        <span>
          Trends at full strength - built from{" "}
          {plural(data.libraryVideoCount, "deeply analysed video")}.
        </span>
      </div>
    )
  }

  const target =
    data.stage === "early"
      ? ESTABLISHED_TRENDS_VIDEO_THRESHOLD
      : EARLY_TRENDS_VIDEO_THRESHOLD
  const percent = Math.min(100, (data.libraryVideoCount / target) * 100)
  const remaining = target - data.libraryVideoCount
  const message =
    data.stage === "early"
      ? `${data.libraryVideoCount} of ${target} videos - trends strengthening as your library grows.`
      : `Deeply analyse ${plural(remaining, "more video")} to unlock early trends.`

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{message}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {data.libraryVideoCount}/{target}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insight cards - the page's hero: written verdicts for the few patterns that
// cleared the signal gates, each with its evidence and a concrete suggestion.

const INSIGHT_KIND_META = {
  fix: {
    label: "Your biggest fix",
    actionTitle: "Try this in your next video",
    Icon: TrendingDownIcon,
    text: "text-destructive",
    border: "border-t-destructive",
    edge: "border-l-destructive",
    fill: "bg-destructive",
  },
  strength: {
    label: "Your biggest strength",
    actionTitle: "Do more of this",
    Icon: TrendingUpIcon,
    text: "text-emerald-600 dark:text-emerald-500",
    border: "border-t-emerald-600 dark:border-t-teal-600",
    edge: "border-l-emerald-600 dark:border-l-teal-600",
    fill: "bg-emerald-600 dark:bg-teal-600",
  },
  hook: {
    label: "Your hook pattern",
    actionTitle: "Study your openings",
    Icon: HookIcon,
    text: "text-yellow-600 dark:text-yellow-400",
    border: "border-t-yellow-500",
    edge: "border-l-yellow-500",
    fill: "bg-yellow-500",
  },
} as const

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  )
}

// "Almost never in your gains" / "3× more common in drops than gains" - the
// contrast evidence, phrased only when it's pronounced enough to say.
function contrastChip(insight: ChannelInsight): string | null {
  if (insight.contrast == null) return null
  const [own, opposite] =
    insight.kind === "fix" ? ["drops", "gains"] : ["gains", "drops"]
  if (insight.contrast >= 0.95) return `almost never in your ${opposite}`
  const times = insight.contrast / (1 - insight.contrast)
  if (times >= 2)
    return `${Math.round(times)}× more common in ${own} than ${opposite}`
  return null
}

function SignalMeter({
  signal,
  fillClass,
}: {
  signal: number
  fillClass: string
}) {
  const band = signal >= SIGNAL_STRONG_THRESHOLD ? "strong" : "emerging"
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${fillClass}`}
          style={{ width: `${Math.min(100, signal)}%` }}
        />
      </div>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        Signal strength {signal} · {band}
      </span>
    </div>
  )
}

function EventReceipt({
  narrative,
  videoTitle,
}: {
  narrative: string
  videoTitle: string | null
}) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 pl-3 text-xs">
      <p className="text-muted-foreground">{stripEmDashes(narrative)}</p>
      {videoTitle && (
        <span className="text-muted-foreground/80">{videoTitle}</span>
      )}
    </div>
  )
}

const INSIGHT_RECEIPT_LIMIT = 3

function InsightCard({
  insight,
  trend,
}: {
  insight: ChannelInsight
  trend: ChannelTrend | undefined
}) {
  const meta = INSIGHT_KIND_META[insight.kind]
  const copy = insightCopy(insight.kind, insight.eventType)
  const contrast = contrastChip(insight)
  const receipts = trend?.events.slice(0, INSIGHT_RECEIPT_LIMIT) ?? []
  const hidden = insight.eventCount - receipts.length

  return (
    <Card className={`flex flex-col gap-3 border-t-2 p-5 ${meta.border}`}>
      <div
        className={`flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase ${meta.text}`}
      >
        <meta.Icon className="size-3.5" />
        {meta.label}
      </div>
      <h3 className="text-base font-semibold">{copy.headline}</h3>
      <div className="flex flex-wrap gap-1.5">
        <Chip>{plural(insight.videoCount, "video")}</Chip>
        <Chip>{plural(insight.eventCount, "event")}</Chip>
        <Chip>avg confidence {insight.meanConfidence.toFixed(2)}</Chip>
        {contrast && <Chip>{contrast}</Chip>}
      </div>
      <SignalMeter signal={insight.signal} fillClass={meta.fill} />
      <div
        className={`rounded-r-md border-l-2 bg-muted/50 px-3 py-2 text-sm ${meta.edge}`}
      >
        <span
          className={`mb-0.5 block text-xs font-semibold tracking-wide uppercase ${meta.text}`}
        >
          {meta.actionTitle}
        </span>
        {copy.action}
      </div>
      {receipts.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <ChevronDownIcon className="size-3.5 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
            See the {plural(insight.eventCount, "event")} behind this
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2 pl-4">
            {receipts.map((event, index) => (
              <EventReceipt
                key={`${event.videoTitle ?? ""}:${event.narrative}:${index}`}
                narrative={event.narrative}
                videoTitle={event.videoTitle}
              />
            ))}
            {hidden > 0 && (
              <p className="pl-3 text-xs text-muted-foreground">
                and {plural(hidden, "more event")} in the full breakdown below
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  )
}

// Where an insight's receipts live: the matching per-kind trend row.
function trendForInsight(
  data: ChannelTrendsData,
  insight: ChannelInsight,
): ChannelTrend | undefined {
  const kind =
    insight.kind === "fix"
      ? data.dropOffs
      : insight.kind === "strength"
        ? data.gains
        : data.hooks
  return kind?.trends.find((trend) => trend.eventType === insight.eventType)
}

// ---------------------------------------------------------------------------
// Subscriber conversion - which uploads turn viewers into subscribers, per
// 1,000 views so big and small videos compare fairly. Neutral bars against a
// dashed channel-median line; only the outliers get a colour and a badge.
// When magnet videos exist, the card also shows the gain/hook patterns every
// magnet had that the rest of the library mostly lacked - phrased as leads,
// not causes, because subscribing is also topic, packaging and reach.

// Compact human number: 12345 -> "12.3K", 2_400_000 -> "2.4M".
function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatRate(rate: number): string {
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)
}

const SUBSCRIBER_OUTCOME_META = {
  magnet: {
    badge: "subscriber magnet",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
    barClass: "bg-emerald-600 dark:bg-teal-600",
  },
  leak: {
    badge: "net loss",
    badgeClass: "bg-destructive/10 text-destructive",
    barClass: "bg-destructive",
  },
  typical: {
    badge: null,
    badgeClass: "",
    barClass: "bg-muted-foreground/40",
  },
} as const

// Bars scale so the largest fills this much of the track - the rest keeps the
// median line legible even when the median sits near the maximum.
const CONVERSION_BAR_MAX_PERCENT = 92

function conversionRowTitle(row: SubscriberVideoRow): string {
  const title = row.title ?? "Untitled video"
  const net =
    row.netGained == null
      ? ""
      : ` (${row.netGained >= 0 ? "+" : "-"}${Math.abs(row.netGained)} net)`
  return `${title} - +${row.subscribersGained} subscribers from ${formatCompactNumber(row.views)} views, ${formatRate(row.ratePer1k)} per 1k${net}`
}

// The row KPI: net subscribers gained, falling back to gross gains when the
// snapshot never reported losses.
function formatNetSubscribers(row: SubscriberVideoRow): string {
  const value = row.netGained ?? row.subscribersGained
  return value >= 0 ? `+${value}` : `${value}`
}

function ConversionRow({
  row,
  maxRate,
  medianRate,
}: {
  row: SubscriberVideoRow
  maxRate: number
  medianRate: number
}) {
  const meta = SUBSCRIBER_OUTCOME_META[row.outcome]
  const scale = (rate: number) =>
    maxRate > 0 ? (rate / maxRate) * CONVERSION_BAR_MAX_PERCENT : 0
  return (
    <div
      className="grid grid-cols-[minmax(6.5rem,13rem)_1fr_5.5rem] items-center gap-x-3 py-1.5"
      title={conversionRowTitle(row)}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="w-full truncate text-sm">
          {row.title ?? "Untitled video"}
        </span>
        {meta.badge && (
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${meta.badgeClass}`}
          >
            {meta.badge}
          </span>
        )}
      </div>
      <div className="relative h-4">
        <div
          className={`absolute inset-y-0 left-0 rounded-r-sm ${meta.barClass}`}
          style={{ width: `${scale(row.ratePer1k)}%` }}
        />
        <div
          className="absolute inset-y-0 border-l border-dashed border-foreground/40"
          style={{ left: `${scale(medianRate)}%` }}
        />
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium tabular-nums">
          {formatNetSubscribers(row)}
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            {row.netGained == null ? "subs" : "net subs"}
          </span>
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatCompactNumber(row.views)} views
        </span>
      </div>
    </div>
  )
}

function SubscriberPatternRow({ pattern }: { pattern: SubscriberPattern }) {
  const where =
    pattern.side === "hook" ? "in the opening" : "in retention gains"
  const magnets =
    pattern.magnetVideoCount === 1
      ? "your magnet video"
      : `all ${pattern.magnetVideoCount} magnet videos`
  const others =
    pattern.otherVideoCount === 0
      ? `none of your ${plural(pattern.otherTotal, "other video")}`
      : `only ${pattern.otherVideoCount} of your ${plural(pattern.otherTotal, "other video")}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <EventTypeBadge eventType={pattern.eventType} />
        <span className="text-xs text-muted-foreground">
          {where} - in {magnets}, {others}
        </span>
      </div>
      {pattern.events.map((event, index) => (
        <EventReceipt
          key={`${event.videoTitle ?? ""}:${event.narrative}:${index}`}
          narrative={event.narrative}
          videoTitle={event.videoTitle}
        />
      ))}
    </div>
  )
}

function SubscriberConversionCard({
  conversion,
}: {
  conversion: ChannelSubscriberConversion
}) {
  const maxRate = Math.max(
    conversion.medianRatePer1k,
    ...conversion.rows.map((row) => row.ratePer1k),
  )
  const leaks = conversion.rows.filter((row) => row.outcome === "leak")
  const hasOutliers = conversion.magnetCount > 0 || conversion.leakCount > 0

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <div className="flex items-center gap-1.5">
          <UserPlusIcon className="size-4 text-emerald-600 dark:text-emerald-500" />
          <h3 className="text-sm font-semibold">Subscriber conversion</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Which uploads turn viewers into subscribers. Bars rank each upload
          by subscribers gained per 1,000 views so a small video and a big one
          compare fairly; the dashed line is your channel median. Hover a row
          for the raw numbers.
        </p>
      </div>
      <div>
        {conversion.rows.map((row) => (
          <ConversionRow
            key={row.id}
            row={row}
            maxRate={maxRate}
            medianRate={conversion.medianRatePer1k}
          />
        ))}
      </div>
      {!hasOutliers && (
        <p className="text-xs text-muted-foreground">
          No outliers yet - your uploads convert at a similar rate. When one
          breaks away from the median, it gets flagged here.
        </p>
      )}
      {conversion.patterns.length > 0 && (
        <div className="flex flex-col gap-3 rounded-r-md border-l-2 border-l-emerald-600 bg-muted/50 px-3 py-2.5 dark:border-l-teal-600">
          <div>
            <span className="text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-500">
              What your subscriber magnets did differently
            </span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Patterns in every magnet&apos;s openings or retention gains that
              are rare across the rest of your library. Correlation, not proof
              - but the first place to look.
            </p>
          </div>
          {conversion.patterns.map((pattern) => (
            <SubscriberPatternRow
              key={`${pattern.side}:${pattern.eventType}`}
              pattern={pattern}
            />
          ))}
        </div>
      )}
      {leaks.map((row) => (
        <p key={row.id} className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
          <span className="font-semibold">Net loss:</span>{" "}
          {row.title ?? "An untitled video"} lost more subscribers than it
          gained ({row.netGained} net). Worth re-watching what its title and
          thumbnail promised against what the video delivered.
        </p>
      ))}
      {conversion.coveredVideoCount < conversion.libraryVideoCount && (
        <p className="text-xs text-muted-foreground">
          Based on the {conversion.coveredVideoCount} of your{" "}
          {plural(conversion.libraryVideoCount, "library video")} with
          subscriber data. Older analyses pick theirs up the next time you
          open them.
        </p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Packaging patterns - which uploads earn reach, and what their packaging has
// in common. Reach is views per day at snapshot time (raw views can't compare
// a two-week-old upload with a two-year-old one); the covered videos split
// into a high- and low-reach half, and the card reports the packaging traits
// (title style, thumbnail composition, promise, hook delivery) common in one
// half and rare in the other, plus topics that over- or under-perform the
// channel's typical reach. All bars share one neutral hue - banding is
// labelled, never colour-alone - and everything is phrased as correlation.

const REACH_BAND_META = {
  high: {
    badge: "high reach",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  },
  low: { badge: "low reach", badgeClass: "bg-muted text-muted-foreground" },
  middle: { badge: null, badgeClass: "" },
} as const

function reachRowTitle(row: PackagingReachVideo): string {
  const title = row.title ?? "Untitled video"
  const share =
    row.browseSuggestedShare == null
      ? ""
      : ` · ${Math.round(row.browseSuggestedShare * 100)}% from Browse & Suggested`
  const pending = row.hasTaxonomy ? "" : " · packaging read pending"
  return `${title} - ${formatCompactNumber(row.views)} views in ${plural(row.ageDays, "day")} (${formatRate(row.viewsPerDay)}/day)${share}${pending}`
}

function ReachRow({
  row,
  maxRate,
  medianRate,
}: {
  row: PackagingReachVideo
  maxRate: number
  medianRate: number
}) {
  const meta = REACH_BAND_META[row.band]
  const scale = (rate: number) =>
    maxRate > 0 ? (rate / maxRate) * CONVERSION_BAR_MAX_PERCENT : 0
  return (
    <div
      className="grid grid-cols-[minmax(6.5rem,13rem)_1fr_5.5rem] items-center gap-x-3 py-1.5"
      title={reachRowTitle(row)}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="w-full truncate text-sm">
          {row.title ?? "Untitled video"}
        </span>
        {meta.badge && (
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${meta.badgeClass}`}
          >
            {meta.badge}
          </span>
        )}
      </div>
      <div className="relative h-4">
        <div
          className="absolute inset-y-0 left-0 rounded-r-sm bg-muted-foreground/50"
          style={{ width: `${scale(row.viewsPerDay)}%` }}
        />
        <div
          className="absolute inset-y-0 border-l border-dashed border-foreground/40"
          style={{ left: `${scale(medianRate)}%` }}
        />
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium tabular-nums">
          {formatCompactNumber(row.views)}
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            views
          </span>
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          in {plural(row.ageDays, "day")}
        </span>
      </div>
    </div>
  )
}

function PackagingFeatureRow({
  contrast,
}: {
  contrast: PackagingFeatureContrast
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-sm font-medium">
        {packagingFeatureLabel(contrast.feature)}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        in {contrast.highCount} of {contrast.highTotal} high-reach ·{" "}
        {contrast.lowCount} of {contrast.lowTotal} low-reach
      </span>
    </div>
  )
}

function TopicReachRow({ topic }: { topic: PackagingTopicReach }) {
  const above = topic.ratio >= 1
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="rounded-full border bg-muted px-2 py-0.5 text-xs">
        {stripEmDashes(topic.topic)}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {plural(topic.videoCount, "video")} ·{" "}
        <span
          className={
            above
              ? "font-medium text-emerald-600 dark:text-emerald-500"
              : "font-medium"
          }
        >
          {formatRate(topic.ratio)}× your typical reach
        </span>
      </span>
    </div>
  )
}

function PackagingPatternsCard({
  packaging,
}: {
  packaging: ChannelPackagingPatterns
}) {
  const maxRate = Math.max(
    packaging.medianViewsPerDay,
    ...packaging.videos.map((row) => row.viewsPerDay),
  )

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <div className="flex items-center gap-1.5">
          <ImageIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Packaging patterns</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Which uploads earn reach, and what the packaging of your high-reach
          half has that the low-reach half doesn&apos;t. Bars rank each upload
          by views per day since upload (as of each video&apos;s analytics
          snapshot) so new and old uploads compare fairly; the dashed line is
          your channel median. Hover a row for the raw numbers.
        </p>
      </div>
      <div>
        {packaging.videos.map((row) => (
          <ReachRow
            key={row.id}
            row={row}
            maxRate={maxRate}
            medianRate={packaging.medianViewsPerDay}
          />
        ))}
      </div>
      {packaging.features.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-r-md border-l-2 border-l-emerald-600 bg-muted/50 px-3 py-2.5 dark:border-l-teal-600">
          <div>
            <span className="text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-500">
              What your high-reach packaging does differently
            </span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Packaging traits common in your high-reach half and rare in your
              low-reach half. Correlation, not proof - but worth testing on
              purpose in your next upload.
            </p>
          </div>
          {packaging.features.map((contrast) => (
            <PackagingFeatureRow key={contrast.feature} contrast={contrast} />
          ))}
        </div>
      )}
      {packaging.topics.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold tracking-wide uppercase">
            Reach by topic
          </span>
          {packaging.topics.map((topic) => (
            <TopicReachRow key={topic.topic} topic={topic} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Views per day naturally favours recent uploads, so treat close calls
        loosely.
        {packaging.taxonomyVideoCount < packaging.coveredVideoCount && (
          <>
            {" "}
            Packaging reads cover {packaging.taxonomyVideoCount} of these{" "}
            {plural(packaging.coveredVideoCount, "video")} - older analyses
            pick theirs up the next time you open them.
          </>
        )}
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The channel signature - one diverging chart instead of separate loses/holds
// lists: each event type's confidence-weighted share of drop-off events on
// the left, of gain events on the right. Balanced rows are editing style;
// lopsided rows are the signal.

const VERDICT_META = {
  hurting: {
    label: "hurting you",
    className: "bg-destructive/10 text-destructive",
  },
  working: {
    label: "working for you",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  },
  style: { label: "your style", className: "bg-muted text-muted-foreground" },
  insufficient: {
    label: "too early to call",
    className: "bg-muted text-muted-foreground/70",
  },
} as const

// Bars scale so the largest fills this much of its half - the rest is label
// room, keeping the percentage outside the bar without ever clipping.
const SIGNATURE_BAR_MAX_PERCENT = 80

function SignatureBar({
  share,
  maxShare,
  side,
}: {
  share: number
  maxShare: number
  side: "drop" | "gain"
}) {
  const width =
    maxShare > 0 ? (share / maxShare) * SIGNATURE_BAR_MAX_PERCENT : 0
  const percentLabel = `${Math.round(share * 100)}%`
  const isDrop = side === "drop"
  return (
    <div
      className={`relative h-4 ${isDrop ? "border-r border-border" : ""}`}
      aria-label={`${percentLabel} of ${isDrop ? "drop-off" : "gain"} events`}
    >
      {share > 0 && (
        <>
          <div
            className={
              isDrop
                ? "absolute inset-y-0 right-0 rounded-l-sm bg-destructive"
                : "absolute inset-y-0 left-0 rounded-r-sm bg-emerald-600 dark:bg-teal-600"
            }
            style={{ width: `${width}%` }}
          />
          <span
            className="absolute top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
            style={
              isDrop
                ? { right: `calc(${width}% + 5px)` }
                : { left: `calc(${width}% + 5px)` }
            }
          >
            {percentLabel}
          </span>
        </>
      )}
    </div>
  )
}

const SIGNATURE_GRID =
  "grid grid-cols-[minmax(6.5rem,9.5rem)_1fr_1fr_3.25rem] items-center gap-x-2"
const SIGNATURE_EVENT_LIMIT = 3

function SignatureRow({
  row,
  maxShare,
  libraryVideoCount,
  dropTrend,
  gainTrend,
}: {
  row: ChannelSignatureRow
  maxShare: number
  libraryVideoCount: number
  dropTrend: ChannelTrend | undefined
  gainTrend: ChannelTrend | undefined
}) {
  const verdict = VERDICT_META[row.verdict]
  const dropEvents = dropTrend?.events.slice(0, SIGNATURE_EVENT_LIMIT) ?? []
  const gainEvents = gainTrend?.events.slice(0, SIGNATURE_EVENT_LIMIT) ?? []
  return (
    <Collapsible className="border-b last:border-b-0">
      <CollapsibleTrigger
        className={`${SIGNATURE_GRID} w-full py-2.5 text-left`}
      >
        <div className="flex flex-col items-start gap-1">
          <EventTypeBadge eventType={row.eventType} />
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${verdict.className}`}
          >
            {verdict.label}
          </span>
        </div>
        <SignatureBar share={row.dropShare} maxShare={maxShare} side="drop" />
        <SignatureBar share={row.gainShare} maxShare={maxShare} side="gain" />
        <span className="text-right text-xs tabular-nums text-muted-foreground">
          {row.videoCount}/{libraryVideoCount}
        </span>
      </CollapsibleTrigger>
      {(dropEvents.length > 0 || gainEvents.length > 0) && (
        <CollapsibleContent className="flex flex-col gap-3 pb-3">
          {dropEvents.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-destructive">
                Where it lost viewers
              </p>
              {dropEvents.map((event, index) => (
                <EventReceipt
                  key={`drop:${event.narrative}:${index}`}
                  narrative={event.narrative}
                  videoTitle={event.videoTitle}
                />
              ))}
            </div>
          )}
          {gainEvents.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-500">
                Where it held viewers
              </p>
              {gainEvents.map((event, index) => (
                <EventReceipt
                  key={`gain:${event.narrative}:${index}`}
                  narrative={event.narrative}
                  videoTitle={event.videoTitle}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function SignatureChart({
  rows,
  libraryVideoCount,
  dropOffs,
  gains,
}: {
  rows: ChannelSignatureRow[]
  libraryVideoCount: number
  dropOffs: ChannelKindTrends | null
  gains: ChannelKindTrends | null
}) {
  const maxShare = Math.max(
    ...rows.flatMap((row) => [row.dropShare, row.gainShare]),
  )
  const trendFor = (
    kind: ChannelKindTrends | null,
    eventType: RetentionWindowEventType,
  ) => kind?.trends.find((trend) => trend.eventType === eventType)

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">Your channel signature</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Where each event type shows up when viewers leave vs. when they stay,
          weighted by confidence. Balanced bars are how you edit; lopsided bars
          are the signal.
        </p>
      </div>
      <div>
        <div
          className={`${SIGNATURE_GRID} pb-1.5 text-[10px] font-semibold tracking-wide uppercase`}
        >
          <span />
          <span className="pr-2 text-right text-destructive">
            ◀ in drop-offs
          </span>
          <span className="pl-2 text-emerald-600 dark:text-emerald-500">
            in gains ▶
          </span>
          <span className="text-right text-muted-foreground">videos</span>
        </div>
        {rows.map((row) => (
          <SignatureRow
            key={row.eventType}
            row={row}
            maxShare={maxShare}
            libraryVideoCount={libraryVideoCount}
            dropTrend={trendFor(dropOffs, row.eventType)}
            gainTrend={trendFor(gains, row.eventType)}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Click a row to see the events behind it.
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The recurrence strip - the same patterns laid across the most recent
// uploads, so a streak that's still running (or one that's gone quiet after a
// fix) is visible at a glance.

function formatAnalysedDate(iso: string | null): string | null {
  if (iso == null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function recurrenceCellClass(cell: {
  hit: boolean
  maxConfidence: number | null
  side: "drop_off" | "gain"
}): string {
  if (!cell.hit) return "border bg-muted"
  const color =
    cell.side === "drop_off"
      ? "bg-destructive"
      : "bg-emerald-600 dark:bg-teal-600"
  // Paler = lower confidence; unranked hits sit in the middle band.
  const confidence = cell.maxConfidence ?? 0.7
  const opacity =
    confidence >= 0.8 ? "" : confidence >= 0.65 ? "opacity-75" : "opacity-50"
  return `${color} ${opacity}`.trim()
}

function recurrenceCellTitle(
  video: ChannelVideo,
  row: ChannelRecurrenceRow,
  maxConfidence: number | null,
  hit: boolean,
): string {
  const title = video.title ?? "Untitled video"
  const label = formatEventTypeLabel(row.eventType)
  if (!hit) return `${title} - ${label.toLowerCase()} not detected`
  const where = row.side === "drop_off" ? "a drop-off" : "a gain"
  const confidence =
    maxConfidence == null ? "" : ` (confidence ${maxConfidence.toFixed(2)})`
  return `${title} - ${label.toLowerCase()} appeared in ${where}${confidence}`
}

function hitsInLast(row: ChannelRecurrenceRow, count: number): number {
  return row.cells.slice(-count).filter((cell) => cell.hit).length
}

// The strip's takeaway lines: a drop pattern still hitting every upload, one
// that's gone quiet since the creator (presumably) acted, and a gain pattern
// showing up reliably in recent videos.
function StreakCallouts({ recurrence }: { recurrence: ChannelRecurrence }) {
  const stillHappening = recurrence.rows.find(
    (row) => row.side === "drop_off" && row.currentStreak >= 3,
  )
  const cleared = recurrence.rows.find(
    (row) =>
      row.side === "drop_off" && row.hitCount >= 2 && row.videosSinceLastHit >= 2,
  )
  const recentWindow = Math.min(4, recurrence.videos.length)
  const working = recurrence.rows.find(
    (row) => row.side === "gain" && hitsInLast(row, recentWindow) >= 2,
  )
  if (!stillHappening && !cleared && !working) return null

  return (
    <div className="flex flex-col gap-2">
      {stillHappening && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
          <span className="font-semibold">Still happening:</span>{" "}
          {formatEventTypeLabel(stillHappening.eventType).toLowerCase()}s have
          appeared in a drop-off in{" "}
          <span className="font-semibold">
            {stillHappening.currentStreak} straight uploads
          </span>
          .
        </p>
      )}
      {cleared && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
          <span className="font-semibold">Progress:</span>{" "}
          {formatEventTypeLabel(cleared.eventType).toLowerCase()}s haven&apos;t
          appeared in a drop-off in your last{" "}
          {plural(cleared.videosSinceLastHit, "upload")}.
        </p>
      )}
      {working && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
          <span className="font-semibold">Working:</span>{" "}
          {formatEventTypeLabel(working.eventType).toLowerCase()}s held viewers
          in {hitsInLast(working, recentWindow)} of your last{" "}
          {plural(recentWindow, "upload")}.
        </p>
      )}
    </div>
  )
}

function RecurrenceStrip({ recurrence }: { recurrence: ChannelRecurrence }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">
          Across your last {plural(recurrence.videos.length, "upload")}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-destructive" />
            appeared in a drop-off
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-emerald-600 dark:bg-teal-600" />
            appeared in a gain
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm border bg-muted" />
            not detected
          </span>
          <span>paler = lower confidence</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th />
              {recurrence.videos.map((video, index) => {
                const date = formatAnalysedDate(video.dateAnalysed)
                return (
                  <th
                    key={video.id}
                    title={`${video.title ?? "Untitled video"}${date ? ` · analysed ${date}` : ""}`}
                    className="w-8 text-center text-[10px] font-medium text-muted-foreground"
                  >
                    {index + 1}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {recurrence.rows.map((row) => (
              <tr key={`${row.side}:${row.eventType}`}>
                <th className="pr-2 text-left font-normal whitespace-nowrap">
                  <EventTypeBadge eventType={row.eventType} />
                </th>
                {row.cells.map((cell, index) => (
                  <td key={recurrence.videos[index].id} className="p-0">
                    <div
                      title={recurrenceCellTitle(
                        recurrence.videos[index],
                        row,
                        cell.maxConfidence,
                        cell.hit,
                      )}
                      className={`h-6 w-8 rounded-sm ${recurrenceCellClass({ ...cell, side: row.side })}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Uploads run oldest to newest, by when they were deeply analysed. Hover a
        square for the video and what happened in it.
      </p>
      <StreakCallouts recurrence={recurrence} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The appendix: every pattern with every event, the exhaustive view the page
// used to lead with, now behind one fold for the curious.

// One expandable trend row: the event type and its channel-wide counts on the
// collapsed line, the individual occurrences (ranked by confidence) revealed on
// expand - the drill-down from "Pacing Change · 6 events" to those 6 events.
function TrendRow({ trend }: { trend: ChannelTrend }) {
  const hidden = trend.eventCount - trend.events.length
  return (
    <Collapsible className="border-b last:border-b-0">
      <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-3 text-left">
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        <EventTypeBadge eventType={trend.eventType} />
        <span className="text-sm font-medium tabular-nums">
          {plural(trend.eventCount, "event")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          across {plural(trend.videoCount, "video")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-3 pl-7">
        {trend.events.map((event, index) => (
          <EventReceipt
            key={`${event.videoTitle ?? ""}:${event.narrative}:${index}`}
            narrative={event.narrative}
            videoTitle={event.videoTitle}
          />
        ))}
        {hidden > 0 && (
          <p className="pl-3 text-xs text-muted-foreground">
            and {plural(hidden, "more event")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function FullBreakdown({ data }: { data: ChannelTrendsData }) {
  const sections = [
    {
      value: "loses",
      label: "What loses viewers",
      icon: <TrendingDownIcon className="size-4 text-destructive" />,
      description:
        "The causes that recur across your drop-offs, most channel-wide first.",
      kind: data.dropOffs,
    },
    {
      value: "gains",
      label: "Retention gains",
      icon: (
        <TrendingUpIcon className="size-4 text-emerald-600 dark:text-emerald-500" />
      ),
      description:
        "The patterns around moments viewers replayed or returned to.",
      kind: data.gains,
    },
    {
      value: "holds",
      label: "Audience holds",
      icon: <MinusIcon className="size-4 text-teal-600 dark:text-teal-400" />,
      description:
        "The patterns that recur where your audience stayed unusually steady.",
      kind: data.holds,
    },
    {
      value: "hooks",
      label: "Hook patterns",
      icon: <HookIcon className="size-4 text-yellow-500 dark:text-yellow-400" />,
      description:
        "What your openings have in common when viewers stay or slip away.",
      kind: data.hooks,
    },
  ].filter(
    (section): section is typeof section & { kind: ChannelKindTrends } =>
      section.kind != null,
  )
  if (sections.length === 0) return null

  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-4 text-left text-sm font-medium">
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        Full breakdown
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          every pattern, every event
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-6 border-t p-4">
        {sections.map((section) => (
          <section key={section.value} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {section.icon}
              {section.label}
            </div>
            <p className="text-xs text-muted-foreground">
              {section.description}
            </p>
            <div className="rounded-lg border px-3">
              {section.kind.trends.map((trend) => (
                <TrendRow key={trend.eventType} trend={trend} />
              ))}
            </div>
          </section>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// The top-3 tabs: the retention section's quick read, splitting the recurring
// patterns into the ones that cost you viewers and the ones that keep them.
// Each tab shows only the three most channel-wide trends (trends arrive
// ordered most-channel-wide first, so a slice is the top 3); the exhaustive
// list stays in the Full breakdown below.
const RETENTION_TRENDS_TAB_LIMIT = 3

function RetentionTrendsTabs({
  dropOffs,
  gains,
  holds,
}: {
  dropOffs: ChannelKindTrends | null
  gains: ChannelKindTrends | null
  holds: ChannelKindTrends | null
}) {
  const tabs = [
    {
      value: "drop-offs",
      label: "Drop-offs",
      icon: <TrendingDownIcon className="text-destructive" />,
      description:
        "Your top 3 recurring drop-off patterns, most channel-wide first.",
      trends: dropOffs?.trends.slice(0, RETENTION_TRENDS_TAB_LIMIT) ?? [],
    },
    {
      value: "gains",
      label: "Gains",
      icon: (
        <TrendingUpIcon className="text-emerald-600 dark:text-emerald-500" />
      ),
      description:
        "Your top 3 recurring retention gains, most channel-wide first.",
      trends: gains?.trends.slice(0, RETENTION_TRENDS_TAB_LIMIT) ?? [],
    },
    {
      value: "holds",
      label: "Holds",
      icon: <MinusIcon className="text-teal-600 dark:text-teal-400" />,
      description:
        "Your top 3 recurring audience-hold patterns, most channel-wide first.",
      trends: holds?.trends.slice(0, RETENTION_TRENDS_TAB_LIMIT) ?? [],
    },
  ].filter((tab) => tab.trends.length > 0)

  if (tabs.length === 0) return null

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">Top retention trends</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The patterns that recur across the most of your uploads, split by
          whether viewers leave, return, or remain unusually steady.
        </p>
      </div>
      <Tabs defaultValue={tabs[0].value}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className="flex flex-col gap-2"
          >
            <p className="text-xs text-muted-foreground">{tab.description}</p>
            <div className="rounded-lg border px-3">
              {tab.trends.map((trend) => (
                <TrendRow key={trend.eventType} trend={trend} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  )
}

function BuildingCard({ data }: { data: ChannelTrendsData }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <LibraryIcon className="size-5 text-muted-foreground" />
      <div>
        <h2 className="text-base font-semibold">
          {data.stage === "empty"
            ? "Start your content library"
            : "Your library is growing"}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every deep analysis adds its retention events to a private library of
          your content. Once{" "}
          {EARLY_TRENDS_VIDEO_THRESHOLD} videos are in, this page starts
          surfacing the patterns that repeat across your channel - what loses
          viewers, what holds them, and how your hooks behave.
        </p>
      </div>
      <Link href="/dashboard/analyse-video" className={buttonVariants()}>
        Analyse a video
      </Link>
    </Card>
  )
}

// A one-line caveat shown above early-stage trends so a three-video pattern
// never reads with ten-video authority.
function EarlySignalNote({ data }: { data: ChannelTrendsData }) {
  if (data.stage !== "early") return null
  return (
    <p className="text-xs text-muted-foreground">
      Early signals from {plural(data.libraryVideoCount, "video")} - treat
      these as leads, not verdicts. They firm up as your library approaches{" "}
      {ESTABLISHED_TRENDS_VIDEO_THRESHOLD} videos.
    </p>
  )
}

// A titled band of the page. The trends body reads as two of these: Retention
// (what keeps viewers watching) and Packaging (what earns clicks, reach and
// subscribers).
function TrendsSection({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="border-b pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function ChannelTrends({ data }: { data: ChannelTrendsData }) {
  const showTrends = data.stage === "early" || data.stage === "established"
  const hasRetention =
    data.insights.length > 0 ||
    data.signature != null ||
    data.recurrence != null ||
    data.dropOffs != null ||
    data.gains != null ||
    data.holds != null ||
    data.hooks != null
  const hasPackaging = data.packaging != null || data.subscribers != null

  return (
    <div className="flex flex-col gap-6">
      <LibraryStats data={data} />
      <StageProgress data={data} />
      {showTrends ? (
        <>
          <EarlySignalNote data={data} />
          {hasRetention && (
            <TrendsSection
              title="Retention"
              description="What keeps viewers watching and where they leave, across every deeply analysed upload."
              icon={<AreaChartIcon className="size-4 text-muted-foreground" />}
            >
              {data.insights.length > 0 && (
                <div className="flex flex-col gap-3">
                  {data.insights.map((insight) => (
                    <InsightCard
                      key={insight.kind}
                      insight={insight}
                      trend={trendForInsight(data, insight)}
                    />
                  ))}
                </div>
              )}
              <RetentionTrendsTabs
                dropOffs={data.dropOffs}
                gains={data.gains}
                holds={data.holds}
              />
              {data.signature != null && (
                <SignatureChart
                  rows={data.signature}
                  libraryVideoCount={data.libraryVideoCount}
                  dropOffs={data.dropOffs}
                  gains={data.gains}
                />
              )}
              {data.recurrence != null && (
                <RecurrenceStrip recurrence={data.recurrence} />
              )}
              <FullBreakdown data={data} />
            </TrendsSection>
          )}
          {hasPackaging && (
            <TrendsSection
              title="Packaging"
              description="How your titles, thumbnails and promises translate into reach and subscribers."
              icon={<PackageIcon className="size-4 text-muted-foreground" />}
            >
              {data.packaging != null && (
                <PackagingPatternsCard packaging={data.packaging} />
              )}
              {data.subscribers != null && (
                <SubscriberConversionCard conversion={data.subscribers} />
              )}
            </TrendsSection>
          )}
        </>
      ) : (
        <BuildingCard data={data} />
      )}
    </div>
  )
}

// The free-plan view: the page exists and explains itself, but the library is
// a paid (deep analysis) feature, so it markets the upgrade instead of
// rendering data.
export function ChannelTrendsLocked() {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <LockIcon className="size-5 text-muted-foreground" />
      <div>
        <h2 className="text-base font-semibold">
          Cross-video intelligence is a paid feature
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          On Starter and Pro, every deep analysis adds its retention events to
          a private library of your content. This page then surfaces the
          trends that repeat across your channel: what loses viewers, what
          holds them, and how your hooks behave - insight no single video can
          give you.
        </p>
      </div>
      <Link href="/pricing" className={buttonVariants()}>
        See plans
      </Link>
    </Card>
  )
}
