import { AppSidebar } from "@/components/app-sidebar"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { NotificationAlerts } from "@/components/notification-alerts"

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
      <SidebarInset>{children}</SidebarInset>
      <NotificationAlerts />
    </SidebarProvider>
  )
}
