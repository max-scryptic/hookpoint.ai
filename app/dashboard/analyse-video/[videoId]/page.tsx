import Image from "next/image"

import { AppSidebar } from "@/components/app-sidebar"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
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
  type DropOff,
  type VideoDetails,
} from "@/lib/youtube/youtube"
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
  | { status: "ok"; video: VideoDetails; dropOffs: DropOff[] }
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
    // YouTube API quota on a video we've already looked at.
    const cached = await getAnalysedVideo(supabase, userId, videoId)
    if (cached?.videoDetails) {
      return {
        status: "ok",
        video: cached.videoDetails,
        dropOffs: cached.dropOffs ?? [],
      }
    }

    const accessToken = await getGoogleAccessToken(userId)

    const video = await getVideoDetails(accessToken, videoId)
    if (!video) return { status: "not_found" }

    const retention = await getAudienceRetention(accessToken, video)
    if (retention.length === 0) return { status: "no_data" }

    const dropOffs = detectDropOffs(retention)

    // Persist everything we fetched so future visits hit the cache above.
    try {
      await saveAnalysedVideo(supabase, { userId, video, retention, dropOffs })
    } catch (saveError) {
      // Saving is best-effort — never block showing the analysis on a DB write.
      console.error("Failed to save analysed video", saveError)
    }

    return { status: "ok", video, dropOffs }
  } catch (error) {
    if (error instanceof ReconsentRequiredError) {
      return { status: "reconnect" }
    }
    console.error("Failed to analyse video", error)
    return { status: "error" }
  }
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
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
                  <BreadcrumbLink href="/dashboard/analyse-video">
                    Analyse Video
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
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {result.video.thumbnailUrl && (
                  <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-64">
                    <Image
                      src={result.video.thumbnailUrl}
                      alt={result.video.title}
                      fill
                      sizes="256px"
                      className="object-cover"
                    />
                  </div>
                )}
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal">
                    {result.video.title}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Biggest audience drop-offs across this video.
                  </p>
                </div>
              </div>

              {result.dropOffs.length === 0 ? (
                <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
                  No sharp drop-offs detected — retention is fairly steady across
                  this video.
                </div>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {result.dropOffs.map((drop, index) => (
                    <li
                      key={`${drop.fromTimestampSeconds}-${index}`}
                      className="flex items-center justify-between gap-4 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="font-mono text-sm">
                          {formatTimestamp(drop.fromTimestampSeconds)} –{" "}
                          {formatTimestamp(drop.toTimestampSeconds)}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-destructive">
                        −{(drop.watchRatioDrop * 100).toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
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
