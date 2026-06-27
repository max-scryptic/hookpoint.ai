import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// Service-role Supabase client. This bypasses Row Level Security, so it MUST
// only ever be imported from server-side code (route handlers, server actions).
// It is used to read/write the locked-down `google_credentials` table.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    )
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
