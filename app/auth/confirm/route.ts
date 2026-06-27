import { createClient } from "@/lib/supabase/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

// Handles email confirmation links (signup, magic link, recovery, email change).
// Uses the token_hash + verifyOtp flow, which—unlike the PKCE code exchange—does
// not depend on a browser-side code_verifier cookie. This is what lets the link
// work even though it opens in a new tab or a different browser than signup.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const token_hash = requestUrl.searchParams.get("token_hash")
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null
  const next = requestUrl.searchParams.get("next") ?? "/dashboard"
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url))
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url))
}
