"use client"

import * as React from "react"
import { subDays } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DatePickerWithRange } from "@/components/date-range-picker"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

// Client-side controller for the admin dashboard's activity charts. The server
// loads a wide window of daily points once; this component owns the visible
// date range (a shared calendar range picker with quick presets) and slices the
// data to it, so the axis spans the chosen week/month at full width instead of
// dumping every point in the dataset.

export type DailyCountPoint = {
  date: string
  count: number
}

export type VideosByDayPoint = {
  date: string
  light: number
  deep: number
}

type Props = {
  // Full window of points, oldest first, one per UTC calendar day.
  activeUsers: DailyCountPoint[]
  videosByDay: VideosByDayPoint[]
  // Per-series load failures, kept separate so one broken query only degrades
  // its own card rather than blanking both charts.
  activeUsersError: boolean
  videosError: boolean
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

// Quick-pick ranges offered alongside the calendar.
const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const

// A YYYY-MM-DD string for a Date, using its *local* calendar fields. The data's
// day strings are UTC calendar days and the calendar picks whole days, so we
// compare on the day the user sees rather than round-tripping through UTC (which
// could shift a picked day by one).
function toDayString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// Parse a YYYY-MM-DD day string into a local Date at midnight (no timezone
// reinterpretation of the day).
function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d)
}

// Format a YYYY-MM-DD day string as "MMM d" for axis ticks and tooltips.
function formatDay(day: string): string {
  const [, m, d] = day.split("-")
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`
}

const activeUsersConfig = {
  count: { label: "Active users", color: "var(--chart-1)" },
} satisfies ChartConfig

const videosConfig = {
  light: { label: "Light analysis", color: "var(--chart-1)" },
  deep: { label: "Deep analysis", color: "var(--chart-3)" },
} satisfies ChartConfig

export function AdminActivityCharts({
  activeUsers,
  videosByDay,
  activeUsersError,
  videosError,
}: Props) {
  // The available window is bounded by whichever series has data (they share the
  // same date span when both load).
  const allDays = React.useMemo(() => {
    const source = activeUsers.length ? activeUsers : videosByDay
    return source.map((p) => p.date)
  }, [activeUsers, videosByDay])

  const minDate = allDays.length ? parseDay(allDays[0]) : undefined
  const maxDate = allDays.length ? parseDay(allDays[allDays.length - 1]) : undefined

  // Default view: the most recent 30 days of the window.
  const [range, setRange] = React.useState<DateRange | undefined>(() => {
    if (!maxDate) return undefined
    const from = subDays(maxDate, 29)
    return { from: minDate && from < minDate ? minDate : from, to: maxDate }
  })

  const fromStr = range?.from ? toDayString(range.from) : allDays[0]
  const toStr = range?.to
    ? toDayString(range.to)
    : range?.from
      ? toDayString(range.from)
      : allDays[allDays.length - 1]

  const filteredUsers = React.useMemo(
    () => activeUsers.filter((p) => p.date >= fromStr && p.date <= toStr),
    [activeUsers, fromStr, toStr],
  )
  const filteredVideos = React.useMemo(
    () => videosByDay.filter((p) => p.date >= fromStr && p.date <= toStr),
    [videosByDay, fromStr, toStr],
  )

  function applyPreset(days: number) {
    if (!maxDate) return
    const from = subDays(maxDate, days - 1)
    setRange({ from: minDate && from < minDate ? minDate : from, to: maxDate })
  }

  return (
    <div className="space-y-4">
      {/* Shared range control for both charts: a calendar range picker plus
          quick presets. */}
      <div className="flex flex-wrap items-center gap-2">
        <DatePickerWithRange value={range} onChange={setRange} />
        {PRESETS.map((preset) => (
          <Button
            key={preset.days}
            variant="outline"
            size="sm"
            onClick={() => applyPreset(preset.days)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Active users first, then videos analysed — each spans the full width. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Active users per day
          </CardTitle>
          <CardDescription>
            Distinct users who used Hookpoint.ai each day (UTC).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeUsersError ? (
            <p className="text-sm text-destructive">
              This chart could not be loaded. Check the server logs.
            </p>
          ) : (
            <ChartContainer
              config={activeUsersConfig}
              className="aspect-auto h-[300px] w-full"
            >
              <AreaChart
                accessibilityLayer
                data={filteredUsers}
                margin={{ left: 12, right: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatDay(String(value))}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(value) => formatDay(String(value))}
                    />
                  }
                />
                <Area
                  dataKey="count"
                  type="linear"
                  fill="var(--color-count)"
                  fillOpacity={0.4}
                  stroke="var(--color-count)"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Videos analysed per day
          </CardTitle>
          <CardDescription>
            Light and deep analyses started each day (UTC).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {videosError ? (
            <p className="text-sm text-destructive">
              This chart could not be loaded. Check the server logs.
            </p>
          ) : (
            <ChartContainer
              config={videosConfig}
              className="aspect-auto h-[300px] w-full"
            >
              <AreaChart
                accessibilityLayer
                data={filteredVideos}
                margin={{ left: 12, right: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatDay(String(value))}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(value) => formatDay(String(value))}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  dataKey="light"
                  type="linear"
                  fill="var(--color-light)"
                  fillOpacity={0.4}
                  stroke="var(--color-light)"
                />
                <Area
                  dataKey="deep"
                  type="linear"
                  fill="var(--color-deep)"
                  fillOpacity={0.2}
                  stroke="var(--color-deep)"
                  strokeDasharray="5 4"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
