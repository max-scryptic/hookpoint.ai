import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import { ChevronDownIcon, Clock3Icon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { stripEmDashes } from "@/lib/copy-guardrails"

// The pieces every Channel Trends panel is built from: the card frame, the
// evidence receipt, the meters and the number formatters. Kept in one file so
// the three tab bodies cannot drift apart, and so the page's visual language is
// stated once.
//
// The page deliberately carries no colour of its own. Meaning is written, and
// evidence is ranked, so nothing here depends on a hue to be read: bars are one
// neutral tone, headings are foreground, supporting copy is muted, and the only
// colour on the page comes from the shared EventTypeBadge, the tab glyphs and
// the shared alignment readout, all of which mean the same thing everywhere
// else in the product.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. See lib/copy-guardrails.ts; enforced by
// lib/__tests__/copy-guardrails.test.ts.

// A radar needs three spokes to enclose an area; two would draw a line, so a
// group smaller than this is written out as paired bars instead.
//
// It lives here rather than beside the chart it constrains because the callers
// that branch on it are server components while
// components/channel-trends-radar.tsx is a client module. A value exported from
// a client module does not reach a server component as the value: it arrives as
// a client reference, so both `axes.length >= RADAR_MIN_AXES` and
// `axes.length < RADAR_MIN_AXES` quietly evaluate false and every chart and
// every fallback bar drops off the page at once, with no error to show for it.
// Keep this constant in a module with no "use client" at the top.
export const RADAR_MIN_AXES = 3

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`
}

// Compact human number: 12345 -> "12.3K", 2_400_000 -> "2.4M".
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatRate(rate: number): string {
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

// A 0-10 taxonomy score, printed the way the per-video reports print it: one
// decimal only when the median landed between two integers.
export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

// The frame every section on this page sits in: a glyph, a heading, one line of
// standfirst, then the body. Matches the section cards on the analysed video
// and comparison report pages, glyph included, so a reader moving between them
// meets the same object.
export function TrendCard({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
      {footer && (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {footer}
        </CardContent>
      )}
    </Card>
  )
}

// The small label above a card's headline verdict. Neutral by design: the words
// say whether it is a strength or a fix, so the colour does not have to.
export function CardEyebrow({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </div>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  )
}

// The advice block inside an insight or playbook card. Ruled off with a neutral
// left edge, the same one the comparison reports quote their evidence behind.
export function CalloutBlock({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-r-md border-l-2 border-muted-foreground/30 bg-muted/40 px-3 py-2">
      <span className="mb-0.5 block text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

// A 0-100 strength reading. The band is written out, so the bar is a second
// reading of the label rather than the only place the strength lives.
export function SignalMeter({
  signal,
  strongThreshold,
}: {
  signal: number
  strongThreshold: number
}) {
  const band = signal >= strongThreshold ? "strong" : "emerging"
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/60"
          style={{ width: `${Math.min(100, signal)}%` }}
        />
      </div>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        Signal strength {signal} · {band}
      </span>
    </div>
  )
}

// One occurrence behind a count: what the synthesizer wrote, and the video (and
// moment) it came from, linked when the page knows which analysis to open.
export function EventReceipt({
  narrative,
  videoTitle,
  analysedVideoId,
  timestampSeconds,
}: {
  narrative: string
  videoTitle: string | null
  analysedVideoId?: string
  timestampSeconds?: number | null
}) {
  const sourceLabel = [
    videoTitle,
    timestampSeconds == null ? null : formatTimestamp(timestampSeconds),
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <div className="flex flex-col gap-0.5 border-l-2 pl-3 text-xs">
      <p className="text-muted-foreground">{stripEmDashes(narrative)}</p>
      {sourceLabel && analysedVideoId && (
        <Link
          href={`/analysed-video/${analysedVideoId}`}
          className="inline-flex items-center gap-1 text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
        >
          {timestampSeconds != null && <Clock3Icon className="size-3" />}
          {sourceLabel}
        </Link>
      )}
      {sourceLabel && !analysedVideoId && (
        <span className="text-muted-foreground/80">{sourceLabel}</span>
      )}
    </div>
  )
}

// The disclosure every drill-down on this page uses, so "open the evidence"
// looks and behaves identically wherever it appears.
export function EvidenceDisclosure({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <ChevronDownIcon className="size-3.5 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2 pl-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

// A single 0-10 taxonomy score as a bar. Used for the channel's own profile,
// where there is one number per axis rather than two to compare.
export function ScoreBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground/60"
        style={{ width: `${Math.min(100, Math.max(0, value * 10))}%` }}
      />
    </div>
  )
}

// --- The dumbbell ------------------------------------------------------------

// How this page draws one axis scored on two bands: a single 0-10 track, the
// two bands as marks on it, and the run between them thickened into a bar of
// its own. That bar is the point. Three stacked bars carry the same numbers,
// but a contrast row only ever claims one thing, that these two ends of the
// library score differently, and stacked bars never draw it: the reader holds
// three lengths in their head and subtracts. Given a length, a one point
// separation and a barely-there one are told apart at a glance, and down a
// column of rows.
//
// The marks speak the radar's language so the two charts read as one system:
// the top band solid and filled, the bottom band a hollow ring, the library
// average a thin tick rather than a dot because it is a baseline and not a
// third competitor. Shape carries all of it and no hue does, so a row survives
// greyscale, colour blindness and dark mode.
//
// Built from positioned elements rather than an SVG on purpose. A chart in a
// scaling viewBox scales its type with it, which would leave these numbers
// enormous on a desktop card and unreadable on a phone; here the track is
// fluid and the type is the page's own.

// Where a 0-10 score sits along the track.
function bandOffset(value: number): string {
  return `${(Math.min(10, Math.max(0, value)) / 10) * 100}%`
}

// The gap, signed against the top band, so a column of these reads as how far
// ahead the better-performing end of the library is, axis by axis, including
// the axes where it is behind. Rounded before it is printed, so the arithmetic
// never leaks a float onto the page.
function bandGap(topValue: number, bottomValue: number): number {
  return Math.round((topValue - bottomValue) * 10) / 10
}

// Always to one decimal, unlike a score. A column of gaps is read down rather
// than one at a time, and "+1" beside "+0.3" breaks the alignment that makes
// the column worth reading.
function formatBandGap(gap: number): string {
  return gap === 0 ? "0.0" : `${gap > 0 ? "+" : "-"}${Math.abs(gap).toFixed(1)}`
}

export function BandDumbbell({
  topLabel,
  topValue,
  bottomLabel,
  bottomValue,
  libraryLabel,
  libraryValue,
}: {
  // What each band is called, in the reader's terms. Used for the row's own
  // description rather than drawn: the key above a run of rows names them once.
  topLabel: string
  topValue: number
  bottomLabel: string
  bottomValue: number
  // The whole-library baseline, when the caller has one. Absent draws the two
  // bands alone, which is all a split into halves has to show.
  libraryLabel?: string
  libraryValue?: number
}) {
  const gap = bandGap(topValue, bottomValue)
  const topLeads = topValue >= bottomValue
  const lead = Math.max(topValue, bottomValue)
  const trail = Math.min(topValue, bottomValue)
  const hasLibrary = libraryLabel != null && libraryValue != null

  // Everything the row draws, written out for a reader who cannot see it. The
  // visible numbers are inside an image role, so this sentence is the only
  // place the marks are named.
  const scores = [
    `${topLabel} ${formatScore(topValue)}`,
    `${bottomLabel} ${formatScore(bottomValue)}`,
    hasLibrary ? `${libraryLabel} ${formatScore(libraryValue)}` : null,
  ]
    .filter((part) => part != null)
    .join(", ")
  const verdict =
    gap === 0
      ? `${topLabel} level with ${bottomLabel}.`
      : `${topLabel} ${gap > 0 ? "ahead of" : "behind"} ${bottomLabel} by ${formatScore(Math.abs(gap))}.`

  // The two scores print outside the pair, the leader's on its far side and the
  // trailer's on the other, rather than each under its own mark. Two bands half
  // a point apart would otherwise print their numbers on top of each other,
  // which is exactly how close the alignment pair's hook axis runs.
  const outside = (value: number, toTheRight: boolean) =>
    toTheRight
      ? { left: `calc(${bandOffset(value)} + 0.5rem)` }
      : { right: `calc(100% - ${bandOffset(value)} + 0.5rem)` }

  return (
    <div
      className="grid grid-cols-[2.75rem_1fr] items-center gap-x-2"
      role="img"
      aria-label={`${scores}, out of 10. ${verdict}`}
    >
      <span className="text-right text-sm font-medium tabular-nums">
        {formatBandGap(gap)}
      </span>
      {/* The marks sit on their value and are wider than the track, so the pair
          at either end of the 0-10 scale overhangs into this padding rather
          than off the card. */}
      <div className="px-1.5">
        <div className="relative h-9">
          <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-muted" />
          {/* Taller than the track it sits in as well as darker, so the run
              between the two bands swells off the scale behind it rather than
              having to be picked out of it by tone alone. */}
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground/40"
            style={{
              left: bandOffset(trail),
              width: `${((Math.min(10, lead) - Math.max(0, trail)) / 10) * 100}%`,
            }}
          />
          {hasLibrary && (
            <>
              {/* Cut through the run rather than laid over it: the baseline
                  often falls between the two bands, where a tick in any tone
                  close to the bar it crosses would disappear into it. The
                  notch behind the tick is the card itself, so the mark reads
                  against the bare track and the run alike. */}
              <span
                className="absolute top-1/2 h-4 w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-xs bg-card"
                style={{ left: bandOffset(libraryValue) }}
              />
              <span
                className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground"
                style={{ left: bandOffset(libraryValue) }}
              />
              <span
                className="absolute top-0 -translate-x-1/2 text-[0.6875rem] leading-none tabular-nums text-muted-foreground"
                style={{ left: bandOffset(libraryValue) }}
              >
                {formatScore(libraryValue)}
              </span>
            </>
          )}
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted-foreground/70 bg-card"
            style={{ left: bandOffset(bottomValue) }}
          />
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/80"
            style={{ left: bandOffset(topValue) }}
          />
          <span
            className="absolute bottom-0 text-xs leading-none font-medium whitespace-nowrap tabular-nums"
            style={outside(topValue, topLeads)}
          >
            {formatScore(topValue)}
          </span>
          <span
            className="absolute bottom-0 text-xs leading-none whitespace-nowrap tabular-nums text-muted-foreground"
            style={outside(bottomValue, !topLeads)}
          >
            {formatScore(bottomValue)}
          </span>
        </div>
      </div>
    </div>
  )
}

// The key a run of dumbbell rows is read against, stated once above them rather
// than repeated on every row. Draws the exact marks the rows draw, at the size a
// line of text can carry.
export function BandDumbbellLegend({
  topLabel,
  bottomLabel,
  libraryLabel,
}: {
  topLabel: string
  bottomLabel: string
  libraryLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 shrink-0 rounded-full bg-foreground/80" />
        {topLabel}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/70 bg-card" />
        {bottomLabel}
      </span>
      {libraryLabel != null && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 shrink-0 rounded-full bg-muted-foreground" />
          {libraryLabel}
        </span>
      )}
      <span>
        Each track is a 0-10 score, left 0, right 10. The number beside it is the
        gap.
      </span>
    </div>
  )
}

// One upload in a named band, as the band lists need it. Structural on purpose:
// the taxonomy tabs hand over their own ChannelExtremeVideo and the Retention
// tab hands over a curve band's video, and neither has to know about the other.
export interface TrendBandVideo {
  id: string
  title: string | null
  // The metric the band was ranked on, printed by the caller's formatOutcome.
  outcome: number
}

// One band, named. A creator recognises their own uploads faster than any bar
// or line, so the videos behind a shape are listed before the shape.
function BandVideoList({
  label,
  videos,
  formatOutcome,
}: {
  label: string
  videos: TrendBandVideo[]
  formatOutcome: (value: number) => string
}) {
  // Set in a panel of its own rather than as loose text, so the ranked pair
  // reads as the table it is and lifts off the prose either side of it.
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <ol className="mt-1.5 flex flex-col divide-y">
        {videos.map((video, index) => (
          <li
            key={video.id}
            className="grid grid-cols-[1rem_1fr_auto] items-baseline gap-x-2 py-1.5 first:pt-0 last:pb-0"
            title={video.title ?? undefined}
          >
            <span className="text-xs tabular-nums text-muted-foreground/60">
              {index + 1}
            </span>
            <span className="truncate text-sm">
              {video.title ?? "Untitled video"}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatOutcome(video.outcome)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// The two bands, side by side. The single way this page names the two ends of a
// library, wherever the split was made: on reach, on the script's retention, or
// on the retention curves themselves.
export function BandVideoPair({
  top,
  bottom,
  topLabel,
  bottomLabel,
  formatOutcome,
}: {
  top: TrendBandVideo[]
  bottom: TrendBandVideo[]
  topLabel: string
  bottomLabel: string
  formatOutcome: (value: number) => string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <BandVideoList
        label={topLabel}
        videos={top}
        formatOutcome={formatOutcome}
      />
      <BandVideoList
        label={bottomLabel}
        videos={bottom}
        formatOutcome={formatOutcome}
      />
    </div>
  )
}

// A note in the small print under a card: what a figure is measured over, or
// which videos are still missing from it.
export function CoverageNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
