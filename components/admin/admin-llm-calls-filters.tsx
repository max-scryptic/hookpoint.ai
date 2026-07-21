"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  LLM_CALL_TYPES,
  LLM_CALL_TYPE_LABELS,
  type LlmCallType,
} from "@/lib/llm-call-types"
import type { LlmCallUserOption } from "@/lib/admin/llm-calls"
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

export interface LlmCallFilterValues {
  userId?: string
  callType?: LlmCallType
  from?: string
  to?: string
}

// The filter bar for the admin LLM Calls page: user, type of call, and a
// datetime window (from / to). Filtering is done server-side — applying pushes
// the choices into the URL query, which the server page reads and re-queries.
export function AdminLlmCallsFilters({
  userOptions,
  current,
}: {
  userOptions: LlmCallUserOption[]
  current: LlmCallFilterValues
}) {
  const router = useRouter()
  const [userId, setUserId] = useState(current.userId ?? "")
  const [callType, setCallType] = useState<string>(current.callType ?? "")
  const [from, setFrom] = useState(toDatetimeLocal(current.from))
  const [to, setTo] = useState(toDatetimeLocal(current.to))

  function apply() {
    const params = new URLSearchParams()
    if (userId) params.set("userId", userId)
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
    setCallType("")
    setFrom("")
    setTo("")
    router.push("/admin/llm-calls")
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <Label htmlFor="filter-type">Type of call</Label>
          <select
            id="filter-type"
            className={selectClasses}
            value={callType}
            onChange={(event) => setCallType(event.target.value)}
          >
            <option value="">All types</option>
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
