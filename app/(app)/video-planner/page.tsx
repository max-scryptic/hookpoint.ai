import Link from "next/link"
import { TrendingUpIcon } from "lucide-react"

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
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// What the page can offer this account. Two gates, in this order: the plan
// (a plan is footage plus an image, so a tier without uploads has no way to
// make one), then the library (a plan reads a cut against the channel it is
// going out on, so it needs enough deeply analysed videos underneath it to
// have something to read it against).
//
// A gate replaces the list rather than sitting above an empty one: an account
// that cannot start a plan yet has no use for a heading over a placeholder
// telling it to start one. The exception is plans already made, which stay
// reachable whatever the account can do today, so the list still renders for
// them and only the button that starts another is withheld.
type PlannerAccess =
  // The account's plan carries no uploads: the upgrade wall.
  | { status: "locked" }
  // Paid, but the library is still too thin to ground a plan in: the meter.
  | { status: "building"; videoCount: number }
  | { status: "ok" }

// Whether this account can upload at all. Best-effort - a failed entitlement
// read opens the planner rather than showing an upgrade wall, and the two
// upload routes behind it enforce the same rule anyway.
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

// A plan as the list needs it. The thumbnail is addressed through the signing
// route rather than by storage path, which is the only way a private object
// reaches the browser.
function toListItem(plan: VideoPlan): VideoPlanListItem {
  return {
    id: plan.id,
    titles: plan.titles,
    thumbnailUrls: plan.thumbnailStoragePaths
      .map((path, index) =>
        path ? `/api/video-plans/${plan.id}/thumbnail?slot=${index}` : null,
      )
      .filter((url): url is string => Boolean(url)),
    status: plan.status,
    createdAt: plan.createdAt,
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
            Check your packaging before it goes live. Every video you are
            planning is here: open one to add the titles, thumbnail options and
            cut, and we will tell you which title fits and what to change.
          </p>
        </div>

        {access.status === "building" && (
          <BuildingLibrary videoCount={access.videoCount} />
        )}
        {access.status === "locked" && (
          <PaidFeatureCard feature="Video planning">
            Any cut can be checked before it goes live: upload the footage with
            the titles you are weighing up and the thumbnails, and the plan tells
            you which title the video actually delivers on, how the thumbnail
            holds up beside it, and what to change before you publish.
          </PaidFeatureCard>
        )}

        {(access.status === "ok" || plans.length > 0) && (
          <VideoPlanList
            plans={plans.map(toListItem)}
            canCreate={access.status === "ok"}
          />
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
