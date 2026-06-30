"use client"

import { useId, useMemo, useState } from "react"

import type { RetentionPoint } from "@/lib/youtube/youtube"

export type RetentionChartInsight = {
  id: string
  kind: "hook" | "drop" | "gain" | "pacing"
  label: string
  fromSeconds: number
  toSeconds: number
  metric?: string
  metricLabel?: string
  details?: string[]
  transcript?: string
}

// A self-contained SVG rendering of the audience-retention curve, styled to read
// like the graph in YouTube Studio: an absolute-retention area chart that starts
// at 100% and falls as viewers drop off, with a hover readout showing the exact
// timestamp and percentage at any point along the video.

const WIDTH = 1000
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 32, left: 48 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

// Width of the vertical lines that mark the start/end of a selected insight
// window. Drawn in user units (not a non-scaling stroke) so the stroke can be
// kept fully inside the plot, letting an edge sitting on a boundary — such as
// the hook's 0:00 start — line up with the axis instead of poking past it.
const WINDOW_EDGE_WIDTH = 1.5

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}

export function RetentionChart({
  points,
  durationSeconds,
  insights = [],
  onScrubTimeChange,
  onInsightSelect,
}: {
  points: RetentionPoint[]
  durationSeconds: number
  insights?: RetentionChartInsight[]
  onScrubTimeChange?: (seconds: number | null) => void
  onInsightSelect?: (insight: RetentionChartInsight | null) => void
}) {
  const gradientId = useId()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null)
  const [hoveredInsightId, setHoveredInsightId] = useState<string | null>(null)

  const model = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.elapsedRatio - b.elapsedRatio)
    const maxWatch = sorted.reduce((max, p) => Math.max(max, p.watchRatio), 1)
    // Round the top of the axis up to a clean half so the gridlines land on
    // friendly percentages (100%, 150%, …).
    const yMax = Math.max(1, Math.ceil(maxWatch * 2) / 2)

    const xFor = (elapsedRatio: number) => PAD.left + elapsedRatio * PLOT_W
    const yFor = (watchRatio: number) =>
      PAD.top + (1 - watchRatio / yMax) * PLOT_H

    const yAtFraction = (fraction: number) => {
      if (sorted.length === 0) return PAD.top + PLOT_H
      if (fraction <= sorted[0].elapsedRatio) return yFor(sorted[0].watchRatio)

      for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1]
        const current = sorted[i]
        if (fraction <= current.elapsedRatio) {
          const span = current.elapsedRatio - previous.elapsedRatio
          const progress = span > 0 ? (fraction - previous.elapsedRatio) / span : 0
          return yFor(
            previous.watchRatio +
              (current.watchRatio - previous.watchRatio) * progress,
          )
        }
      }

      return yFor(sorted[sorted.length - 1].watchRatio)
    }

    const coords = sorted.map((p) => ({
      x: xFor(p.elapsedRatio),
      y: yFor(p.watchRatio),
      point: p,
    }))

    const linePath = coords
      .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
      .join(" ")

    const areaPath = coords.length
      ? `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${(
          PAD.top + PLOT_H
        ).toFixed(2)} L${coords[0].x.toFixed(2)},${(PAD.top + PLOT_H).toFixed(
          2,
        )} Z`
      : ""

    // Horizontal gridlines / y-axis ticks every 25% of the axis range.
    const yTicks: number[] = []
    for (let v = 0; v <= yMax + 1e-9; v += 0.25) yTicks.push(v)

    // Vertical timestamp ticks at quarters of the timeline.
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      fraction: f,
      seconds: f * durationSeconds,
    }))

    return {
      sorted,
      coords,
      linePath,
      areaPath,
      yMax,
      yFor,
      yAtFraction,
      xFor,
      yTicks,
      xTicks,
    }
  }, [points, durationSeconds])

  const hovered =
    hoverIndex != null ? model.coords[hoverIndex] ?? null : null
  const activeInsight = insights.find(
    (insight) => insight.id === selectedInsightId,
  )

  const insightTone = {
    hook: {
      band: "#ec4899",
      badge: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
      name: "Hook",
    },
    drop: {
      band: "#ef4444",
      badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
      name: "Retention drop-off",
    },
    gain: {
      band: "#22c55e",
      badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      name: "Retention gain",
    },
    pacing: {
      band: "#3b82f6",
      badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
      name: "Pacing",
    },
  } as const

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    // Map the pointer back into the SVG's own coordinate space, then to the
    // nearest sample by elapsed fraction.
    const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH
    const fraction = (svgX - PAD.left) / PLOT_W
    if (model.sorted.length === 0) return
    const clamped = Math.min(1, Math.max(0, fraction))
    setHoverX(PAD.left + clamped * PLOT_W)

    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < model.sorted.length; i++) {
      const dist = Math.abs(model.sorted[i].elapsedRatio - clamped)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    }
    setHoverIndex(nearest)
  }

  function clearSelectedInsight() {
    setSelectedInsightId(null)
    onInsightSelect?.(null)
  }

  function toggleInsight(insight: RetentionChartInsight) {
    const next = selectedInsightId === insight.id ? null : insight
    setSelectedInsightId(next?.id ?? null)
    onInsightSelect?.(next)
  }

  if (model.sorted.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
        No retention curve available for this video.
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Audience retention curve"
        onPointerMove={handleMove}
        onPointerLeave={() => {
          setHoverIndex(null)
          setHoverX(null)
        }}
        onClick={clearSelectedInsight}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines and y-axis percentage labels. */}
        {model.yTicks.map((v) => {
          const y = model.yFor(v)
          return (
            <g key={`y-${v}`}>
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
                {Math.round(v * 100)}%
              </text>
            </g>
          )
        })}

        {/* Vertical timestamp ticks along the bottom. */}
        {model.xTicks.map((tick) => {
          const x = model.xFor(tick.fraction)
          return (
            <text
              key={`x-${tick.fraction}`}
              x={x}
              y={HEIGHT - 8}
              textAnchor={
                tick.fraction === 0
                  ? "start"
                  : tick.fraction === 1
                    ? "end"
                    : "middle"
              }
              fontSize={12}
              fill="var(--muted-foreground)"
            >
              {formatTimestamp(tick.seconds)}
            </text>
          )
        })}

        {/* The retention area. */}
        <path d={model.areaPath} fill={`url(#${gradientId})`} />
        <path
          d={model.linePath}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* A subtle dotted guide that tracks the pointer along the timeline. */}
        {hoverX != null && (
          <line
            x1={hoverX}
            y1={PAD.top}
            x2={hoverX}
            y2={PAD.top + PLOT_H}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 4"
            strokeOpacity={0.25}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}

        {/* When an insight is selected, shade the whole window it refers to in a
            light wash of its colour, bounded by vertical lines at the start and
            end of the window, so the reader can see exactly which slice of the
            video the insight describes. */}
        {activeInsight &&
          (() => {
            const from = Math.max(
              0,
              Math.min(durationSeconds, activeInsight.fromSeconds),
            )
            const to = Math.max(
              from,
              Math.min(durationSeconds, activeInsight.toSeconds),
            )
            const x1 = model.xFor(durationSeconds > 0 ? from / durationSeconds : 0)
            const x2 = model.xFor(durationSeconds > 0 ? to / durationSeconds : 0)
            const tone = insightTone[activeInsight.kind]
            return (
              <g pointerEvents="none">
                <rect
                  x={x1}
                  y={PAD.top}
                  width={Math.max(0, x2 - x1)}
                  height={PLOT_H}
                  fill={tone.band}
                  fillOpacity={0.12}
                />
                {[x1, x2].map((x, i) => {
                  // Keep the centred stroke fully within the plot so a boundary
                  // edge (e.g. the hook's 0:00 start) renders flush with the
                  // axis rather than half a stroke-width past it.
                  const half = WINDOW_EDGE_WIDTH / 2
                  const cx = Math.min(
                    PAD.left + PLOT_W - half,
                    Math.max(PAD.left + half, x),
                  )
                  return (
                    <line
                      key={`window-edge-${i}`}
                      x1={cx}
                      y1={PAD.top}
                      x2={cx}
                      y2={PAD.top + PLOT_H}
                      stroke={tone.band}
                      strokeWidth={WINDOW_EDGE_WIDTH}
                      strokeOpacity={0.6}
                    />
                  )
                })}
              </g>
            )
          })()}

        {/* Each insight is represented by one clickable marker at the midpoint
            of its source window, positioned directly on the retention curve. */}
        {insights.map((insight) => {
          const from = Math.max(
            0,
            Math.min(durationSeconds, insight.fromSeconds),
          )
          const to = Math.max(from, Math.min(durationSeconds, insight.toSeconds))
          const midpoint = from + (to - from) / 2
          const fraction = durationSeconds > 0 ? midpoint / durationSeconds : 0
          const x = model.xFor(fraction)
          const y = model.yAtFraction(fraction)
          const isActive = activeInsight?.id === insight.id
          const isHovered = hoveredInsightId === insight.id
          const tone = insightTone[insight.kind]
          // Scale up smoothly on hover, and further when selected. A gentle
          // overshoot easing gives the growth a little life rather than a snap.
          const scale = isActive ? 1.6 : isHovered ? 1.3 : 1
          const haloScale = isActive ? 3 : isHovered ? 2.5 : 1.6
          const haloOpacity = isActive ? 0.28 : isHovered ? 0.18 : 0
          const grow = "cubic-bezier(0.34, 1.56, 0.64, 1)"
          const transformOrigin = `${x}px ${y}px`

          return (
            <g
              key={insight.id}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              aria-label={`${tone.name}: ${insight.label}, at ${formatTimestamp(midpoint)}`}
              onPointerEnter={() => setHoveredInsightId(insight.id)}
              onPointerLeave={() =>
                setHoveredInsightId((current) =>
                  current === insight.id ? null : current,
                )
              }
              onClick={(event) => {
                event.stopPropagation()
                toggleInsight(insight)
              }}
              onFocus={() => setHoveredInsightId(insight.id)}
              onBlur={() =>
                setHoveredInsightId((current) =>
                  current === insight.id ? null : current,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  event.stopPropagation()
                  toggleInsight(insight)
                }
              }}
            >
              {/* Soft halo that fades and expands on hover / selection. */}
              <circle
                cx={x}
                cy={y}
                r={6}
                fill={tone.band}
                pointerEvents="none"
                style={{
                  transformOrigin,
                  transform: `scale(${haloScale})`,
                  opacity: haloOpacity,
                  transition: `transform 220ms ${grow}, opacity 220ms ease-out`,
                }}
              />
              {/* The marker itself, with a ring matched to the card background so
                  it reads as a distinct dot sitting on the curve. */}
              <circle
                cx={x}
                cy={y}
                r={6}
                fill={tone.band}
                stroke="var(--card)"
                strokeWidth={2}
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
                style={{
                  transformOrigin,
                  transform: `scale(${scale})`,
                  transition: `transform 220ms ${grow}`,
                }}
              />
              {/* Generous invisible hit target so the marker is easy to grab. */}
              <circle cx={x} cy={y} r={18} fill="transparent" />
            </g>
          )
        })}
      </svg>

      {/* Readout below the chart so it never clips at the SVG edges. */}
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Absolute audience retention
        </span>
        {hovered ? (
          <span className="font-mono tabular-nums">
            {formatTimestamp(hovered.point.timestampSeconds)} ·{" "}
            <span className="font-medium text-foreground">
              {Math.round(hovered.point.watchRatio * 100)}%
            </span>{" "}
            watching
          </span>
        ) : (
          <span className="text-muted-foreground">
            Hover the curve to inspect any moment
          </span>
        )}
      </div>
      {insights.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span>Highlighted windows:</span>
          {(["hook", "drop", "gain", "pacing"] as const).map((kind) =>
            insights.some((insight) => insight.kind === kind) ? (
              <span key={kind} className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: insightTone[kind].band }}
                />
                {insightTone[kind].name}
              </span>
            ) : null,
          )}
          <span className="ml-auto">Click a highlight to view its insight</span>
        </div>
      )}

      {activeInsight && (
        <div
          className="mt-4 rounded-lg border bg-background p-4 shadow-sm"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${insightTone[activeInsight.kind].badge}`}
                >
                  {insightTone[activeInsight.kind].name}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTimestamp(activeInsight.fromSeconds)}–
                  {formatTimestamp(activeInsight.toSeconds)}
                </span>
              </div>
              <h3 className="mt-2 font-medium">{activeInsight.label}</h3>
            </div>
            {activeInsight.metric && (
              <div className="text-right">
                <div className="text-xl font-semibold tabular-nums">
                  {activeInsight.metric}
                </div>
                {activeInsight.metricLabel && (
                  <div className="text-xs text-muted-foreground">
                    {activeInsight.metricLabel}
                  </div>
                )}
              </div>
            )}
          </div>
          {activeInsight.details && activeInsight.details.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeInsight.details.map((detail) => (
                <span
                  key={detail}
                  className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                >
                  {detail}
                </span>
              ))}
            </div>
          )}
          {activeInsight.transcript && (
            <p className="mt-3 text-sm text-muted-foreground">
              “{activeInsight.transcript}”
            </p>
          )}
        </div>
      )}
    </div>
  )
}
