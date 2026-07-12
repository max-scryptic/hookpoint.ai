import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { isStripeEnabled } from "@/lib/stripe/config"
import { scheduleCancellationForUser } from "@/lib/billing/subscriptions"

// POST /api/billing/cancel
// Schedules the user's paid plan to move to Free at the end of the current
// billing period — the "Downgrade to Free" action. Mutates Stripe directly
// (cancel_at_period_end = true) rather than sending the user through the
// portal's hosted cancel flow, so the semantics are deterministic and don't
// depend on the Customer Portal's cancellation policy. Returns no redirect URL;
// the caller refreshes to pick up the reconciled "Cancellation scheduled" state.
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
    const scheduled = await scheduleCancellationForUser(user.id)
    if (!scheduled) {
      return NextResponse.json(
        { error: "No active subscription to cancel." },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to schedule subscription cancellation", error)
    return NextResponse.json(
      { error: "Could not schedule your cancellation." },
      { status: 500 },
    )
  }
}
