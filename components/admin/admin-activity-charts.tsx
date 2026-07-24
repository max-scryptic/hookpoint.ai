"use client"

import * as React from "react"
import { subDays } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardAction,
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
// loads a wide window of daily points once; each chart owns its own visible
// date range (a calendar range picker with quick presets, docked to the right
// of the card header) and slices the data to it, so the axis spans the chosen
// window at full width instead of dumping every point in the dataset. Ranges
// are per-chart so one card can be zoomed independently of the other.

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

// Manual calendar selection is capped to this many months; presets stay exempt
// so the wider quick-picks keep working.
const MAX_RANGE_MONTHS = 1

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

// Per-chart visible range. Defaults to the most recent 30 days of the window
// and exposes a preset helper; the window bounds come in as stable day strings
// so the state initialiser and callbacks don't churn every render.
function useChartRange(minDay?: string, maxDay?: string) {
  const [range, setRange] = React.useState<DateRange | undefined>(() => {
    if (!maxDay) return undefined
    const maxDate = parseDay(maxDay)
    const minDate = minDay ? parseDay(minDay) : undefined
    const from = subDays(maxDate, 29)
    return { from: minDate && from < minDate ? minDate : from, to: maxDate }
  })

  const applyPreset = React.useCallback(
    (days: number) => {
      if (!maxDay) return
      const maxDate = parseDay(maxDay)
      const minDate = minDay ? parseDay(minDay) : undefined
      const from = subDays(maxDate, days - 1)
      setRange({ from: minDate && from < minDate ? minDate : from, to: maxDate })
    },
    [minDay, maxDay],
  )

  return { range, setRange, applyPreset }
}

// Resolve a picker range to the inclusive [from, to] day-string bounds used for
// slicing, falling back to the full window when a side is unset.
function rangeBounds(range: DateRange | undefined, allDays: string[]) {
  const fromStr = range?.from ? toDayString(range.from) : allDays[0]
  const toStr = range?.to
    ? toDayString(range.to)
    : range?.from
      ? toDayString(range.from)
      : allDays[allDays.length - 1]
  return { fromStr, toStr }
}

// The calendar range picker plus quick presets, laid out to sit at the right of
// a card header.
function ChartFilters({
  range,
  onChange,
  onPreset,
}: {
  range: DateRange | undefined
  onChange: (range: DateRange | undefined) => void
  onPreset: (days: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <DatePickerWithRange
        value={range}
        onChange={onChange}
        maxRangeMonths={MAX_RANGE_MONTHS}
      />
      {PRESETS.map((preset) => (
        <Button
          key={preset.days}
          variant="outline"
          size="sm"
          onClick={() => onPreset(preset.days)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  )
}

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

  const minDay = allDays[0]
  const maxDay = allDays[allDays.length - 1]

  // Each chart owns its own range so the two cards can be zoomed independently.
  const usersRange = useChartRange(minDay, maxDay)
  const videosRange = useChartRange(minDay, maxDay)

  const usersBounds = rangeBounds(usersRange.range, allDays)
  const videosBounds = rangeBounds(videosRange.range, allDays)

  const filteredUsers = React.useMemo(
    () =>
      activeUsers.filter(
        (p) => p.date >= usersBounds.fromStr && p.date <= usersBounds.toStr,
      ),
    [activeUsers, usersBounds.fromStr, usersBounds.toStr],
  )
  const filteredVideos = React.useMemo(
    () =>
      videosByDay.filter(
        (p) => p.date >= videosBounds.fromStr && p.date <= videosBounds.toStr,
      ),
    [videosByDay, videosBounds.fromStr, videosBounds.toStr],
  )

  return (
    <div className="space-y-4">
      {/* Active users first, then videos analysed — each spans the full width,
          with its own range filters docked to the right of the header. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Active users per day
          </CardTitle>
          <CardDescription>
            Distinct non-admin users who used Hookpoint.ai each day (UTC).
          </CardDescription>
          <CardAction>
            <ChartFilters
              range={usersRange.range}
              onChange={usersRange.setRange}
              onPreset={usersRange.applyPreset}
            />
          </CardAction>
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
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={32}
                  allowDecimals={false}
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
          <CardAction>
            <ChartFilters
              range={videosRange.range}
              onChange={videosRange.setRange}
              onPreset={videosRange.applyPreset}
            />
          </CardAction>
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
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={32}
                  allowDecimals={false}
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
