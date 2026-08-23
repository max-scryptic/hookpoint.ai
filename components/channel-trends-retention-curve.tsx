"use client"

import { useCallback, useMemo, useState } from "react"

import type {
  ChannelRetentionBands,
  ChannelRetentionCurvePoint,
} from "@/lib/channel-retention-curve"

// The library's retention curves: the three best-retaining uploads averaged
// into one line, the three worst into another, and every video in the library
// averaged behind them as the baseline.
//
// Three lines rather than one because a single channel average says how the
// channel does without saying what separates a good upload from a bad one. The
// gap between the two bands is the reading: where it opens is where the library
// splits, and the baseline says which of the two ends is the odd one out.
//
// Colour: none of its own, matching the rest of Channel Trends. The bands are
// told apart by weight and dash, exactly as the taxonomy radars tell the same
// three bands apart (components/channel-trends-radar.tsx), so the chart survives
// greyscale, colour blindness and dark mode.
//
// The key under the chart is also its control, on the same terms as the key
// above the radars: three lines over one another means stretches of one run
// underneath the others, so pointing at a band in the key pulls that band to the
// front and fades the two it was crossing. Hover, keyboard focus and a tap all
// do it; a click or tap pins the choice so it survives the pointer leaving,
// which is the only way to hold it on a touch screen.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013) anywhere in this
// file (comments included). Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const WIDTH = 1000
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 32, left: 48 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

// The winners are the only solid line, because they are the thing being read;
// the losers are dashed; the channel average is a fine dotted baseline rather
// than a third competitor. Same order of weight the radars use for the same
// three bands.
type Band = "top" | "bottom" | "average"

const BAND_STYLE: Record<
  Band,
  { stroke: string; opacity: number; width: number; dash?: string }
> = {
  top: { stroke: "var(--foreground)", opacity: 0.9, width: 2.5 },
  bottom: {
    stroke: "var(--muted-foreground)",
    opacity: 0.85,
    width: 2,
    dash: "8 6",
  },
  average: {
    stroke: "var(--muted-foreground)",
    opacity: 0.6,
    width: 1.75,
    dash: "2 5",
  },
}

const BAND_LABEL: Record<Band, string> = {
  top: "Top 3 videos",
  bottom: "Bottom 3 videos",
  average: "Channel average",
}

// What a band draws as while one of the three is being pointed at. The picked
// band goes up to full contrast and a heavier stroke; the other two drop to a
// ghost of themselves. Nothing is hidden outright, because the point of the
// chart is the comparison: the reader still needs to see where the faded lines
// sit relative to the one they asked for. Same treatment, same floor and same
// reasoning as bandStyleFor in components/channel-trends-radar.tsx.
function bandStyleFor(
  band: Band,
  highlighted: Band | null,
): (typeof BAND_STYLE)[Band] {
  const style = BAND_STYLE[band]
  if (highlighted == null) return style
  if (highlighted !== band) {
    return {
      ...style,
      // Faded to a trace rather than to nothing. The floor is what keeps the
      // channel average - the faintest of the three before any of this, and
      // dotted - from leaving the chart altogether in dark mode, where these
      // lines are already the dim tone on a dim ground.
      opacity: Math.max(style.opacity * 0.18, 0.12),
    }
  }
  return {
    ...style,
    stroke: "var(--foreground)",
    opacity: 1,
    width: style.width + 0.5,
  }
}

// Presentation attributes are ordinary CSS properties, so the lines ease between
// the two states instead of snapping. Honours a reduced-motion setting.
const LINE_TRANSITION =
  "transition-all duration-200 ease-out motion-reduce:transition-none"

// Baseline first, winners last, so the line being read is never crossed out by
// the two under it.
const BAND_DRAW_ORDER: Band[] = ["average", "bottom", "top"]

// The key reads the other way round: the two ends of the library first, the
// baseline they are read against last, as it does above every other tab's
// charts.
const BAND_READING_ORDER: Band[] = ["top", "bottom", "average"]

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

