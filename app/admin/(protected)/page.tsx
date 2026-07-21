import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getAdminStats } from "@/lib/admin/users"
import {
  getDailyActiveUsers,
  getVideosAnalysedByDay,
  type DailyCountPoint,
  type VideosByDayPoint,
} from "@/lib/admin/activity"
import { AdminActivityCharts } from "@/components/admin/admin-activity-charts"
import {
  CoinsIcon,
  FileVideoIcon,
  ShieldCheckIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react"

// The full window of daily history loaded for the activity charts. The charts
// default to showing the most recent 30 days but let an admin pick any range
// within this window without another round-trip.
const CHART_WINDOW_DAYS = 180

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

// Admin landing page: a small set of headline counts. Counts are best-effort —
// a failure here should still render the shell rather than 500 the whole area.
export default async function AdminDashboardPage() {
  let stats = {
    totalUsers: 0,
    totalAdmins: 0,
    totalAnalysedVideos: 0,
    totalSourceFilesUploaded: 0,
    totalDeepCreditsUsed: 0,
  }
  let statsError = false

  let activeUsers: DailyCountPoint[] = []
  let videosByDay: VideosByDayPoint[] = []
  // Each chart tracks its own failure so one broken query only degrades its own
  // card instead of blanking both charts (and mislabelling the healthy one).
  let activeUsersError = false
  let videosError = false

  // The headline stats and the two time-series charts are independent
  // best-effort loads: a failure in any one of them logs and degrades that
  // section rather than 500-ing the whole dashboard.
  const [statsResult, activeUsersResult, videosResult] = await Promise.allSettled([
    getAdminStats(),
    getDailyActiveUsers(CHART_WINDOW_DAYS),
    getVideosAnalysedByDay(CHART_WINDOW_DAYS),
  ])

  if (statsResult.status === "fulfilled") {
    stats = statsResult.value
  } else {
    console.error("Failed to load admin stats", statsResult.reason)
    statsError = true
  }

  if (activeUsersResult.status === "fulfilled") {
    activeUsers = activeUsersResult.value
  } else {
    console.error("Failed to load daily active users", activeUsersResult.reason)
    activeUsersError = true
  }

  if (videosResult.status === "fulfilled") {
    videosByDay = videosResult.value
  } else {
    console.error("Failed to load videos analysed by day", videosResult.reason)
    videosError = true
  }

  const cards: {
    label: string
    hint?: string
    value: number
    icon: typeof UsersIcon
  }[] = [
    { label: "Users", value: stats.totalUsers, icon: UsersIcon },
    { label: "Admins", value: stats.totalAdmins, icon: ShieldCheckIcon },
    {
      label: "Videos analysed",
      hint: "Light analysis",
      value: stats.totalAnalysedVideos,
      icon: VideoIcon,
    },
    {
      label: "Source files uploaded",
      hint: "Deep analysis",
      value: stats.totalSourceFilesUploaded,
      icon: FileVideoIcon,
    },
    {
      label: "Deep-dive credits used",
      hint: "All users",
      value: stats.totalDeepCreditsUsed,
      icon: CoinsIcon,
    },
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
                {card.hint && (
                  <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <AdminActivityCharts
        activeUsers={activeUsers}
        videosByDay={videosByDay}
        activeUsersError={activeUsersError}
        videosError={videosError}
      />
    </div>
  )
}
