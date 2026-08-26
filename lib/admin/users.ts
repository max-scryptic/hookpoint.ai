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

// The bare account profile shown at the top of a user's detail page. Plan and
// billing-cycle information is resolved separately via the billing snapshot, so
// this deliberately carries only the columns on the users row.
export type AdminUserProfile = {
  id: string
  username: string
  email: string
  avatarUrl: string | null
  isAdmin: boolean
  createdAt: string
}

// Loads a single account by id, or null when no such user exists. Used by the
// admin user detail page; the caller resolves plan/usage separately.
export async function getUserById(
  userId: string,
): Promise<AdminUserProfile | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("users")
    .select("id, username, email, avatar_url, is_admin, created_at")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load user: ${error.message}`)
  }
  if (!data) return null

  return {
    id: data.id as string,
    username: data.username as string,
    email: data.email as string,
    avatarUrl: (data.avatar_url as string | null) ?? null,
    isAdmin: Boolean(data.is_admin),
    createdAt: data.created_at as string,
  }
}

// The headline counts shown for a single user on their detail page. Mirrors the
// account-wide numbers on the admin dashboard, but scoped to one user.
export type AdminUserKpis = {
  // Light (YouTube-API) analyses this user has run.
  videosAnalysed: number
  // Raw source files this user actually uploaded for deep analysis (bytes
  // landed in storage), using the same states as the dashboard aggregate.
  sourceFilesUploaded: number
  // Deep-dive credits this user has spent across every billing window (all-time).
  deepCreditsUsed: number
  // Retention-window events synthesized across all of this user's deep analyses.
  eventsGenerated: number
}

// Aggregates one user's headline counts. Counts use head+exact so no row data is
// transferred; the credits total needs the column values, so those rows are
// fetched and summed. The deep-analysis tables are optional enhancements, so a
// failure there logs and reports zero rather than sinking the whole page.
export async function getUserKpis(userId: string): Promise<AdminUserKpis> {
  const supabase = createAdminClient()

  const [videos, sourceFiles, deepCredits, events] = await Promise.all([
    supabase
      .from("analysed_videos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("source_files")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("upload_status", DEEP_ANALYSIS_UPLOAD_STATES),
    supabase
      .from("usage_counters")
      .select("deep_credits_used")
      .eq("user_id", userId),
    supabase
      .from("retention_window_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
  ])

  if (videos.error) {
    console.error("Failed to count analysed videos for user", videos.error)
  }
  if (sourceFiles.error) {
    console.error("Failed to count source files for user", sourceFiles.error)
  }
  if (deepCredits.error) {
    console.error("Failed to load deep-credit usage for user", deepCredits.error)
  }
  if (events.error) {
    console.error("Failed to count retention events for user", events.error)
  }

  const deepCreditRows = (deepCredits.error ? [] : (deepCredits.data ?? [])) as {
    deep_credits_used: number | null
  }[]
  const deepCreditsUsed = deepCreditRows.reduce(
    (sum, row) =>
      sum + (typeof row.deep_credits_used === "number" ? row.deep_credits_used : 0),
    0,
  )

  return {
    videosAnalysed: videos.count ?? 0,
    sourceFilesUploaded: sourceFiles.count ?? 0,
    deepCreditsUsed,
    eventsGenerated: events.count ?? 0,
  }
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

// Upload states where the raw bytes have genuinely landed in storage - i.e. a
// source file was really uploaded for deep analysis. Mirrors
// DEEP_ANALYSIS_UPLOAD_STATES in lib/admin/activity.ts: "pending"/"uploading"
// haven't landed yet and "failed" never will, so none of those count.
const DEEP_ANALYSIS_UPLOAD_STATES = ["uploaded", "processing", "ready"]

// Aggregate counts for the admin dashboard. Counts use head+exact so no row
// data is transferred; the credits total needs the column values, so those rows
// are fetched and summed here. Deep-analysis tables are optional enhancements -
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
