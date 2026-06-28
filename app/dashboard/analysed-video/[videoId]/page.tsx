import { AppSidebar } from "@/components/app-sidebar"
import { AnalysedVideoDetail } from "@/components/analysed-video-detail"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveAnalysedVideo,
} from "@/lib/analysed-videos"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  detectDropOffs,
  getAudienceRetention,
  getVideoDetails,
  getVideoTranscript,
  type DropOff,
  type RetentionPoint,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"
import type { VideoInsights } from "@/lib/ai/insights"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export const dynamic = "force-dynamic"

type AnalysisResult =
  | {
      status: "ok"
      video: VideoDetails
      retention: RetentionPoint[]
      dropOffs: DropOff[]
      transcript: TranscriptCue[]
      insights: VideoInsights | null
    }
  | { status: "not_found" }
  | { status: "no_data" }
  | { status: "reconnect" }
  | { status: "error" }

async function analyse(
  userId: string,
  videoId: string,
): Promise<AnalysisResult> {
  try {
    const supabase = await createClient()

    // Serve a previously-saved analysis when we have one, so we don't re-spend
    // YouTube API quota on a video we've already looked at. Gains are derived
    // from the stored curve on the fly, so older rows render them too.
    const cached = await getAnalysedVideo(supabase, userId, videoId)
    if (cached?.videoDetails && cached.retention) {
      return {
        status: "ok",
        video: cached.videoDetails,
        retention: cached.retention,
        dropOffs: cached.dropOffs ?? detectDropOffs(cached.retention),
        transcript: await healCachedTranscript(
          supabase,
          userId,
          videoId,
          cached.transcript,
        ),
        insights: cached.insights,
      }
    }

    const accessToken = await getGoogleAccessToken(userId)

    const video = await getVideoDetails(accessToken, videoId)
    if (!video) return { status: "not_found" }

    const retention = await getAudienceRetention(accessToken, video)
    if (retention.length === 0) return { status: "no_data" }

    const dropOffs = detectDropOffs(retention)
    // Best-effort: a missing or caption-less transcript must not fail the
    // analysis, so swallow errors and fall back to an empty transcript.
    const transcript = await getVideoTranscript(accessToken, videoId).catch(
      (transcriptError) => {
        console.error("Failed to fetch transcript", transcriptError)
        return [] as TranscriptCue[]
      },
    )

    // Persist everything we fetched so future visits hit the cache above.
    try {
      await saveAnalysedVideo(supabase, {
        userId,
        video,
        retention,
        dropOffs,
        transcript,
      })
    } catch (saveError) {
      // Saving is best-effort — never block showing the analysis on a DB write.
      console.error("Failed to save analysed video", saveError)
    }

    return { status: "ok", video, retention, dropOffs, transcript, insights: null }
  } catch (error) {
    if (error instanceof ReconsentRequiredError) {
      return { status: "reconnect" }
    }
    console.error("Failed to analyse video", error)
    return { status: "error" }
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ videoId: string }>
}) {
  const { videoId } = await params
  const user = await requireAuthenticatedUser()
  const [defaultOpen, result] = await Promise.all([
    getSidebarDefaultOpen(),
    analyse(user.id, videoId),
  ])

  const title = result.status === "ok" ? result.video.title : "Analysis"

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
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
                  <BreadcrumbLink href="/dashboard/analysed-videos">
                    Analysed Videos
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="max-w-[40ch] truncate">
                    {title}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {result.status === "ok" && (
            <AnalysedVideoDetail
              video={result.video}
              retention={result.retention}
              transcript={result.transcript}
              initialInsights={result.insights}
              aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
            />
          )}

          {result.status === "not_found" && (
            <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
              We couldn&apos;t find that video on YouTube.
            </div>
          )}

          {result.status === "no_data" && (
            <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
              No retention data available. Make sure this video is on the YouTube
              channel you signed in with and has enough views.
            </div>
          )}

          {result.status === "reconnect" && (
            <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
              Please reconnect your YouTube account to grant analytics access.
            </div>
          )}

          {result.status === "error" && (
            <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
              We couldn&apos;t analyse that video right now. Please try again
              later.
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
