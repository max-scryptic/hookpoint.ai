import { createClient } from "@/lib/supabase/client"
import { GOOGLE_SCOPES } from "@/lib/youtube/scopes"

// Starts the Google OAuth flow with the YouTube read + analytics scopes. Shared
// by the sign-in form and the "connect/reconnect YouTube" button so the scope
// list stays a single source of truth.
//
// access_type=offline asks Google for a refresh token; on a user's *first*
// authorization Google returns one without any extra prompting, and the token
// is captured server-side in /auth/callback.
//
// forceConsent adds prompt=consent, which makes Google re-display the consent
// screen and re-issue a refresh token even for a user who has already granted
// access. That is required to recover a *missing or revoked* refresh token, so
// the "connect/reconnect YouTube" button opts in. Plain login leaves it off:
// returning users then skip the consent screen entirely (and, while the OAuth
// app is unverified, the "Google hasn't verified this app" warning) instead of
// seeing it on every sign-in. The refresh token they granted on first login is
// already stored, so nothing is lost.
export async function signInWithGoogle(
  next = "/dashboard",
  { forceConsent = false }: { forceConsent?: boolean } = {},
) {
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
        ...(forceConsent ? { prompt: "consent" } : {}),
      },
    },
  })
}
