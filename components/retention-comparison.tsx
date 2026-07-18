import Image from "next/image"
import Link from "next/link"
import { Clock3Icon, ImageOffIcon } from "lucide-react"

import { EventTypeBadge } from "@/components/event-type-badge"
import { RetentionComparisonChart } from "@/components/retention-comparison-chart"
import { Card } from "@/components/ui/card"
import { stripEmDashes } from "@/lib/copy-guardrails"
import type {
  ComparisonEvent,
  ComparisonVideo,
  ComparisonWindow,
  RetentionComparisonData,
} from "@/lib/retention-comparison"
import type { RetentionWindowKind } from "@/lib/retention-windows"

// The video-vs-video comparison body: head-to-head KPI cards, the overlaid
// curves with the biggest divergence called out, hook against hook, then each
// video's deeply analysed stretches with their weighted event evidence.
// Purely presentational; all loading and maths live in
// lib/retention-comparison.ts.
//
// The copy discipline here is deliberate: events describe stretches, not
// exact moments (retention curves carry timestamp slop), and everything is
// phrased as evidence, not proof.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "Video A" },
  b: { dot: "var(--chart-2)", name: "Video B" },
} as const

type Side = keyof typeof SIDE_META

const WINDOW_KIND_LABEL: Record<RetentionWindowKind, string> = {
  hook: "Hook",
  drop_off: "Drop-off",
  gain: "Gain",
  hold: "Hold",
}

