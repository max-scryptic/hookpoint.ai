"use client"

import { useId, useMemo, useState } from "react"

import type { RetentionPoint } from "@/lib/youtube/youtube"

// A self-contained SVG rendering of the audience-retention curve, styled to read
// like the graph in YouTube Studio: an absolute-retention area chart that starts
// at 100% and falls as viewers drop off, with a hover readout showing the exact
// timestamp and percentage at any point along the video.

const WIDTH = 1000
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 32, left: 48 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

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
}: {
  points: RetentionPoint[]
  durationSeconds: number
}) {
  const gradientId = useId()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const model = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.elapsedRatio - b.elapsedRatio)
    const maxWatch = sorted.reduce((max, p) => Math.max(max, p.watchRatio), 1)
    // Round the top of the axis up to a clean half so the gridlines land on
    // friendly percentages (100%, 150%, …).
    const yMax = Math.max(1, Math.ceil(maxWatch * 2) / 2)

    const xFor = (elapsedRatio: number) => PAD.left + elapsedRatio * PLOT_W
    const yFor = (watchRatio: number) =>
      PAD.top + (1 - watchRatio / yMax) * PLOT_H

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

    return { sorted, coords, linePath, areaPath, yMax, yFor, xFor, yTicks, xTicks }
  }, [points, durationSeconds])

  const hovered =
    hoverIndex != null ? model.coords[hoverIndex] ?? null : null

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    // Map the pointer back into the SVG's own coordinate space, then to the
    // nearest sample by elapsed fraction.
    const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH
    const fraction = (svgX - PAD.left) / PLOT_W
    if (model.sorted.length === 0) return
    const clamped = Math.min(1, Math.max(0, fraction))

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
        onPointerLeave={() => setHoverIndex(null)}
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

        {/* The retention area + curve. */}
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

        {/* Hover indicator: crosshair line + dot at the nearest sample. */}
        {hovered && (
          <g>
            <line
              x1={hovered.x}
              y1={PAD.top}
              x2={hovered.x}
              y2={PAD.top + PLOT_H}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r={4}
              fill="var(--chart-1)"
              stroke="var(--background)"
              strokeWidth={2}
            />
          </g>
        )}
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
    </div>
  )
}
