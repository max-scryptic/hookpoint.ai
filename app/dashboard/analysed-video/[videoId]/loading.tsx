import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

// Shown briefly while the analysed-video server component renders. By the time a
// user reaches this route the analysis has already run (the Analyse Video form
// awaits /api/analyze before navigating) or the video was analysed previously,
// so this is a fast cache read — we just want a neutral skeleton that mirrors the
// report layout, never an "analysing" state, so opening an already-analysed video
// slides straight into the finished UI.
//
// Kept fully synchronous (no cookies/await) so Next can treat it as an instant
// loading boundary — reading the sidebar cookie here would make the fallback
// dynamic and delay it. The sidebar just defaults to open for the brief state.
export default function Loading() {
  return (
    <SidebarProvider>
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
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Skeleton className="h-7 w-2/3 max-w-md" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
