import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"

// The alignment readout: how tightly one video's title, thumbnail and opening
// promise the same thing, drawn as a headline score, the bar behind it and the
// two links the score is made of. Every number here was scored on that video
// alone at analysis time (lib/packaging-taxonomy.ts), so nothing in this file
// is comparative and the same block is correct on a single video's report and
// on one column of a head-to-head.
//
// Shared so those two surfaces show the identical thing: the packaging
// head-to-head puts one of these in each column of its Alignment tab, and a
// single video's packaging card puts one inside its own Alignment tab.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

// What the headline number means, in one line, wherever it is shown.
export const ALIGNMENT_SCORE_CAPTION =
  "How tightly the title, thumbnail and opening promise one thing."

// The two links the headline score is made of. Both come off the enriched
// taxonomy, so a video analysed before that existed shows the headline score
// alone.
export const ALIGNMENT_PART_LABEL = {
  titleThumbnailMatch: "Title and thumbnail match",
  hookDeliversPromise: "Opening delivers the promise",
} as const

// The bar colour when the caller has no side of its own to tint it with. The
// head-to-head passes each video's own colour instead, so its two columns stay
// legible as two videos.
const DEFAULT_SCORE_COLOR = "var(--primary)"

export interface AlignmentScorePart {
  label: string
  value: number
}

export interface AlignmentReadout {
  // The headline, on the same 0-10 scale as the parts.
  score: number
  // Empty for a taxonomy generated before the enriched detail block existed.
  parts: AlignmentScorePart[]
}

// Reads the alignment numbers off a stored packaging taxonomy, scaling the
// headline to the 0-10 the parts are already on. Returns null when the video
// carries no taxonomy at all, so the caller can leave the readout out rather
// than render a zero.
export function alignmentReadout(
  taxonomy: PackagingTaxonomy | null | undefined,
): AlignmentReadout | null {
  if (!taxonomy) return null
  const cross = taxonomy.detail?.cross
  return {
    score: Math.round(taxonomy.alignmentScore * 10),
    parts: cross
      ? [
          {
            label: ALIGNMENT_PART_LABEL.titleThumbnailMatch,
            value: cross.titleThumbnailMatch,
          },
          {
            label: ALIGNMENT_PART_LABEL.hookDeliversPromise,
            value: cross.hookDeliversPromise,
          },
        ]
      : [],
  }
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
// read of a video's packaging lives on that video's own report, not here.
export function PackagingAlignmentScore({
  score,
  parts,
  color,
  // The head-to-head sets one of these beside three tabs of quoted material, so
  // there it wears the evidence frame like everything else in a column. A single
  // video's Alignment tab has no other material to sit next to and is already in
  // a card of its own, so it drops the frame and shows the numbers plainly.
  framed = true,
  className,
}: {
  score: number
  parts: AlignmentScorePart[]
  color?: string
  framed?: boolean
  className?: string
}) {
  const Frame = framed ? EvidencePanel : UnframedScore

  return (
    <Frame className={className}>
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
          // these rows, which is the full-width Alignment tab and not the
          // narrow columns of the head-to-head. Measured on the block rather
          // than the window so a wide screen never splits a narrow column.
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
    </Frame>
  )
}

// The no-frame stand-in for EvidencePanel: same slot, no border, tint or inset,
// so the numbers sit directly on whatever card the caller already drew.
function UnframedScore({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={className}>{children}</div>
}
