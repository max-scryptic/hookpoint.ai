import { describe, expect, it, vi } from "vitest"
import type { Session, SupabaseClient } from "@supabase/supabase-js"
import { resolveOAuthCallback } from "@/lib/auth/oauth-callback"

const SESSION = {
  provider_refresh_token: "refresh-token",
  user: { id: "user-1" },
} as unknown as Session

// A stand-in for the Supabase server client with just the two auth calls
// resolveOAuthCallback makes. `exchange` decides whether the PKCE exchange
// succeeds; `signedIn` whether the browser already carries a session.
function fakeClient({
  exchange = "ok",
  signedIn = false,
}: {
  exchange?: "ok" | "fails"
  signedIn?: boolean
} = {}) {
  const exchangeCodeForSession = vi.fn(async () =>
    exchange === "ok"
      ? { data: { session: SESSION }, error: null }
      : { data: { session: null }, error: { message: "invalid request" } },
  )

  const getClaims = vi.fn(async () =>
    signedIn
      ? { data: { claims: { sub: "user-1" } }, error: null }
      : { data: null, error: { message: "no session" } },
  )

  return {
    client: { auth: { exchangeCodeForSession, getClaims } } as unknown as SupabaseClient,
    exchangeCodeForSession,
  }
}

describe("resolveOAuthCallback", () => {
  it("signs the user in when the code exchange succeeds", async () => {
    const { client } = fakeClient()

    const result = await resolveOAuthCallback(client, {
      code: "auth-code",
      providerError: null,
    })

    expect(result).toEqual({ status: "signed-in", session: SESSION })
  })

  // The duplicate callback Google's non-debounced sign-in screens produce: the
  // code is already spent so the exchange must fail, but the first callback
  // signed the user in. This must not read as a failed sign-in.
  it("treats a spent code as a duplicate when a session already exists", async () => {
    const { client } = fakeClient({ exchange: "fails", signedIn: true })

    const result = await resolveOAuthCallback(client, {
      code: "auth-code",
      providerError: null,
    })

    expect(result).toEqual({ status: "already-signed-in" })
  })

  it("fails when the code cannot be exchanged and there is no session", async () => {
    const { client } = fakeClient({ exchange: "fails", signedIn: false })

    const result = await resolveOAuthCallback(client, {
      code: "auth-code",
      providerError: null,
    })

    expect(result).toEqual({ status: "failed" })
  })

  it("ignores a provider error when the user is already signed in", async () => {
    const { client, exchangeCodeForSession } = fakeClient({ signedIn: true })

    const result = await resolveOAuthCallback(client, {
      code: "auth-code",
      providerError: "access_denied",
    })

    expect(result).toEqual({ status: "already-signed-in" })
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it("fails on a provider error with no session", async () => {
    const { client, exchangeCodeForSession } = fakeClient({ signedIn: false })

    const result = await resolveOAuthCallback(client, {
      code: "auth-code",
      providerError: "access_denied",
    })

    expect(result).toEqual({ status: "failed" })
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it("fails when the callback carries neither a code nor a session", async () => {
    const { client } = fakeClient({ signedIn: false })

    const result = await resolveOAuthCallback(client, {
      code: null,
      providerError: null,
    })

    expect(result).toEqual({ status: "failed" })
  })
})
