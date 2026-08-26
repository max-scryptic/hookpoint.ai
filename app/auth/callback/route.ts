import { resolveOAuthCallback } from "@/lib/auth/oauth-callback"
import { createClient } from "@/lib/supabase/server"
import { GOOGLE_SCOPES, storeRefreshToken } from "@/lib/youtube/google-auth"
import { NextResponse, type NextRequest } from "next/server"

// Handles the OAuth (e.g. Google) PKCE code exchange. The browser that started
// the OAuth flow is the same one that returns here, so the code_verifier cookie
// is present. Email confirmations use /auth/confirm instead.
//
// Google's sign-in screens let the user click twice, which fires a second
// redirect back here for a flow that already completed. resolveOAuthCallback
// tells that duplicate apart from a real failure so the extra click is a no-op
// instead of bouncing an already signed-in user to the error page.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  // Supabase appends ?error=... when it rejects the redirect (e.g. expired link
  // or a redirect target that isn't allow-listed).
  const providerError = requestUrl.searchParams.get("error")
  const next = requestUrl.searchParams.get("next") ?? "/analyse-video"
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/analyse-video"

  const supabase = await createClient()
  const result = await resolveOAuthCallback(supabase, { code, providerError })

  if (result.status === "failed") {
    return NextResponse.redirect(new URL("/auth/auth-code-error", request.url))
  }

  if (result.status === "signed-in") {
    // Capture the Google refresh token while it is briefly available on the
    // session. Supabase never resurfaces it, so we persist it for later
    // server-side YouTube API calls. Failure here must not block sign-in.
    //
    // Only the request that actually performed the exchange sees it - a
    // duplicate callback has no session of its own to read it from, which is
    // fine: the token from the winning exchange is already stored.
    const session = result.session
    if (session?.provider_refresh_token && session.user) {
      try {
        await storeRefreshToken(
          session.user.id,
          session.provider_refresh_token,
          GOOGLE_SCOPES.join(" "),
        )
      } catch (storeError) {
        console.error("Failed to persist Google refresh token", storeError)
      }
    }
  }

  return NextResponse.redirect(new URL(safeNext, request.url))
}
