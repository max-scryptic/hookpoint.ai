"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { PricingPlans } from "@/components/pricing-plans"
import {
  PlanCancelledDialog,
  type PlanCancelledDetails,
} from "@/components/plan-cancelled-dialog"
import {
  PlanResumedDialog,
  type PlanResumedDetails,
} from "@/components/plan-resumed-dialog"
import { CancelSurveyDialog } from "@/components/cancel-survey-dialog"
import { getPlan, type BillingPeriod, type PlanId } from "@/lib/plans"
import type { CancellationReason } from "@/lib/billing/cancellation-reasons"

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
  const [pendingPlanId, setPendingPlanId] = useState<PlanId | null>(null)
  const [isResuming, setIsResuming] = useState(false)
  const [cancelledDetails, setCancelledDetails] =
    useState<PlanCancelledDetails | null>(null)
  const [resumedDetails, setResumedDetails] =
    useState<PlanResumedDetails | null>(null)
  // The cancellation survey shown before a downgrade actually goes through.
  const [surveyOpen, setSurveyOpen] = useState(false)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [surveyError, setSurveyError] = useState<string | null>(null)

  const checkoutStatus = searchParams.get("checkout")
  const currentPlanName = getPlan(currentPlanId).name

  // Clears a scheduled cancellation so the current paid plan keeps running.
  // Refreshes on success so the server re-resolves the (no-longer-cancelling)
  // plan state and the cards flip back to their normal labels.
  async function handleResume() {
    if (isResuming || pendingPlanId) return
    setError(null)

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
      setResumedDetails({ planName: currentPlanName })
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

    if (!billingEnabled) {
      setError("Billing isn't available yet. Please try again later.")
      return
    }

    // Downgrading to Free doesn't cancel straight away: first we open a short
    // survey asking why. The actual cancellation happens in handleCancelSubmit
    // once a reason is chosen.
    if (planId === "free") {
      if (cancelAtPeriodEnd) {
        setError(
          "Your plan is already scheduled to move to Free at the end of the current billing period.",
        )
        return
      }
      setSurveyError(null)
      setSurveyOpen(true)
      return
    }

    await redirectTo(planId, "/api/billing/checkout", { planId, period })
  }

  // Runs the actual cancellation once the survey is submitted. Schedules the
  // cancel in-app (POST /api/billing/cancel) rather than via the Stripe portal
  // so the outcome is always cancel-at-period-end and the user stays here, and
  // sends the survey reason + notes along to be recorded. On success we close
  // the survey, show the confirmation dialog, and refresh so the cards flip to
  // the "Cancellation scheduled" state.
  async function handleCancelSubmit(reason: CancellationReason, notes: string) {
    if (cancelSubmitting) return
    setSurveyError(null)

    if (!billingEnabled) {
      setSurveyError("Billing isn't available yet. Please try again later.")
      return
    }

    setCancelSubmitting(true)
    setPendingPlanId("free")
    try {
      const response = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, notes }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        planName?: string
        periodEnd?: string
      }
      if (!response.ok) {
        setSurveyError(data.error ?? "Something went wrong. Please try again.")
        return
      }
      setSurveyOpen(false)
      if (data.planName && data.periodEnd) {
        setCancelledDetails({
          planName: data.planName,
          periodEnd: data.periodEnd,
        })
      }
      router.refresh()
    } catch {
      setSurveyError("Something went wrong. Please try again.")
    } finally {
      setCancelSubmitting(false)
      setPendingPlanId(null)
    }
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
        resumingPlan={isResuming}
        onSelectPlan={handleSelect}
        onResumePlan={handleResume}
      />

      {surveyOpen ? (
        <CancelSurveyDialog
          planName={currentPlanName}
          submitting={cancelSubmitting}
          error={surveyError}
          onOpenChange={(open) => {
            if (!open) setSurveyOpen(false)
          }}
          onSubmit={handleCancelSubmit}
        />
      ) : null}

      <PlanCancelledDialog
        details={cancelledDetails}
        onOpenChange={(open) => {
          if (!open) setCancelledDetails(null)
        }}
      />

      <PlanResumedDialog
        details={resumedDetails}
        onOpenChange={(open) => {
          if (!open) setResumedDetails(null)
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
