"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"

import { PricingPlans } from "@/components/pricing-plans"
import type { BillingPeriod, PlanId } from "@/lib/plans"

// Client wrapper that turns the presentational PricingPlans cards into a working
// purchase flow: picking a paid plan starts a Stripe Checkout session and
// redirects to it; picking Free opens the billing portal so a subscriber can
// cancel. Also surfaces the successful post-checkout banner from the
// `?checkout` query param Stripe redirects back with.
export function PricingPlansCheckout({
  currentPlanId,
  cancelAtPeriodEnd = false,
  billingEnabled,
}: {
  currentPlanId: PlanId
  cancelAtPeriodEnd?: boolean
  billingEnabled: boolean
}) {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [pendingPlanId, setPendingPlanId] = useState<PlanId | null>(null)

  const checkoutStatus = searchParams.get("checkout")

  async function handleSelect(planId: PlanId, period: BillingPeriod) {
    if (pendingPlanId) return
    setError(null)

    if (!billingEnabled) {
      setError("Billing isn't available yet. Please try again later.")
      return
    }

    // Downgrading to Free means cancelling the current subscription, which the
    // user does from the Stripe billing portal. If cancellation is already
    // scheduled, Stripe would reject a second cancel flow, so surface the
    // already-scheduled state instead of opening the portal.
    if (planId === "free") {
      if (cancelAtPeriodEnd) {
        setError(
          "Your plan is already scheduled to move to Free at the end of the current billing period.",
        )
        return
      }
      await redirectTo(planId, "/api/billing/portal", { action: "cancel" })
      return
    }

    await redirectTo(planId, "/api/billing/checkout", { planId, period })
  }

  async function redirectTo(
    planId: PlanId,
    endpoint: string,
    body?: Record<string, unknown>,
  ) {
    setPendingPlanId(planId)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
      const data = (await response.json().catch(() => ({}))) as {
        url?: string
        error?: string
      }
      if (!response.ok || !data.url) {
        setError(data.error ?? "Something went wrong. Please try again.")
        setPendingPlanId(null)
        return
      }
      window.location.href = data.url
    } catch {
      setError("Something went wrong. Please try again.")
      setPendingPlanId(null)
    }
  }

  return (
    <div className="space-y-4">
      {checkoutStatus === "success" ? (
        <Banner tone="success">
          You&rsquo;re all set — your new plan is active. It can take a moment to
          appear here while we confirm the payment.
        </Banner>
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      <PricingPlans
        currentPlanId={currentPlanId}
        cancelAtPeriodEnd={cancelAtPeriodEnd}
        loadingPlanId={pendingPlanId}
        onSelectPlan={handleSelect}
      />
    </div>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error"
  children: React.ReactNode
}) {
  const toneClass =
    tone === "success"
      ? "border-primary/30 bg-primary/10 text-foreground"
      : "border-destructive/30 bg-destructive/10 text-foreground"
  return (
    <div
      className={`mx-auto max-w-2xl rounded-lg border px-4 py-3 text-center text-sm ${toneClass}`}
    >
      {children}
    </div>
  )
}
