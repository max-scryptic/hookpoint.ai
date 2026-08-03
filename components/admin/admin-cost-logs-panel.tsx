"use client"

import { useMemo, useState } from "react"
import { endOfDay, startOfDay } from "date-fns"
import { ListFilterIcon, VideoIcon, XIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { AdminLlmCallsTable } from "@/components/admin/admin-llm-calls-table"
import { CostLogSummary } from "@/components/admin/cost-log-summary"
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
  callTypeInScope,
  COST_SCOPES,
  COST_SCOPE_LABELS,
  costScopeFilters,
  LLM_CALL_TYPES,
  LLM_CALL_TYPES_BY_GROUP,
  LLM_CALL_TYPE_LABELS,
  llmCallGroup,
  type CostScope,
  type LlmCallType,
} from "@/lib/llm-call-types"

// A single-choice dropdown filter, matching the widgets on the main cost-log
// page. `value` is the empty string for "all", otherwise the selected key.
function FilterDropdown<T extends string>({
  icon: Icon,
  label,
  allLabel,
  value,
  options,
  onChange,
  disabled = false,
}: {
  icon: typeof VideoIcon
  label: string
  allLabel: string
  value: string
  options: { value: T; label: string }[]
  onChange: (value: T | null) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
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
  const [costScope, setCostScope] = useState<CostScope>()
  const [callType, setCallType] = useState<LlmCallType>()
  const [range, setRange] = useState<DateRange>()

  // The cost type and (for LLM calls) the call group the picked scope filters
  // by — one dropdown driving two row predicates.
  const { costType, callGroup } = costScopeFilters(costScope)

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
      if (callGroup && llmCallGroup(row.callType) !== callGroup) return false
      if (callType && row.callType !== callType) return false
      if (fromMs != null || toMs != null) {
        const created = new Date(row.createdAt).getTime()
        if (fromMs != null && created < fromMs) return false
        if (toMs != null && created > toMs) return false
      }
      return true
    })
  }, [rows, videoId, costType, callGroup, callType, fromMs, toMs])

  const totalCostUsd = filtered.reduce((sum, row) => sum + row.costUsd, 0)

  const hasActiveFilters =
    Boolean(videoId) ||
    Boolean(costScope) ||
    Boolean(callType) ||
    Boolean(range?.from) ||
    Boolean(range?.to)

  function clearFilters() {
    setVideoId(undefined)
    setCostScope(undefined)
    setCallType(undefined)
    setRange(undefined)
  }

  // Narrowing the scope drops a call type it no longer covers, so the two
  // filters can never contradict into an empty table.
  function changeCostScope(next: CostScope | null) {
    setCostScope(next ?? undefined)
    setCallType(callTypeInScope(next ?? undefined, callType))
  }

  // The call types worth offering under the current scope: an LLM group narrows
  // the list to its own calls, and a transcode scope has no call types at all.
  const callTypeOptions =
    costType === "qencode_transcode"
      ? []
      : callGroup
        ? LLM_CALL_TYPES_BY_GROUP[callGroup]
        : LLM_CALL_TYPES

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
          label={costScope ? COST_SCOPE_LABELS[costScope] : "All cost types"}
          allLabel="All cost types"
          value={costScope ?? ""}
          options={COST_SCOPES.map((value) => ({
            value,
            label: COST_SCOPE_LABELS[value],
          }))}
          onChange={changeCostScope}
        />

        <FilterDropdown
          icon={ListFilterIcon}
          label={callType ? LLM_CALL_TYPE_LABELS[callType] : "All call types"}
          allLabel="All call types"
          disabled={callTypeOptions.length === 0}
          value={callType ?? ""}
          options={callTypeOptions.map((type) => ({
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

      {/* The spend breakdown sits inline beside the grand total rather than in
          its own KPI cards — it reads at a glance without eating vertical
          space. Shared with the account-wide cost-log page so both read the
          same, and it tracks whatever filters are applied here. */}
      <CostLogSummary
        rows={filtered}
        totalCostUsd={totalCostUsd}
        truncated={truncated}
      />

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
