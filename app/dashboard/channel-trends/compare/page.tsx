import Link from "next/link"
import { LockIcon } from "lucide-react"

import { RetentionComparePicker } from "@/components/retention-compare-picker"
import { RetentionComparison } from "@/components/retention-comparison"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import {
  defaultComparisonPair,
  getRetentionComparison,
  listComparableVideos,
  type ComparableVideo,
  type RetentionComparisonData,
} from "@/lib/retention-comparison"
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

// The video-vs-video comparison page: pick any two library videos and see
// where their retention curves diverge, hook against hook, and the event
// evidence for each stretch. Same paid gate as the Channel Trends page it
// hangs off - comparison rides on deep analysis.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

type CompareResult =
  | { status: "locked" }
  | { status: "empty"; videoCount: number }
  | {
      status: "ok"
      videos: ComparableVideo[]
      a: string
      b: string
      data: RetentionComparisonData
    }
  | { status: "error" }

function pickPair(
  videos: ComparableVideo[],
  requestedA: string | undefined,
  requestedB: string | undefined,
): { a: string; b: string } | null {
  const ids = new Set(videos.map((video) => video.id))
  const a = requestedA && ids.has(requestedA) ? requestedA : null
  const b =
    requestedB && ids.has(requestedB) && requestedB !== a ? requestedB : null
  if (a && b) return { a, b }

  const fallback = defaultComparisonPair(videos)
  if (fallback == null) return null
  if (a) {
    const other = videos.find((video) => video.id !== a)
    return other ? { a, b: other.id } : null
  }
  if (b) {
    const other = videos.find((video) => video.id !== b)
    return other ? { a: other.id, b } : null
  }
  return fallback
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
    const videos = await listComparableVideos(supabase, userId)
    const pair = pickPair(videos, requestedA, requestedB)
    if (pair == null) return { status: "empty", videoCount: videos.length }

    const data = await getRetentionComparison(
      supabase,
      userId,
      pair.a,
      pair.b,
    )
    if (data == null) return { status: "empty", videoCount: videos.length }
    return { status: "ok", videos, a: pair.a, b: pair.b, data }
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
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard/channel-trends">
                  Channel Trends
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Compare</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Video vs video
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Two retention curves on one axis: where they diverge, how the
            hooks compare, and the evidence behind each stretch.
          </p>
        </div>

        {result.status === "ok" && (
          <>
            <RetentionComparePicker
              videos={result.videos}
              selectedA={result.a}
              selectedB={result.b}
            />
            <RetentionComparison data={result.data} />
          </>
        )}
        {result.status === "empty" && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <p className="max-w-prose text-sm text-muted-foreground">
              Comparing needs at least two analysed videos with a stored
              retention curve
              {result.videoCount === 1
                ? " - you have one so far."
                : " - none are in your library yet."}{" "}
              Analyse another video and this page lights up.
            </p>
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
