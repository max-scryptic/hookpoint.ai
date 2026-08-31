import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Loading boundary for /video-planner. There is no ancestor boundary above it
// to fall back on, so without this file the previous page would stay frozen on
// screen until the planner resolved. The page's own reads are its plan list and
// its entitlement, so the chrome and the heading are drawn for real and only
// the list of planned videos below them is stood in for.
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
                <BreadcrumbPage>Video Planner</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Video Planner
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your packaging before it goes live. Every video you are
            planning is here: open one to add the cut, the titles you are
            weighing up and the thumbnail, and we will tell you which title fits
            and what to change.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Planned videos
            </h2>
            <Skeleton className="h-9 w-32" />
          </div>

          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="aspect-video w-24 shrink-0 sm:w-28" />
                <Skeleton className="h-4 w-full max-w-sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
