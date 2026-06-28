import { AppSidebar } from "@/components/app-sidebar"
import { AnalysisProcessingGate } from "@/components/analysis-processing"
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

// Shown automatically while the analysed-video server component renders — i.e.
// while we fetch the video's details + retention from YouTube and run the AI
// analysis up front (see ./page.tsx). The shell mirrors that page so navigating
// in doesn't flash an empty screen, and the centred popup reassures the user
// that work is happening during what can be a slow request. Next swaps this for
// the finished page once it's ready, so the user lands on their report with no
// manual redirect.
//
// Kept fully synchronous (no cookies/await) so Next can treat it as an instant
// loading boundary — reading the sidebar cookie here would make the fallback
// dynamic and delay it, which showed up as a blank screen before the report
// swapped in. The sidebar just defaults to open for the brief loading state.
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
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard/analysed-videos">
                    Analysed Videos
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Analysing…</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0" />
      </SidebarInset>
      {/* Backdrop + centred popup, but only for a genuine fresh analysis
          (?analysing=1) — opening an already-analysed video skips it. */}
      <AnalysisProcessingGate />
    </SidebarProvider>
  )
}
