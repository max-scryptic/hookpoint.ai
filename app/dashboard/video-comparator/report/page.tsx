import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeftIcon, LockIcon } from "lucide-react"

import { PackagingComparison } from "@/components/packaging-comparison"
import { ScriptComparison } from "@/components/script-comparison"
import { RetentionComparisonVideos } from "@/components/retention-comparison"
import { VideoComparisonTabs } from "@/components/video-comparison-tabs"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import {
  getPackagingComparison,
  type PackagingComparison as PackagingComparisonData,
} from "@/lib/packaging-comparison"
import type { PackagingComparisonReport } from "@/lib/packaging-comparison-report"
import type { ScriptComparisonReport } from "@/lib/script-comparison-report"
import {
  getRetentionComparison,
  listComparableVideos,
  type ComparableVideo,
  type RetentionComparisonData,
} from "@/lib/retention-comparison"
import {
  findSavedComparison,
  getComparisonReports,
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

// The Comparison Report: the full side-by-side for a single generated pair.
// The Video Comparator (its parent) is now only the picker and the history of
// generated reports; generating a pair or re-opening a saved one lands here.
// Same paid gate and paid-pair gate as before: a report only renders for a pair
// the creator has actually generated, so a shared or hand-edited URL never
// loads a report they never paid for.
//
// This page is read-only. The whole report is produced once, when the creator
// presses Generate report (see app/api/video-comparisons/route.ts): the two
// written head-to-heads are stored on the comparison row there, and everything
// else is pure arithmetic over each video's stored analysis. Nothing on this
// page calls a model, and nothing generates on the fly, so every tab is fully
// rendered by the time the page paints instead of streaming in behind a
// spinner. A pair that is missing a written report (one created before those
// reports existed, or one whose generation failed) says so and is filled in for
// free by re-opening the pair from the Video Comparator; it is never quietly
// regenerated on view.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

type ActiveComparison = {
  a: string
  b: string
  data: RetentionComparisonData
  packaging: PackagingComparisonData | null
  packagingReport: PackagingComparisonReport | null
  scriptReport: ScriptComparisonReport | null
}

type ReportResult =
  | { status: "locked" }
  | { status: "not_found" }
  | { status: "ok"; active: ActiveComparison }
  | { status: "error" }

// Resolves the requested URL pair against the creator's saved comparisons and
// loads its report. Returns null when no pair was requested, the ids are not a
// distinct comparable pair, or the pair has not been generated yet - in every
// case the report page shows a not-found message rather than loading a report
// the creator never generated.
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

  // Which video is A and which is B comes from the saved row, not from the URL.
  // The written head-to-heads were generated in the stored order and talk about
  // "Video A" and "Video B" throughout, so a swapped link (?a=B&b=A) must not
  // flip the tables underneath them and leave the two disagreeing about which
  // video is which.
  const sideA = saved.videoAId
  const sideB = saved.videoBId

  // The deterministic diffs below print each side's view count, so bring both
  // rows' stored numbers up to date first. The refresh is throttled, so
  // re-opening a report twice in a row costs nothing. The written head-to-heads
  // keep whatever they were generated against; only pressing the button in the
  // Video Comparator rewrites those.
  await refreshAnalysedVideoStats(supabase, userId, {
    analysedVideoIds: [sideA, sideB],
  })

  // Every read here is a stored read: the written head-to-heads come back as
  // JSON from the comparison row, and the packaging diff is derived from each
  // video's stored analysis. The script tab is the written report alone, so
  // nothing is derived for it. The retention comparison is still loaded because
  // the video cards above the tabs and the page heading are built from it, but
  // it no longer has a tab of its own. Packaging is best-effort, since a failure
  // or gap in it must never cost the user the rest of the report.
  const [data, packaging, reports] = await Promise.all([
    getRetentionComparison(supabase, userId, sideA, sideB),
    getPackagingComparison(supabase, userId, sideA, sideB).catch((error) => {
      console.error("Failed to load packaging comparison", error)
      return null
    }),
    getComparisonReports(supabase, userId, saved.id).catch((error) => {
      console.error("Failed to load stored comparison reports", error)
      return { script: null, packaging: null, retention: null }
    }),
  ])
  if (data == null) return null

  return {
    a: sideA,
    b: sideB,
    data,
    packaging,
    packagingReport: reports.packaging,
    scriptReport: reports.script,
  }
}

