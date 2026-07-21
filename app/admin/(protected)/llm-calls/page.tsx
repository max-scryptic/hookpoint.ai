import { AdminLlmCallsFilters } from "@/components/admin/admin-llm-calls-filters"
import { AdminLlmCallsTable } from "@/components/admin/admin-llm-calls-table"
import { requireAdminUser } from "@/lib/admin/auth"
import {
  listLlmCalls,
  listLlmCallUserOptions,
  type LlmCallFilters,
} from "@/lib/admin/llm-calls"
import { LLM_CALL_TYPES, type LlmCallType } from "@/lib/llm-calls"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

function parseCallType(value?: string): LlmCallType | undefined {
  if (value && (LLM_CALL_TYPES as readonly string[]).includes(value)) {
    return value as LlmCallType
  }
  return undefined
}

// Only treat a query value as a bound if it parses to a real date.
function parseDate(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// Admin LLM Calls: every paid AI/media call the platform makes and what it
// cost, filterable by user, type of call and a datetime window. Data is fetched
// server-side via the service-role client (llm_calls is admin-only).
export default async function AdminLlmCallsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    userId?: string
    callType?: string
    from?: string
    to?: string
  }>
}) {
  const resolved = (await searchParams) ?? {}

  const filters: LlmCallFilters = {
    userId: resolved.userId || undefined,
    callType: parseCallType(resolved.callType),
    from: parseDate(resolved.from),
    to: parseDate(resolved.to),
  }

  const [, { rows, totalCostUsd, truncated }, userOptions] = await Promise.all([
    requireAdminUser(),
    listLlmCalls(filters),
    listLlmCallUserOptions(),
  ])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">LLM Calls</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every LLM and Qencode transcoding call we make, and what it costs.
        </p>
      </div>

      <AdminLlmCallsFilters
        userOptions={userOptions}
        current={{
          userId: filters.userId,
          callType: filters.callType,
          from: filters.from,
          to: filters.to,
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {rows.length.toLocaleString()} call{rows.length === 1 ? "" : "s"}
          {truncated ? " (showing the most recent 1,000)" : ""}
        </span>
        <span className="font-medium">
          Total cost:{" "}
          <span className="tabular-nums">{formatUsd(totalCostUsd)}</span>
        </span>
      </div>

      <AdminLlmCallsTable rows={rows} />
    </div>
  )
}
