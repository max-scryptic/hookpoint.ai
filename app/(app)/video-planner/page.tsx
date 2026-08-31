import Link from "next/link"
import { ClapperboardIcon, TrendingUpIcon } from "lucide-react"

import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import {
  countDeeplyAnalysedVideos,
  VIDEO_PLANNER_VIDEO_THRESHOLD,
} from "@/lib/deep-analysis-library"
import { planIncludesUploads } from "@/lib/plans"
import { createClient } from "@/lib/supabase/server"
import { listVideoPlans, type VideoPlan } from "@/lib/video-plans/video-plans"
import { LibraryProgress } from "@/components/library-progress"
import { PaidFeatureCard } from "@/components/paid-feature-card"
import { VideoPlanBuilder } from "@/components/video-plan-builder"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// What the page can offer this account. Two gates, in this order: the plan
// (a plan is footage plus an image, so a tier without uploads has no way to
// make one), then the library (a plan reads a cut against the channel it is
// going out on, so it needs enough deeply analysed videos underneath it to
// have something to read it against).
type PlannerAccess =
  // The account's plan carries no uploads: the upgrade wall.
  | { status: "locked" }
  // Paid, but the library is still too thin to ground a plan in: the meter.
  | { status: "building"; videoCount: number }
  | { status: "ok" }

// Whether this account can upload at all. Best-effort - a failed entitlement
// read shows the builder rather than an upgrade wall, and the two upload routes
// behind it enforce the same rule anyway.
async function loadCanUpload(userId: string): Promise<boolean> {
  try {
    const entitlement = await getEntitlement(userId)
    return planIncludesUploads(entitlement.plan)
  } catch (error) {
    console.error("Failed to load entitlement for the video planner", error)
    return true
  }
}

// How many videos this account has deeply analysed, which is what the library
// gate reads. Best-effort in the same way and for the same reason as the
// entitlement above: a database hiccup must not read as an account that has
// analysed nothing, so a failed count opens the planner and POST
// /api/video-plans applies the same threshold when the plan is actually
// started.
async function loadLibraryVideoCount(userId: string): Promise<number | null> {
  try {
    const supabase = await createClient()
    return await countDeeplyAnalysedVideos(supabase, userId)
  } catch (error) {
    console.error("Failed to count deeply analysed videos", error)
    return null
  }
}

async function loadAccess(userId: string): Promise<PlannerAccess> {
  const [canUpload, videoCount] = await Promise.all([
    loadCanUpload(userId),
    loadLibraryVideoCount(userId),
  ])

  if (!canUpload) return { status: "locked" }
  if (videoCount != null && videoCount < VIDEO_PLANNER_VIDEO_THRESHOLD) {
    return { status: "building", videoCount }
  }
  return { status: "ok" }
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
  const [access, plans] = await Promise.all([
    loadAccess(user.id),
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

        {access.status === "ok" && <VideoPlanBuilder />}
        {access.status === "building" && (
          <BuildingLibrary videoCount={access.videoCount} />
        )}
        {access.status === "locked" && (
          <PaidFeatureCard feature="Video planning">
            Any cut can be checked before it goes live: upload the footage with
            the titles you are weighing up and the thumbnail, and the plan tells
            you which title the video actually delivers on, how the thumbnail
            holds up beside it, and what to change before you publish.
          </PaidFeatureCard>
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

// The library gate: the same meter Channel Trends counts up on, then one card
// saying why the planner waits for it. A plan is only worth as much as the
// channel it is read against, so the wait is framed as the work that makes the
// verdicts good rather than as a wall.
function BuildingLibrary({ videoCount }: { videoCount: number }) {
  const remaining = VIDEO_PLANNER_VIDEO_THRESHOLD - videoCount
  const message =
    videoCount === 0
      ? `Deeply analyse ${VIDEO_PLANNER_VIDEO_THRESHOLD} videos to unlock the Video Planner.`
      : `Deeply analyse ${remaining} more video${remaining === 1 ? "" : "s"} to unlock the Video Planner.`

  return (
    <div className="flex flex-col gap-4">
      <LibraryProgress
        message={message}
        count={videoCount}
        target={VIDEO_PLANNER_VIDEO_THRESHOLD}
      />
      <Card className="flex flex-col items-start gap-3 p-6">
        <TrendingUpIcon className="size-5 text-muted-foreground" />
        <div className="w-full">
          <p className="text-sm text-muted-foreground">
            A plan reads your cut against{" "}
            <span className="font-semibold text-foreground">your channel</span>:
            the titles that earned your clicks, the thumbnails that held up
            beside them, and the hooks that kept viewers watching.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            That takes grounding data. Once{" "}
            {VIDEO_PLANNER_VIDEO_THRESHOLD} of your videos have been deeply
            analysed, the planner opens and every verdict it gives is measured
            against what already works for you.
          </p>
        </div>
        <Link href="/analyse-video" className={buttonVariants()}>
          Analyse a video
        </Link>
      </Card>
    </div>
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
