import type { Session, SupabaseClient } from "@supabase/supabase-js"

export type OAuthCallbackResult =
  // The authorization code was exchanged here, on this request. `session`
  // carries the freshly issued tokens, including the one-shot
  // provider_refresh_token the caller needs to persist.
  | { status: "signed-in"; session: Session | null }
  // The exchange did not happen (or could not happen), but the browser already
  // holds a valid session - this callback is a duplicate of one that already
  // succeeded. Nothing to do; send the user into the app.
  | { status: "already-signed-in" }
  // No session, and no way to establish one. The user has to start over.
  | { status: "failed" }

// Decides what a hit on the OAuth redirect endpoint means.
//
// The happy path is the PKCE code exchange. The reason this is not just
// "exchange, or fail" is that Google's sign-in screens do not debounce: neither
// the account row on the account chooser nor the "Continue" button on the
// consent screen disables itself once clicked. The chooser also re-renders
// itself - filtered down to the account that was just picked - while Google
// works out the next step, which reads as a second, near-identical account
// picker and invites a second click. Google honours that click and fires a
// second redirect back here.
//
// By the time the duplicate arrives the first one has usually already won: the
// authorization code is spent, the code_verifier cookie has been cleared, and
// the user is signed in. Exchanging again therefore *must* fail. Treating that
// failure as a failed sign-in is what makes the flow appear to break - it
// throws a user who is signed in perfectly well onto the error page. So before
// giving up we check for an existing session and treat the duplicate as the
// no-op it is.
//
// The same reasoning covers ?error= responses from Supabase/Google: a second
// click can invalidate the in-flight request Google was already completing, so
// an error alongside a live session is still a duplicate, not a failure.
export async function resolveOAuthCallback(
  supabase: SupabaseClient,
  { code, providerError }: { code: string | null; providerError: string | null },
): Promise<OAuthCallbackResult> {
  if (code && !providerError) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return { status: "signed-in", session: data.session }
    }
  }

  const { data, error } = await supabase.auth.getClaims()

  if (!error && data?.claims?.sub) {
    return { status: "already-signed-in" }
  }

  return { status: "failed" }
}
