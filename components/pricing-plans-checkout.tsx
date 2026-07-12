"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { PricingPlans } from "@/components/pricing-plans"
import {
  PlanCancelledDialog,
  type PlanCancelledDetails,
} from "@/components/plan-cancelled-dialog"
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
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingPlanId, setPendingPlanId] = useState<PlanId | null>(null)
  const [isResuming, setIsResuming] = useState(false)
  const [cancelledDetails, setCancelledDetails] =
    useState<PlanCancelledDetails | null>(null)

  const checkoutStatus = searchParams.get("checkout")

  // Clears a scheduled cancellation so the current paid plan keeps running.
  // Refreshes on success so the server re-resolves the (no-longer-cancelling)
  // plan state and the cards flip back to their normal labels.
  async function handleResume() {
    if (isResuming || pendingPlanId) return
    setError(null)
    setNotice(null)

    if (!billingEnabled) {
      setError("Billing isn't available yet. Please try again later.")
      return
    }

    setIsResuming(true)
    try {
      const response = await fetch("/api/billing/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        setIsResuming(false)
        return
      }
      setNotice("Your plan will continue — the scheduled cancellation is off.")
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsResuming(false)
    }
  }

  async function handleSelect(planId: PlanId, period: BillingPeriod) {
    if (pendingPlanId) return
    setError(null)
    setNotice(null)

    if (!billingEnabled) {
      setError("Billing isn't available yet. Please try again later.")
      return
    }

    // Downgrading to Free schedules a cancellation at the end of the current
    // period. This is done in-app (POST /api/billing/cancel) rather than through
    // the Stripe portal so the outcome is always cancel-at-period-end and the
    // user stays here instead of being bounced to Stripe. On success we refresh
    // so the server re-resolves the now-cancelling plan and the cards flip to
    // the "Cancellation scheduled" state.
    if (planId === "free") {
      if (cancelAtPeriodEnd) {
        setError(
          "Your plan is already scheduled to move to Free at the end of the current billing period.",
        )
        return
      }

      setPendingPlanId("free")
      try {
        const response = await fetch("/api/billing/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          planName?: string
          periodEnd?: string
        }
        if (!response.ok) {
          setError(data.error ?? "Something went wrong. Please try again.")
          return
        }
        // Surface the confirmation in a dialog (plan, access-until date) instead
        // of an inline banner, then refresh so the cards behind it flip to the
        // "Cancellation scheduled" state.
        if (data.planName && data.periodEnd) {
          setCancelledDetails({
            planName: data.planName,
            periodEnd: data.periodEnd,
          })
        }
        router.refresh()
      } catch {
        setError("Something went wrong. Please try again.")
      } finally {
        setPendingPlanId(null)
      }
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

      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      <PricingPlans
        currentPlanId={currentPlanId}
        cancelAtPeriodEnd={cancelAtPeriodEnd}
        loadingPlanId={pendingPlanId}
        resumingPlan={isResuming}
        onSelectPlan={handleSelect}
        onResumePlan={handleResume}
      />

      <PlanCancelledDialog
        details={cancelledDetails}
        onOpenChange={(open) => {
          if (!open) setCancelledDetails(null)
        }}
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
