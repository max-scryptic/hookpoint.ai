import type { ReactNode } from "react"
import { format } from "date-fns"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { AdminBreadcrumbLabel } from "@/components/admin/admin-breadcrumb-label"
import { PackagingComparison } from "@/components/packaging-comparison"
import {
  RetentionCurvesCard,
  RetentionComparisonVideos,
} from "@/components/retention-comparison"
import { RetentionHeadToHead } from "@/components/retention-head-to-head"
import { ScriptComparison } from "@/components/script-comparison"
import { VideoComparisonTabs } from "@/components/video-comparison-tabs"
import { Card } from "@/components/ui/card"
import { requireAdminUser } from "@/lib/admin/auth"
import { getUserById } from "@/lib/admin/users"
import { getUserVideoComparisonById } from "@/lib/admin/video-comparisons"
import { getPackagingComparison } from "@/lib/packaging-comparison"
import { getRetentionComparison } from "@/lib/retention-comparison"
import { createAdminClient } from "@/lib/supabase/admin"
import { getComparisonReports } from "@/lib/video-comparisons"

// Admin comparison detail: the full head-to-head for one pair a user has
// generated, rendered from exactly the same components the creator's own report
// page uses. Read-only, and nothing here generates: the two written reports come
// back as stored JSON and the retention and packaging diffs are derived from
// each video's stored analysis, so opening this page costs nothing and calls no
// model.
//
// Everything is loaded server-side with the service-role client (behind the
// admin auth check) and scoped to the owning user, so a mistyped or foreign id
// resolves to a 404 rather than surfacing another account's comparison.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// Per-request admin data behind an auth check - never statically prerender.
export const dynamic = "force-dynamic"

function formatDate(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, HH:mm")
}

// Shown in place of a tab body that has nothing stored behind it: a pair
// generated before that report existed, or one whose generation failed. Only
// the creator can fill it in, by re-opening the pair in the Video Comparator
// (which is free for a pair they have already paid for), so this states the
// gap rather than offering an admin-side fix.
function MissingReportCard({ children }: { children: ReactNode }) {
  return (
    <Card className="p-6">
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
    </Card>
  )
}

export default async function AdminUserComparisonDetailPage({
  params,
}: {
  params: Promise<{ userId: string; comparisonId: string }>
}) {
  const { userId, comparisonId } = await params

  await requireAdminUser()

  const [user, comparison] = await Promise.all([
    getUserById(userId),
    getUserVideoComparisonById(userId, comparisonId),
  ])
  if (!user || !comparison) {
    notFound()
  }

  const supabase = createAdminClient()

  // Which video is A and which is B comes from the stored row, the same way the
  // creator's report reads it: the written head-to-heads talk about "Video A"
  // and "Video B" throughout, so the tables underneath them have to be oriented
  // the way they were generated. Packaging is best-effort, since a failure or a
  // gap in it must not cost the retention comparison. The script tab is the
  // written report alone, so nothing is derived for it.
  const [data, packaging, reports] = await Promise.all([
    getRetentionComparison(supabase, userId, comparison.a.id, comparison.b.id),
    getPackagingComparison(
      supabase,
      userId,
      comparison.a.id,
      comparison.b.id,
    ).catch((error) => {
      console.error("Failed to load packaging comparison for admin", error)
      return null
    }),
    getComparisonReports(supabase, userId, comparison.id).catch((error) => {
      console.error("Failed to load stored comparison reports for admin", error)
      return { script: null, packaging: null, retention: null }
    }),
  ])

  const aTitle = comparison.a.title ?? "Untitled video"
  const bTitle = comparison.b.title ?? "Untitled video"
  const heading = `${aTitle} vs ${bTitle}`
  // Each side's arrow opens that video's admin analysis page rather than the
  // creator-facing one, which an admin has no access to.
  const videoHrefs = {
    a: `/admin/users/${userId}/videos/${comparison.a.id}`,
    b: `/admin/users/${userId}/videos/${comparison.b.id}`,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Feeds the header breadcrumb the pair as its trailing crumb. */}
      <AdminBreadcrumbLabel label={heading} />
      <div className="space-y-4">
        <Link
          href={`/admin/users/${userId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to {user.username}
        </Link>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">{heading}</h1>
          <p className="text-sm text-muted-foreground">
            Compared {formatDate(comparison.createdAt)}. The report this user
            sees: where the two curves diverge, how the packaging stacks up, and
            what each script does differently.
          </p>
        </div>
      </div>

      {data != null && (
        <RetentionComparisonVideos data={data} videoHrefs={videoHrefs} />
      )}

      <VideoComparisonTabs
        retention={
          data != null ? (
            reports.retention != null ? (
              // Tips here belong to the creator whose comparison this is, so
              // the keep and flag controls are left off the admin's read of it.
              <RetentionHeadToHead
                report={reports.retention}
                chart={<RetentionCurvesCard data={data} />}
                tipActions={false}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <MissingReportCard>
                  No written retention read is stored for these two videos. It
                  is written from both curves, both videos&apos; notable
                  stretches and what was said where the curves separated, when
                  the comparison is generated, so this pair either predates that
                  report or its generation failed. The curve below is derived on
                  every open.
                </MissingReportCard>
                <RetentionCurvesCard data={data} />
              </div>
            )
          ) : (
            <MissingReportCard>
              The retention comparison could not be rebuilt for this pair. It is
              derived from both videos&apos; stored analysis on every open, so
              one of the two videos has most likely been removed since the
              comparison was generated.
            </MissingReportCard>
          )
        }
        packaging={
          packaging != null ? (
            <PackagingComparison
              data={packaging}
              report={reports.packaging}
              tipActions={false}
            />
          ) : (
            <MissingReportCard>
              No packaging read is stored for these two videos. It is written
              from both thumbnails, titles and openings when the comparison is
              generated, so this pair either predates that report or its
              generation failed.
            </MissingReportCard>
          )
        }
        script={
          reports.script != null ? (
            <ScriptComparison
              report={reports.script}
              higherViewsSide={packaging?.higherViewsSide ?? null}
              tipActions={false}
            />
          ) : (
            <MissingReportCard>
              No script read is stored for these two videos. It is written from
              both videos&apos; transcripts when the comparison is generated, so
              this pair either predates that report or its generation failed.
            </MissingReportCard>
          )
        }
      />
    </div>
  )
}
