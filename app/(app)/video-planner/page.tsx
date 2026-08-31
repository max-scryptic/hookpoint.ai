import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { planIncludesUploads } from "@/lib/plans"
import { createClient } from "@/lib/supabase/server"
import { listVideoPlans, type VideoPlan } from "@/lib/video-plans/video-plans"
import { PaidFeatureCard } from "@/components/paid-feature-card"
import {
  VideoPlanList,
  type VideoPlanListItem,
} from "@/components/video-plan-list"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Whether this account can upload at all, which is what the planner is gated
// on: a plan is footage plus an image, so a tier without uploads has no way to
// make one. Best-effort - a failed entitlement read offers the planner rather
// than an upgrade wall, and the two upload routes behind it enforce the same
// rule anyway.
async function loadCanUpload(userId: string): Promise<boolean> {
  try {
    const entitlement = await getEntitlement(userId)
    return planIncludesUploads(entitlement.plan)
  } catch (error) {
    console.error("Failed to load entitlement for the video planner", error)
    return true
  }
}

// The creator's existing plans. Best-effort for the same reason: being unable
// to list old plans is no reason to stop them starting a new one.
async function loadPlans(userId: string): Promise<VideoPlan[]> {
  try {
    const supabase = await createClient()
    return await listVideoPlans(supabase, userId)
  } catch (error) {
    console.error("Failed to list video plans", error)
    return []
  }
}

// A plan as the list needs it. The thumbnail is addressed through the signing
// route rather than by storage path, which is the only way a private object
// reaches the browser.
function toListItem(plan: VideoPlan): VideoPlanListItem {
  return {
    id: plan.id,
    titles: plan.titles,
    thumbnailUrls: plan.thumbnailStoragePath
      ? [`/api/video-plans/${plan.id}/thumbnail`]
      : [],
    status: plan.status,
    createdAt: plan.createdAt,
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const [canUpload, plans] = await Promise.all([
    loadCanUpload(user.id),
    loadPlans(user.id),
  ])

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
                <BreadcrumbPage>Video Planner</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Video Planner
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your packaging before it goes live. Every video you are
            planning is here: open one to add the cut, the titles you are
            weighing up and the thumbnail, and we will tell you which title fits
            and what to change.
          </p>
        </div>

        {!canUpload && (
          <PaidFeatureCard feature="Video planning">
            Any cut can be checked before it goes live: upload the footage with
            the titles you are weighing up and the thumbnail, and the plan tells
            you which title the video actually delivers on, how the thumbnail
            holds up beside it, and what to change before you publish.
          </PaidFeatureCard>
        )}

        <VideoPlanList plans={plans.map(toListItem)} canCreate={canUpload} />
      </div>
    </>
  )
}
