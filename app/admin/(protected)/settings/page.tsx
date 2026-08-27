import { AdminSettingsAppearance } from "@/components/admin/admin-settings-appearance"
import {
  AdminSettingsDemoData,
  type DemoDataUserOption,
} from "@/components/admin/admin-settings-demo-data"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireAdminUser } from "@/lib/admin/auth"
import { listUsers } from "@/lib/admin/users"

// The demo-data tab lists accounts to seed into, and the list is per-request
// admin data behind an auth check, so this page must never be prerendered.
export const dynamic = "force-dynamic"

// Admin settings: the Appearance (light/dark/system) toggle the front-end
// /settings screen also exposes, plus the demo-data controls, which are admin
// only and have no front-end equivalent. The admin layout already provides the
// sidebar, header and breadcrumb chrome, so this page only renders the body.
export default async function AdminSettingsPage() {
  const admin = await requireAdminUser()

  // Best-effort: a failed lookup costs the account picker its options, not the
  // whole settings page. The admin's own account is always offered, since
  // seeding into yourself is the common case.
  let users: DemoDataUserOption[] = []
  try {
    users = (await listUsers()).map((user) => ({
      id: user.id,
      label: `${user.email}${user.isAdmin ? " (admin)" : ""}${
        user.id === admin.id ? " (you)" : ""
      }`,
    }))
  } catch (error) {
    console.error("Failed to list users for the demo-data picker", error)
    users = [{ id: admin.id, label: `${admin.email ?? "Your account"} (you)` }]
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <div className="text-2xl font-semibold tracking-normal">Settings</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage workspace preferences and display settings.
        </p>
      </div>
      <Tabs defaultValue="appearance" className="gap-6">
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="demo-data">Demo data</TabsTrigger>
        </TabsList>
        <TabsContent value="appearance">
          <AdminSettingsAppearance />
        </TabsContent>
        <TabsContent value="demo-data">
          <AdminSettingsDemoData users={users} currentAdminId={admin.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
