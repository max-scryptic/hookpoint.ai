"use client"

import { useRouter } from "next/navigation"
import { endOfDay, startOfDay } from "date-fns"
import { ListFilterIcon, UsersIcon, XIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DatePickerWithRange } from "@/components/date-range-picker"
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  LLM_CALL_TYPES,
  LLM_CALL_TYPE_LABELS,
  type CostType,
  type LlmCallType,
} from "@/lib/llm-call-types"
import type { CostLogUserOption } from "@/lib/admin/llm-calls"

export interface CostLogFilterValues {
  userId?: string
  costType?: CostType
  callType?: LlmCallType
  from?: string
  to?: string
}

// Turns the stored ISO from/to bounds back into a react-day-picker range so the
// date picker reflects whatever window is currently applied.
function toDateRange(from?: string, to?: string): DateRange | undefined {
  const start = from ? new Date(from) : undefined
  const end = to ? new Date(to) : undefined
  if (start && Number.isNaN(start.getTime())) return undefined
  if (end && Number.isNaN(end.getTime())) return undefined
  if (!start && !end) return undefined
  return { from: start, to: end }
}

// The filter bar for the admin cost log, built from the same widgets the
// front-end video browser uses: dropdown radio menus for the single-choice
// filters and the shared date-range picker for the datetime window. Filtering is
// server-side, so every change pushes the choices into the URL query, which the
// server page reads and re-queries — no separate "apply" step, matching the
// instant filtering on the front-end.
export function AdminLlmCallsFilters({
  userOptions,
  current,
}: {
  userOptions: CostLogUserOption[]
  current: CostLogFilterValues
}) {
  const router = useRouter()

  // Builds the next query from the current filters plus the changed field and
  // navigates. Passing `null` for a field clears it.
  function pushWith(overrides: Partial<Record<keyof CostLogFilterValues, string | null>>) {
    const next: Record<keyof CostLogFilterValues, string | undefined> = {
      userId: current.userId,
      costType: current.costType,
      callType: current.callType,
      from: current.from,
      to: current.to,
    }
    for (const [key, value] of Object.entries(overrides)) {
      next[key as keyof CostLogFilterValues] = value ?? undefined
    }
    const params = new URLSearchParams()
    if (next.userId) params.set("userId", next.userId)
    if (next.costType) params.set("costType", next.costType)
    if (next.callType) params.set("callType", next.callType)
    if (next.from) params.set("from", next.from)
    if (next.to) params.set("to", next.to)
    const query = params.toString()
    router.push(query ? `/admin/cost-logs?${query}` : "/admin/cost-logs")
  }

  function changeDateRange(range: DateRange | undefined) {
    pushWith({
      from: range?.from ? startOfDay(range.from).toISOString() : null,
      to: range?.to ? endOfDay(range.to).toISOString() : null,
    })
  }

  function clearFilters() {
    router.push("/admin/cost-logs")
  }

  const selectedUser = userOptions.find((option) => option.id === current.userId)
  const userLabel = selectedUser?.email ?? "All users"
  const costTypeLabel = current.costType
    ? COST_TYPE_LABELS[current.costType]
    : "All cost types"
  const callTypeLabel = current.callType
    ? LLM_CALL_TYPE_LABELS[current.callType]
    : "All call types"

  const hasActiveFilters =
    Boolean(current.userId) ||
    Boolean(current.costType) ||
    Boolean(current.callType) ||
    Boolean(current.from) ||
    Boolean(current.to)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
        >
          <UsersIcon className="size-4" />
          <span className="max-w-[12rem] truncate">{userLabel}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
        >
          <DropdownMenuRadioGroup
            value={current.userId ?? ""}
            onValueChange={(value) => pushWith({ userId: value || null })}
          >
            <DropdownMenuRadioItem value="" className="whitespace-nowrap">
              All users
            </DropdownMenuRadioItem>
            {userOptions.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                className="whitespace-nowrap"
              >
                {option.email}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
        >
          <ListFilterIcon className="size-4" />
          {costTypeLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
        >
          <DropdownMenuRadioGroup
            value={current.costType ?? ""}
            onValueChange={(value) => pushWith({ costType: value || null })}
          >
            <DropdownMenuRadioItem value="" className="whitespace-nowrap">
              All cost types
            </DropdownMenuRadioItem>
            {COST_TYPES.map((type) => (
              <DropdownMenuRadioItem
                key={type}
                value={type}
                className="whitespace-nowrap"
              >
                {COST_TYPE_LABELS[type]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
        >
          <ListFilterIcon className="size-4" />
          {callTypeLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
        >
          <DropdownMenuRadioGroup
            value={current.callType ?? ""}
            onValueChange={(value) => pushWith({ callType: value || null })}
          >
            <DropdownMenuRadioItem value="" className="whitespace-nowrap">
              All call types
            </DropdownMenuRadioItem>
            {LLM_CALL_TYPES.map((type) => (
              <DropdownMenuRadioItem
                key={type}
                value={type}
                className="whitespace-nowrap"
              >
                {LLM_CALL_TYPE_LABELS[type]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DatePickerWithRange
        value={toDateRange(current.from, current.to)}
        onChange={changeDateRange}
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
  )
}
