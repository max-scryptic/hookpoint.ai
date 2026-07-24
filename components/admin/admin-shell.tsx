"use client"

import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb"
import { AdminBreadcrumbProvider } from "@/components/admin/admin-breadcrumb-context"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

// Chrome for the authenticated admin area. Uses the same collapsible Sidebar
// primitives as the main app (see AppSidebar / DashboardLayout) so the two
// surfaces share one look and the icon-collapse behaviour. The sidebar owns the
// admin nav and sign-out; the header carries the collapse trigger and the same
// route breadcrumb the front-end shows above every dashboard page.
export function AdminShell({
  adminEmail,
  defaultOpen,
  children,
}: {
  adminEmail: string | null
  defaultOpen: boolean
  children: React.ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AdminSidebar adminEmail={adminEmail} />
      <SidebarInset>
        {/* Wraps the header and the page so a page can publish a dynamic
            trailing crumb (e.g. a video title) the header reads. */}
        <AdminBreadcrumbProvider>
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <AdminBreadcrumb />
            </div>
          </header>
          <main className="flex-1 p-4 pt-0 md:p-6 md:pt-0">{children}</main>
        </AdminBreadcrumbProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}
