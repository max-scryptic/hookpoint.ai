import { Loader2Icon } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
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

// Shown automatically while the server component for a video renders — i.e.
// while we fetch the video's details and audience retention from YouTube. The
// shell mirrors the analysis page so navigating in doesn't flash an empty
// screen, and the popup reassures the user that work is happening behind the
// scenes during what can be a slow request.
export default async function Loading() {
  const defaultOpen = await getSidebarDefaultOpen()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
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
                  <BreadcrumbLink href="/dashboard/analyse-video">
                    Analyse Video
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
        <div className="relative flex flex-1 flex-col gap-4 p-4 pt-0">
          {/* Backdrop + centred popup so the user knows analysis is underway. */}
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div
              role="status"
              aria-live="polite"
              className="mx-4 flex w-full max-w-sm flex-col items-center gap-4 rounded-xl bg-card p-6 text-center shadow-lg ring-1 ring-foreground/10"
            >
              <Loader2Icon className="size-8 animate-spin text-primary" />
              <div className="space-y-1">
                <p className="font-heading text-base font-medium">
                  Analysing your video
                </p>
                <p className="text-sm text-muted-foreground">
                  We&apos;re fetching the audience retention data from YouTube.
                  This can take a moment — please wait.
                </p>
              </div>
              {/* Indeterminate bar: the request duration is unknown, so we loop
                  a sliding sliver rather than fake a percentage. */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/4 rounded-full bg-primary animate-indeterminate-progress" />
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
