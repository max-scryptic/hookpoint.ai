import { HelpGuide } from "@/components/help-guide"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import type { PlanId } from "@/lib/plans"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// The manual: what every part of the product does and how to use it, written
// for someone who has just signed up and has never seen a retention curve.
//
// The plan is read only so the Free/Paid comparison can mark which side the
// reader is on. Nothing on the page is hidden behind it: a Free user should be
// able to read exactly what a deep dive would give them before deciding whether
// to pay for one. A failed lookup falls back to Free, matching the fail-closed
// default the rest of the billing code uses.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

async function loadPlanId(userId: string): Promise<PlanId> {
  try {
    const entitlement = await getEntitlement(userId)
    return entitlement.planId
  } catch (error) {
    console.error("Failed to resolve plan for the help page", error)
    return "free"
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const planId = await loadPlanId(user.id)

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Help</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Help</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How the whole app works, in plain words. Start at the top if you are
            new.
          </p>
        </div>

        <HelpGuide planId={planId} />
      </div>
    </>
  )
}
