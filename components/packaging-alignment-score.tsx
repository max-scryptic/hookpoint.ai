import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// The alignment readout: how tightly one video's title, thumbnail and hook
// promise the same thing, drawn as three KPI tiles, the headline score and the
// two links it is made of. Every number here was scored on a video alone
// at analysis time (lib/packaging-taxonomy.ts), so nothing in this file is
// itself comparative.
//
// Shared by every surface that shows those numbers: a single video's report
// heads its packaging section with one, the packaging head-to-head puts one in
// each column of its Alignment tab, and channel trends puts one behind a
// library-wide average. One object in three places, so the score a creator
// learns on one video is visibly the score the other two rank and average.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

// What the headline number means, in one line, wherever it is shown.
export const ALIGNMENT_SCORE_CAPTION =
  "How tightly the title, thumbnail and hook promise one thing."

// The two links the headline score is made of. Both come off the enriched
// taxonomy, so a video analysed before that existed shows the headline score
// alone.
export const ALIGNMENT_PART_LABEL = {
  titleThumbnailMatch: "Title and thumbnail match",
  hookDeliversPromise: "Hook delivers the promise",
} as const

// What the headline tile calls itself. The two part tiles name the link they
// score, so the one they roll up has to name itself too: a tile reading "8 / 10"
// beside two others needs to say, on the tile, that it is the whole read rather
// than a third link.
export const ALIGNMENT_OVERALL_LABEL = "Overall alignment"

// The colour the headline tile is tinted with, and the bar drawn in, when the
// caller has no side of its own to tint them with. The head-to-head passes each
// video's own colour instead, so its two columns stay legible as two videos.
const DEFAULT_SCORE_COLOR = "var(--primary)"

export interface AlignmentScorePart {
  label: string
  value: number
}

// The frame a piece of a video's own material sits in: its words, its real
// thumbnail, or its alignment numbers, tinted and ruled off so they read as
// that video's own material rather than as the report's prose about it.
export function EvidencePanel({
  children,
  // An image asks for an even inset all round instead of the roomier sides
  // text reads better with; everything else about the frame stays fixed.
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-md border-l-2 border-muted-foreground/30 bg-muted/40 py-2 pr-3 pl-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

// A 0-10 read drawn as a bar.
export function ScoreBar({
  value,
  color = DEFAULT_SCORE_COLOR,
  className,
}: {
  value: number
  color?: string
  className?: string
}) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-sm bg-muted", className)}>
      <div
        className="h-full rounded-sm"
        style={{
          width: `${Math.min(100, Math.max(0, value * 10))}%`,
          backgroundColor: color,
        }}
      />
    </div>
  )
}

// One 0-10 read as a KPI tile: what it scores, then the number itself, bottom
// aligned so a label that wraps to two lines still leaves every number in a row
// on the same line. The headline tile is the one the other two roll up into, so
// it is the only one tinted with the score colour and the only one whose number
// is set large; the parts stay plain, which is what makes the first read as the
// higher level number rather than as a third link.
function AlignmentKpiCard({
  label,
  value,
  color = DEFAULT_SCORE_COLOR,
  headline = false,
}: {
  label: string
  value: number
  color?: string
  headline?: boolean
}) {
  return (
    <div
      className={cn(
        // min-w over a fixed column count: the same tile row has to sit in a
        // full width report card and in one narrow column of the head-to-head,
        // so the row wraps on its own when three will not fit rather than on a
        // viewport breakpoint that knows nothing about the column it is in.
        "flex min-w-32 flex-1 flex-col justify-between gap-2 rounded-lg border bg-card p-3",
        headline ? "min-h-28 min-w-40" : "min-h-24",
      )}
      style={
        headline
          ? {
              backgroundColor: `color-mix(in oklch, ${color} 10%, var(--card))`,
              borderColor: `color-mix(in oklch, ${color} 35%, transparent)`,
            }
          : undefined
      }
    >
      <span
        className={cn(
          "text-xs",
          headline ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "leading-none font-semibold tabular-nums",
            headline ? "text-4xl" : "text-2xl",
          )}
        >
          {value}
        </span>
        <span className="text-xs text-muted-foreground">/ 10</span>
      </div>
    </div>
  )
}

// One video's alignment score and the two parts it is made of, as three tiles
// with the headline one leading. The numbers speak for themselves, so nothing
// written sits under them beyond the caption: the prose read of a video's
// packaging lives in the per-surface cards each page carries, not in this block.
export function PackagingAlignmentScore({
  score,
  parts,
  color,
  className,
}: {
  score: number
  parts: AlignmentScorePart[]
  color?: string
  className?: string
}) {
  return (
    // The head-to-head sets one of these beside three tabs of quoted material,
    // so it wears the evidence frame like everything else in a column, and the
    // channel trends card reads the same way.
    <EvidencePanel className={className}>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-2">
          <AlignmentKpiCard
            label={ALIGNMENT_OVERALL_LABEL}
            value={score}
            color={color}
            headline
          />
          {parts.map((part) => (
            <AlignmentKpiCard
              key={part.label}
              label={part.label}
              value={part.value}
              color={color}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {ALIGNMENT_SCORE_CAPTION}
        </p>
      </div>
    </EvidencePanel>
  )
}
