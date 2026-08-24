import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// The alignment readout: how tightly one video's title, thumbnail and hook
// promise the same thing, drawn as a headline score, the bar behind it and the
// two links the score is made of. Every number here was scored on a video alone
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

// The bar colour when the caller has no side of its own to tint it with. The
// head-to-head passes each video's own colour instead, so its two columns stay
// legible as two videos.
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
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, value * 10))}%`,
          backgroundColor: color,
        }}
      />
    </div>
  )
}

// One video's alignment score, its caption, its bar and its two parts. The
// numbers speak for themselves, so nothing written sits under them: the prose
// read of a video's packaging lives in the per-surface cards each page carries,
// not in this block.
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
      <div className="@container flex flex-col gap-3">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl leading-none font-semibold tabular-nums">
              {score}
            </span>
            <span className="text-sm text-muted-foreground">/ 10</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {ALIGNMENT_SCORE_CAPTION}
          </p>
        </div>
        <ScoreBar value={score} color={color} />
        {parts.length > 0 && (
          // Side by side once the block itself is wide enough to hold two of
          // these rows, which is the full-width card on channel trends and on a
          // single video's report, and not the narrow columns of the
          // head-to-head. Measured on the block rather than the window so a wide
          // screen never splits a narrow column.
          <div className="grid gap-x-10 gap-y-2 @2xl:grid-cols-2">
            {parts.map((part) => (
              <div key={part.label} className="flex items-center gap-3">
                <span className="flex-1 text-xs text-muted-foreground">
                  {part.label}
                </span>
                <ScoreBar value={part.value} color={color} className="w-16" />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {part.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </EvidencePanel>
  )
}
