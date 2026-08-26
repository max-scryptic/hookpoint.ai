import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { isStripeEnabled } from "@/lib/stripe/config"
import {
  saveCancellationFeedback,
  scheduleCancellationForUser,
} from "@/lib/billing/subscriptions"
import { isCancellationReason } from "@/lib/billing/cancellation-reasons"
import { getPlan } from "@/lib/plans"

// POST /api/billing/cancel
// Schedules the user's paid plan to move to Free at the end of the current
// billing period - the "Downgrade to Free" action. Mutates Stripe directly
// (cancel_at_period_end = true) rather than sending the user through the
// portal's hosted cancel flow, so the semantics are deterministic and don't
// depend on the Customer Portal's cancellation policy. Returns no redirect URL;
// the caller shows an in-app confirmation dialog (from the plan name and period
// end below) and refreshes to pick up the "Cancellation scheduled" state.
//
// The body carries the cancellation survey: a required `reason` (one of the
// known codes) and optional `notes`. We validate the reason, schedule the
// cancellation, then record the feedback - best-effort, so a feedback write
// failure never blocks the cancellation the user just confirmed.
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

  const body = (await request.json().catch(() => ({}))) as {
    reason?: unknown
    notes?: unknown
    otherReason?: unknown
  }
  if (!isCancellationReason(body.reason)) {
    return NextResponse.json(
      { error: "Please choose a reason for cancelling." },
      { status: 400 },
    )
  }
  const reason = body.reason
  const notes = typeof body.notes === "string" ? body.notes : null
  const otherReason =
    typeof body.otherReason === "string" ? body.otherReason.trim() : ""
  if (reason === "other" && !otherReason) {
    return NextResponse.json(
      { error: "Please tell us why you're cancelling." },
      { status: 400 },
    )
  }
  const feedbackNotes =
    reason === "other"
      ? [`Other reason: ${otherReason}`, notes?.trim()]
          .filter(Boolean)
          .join("\n\n")
      : notes

  try {
    const scheduled = await scheduleCancellationForUser(user.id)
    if (!scheduled) {
      return NextResponse.json(
        { error: "No active subscription to cancel." },
        { status: 400 },
      )
    }

    // Feedback capture must not undo a cancellation that already went through,
    // so log and carry on if the insert fails.
    try {
      await saveCancellationFeedback({
        userId: user.id,
        reason,
        notes: feedbackNotes,
        subscription: scheduled,
      })
    } catch (feedbackError) {
      console.error("Failed to save cancellation feedback", feedbackError)
    }

    return NextResponse.json({
      ok: true,
      planName: getPlan(scheduled.planId).name,
      periodEnd: scheduled.currentPeriodEnd,
    })
  } catch (error) {
    console.error("Failed to schedule subscription cancellation", error)
    return NextResponse.json(
      { error: "Could not schedule your cancellation." },
      { status: 500 },
    )
  }
}
