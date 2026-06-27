import { createClient } from "@/lib/supabase/server"
import { GOOGLE_SCOPES, storeRefreshToken } from "@/lib/youtube/google-auth"
import { NextResponse, type NextRequest } from "next/server"

// Handles the OAuth (e.g. Google) PKCE code exchange. The browser that started
// the OAuth flow is the same one that returns here, so the code_verifier cookie
// is present. Email confirmations use /auth/confirm instead.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const next = requestUrl.searchParams.get("next") ?? "/dashboard"
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"

  // Supabase appends ?error=... when it rejects the redirect (e.g. expired link
  // or a redirect target that isn't allow-listed).
  if (error) {
    return NextResponse.redirect(new URL("/auth/auth-code-error", request.url))
  }

  if (code) {
    const supabase = await createClient()
    const { data, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      // Capture the Google refresh token while it is briefly available on the
      // session. Supabase never resurfaces it, so we persist it for later
      // server-side YouTube API calls. Failure here must not block sign-in.
      const session = data.session
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

      return NextResponse.redirect(new URL(safeNext, request.url))
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url))
}
