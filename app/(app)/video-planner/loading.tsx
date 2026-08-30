import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Loading boundary for /video-planner. There is no ancestor boundary above it
// to fall back on, so without this file the previous page would stay frozen on
// screen until the planner resolved. The page's own reads are its plan list and
// its entitlement, so the chrome and the heading are drawn for real and only
// the three builder cards below them are stood in for.
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
            Check your packaging before it goes live. Upload the cut, enter the
            titles you are weighing up, add the thumbnail, and we will tell you
            which title fits and what to change.
          </p>
        </div>

        {[0, 1, 2].map((index) => (
          <Card key={index} className="gap-4 p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-9 w-44" />
          </Card>
        ))}
      </div>
    </>
  )
}
