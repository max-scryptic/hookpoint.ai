import { NextResponse, type NextRequest } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { isOnboardingHint, markOnboardingHintSeen } from "@/lib/onboarding-hints"
import { createClient } from "@/lib/supabase/server"

// Records that a creator has met a one-time hint, so it is never shown again.
// Fired by the interface the first time they use the feature the hint points
// at; the caller does not wait on the answer, because a hint that fails to
// record simply appears once more, which is a far better failure than a click
// that stalls behind a write.
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let hint: unknown
  try {
    const body = (await request.json()) as { hint?: unknown }
    hint = body.hint
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!isOnboardingHint(hint)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    await markOnboardingHintSeen(supabase, user.id, hint)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to record onboarding hint", error)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
