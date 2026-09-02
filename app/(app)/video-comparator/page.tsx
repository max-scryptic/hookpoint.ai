import Link from "next/link"
import { ArrowLeftRightIcon, SparklesIcon } from "lucide-react"

import { PaidFeatureCard } from "@/components/paid-feature-card"
import { PreviousComparisons } from "@/components/previous-comparisons"
import { RetentionComparePicker } from "@/components/retention-compare-picker"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { sweepAbandonedComparisons } from "@/lib/comparison-cleanup"
import {
  listComparableVideos,
  type ComparableVideo,
} from "@/lib/retention-comparison"
import {
  listSavedComparisons,
  type SavedComparison,
} from "@/lib/video-comparisons"
import { createClient } from "@/lib/supabase/server"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// The Video Comparator: pick any two library videos to generate a head-to-head,
// or re-open one you have already generated. The report itself now lives on its
// own page (video-comparator/report); generating a pair or picking one from the
// history below redirects there. This page is only the picker and the history.
// Same paid gate as deep analysis, since the comparison rides on the stored
// analysis of both videos.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

type CompareResult =
  | { status: "locked" }
  | { status: "empty"; videoCount: number }
  | {
      status: "ok"
      videos: ComparableVideo[]
      comparisons: SavedComparison[]
      firstComparisonFree: boolean
    }
  | { status: "error" }

// Whether this page should be offering a free head-to-head. A paid creator who
// has never generated one pays nothing for their first (see
// comparisonCreditCost), and the history is the same list the server prices
// from, so nothing extra has to be read to know it. The offer is only announced
// once it can be taken up, which means two analysed videos and a picker to use
// them in: alongside the empty state it would be a promise about a page that
// cannot compare anything yet.
function isFirstComparisonFree(comparisons: SavedComparison[]): boolean {
  return comparisons.length === 0
}

async function loadComparePage(userId: string): Promise<CompareResult> {
  try {
    const entitlement = await getEntitlement(userId)
    if (entitlement.plan.deepCreditsPerMonth <= 0) return { status: "locked" }
  } catch (error) {
    console.error("Failed to resolve plan for retention comparison", error)
    return { status: "locked" }
  }

  try {
    const supabase = await createClient()
    // Clear out any run that was abandoned without the browser or the generate
    // endpoint getting to say so (a browser killed outright, a deploy that went
    // away mid-write) before reading the history back. Such a pair carries no
    // report at all and cannot still be being written, so it is a charge the
    // creator never got anything for: it goes, and the credits go back with it.
    // Doing it here means the page they would notice it on is the page that
    // tidies it up.
    await sweepAbandonedComparisons(supabase, userId)
    const [videos, comparisons] = await Promise.all([
      listComparableVideos(supabase, userId),
      listSavedComparisons(supabase, userId),
    ])
    // Two deeply analysed videos are the floor for comparing anything.
    if (videos.length < 2) {
      return { status: "empty", videoCount: videos.length }
    }

    return {
      status: "ok",
      videos,
      comparisons,
      firstComparisonFree: isFirstComparisonFree(comparisons),
    }
  } catch (error) {
    console.error("Failed to load retention comparison", error)
    return { status: "error" }
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const result = await loadComparePage(user.id)

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
                <BreadcrumbPage>Video Comparator</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              Video Comparator
            </h1>
            {result.status === "ok" && result.firstComparisonFree && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <SparklesIcon className="size-3.5" />
                Your first comparison report is free
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Put any two uploads head to head: where their retention curves
            diverge, how the hooks compare, and the evidence behind each
            stretch.
          </p>
        </div>

        {result.status === "ok" && (
          <>
            <RetentionComparePicker
              videos={result.videos}
              savedPairs={result.comparisons.map((comparison) => ({
                a: comparison.videoAId,
                b: comparison.videoBId,
                reportsReady: comparison.reportsReady,
              }))}
              firstComparisonFree={result.firstComparisonFree}
            />
            <PreviousComparisons comparisons={result.comparisons} />
          </>
        )}
        {result.status === "empty" && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <ArrowLeftRightIcon className="size-5 text-muted-foreground" />
            <div className="w-full">
              <p className="text-sm text-muted-foreground">
                A head-to-head reads from the stored deep analysis of both
                videos, so you need{" "}
                <span className="font-semibold text-foreground">
                  two deeply analysed uploads
                </span>{" "}
                before this page can compare anything.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {result.videoCount === 1 ? (
                  <>
                    <span className="font-semibold text-foreground">
                      One of your videos
                    </span>{" "}
                    is deeply analysed so far. Deeply analyse one more and this
                    page lights up.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">
                      None of your videos
                    </span>{" "}
                    are deeply analysed yet. Deeply analyse two and this page
                    lights up.
                  </>
                )}
              </p>
            </div>
            <Link href="/analyse-video" className={buttonVariants()}>
              Analyse a video
            </Link>
          </Card>
        )}
        {result.status === "locked" && (
          <PaidFeatureCard feature="Video comparison">
            Any two analysed videos can be compared side by side: where their
            retention curves diverge, how their hooks stack up, and the event
            evidence for what happened in each stretch.
          </PaidFeatureCard>
        )}
        {result.status === "error" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            We couldn&apos;t load the comparison right now. Please try again
            later.
          </div>
        )}
      </div>
    </>
  )
}
