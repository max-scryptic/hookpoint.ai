import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

// A minimal view of the signed-in user. Pages only need the id (for scoping
// data queries) and occasionally the email, so we don't carry the full
// Supabase User object around.
export type AuthenticatedUser = {
  id: string
  email: string | null
}

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  if (!hasSupabaseEnv()) {
    return null
  }

  const supabase = await createClient()

  // getClaims() verifies the session JWT locally using the project's signing
  // keys (cached after first fetch), so it avoids the network round-trip that
  // getUser() makes to the Auth server on every render. The proxy middleware
  // already calls getUser() once per request to refresh the session, so doing
  // it again here just to read the id is what made tab switches feel slow.
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims?.sub) {
    return null
  }

  const { sub, email } = data.claims

  return {
    id: sub,
    email: typeof email === "string" ? email : null,
  }
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser()

  if (!user) {
    redirect("/login")
  }

  return user
}
