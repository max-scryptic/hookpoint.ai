import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"

export default async function NotificationsPage() {
  const [defaultOpen, user] = await Promise.all([
    getSidebarDefaultOpen(),
    requireAuthenticatedUser(),
  ])
  let showUpgradeToPro = false
  try {
    const entitlement = await getEntitlement(user.id)
    showUpgradeToPro = entitlement.planId === "free"
  } catch (error) {
    console.error("Failed to resolve sidebar plan", error)
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar showUpgradeToPro={showUpgradeToPro} user={user} />
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
              Updates from your video analyses, newest first.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            No notifications yet.
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
