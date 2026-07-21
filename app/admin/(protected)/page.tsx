import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAdminStats } from "@/lib/admin/users"
import { ShieldCheckIcon, UsersIcon, VideoIcon } from "lucide-react"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

// Admin landing page: a small set of headline counts. Counts are best-effort —
// a failure here should still render the shell rather than 500 the whole area.
export default async function AdminDashboardPage() {
  let stats = { totalUsers: 0, totalAdmins: 0, totalAnalysedVideos: 0 }
  let statsError = false

  try {
    stats = await getAdminStats()
  } catch (error) {
    console.error("Failed to load admin stats", error)
    statsError = true
  }

  const cards = [
    { label: "Users", value: stats.totalUsers, icon: UsersIcon },
    { label: "Admins", value: stats.totalAdmins, icon: ShieldCheckIcon },
    { label: "Analysed videos", value: stats.totalAnalysedVideos, icon: VideoIcon },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of the Hookpoint.ai workspace.
        </p>
      </div>

      {statsError && (
        <p className="text-sm text-destructive">
          Some metrics could not be loaded. Check the server logs.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tabular-nums">
                  {card.value.toLocaleString()}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
