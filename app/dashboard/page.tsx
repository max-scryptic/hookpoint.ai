import { AppSidebar } from "@/components/app-sidebar"
import { ConnectYouTubeButton } from "@/components/connect-youtube-button"
import { RecentVideos } from "@/components/recent-videos"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import { getRecentVideos, type RecentVideo } from "@/lib/youtube/youtube"
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

type VideosResult =
  | { status: "ok"; videos: RecentVideo[] }
  | { status: "reconnect" }
  | { status: "error" }

async function loadRecentVideos(userId: string): Promise<VideosResult> {
  try {
    const accessToken = await getGoogleAccessToken(userId)
    const videos = await getRecentVideos(accessToken)
    return { status: "ok", videos }
  } catch (error) {
    if (error instanceof ReconsentRequiredError) {
      return { status: "reconnect" }
    }
    console.error("Failed to load recent YouTube videos", error)
    return { status: "error" }
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const [defaultOpen, result] = await Promise.all([
    getSidebarDefaultOpen(),
    loadRecentVideos(user.id),
  ])

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
                  <BreadcrumbLink href="#">
                    Hookpoint.ai
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Recent videos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your most recent uploads from YouTube.
            </p>
          </div>

          {result.status === "ok" && <RecentVideos videos={result.videos} />}

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
      </SidebarInset>
    </SidebarProvider>
  )
}
