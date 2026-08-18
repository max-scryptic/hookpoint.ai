import { createAdminClient } from "@/lib/supabase/admin"

// Data-access helpers for the admin dashboard's time-series charts. Like the
// rest of lib/admin/*, everything here uses the service-role client (bypasses
// RLS) and MUST only be called from server code that has already verified the
// caller is an admin.
//
// Every series buckets on the UTC calendar day, matching how activity is
// recorded (see lib/activity/record-daily-activity.ts), so "a day" means the
// same thing across the whole feature.

// One day's value for a single-series chart (e.g. daily active users).
export type DailyCountPoint = {
  // UTC calendar day as YYYY-MM-DD.
  date: string
  count: number
}

// One day's values for the videos-analysed chart, split by analysis type.
export type VideosByDayPoint = {
  date: string
  // Light (YouTube-API) analyses started that day.
  light: number
  // Deep analyses that day, counted as source files whose bytes actually
  // landed in storage — mirrors the dashboard's "source files uploaded" metric.
  deep: number
}

// Upload states where the raw bytes have genuinely landed in storage, i.e. a
// source file was really uploaded for deep analysis. Mirrors the constant in
// lib/admin/users.ts.
const DEEP_ANALYSIS_UPLOAD_STATES = ["uploaded", "processing", "ready"]

// The UTC calendar day (YYYY-MM-DD) a timestamp falls on.
function toUtcDay(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

// The inclusive list of the last `days` UTC dates ending today, oldest first.
// Used both to bound the query and to backfill days with no activity as zeros so
// the charts render a continuous axis instead of skipping quiet days.
export function recentUtcDates(days: number, now: Date = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dayMs = 24 * 60 * 60 * 1000
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(end - i * dayMs).toISOString().slice(0, 10))
  }
  return dates
}

// Counts distinct active *non-admin* users per day over the last `days` days.
// Admin activity is deliberately excluded — the chart is about real end users,
// and admins signing in to inspect the app would otherwise inflate the numbers.
// Because user_daily_activity holds exactly one row per user per day, counting
// non-admin rows per activity_date already yields the distinct-user count — no
// dedupe needed.
export async function getDailyActiveUsers(
  days = 30,
  now: Date = new Date(),
): Promise<DailyCountPoint[]> {
  const supabase = createAdminClient()
  const dates = recentUtcDates(days, now)

  // Pull the activity rows and the set of admin ids in parallel; we drop any
  // row belonging to an admin before counting.
  const [activity, admins] = await Promise.all([
    supabase
      .from("user_daily_activity")
      .select("activity_date, user_id")
      .gte("activity_date", dates[0]),
    supabase.from("users").select("id").eq("is_admin", true),
  ])

  if (activity.error) {
    throw new Error(
      `Failed to load daily active users: ${activity.error.message}`,
    )
  }
  if (admins.error) {
    throw new Error(`Failed to load admin users: ${admins.error.message}`)
  }

  const adminIds = new Set((admins.data ?? []).map((row) => row.id as string))

  const counts = new Map<string, number>()
  for (const row of activity.data ?? []) {
    // Admins are not real end users for this chart, so skip their rows.
    if (adminIds.has(row.user_id as string)) continue
    // activity_date is a Postgres `date`, returned as a YYYY-MM-DD string that
    // already matches the entries in `dates`.
    const day = row.activity_date as string
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }))
}

// Counts videos analysed per day over the last `days` days, split into light
// (analysed_videos) and deep (landed source_files) series. Light uses
// date_analysed; deep uses the source file's created_at, filtered to the states
// where bytes actually landed — consistent with the dashboard KPIs.
export async function getVideosAnalysedByDay(
  days = 30,
  now: Date = new Date(),
): Promise<VideosByDayPoint[]> {
  const supabase = createAdminClient()
  const dates = recentUtcDates(days, now)
  // Query timestamptz columns from the start of the earliest UTC day.
  const startIso = `${dates[0]}T00:00:00.000Z`

  const [light, deep] = await Promise.all([
    supabase
      .from("analysed_videos")
      .select("date_analysed")
      .gte("date_analysed", startIso),
    supabase
      .from("source_files")
      .select("created_at")
      .gte("created_at", startIso)
      .in("upload_status", DEEP_ANALYSIS_UPLOAD_STATES),
  ])

  if (light.error) {
    throw new Error(`Failed to load light analyses: ${light.error.message}`)
  }
  if (deep.error) {
    throw new Error(`Failed to load deep analyses: ${deep.error.message}`)
  }

  const lightCounts = new Map<string, number>()
  for (const row of light.data ?? []) {
    const day = toUtcDay(row.date_analysed as string)
    lightCounts.set(day, (lightCounts.get(day) ?? 0) + 1)
  }

  const deepCounts = new Map<string, number>()
  for (const row of deep.data ?? []) {
    const day = toUtcDay(row.created_at as string)
    deepCounts.set(day, (deepCounts.get(day) ?? 0) + 1)
  }

  return dates.map((date) => ({
    date,
    light: lightCounts.get(date) ?? 0,
    deep: deepCounts.get(date) ?? 0,
  }))
}
