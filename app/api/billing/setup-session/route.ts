import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getBillingReturnUrl, isStripeEnabled } from "@/lib/stripe/config"
import { getStripe } from "@/lib/stripe/stripe"
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers"

// POST /api/billing/setup-session
// Starts a Stripe Checkout session in `setup` mode: a Stripe-hosted page where
// the signed-in user enters a card that gets saved to their Stripe Customer (no
// charge is made). Returns the hosted URL for the client to redirect to. The
// card is synced back to our DB by the Stripe webhook, not here.
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

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      // Save the entered card as the customer's default for future invoices.
      payment_method_types: ["card"],
      success_url: getBillingReturnUrl("added"),
      cancel_url: getBillingReturnUrl("cancelled"),
    })

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL")
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Failed to create billing setup session", error)
    return NextResponse.json(
      { error: "Could not start the payment method setup." },
      { status: 500 },
    )
  }
}
