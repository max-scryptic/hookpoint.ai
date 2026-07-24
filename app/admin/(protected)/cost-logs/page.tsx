import { AdminLlmCallsFilters } from "@/components/admin/admin-llm-calls-filters"
import { AdminLlmCallsTable } from "@/components/admin/admin-llm-calls-table"
import { requireAdminUser } from "@/lib/admin/auth"
import {
  listCostLogs,
  listCostLogUserOptions,
  listCostLogVideoOptions,
  type CostLogFilters,
} from "@/lib/admin/llm-calls"
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  LLM_CALL_TYPES,
  type CostType,
  type LlmCallType,
} from "@/lib/llm-calls"
import type { CostLogRow } from "@/lib/admin/llm-calls"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

function parseCostType(value?: string): CostType | undefined {
  if (value && (COST_TYPES as readonly string[]).includes(value)) {
    return value as CostType
  }
  return undefined
}

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

// Per-cost-type spend for the listed rows, largest first, so the summary line
// can break the total down by type. Summed from the same (capped) rows as the
// grand total, so the parts always add up to it.
function costBreakdown(
  rows: CostLogRow[],
): { type: CostType; total: number }[] {
  const byType = new Map<CostType, number>()
  for (const row of rows) {
    byType.set(row.costType, (byType.get(row.costType) ?? 0) + row.costUsd)
  }
  return Array.from(byType.entries())
    .map(([type, total]) => ({ type, total }))
    .sort((a, b) => b.total - a.total)
}

// Admin cost log: every paid AI/media cost the platform incurs and what it
// cost, filterable by user, cost type, type of call and a datetime window. Data
// is fetched server-side via the service-role client (cost_logs is admin-only).
export default async function AdminLlmCallsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    userId?: string
    videoId?: string
    costType?: string
    callType?: string
    from?: string
    to?: string
  }>
}) {
  const resolved = (await searchParams) ?? {}

  const userId = resolved.userId || undefined

  const filters: CostLogFilters = {
    userId,
    // A video belongs to one user, so the video filter only applies once a user
    // is selected; ignore any stray videoId that arrives without a user.
    videoId: userId ? resolved.videoId || undefined : undefined,
    costType: parseCostType(resolved.costType),
    callType: parseCallType(resolved.callType),
    from: parseDate(resolved.from),
    to: parseDate(resolved.to),
  }

  const [, { rows, totalCostUsd, truncated }, userOptions, videoOptions] =
    await Promise.all([
      requireAdminUser(),
      listCostLogs(filters),
      listCostLogUserOptions(),
      listCostLogVideoOptions(userId),
    ])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Cost Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every LLM and Qencode transcoding cost we incur, and what it costs.
        </p>
      </div>

      <AdminLlmCallsFilters
        userOptions={userOptions}
        videoOptions={videoOptions}
        current={{
          userId: filters.userId,
          videoId: filters.videoId,
          costType: filters.costType,
          callType: filters.callType,
          from: filters.from,
          to: filters.to,
        }}
      />

      {/* The per-cost-type spend sits inline beside the grand total. The
          per-type figures are muted so the total stands out as the headline
          number. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {rows.length.toLocaleString()} entr{rows.length === 1 ? "y" : "ies"}
          {truncated ? " (showing the most recent 1,000)" : ""}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {costBreakdown(rows).map((entry) => (
            <span key={entry.type} className="text-muted-foreground">
              {COST_TYPE_LABELS[entry.type] ?? entry.type}:{" "}
              <span className="tabular-nums">{formatUsd(entry.total)}</span>
            </span>
          ))}
          <span className="font-medium">
            Total cost:{" "}
            <span className="tabular-nums">{formatUsd(totalCostUsd)}</span>
          </span>
        </div>
      </div>

      <AdminLlmCallsTable rows={rows} />
    </div>
  )
}
