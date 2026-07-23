import { format } from "date-fns"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"

import { AdminVideoAnalysisDetail } from "@/components/admin/admin-video-analysis-detail"
import { requireAdminUser } from "@/lib/admin/auth"
import { getAnalysisCostBreakdown } from "@/lib/admin/analysis-cost-breakdown"
import { getLightAnalysisEvidence } from "@/lib/admin/light-analysis-evidence"
import { getUserById } from "@/lib/admin/users"
import { getUserAnalysedVideoById } from "@/lib/admin/video-analysis"
import { getDeepAnalysisEvidence } from "@/lib/deep-analysis-evidence"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import { createAdminClient } from "@/lib/supabase/admin"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

function formatDate(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, HH:mm")
}

// Admin video detail: the full evidence for a single video a user has analysed,
// split into Light Analysis and Deep Analysis tabs. Each tab leads with the
// cost KPIs for that bucket and then every piece of data the pipeline captured
// for it — the light reads (pacing, packaging + its categorical taxonomy,
// retention attribution) and the deep per-window signals (transcript,
// snapshots, audio, editing metrics and synthesized events). This is the same
// breakdown the front end renders, read-only, so admins retain full oversight
// of everything we capture about the video. All data is loaded server-side via
// the service-role client (behind the admin auth check), scoped to the owning
// user.
export default async function AdminUserVideoDetailPage({
  params,
}: {
  params: Promise<{ userId: string; videoId: string }>
}) {
  const { userId, videoId } = await params

  await requireAdminUser()

  const [user, video] = await Promise.all([
    getUserById(userId),
    getUserAnalysedVideoById(userId, videoId),
  ])
  // A missing user, a missing video, or a video that belongs to another account
  // (the lookup is user-scoped) all resolve to a 404 rather than leaking a
  // foreign video into this user's view.
  if (!user || !video) {
    notFound()
  }

  const supabase = createAdminClient()

  // Mirror the front-end's transcoding-cost attribution: the one-time Qencode
  // transcoding cost is only charged when the source was actually transcoded
  // (normalisation ready). Best-effort — a source-file lookup failure just
  // omits the transcoding line rather than sinking the evidence view.
  let transcodedDurationSeconds: number | null = null
  try {
    const sourceFile = await getSourceFileForVideo(supabase, userId, video.videoId)
    if (sourceFile?.normalisationStatus === "ready") {
      transcodedDurationSeconds = video.durationSeconds
    }
  } catch (error) {
    console.error("Failed to load source file for admin video detail", error)
  }

  // The light reads, the deep per-window evidence and the authoritative cost
  // breakdown, loaded together. Deep evidence is best-effort (a failure leaves
  // the deep tab showing its empty state rather than sinking the page); the
  // light-evidence and cost helpers already degrade to nulls/zeroes internally.
  const [costs, lightEvidence, deepEvidence] = await Promise.all([
    getAnalysisCostBreakdown(userId, video.id),
    getLightAnalysisEvidence(supabase, userId, video.id),
    getDeepAnalysisEvidence(
      supabase,
      userId,
      video.id,
      transcodedDurationSeconds,
    ).catch((error) => {
      console.error("Failed to load deep analysis evidence for admin", error)
      return null
    }),
  ])

  const eventCount =
    deepEvidence?.windows.reduce(
      (sum, window) => sum + window.events.length,
      0,
    ) ?? 0

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Link
          href={`/admin/users/${userId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to {user.username}
        </Link>

        <div className="space-y-2">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-normal">
            {video.title}
            <a
              href={`https://www.youtube.com/watch?v=${video.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open on YouTube"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLinkIcon className="size-4" />
            </a>
          </h1>
          <p className="text-sm text-muted-foreground">
            Analysed {formatDate(video.dateAnalysed)} · {eventCount} event
            {eventCount === 1 ? "" : "s"} generated
          </p>
        </div>
      </div>

      <AdminVideoAnalysisDetail
        videoId={video.id}
        costs={costs}
        lightEvidence={lightEvidence}
        deepEvidence={deepEvidence}
      />
    </div>
  )
}
