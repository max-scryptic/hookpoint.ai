import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon, ImageOffIcon } from "lucide-react"

import { RetentionComparisonChart } from "@/components/retention-comparison-chart"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type {
  ComparisonVideo,
  RetentionComparisonData,
} from "@/lib/retention-comparison"

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
              href={href ?? `/dashboard/analysed-video/${summary.videoId}`}
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
    </Card>
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

// The overlaid curves, with the stretch where the two separated the most shaded
// and spelled out underneath. This is the only deterministic card left in the
// Retention tab: the written head-to-head takes it as a slot and stacks it
// between its summary and its tab strip, so the tab reads summary, then curve,
// then the sections.
export function RetentionCurvesCard({
  data,
}: {
  data: RetentionComparisonData
}) {
  const sentence = divergenceSentence(data)
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
  )
}
