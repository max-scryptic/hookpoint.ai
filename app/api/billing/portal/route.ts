import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getBillingReturnUrl, isStripeEnabled } from "@/lib/stripe/config"
import { getStripe } from "@/lib/stripe/stripe"
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers"

// POST /api/billing/portal
// Opens the Stripe Customer Portal — a Stripe-hosted page where the user can
// update or remove their card and view/download past invoices. Returns the
// hosted URL for the client to redirect to. Any changes made there flow back to
// our DB via the webhook.
//
// Plan cancellation is deliberately NOT handled here: it runs in-app via
// /api/billing/cancel (cancel_at_period_end = true) so the outcome is always
// "keep access until the period ends, then revert to Free" regardless of how the
// Stripe Customer Portal's cancellation policy is configured.
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
    const customerId = await getOrCreateStripeCustomer(user.id, user.email ?? null)
    const stripe = getStripe()

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: getBillingReturnUrl(),
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Failed to create billing portal session", error)
    return NextResponse.json(
      { error: "Could not open the billing portal." },
      { status: 500 },
    )
  }
}