// One entry in the key: the exact line the chart draws that band with, at the
// size a line of text can carry.
function BandSwatch({
  band,
  highlighted,
}: {
  band: Band
  highlighted: Band | null
}) {
  const style = bandStyleFor(band, highlighted)
  return (
    <svg
      viewBox="0 0 20 8"
      className={`h-2 w-5 shrink-0 ${LINE_TRANSITION}`}
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="4"
        x2="20"
        y2="4"
        stroke={style.stroke}
        strokeOpacity={style.opacity}
        strokeWidth={2}
        strokeDasharray={
          band === "top" ? undefined : band === "bottom" ? "5 4" : "1.5 3"
        }
        className={LINE_TRANSITION}
      />
    </svg>
  )
}

// A band's entry in the key, and the handle for picking that band out of the
// chart above it. A button rather than a span, so the same thing a mouse does is
// reachable from the keyboard and from a touch screen: focus previews a band the
// way hovering does, and a click or tap pins it until it is picked again.
function BandLegendItem({
  band,
  highlighted,
  pinned,
  setHovered,
  togglePinned,
}: {
  band: Band
  highlighted: Band | null
  pinned: Band | null
  setHovered: (band: Band | null) => void
  togglePinned: (band: Band) => void
}) {
  const faded = highlighted != null && highlighted !== band
  return (
    <button
      type="button"
      onPointerEnter={() => setHovered(band)}
      onPointerLeave={() => setHovered(null)}
      onFocus={() => setHovered(band)}
      onBlur={() => setHovered(null)}
      onClick={() => togglePinned(band)}
      aria-pressed={pinned === band}
      className={`-mx-1 flex items-center gap-1.5 rounded-sm px-1 text-left transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none ${
        highlighted === band
          ? "text-foreground"
          : faded
            ? "text-muted-foreground/45"
            : "hover:text-foreground"
      }`}
    >
      <BandSwatch band={band} highlighted={highlighted} />
      {BAND_LABEL[band]}
    </button>
  )
}

