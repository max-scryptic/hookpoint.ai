import { VideoTableSkeleton } from "@/components/video-table-skeleton"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Shown while the analyse-video server component fetches the user's recent uploads
// from the YouTube API (the slowest load in the app). The static chrome -
// header, breadcrumb, title, description, the paste-URL row and "Your Videos"
// heading - matches the loaded page (app/(app)/analyse-video/page.tsx), so the
// page is visible immediately and only the table swaps from this skeleton to the
// real list once the fetch resolves.
export default function Loading() {
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
                <BreadcrumbPage>Analyse a Video</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Analyse a Video
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a video URL from your channel, or pick one of your recent
            uploads below.
          </p>
        </div>

        {/* Paste-URL row (input + submit button) */}
        <div className="flex items-start gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-10 w-32 shrink-0" />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Your Videos
          </h2>
          <VideoTableSkeleton />
        </div>
      </div>
    </>
  )
}
