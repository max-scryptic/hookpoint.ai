import { AnalyseVideoForm } from "@/components/analyse-video-form"
import { ConnectYouTubeButton } from "@/components/connect-youtube-button"
import { VideoBrowser } from "@/components/video-browser"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { listAnalysedVideoIds } from "@/lib/analysed-videos"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  getRecentVideos,
  type RecentVideosPage,
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
import { SidebarTrigger } from "@/components/ui/sidebar"

type VideosResult =
  | { status: "ok"; page: RecentVideosPage }
  | { status: "reconnect" }
  | { status: "error" }

async function loadRecentVideos(userId: string): Promise<VideosResult> {
  try {
    const accessToken = await getGoogleAccessToken(userId)
    const page = await getRecentVideos(accessToken)
    return { status: "ok", page }
  } catch (error) {
    if (error instanceof ReconsentRequiredError) {
      return { status: "reconnect" }
    }
    console.error("Failed to load recent YouTube videos", error)
    return { status: "error" }
  }
}

// Best-effort fetch of the user's analysed video IDs. The list still renders if
// this fails — videos just won't be flagged as analysed.
async function loadAnalysedVideoIds(userId: string): Promise<string[]> {
  try {
    const supabase = await createClient()
    return await listAnalysedVideoIds(supabase, userId)
  } catch (error) {
    console.error("Failed to load analysed video ids", error)
    return []
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const [result, analysedVideoIds] = await Promise.all([
    loadRecentVideos(user.id),
    loadAnalysedVideoIds(user.id),
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
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Analyse Video</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Analyse Video
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a video URL from your channel, or pick one of your recent
            uploads below.
          </p>
        </div>

        {result.status === "ok" && (
          <>
            <AnalyseVideoForm />
            <div className="mt-4 flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Your Videos
              </h2>
              <VideoBrowser
                initial={result.page}
                analysedVideoIds={analysedVideoIds}
              />
            </div>
          </>
        )}

        {result.status === "reconnect" && (
          <div className="flex flex-col items-start gap-3 rounded-xl border bg-muted/30 p-8">
            <div>
              <p className="font-medium">Connect your YouTube account</p>
              <p className="mt-1 text-sm text-muted-foreground">
                We need access to your YouTube account to show your videos and
                analyze retention.
              </p>
            </div>
            <ConnectYouTubeButton />
          </div>
        )}

        {result.status === "error" && (
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            We couldn&apos;t load your videos right now. Please try again later.
          </div>
        )}
      </div>
    </>
  )
}
