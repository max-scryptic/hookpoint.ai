import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { PricingPlansCheckout } from "@/components/pricing-plans-checkout"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { isStripeEnabled } from "@/lib/stripe/config"
import { getEntitlement } from "@/lib/billing/entitlements"
import { syncCurrentSubscriptionForUser } from "@/lib/billing/subscriptions"
import type { BillingPeriod, PlanId } from "@/lib/plans"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { requireAuthenticatedUser } from "@/lib/auth"

// Reconcile the stored subscription against Stripe before we resolve the plan.
// Webhooks are the primary path for keeping the projection fresh, but a missed
// customer.subscription.updated event leaves the pricing cards showing stale
// state - e.g. offering "Downgrade to Free" for a plan Stripe has already
// scheduled to cancel, which then dead-ends in the portal. This is the one
// surface a subscriber lands on to change plans, so reconcile on load. No-op
// for Free users (no subscription to sync) and best-effort: a Stripe/DB hiccup
// must not take the page down.
async function reconcileSubscription(userId: string): Promise<void> {
  if (!isStripeEnabled()) return
  try {
    await syncCurrentSubscriptionForUser(userId)
  } catch (error) {
    console.error("Failed to reconcile subscription for pricing", error)
  }
}

// The user's plan drives which card shows "Current plan", and whether the plan
// is already scheduled to revert to Free drives the Free card's state. A lookup
// failure just falls back to Free so the page always renders.
async function loadCurrentPlan(
  userId: string,
): Promise<{
  planId: PlanId | null
  billingPeriod: BillingPeriod | null
  periodEnd: string | null
  cancelAtPeriodEnd: boolean
}> {
  try {
    const entitlement = await getEntitlement(userId)
    return {
      planId: entitlement.planId,
      billingPeriod: entitlement.billingPeriod,
      periodEnd: entitlement.subscriptionPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    }
  } catch (error) {
    console.error("Failed to resolve current plan for pricing", error)
    return {
      planId: null,
      billingPeriod: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    }
  }
}

export default async function PricingPage() {
  const [defaultOpen, user] = await Promise.all([
    getSidebarDefaultOpen(),
    requireAuthenticatedUser(),
  ])
  await reconcileSubscription(user.id)
  const {
    planId: currentPlanId,
    billingPeriod: currentBillingPeriod,
    periodEnd: currentPeriodEnd,
    cancelAtPeriodEnd,
  } = await loadCurrentPlan(user.id)
  const billingEnabled = isStripeEnabled()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        showUpgradeToPro={currentPlanId === "free"}
        user={user}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/">Viewlio</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Plans</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="mx-auto w-full max-w-5xl space-y-8 py-4">
            <div className="text-center">
              <h1 className="font-heading text-3xl font-semibold tracking-tight">
                Choose your plan
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                Analyse your retention data, then spend deep-dive credits to
                pull frame-level insight from your source footage. Upgrade or
                downgrade whenever you like.
              </p>
            </div>
            <Suspense>
              <PricingPlansCheckout
                currentPlanId={currentPlanId ?? "free"}
                currentBillingPeriod={currentBillingPeriod}
                currentPeriodEnd={currentPeriodEnd}
                cancelAtPeriodEnd={cancelAtPeriodEnd}
                billingEnabled={billingEnabled}
              />
            </Suspense>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
