import { createAdminClient } from "@/lib/supabase/admin"

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
  createdAt: string
}

// Lists users for the management table, newest first. Capped so the page stays
// responsive; pagination/search can be layered on later if the base grows.
export async function listUsers(): Promise<AdminUserRow[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("users")
    .select("id, username, email, avatar_url, is_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    username: row.username as string,
    email: row.email as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at as string,
  }))
}

export type AdminStats = {
  totalUsers: number
  totalAdmins: number
  totalAnalysedVideos: number
}

// Aggregate counts for the admin dashboard. Uses head+exact counts so no row
// data is transferred — only the totals.
export async function getAdminStats(): Promise<AdminStats> {
  const supabase = createAdminClient()

  const [users, admins, videos] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("is_admin", true),
    supabase.from("analysed_videos").select("*", { count: "exact", head: true }),
  ])

  return {
    totalUsers: users.count ?? 0,
    totalAdmins: admins.count ?? 0,
    totalAnalysedVideos: videos.count ?? 0,
  }
}

// Promotes or demotes a user. The service-role client is the only thing allowed
// to write is_admin (column UPDATE is revoked from anon/authenticated), so this
// is where admin status actually changes.
export async function setUserAdmin(
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from("users")
    .update({ is_admin: isAdmin })
    .eq("id", userId)

  if (error) {
    throw new Error(`Failed to update admin status: ${error.message}`)
  }
}
