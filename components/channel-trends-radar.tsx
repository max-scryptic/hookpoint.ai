"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  taxonomyAxisCopy,
  taxonomyAxisShortLabel,
  taxonomyAxisTooltip,
} from "@/components/channel-trends-copy"
import {
  RADAR_MIN_AXES,
  formatScore,
} from "@/components/channel-trends-shared"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// The radar (spider) chart the Channel Trends page draws one taxonomy surface
// with: every axis in a group as a spoke, and three sets of videos as three
// shapes laid over each other. It exists for one question the bar lists answer
// slowly: what shape do my best uploads have that my worst ones do not, and
// which of the two is the odd one out against the library they came from.
//
// Hand-drawn SVG rather than a charting library, because a static three-series
// shape needs no charting runtime to draw. It also keeps the page's rule: no
// colour of its own. The two bands separate by weight and dash, not by hue, so
// the chart survives greyscale, colour blindness and dark mode without a legend
// key to memorise.
//
// The file is a client component for two things. The rim labels are clipped
// names and have to be able to say what they mean, so each carries the app's own
// tooltip. The browser's native SVG <title> was tried first and is not good
// enough - it waits about a second, renders as an OS tooltip rather than as this
// app, and never appears on a touch device - so the labels use the same Tooltip
// every other explained term in the product uses.
//
// The second is the key above the charts. Three shapes over one another means
// some of a shape runs underneath the others, so pointing at a band in the key
// pulls that band to the front across every chart under that key and fades the
// bands it was hiding behind. Hover, keyboard focus and a tap all do it; a click
// or tap pins the choice so it survives the pointer leaving, which is the only
// way to hold it on a touch screen. See RadarHighlightGroup.
//
// The chart is never the only place its numbers live. Every value it draws is
// also written out in the fold under it, so nothing here is load-bearing for a
// reader who cannot see it.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

// Drawn in an unitless viewBox and scaled to whatever width the card gives it,
// so one set of numbers holds at every card size.
const VIEW_WIDTH = 260
const VIEW_HEIGHT = 186
const CENTER_X = 130
const CENTER_Y = 92
const RADIUS = 62
// Rim labels sit just outside the outer ring, and the viewBox leaves room for
// two lines of them on every side.
const LABEL_GAP = 12
const LABEL_LINE_HEIGHT = 8.4
const LABEL_FONT_SIZE = 7.6
// Four rings: 2.5, 5, 7.5 and the outer 10, so a reader can place a shape on
// the 0-10 scale without counting.
const RING_STEPS = [0.25, 0.5, 0.75, 1]
const MAX_SCORE = 10
// A label longer than this is worth breaking over two lines; below it, a break
// costs more than it saves.
const LABEL_WRAP_CHARS = 10
// Rim labels are clipped names, so each one carries its full name and meaning
// on hover. The glyphs alone are a miserable target - the gaps between letters
// are not part of them - so the tooltip hangs on an invisible box sized to the
// text instead. A rough average advance per character is enough for a hit area;
// it never has to match the rendered text to the pixel.
const LABEL_CHAR_WIDTH = 0.55 * LABEL_FONT_SIZE
const LABEL_HIT_PADDING = 1.5

export interface RadarAxis {
  // The taxonomy axis key, for its labels.
  key: string
  // The three shapes' means on the 0-10 scale.
  topValue: number
  bottomValue: number
  libraryValue: number
}

interface Point {
  x: number
  y: number
}

// Spokes start at twelve o'clock and run clockwise, so the first axis of a
// group is always the one at the top.
function pointAt(index: number, count: number, distance: number): Point {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
  return {
    x: CENTER_X + Math.cos(angle) * distance,
    y: CENTER_Y + Math.sin(angle) * distance,
  }
}

