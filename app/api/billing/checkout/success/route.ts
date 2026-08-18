import { NextResponse, type NextRequest } from "next/server"

import { syncSubscriptionFromStripe } from "@/lib/billing/subscriptions"
import { getStripe } from "@/lib/stripe/stripe"
import { isStripeEnabled } from "@/lib/stripe/config"

// Stripe sends users here after a successful subscription Checkout. Reconcile
// the subscription before the dashboard renders so the success modal can show
// the actual paid features they just unlocked.
export async function GET(request: NextRequest) {
  const redirectUrl = new URL("/analyse-video", request.url)
  redirectUrl.searchParams.set("checkout", "success")

  if (!isStripeEnabled()) {
    return NextResponse.redirect(redirectUrl)
  }

  const sessionId = request.nextUrl.searchParams.get("session_id")
  if (!sessionId) {
    return NextResponse.redirect(redirectUrl)
  }

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (session.mode === "subscription" && session.subscription) {
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id
      await syncSubscriptionFromStripe(subscriptionId)
    }
  } catch (error) {
    console.error("Failed to sync subscription after checkout", error)
  }

  return NextResponse.redirect(redirectUrl)
}