// Shown in place of a tab body whose written head-to-head was never stored: a
// pair generated before that report existed, or one whose generation failed at
// creation. Re-opening the pair from the Video Comparator writes it, for free,
// so the fix stays behind the same button that generates everything else.
function MissingReportCard({ children }: { children: ReactNode }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
      <Link
        href="/dashboard/video-comparator"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Back to Video Comparator
      </Link>
    </Card>
  )
}

// The Script tab body, rendered straight from what is stored. Nothing is
// generated here. The one thing that is not stored on the report is which video
// has more views, which the section's column headers badge exactly as the
// packaging tab does, so it is read off the packaging diff (derived on every
// open) and simply left off for a pair that has none.
function ScriptComparisonSection({
  packaging,
  report,
}: {
  packaging: PackagingComparisonData | null
  report: ScriptComparisonReport | null
}) {
  if (report) {
    return (
      <ScriptComparison
        report={report}
        higherViewsSide={packaging?.higherViewsSide ?? null}
      />
    )
  }

  return (
    <MissingReportCard>
      No script read is stored for these two videos. It is written from both
      videos&apos; transcripts when the comparison is generated, so re-open this
      pair from the Video Comparator to fill it in. Re-opening a pair you have
      already paid for is free.
    </MissingReportCard>
  )
}

// The Packaging tab body, rendered straight from what is stored. Nothing is
// generated here.
function PackagingComparisonSection({
  packaging,
  report,
}: {
  packaging: PackagingComparisonData | null
  report: PackagingComparisonReport | null
}) {
  if (packaging) {
    return <PackagingComparison data={packaging} report={report} />
  }

  return (
    <MissingReportCard>
      No packaging read is stored for these two videos. It is written from both
      thumbnails, titles and hooks when the comparison is generated, so
      re-open this pair from the Video Comparator to fill it in. Re-opening a
      pair you have already paid for is free.
    </MissingReportCard>
  )
}

async function loadReport(
  userId: string,
  requestedA: string | undefined,
  requestedB: string | undefined,
): Promise<ReportResult> {
  try {
    const entitlement = await getEntitlement(userId)
    if (entitlement.plan.deepCreditsPerMonth <= 0) return { status: "locked" }
  } catch (error) {
    console.error("Failed to resolve plan for comparison report", error)
    return { status: "locked" }
  }

  try {
    const supabase = await createClient()
    const videos = await listComparableVideos(supabase, userId)
    const active = await loadActiveComparison(
      supabase,
      userId,
      videos,
      requestedA,
      requestedB,
    )
    if (active == null) return { status: "not_found" }
    return { status: "ok", active }
  } catch (error) {
    console.error("Failed to load comparison report", error)
    return { status: "error" }
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function reportHeading(active: ActiveComparison): string {
  const a = active.data.a.summary.title ?? "Untitled video"
  const b = active.data.b.summary.title ?? "Untitled video"
  return `${a} vs ${b}`
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAuthenticatedUser()
  const params = await searchParams
  const result = await loadReport(user.id, first(params.a), first(params.b))

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
                <BreadcrumbLink href="/dashboard/video-comparator">
                  Video Comparator
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Comparison Report</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <Link
            href="/dashboard/video-comparator"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Back to Video Comparator
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {result.status === "ok"
              ? reportHeading(result.active)
              : "Comparison Report"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How these two videos&apos; packaging compares, and what each script
            does differently.
          </p>
        </div>

        {result.status === "ok" && (
          <>
            <RetentionComparisonVideos data={result.active.data} />
            <VideoComparisonTabs
              packaging={
                <PackagingComparisonSection
                  packaging={result.active.packaging}
                  report={result.active.packagingReport}
                />
              }
              script={
                <ScriptComparisonSection
                  packaging={result.active.packaging}
                  report={result.active.scriptReport}
                />
              }
            />
          </>
        )}
        {result.status === "not_found" && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <div>
              <h2 className="text-base font-semibold">
                We couldn&apos;t find that report
              </h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                This comparison has not been generated yet, or the link points
                at videos that are no longer available. Head back to the Video
                Comparator to pick two videos and generate a report.
              </p>
            </div>
            <Link
              href="/dashboard/video-comparator"
              className={buttonVariants()}
            >
              Back to Video Comparator
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
              <p className="mt-1 text-sm text-muted-foreground">
                On Starter and Pro, any two analysed videos can be compared side
                by side: where their retention curves diverge, how their hooks
                stack up, and the event evidence for what happened in each
                stretch.
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
