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
          href={`/dashboard/analysed-video/${analysedVideoId}`}
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

// A bar in a ranked list of videos: one neutral fill against a dashed median
// line, so the reader compares positions rather than decoding colours.
export function RankBar({
  fillPercent,
  medianPercent,
}: {
  fillPercent: number
  medianPercent: number
}) {
  return (
    <div className="relative h-4">
      <div
        className="absolute inset-y-0 left-0 rounded-r-sm bg-muted-foreground/50"
        style={{ width: `${fillPercent}%` }}
      />
      <div
        className="absolute inset-y-0 border-l border-dashed border-foreground/40"
        style={{ left: `${medianPercent}%` }}
      />
    </div>
  )
}

// Bars scale so the largest fills this much of the track; the remainder keeps
// the median line legible even when the median sits near the maximum.
export const RANK_BAR_MAX_PERCENT = 92

// The neutral outcome badge used on ranked rows (high reach, subscriber magnet,
// net loss). Outlined rather than tinted, so no row depends on colour.
export function OutcomeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-muted-foreground">
      {children}
    </span>
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

// A note in the small print under a card: what a figure is measured over, or
// which videos are still missing from it.
export function CoverageNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
