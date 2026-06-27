import { createClient } from "@/lib/supabase/server"
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
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      return NextResponse.redirect(new URL(safeNext, request.url))
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url))
}
