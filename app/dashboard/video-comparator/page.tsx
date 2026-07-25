import Link from "next/link"
import { LibraryIcon, LockIcon } from "lucide-react"

import { PackagingComparison } from "@/components/packaging-comparison"
import { PreviousComparisons } from "@/components/previous-comparisons"
import { RetentionComparePicker } from "@/components/retention-compare-picker"
import {
  RetentionComparisonDetail,
  RetentionComparisonVideos,
} from "@/components/retention-comparison"
import { VideoComparisonTabs } from "@/components/video-comparison-tabs"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import {
  getPackagingComparison,
  type PackagingComparison as PackagingComparisonData,
} from "@/lib/packaging-comparison"
import {
  getRetentionComparison,
  listComparableVideos,
  type ComparableVideo,
  type RetentionComparisonData,
} from "@/lib/retention-comparison"
import {
  findSavedComparison,
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

// The Video Comparator: pick any two library videos and see where their
// retention curves diverge, hook against hook, and the event evidence for
// each stretch. A standalone page and the seed of a much larger video-by-video
// report. Same paid gate as deep analysis, since the comparison rides on the
// stored analysis of both videos.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// The active report, when the requested pair has been generated (paid for).
// Selecting a pair never loads a report on its own; only a saved comparison
// does, so navigating to a pair the creator has not generated shows the
// selectors prefilled with no report below.
type ActiveComparison = {
  a: string
  b: string
  data: RetentionComparisonData
  packaging: PackagingComparisonData | null
}

type CompareResult =
  | { status: "locked" }
  | { status: "empty"; videoCount: number }
  | {
      status: "ok"
      videos: ComparableVideo[]
      comparisons: SavedComparison[]
      // The pair to prefill the selectors with, if any (from the URL).
      selectedA: string
      selectedB: string
      // The report to render, only present for an already-generated pair.
      active: ActiveComparison | null
    }
  | { status: "error" }

// Resolves the requested URL pair against the creator's saved comparisons and
// loads its report. Returns null when no pair was requested, the ids are not a
// distinct comparable pair, or the pair has not been generated yet - in every
// case the page shows the selectors without a report rather than charging on a
// mere navigation.
async function loadActiveComparison(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  videos: ComparableVideo[],
  requestedA: string | undefined,
  requestedB: string | undefined,
): Promise<ActiveComparison | null> {
  const ids = new Set(videos.map((video) => video.id))
  if (
    !requestedA ||
    !requestedB ||
    requestedA === requestedB ||
    !ids.has(requestedA) ||
    !ids.has(requestedB)
  ) {
    return null
  }

  // Only a paid-for pair renders. Without this gate a shared or hand-edited URL
  // would load a report the creator never generated.
  const saved = await findSavedComparison(
    supabase,
    userId,
    requestedA,
    requestedB,
  )
  if (saved == null) return null

  // Packaging rides on the same stored analysis; a packaging failure or gap
  // must never cost the user the retention comparison, so it is best-effort.
  const [data, packaging] = await Promise.all([
    getRetentionComparison(supabase, userId, requestedA, requestedB),
    getPackagingComparison(supabase, userId, requestedA, requestedB).catch(
      (error) => {
        console.error("Failed to load packaging comparison", error)
        return null
      },
    ),
  ])
  if (data == null) return null
  return { a: requestedA, b: requestedB, data, packaging }
}

async function loadComparePage(
  userId: string,
  requestedA: string | undefined,
  requestedB: string | undefined,
): Promise<CompareResult> {
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

    const active = await loadActiveComparison(
      supabase,
      userId,
      videos,
      requestedA,
      requestedB,
    )
    return {
      status: "ok",
      videos,
      comparisons,
      selectedA: active?.a ?? "",
      selectedB: active?.b ?? "",
      active,
    }
  } catch (error) {
    console.error("Failed to load retention comparison", error)
    return { status: "error" }
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAuthenticatedUser()
  const params = await searchParams
  const result = await loadComparePage(
    user.id,
    first(params.a),
    first(params.b),
  )

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
              key={`${result.selectedA}-${result.selectedB}`}
              videos={result.videos}
              selectedA={result.selectedA}
              selectedB={result.selectedB}
              savedPairs={result.comparisons.map((comparison) => ({
                a: comparison.videoAId,
                b: comparison.videoBId,
              }))}
            />
            {result.active && (
              <>
                <RetentionComparisonVideos data={result.active.data} />
                <VideoComparisonTabs
                  retention={
                    <RetentionComparisonDetail data={result.active.data} />
                  }
                  packaging={
                    result.active.packaging ? (
                      <PackagingComparison data={result.active.packaging} />
                    ) : (
                      <Card className="p-6 text-sm text-muted-foreground">
                        No packaging read is available for these two videos yet.
                        Open each video&apos;s analysis to generate one, then
                        this tab fills in.
                      </Card>
                    )
                  }
                  script={
                    <Card className="p-6 text-sm text-muted-foreground">
                      A script head-to-head is coming soon. For now, open each
                      video&apos;s full analysis to read its script feedback.
                    </Card>
                  }
                />
              </>
            )}
            <PreviousComparisons
              comparisons={result.comparisons}
              activePair={
                result.active
                  ? { a: result.active.a, b: result.active.b }
                  : null
              }
            />
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