function path(points: Point[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")
}

function clampScore(value: number): number {
  return Math.min(MAX_SCORE, Math.max(0, value))
}

function radiusFor(value: number): number {
  return (clampScore(value) / MAX_SCORE) * RADIUS
}

// Breaks a rim label over two lines at the space that leaves them closest in
// length, so "Personal disclosure" stacks evenly instead of hanging one word.
function wrapLabel(label: string): string[] {
  const words = label.split(" ")
  if (words.length < 2 || label.length <= LABEL_WRAP_CHARS) return [label]
  const halves = (at: number): [string, string] => [
    words.slice(0, at).join(" "),
    words.slice(at).join(" "),
  ]
  let best = 1
  for (let at = 2; at < words.length; at += 1) {
    const [leftBest, rightBest] = halves(best)
    const [left, right] = halves(at)
    if (
      Math.abs(left.length - right.length) <
      Math.abs(leftBest.length - rightBest.length)
    ) {
      best = at
    }
  }
  return halves(best)
}

function anchorFor(cosine: number): "start" | "middle" | "end" {
  if (cosine > 0.15) return "start"
  if (cosine < -0.15) return "end"
  return "middle"
}

// The three shapes, told apart without a single hue. The winners are the only
// solid, filled and dotted-vertex shape, because they are the thing being read;
// the losers are dashed and hollow; the library average is a fine dotted
// outline with no vertices at all, because it is a baseline rather than a third
// competitor. Weight and dash carry all of it, so a greyscale print or a
// colour-blind reader loses nothing.
export type RadarBand = "top" | "bottom" | "library"

const BAND_STYLE: Record<
  RadarBand,
  {
    tone: string
    fillOpacity: number
    strokeOpacity: number
    strokeWidth: number
    dash?: string
    vertexRadius: number
  }
> = {
  top: {
    tone: "text-foreground",
    fillOpacity: 0.12,
    strokeOpacity: 0.8,
    strokeWidth: 1.6,
    vertexRadius: 2,
  },
  bottom: {
    tone: "text-muted-foreground",
    fillOpacity: 0,
    strokeOpacity: 0.75,
    strokeWidth: 1.2,
    dash: "3.5 2.5",
    vertexRadius: 1.8,
  },
  library: {
    tone: "text-muted-foreground",
    fillOpacity: 0,
    strokeOpacity: 0.55,
    strokeWidth: 1,
    dash: "1 2.2",
    vertexRadius: 0,
  },
}

// Back to front when nothing is picked out: baseline first, winners last, so the
// shape being read is never crossed out by the two under it.
const BAND_DRAW_ORDER: RadarBand[] = ["library", "bottom", "top"]

const BAND_VALUE: Record<RadarBand, (axis: RadarAxis) => number> = {
  top: (axis) => axis.topValue,
  bottom: (axis) => axis.bottomValue,
  library: (axis) => axis.libraryValue,
}

// What a band draws as while one of the three is being pointed at. The picked
// band goes up to full contrast and gains a wash of fill so it reads as a shape
// rather than an outline; the other two drop to a ghost of themselves. Nothing
// is hidden outright, because the point of the chart is the comparison: the
// reader still needs to see where the faded shapes sit relative to the one they
// asked for.
function bandStyleFor(
  band: RadarBand,
  highlighted: RadarBand | null,
): (typeof BAND_STYLE)[RadarBand] {
  const style = BAND_STYLE[band]
  if (highlighted == null) return style
  if (highlighted !== band) {
    return {
      ...style,
      fillOpacity: style.fillOpacity * 0.1,
      // Faded to a trace rather than to nothing. The floor is what keeps the
      // library baseline - the faintest of the three before any of this, and
      // dotted - from leaving the chart altogether in dark mode, where these
      // bands are already the dim tone on a dim ground.
      strokeOpacity: Math.max(style.strokeOpacity * 0.18, 0.12),
    }
  }
  return {
    ...style,
    tone: "text-foreground",
    fillOpacity: Math.max(style.fillOpacity, 0.07),
    strokeOpacity: 1,
    strokeWidth: style.strokeWidth + 0.5,
  }
}

interface RadarHighlight {
  // The band currently pulled to the front, from either a pointer or a pin.
  highlighted: RadarBand | null
  // The band held by a click or tap, which is the only kind that outlives the
  // pointer leaving the key.
  pinned: RadarBand | null
  setHovered: (band: RadarBand | null) => void
  togglePinned: (band: RadarBand) => void
}

// Outside a group there is nothing to highlight and nothing to tell, so the
// chart draws flat and the key is inert. That keeps TaxonomyRadar usable on its
// own rather than only under a key.
const INERT_HIGHLIGHT: RadarHighlight = {
  highlighted: null,
  pinned: null,
  setHovered: () => {},
  togglePinned: () => {},
}

const RadarHighlightContext = createContext<RadarHighlight>(INERT_HIGHLIGHT)

// Wraps one key and the charts it speaks for, so pointing at a band in the key
// reaches every chart underneath it. It draws no element of its own: the key and
// the charts sit in a column their parent lays out, and a wrapper here would
// take them out of it.
export function RadarHighlightGroup({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<RadarBand | null>(null)
  const [pinned, setPinned] = useState<RadarBand | null>(null)
  const togglePinned = useCallback((band: RadarBand) => {
    setPinned((current) => (current === band ? null : band))
  }, [])
  const value = useMemo<RadarHighlight>(
    // A pointer beats a pin while it is on the key, so hovering the other two
    // entries still previews them without having to unpin first.
    () => ({ highlighted: hovered ?? pinned, pinned, setHovered, togglePinned }),
    [hovered, pinned, togglePinned],
  )
  return (
    <RadarHighlightContext.Provider value={value}>
      {children}
    </RadarHighlightContext.Provider>
  )
}

// Presentation attributes are ordinary CSS properties, so the shapes ease
// between the two states instead of snapping. Honours a reduced-motion setting.
const SHAPE_TRANSITION =
  "transition-all duration-200 ease-out motion-reduce:transition-none"

function BandShape({
  axes,
  read,
  band,
  highlighted,
}: {
  axes: RadarAxis[]
  read: (axis: RadarAxis) => number
  band: RadarBand
  highlighted: RadarBand | null
}) {
  const style = bandStyleFor(band, highlighted)
  const faded = highlighted != null && highlighted !== band
  const points = axes.map((axis, index) =>
    pointAt(index, axes.length, radiusFor(read(axis))),
  )
  return (
    <g className={`${style.tone} ${SHAPE_TRANSITION}`}>
      <polygon
        points={path(points)}
        fill={style.fillOpacity > 0 ? "currentColor" : "none"}
        fillOpacity={style.fillOpacity}
        stroke="currentColor"
        strokeOpacity={style.strokeOpacity}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dash}
        strokeLinejoin="round"
        className={SHAPE_TRANSITION}
      />
      {style.vertexRadius > 0 &&
        points.map((point, index) => (
          <circle
            key={axes[index].key}
            cx={point.x}
            cy={point.y}
            r={style.vertexRadius}
            fill={band === "top" ? "currentColor" : "var(--card)"}
            fillOpacity={band === "top" ? 0.85 : 1}
            stroke="currentColor"
            // The vertices are the loudest part of a band, so a faded one drops
            // them further than its outline: they are what makes a shape the
            // reader did not ask for read as a shape.
            strokeOpacity={faded ? 0.12 : 0.8}
            strokeWidth={band === "top" ? 0 : 1.1}
            opacity={faded ? 0.14 : 1}
            className={SHAPE_TRANSITION}
          />
        ))}
    </g>
  )
}

export function TaxonomyRadar({
  axes,
  topLabel,
  bottomLabel,
  libraryLabel,
  groupLabel,
}: {
  // Three or more, in the order they should run clockwise from the top.
  axes: RadarAxis[]
  // What the three shapes are called, in the reader's terms.
  topLabel: string
  bottomLabel: string
  libraryLabel: string
  // The surface these axes belong to, for the chart's own description.
  groupLabel: string
}) {
  const { highlighted } = useContext(RadarHighlightContext)
  if (axes.length < RADAR_MIN_AXES) return null

  // The picked band draws last so it sits over the two it was competing with.
  const drawOrder =
    highlighted == null
      ? BAND_DRAW_ORDER
      : [...BAND_DRAW_ORDER.filter((band) => band !== highlighted), highlighted]

  const readout = (axis: RadarAxis) =>
    `${topLabel} ${formatScore(axis.topValue)}, ${bottomLabel} ${formatScore(
      axis.bottomValue,
    )}, ${libraryLabel} ${formatScore(axis.libraryValue)}`
  const summary = axes
    .map((axis) => `${taxonomyAxisCopy(axis.key).name}: ${readout(axis)}`)
    .join(". ")

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className="w-full"
      role="img"
      aria-label={`${groupLabel} scored 0 to 10 on each axis, ${topLabel} against ${bottomLabel}. ${summary}.`}
    >
      <g className="text-muted-foreground">
        {RING_STEPS.map((step) => (
          <polygon
            key={step}
            points={path(
              axes.map((_, index) =>
                pointAt(index, axes.length, RADIUS * step),
              ),
            )}
            fill="none"
            stroke="currentColor"
            strokeOpacity={step === 1 ? 0.35 : 0.18}
            strokeWidth={0.8}
          />
        ))}
        {axes.map((axis, index) => {
          const outer = pointAt(index, axes.length, RADIUS)
          return (
            <line
              key={axis.key}
              x1={CENTER_X}
              y1={CENTER_Y}
              x2={outer.x}
              y2={outer.y}
              stroke="currentColor"
              strokeOpacity={0.18}
              strokeWidth={0.8}
            />
          )
        })}
      </g>

      {drawOrder.map((band) => (
        <BandShape
          key={band}
          axes={axes}
          read={BAND_VALUE[band]}
          band={band}
          highlighted={highlighted}
        />
      ))}

      {axes.map((axis, index) => {
        const angle = -Math.PI / 2 + (index / axes.length) * Math.PI * 2
        const anchor = anchorFor(Math.cos(angle))
        const label = pointAt(index, axes.length, RADIUS + LABEL_GAP)
        const lines = wrapLabel(taxonomyAxisShortLabel(axis.key))
        const hitWidth =
          Math.max(...lines.map((line) => line.length)) * LABEL_CHAR_WIDTH +
          LABEL_HIT_PADDING * 2
        const hitHeight = lines.length * LABEL_LINE_HEIGHT + LABEL_HIT_PADDING
        // The box hangs off the label the way the text does: from its left edge
        // when the text runs right, from its right edge when it runs left.
        const hitX =
          anchor === "start"
            ? label.x - LABEL_HIT_PADDING
            : anchor === "end"
              ? label.x + LABEL_HIT_PADDING - hitWidth
              : label.x - hitWidth / 2
        return (
          <Tooltip key={axis.key}>
            <TooltipTrigger
              // The label brightens under the cursor and takes the help
              // pointer, so a reader can see there is something to hover
              // before they hover it.
              render={
                <g className="cursor-help text-muted-foreground transition-colors hover:text-foreground" />
              }
            >
              <rect
                x={hitX}
                y={label.y - hitHeight / 2}
                width={hitWidth}
                height={hitHeight}
                fill="transparent"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={anchor}
                fontSize={LABEL_FONT_SIZE}
                className="fill-current"
              >
                {lines.map((line, lineIndex) => (
                  <tspan
                    key={line}
                    x={label.x}
                    y={
                      label.y +
                      (lineIndex - (lines.length - 1) / 2) * LABEL_LINE_HEIGHT
                    }
                    dominantBaseline="middle"
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </TooltipTrigger>
            <TooltipContent>{taxonomyAxisTooltip(axis.key)}</TooltipContent>
          </Tooltip>
        )
      })}
    </svg>
  )
}

// One entry in the key: the exact line the chart draws that band with, at the
// size a line of text can carry.
function LegendSwatch({
  band,
  highlighted,
}: {
  band: RadarBand
  highlighted: RadarBand | null
}) {
  const style = bandStyleFor(band, highlighted)
  return (
    <svg
      viewBox="0 0 20 8"
      className={`h-2 w-5 shrink-0 ${style.tone} ${SHAPE_TRANSITION}`}
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="4"
        x2="20"
        y2="4"
        stroke="currentColor"
        strokeOpacity={style.strokeOpacity}
        strokeWidth={2}
        strokeDasharray={band === "top" ? undefined : band === "bottom" ? "4 3" : "1.5 2.5"}
        className={SHAPE_TRANSITION}
      />
    </svg>
  )
}

// A band's entry in the key, and the handle for picking that band out of the
// charts below. A button rather than a span, so the same thing a mouse does is
// reachable from the keyboard and from a touch screen: focus previews a band the
// way hovering does, and a click or tap pins it until it is picked again.
function LegendItem({ band, label }: { band: RadarBand; label: string }) {
  const { highlighted, pinned, setHovered, togglePinned } =
    useContext(RadarHighlightContext)
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
      <LegendSwatch band={band} highlighted={highlighted} />
      {label}
    </button>
  )
}

// The key the radars share, stated once above the grid of them rather than
// repeated on every chart. Inside a RadarHighlightGroup it is also the control
// for them: see LegendItem.
export function RadarLegend({
  topLabel,
  bottomLabel,
  libraryLabel,
}: {
  topLabel: string
  bottomLabel: string
  libraryLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <LegendItem band="top" label={topLabel} />
      <LegendItem band="bottom" label={bottomLabel} />
      <LegendItem band="library" label={libraryLabel} />
      <span>Each spoke is a 0-10 score, centre 0, rim 10.</span>
    </div>
  )
}
