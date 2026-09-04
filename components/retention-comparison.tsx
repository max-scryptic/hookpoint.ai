import Link from "next/link"
import { ArrowUpRightIcon } from "lucide-react"

import { RetentionComparisonChart } from "@/components/retention-comparison-chart"
import { VideoThumbnail } from "@/components/video-thumbnail"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  comparisonSampleSize,
  type ComparisonVideo,
  type RetentionComparisonData,
} from "@/lib/retention-comparison"
import { reliabilityNote } from "@/lib/retention-sample-size"

// The deterministic half of the Retention tab: the two head-to-head KPI cards
// that sit above the tab strip, and the overlaid curves with the biggest
// divergence called out. Everything said in words about these two curves lives
// in the written head-to-head (components/retention-head-to-head.tsx), which
// takes the curve card as a slot and stacks it between its summary and its
// tabs. Purely presentational; all loading and maths live in
// lib/retention-comparison.ts.
//
// The copy discipline here is deliberate: nothing on this page claims a cause,
// only where the two curves parted, and everything is phrased as evidence, not
// proof.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "Video A" },
  b: { dot: "var(--chart-2)", name: "Video B" },
} as const

type Side = keyof typeof SIDE_META

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

function SideDot({ side }: { side: Side }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: SIDE_META[side].dot }}
    />
  )
}

function Kpi({
  label,
  value,
  // Secondary reading shown alongside the value in muted text, for the one KPI
  // that carries two related numbers (avg view duration and the share of the
  // video that represents).
  hint,
}: {
  label: string
  value: string
  hint?: string | null
}) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-medium tabular-nums">
        {value}
        {hint != null && (
          <span className="ml-1 font-normal text-muted-foreground">
            ({hint})
          </span>
        )}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

function VideoHeaderCard({
  video,
  side,
  href,
}: {
  video: ComparisonVideo
  side: Side
  // Where the "open full analysis" arrow points. Defaults to the creator's own
  // analysed-video page.
  href?: string
}) {
  const summary = video.summary
  const published = formatPublished(summary.publishedAt)
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-[var(--radius-thumbnail)] bg-muted sm:w-40">
          <VideoThumbnail
            src={summary.thumbnailUrl}
            alt={summary.title ?? "Video thumbnail"}
            sizes="160px"
            iconClassName="size-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            <SideDot side={side} />
            {SIDE_META[side].name}
          </div>
          <div className="mt-1 flex items-start gap-2">
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold">
              {summary.title ?? "Untitled video"}
            </h3>
            <Link
              href={href ?? `/analysed-video/${summary.videoId}`}
              aria-label="Open full analysis"
              title="Open full analysis"
              className={buttonVariants({
                variant: "ghost",
                size: "icon-sm",
                className: "-mt-0.5 text-muted-foreground",
              })}
            >
              <ArrowUpRightIcon />
            </Link>
          </div>
          {published && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Published {published}
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t pt-3">
        <Kpi
          label="views"
          value={
            summary.views != null ? formatCompactNumber(summary.views) : "-"
          }
        />
        <Kpi
          label="avg view duration"
          value={
            summary.averageViewDurationSeconds != null
              ? formatTimestamp(summary.averageViewDurationSeconds)
              : "-"
          }
          hint={
            summary.averageViewDurationSeconds != null &&
            summary.averageViewPercentage != null
              ? `${Math.round(summary.averageViewPercentage)}%`
              : null
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
        <Kpi
          label="subscribers gained"
          value={
            summary.netSubscribersGained != null
              ? formatCompactNumber(summary.netSubscribersGained)
              : "-"
          }
        />
      </div>
    </Card>
  )
}

// The two video header cards. Split out from the detail body so the page can
// keep them above the Retention / Packaging / Script tabs as shared context
// for whichever tab is open.
export function RetentionComparisonVideos({
  data,
  videoHrefs,
}: {
  data: RetentionComparisonData
  // Where each side's "open full analysis" arrow points. Left unset on the
  // creator's own report, which links to their analysed-video page; the admin
  // report passes the admin video detail routes instead, since an admin viewing
  // someone else's comparison does not own these videos.
  videoHrefs?: { a: string; b: string }
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <VideoHeaderCard video={data.a} side="a" href={videoHrefs?.a} />
      <VideoHeaderCard video={data.b} side="b" href={videoHrefs?.b} />
    </div>
  )
}

// The overlaid curves, with the stretch where the two separated the most
// shaded. What that stretch means in words is left to the written head-to-head
// above and to the report sections below, so the card carries no takeaway
// sentence of its own; the only text under the chart is the reliability note,
// which sits there because it qualifies everything above it rather than
// introducing it. This is the only deterministic card left in the Retention
// tab: the written head-to-head takes it as a slot and stacks it between its
// summary and its tab strip, so the tab reads summary, then curve, then the
// sections.
export function RetentionCurvesCard({
  data,
}: {
  data: RetentionComparisonData
}) {
  const note = reliabilityNote(data.reliability)
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">Where the curves diverge</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Both curves on one axis, aligned by share of runtime so a short and a
          long video compare fairly. The shaded band is the stretch where the
          gap grew the most.
        </p>
      </div>
      <RetentionComparisonChart
        a={{
          label: data.a.summary.title ?? "Video A",
          points: data.a.curve,
          durationSeconds: data.a.summary.durationSeconds,
          sampleSize: comparisonSampleSize(data.a.summary),
        }}
        b={{
          label: data.b.summary.title ?? "Video B",
          points: data.b.curve,
          durationSeconds: data.b.summary.durationSeconds,
          sampleSize: comparisonSampleSize(data.b.summary),
        }}
        divergence={data.divergence}
      />
      {note != null && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {data.divergence == null && (
        <p className="text-xs text-muted-foreground">
          No stretch separates these two curves by more than the margin of error
          their audiences allow, so there is no band to read.
        </p>
      )}
    </Card>
  )
}
