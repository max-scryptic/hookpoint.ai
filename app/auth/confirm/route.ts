import { createClient } from "@/lib/supabase/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

// Handles email confirmation links (signup, magic link, recovery, email change).
//
// Supports two link shapes so it works regardless of how the Supabase email
// template is configured:
//
//   1. token_hash + verifyOtp — the preferred flow. Unlike the PKCE code
//      exchange it does not depend on a browser-side code_verifier cookie, so
//      the link works even when opened in a new tab, app, or different browser
//      than the one used to sign up. Requires a custom email template whose
//      link points here directly, e.g.
//        {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard
//
//   2. code + exchangeCodeForSession — the fallback for the *default* email
//      template, whose {{ .ConfirmationURL }} routes through Supabase's
//      /auth/v1/verify endpoint and redirects back here with a PKCE ?code=.
//      That exchange needs the code_verifier cookie, so it only succeeds when
//      the link is opened in the same browser that started signup.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const token_hash = requestUrl.searchParams.get("token_hash")
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null
  const code = requestUrl.searchParams.get("code")
  // Supabase appends ?error=... when it rejects the link (expired/used token or
  // a redirect target that isn't allow-listed).
  const authError = requestUrl.searchParams.get("error")
  const next = requestUrl.searchParams.get("next") ?? "/dashboard"
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"

  if (!authError) {
    const supabase = await createClient()

    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash })
      if (!error) {
        return NextResponse.redirect(new URL(safeNext, request.url))
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        return NextResponse.redirect(new URL(safeNext, request.url))
      }
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url))
}
