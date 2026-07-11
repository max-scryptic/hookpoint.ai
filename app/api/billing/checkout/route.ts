import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  getStripePriceId,
  getSubscriptionReturnUrl,
  isStripeEnabled,
} from "@/lib/stripe/config"
import { getStripe } from "@/lib/stripe/stripe"
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers"
import { isPaidPlanId } from "@/lib/plans"
import type { BillingPeriod } from "@/lib/plans"

// POST /api/billing/checkout  { planId: "starter" | "pro", period: "monthly" | "annual" }
// Starts a Stripe Checkout session in `subscription` mode for the chosen plan.
// On success Stripe charges the card, creates the subscription, and fires the
// webhook that persists the user's plan + billing window. Returns the hosted
// Checkout URL for the client to redirect to.
export async function POST(request: NextRequest) {
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

  let body: { planId?: string; period?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const planId = body.planId
  const period = body.period as BillingPeriod
  if (!planId || !isPaidPlanId(planId)) {
    return NextResponse.json(
      { error: "Choose a paid plan (Starter or Pro)." },
      { status: 400 },
    )
  }
  if (period !== "monthly" && period !== "annual") {
    return NextResponse.json(
      { error: "Choose a monthly or annual billing period." },
      { status: 400 },
    )
  }

  const priceId = getStripePriceId(planId, period)
  if (!priceId) {
    // The plan exists but its Stripe Price hasn't been configured in this
    // environment — surface a clear 400 rather than a cryptic Stripe error.
    return NextResponse.json(
      { error: "That plan isn't available for purchase yet." },
      { status: 400 },
    )
  }

  try {
    const customerId = await getOrCreateStripeCustomer(user.id, user.email ?? null)
    const stripe = getStripe()

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: getSubscriptionReturnUrl("success"),
      cancel_url: getSubscriptionReturnUrl("cancelled"),
      // Stamp both the session and the resulting subscription so the webhook can
      // resolve the app user and plan even if the price isn't in our env map.
      metadata: { app_user_id: user.id, plan_id: planId, period },
      subscription_data: {
        metadata: { app_user_id: user.id, plan_id: planId, period },
      },
    })

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL")
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Failed to create subscription checkout session", error)
    return NextResponse.json(
      { error: "Could not start checkout." },
      { status: 500 },
    )
  }
}
