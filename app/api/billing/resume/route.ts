import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { isStripeEnabled } from "@/lib/stripe/config"
import { resumeSubscriptionForUser } from "@/lib/billing/subscriptions"

// POST /api/billing/resume
// Clears a scheduled cancellation so the user's paid plan continues past the
// current period. Backs the "Resume plan" / "Keep my plan" affordances shown
// while a cancellation is pending. Unlike the portal route this mutates Stripe
// directly and returns no redirect URL - the caller refreshes to pick up the
// reconciled state.
export async function POST() {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Billing is not available yet." },
      { status: 503 },
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const resumed = await resumeSubscriptionForUser(user.id)
    if (!resumed) {
      return NextResponse.json(
        { error: "No subscription to resume." },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to resume subscription", error)
    return NextResponse.json(
      { error: "Could not resume your subscription." },
      { status: 500 },
    )
  }
}
