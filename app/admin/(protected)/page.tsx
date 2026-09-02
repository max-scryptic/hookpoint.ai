import { Card, CardContent } from "@/components/ui/card"
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

// Per-request admin data behind an auth check - never statically prerender.
export const dynamic = "force-dynamic"

// Total revenue across the whole app, formatted in the currency Stripe billed
// in (GBP expected). "error" means the Stripe lookup failed and the figure is
// unknown; a zero/absent history renders as £0.00.
function formatMoneyMade(revenue: UserRevenue | "error"): string {
  if (revenue === "error") return "-"
  const currency = (revenue.currency ?? "gbp").toUpperCase()
  if (currency === "GBP") return formatGbp(revenue.totalMinorUnits)
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    revenue.totalMinorUnits / 100,
  )
}

// Matches the per-user detail page: enough precision for sub-cent figures
// without trailing noise on larger totals. "error" renders as an em dash.
function formatUsd(value: number | "error"): string {
  if (value === "error") return "-"
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// KPIs are grouped by category via colour rather than by separate section rows,
// which keeps every headline metric compact and on a single row. Each category
// gets one accent hue; the legend below the row decodes it.
type KpiCategory = "users" | "video" | "economics"

const CATEGORY_STYLES: Record<
  KpiCategory,
  { label: string; dot: string; border: string; icon: string }
> = {
  users: {
    label: "Users",
    dot: "bg-blue-500",
    border: "border-l-blue-500",
    icon: "text-blue-500",
  },
  video: {
    label: "Video analysis",
    dot: "bg-sky-500",
    border: "border-l-sky-500",
    icon: "text-sky-500",
  },
  economics: {
    label: "Economics",
    dot: "bg-emerald-500",
    border: "border-l-emerald-500",
    icon: "text-emerald-500",
  },
}

// One compact headline metric. A left accent border colour-codes the category;
// numbers are localised and pre-formatted strings (e.g. currency) pass through.
function KpiTile({
  label,
  hint,
  value,
  icon: Icon,
  category,
}: {
  label: string
  hint?: string
  value: number | string
  icon: typeof UsersIcon
  category: KpiCategory
}) {
  const style = CATEGORY_STYLES[category]
  return (
    <Card
      size="sm"
      className={`gap-0 border-l-2 py-3 ${style.border}`}
    >
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs leading-tight font-medium text-muted-foreground">
            {label}
          </span>
          <Icon className={`size-3.5 shrink-0 ${style.icon}`} />
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {hint && (
          <p className="text-[11px] leading-tight text-muted-foreground">
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Admin landing page: headline counts grouped into Users, Video analysis and
// Economics, plus the activity charts. Every load is best-effort - a failure in
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
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of the Viewlio workspace.
        </p>
      </div>

      {statsError && (
        <p className="text-sm text-destructive">
          Some metrics could not be loaded. Check the server logs.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(Object.keys(CATEGORY_STYLES) as KpiCategory[]).map((key) => (
            <span
              key={key}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className={`size-2 rounded-full ${CATEGORY_STYLES[key].dot}`}
              />
              {CATEGORY_STYLES[key].label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
          <KpiTile
            label="Users"
            hint="Non-admin accounts"
            value={nonAdminUsers}
            icon={UsersIcon}
            category="users"
          />
          <KpiTile
            label="Admins"
            hint="Admin accounts"
            value={stats.totalAdmins}
            icon={ShieldCheckIcon}
            category="users"
          />
          <KpiTile
            label="Videos analysed"
            hint="Light analysis"
            value={stats.totalAnalysedVideos}
            icon={VideoIcon}
            category="video"
          />
          <KpiTile
            label="Source files uploaded"
            hint="Deep analysis"
            value={stats.totalSourceFilesUploaded}
            icon={FileVideoIcon}
            category="video"
          />
          <KpiTile
            label="Deep-dive credits used"
            hint="All users"
            value={stats.totalDeepCreditsUsed}
            icon={CoinsIcon}
            category="video"
          />
          <KpiTile
            label="Money made"
            hint="Stripe, all users (all time)"
            value={formatMoneyMade(revenue)}
            icon={BanknoteIcon}
            category="economics"
          />
          <KpiTile
            label="Money spent"
            hint="AI/media cost, all time"
            value={formatUsd(totalCostUsd)}
            icon={ReceiptIcon}
            category="economics"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Economics are shown in their billed currencies (revenue in GBP,
          AI/media spend in USD), so they aren&rsquo;t netted into a single
          figure.
        </p>
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
