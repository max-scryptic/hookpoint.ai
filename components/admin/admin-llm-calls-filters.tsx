"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  LLM_CALL_TYPES,
  LLM_CALL_TYPE_LABELS,
  type CostType,
  type LlmCallType,
} from "@/lib/llm-call-types"
import type { CostLogUserOption } from "@/lib/admin/llm-calls"
import { cn } from "@/lib/utils"

const selectClasses = cn(
  "h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 py-1 text-sm transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
)

// Converts an ISO timestamp to the `yyyy-MM-ddTHH:mm` a datetime-local input
// wants, in the viewer's local time. Empty for a missing/invalid value.
function toDatetimeLocal(iso?: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Local datetime-local value -> ISO string for the query, or undefined.
function fromDatetimeLocal(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

export interface CostLogFilterValues {
  userId?: string
  costType?: CostType
  callType?: LlmCallType
  from?: string
  to?: string
}

// The filter bar for the admin cost log page: user, cost type, type of call and
// a datetime window (from / to). Filtering is done server-side — applying
// pushes the choices into the URL query, which the server page reads and
// re-queries.
export function AdminLlmCallsFilters({
  userOptions,
  current,
}: {
  userOptions: CostLogUserOption[]
  current: CostLogFilterValues
}) {
  const router = useRouter()
  const [userId, setUserId] = useState(current.userId ?? "")
  const [costType, setCostType] = useState<string>(current.costType ?? "")
  const [callType, setCallType] = useState<string>(current.callType ?? "")
  const [from, setFrom] = useState(toDatetimeLocal(current.from))
  const [to, setTo] = useState(toDatetimeLocal(current.to))

  function apply() {
    const params = new URLSearchParams()
    if (userId) params.set("userId", userId)
    if (costType) params.set("costType", costType)
    if (callType) params.set("callType", callType)
    const fromIso = fromDatetimeLocal(from)
    const toIso = fromDatetimeLocal(to)
    if (fromIso) params.set("from", fromIso)
    if (toIso) params.set("to", toIso)
    const query = params.toString()
    router.push(query ? `/admin/llm-calls?${query}` : "/admin/llm-calls")
  }

  function reset() {
    setUserId("")
    setCostType("")
    setCallType("")
    setFrom("")
    setTo("")
    router.push("/admin/llm-calls")
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="filter-user">User</Label>
          <select
            id="filter-user"
            className={selectClasses}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">All users</option>
            {userOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.email}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-cost-type">Cost type</Label>
          <select
            id="filter-cost-type"
            className={selectClasses}
            value={costType}
            onChange={(event) => setCostType(event.target.value)}
          >
            <option value="">All cost types</option>
            {COST_TYPES.map((type) => (
              <option key={type} value={type}>
                {COST_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-type">Type of call</Label>
          <select
            id="filter-type"
            className={selectClasses}
            value={callType}
            onChange={(event) => setCallType(event.target.value)}
          >
            <option value="">All call types</option>
            {LLM_CALL_TYPES.map((type) => (
              <option key={type} value={type}>
                {LLM_CALL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-from">From</Label>
          <input
            id="filter-from"
            type="datetime-local"
            className={selectClasses}
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filter-to">To</Label>
          <input
            id="filter-to"
            type="datetime-local"
            className={selectClasses}
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={apply}>
          Apply filters
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  )
}
