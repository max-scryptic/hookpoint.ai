import { createAdminClient } from "@/lib/supabase/admin"

// The scopes Hookpoint requests. Keep in sync with the scopes configured on the
// OAuth consent screen and passed to signInWithOAuth in the login form.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

// Persists a user's Google refresh token. Called from the auth callback right
// after sign-in, which is the only moment Supabase surfaces the provider token.
// Google only returns a refresh token when the OAuth request uses
// access_type=offline + prompt=consent, so this may be null on repeat logins —
// in that case we keep whatever we already stored.
export async function storeRefreshToken(
  userId: string,
  refreshToken: string | null | undefined,
  scope?: string | null,
) {
  if (!refreshToken) return

  const admin = createAdminClient()
  const { error } = await admin.from("google_credentials").upsert(
    {
      user_id: userId,
      refresh_token: refreshToken,
      scope: scope ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  if (error) {
    throw new Error(`Failed to store Google refresh token: ${error.message}`)
  }
}

// Exchanges the stored refresh token for a short-lived access token usable
// against the YouTube Data and Analytics APIs. Throws a tagged error if the
// user has no stored token (e.g. signed in before scopes were added) so callers
// can prompt a re-consent.
export async function getGoogleAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load Google credentials: ${error.message}`)
  }

  if (!data?.refresh_token) {
    throw new ReconsentRequiredError()
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars")
  }

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    // A revoked or expired refresh token comes back as 400 invalid_grant; the
    // user needs to grant access again.
    if (response.status === 400 && body.includes("invalid_grant")) {
      throw new ReconsentRequiredError()
    }
    throw new Error(`Google token refresh failed (${response.status}): ${body}`)
  }

  const json = (await response.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error("Google token response did not include an access_token")
  }

  return json.access_token
}

// Raised when we have no usable refresh token for the user. Callers should turn
// this into a "reconnect your YouTube account" response rather than a 500.
export class ReconsentRequiredError extends Error {
  constructor() {
    super("Google account must be reconnected to grant YouTube access")
    this.name = "ReconsentRequiredError"
  }
}
