import Link from "next/link"
import { ClapperboardIcon } from "lucide-react"

import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { planIncludesUploads } from "@/lib/plans"
import { createClient } from "@/lib/supabase/server"
import { listVideoPlans, type VideoPlan } from "@/lib/video-plans/video-plans"
import { UpgradeToUploadPrompt } from "@/components/unlock-full-report-cta"
import { VideoPlanBuilder } from "@/components/video-plan-builder"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Whether this account can upload at all, which is what the planner is gated
// on: a plan is footage plus an image, so a tier without uploads has no way to
// make one. Best-effort - a failed entitlement read shows the builder rather
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
            Check your packaging before it goes live. Upload the cut, enter the
            titles you are weighing up, add the thumbnail, and we will tell you
            which title fits and what to change.
          </p>
        </div>

        {canUpload ? (
          <VideoPlanBuilder />
        ) : (
          <Card className="p-6">
            <UpgradeToUploadPrompt message="Upgrade to Starter or Pro to plan a video before you publish it: upload the cut, weigh up your titles, and check the packaging holds together." />
          </Card>
        )}

        {plans.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Your plans
            </h2>
            <div className="flex flex-col gap-2">
              {plans.map((plan) => (
                <PlanRow key={plan.id} plan={plan} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function PlanRow({ plan }: { plan: VideoPlan }) {
  // The title the creator led with names the plan. A plan with no titles can
  // only be one whose creation was interrupted, so it says so rather than
  // rendering a blank row.
  const name = plan.titles[0] ?? "Untitled plan"
  const alternatives = plan.titles.length - 1

  return (
    <Link
      href={`/video-planner/${plan.id}`}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <ClapperboardIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-sm text-muted-foreground">
          {alternatives > 0
            ? `${alternatives} other title ${alternatives === 1 ? "idea" : "ideas"}`
            : "One title"}
        </p>
      </div>
      <PlanStatusBadge plan={plan} />
    </Link>
  )
}

function PlanStatusBadge({ plan }: { plan: VideoPlan }) {
  const { label, className } = planBadge(plan)
  return (
    <span
      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

function planBadge(plan: VideoPlan): { label: string; className: string } {
  switch (plan.status) {
    case "ready":
      return {
        label: "Ready",
        className:
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      }
    case "failed":
      return {
        label: "Needs a retry",
        className:
          "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      }
    case "processing":
      return { label: "Reading…", className: "text-muted-foreground" }
    default:
      return { label: "Draft", className: "text-muted-foreground" }
  }
}
