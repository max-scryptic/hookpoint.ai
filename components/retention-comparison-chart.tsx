"use client"

import { useMemo, useState } from "react"

import type { CurveDivergence } from "@/lib/retention-comparison"
import type { RetentionPoint } from "@/lib/youtube/youtube"

// Two retention curves overlaid on a shared normalized axis: x is the share
// of each video's runtime (the honest way to overlay videos of different
// lengths), y is the share of viewers still watching. The stretch where the
// curves diverge most is shaded; hovering reads out both curves at once.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included) - it renders on the Channel Trends surface. Hyphens are fine.

const WIDTH = 1000
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 32, left: 48 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

export interface ComparisonCurve {
  label: string
  points: RetentionPoint[]
  durationSeconds: number
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

// The same baseline treatment as RetentionChart: an explicit 0:00 = 100%
// point so both curves start together at the axis.
function normalizedCurve(points: RetentionPoint[]) {
  const sorted = [...points].sort((a, b) => a.elapsedRatio - b.elapsedRatio)
  return [
    { elapsedRatio: 0, watchRatio: 1 },
    ...sorted.filter((point) => point.elapsedRatio > 0),
  ]
}

function ratioAt(
  curve: Array<{ elapsedRatio: number; watchRatio: number }>,
  fraction: number,
): number {
  if (curve.length === 0) return 0
  if (fraction <= curve[0].elapsedRatio) return curve[0].watchRatio
  for (let i = 1; i < curve.length; i++) {
    const previous = curve[i - 1]
    const current = curve[i]
    if (fraction <= current.elapsedRatio) {
      const span = current.elapsedRatio - previous.elapsedRatio
      const progress = span > 0 ? (fraction - previous.elapsedRatio) / span : 0
      return (
        previous.watchRatio +
        (current.watchRatio - previous.watchRatio) * progress
      )
    }
  }
  return curve[curve.length - 1].watchRatio
}

export function RetentionComparisonChart({
  a,
  b,
  divergence,
}: {
  a: ComparisonCurve
  b: ComparisonCurve
  divergence: CurveDivergence | null
}) {
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)

  const model = useMemo(() => {
    const curveA = normalizedCurve(a.points)
    const curveB = normalizedCurve(b.points)
    const maxWatch = [...curveA, ...curveB].reduce(
      (max, point) => Math.max(max, point.watchRatio),
      1,
    )
    const yMax = Math.max(1, Math.ceil(maxWatch * 2) / 2)

    const xFor = (fraction: number) => PAD.left + fraction * PLOT_W
    const yFor = (watchRatio: number) =>
      PAD.top + (1 - watchRatio / yMax) * PLOT_H

    const pathFor = (curve: typeof curveA) =>
      curve
        .map(
          (point, index) =>
            `${index === 0 ? "M" : "L"}${xFor(point.elapsedRatio).toFixed(2)},${yFor(point.watchRatio).toFixed(2)}`,
        )
        .join(" ")

    const yTicks: number[] = []
    for (let v = 0; v <= yMax + 1e-9; v += 0.25) yTicks.push(v)

    return {
      curveA,
      curveB,
      pathA: pathFor(curveA),
      pathB: pathFor(curveB),
      yMax,
      xFor,
      yFor,
      yTicks,
    }
  }, [a.points, b.points])

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH
    const fraction = Math.min(1, Math.max(0, (svgX - PAD.left) / PLOT_W))
    setHoverFraction(fraction)
  }

  if (a.points.length === 0 || b.points.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        Both videos need a stored retention curve to compare. Re-open a
        video&apos;s analysis page to backfill its curve.
      </div>
    )
  }

  const hoveredA =
    hoverFraction != null ? ratioAt(model.curveA, hoverFraction) : null
  const hoveredB =
    hoverFraction != null ? ratioAt(model.curveB, hoverFraction) : null

  return (
    <div className="rounded-xl border bg-card p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Overlaid audience retention curves for the two videos"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverFraction(null)}
      >
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

        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={`x-${fraction}`}
            x={model.xFor(fraction)}
            y={HEIGHT - 8}
            textAnchor={
              fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"
            }
            fontSize={12}
            fill="var(--muted-foreground)"
          >
            {Math.round(fraction * 100)}%
          </text>
        ))}

        {divergence && (
          <rect
            x={model.xFor(divergence.fromRatio)}
            y={PAD.top}
            width={Math.max(
              0,
              model.xFor(divergence.toRatio) - model.xFor(divergence.fromRatio),
            )}
            height={PLOT_H}
            fill="var(--muted-foreground)"
            fillOpacity={0.08}
          />
        )}

        <path
          d={model.pathA}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={model.pathB}
          fill="none"
          stroke="var(--chart-2)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {hoverFraction != null && (
          <line
            x1={model.xFor(hoverFraction)}
            y1={PAD.top}
            x2={model.xFor(hoverFraction)}
            y2={PAD.top + PLOT_H}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 4"
            strokeOpacity={0.25}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--chart-1)" }}
            />
            <span className="max-w-56 truncate">{a.label}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--chart-2)" }}
            />
            <span className="max-w-56 truncate">{b.label}</span>
          </span>
        </div>
        {hoverFraction != null && hoveredA != null && hoveredB != null ? (
          <span className="font-mono tabular-nums">
            {Math.round(hoverFraction * 100)}% in ·{" "}
            {Math.round(hoveredA * 100)}% vs {Math.round(hoveredB * 100)}%
            watching ·{" "}
            {formatTimestamp(hoverFraction * a.durationSeconds)} /{" "}
            {formatTimestamp(hoverFraction * b.durationSeconds)}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Position is % of each video&apos;s runtime. Hover to compare any
            point.
          </span>
        )}
      </div>
    </div>
  )
}
