import { NextResponse, type NextRequest } from "next/server"

import { scheduleBillingPeriodChangeForUser } from "@/lib/billing/subscriptions"
import { createClient } from "@/lib/supabase/server"
import type { BillingPeriod } from "@/lib/plans"

// Schedules a monthly ↔ annual change on the existing subscription. The old
// interval remains active until its paid-through date; Stripe then starts the
// replacement interval automatically without a second subscription.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { period?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (body.period !== "monthly" && body.period !== "annual") {
    return NextResponse.json(
      { error: "Choose monthly or annual billing." },
      { status: 400 },
    )
  }

  try {
    const subscription = await scheduleBillingPeriodChangeForUser(
      user.id,
      body.period as BillingPeriod,
    )
    if (!subscription) {
      return NextResponse.json(
        { error: "No active paid subscription was found." },
        { status: 404 },
      )
    }
    return NextResponse.json({ effectiveAt: subscription.currentPeriodEnd })
  } catch (error) {
    if (error instanceof Error && error.message === "CANCELLATION_SCHEDULED") {
      return NextResponse.json(
        { error: "Resume your plan before changing its billing cycle." },
        { status: 409 },
      )
    }
    console.error("Failed to schedule billing-period change", error)
    return NextResponse.json(
      { error: "Could not schedule the billing change." },
      { status: 500 },
    )
  }
}
