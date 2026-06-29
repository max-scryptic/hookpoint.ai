import { AnalysedVideoBrowser } from "@/components/analysed-video-browser"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { listAnalysedVideos, type AnalysedVideo } from "@/lib/analysed-videos"
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

type AnalysedVideosResult =
  | { status: "ok"; videos: AnalysedVideo[] }
  | { status: "error" }

async function loadAnalysedVideos(
  userId: string,
): Promise<AnalysedVideosResult> {
  try {
    const supabase = await createClient()
    const videos = await listAnalysedVideos(supabase, userId)
    return { status: "ok", videos }
  } catch (error) {
    console.error("Failed to load analysed videos", error)
    return { status: "error" }
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const result = await loadAnalysedVideos(user.id)

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
          <AnalysedVideoBrowser videos={result.videos} />
        )}

        {result.status === "error" && (
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            We couldn&apos;t load your analysed videos right now. Please try
            again later.
          </div>
        )}
      </div>
    </>
  )
}
