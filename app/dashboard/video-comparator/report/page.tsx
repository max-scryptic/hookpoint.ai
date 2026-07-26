import Link from "next/link"
import { ArrowLeftIcon, LockIcon } from "lucide-react"

import { PackagingComparison } from "@/components/packaging-comparison"
import { ScriptComparison } from "@/components/script-comparison"
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
  getScriptComparison,
  type ScriptComparison as ScriptComparisonData,
} from "@/lib/script-comparison"
import {
  buildAndStoreScriptComparisonReport,
  type ScriptComparisonReport,
} from "@/lib/script-comparison-report"
import {
  getRetentionComparison,
  listComparableVideos,
  type ComparableVideo,
  type RetentionComparisonData,
} from "@/lib/retention-comparison"
import {
  findSavedComparison,
  getScriptComparisonReport,
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
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// The written script report can take a moment to generate on the rare lazy
// backfill path (a comparison created before this feature, or one whose report
// generation failed at creation), so give the page the same headroom the
// analysis routes use.
export const maxDuration = 300

type ActiveComparison = {
  a: string
  b: string
  data: RetentionComparisonData
  packaging: PackagingComparisonData | null
  script: ScriptComparisonData | null
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

  // Packaging and script both ride on the same stored analysis; a failure or
  // gap in either must never cost the user the retention comparison, so both
  // are best-effort.
  const [data, packaging, initialScript, storedReport] = await Promise.all([
    getRetentionComparison(supabase, userId, requestedA, requestedB),
    getPackagingComparison(supabase, userId, requestedA, requestedB).catch(
      (error) => {
        console.error("Failed to load packaging comparison", error)
        return null
      },
    ),
    getScriptComparison(supabase, userId, requestedA, requestedB).catch(
      (error) => {
        console.error("Failed to load script comparison", error)
        return null
      },
    ),
    getScriptComparisonReport(supabase, userId, saved.id).catch((error) => {
      console.error("Failed to load script comparison report", error)
      return null
    }),
  ])
  if (data == null) return null

  // A comparison generated before the written report existed (or one whose
  // report generation failed at creation) has no stored report. Regenerate it
  // once, lazily, and store it so the next open is instant. This also backfills
  // each video's script taxonomy, so re-read the tables afterward to pick that
  // up. Best-effort: the rest of the report still renders if this fails.
  let script = initialScript
  let scriptReport = storedReport
  if (scriptReport == null) {
    try {
      scriptReport = await buildAndStoreScriptComparisonReport(
        supabase,
        userId,
        saved.id,
        requestedA,
        requestedB,
        { userId },
      )
      script = await getScriptComparison(
        supabase,
        userId,
        requestedA,
        requestedB,
      ).catch(() => initialScript)
    } catch (error) {
      console.error("Failed to backfill script comparison report", error)
    }
  }

  return { a: requestedA, b: requestedB, data, packaging, script, scriptReport }
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
            Where these two videos&apos; retention curves diverge, how their
            hooks compare, and the evidence behind each stretch.
          </p>
        </div>

        {result.status === "ok" && (
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
                    Open each video&apos;s analysis to generate one, then this
                    tab fills in.
                  </Card>
                )
              }
              script={
                result.active.script || result.active.scriptReport ? (
                  <ScriptComparison
                    data={result.active.script}
                    report={result.active.scriptReport}
                  />
                ) : (
                  <Card className="p-6 text-sm text-muted-foreground">
                    No script read is available for these two videos yet. It is
                    generated from both videos&apos; transcripts when the
                    comparison is created, and will fill in shortly.
                  </Card>
                )
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
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
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
