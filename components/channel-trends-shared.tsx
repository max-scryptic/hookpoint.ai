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
// The two charts a panel draws are not here, because both answer a key the
// reader can point at and so are client modules: the radar in
// components/channel-trends-radar.tsx, the paired bars in
// components/channel-trends-dumbbell.tsx.
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
    <span className="rounded-sm border bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  )
}

// The advice block inside an insight or playbook card. A soft full frame keeps
// it distinct from the report prose without turning it into a side tab.
export function CalloutBlock({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-muted-foreground/20 bg-muted/40 px-3 py-2">
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
      <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-sm bg-foreground/60"
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
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-muted">
      <div
        className="h-full rounded-sm bg-foreground/60"
        style={{ width: `${Math.min(100, Math.max(0, value * 10))}%` }}
      />
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
