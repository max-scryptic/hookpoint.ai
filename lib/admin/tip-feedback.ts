import { createAdminClient } from "@/lib/supabase/admin"
import {
  isTipCategory,
  tipCategoryForSection,
  type TipCategory,
  type TipFeedbackReason,
} from "@/lib/tips"

// Reads the tips creators flagged as not useful, for the admin Tip Feedback
// table. Uses the service-role client, so it bypasses Row Level Security and
// MUST only be called from server code that has already verified the caller is
// an admin (see requireAdminUser in lib/admin/auth.ts).

export type AdminTipFeedbackRow = {
  id: string
  // The account that flagged the tip. Null only if the row outlives the profile.
  userId: string
  username: string | null
  email: string | null
  // The tip as it was read, the part of the report it was read in, and what it
  // was about (the hook, drop-offs, the script). The category is what makes a
  // run of complaints about one kind of advice visible across surfaces.
  tip: string
  section: string
  category: TipCategory
  sourcePath: string | null
  reason: TipFeedbackReason
  notes: string | null
  createdAt: string
}

// Capped so the page stays responsive; the table filters and paginates what it
// is given. Newest first, which is the order the table opens on.
const MAX_ROWS = 1000

export async function listTipFeedback(): Promise<AdminTipFeedbackRow[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("tip_feedback")
    .select(
      "id, user_id, tip, section, category, source_path, reason, notes, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS)

  if (error) {
    throw new Error(`Failed to list tip feedback: ${error.message}`)
  }

  const rows = (data ?? []) as {
    id: string
    user_id: string
    tip: string
    section: string
    category: string | null
    source_path: string | null
    reason: TipFeedbackReason
    notes: string | null
    created_at: string
  }[]

  // One lookup for every account named in the page, rather than a join: the
  // feedback rows are the query, and the profiles only decorate them.
  const userIds = [...new Set(rows.map((row) => row.user_id))]
  const profiles = new Map<string, { username: string; email: string }>()
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, username, email")
      .in("id", userIds)

    if (usersError) {
      // The flag itself is the point of this table, so a failure to name the
      // account leaves the rows unattributed rather than sinking the page.
      console.error("Failed to load users for tip feedback", usersError)
    } else {
      for (const user of (users ?? []) as {
        id: string
        username: string
        email: string
      }[]) {
        profiles.set(user.id, { username: user.username, email: user.email })
      }
    }
  }

  return rows.map((row) => {
    const profile = profiles.get(row.user_id)
    return {
      id: row.id,
      userId: row.user_id,
      username: profile?.username ?? null,
      email: profile?.email ?? null,
      tip: row.tip,
      section: row.section,
      // Derived again for anything the column cannot account for, so a flag
      // recorded before the column existed is still filed under a category.
      category: isTipCategory(row.category)
        ? row.category
        : tipCategoryForSection(row.section),
      sourcePath: row.source_path,
      reason: row.reason,
      notes: row.notes,
      createdAt: row.created_at,
    }
  })
}
