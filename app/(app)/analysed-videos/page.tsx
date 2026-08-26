import { AnalysedVideoBrowser } from "@/components/analysed-video-browser"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { listAnalysedVideos, type AnalysedVideo } from "@/lib/analysed-videos"
import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import {
  getVideoProcessingStatus,
  type VideoProcessingStatus,
} from "@/lib/retention-window-media-progress"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

type AnalysedVideosResult =
  | { status: "ok"; videos: AnalysedVideo[] }
  | { status: "error" }

async function loadAnalysedVideos(
  userId: string,
): Promise<AnalysedVideosResult> {
  try {
    const supabase = await createClient()
    // Bring every row's view/comment counts and KPI totals up to date before
    // reading them, so the table prints today's numbers rather than the ones
    // each video had when it was analysed. Throttled and best-effort - most
    // loads skip the YouTube round-trip entirely, and a failure just serves the
    // last numbers we have.
    await refreshAnalysedVideoStats(supabase, userId)
    const videos = await listAnalysedVideos(supabase, userId)
    return { status: "ok", videos }
  } catch (error) {
    console.error("Failed to load analysed videos", error)
    return { status: "error" }
  }
}

// Best-effort fetch of which analysed videos have a raw source file and which of
// those are still being deep-analysed. Returns the YouTube video IDs whose raw
// file has finished uploading (used to flag rows with the "uploaded" tick) and
// the subset still processing post-upload (used to show a "Processing…"
// indicator instead of the tick). The list still renders if this fails - videos
// just won't be flagged. The browser polls the same read
// (/api/videos/processing-status) onwards from this snapshot, so rows settle
// without a reload as each pipeline finishes.
async function loadRawFileStatuses(
  userId: string,
): Promise<VideoProcessingStatus> {
  try {
    const supabase = await createClient()
    return await getVideoProcessingStatus(supabase, userId)
  } catch (error) {
    console.error("Failed to load raw source file statuses", error)
    return { rawFileVideoIds: [], processingVideoIds: [] }
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const [result, { rawFileVideoIds, processingVideoIds }] = await Promise.all([
    loadAnalysedVideos(user.id),
    loadRawFileStatuses(user.id),
  ])

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
              <BreadcrumbItem>
                <BreadcrumbPage>Analysed Videos</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Analysed Videos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every video you&apos;ve analysed. Open one to revisit its retention
            analysis without re-spending API quota.
          </p>
        </div>

        {result.status === "ok" && (
          <AnalysedVideoBrowser
            videos={result.videos}
            rawFileVideoIds={rawFileVideoIds}
            processingVideoIds={processingVideoIds}
          />
        )}

        {result.status === "error" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            We couldn&apos;t load your analysed videos right now. Please try
            again later.
          </div>
        )}
      </div>
    </>
  )
}
