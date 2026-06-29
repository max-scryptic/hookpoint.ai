import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default function Page() {
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

        <div className="flex flex-col items-start gap-3 rounded-xl border bg-muted/30 p-8">
          <div>
            <p className="font-medium">Analyse a video</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick one of your recent uploads or paste a video URL to see its
              audience retention.
            </p>
          </div>
          <Link href="/dashboard/analyse-video" className={buttonVariants()}>
            Analyse Video
          </Link>
        </div>
      </div>
    </>
  )
}
