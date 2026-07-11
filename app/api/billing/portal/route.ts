import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getSubscriptionForUser } from "@/lib/billing/subscriptions"
import { getBillingReturnUrl, isStripeEnabled } from "@/lib/stripe/config"
import { getStripe } from "@/lib/stripe/stripe"
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers"

type PortalAction = "manage" | "cancel"

// POST /api/billing/portal
// Opens the Stripe Customer Portal — a Stripe-hosted page where the user can
// update or remove their card and view/download past invoices. Returns the
// hosted URL for the client to redirect to. Any changes made there flow back to
// our DB via the webhook.
export async function POST(request: Request) {
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
    const body = (await request.json().catch(() => ({}))) as {
      action?: PortalAction
    }
    const action = body.action ?? "manage"
    const customerId = await getOrCreateStripeCustomer(user.id, user.email ?? null)
    const stripe = getStripe()

    if (action === "cancel") {
      const subscription = await getSubscriptionForUser(user.id)
      if (!subscription) {
        return NextResponse.json(
          { error: "No active subscription to cancel." },
          { status: 400 },
        )
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: getBillingReturnUrl(),
        flow_data: {
          type: "subscription_cancel",
          subscription_cancel: {
            subscription: subscription.stripeSubscriptionId,
          },
          after_completion: {
            type: "redirect",
            redirect: {
              return_url: getBillingReturnUrl("cancelled"),
            },
          },
        },
      })

      return NextResponse.json({ url: session.url })
    }

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
