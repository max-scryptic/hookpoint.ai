import { AppSidebar } from "@/components/app-sidebar"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

// Shared shell for every /dashboard route. Keeping the sidebar provider, the
// sidebar itself and the inset here — rather than re-declaring them in each
// page — means Next.js preserves them across navigations: clicking between tabs
// only swaps the page content instead of tearing down and rebuilding the whole
// shell every time. Auth is enforced once here so individual pages don't each
// repeat the check.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuthenticatedUser()
  const defaultOpen = await getSidebarDefaultOpen()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
