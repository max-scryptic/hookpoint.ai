import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Loading boundary for /help. There is no ancestor boundary above it, so
// without this file the previous page would sit frozen on screen while the
// plan lookup resolved. The chrome here matches the loaded page exactly, so
// only the guide itself swaps in.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.
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
                <BreadcrumbPage>Help</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Help</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How the whole app works, in plain words. New here? Start at the top,
            or jump to a section.
          </p>
        </div>

        <div className="flex w-full flex-col gap-6">
          <div className="-mx-4 flex gap-2 border-b px-4 pb-3">
            {["w-24", "w-24", "w-28", "w-24", "w-20", "w-28", "w-16"].map(
              (width, index) => (
                <Skeleton key={index} className={`h-8 shrink-0 ${width}`} />
              ),
            )}
          </div>
          <div className="space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="space-y-3 rounded-xl border bg-card p-4"
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="space-y-3 rounded-xl border bg-card p-4"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
