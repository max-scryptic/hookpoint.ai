import { VideoTableSkeleton } from "@/components/video-table-skeleton"
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

// Shown while the analysed-videos server component fetches the list. The static
// chrome here — header, breadcrumb, title and description — is identical to the
// loaded page (app/dashboard/analysed-videos/page.tsx), so on navigation the page
// appears fully formed straight away and only the table region swaps from this
// skeleton to the real data once the fetch resolves. The sidebar shell lives in
// app/dashboard/layout.tsx and stays mounted across navigations.
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

        <VideoTableSkeleton />
      </div>
    </>
  )
}
