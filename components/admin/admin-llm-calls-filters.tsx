"use client"

import { useRouter } from "next/navigation"
import { endOfDay, startOfDay } from "date-fns"
import { ListFilterIcon, UsersIcon, VideoIcon, XIcon } from "lucide-react"
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
  callTypeInScope,
  COST_SCOPES,
  COST_SCOPE_LABELS,
  costScopeFilters,
  LLM_CALL_TYPES,
  LLM_CALL_TYPES_BY_GROUP,
  LLM_CALL_TYPE_LABELS,
  type CostScope,
  type LlmCallType,
} from "@/lib/llm-call-types"
import type {
  CostLogUserOption,
  CostLogVideoOption,
} from "@/lib/admin/llm-calls"

export interface CostLogFilterValues {
  userId?: string
  videoId?: string
  // The combined cost-type/LLM-group choice, e.g. "llm_call:comparison".
  costScope?: CostScope | ""
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
// server page reads and re-queries - no separate "apply" step, matching the
// instant filtering on the front-end.
export function AdminLlmCallsFilters({
  userOptions,
  videoOptions,
  current,
}: {
  userOptions: CostLogUserOption[]
  videoOptions: CostLogVideoOption[]
  current: CostLogFilterValues
}) {
  const router = useRouter()

  // Builds the next query from the current filters plus the changed field and
  // navigates. Passing `null` for a field clears it.
  function pushWith(overrides: Partial<Record<keyof CostLogFilterValues, string | null>>) {
    const next: Record<keyof CostLogFilterValues, string | undefined> = {
      userId: current.userId,
      videoId: current.videoId,
      costScope: current.costScope || undefined,
      callType: current.callType,
      from: current.from,
      to: current.to,
    }
    for (const [key, value] of Object.entries(overrides)) {
      next[key as keyof CostLogFilterValues] = value ?? undefined
    }
    const params = new URLSearchParams()
    if (next.userId) params.set("userId", next.userId)
    if (next.videoId) params.set("videoId", next.videoId)
    // The scope rides in the long-standing costType param - it is still the
    // cost-type filter, now with the LLM groups folded into it.
    if (next.costScope) params.set("costType", next.costScope)
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
  // The video filter only makes sense once a user is picked, so it stays
  // disabled until then (a video belongs to exactly one user).
  const videoFilterEnabled = Boolean(current.userId)
  const selectedVideo = videoOptions.find(
    (option) => option.id === current.videoId,
  )
  const videoLabel = selectedVideo?.title ?? "All videos"
  const costScopeLabel = current.costScope
    ? COST_SCOPE_LABELS[current.costScope]
    : "All cost types"
  const callTypeLabel = current.callType
    ? LLM_CALL_TYPE_LABELS[current.callType]
    : "All call types"

  // The call types worth offering under the current scope: an LLM group narrows
  // the list to its own calls, and a transcode scope has no call types at all.
  const scope = costScopeFilters(current.costScope || undefined)
  const callTypeOptions =
    scope.costType === "qencode_transcode"
      ? []
      : scope.callGroup
        ? LLM_CALL_TYPES_BY_GROUP[scope.callGroup]
        : LLM_CALL_TYPES

  const hasActiveFilters =
    Boolean(current.userId) ||
    Boolean(current.videoId) ||
    Boolean(current.costScope) ||
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
            onValueChange={(value) =>
              // Switching (or clearing) the user invalidates any video choice,
              // since a video belongs to exactly one user.
              pushWith({ userId: value || null, videoId: null })
            }
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
          disabled={!videoFilterEnabled}
          render={
            <Button variant="outline" size="sm" className="h-9 gap-2" />
          }
        >
          <VideoIcon className="size-4" />
          <span className="max-w-[12rem] truncate">
            {videoFilterEnabled ? videoLabel : "All videos"}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
        >
          <DropdownMenuRadioGroup
            value={current.videoId ?? ""}
            onValueChange={(value) => pushWith({ videoId: value || null })}
          >
            <DropdownMenuRadioItem value="" className="whitespace-nowrap">
              All videos
            </DropdownMenuRadioItem>
            {videoOptions.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                className="whitespace-nowrap"
              >
                {option.title}
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
          {costScopeLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
        >
          <DropdownMenuRadioGroup
            value={current.costScope ?? ""}
            onValueChange={(value) =>
              // A narrower scope invalidates a call type it doesn't cover, so
              // the two filters can never contradict into an empty table.
              pushWith({
                costScope: value || null,
                callType: callTypeInScope(value, current.callType) ?? null,
              })
            }
          >
            <DropdownMenuRadioItem value="" className="whitespace-nowrap">
              All cost types
            </DropdownMenuRadioItem>
            {COST_SCOPES.map((value) => (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                className="whitespace-nowrap"
              >
                {COST_SCOPE_LABELS[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={callTypeOptions.length === 0}
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
            {callTypeOptions.map((type) => (
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