export function ChannelRetentionCurveChart({
  points,
  bands,
  averageDurationSeconds,
}: {
  points: ChannelRetentionCurvePoint[]
  // Null on a library too small for two full, disjoint bands, which leaves the
  // channel average as the only line there is to draw.
  bands: ChannelRetentionBands | null
  averageDurationSeconds: number | null
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  // The band pulled to the front, from either the pointer on the key or a pin
  // held by a click. A pointer beats a pin while it is on the key, so hovering
  // the other two entries still previews them without having to unpin first.
  const [hoveredBand, setHoveredBand] = useState<Band | null>(null)
  const [pinnedBand, setPinnedBand] = useState<Band | null>(null)
  const highlighted = hoveredBand ?? pinnedBand
  const togglePinned = useCallback((band: Band) => {
    setPinnedBand((current) => (current === band ? null : band))
  }, [])

  const model = useMemo(() => {
    const averageRatios = points.map((point) => point.watchRatio)
    const series: Record<Band, number[] | null> = {
      top: bands?.top.watchRatios ?? null,
      bottom: bands?.bottom.watchRatios ?? null,
      average: averageRatios,
    }

    // A rewatched opening can push a band over its own start, so the axis is
    // sized to whatever is actually drawn rather than assumed to end at 1.
    const maxWatch = BAND_DRAW_ORDER.flatMap(
      (band) => series[band] ?? [],
    ).reduce((max, value) => Math.max(max, value), 1)
    const yMax = Math.max(1, Math.ceil(maxWatch * 2) / 2)

    const xFor = (ratio: number) => PAD.left + ratio * PLOT_W
    const yFor = (watchRatio: number) =>
      PAD.top + (1 - watchRatio / yMax) * PLOT_H

    const pathFor = (watchRatios: readonly number[]) =>
      watchRatios
        .map(
          (watchRatio, index) =>
            `${index === 0 ? "M" : "L"}${xFor(points[index].elapsedRatio).toFixed(2)},${yFor(watchRatio).toFixed(2)}`,
        )
        .join(" ")

    const yTicks: number[] = []
    for (let value = 0; value <= yMax + 1e-9; value += 0.25) yTicks.push(value)

    return {
      series,
      lines: BAND_DRAW_ORDER.flatMap((band) => {
        const watchRatios = series[band]
        return watchRatios == null ? [] : [{ band, path: pathFor(watchRatios) }]
      }),
      xFor,
      yFor,
      yTicks,
    }
  }, [points, bands])

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH
    const ratio = Math.min(1, Math.max(0, (svgX - PAD.left) / PLOT_W))
    setHoverIndex(Math.round(ratio * (points.length - 1)))
  }

  const legend: Band[] = bands == null ? ["average"] : BAND_READING_ORDER
  // The picked line draws last so it sits over the two it was crossing.
  const drawnLines =
    highlighted == null
      ? model.lines
      : [
          ...model.lines.filter((line) => line.band !== highlighted),
          ...model.lines.filter((line) => line.band === highlighted),
        ]
  const hovered = hoverIndex == null ? null : points[hoverIndex]
  const readout =
    hovered == null || hoverIndex == null
      ? null
      : [
          `${percent(hovered.elapsedRatio)} in`,
          ...(bands == null
            ? [`${percent(hovered.watchRatio)} still watching`]
            : [
                `top 3 ${percent(bands.top.watchRatios[hoverIndex])}`,
                `bottom 3 ${percent(bands.bottom.watchRatios[hoverIndex])}`,
                `channel ${percent(hovered.watchRatio)}`,
              ]),
          ...(averageDurationSeconds == null
            ? []
            : [
                `around ${formatTimestamp(hovered.elapsedRatio * averageDurationSeconds)}`,
              ]),
        ].join(" · ")

  return (
    <div className="rounded-xl border bg-card p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={
          bands == null
            ? "Your channel's average audience retention curve"
            : "Audience retention averaged across your top 3 videos, your bottom 3 videos and your whole channel"
        }
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {model.yTicks.map((value) => {
          const y = model.yFor(value)
          return (
            <g key={`y-${value}`}>
              <line
                x1={PAD.left}
                y1={y}
                x2={WIDTH - PAD.right}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={12}
                fill="var(--muted-foreground)"
              >
                {percent(value)}
              </text>
            </g>
          )
        })}

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <text
            key={`x-${ratio}`}
            x={model.xFor(ratio)}
            y={HEIGHT - 8}
            textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}
            fontSize={12}
            fill="var(--muted-foreground)"
          >
            {percent(ratio)}
          </text>
        ))}

        {drawnLines.map((line) => {
          const style = bandStyleFor(line.band, highlighted)
          return (
            <path
              key={line.band}
              d={line.path}
              fill="none"
              stroke={style.stroke}
              strokeOpacity={style.opacity}
              strokeWidth={style.width}
              strokeDasharray={style.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className={LINE_TRANSITION}
            />
          )
        })}

        {hovered && (
          <line
            x1={model.xFor(hovered.elapsedRatio)}
            y1={PAD.top}
            x2={model.xFor(hovered.elapsedRatio)}
            y2={PAD.top + PLOT_H}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 4"
            strokeOpacity={0.35}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          {/* Only a control when there is more than one line to pick between:
              a lone channel average has nothing to be pulled in front of. */}
          {legend.length === 1 ? (
            <span className="flex items-center gap-1.5">
              <BandSwatch band={legend[0]} highlighted={null} />
              {BAND_LABEL[legend[0]]}
            </span>
          ) : (
            legend.map((band) => (
              <BandLegendItem
                key={band}
                band={band}
                highlighted={highlighted}
                pinned={pinnedBand}
                setHovered={setHoveredBand}
                togglePinned={togglePinned}
              />
            ))
          )}
        </div>
        {readout ? (
          <span className="font-mono tabular-nums">{readout}</span>
        ) : (
          <span className="text-muted-foreground">
            Position is % of each video&apos;s runtime.
          </span>
        )}
      </div>
    </div>
  )
}
