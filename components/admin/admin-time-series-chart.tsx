"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

// A self-contained SVG line chart for the admin dashboard's daily time series.
// It has no chart-library dependency on purpose: the data is small (a few weeks
// of daily points), the shapes are simple, and keeping it in-repo lets it use
// the app's own theme tokens and stay tiny. It supports one or two series and
// ships the pieces the dataviz guidance asks for: a legend (for ≥2 series),
// direct end-labels, a hover crosshair + tooltip, a recessive grid, and an
// sr-only data table so the numbers aren't color- or vision-dependent.

export type ChartSeries = {
  // Key into each ChartPoint for this series' value.
  key: string
  // Human-facing name shown in the legend, tooltip, and end-label.
  label: string
  // A CSS color — pass a theme token like "var(--chart-1)".
  color: string
  // Dashed line, used as a secondary (non-color) encoding for a second series.
  dashed?: boolean
}

export type ChartPoint = {
  // UTC calendar day as YYYY-MM-DD, plus one numeric value per series key.
  date: string
  [key: string]: number | string
}

type Props = {
  data: ChartPoint[]
  series: ChartSeries[]
  // Accessible caption describing what the chart shows.
  caption: string
  className?: string
}

const HEIGHT = 240
const MARGIN = { top: 16, right: 64, bottom: 28, left: 40 }
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

// Formats a YYYY-MM-DD string as "MMM d" without going through Date (which would
// reinterpret the UTC day in the local timezone and can shift it by a day).
function formatDay(date: string): string {
  const [, month, day] = date.split("-")
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`
}

// A "nice" upper bound for the y-axis: at least 4 so a near-empty chart still
// has sensible gridlines, then rounded up so the top tick is a round number.
function niceMax(max: number): number {
  if (max <= 4) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const step = pow <= 1 ? 1 : pow / 2
  return Math.ceil(max / step) * step
}

export function AdminTimeSeriesChart({
  data,
  series,
  caption,
  className,
}: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(640)
  const [hover, setHover] = React.useState<number | null>(null)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 10)
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
  const n = data.length

  // Reads a series value off a point as a number (the date field aside, values
  // are numeric; the widened index type just needs coercing).
  const valueAt = (point: ChartPoint, key: string) => Number(point[key] ?? 0)

  const maxValue = React.useMemo(() => {
    let max = 0
    for (const point of data) {
      for (const s of series) max = Math.max(max, Number(point[s.key] ?? 0))
    }
    return niceMax(max)
  }, [data, series])

  // x is index-based across the inner width; y maps 0..maxValue onto the plot.
  const xAt = (i: number) =>
    MARGIN.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAt = (value: number) =>
    MARGIN.top + innerH - (value / maxValue) * innerH

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxValue * f))
  // Show ~6 x labels regardless of range so they don't collide.
  const xTickStep = Math.max(1, Math.ceil(n / 6))

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * width
    if (n <= 1) {
      setHover(0)
      return
    }
    const i = Math.round(((x - MARGIN.left) / innerW) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  const hovered = hover != null ? data[hover] : null

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={caption}
        className="touch-none select-none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Horizontal gridlines + y-axis labels (recessive). */}
        {yTicks.map((tick) => {
          const y = yAt(tick)
          return (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* X-axis day labels. */}
        {data.map((point, i) =>
          i % xTickStep === 0 || i === n - 1 ? (
            <text
              key={point.date}
              x={xAt(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {formatDay(point.date)}
            </text>
          ) : null,
        )}

        {/* Series lines. */}
        {series.map((s) => {
          const d = data
            .map(
              (point, i) =>
                `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(valueAt(point, s.key))}`,
            )
            .join(" ")
          return (
            <path
              key={s.key}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
          )
        })}

        {/* Direct end-labels so identity never depends on color alone. */}
        {n > 0 &&
          series.map((s) => (
            <text
              key={`label-${s.key}`}
              x={xAt(n - 1) + 8}
              y={yAt(valueAt(data[n - 1], s.key))}
              dominantBaseline="middle"
              className="text-[10px] font-medium"
              fill={s.color}
            >
              {s.label}
            </text>
          ))}

        {/* Hover crosshair + markers. */}
        {hovered && (
          <g>
            <line
              x1={xAt(hover!)}
              x2={xAt(hover!)}
              y1={MARGIN.top}
              y2={MARGIN.top + innerH}
              className="stroke-muted-foreground/40"
              strokeWidth={1}
            />
            {series.map((s) => (
              <circle
                key={`dot-${s.key}`}
                cx={xAt(hover!)}
                cy={yAt(valueAt(hovered, s.key))}
                r={4}
                fill={s.color}
                className="stroke-background"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Tooltip. Positioned relative to the container; nudged left past the
          midpoint so it never overflows the right edge. */}
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-y-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: (xAt(hover!) / width) * 100 + "%",
            top: MARGIN.top + innerH / 2,
            transform:
              hover! > n / 2
                ? "translate(calc(-100% - 12px), -50%)"
                : "translate(12px, -50%)",
          }}
        >
          <div className="mb-1 font-medium text-popover-foreground">
            {formatDay(hovered.date)}
          </div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-muted-foreground">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.label}</span>
              <span className="ml-auto font-medium tabular-nums text-popover-foreground">
                {hovered[s.key] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Legend (only meaningful for ≥2 series; a single series is named by the
          card title and its end-label). */}
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-4 pl-10 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* Accessible data table — the numbers without needing to read the chart. */}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Day</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              {series.map((s) => (
                <td key={s.key}>{point[s.key] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
