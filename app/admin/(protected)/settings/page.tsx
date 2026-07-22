import { AdminSettingsAppearance } from "@/components/admin/admin-settings-appearance"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Admin settings, mirroring the front-end /settings screen but scoped to the one
// thing admins need here: the Appearance (light/dark/system) toggle. The admin
// layout already provides the sidebar, header and breadcrumb chrome, so this
// page only renders the settings body.
export default function AdminSettingsPage() {
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
        </TabsList>
        <TabsContent value="appearance">
          <AdminSettingsAppearance />
        </TabsContent>
      </Tabs>
    </div>
  )
}
