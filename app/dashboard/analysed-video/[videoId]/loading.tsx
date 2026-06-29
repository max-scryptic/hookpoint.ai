import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Shown briefly while the analysed-video server component renders. By the time a
// user reaches this route the analysis has already run (the Analyse Video form
// awaits /api/analyze before navigating) or the video was analysed previously,
// so this is a fast cache read — we just want a neutral skeleton that mirrors the
// report layout, never an "analysing" state, so opening an already-analysed video
// slides straight into the finished UI.
//
// The sidebar shell lives in app/dashboard/layout.tsx and stays mounted across
// navigations, so this boundary only fills the inset with the content skeleton.
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
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbLink href="/dashboard/analysed-videos">
                  Analysed Videos
                </BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        {/* Thumbnail + title */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Skeleton className="aspect-video w-full shrink-0 rounded-xl sm:w-64" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-7 w-2/3 max-w-md" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
        </div>

        {/* Audience retention chart */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>

        {/* Hook card */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>

        {/* Biggest drop-offs */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </>
  )
}
