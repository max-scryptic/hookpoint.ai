"use client"

import { useMemo, useState } from "react"
import { endOfDay, startOfDay } from "date-fns"
import { ListFilterIcon, VideoIcon, XIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { AdminLlmCallsTable } from "@/components/admin/admin-llm-calls-table"
import { DatePickerWithRange } from "@/components/date-range-picker"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CostLogRow } from "@/lib/admin/llm-calls"
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  LLM_CALL_TYPES,
  LLM_CALL_TYPE_LABELS,
  type CostType,
  type LlmCallType,
} from "@/lib/llm-call-types"

// Enough precision for the sub-cent figures a single call is, without trailing
// noise for larger totals. Matches the cost-log surfaces' formatting.
function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// A single-choice dropdown filter, matching the widgets on the main cost-log
// page. `value` is the empty string for "all", otherwise the selected key.
function FilterDropdown<T extends string>({
  icon: Icon,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  icon: typeof VideoIcon
  label: string
  allLabel: string
  value: string
  options: { value: T; label: string }[]
  onChange: (value: T | null) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
      >
        <Icon className="size-4" />
        <span className="max-w-[12rem] truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange((next || null) as T | null)}
        >
          <DropdownMenuRadioItem value="" className="whitespace-nowrap">
            {allLabel}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="whitespace-nowrap"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The cost-log breakdown + filterable table used on the admin user- and
// video-detail pages. Unlike the main cost-log page (which filters server-side
// via the URL because it queries across every user), these detail views already
// have the full row set for one user/one video in hand, so filtering happens
// in-memory — that keeps the surrounding tab state intact and needs no query
// params threaded through the page. The user filter is never shown here (the
// scope is already a single user); the video filter is shown on the user page
// and hidden on the single-video page via `showVideoFilter`.
export function AdminCostLogsPanel({
  rows,
  showVideoFilter = false,
  truncated = false,
}: {
  rows: CostLogRow[]
  showVideoFilter?: boolean
  truncated?: boolean
}) {
  const [videoId, setVideoId] = useState<string>()
  const [costType, setCostType] = useState<CostType>()
  const [callType, setCallType] = useState<LlmCallType>()
  const [range, setRange] = useState<DateRange>()

  // The videos offered in the filter, derived from the rows themselves so every
  // option yields results. Only videos actually carrying a cost log appear.
  const videoOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const row of rows) {
      if (row.analysedVideoId) {
        byId.set(row.analysedVideoId, row.videoTitle ?? "Untitled video")
      }
    }
    return Array.from(byId.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  // Normalise the picked range to whole-day bounds once, so the per-row filter
  // stays a cheap timestamp comparison.
  const fromMs = range?.from ? startOfDay(range.from).getTime() : undefined
  const toMs = range?.to ? endOfDay(range.to).getTime() : undefined

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (videoId && row.analysedVideoId !== videoId) return false
      if (costType && row.costType !== costType) return false
      if (callType && row.callType !== callType) return false
      if (fromMs != null || toMs != null) {
        const created = new Date(row.createdAt).getTime()
        if (fromMs != null && created < fromMs) return false
        if (toMs != null && created > toMs) return false
      }
      return true
    })
  }, [rows, videoId, costType, callType, fromMs, toMs])

  // Per-cost-type spend for the filtered rows, so the breakdown reads at a
  // glance and tracks whatever filters are applied.
  const costBreakdown = useMemo(() => {
    const byType = new Map<CostType, { count: number; total: number }>()
    for (const row of filtered) {
      const entry = byType.get(row.costType) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += row.costUsd
      byType.set(row.costType, entry)
    }
    return Array.from(byType.entries())
      .map(([type, entry]) => ({ type, ...entry }))
      .sort((a, b) => b.total - a.total)
  }, [filtered])

  const totalCostUsd = filtered.reduce((sum, row) => sum + row.costUsd, 0)

  const hasActiveFilters =
    Boolean(videoId) ||
    Boolean(costType) ||
    Boolean(callType) ||
    Boolean(range?.from) ||
    Boolean(range?.to)

  function clearFilters() {
    setVideoId(undefined)
    setCostType(undefined)
    setCallType(undefined)
    setRange(undefined)
  }

  const videoLabel = videoId
    ? videoOptions.find((option) => option.value === videoId)?.label ??
      "All videos"
    : "All videos"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {showVideoFilter && (
          <FilterDropdown
            icon={VideoIcon}
            label={videoLabel}
            allLabel="All videos"
            value={videoId ?? ""}
            options={videoOptions}
            onChange={(value) => setVideoId(value ?? undefined)}
          />
        )}

        <FilterDropdown
          icon={ListFilterIcon}
          label={costType ? COST_TYPE_LABELS[costType] : "All cost types"}
          allLabel="All cost types"
          value={costType ?? ""}
          options={COST_TYPES.map((type) => ({
            value: type,
            label: COST_TYPE_LABELS[type],
          }))}
          onChange={(value) => setCostType(value ?? undefined)}
        />

        <FilterDropdown
          icon={ListFilterIcon}
          label={callType ? LLM_CALL_TYPE_LABELS[callType] : "All call types"}
          allLabel="All call types"
          value={callType ?? ""}
          options={LLM_CALL_TYPES.map((type) => ({
            value: type,
            label: LLM_CALL_TYPE_LABELS[type],
          }))}
          onChange={(value) => setCallType(value ?? undefined)}
        />

        <DatePickerWithRange
          value={range}
          onChange={setRange}
          placeholder="Date range"
        />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            onClick={clearFilters}
          >
            <XIcon className="size-4" />
            Clear
          </Button>
        )}
      </div>

      {costBreakdown.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {costBreakdown.map((entry) => (
            <div
              key={entry.type}
              className="flex items-center justify-between rounded-lg border bg-card p-3 dark:bg-muted/30"
            >
              <div>
                <div className="text-sm font-medium">
                  {COST_TYPE_LABELS[entry.type] ?? entry.type}
                </div>
                <div className="text-xs text-muted-foreground">
                  {entry.count.toLocaleString()} entr
                  {entry.count === 1 ? "y" : "ies"}
                </div>
              </div>
              <div className="font-medium tabular-nums">
                {formatUsd(entry.total)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {filtered.length.toLocaleString()} entr
          {filtered.length === 1 ? "y" : "ies"}
          {truncated ? " (showing the most recent 1,000)" : ""}
        </span>
        <span className="font-medium">
          Total cost:{" "}
          <span className="tabular-nums">{formatUsd(totalCostUsd)}</span>
        </span>
      </div>

      {/* The user is fixed on every surface this panel is used on, so the User
          column is always redundant here; the Video column is only redundant
          on the single-video page, which is exactly where the video filter is
          hidden. */}
      <AdminLlmCallsTable
        rows={filtered}
        hideUserColumn
        hideVideoColumn={!showVideoFilter}
      />
    </div>
  )
}
