import Link from "next/link"
import { LibraryIcon, LockIcon } from "lucide-react"

import { PreviousComparisons } from "@/components/previous-comparisons"
import { RetentionComparePicker } from "@/components/retention-compare-picker"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
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
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
    }
  | { status: "error" }

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
    const [videos, comparisons] = await Promise.all([
      listComparableVideos(supabase, userId),
      listSavedComparisons(supabase, userId),
    ])
    // Two deeply analysed videos are the floor for comparing anything.
    if (videos.length < 2) {
      return { status: "empty", videoCount: videos.length }
    }

    return { status: "ok", videos, comparisons }
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
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Video Comparator</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Video Comparator
          </h1>
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
              }))}
            />
            <PreviousComparisons comparisons={result.comparisons} />
          </>
        )}
        {result.status === "empty" && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <LibraryIcon className="size-5 text-muted-foreground" />
            <div className="w-full">
              <p className="max-w-prose text-sm text-muted-foreground">
                A head-to-head reads from the stored deep analysis of both
                videos, so you need two deeply analysed uploads before this
                page can compare anything.
              </p>
              <p className="mt-3 max-w-prose text-sm text-muted-foreground">
                {result.videoCount === 1
                  ? "One of your videos is deeply analysed so far. Deeply analyse one more and this page lights up."
                  : "None of your videos are deeply analysed yet. Deeply analyse two and this page lights up."}
              </p>
            </div>
            <Link href="/dashboard/analyse-video" className={buttonVariants()}>
              Analyse a video
            </Link>
          </Card>
        )}
        {result.status === "locked" && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <LockIcon className="size-5 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">
                Video comparison is a paid feature
              </h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                On Starter and Pro, any two analysed videos can be compared
                side by side: where their retention curves diverge, how their
                hooks stack up, and the event evidence for what happened in
                each stretch.
              </p>
            </div>
            <Link href="/pricing" className={buttonVariants()}>
              See plans
            </Link>
          </Card>
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
