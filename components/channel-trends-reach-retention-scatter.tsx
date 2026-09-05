"use client"

import { useMemo, useState } from "react"
import type { CSSProperties } from "react"

import { formatCompactNumber } from "@/components/channel-trends-shared"
import { VideoThumbnail } from "@/components/video-thumbnail"
import type {
  ChannelReachRetentionPoint,
  ChannelReachRetentionScatter,
} from "@/lib/channel-trends"

// Reach against retention for every covered upload. Total views use a log
// scale, because one breakout should not shove the rest of the library into a
// single unreadable clump at the left edge.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const WIDTH = 1000
const HEIGHT = 340
const PAD = { top: 24, right: 24, bottom: 44, left: 64 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

function logViews(views: number): number {
  return Math.log10(Math.max(1, views))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pointLabel(point: ChannelReachRetentionPoint): string {
  return `${point.title ?? "Untitled video"}: ${formatCompactNumber(point.views)} views, ${Math.round(point.averageViewPercentage)}% watched`
}

function tooltipSide(x: number): "left" | "right" {
  return x > WIDTH * 0.62 ? "left" : "right"
}

function tooltipY(y: number): number {
  return (clamp(y, PAD.top + 92, HEIGHT - PAD.bottom - 24) / HEIGHT) * 100
}

export function ChannelReachRetentionScatterChart({
  scatter,
}: {
  scatter: ChannelReachRetentionScatter
}) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const model = useMemo(() => {
    const viewLogs = scatter.points.map((point) => logViews(point.views))
    const minLog = Math.min(...viewLogs)
    const maxLog = Math.max(...viewLogs)
    const paddedMin = minLog === maxLog ? minLog - 0.25 : minLog
    const paddedMax = minLog === maxLog ? maxLog + 0.25 : maxLog
    const span = Math.max(0.001, paddedMax - paddedMin)

    const maxRetention = Math.max(
      100,
      Math.ceil(
        Math.max(
          ...scatter.points.map((point) => point.averageViewPercentage),
        ) / 10,
      ) * 10,
    )

    const xFor = (views: number) =>
      PAD.left + ((logViews(views) - paddedMin) / span) * PLOT_W
    const yFor = (retention: number) =>
      PAD.top + (1 - clamp(retention, 0, maxRetention) / maxRetention) * PLOT_H

    const xTicks = [
      scatter.points[0]?.views,
      scatter.medianViews,
      scatter.points[scatter.points.length - 1]?.views,
    ]
      .filter((value): value is number => value != null)
      .filter((value, index, values) => values.indexOf(value) === index)

    const yTicks: number[] = []
    for (let value = 0; value <= maxRetention; value += 25) yTicks.push(value)
    if (!yTicks.includes(maxRetention)) yTicks.push(maxRetention)

    return { xFor, yFor, xTicks, yTicks, maxRetention }
  }, [scatter])

  const active =
    activeId == null
      ? null
      : scatter.points.find((point) => point.id === activeId) ?? null
  const activePosition =
    active == null
      ? null
      : {
          x: model.xFor(active.views),
          y: model.yFor(active.averageViewPercentage),
        }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          role="img"
          aria-label="Total views against average percentage watched for every covered video"
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
                {value}%
              </text>
            </g>
          )
        })}

        {model.xTicks.map((value) => (
          <text
            key={`x-${value}`}
            x={model.xFor(value)}
            y={HEIGHT - 12}
            textAnchor={
              value === model.xTicks[0]
                ? "start"
                : value === model.xTicks[model.xTicks.length - 1]
                  ? "end"
                  : "middle"
            }
            fontSize={12}
            fill="var(--muted-foreground)"
          >
            {formatCompactNumber(value)}
          </text>
        ))}

        <line
          x1={model.xFor(scatter.medianViews)}
          y1={PAD.top}
          x2={model.xFor(scatter.medianViews)}
          y2={PAD.top + PLOT_H}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="4 5"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={PAD.left}
          y1={model.yFor(scatter.medianRetentionPercent)}
          x2={WIDTH - PAD.right}
          y2={model.yFor(scatter.medianRetentionPercent)}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="4 5"
          vectorEffect="non-scaling-stroke"
        />

        <text
          x={model.xFor(scatter.medianViews) + 7}
          y={PAD.top + 13}
          fontSize={11}
          fill="var(--muted-foreground)"
        >
          median views
        </text>
        <text
          x={PAD.left + 8}
          y={model.yFor(scatter.medianRetentionPercent) - 7}
          fontSize={11}
          fill="var(--muted-foreground)"
        >
          median watched
        </text>

        {scatter.points.map((point) => {
          const activePoint = activeId === point.id
          return (
            <g key={point.id}>
              <circle
                cx={model.xFor(point.views)}
                cy={model.yFor(point.averageViewPercentage)}
                r={activePoint ? 7 : 5}
                fill="var(--foreground)"
                fillOpacity={activePoint ? 0.9 : 0.62}
                stroke="var(--background)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className="transition-all duration-200 outline-none motion-reduce:transition-none"
                tabIndex={0}
                role="img"
                aria-label={pointLabel(point)}
                onPointerEnter={() => setActiveId(point.id)}
                onPointerLeave={() => setActiveId(null)}
                onFocus={() => setActiveId(point.id)}
                onBlur={() => setActiveId(null)}
              />
            </g>
          )
        })}
        </svg>
        {active && activePosition && (
          <div
            className={`pointer-events-none absolute left-1/2 z-10 w-[min(22rem,calc(100%-1rem))] -translate-x-1/2 ${
              tooltipSide(activePosition.x) === "left"
                ? "sm:right-[calc(100%_-_var(--tooltip-x)_+_0.75rem)] sm:left-auto sm:translate-x-0"
                : "sm:left-[calc(var(--tooltip-x)_+_0.75rem)] sm:translate-x-0"
            } top-[var(--tooltip-y)] -translate-y-1/2 rounded-md border bg-popover p-2.5 text-popover-foreground shadow-xl`}
            style={
              {
                "--tooltip-x": `${(activePosition.x / WIDTH) * 100}%`,
                "--tooltip-y": `${tooltipY(activePosition.y)}%`,
              } as CSSProperties
            }
          >
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
              <div className="relative aspect-video overflow-hidden rounded-[var(--radius-thumbnail)] bg-muted">
                <VideoThumbnail
                  src={active.thumbnailUrl}
                  alt={active.title ?? "Video thumbnail"}
                  sizes="120px"
                  iconClassName="size-5"
                />
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm leading-tight font-medium">
                  {active.title ?? "Untitled video"}
                </p>
                {active.description && (
                  <p className="mt-1 line-clamp-3 text-xs leading-snug text-muted-foreground">
                    {active.description}
                  </p>
                )}
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Views</dt>
                <dd className="font-mono tabular-nums">
                  {formatCompactNumber(active.views)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Avg watched</dt>
                <dd className="font-mono tabular-nums">
                  {Math.round(active.averageViewPercentage)}%
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Views vs median</dt>
                <dd className="font-mono tabular-nums">
                  {active.views >= scatter.medianViews ? "+" : ""}
                  {formatCompactNumber(active.views - scatter.medianViews)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Watched vs median</dt>
                <dd className="font-mono tabular-nums">
                  {active.averageViewPercentage >=
                  scatter.medianRetentionPercent
                    ? "+"
                    : ""}
                  {Math.round(
                    active.averageViewPercentage -
                      scatter.medianRetentionPercent,
                  )}
                  pp
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          Total views use a log scale. Dotted guides mark your library medians.
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {scatter.coveredVideoCount} of {scatter.libraryVideoCount} videos
          covered
        </span>
      </div>
    </div>
  )
}
