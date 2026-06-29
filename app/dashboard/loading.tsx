import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Loading boundary for the dashboard index. The index loads KPI totals, so we
// show a placeholder for the cards region while that resolves; whether the page
// ultimately renders the KPI cards or the blank-slate prompt, this stays close
// enough to avoid a jarring swap. Child routes (analyse-video, analysed-videos,
// analysed-video) define their own loading.tsx for their data regions. The
// sidebar shell in app/dashboard/layout.tsx stays mounted across navigations.
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
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back. Analyse your YouTube videos to find where viewers
            drop off.
          </p>
        </div>

        <Card>
          <CardHeader className="border-b">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Skeleton className="size-16 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 max-w-xl" />
            </div>
            <Skeleton className="hidden h-16 w-72 md:block" />
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} size="sm">
              <CardHeader>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1 h-7 w-16" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}
