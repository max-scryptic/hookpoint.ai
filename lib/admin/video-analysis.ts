import { createAdminClient } from "@/lib/supabase/admin"

// Read-side helper for the admin user-detail "Video analysis" tab. Uses the
// service-role client (bypassing RLS) and MUST only be called from server code
// that has already verified the caller is an admin (see requireAdminUser).

export type AdminVideoAnalysis = {
  // analysed_videos row id.
  id: string
  // YouTube video id, so the row can link out to the source video.
  videoId: string
  title: string
  dateAnalysed: string
  // Retention-window events synthesized for this video (0 when it has only had
  // light analysis, or deep analysis hasn't produced events yet).
  eventCount: number
}

// Lists a user's analysed videos (most recently analysed first), each annotated
// with how many retention-window events its deep analysis produced. Event
// counts are resolved in one query and tallied per video in memory, so the
// listing stays a single round-trip regardless of how many videos there are.
export async function getUserVideoAnalyses(
  userId: string,
): Promise<AdminVideoAnalysis[]> {
  const supabase = createAdminClient()

  const [videos, events] = await Promise.all([
    supabase
      .from("analysed_videos")
      .select("id, video_id, video_title, date_analysed")
      .eq("user_id", userId)
      .order("date_analysed", { ascending: false }),
    supabase
      .from("retention_window_events")
      .select("analysed_video_id")
      .eq("user_id", userId),
  ])

  if (videos.error) {
    throw new Error(`Failed to load analysed videos: ${videos.error.message}`)
  }
  if (events.error) {
    // Events are an optional enrichment — a failure there should still let the
    // video list render (with zero counts) rather than sink the tab.
    console.error("Failed to load retention events for user", events.error)
  }

  const eventCounts = new Map<string, number>()
  for (const row of (events.error ? [] : (events.data ?? [])) as {
    analysed_video_id: string | null
  }[]) {
    if (!row.analysed_video_id) continue
    eventCounts.set(
      row.analysed_video_id,
      (eventCounts.get(row.analysed_video_id) ?? 0) + 1,
    )
  }

  return ((videos.data ?? []) as {
    id: string
    video_id: string
    video_title: string
    date_analysed: string
  }[]).map((row) => ({
    id: row.id,
    videoId: row.video_id,
    title: row.video_title,
    dateAnalysed: row.date_analysed,
    eventCount: eventCounts.get(row.id) ?? 0,
  }))
}
