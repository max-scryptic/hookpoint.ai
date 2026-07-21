import type { SupabaseClient } from "@supabase/supabase-js"

// The calendar day, in UTC, that a timestamp falls on, as an ISO date string
// (YYYY-MM-DD). We deliberately bucket on UTC everywhere — the recording path
// here and the admin aggregation both use it — so a day means the same thing on
// both sides regardless of where the request was served.
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

// Records that a signed-in user was active today. Upserts a single row per
// user per UTC day; a same-day repeat only bumps last_seen_at. The client must
// carry the user's session (RLS lets a user write only their own row).
//
// Activity tracking is strictly best-effort: it must never block or fail a
// request, so any error is logged and swallowed. The caller (proxy.ts) also
// gates this behind a per-day cookie so the write happens at most once per day
// per browser rather than on every request.
export async function recordDailyActivity(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await supabase.from("user_daily_activity").upsert(
    {
      user_id: userId,
      activity_date: utcDateString(now),
      last_seen_at: now.toISOString(),
    },
    { onConflict: "user_id,activity_date" },
  )

  if (error) {
    console.error("Failed to record daily activity", error)
  }
}
