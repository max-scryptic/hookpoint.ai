"use client"

import {
  BAND_TRANSITION,
  BandKeyItem,
  useBandHighlight,
  type TrendBand,
} from "@/components/channel-trends-band-highlight"
import { formatScore } from "@/components/channel-trends-shared"

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
//
// A client module for the same reason the radar is one: its key is also its
// control. Pointing at a band there brightens that band down every row under
// the key and fades the rest, exactly as it does on the radars, so the two
// charts answer a reader the same way. See
// components/channel-trends-band-highlight.tsx. Outside a highlight group both
// the key and the rows draw flat.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

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

// What a mark draws at while one of the three bands is being pointed at. The
// picked band is left exactly as it draws normally and everything else drops to
// a trace of itself, which is the radar's rule too: nothing is hidden outright,
// because the point of the row is the comparison and the reader still needs to
// see where the faded marks sit relative to the one they asked for.
function markFade(band: TrendBand, highlighted: TrendBand | null): string {
  return highlighted != null && highlighted !== band ? "opacity-20" : ""
}

// The bottom band and the baseline print their numbers in the muted tone, which
// is a whisper on a card that has just faded everything around it, so a picked
// band's number comes up to the foreground the way its mark comes forward.
function numberTone(band: TrendBand, highlighted: TrendBand | null): string {
  return highlighted === band ? "text-foreground" : "text-muted-foreground"
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
  const { highlighted } = useBandHighlight()
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
              having to be picked out of it by tone alone. It belongs to the
              pair rather than to either band, so it fades whichever of the
              three is being pointed at. */}
          <div
            className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground/40 ${BAND_TRANSITION} ${
              highlighted != null ? "opacity-20" : ""
            }`}
            style={{
              left: bandOffset(trail),
              width: `${((Math.min(10, lead) - Math.max(0, trail)) / 10) * 100}%`,
            }}
          />
          {hasLibrary && (
            <span
              className={`${BAND_TRANSITION} ${markFade("library", highlighted)}`}
            >
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
                className={`absolute top-0 -translate-x-1/2 text-[0.6875rem] leading-none tabular-nums ${BAND_TRANSITION} ${numberTone("library", highlighted)}`}
                style={{ left: bandOffset(libraryValue) }}
              >
                {formatScore(libraryValue)}
              </span>
            </span>
          )}
          <span
            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted-foreground/70 bg-card ${BAND_TRANSITION} ${markFade("bottom", highlighted)}`}
            style={{ left: bandOffset(bottomValue) }}
          />
          {/* The only mark on the row carrying a hue, and it is the --chart-1
              blue the retention curves use for their own top band. The run
              behind it and the other two marks stay neutral: they are a rank
              around this one, not three things to tell apart by colour. */}
          <span
            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ${BAND_TRANSITION} ${markFade("top", highlighted)}`}
            style={{ left: bandOffset(topValue) }}
          />
          <span
            className={`absolute bottom-0 text-xs leading-none font-medium whitespace-nowrap tabular-nums ${BAND_TRANSITION} ${markFade("top", highlighted)}`}
            style={outside(topValue, topLeads)}
          >
            {formatScore(topValue)}
          </span>
          <span
            className={`absolute bottom-0 text-xs leading-none whitespace-nowrap tabular-nums ${BAND_TRANSITION} ${numberTone("bottom", highlighted)} ${markFade("bottom", highlighted)}`}
            style={outside(bottomValue, !topLeads)}
          >
            {formatScore(bottomValue)}
          </span>
        </div>
      </div>
    </div>
  )
}

// One entry in the key: the exact mark the rows draw that band with, at the
// size a line of text can carry. It dims with the band it speaks for, so the
// key reads as the chart does.
function LegendSwatch({
  band,
  highlighted,
}: {
  band: TrendBand
  highlighted: TrendBand | null
}) {
  const fade = `${BAND_TRANSITION} ${markFade(band, highlighted)}`
  if (band === "library") {
    return (
      <span className={`h-3 w-0.5 shrink-0 rounded-full bg-muted-foreground ${fade}`} />
    )
  }
  return (
    <span
      className={
        band === "top"
          ? `size-2.5 shrink-0 rounded-full bg-chart-1 ${fade}`
          : `size-2.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/70 bg-card ${fade}`
      }
    />
  )
}

function LegendItem({ band, label }: { band: TrendBand; label: string }) {
  const { highlighted } = useBandHighlight()
  return (
    <BandKeyItem band={band} label={label}>
      <LegendSwatch band={band} highlighted={highlighted} />
    </BandKeyItem>
  )
}

// The key a run of dumbbell rows is read against, stated once above them rather
// than repeated on every row. Draws the exact marks the rows draw, at the size a
// line of text can carry. Inside a BandHighlightGroup it is also the control for
// them: pointing at a band here brightens it down every row and fades the other
// two, the same handle the radars keep above their own charts.
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
      <LegendItem band="top" label={topLabel} />
      <LegendItem band="bottom" label={bottomLabel} />
      {libraryLabel != null && (
        <LegendItem band="library" label={libraryLabel} />
      )}
      <span>
        Each track is a 0-10 score, left 0, right 10. The number beside it is the
        gap.
      </span>
    </div>
  )
}
