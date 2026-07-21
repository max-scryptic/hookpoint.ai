import { createAdminClient } from "@/lib/supabase/admin"
import type { CostType, LlmCallType } from "@/lib/llm-call-types"

// Read-side helpers for the admin cost log page. Everything here uses the
// service-role client (the cost_logs table has RLS enabled with no policies, so
// it is only reachable this way) and MUST only be called from server code that
// has already verified the caller is an admin (see requireAdminUser).

export interface CostLogRow {
  id: string
  userId: string | null
  userEmail: string | null
  costType: CostType
  // Null for costs with no call breakdown (e.g. a Qencode transcode).
  callType: LlmCallType | null
  provider: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  createdAt: string
}

export interface CostLogFilters {
  userId?: string
  costType?: CostType
  callType?: LlmCallType
  // ISO timestamps bounding the cost time (inclusive).
  from?: string
  to?: string
}

export interface CostLogListResult {
  rows: CostLogRow[]
  totalCostUsd: number
  // True when more matching rows exist than were returned (page was capped).
  truncated: boolean
}

// How many rows the listing returns at most. The summed cost reflects only the
// returned rows, so this cap is generous; pagination can be layered on later.
const ROW_LIMIT = 1000

interface CostLogDbRow {
  id: string
  user_id: string | null
  user_email: string | null
  analysed_video_id: string | null
  cost_type: CostType
  call_type: LlmCallType | null
  provider: string
  model: string | null
  input_tokens: number
  // numeric can arrive as a string via PostgREST; coerced on map.
  cost_usd: number | string
  output_tokens: number
  created_at: string
}

const COLUMNS =
  "id, user_id, user_email, cost_type, call_type, provider, model, input_tokens, output_tokens, cost_usd, created_at"

// Lists cost logs matching the filters, newest first, with each row's user
// email resolved from the users table (falling back to the denormalised email
// on the row so deleted accounts still read sensibly).
export async function listCostLogs(
  filters: CostLogFilters = {},
): Promise<CostLogListResult> {
  const supabase = createAdminClient()

  let query = supabase
    .from("cost_logs")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT + 1)

  if (filters.userId) query = query.eq("user_id", filters.userId)
  if (filters.costType) query = query.eq("cost_type", filters.costType)
  if (filters.callType) query = query.eq("call_type", filters.callType)
  if (filters.from) query = query.gte("created_at", filters.from)
  if (filters.to) query = query.lte("created_at", filters.to)

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to list cost logs: ${error.message}`)
  }

  const dbRows = (data ?? []) as CostLogDbRow[]
  const truncated = dbRows.length > ROW_LIMIT
  const capped = truncated ? dbRows.slice(0, ROW_LIMIT) : dbRows

  const emailById = await resolveUserEmails(
    supabase,
    capped.map((row) => row.user_id),
  )

  const rows: CostLogRow[] = capped.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail:
      (row.user_id ? emailById.get(row.user_id) : null) ?? row.user_email ?? null,
    costType: row.cost_type,
    callType: row.call_type,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Number(row.cost_usd),
    createdAt: row.created_at,
  }))

  const totalCostUsd = rows.reduce((sum, row) => sum + row.costUsd, 0)

  return { rows, totalCostUsd, truncated }
}

// The all-time total of every paid AI/media cost across every user, in USD.
// Sums the whole cost_logs.cost_usd column rather than a capped listing page, so
// the dashboard shows true account-wide spend. Mirrors how getAdminStats sums
// usage columns in JS; numeric values can arrive as strings via PostgREST, so
// each is coerced before summing.
export async function getTotalCostUsd(): Promise<number> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.from("cost_logs").select("cost_usd")

  if (error) {
    throw new Error(`Failed to total cost logs: ${error.message}`)
  }

  return ((data ?? []) as { cost_usd: number | string }[]).reduce(
    (sum, row) => sum + Number(row.cost_usd),
    0,
  )
}

// Resolves user_id -> email for the given ids in a single query.
async function resolveUserEmails(
  supabase: ReturnType<typeof createAdminClient>,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => Boolean(id))),
  )
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .in("id", ids)

  if (error) {
    console.error("Failed to resolve user emails for cost logs", error.message)
    return map
  }

  for (const row of (data ?? []) as { id: string; email: string | null }[]) {
    if (row.email) map.set(row.id, row.email)
  }
  return map
}

export interface CostLogUserOption {
  id: string
  email: string
}

// The set of users offered in the page's user filter. Lists every account
// (newest first) so any user can be filtered to, matching the users table.
export async function listCostLogUserOptions(): Promise<CostLogUserOption[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .order("created_at", { ascending: false })
    .limit(1000)

  if (error) {
    throw new Error(`Failed to list users for cost log filter: ${error.message}`)
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      email: (row.email as string | null) ?? "",
    }))
    .filter((option) => option.email !== "")
}
