import { createAdminClient } from "@/lib/supabase/admin"
import { subscriptionGrantsPaidAccess } from "@/lib/billing/entitlements"
import { getPlan, type PlanId } from "@/lib/plans"

// Data-access helpers for the admin interface. Everything here uses the
// service-role client, so it bypasses Row Level Security and MUST only be
// called from server code that has already verified the caller is an admin
// (see requireAdminUser in lib/admin/auth.ts).

export type AdminUserRow = {
  id: string
  username: string
  email: string
  avatarUrl: string | null
  isAdmin: boolean
  // The user's effective plan, resolved the same way entitlements are: a paid
  // subscription that currently grants access wins, otherwise Free.
  planId: PlanId
  planName: string
  createdAt: string
}

// Builds a map of user id → effective paid plan from the subscription
// projections. Only subscriptions that currently grant access are included;
// everyone else (no row, or an expired/non-entitling row) resolves to Free.
async function loadPaidPlansByUser(now: Date): Promise<Map<string, PlanId>> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select("user_id, plan_id, status, current_period_end")

  if (error) {
    throw new Error(`Failed to load subscriptions: ${error.message}`)
  }

  const plans = new Map<string, PlanId>()
  for (const row of data ?? []) {
    const grants = subscriptionGrantsPaidAccess(
      {
        status: row.status as string,
        currentPeriodEnd: row.current_period_end as string,
      },
      now,
    )
    if (grants) {
      plans.set(row.user_id as string, row.plan_id as PlanId)
    }
  }
  return plans
}

// Lists users for the management table, newest first. Capped so the page stays
// responsive; pagination/search can be layered on later if the base grows.
// Each user is annotated with their effective plan so the table can show it.
export async function listUsers(now: Date = new Date()): Promise<AdminUserRow[]> {
  const supabase = createAdminClient()

  const [{ data, error }, paidPlans] = await Promise.all([
    supabase
      .from("users")
      .select("id, username, email, avatar_url, is_admin, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    loadPaidPlansByUser(now),
  ])

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`)
  }

  return (data ?? []).map((row) => {
    const id = row.id as string
    const planId = paidPlans.get(id) ?? "free"
    return {
      id,
      username: row.username as string,
      email: row.email as string,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      isAdmin: Boolean(row.is_admin),
      planId,
      planName: getPlan(planId).name,
      createdAt: row.created_at as string,
    }
  })
}

export type AdminStats = {
  totalUsers: number
  totalAdmins: number
  // Light (YouTube-API) analyses: rows in analysed_videos.
  totalAnalysedVideos: number
  // Deep analyses: raw source files a user actually uploaded (bytes landed in
  // storage). Mirrors the states the user dashboard counts as "deeply analysed".
  totalSourceFilesUploaded: number
  // Total deep-dive credits spent across every user and billing window.
  totalDeepCreditsUsed: number
}

// Upload states where the raw bytes have genuinely landed in storage — i.e. a
// source file was really uploaded for deep analysis. Mirrors
// DEEP_ANALYSIS_UPLOAD_STATES in lib/dashboard/kpis.ts: "pending"/"uploading"
// haven't landed yet and "failed" never will, so none of those count.
const DEEP_ANALYSIS_UPLOAD_STATES = ["uploaded", "processing", "ready"]

// Aggregate counts for the admin dashboard. Counts use head+exact so no row
// data is transferred; the credits total needs the column values, so those rows
// are fetched and summed here. Deep-analysis tables are optional enhancements —
// a query failure there logs and reports zero rather than sinking the whole
// dashboard.
export async function getAdminStats(): Promise<AdminStats> {
  const supabase = createAdminClient()

  const [users, admins, videos, sourceFiles, deepCredits] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("is_admin", true),
    supabase.from("analysed_videos").select("*", { count: "exact", head: true }),
    supabase
      .from("source_files")
      .select("*", { count: "exact", head: true })
      .in("upload_status", DEEP_ANALYSIS_UPLOAD_STATES),
    supabase.from("usage_counters").select("deep_credits_used"),
  ])

  if (sourceFiles.error) {
    console.error("Failed to count source files", sourceFiles.error)
  }
  if (deepCredits.error) {
    console.error("Failed to load deep-credit usage", deepCredits.error)
  }

  const deepCreditRows = (deepCredits.error ? [] : (deepCredits.data ?? [])) as {
    deep_credits_used: number | null
  }[]
  const totalDeepCreditsUsed = deepCreditRows.reduce(
    (sum, row) =>
      sum + (typeof row.deep_credits_used === "number" ? row.deep_credits_used : 0),
    0,
  )

  return {
    totalUsers: users.count ?? 0,
    totalAdmins: admins.count ?? 0,
    totalAnalysedVideos: videos.count ?? 0,
    totalSourceFilesUploaded: sourceFiles.count ?? 0,
    totalDeepCreditsUsed,
  }
}
