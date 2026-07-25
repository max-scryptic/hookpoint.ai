import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Loading boundary for /dashboard/video-comparator. Without this file,
// navigating here would fall back to the parent dashboard skeleton
// (app/dashboard/loading.tsx), flashing the "Dashboard" chrome before the
// Video Comparator appears. We render this page's own header, picker row and
// chart placeholder so the swap to the real page is seamless.
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
                <BreadcrumbPage>Video Comparator</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Video Comparator
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Put any two uploads head to head: where their retention curves
            diverge, how the hooks compare, and the evidence behind each
            stretch.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="mx-auto size-9 shrink-0" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Card className="p-5">
          <Skeleton className="h-64 w-full" />
        </Card>
      </div>
    </>
  )
}
