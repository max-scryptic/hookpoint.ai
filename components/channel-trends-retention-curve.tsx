"use client"

import { useMemo, useState } from "react"

import type { ChannelRetentionCurve } from "@/lib/channel-retention-curve"

// The library's average retention curve: every video drawn faintly on one
// shared normalized axis, with the views-weighted average of them all drawn
// through the middle inside its 95% band.
//
// Both readings matter and neither works alone. The average is the channel's
// shape, but on its own it hides how much disagreement it was drawn through,
// and a reader would take a line built from four uploads for a law. The faint
// per-video curves put the spread back: the thin wandering ones are the small
// uploads whose curves swing on a handful of viewers, and they are drawn
// fainter the less weight they carry, so the picture and the arithmetic agree
// on sight.
//
// Colour: none of its own, matching the rest of Channel Trends. The average is
// the foreground, its band is the same tone at low opacity, and the individual
// videos are the muted tone. Meaning is written out beneath the chart rather
// than encoded in a hue.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013) anywhere in this
// file (comments included). Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const WIDTH = 1000
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 32, left: 48 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

// How faint an individual video is drawn, from the lightest-weight upload in
// the library to the heaviest. Kept low at both ends: these lines are context
// for the average, never competition for it.
const VIDEO_MIN_OPACITY = 0.1
const VIDEO_MAX_OPACITY = 0.4

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

export function ChannelRetentionCurveChart({
  curve,
}: {
  curve: ChannelRetentionCurve
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const model = useMemo(() => {
    const { points, videos } = curve

    // The band can reach above 100% where a rewatched opening pushes an
    // individual curve over its own start, so the axis is sized to whatever is
    // actually drawn rather than assumed to end at 1.
    const maxWatch = [
      ...points.map((point) => point.watchRatio + (point.margin ?? 0)),
      ...videos.flatMap((video) => video.watchRatios),
    ].reduce((max, value) => Math.max(max, value), 1)
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

    // Out along the top of the band and back along the bottom, closed into one
    // fillable ribbon. Null when any position could not be given a margin, so a
    // partial band never reads as a complete one.
    const bandPath = points.some((point) => point.margin == null)
      ? null
      : `${points
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"}${xFor(point.elapsedRatio).toFixed(2)},${yFor(point.watchRatio + (point.margin ?? 0)).toFixed(2)}`,
          )
          .join(" ")} ${[...points]
          .reverse()
          .map(
            (point) =>
              `L${xFor(point.elapsedRatio).toFixed(2)},${yFor(Math.max(0, point.watchRatio - (point.margin ?? 0))).toFixed(2)}`,
          )
          .join(" ")} Z`

    const maxShare = videos.reduce(
      (max, video) => Math.max(max, video.weightShare),
      0,
    )

    const yTicks: number[] = []
    for (let value = 0; value <= yMax + 1e-9; value += 0.25) yTicks.push(value)

    return {
      averagePath: pathFor(points.map((point) => point.watchRatio)),
      bandPath,
      videoPaths: videos.map((video) => ({
        id: video.id,
        path: pathFor(video.watchRatios),
        opacity:
          maxShare > 0
            ? VIDEO_MIN_OPACITY +
              (VIDEO_MAX_OPACITY - VIDEO_MIN_OPACITY) *
                (video.weightShare / maxShare)
            : VIDEO_MIN_OPACITY,
      })),
      xFor,
      yFor,
      yTicks,
    }
  }, [curve])

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH
    const ratio = Math.min(1, Math.max(0, (svgX - PAD.left) / PLOT_W))
    setHoverIndex(Math.round(ratio * (curve.points.length - 1)))
  }

  const hovered = hoverIndex == null ? null : curve.points[hoverIndex]

  return (
    <div className="rounded-xl border bg-card p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Your videos' audience retention curves with the views-weighted average drawn through them"
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

        {model.videoPaths.map((video) => (
          <path
            key={video.id}
            d={video.path}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeOpacity={video.opacity}
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {model.bandPath && (
          <path
            d={model.bandPath}
            fill="var(--foreground)"
            fillOpacity={0.12}
          />
        )}

        <path
          d={model.averagePath}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

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
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--foreground)" }}
            />
            Your weighted average
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 shrink-0 rounded-full opacity-40"
              style={{ backgroundColor: "var(--muted-foreground)" }}
            />
            Individual videos
          </span>
        </div>
        {hovered ? (
          <span className="font-mono tabular-nums">
            {percent(hovered.elapsedRatio)} in · {percent(hovered.watchRatio)}
            {hovered.margin != null &&
              ` +/-${Math.max(1, Math.round(hovered.margin * 100))}`}{" "}
            still watching
            {curve.averageDurationSeconds != null &&
              ` · around ${formatTimestamp(hovered.elapsedRatio * curve.averageDurationSeconds)}`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Position is % of each video&apos;s runtime. The shaded band is the
            95% margin on the average. Hover to read any point.
          </span>
        )}
      </div>
    </div>
  )
}
