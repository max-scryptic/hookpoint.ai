import { createClient } from "@/lib/supabase/client"
import { GOOGLE_SCOPES } from "@/lib/youtube/scopes"

// Starts the Google OAuth flow with the YouTube read + analytics scopes. Shared
// by the sign-in form and the "connect/reconnect YouTube" button so the scope
// list and consent options stay identical.
//
// access_type=offline + prompt=consent force Google to return a refresh token
// every time (it otherwise omits it on repeat logins). The refresh token is
// captured server-side in /auth/callback.
export async function signInWithGoogle(next = "/dashboard") {
  const supabase = createClient()

  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        next,
      )}`,
      scopes: GOOGLE_SCOPES.join(" "),
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  })
}
