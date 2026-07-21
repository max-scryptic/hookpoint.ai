import { createAdminClient } from "@/lib/supabase/admin"
import type { LlmCallType } from "@/lib/llm-call-types"

// Read-side helpers for the admin LLM Calls page. Everything here uses the
// service-role client (the llm_calls table has RLS enabled with no policies, so
// it is only reachable this way) and MUST only be called from server code that
// has already verified the caller is an admin (see requireAdminUser).

export interface LlmCallRow {
  id: string
  userId: string | null
  userEmail: string | null
  callType: LlmCallType
  provider: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  createdAt: string
}

export interface LlmCallFilters {
  userId?: string
  callType?: LlmCallType
  // ISO timestamps bounding the call time (inclusive).
  from?: string
  to?: string
}

export interface LlmCallListResult {
  rows: LlmCallRow[]
  totalCostUsd: number
  // True when more matching rows exist than were returned (page was capped).
  truncated: boolean
}

// How many rows the listing returns at most. The summed cost reflects only the
// returned rows, so this cap is generous; pagination can be layered on later.
const ROW_LIMIT = 1000

interface LlmCallDbRow {
  id: string
  user_id: string | null
  user_email: string | null
  analysed_video_id: string | null
  call_type: LlmCallType
  provider: string
  model: string | null
  input_tokens: number
  // numeric can arrive as a string via PostgREST; coerced on map.
  cost_usd: number | string
  output_tokens: number
  created_at: string
}

const COLUMNS =
  "id, user_id, user_email, call_type, provider, model, input_tokens, output_tokens, cost_usd, created_at"

// Lists calls matching the filters, newest first, with each row's user email
// resolved from the users table (falling back to the denormalised email on the
// row so deleted accounts still read sensibly).
export async function listLlmCalls(
  filters: LlmCallFilters = {},
): Promise<LlmCallListResult> {
  const supabase = createAdminClient()

  let query = supabase
    .from("llm_calls")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT + 1)

  if (filters.userId) query = query.eq("user_id", filters.userId)
  if (filters.callType) query = query.eq("call_type", filters.callType)
  if (filters.from) query = query.gte("created_at", filters.from)
  if (filters.to) query = query.lte("created_at", filters.to)

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to list LLM calls: ${error.message}`)
  }

  const dbRows = (data ?? []) as LlmCallDbRow[]
  const truncated = dbRows.length > ROW_LIMIT
  const capped = truncated ? dbRows.slice(0, ROW_LIMIT) : dbRows

  const emailById = await resolveUserEmails(
    supabase,
    capped.map((row) => row.user_id),
  )

  const rows: LlmCallRow[] = capped.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail:
      (row.user_id ? emailById.get(row.user_id) : null) ?? row.user_email ?? null,
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
    console.error("Failed to resolve user emails for LLM calls", error.message)
    return map
  }

  for (const row of (data ?? []) as { id: string; email: string | null }[]) {
    if (row.email) map.set(row.id, row.email)
  }
  return map
}

export interface LlmCallUserOption {
  id: string
  email: string
}

// The set of users offered in the page's user filter. Lists every account
// (newest first) so any user can be filtered to, matching the users table.
export async function listLlmCallUserOptions(): Promise<LlmCallUserOption[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .order("created_at", { ascending: false })
    .limit(1000)

  if (error) {
    throw new Error(`Failed to list users for LLM call filter: ${error.message}`)
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      email: (row.email as string | null) ?? "",
    }))
    .filter((option) => option.email !== "")
}
