import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

// A minimal view of a signed-in admin. Mirrors AuthenticatedUser in lib/auth.ts
// but is only ever returned for users flagged as admins.
export type AdminUser = {
  id: string
  email: string | null
}

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
}

// Resolves the current session only if it belongs to an admin. The /admin area
// shares Supabase Auth (and the session cookie) with the main app, so simply
// being signed in is not sufficient — we additionally require the
// users.is_admin flag, which only the service-role client can set.
export async function getAdminUser(): Promise<AdminUser | null> {
  if (!hasSupabaseEnv()) {
    return null
  }

  const supabase = await createClient()

  // getClaims() verifies the session JWT locally (same approach as lib/auth.ts)
  // to avoid an extra round-trip to the Auth server on every render.
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims?.sub) {
    return null
  }

  const { sub, email } = data.claims

  // RLS lets a user read their own profile row, so the regular client is enough
  // to read the flag for the current user — no service role needed to gate.
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", sub)
    .single()

  if (profileError || !profile?.is_admin) {
    return null
  }

  return {
    id: sub,
    email: typeof email === "string" ? email : null,
  }
}

export async function requireAdminUser(): Promise<AdminUser> {
  const user = await getAdminUser()

  if (!user) {
    redirect("/admin/login")
  }

  return user
}
