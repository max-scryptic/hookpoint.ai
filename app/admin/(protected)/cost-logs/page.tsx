import { AdminLlmCallsFilters } from "@/components/admin/admin-llm-calls-filters"
import { AdminLlmCallsTable } from "@/components/admin/admin-llm-calls-table"
import { CostLogSummary } from "@/components/admin/cost-log-summary"
import { requireAdminUser } from "@/lib/admin/auth"
import {
  listCostLogs,
  listCostLogUserOptions,
  listCostLogVideoOptions,
  type CostLogFilters,
} from "@/lib/admin/llm-calls"
import {
  costScopeFilters,
  costScopeValue,
  LLM_CALL_TYPES,
  type LlmCallType,
} from "@/lib/llm-call-types"

// Per-request admin data behind an auth check - never statically prerender.
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

// Admin cost log: every paid AI/media cost the platform incurs and what it
// cost, filterable by user, cost scope (all LLM calls, analysis-only LLM calls,
// comparison-report LLM calls, or transcoding), type of call and a datetime
// window. Data is fetched server-side via the service-role client (cost_logs is
// admin-only).
export default async function AdminLlmCallsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    userId?: string
    videoId?: string
    // The cost-scope dropdown's value, e.g. "llm_call" or "llm_call:comparison"
    // - one param covering both the cost type and the LLM call group.
    costType?: string
    callType?: string
    from?: string
    to?: string
  }>
}) {
  const resolved = (await searchParams) ?? {}

  const userId = resolved.userId || undefined
  const scope = costScopeFilters(resolved.costType)

  const filters: CostLogFilters = {
    userId,
    // A video belongs to one user, so the video filter only applies once a user
    // is selected; ignore any stray videoId that arrives without a user.
    videoId: userId ? resolved.videoId || undefined : undefined,
    costType: scope.costType,
    callGroup: scope.callGroup,
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
          costScope: costScopeValue(filters.costType, filters.callGroup),
          callType: filters.callType,
          from: filters.from,
          to: filters.to,
        }}
      />

      <CostLogSummary
        rows={rows}
        totalCostUsd={totalCostUsd}
        truncated={truncated}
      />

      <AdminLlmCallsTable rows={rows} />
    </div>
  )
}
