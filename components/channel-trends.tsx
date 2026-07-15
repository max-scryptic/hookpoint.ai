import Link from "next/link"
import {
  ChevronDownIcon,
  LibraryIcon,
  LockIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import { insightCopy } from "@/components/channel-trends-copy"
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
  EARLY_TRENDS_VIDEO_THRESHOLD,
  ESTABLISHED_TRENDS_VIDEO_THRESHOLD,
  SIGNAL_STRONG_THRESHOLD,
  type ChannelInsight,
  type ChannelKindTrends,
  type ChannelRecurrence,
  type ChannelRecurrenceRow,
  type ChannelSignatureRow,
  type ChannelTrend,
  type ChannelTrendsData,
  type ChannelVideo,
} from "@/lib/channel-trends"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"

// The Channel Trends page body, read top to bottom as verdict → evidence →
// trajectory: the library header, then the insight cards (written feedback for
// the few patterns that earned it), the drop-vs-gain signature chart, the
// recurrence strip across recent uploads, and finally the full per-type
// breakdown as an appendix. Purely presentational; all aggregation and
// gating lives in lib/channel-trends.ts, all insight copy in
// components/channel-trends-copy.ts.

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
          Trends at full strength — built from{" "}
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
      ? `${data.libraryVideoCount} of ${target} videos — trends strengthening as your library grows.`
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
// Insight cards — the page's hero: written verdicts for the few patterns that
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

// "Almost never in your gains" / "3× more common in drops than gains" — the
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
      <p className="text-muted-foreground">{narrative}</p>
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
// The channel signature — one diverging chart instead of separate loses/holds
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

// Bars scale so the largest fills this much of its half — the rest is label
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

// Hook windows have no drop/gain polarity, so they sit beside the signature
// as their own compact panel instead of a pair of bars.
function HookPanel({ hooks }: { hooks: ChannelKindTrends }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-1.5">
        <HookIcon className="size-4 text-yellow-500 dark:text-yellow-400" />
        <h3 className="text-sm font-semibold">Hook patterns</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        What your openings keep coming back to.
      </p>
      <div className="flex flex-col gap-2.5">
        {hooks.trends.slice(0, 4).map((trend) => (
          <div
            key={trend.eventType}
            className="flex flex-wrap items-center justify-between gap-1.5"
          >
            <EventTypeBadge eventType={trend.eventType} />
            <span className="text-xs tabular-nums text-muted-foreground">
              {plural(trend.videoCount, "video")} ·{" "}
              {plural(trend.eventCount, "event")}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The recurrence strip — the same patterns laid across the most recent
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
  if (!hit) return `${title} — ${label.toLowerCase()} not detected`
  const where = row.side === "drop_off" ? "a drop-off" : "a gain"
  const confidence =
    maxConfidence == null ? "" : ` (confidence ${maxConfidence.toFixed(2)})`
  return `${title} — ${label.toLowerCase()} appeared in ${where}${confidence}`
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
// expand — the drill-down from "Pacing Change · 6 events" to those 6 events.
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
      value: "holds",
      label: "What holds viewers",
      icon: (
        <TrendingUpIcon className="size-4 text-emerald-600 dark:text-emerald-500" />
      ),
      description:
        "The patterns your retention gains keep coming back to — worth repeating on purpose.",
      kind: data.gains,
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
          surfacing the patterns that repeat across your channel — what loses
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
      Early signals from {plural(data.libraryVideoCount, "video")} — treat
      these as leads, not verdicts. They firm up as your library approaches{" "}
      {ESTABLISHED_TRENDS_VIDEO_THRESHOLD} videos.
    </p>
  )
}

export function ChannelTrends({ data }: { data: ChannelTrendsData }) {
  const showTrends = data.stage === "early" || data.stage === "established"

  return (
    <div className="flex flex-col gap-6">
      <LibraryStats data={data} />
      <StageProgress data={data} />
      {showTrends ? (
        <>
          <EarlySignalNote data={data} />
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
          {(data.signature != null || data.hooks != null) && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {data.signature != null && (
                <div
                  className={data.hooks != null ? "lg:col-span-2" : "lg:col-span-3"}
                >
                  <SignatureChart
                    rows={data.signature}
                    libraryVideoCount={data.libraryVideoCount}
                    dropOffs={data.dropOffs}
                    gains={data.gains}
                  />
                </div>
              )}
              {data.hooks != null && <HookPanel hooks={data.hooks} />}
            </div>
          )}
          {data.recurrence != null && (
            <RecurrenceStrip recurrence={data.recurrence} />
          )}
          <FullBreakdown data={data} />
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
          holds them, and how your hooks behave — insight no single video can
          give you.
        </p>
      </div>
      <Link href="/pricing" className={buttonVariants()}>
        See plans
      </Link>
    </Card>
  )
}
