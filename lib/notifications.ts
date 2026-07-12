import type { SupabaseClient } from "@supabase/supabase-js"

export type AppNotification = {
  id: string
  analysedVideoId: string | null
  kind: "deep_analysis_complete"
  title: string
  description: string
  readAt: string | null
  createdAt: string
}

type NotificationRow = {
  id: string
  analysed_video_id: string | null
  kind: AppNotification["kind"]
  title: string
  description: string
  read_at: string | null
  created_at: string
}

function fromRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    analysedVideoId: row.analysed_video_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

export async function listNotifications(
  supabase: SupabaseClient,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<AppNotification[]> {
  let query = supabase
    .from("notifications")
    .select(
      "id, analysed_video_id, kind, title, description, read_at, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100)

  if (options.unreadOnly) query = query.is("read_at", null)

  const { data, error } = await query
  if (error) throw new Error(`Failed to load notifications: ${error.message}`)

  return ((data ?? []) as NotificationRow[]).map(fromRow)
}

export async function markNotificationRead(
  supabase: SupabaseClient,
  userId: string,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)

  if (error) throw new Error(`Failed to mark notification read: ${error.message}`)
}
