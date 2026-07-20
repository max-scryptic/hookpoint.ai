"use server"

import { revalidatePath } from "next/cache"
import { requireAdminUser } from "@/lib/admin/auth"
import { setUserAdmin } from "@/lib/admin/users"

export type UpdateAdminResult = { ok: true } | { ok: false; error: string }

// Promote or demote a user. Every call re-verifies the caller is an admin (the
// server action is a public endpoint), and refuses self-demotion so an admin
// can't accidentally lock themselves out of the area.
export async function updateAdminStatus(
  userId: string,
  isAdmin: boolean,
): Promise<UpdateAdminResult> {
  const admin = await requireAdminUser()

  if (admin.id === userId && !isAdmin) {
    return {
      ok: false,
      error: "You can't remove your own admin access.",
    }
  }

  try {
    await setUserAdmin(userId, isAdmin)
  } catch (error) {
    console.error("Failed to update admin status", error)
    return { ok: false, error: "Could not update admin status. Try again." }
  }

  revalidatePath("/admin/users")
  return { ok: true }
}
