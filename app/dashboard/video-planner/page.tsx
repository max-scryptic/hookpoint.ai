import { ClapperboardIcon } from "lucide-react"

import { requireAuthenticatedUser } from "@/lib/auth"
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
import { SidebarTrigger } from "@/components/ui/sidebar"

export default async function Page() {
  await requireAuthenticatedUser()

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
                <BreadcrumbPage>Video Planner</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Video Planner
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan your next upload before it goes live on YouTube.
          </p>
        </div>

        <Card className="flex flex-col items-start gap-3 p-6">
          <ClapperboardIcon className="size-5 text-muted-foreground" />
          <div className="w-full">
            <p className="text-sm text-muted-foreground">
              Video Planner is coming soon to{" "}
              <span className="font-semibold text-foreground">
                Starter and Pro
              </span>{" "}
              users.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Upload a video before it goes live on YouTube, and we&apos;ll
              combine your channel trends, retention events, and more to predict
              which sections are likely to drop or gain retention, so you can
              make edits before you publish.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
