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
  billingEnabled,
}: {
  currentPlanId: PlanId
  billingEnabled: boolean
}) {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const checkoutStatus = searchParams.get("checkout")

  async function handleSelect(planId: PlanId, period: BillingPeriod) {
    if (pending) return
    setError(null)

    if (!billingEnabled) {
      setError("Billing isn't available yet. Please try again later.")
      return
    }

    // Downgrading to Free means cancelling the current subscription, which the
    // user does from the Stripe billing portal.
    if (planId === "free") {
      await redirectTo("/api/billing/portal")
      return
    }

    await redirectTo("/api/billing/checkout", { planId, period })
  }

  async function redirectTo(
    endpoint: string,
    body?: Record<string, unknown>,
  ) {
    setPending(true)
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
        setPending(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError("Something went wrong. Please try again.")
      setPending(false)
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
