import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { PricingPlansCheckout } from "@/components/pricing-plans-checkout"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { isStripeEnabled } from "@/lib/stripe/config"
import { getEntitlement } from "@/lib/billing/entitlements"
import type { PlanId } from "@/lib/plans"
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

// The user's plan drives which card shows "Current plan"; a lookup failure just
// falls back to Free so the page always renders.
async function loadCurrentPlan(userId: string): Promise<PlanId> {
  try {
    const entitlement = await getEntitlement(userId)
    return entitlement.planId
  } catch (error) {
    console.error("Failed to resolve current plan for pricing", error)
    return "free"
  }
}

export default async function PricingPage() {
  const [defaultOpen, user] = await Promise.all([
    getSidebarDefaultOpen(),
    requireAuthenticatedUser(),
  ])
  const currentPlanId = await loadCurrentPlan(user.id)
  const billingEnabled = isStripeEnabled()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
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
                  <BreadcrumbLink href="/dashboard">Hookpoint.ai</BreadcrumbLink>
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
                currentPlanId={currentPlanId}
                billingEnabled={billingEnabled}
              />
            </Suspense>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
