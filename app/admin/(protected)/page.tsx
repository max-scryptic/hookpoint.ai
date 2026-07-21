import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getAdminStats } from "@/lib/admin/users"
import { getTotalCostUsd } from "@/lib/admin/llm-calls"
import { getTotalRevenue, type UserRevenue } from "@/lib/stripe/invoices"
import {
  getDailyActiveUsers,
  getVideosAnalysedByDay,
  type DailyCountPoint,
  type VideosByDayPoint,
} from "@/lib/admin/activity"
import { AdminActivityCharts } from "@/components/admin/admin-activity-charts"
import { formatGbp } from "@/lib/plans"
import {
  BanknoteIcon,
  CoinsIcon,
  FileVideoIcon,
  ReceiptIcon,
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

// Total revenue across the whole app, formatted in the currency Stripe billed
// in (GBP expected). "error" means the Stripe lookup failed and the figure is
// unknown; a zero/absent history renders as £0.00.
function formatMoneyMade(revenue: UserRevenue | "error"): string {
  if (revenue === "error") return "—"
  const currency = (revenue.currency ?? "gbp").toUpperCase()
  if (currency === "GBP") return formatGbp(revenue.totalMinorUnits)
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    revenue.totalMinorUnits / 100,
  )
}

// Matches the per-user detail page: enough precision for sub-cent figures
// without trailing noise on larger totals. "error" renders as an em dash.
function formatUsd(value: number | "error"): string {
  if (value === "error") return "—"
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// One headline metric card. Numbers are localised; pre-formatted strings (e.g.
// currency) pass through unchanged.
function KpiCard({
  label,
  hint,
  value,
  icon: Icon,
}: {
  label: string
  hint?: string
  value: number | string
  icon: typeof UsersIcon
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

// Admin landing page: headline counts grouped into Users, Video analysis and
// Economics, plus the activity charts. Every load is best-effort — a failure in
// any one section degrades that section rather than 500-ing the whole area.
export default async function AdminDashboardPage() {
  let stats = {
    totalUsers: 0,
    totalAdmins: 0,
    totalAnalysedVideos: 0,
    totalSourceFilesUploaded: 0,
    totalDeepCreditsUsed: 0,
  }
  let statsError = false

  let revenue: UserRevenue | "error" = "error"
  let totalCostUsd: number | "error" = "error"

  let activeUsers: DailyCountPoint[] = []
  let videosByDay: VideosByDayPoint[] = []
  // Each chart tracks its own failure so one broken query only degrades its own
  // card instead of blanking both charts (and mislabelling the healthy one).
  let activeUsersError = false
  let videosError = false

  // The headline stats, the economics figures, and the two time-series charts
  // are independent best-effort loads: a failure in any one of them logs and
  // degrades that section rather than 500-ing the whole dashboard.
  const [
    statsResult,
    revenueResult,
    costResult,
    activeUsersResult,
    videosResult,
  ] = await Promise.allSettled([
    getAdminStats(),
    getTotalRevenue(),
    getTotalCostUsd(),
    getDailyActiveUsers(CHART_WINDOW_DAYS),
    getVideosAnalysedByDay(CHART_WINDOW_DAYS),
  ])

  if (statsResult.status === "fulfilled") {
    stats = statsResult.value
  } else {
    console.error("Failed to load admin stats", statsResult.reason)
    statsError = true
  }

  if (revenueResult.status === "fulfilled") {
    revenue = revenueResult.value
  } else {
    console.error("Failed to load total revenue", revenueResult.reason)
  }

  if (costResult.status === "fulfilled") {
    totalCostUsd = costResult.value
  } else {
    console.error("Failed to load total cost", costResult.reason)
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

  // "Users" means non-admin accounts; admins are counted separately. Clamped so
  // a stale/partial count never renders a negative figure.
  const nonAdminUsers = Math.max(0, stats.totalUsers - stats.totalAdmins)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
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

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-normal">Users</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Users"
            hint="Non-admin accounts"
            value={nonAdminUsers}
            icon={UsersIcon}
          />
          <KpiCard
            label="Admins"
            hint="Admin accounts"
            value={stats.totalAdmins}
            icon={ShieldCheckIcon}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-normal">Video analysis</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Videos analysed"
            hint="Light analysis"
            value={stats.totalAnalysedVideos}
            icon={VideoIcon}
          />
          <KpiCard
            label="Source files uploaded"
            hint="Deep analysis"
            value={stats.totalSourceFilesUploaded}
            icon={FileVideoIcon}
          />
          <KpiCard
            label="Deep-dive credits used"
            hint="All users"
            value={stats.totalDeepCreditsUsed}
            icon={CoinsIcon}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">Economics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Money made across every account versus what serving them has cost.
            Shown in their billed currencies (revenue in GBP, AI/media spend in
            USD), so they aren&rsquo;t netted into a single figure.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Money made"
            hint="Total paid via Stripe, all users (all time)"
            value={formatMoneyMade(revenue)}
            icon={BanknoteIcon}
          />
          <KpiCard
            label="Money spent"
            hint="Total AI/media cost, all users (all time)"
            value={formatUsd(totalCostUsd)}
            icon={ReceiptIcon}
          />
        </div>
      </section>

      <AdminActivityCharts
        activeUsers={activeUsers}
        videosByDay={videosByDay}
        activeUsersError={activeUsersError}
        videosError={videosError}
      />
    </div>
  )
}