const WINDOW_KIND_CLASS: Record<RetentionWindowKind, string> = {
  hook: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  drop_off: "bg-destructive/10 text-destructive",
  gain: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  hold: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${mins}:${String(secs).padStart(2, "0")}`
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPublished(iso: string | null): string | null {
  if (iso == null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// Signed watch-ratio change as percentage points, e.g. -0.083 -> "-8 pp".
function formatDeltaPp(delta: number): string {
  const pp = Math.round(delta * 100)
  return `${pp > 0 ? "+" : ""}${pp} pp`
}

function SideDot({ side }: { side: Side }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: SIDE_META[side].dot }}
    />
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-medium tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

function VideoHeaderCard({
  video,
  side,
}: {
  video: ComparisonVideo
  side: Side
}) {
  const summary = video.summary
  const published = formatPublished(summary.publishedAt)
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-40">
          {summary.thumbnailUrl ? (
            <Image
              src={summary.thumbnailUrl}
              alt={summary.title ?? "Video thumbnail"}
              fill
              sizes="160px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOffIcon className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            <SideDot side={side} />
            {SIDE_META[side].name}
          </div>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold">
            {summary.title ?? "Untitled video"}
          </h3>
          {published && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Published {published}
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t pt-3">
        <Kpi
          label="avg watched"
          value={
            summary.averageViewPercentage != null
              ? `${Math.round(summary.averageViewPercentage)}%`
              : "-"
          }
        />
        <Kpi
          label="avg watch time"
          value={
            summary.averageViewDurationSeconds != null
              ? formatTimestamp(summary.averageViewDurationSeconds)
              : "-"
          }
        />
        <Kpi
          label="views"
          value={
            summary.views != null ? formatCompactNumber(summary.views) : "-"
          }
        />
        <Kpi
          label="length"
          value={
            summary.durationSeconds > 0
              ? formatTimestamp(summary.durationSeconds)
              : "-"
          }
        />
      </div>
      <Link
        href={`/dashboard/analysed-video/${summary.id}`}
        className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Open full analysis
      </Link>
    </Card>
  )
}

function EventLine({ event }: { event: ComparisonEvent }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 pl-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <EventTypeBadge eventType={event.eventType} />
        {event.timestampSeconds != null && (
          <span className="inline-flex items-center gap-1 tabular-nums text-muted-foreground/80">
            <Clock3Icon className="size-3" />
            around {formatTimestamp(event.timestampSeconds)}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">{stripEmDashes(event.narrative)}</p>
    </div>
  )
}

function WindowStretch({ window }: { window: ComparisonWindow }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={`rounded-full px-1.5 py-px font-medium whitespace-nowrap ${WINDOW_KIND_CLASS[window.kind]}`}
        >
          {WINDOW_KIND_LABEL[window.kind]}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {formatTimestamp(window.fromSeconds)} to{" "}
          {formatTimestamp(window.toSeconds)}
        </span>
        <span className="ml-auto font-medium tabular-nums">
          {formatDeltaPp(window.delta)}
        </span>
      </div>
      {window.relativePerformance != null &&
        window.relativePerformance < 0.5 && (
          <p className="text-[11px] text-muted-foreground">
            Below what similar videos typically hold at this point.
          </p>
        )}
      {window.events.length > 0 ? (
        window.events.map((event, index) => (
          <EventLine key={`${window.id}:${index}`} event={event} />
        ))
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {window.deeplyAnalysed
            ? "Deeply analysed, but no event cleared the evidence bar in this stretch."
            : "Not deeply analysed - the curve shows the change, but there is no event evidence for this stretch."}
        </p>
      )}
    </div>
  )
}

function HookColumn({ video, side }: { video: ComparisonVideo; side: Side }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        <SideDot side={side} />
        <span className="truncate">
          {video.summary.title ?? "Untitled video"}
        </span>
      </div>
      {video.hookHoldRatio != null && (
        <p className="text-2xl font-semibold tabular-nums">
          {Math.round(video.hookHoldRatio * 100)}%
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            still watching{" "}
            {video.hook
              ? `after the ${formatTimestamp(video.hook.toSeconds)} hook`
              : "at 0:30"}
          </span>
        </p>
      )}
      {video.hook == null ? (
        <p className="text-xs text-muted-foreground">
          No hook window was recorded for this video.
        </p>
      ) : video.hook.events.length > 0 ? (
        video.hook.events.map((event, index) => (
          <EventLine key={`hook:${index}`} event={event} />
        ))
      ) : (
        <p className="text-xs text-muted-foreground">
          {video.hook.deeplyAnalysed
            ? "The hook was deeply analysed, but no event cleared the evidence bar."
            : "The hook has not been deeply analysed yet, so there is no event evidence for it."}
        </p>
      )}
    </div>
  )
}

// "Between 20% and 45% of the way through, A held steady while B fell from
// 61% to 38%." - the chart's takeaway sentence, built from the divergence.
function divergenceSentence(data: RetentionComparisonData): string | null {
  const divergence = data.divergence
  if (divergence == null) return null
  const winner = divergence.widenedFor === "a" ? data.a : data.b
  const loser = divergence.widenedFor === "a" ? data.b : data.a
  const winnerRatios =
    divergence.widenedFor === "a"
      ? [divergence.aFromRatio, divergence.aToRatio]
      : [divergence.bFromRatio, divergence.bToRatio]
  const loserRatios =
    divergence.widenedFor === "a"
      ? [divergence.bFromRatio, divergence.bToRatio]
      : [divergence.aFromRatio, divergence.aToRatio]
  const pct = (value: number) => `${Math.round(value * 100)}%`
  return (
    `Between ${pct(divergence.fromRatio)} and ${pct(divergence.toRatio)} of the way through, ` +
    `"${winner.summary.title ?? "Video"}" went from ${pct(winnerRatios[0])} to ${pct(winnerRatios[1])} watching ` +
    `while "${loser.summary.title ?? "the other video"}" went from ${pct(loserRatios[0])} to ${pct(loserRatios[1])}. ` +
    `That stretch is where the gap between these two videos grew the most.`
  )
}

function StretchColumn({ video, side }: { video: ComparisonVideo; side: Side }) {
  const stretches = video.windows.filter((window) => window.kind !== "hook")
  const notDeep = stretches.filter((window) => !window.deeplyAnalysed).length
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        <SideDot side={side} />
        <span className="truncate">
          {video.summary.title ?? "Untitled video"}
        </span>
      </div>
      {stretches.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No notable drop-offs, gains or holds were detected on this curve.
        </p>
      ) : (
        stretches.map((window) => (
          <WindowStretch key={window.id} window={window} />
        ))
      )}
      {notDeep > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {notDeep} of {stretches.length} stretches were not deeply analysed,
          so only the curve speaks for them.
        </p>
      )}
    </div>
  )
}

export function RetentionComparison({
  data,
}: {
  data: RetentionComparisonData
}) {
  const sentence = divergenceSentence(data)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <VideoHeaderCard video={data.a} side="a" />
        <VideoHeaderCard video={data.b} side="b" />
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-sm font-semibold">Where the curves diverge</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Both curves on one axis, aligned by share of runtime so a short
            and a long video compare fairly. The shaded band is the stretch
            where the gap grew the most.
          </p>
        </div>
        <RetentionComparisonChart
          a={{
            label: data.a.summary.title ?? "Video A",
            points: data.a.curve,
            durationSeconds: data.a.summary.durationSeconds,
          }}
          b={{
            label: data.b.summary.title ?? "Video B",
            points: data.b.curve,
            durationSeconds: data.b.summary.durationSeconds,
          }}
          divergence={data.divergence}
        />
        {sentence != null ? (
          <p className="rounded-r-md border-l-2 bg-muted/50 px-3 py-2 text-sm">
            {sentence}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            These two curves track each other closely - no single stretch
            separates them by more than a few points.
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-sm font-semibold">Hook against hook</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Most of the average-watch-time gap is usually decided in the
            opening. How many viewers each video kept through its hook, and
            the event evidence from each opening.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <HookColumn video={data.a} side="a" />
          <HookColumn video={data.b} side="b" />
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-sm font-semibold">Stretch by stretch</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each video&apos;s notable stretches in order, with the strongest
            event evidence for what plausibly happened there. Events describe
            stretches, not exact frames - retention data carries a few seconds
            of slop. Treat them as evidence, not proof.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <StretchColumn video={data.a} side="a" />
          <StretchColumn video={data.b} side="b" />
        </div>
        {data.feedbackCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Event ranking is calibrated by your {data.feedbackCount} insight
            ratings: evidence sources you have marked unhelpful rank lower.
          </p>
        )}
      </Card>
    </div>
  )
}
