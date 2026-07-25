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

// Loading boundary for /dashboard/video-comparator/report. Renders this page's
// own header, breadcrumbs and side-by-side placeholders so the swap to the real
// report is seamless rather than flashing the parent chrome.
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
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard/video-comparator">
                  Video Comparator
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Comparison Report</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-8 w-80 max-w-full" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-5">
            <Skeleton className="h-28 w-full" />
          </Card>
          <Card className="p-5">
            <Skeleton className="h-28 w-full" />
          </Card>
        </div>
        <Skeleton className="h-9 w-72 max-w-full" />
        <Card className="p-5">
          <Skeleton className="h-64 w-full" />
        </Card>
      </div>
    </>
  )
}
