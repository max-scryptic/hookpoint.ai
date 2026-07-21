import { format } from "date-fns"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"

import { DeepAnalysisEvidence } from "@/components/deep-analysis-evidence"
import { requireAdminUser } from "@/lib/admin/auth"
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

// Admin video detail: the full deep-analysis evidence for a single video a user
// has analysed — every synthesized retention-window event plus the raw signals
// behind them (transcript, snapshots, audio, editing metrics and cost). This is
// the same breakdown the front-end deep-analysis section renders, read-only, so
// admins retain full oversight once those panels are hidden from users. All data
// is loaded server-side via the service-role client (behind the admin auth
// check), scoped to the video's owning user.
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

  let evidence: Awaited<ReturnType<typeof getDeepAnalysisEvidence>> | null = null
  try {
    evidence = await getDeepAnalysisEvidence(
      supabase,
      userId,
      video.id,
      transcodedDurationSeconds,
    )
  } catch (error) {
    console.error("Failed to load deep analysis evidence for admin", error)
  }

  const eventCount =
    evidence?.windows.reduce((sum, window) => sum + window.events.length, 0) ?? 0
  const hasEvidence = Boolean(evidence && evidence.windows.length > 0)

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

      {hasEvidence && evidence ? (
        <DeepAnalysisEvidence evidence={evidence} videoId={video.id} readOnly />
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No deep-analysis evidence has been generated for this video yet. Events
          and their supporting signals appear here once the user has uploaded a
          source file and the deep-analysis pipeline has run.
        </p>
      )}
    </div>
  )
}
