import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { BellIcon } from "lucide-react"

export default function NotificationsPage() {
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
                <BreadcrumbPage>Notifications</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Updates about your analyses and account will appear here.
          </p>
        </div>

        <Card className="bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex size-10 items-center justify-center rounded-full border bg-background">
              <BellIcon className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">You&apos;re all caught up</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You don&apos;t have any notifications right now.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
