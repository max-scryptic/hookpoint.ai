import { format } from "date-fns"
import { notFound } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeftIcon,
  BanknoteIcon,
  CoinsIcon,
  FileVideoIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react"

import { AdminBillingHistoryTable } from "@/components/admin/admin-billing-history-table"
import { AdminLlmCallsTable } from "@/components/admin/admin-llm-calls-table"
import { AdminVideoAnalysesTable } from "@/components/admin/admin-video-analyses-table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireAdminUser } from "@/lib/admin/auth"
import { getUserById, getUserKpis } from "@/lib/admin/users"
import { getUserVideoAnalyses } from "@/lib/admin/video-analysis"
import { listCostLogs } from "@/lib/admin/llm-calls"
import { getBillingInvoices, getUserRevenue } from "@/lib/stripe/invoices"
import { COST_TYPE_LABELS, type CostType } from "@/lib/llm-call-types"
import {
  getBillingSnapshot,
  type BillingSnapshot,
  type MeterStatus,
} from "@/lib/billing/entitlements"
import { formatGbp, monthlyEquivalentPence } from "@/lib/plans"
import { cn } from "@/lib/utils"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

function initials(value: string): string {
  return value.slice(0, 2).toUpperCase()
}

function formatDate(iso: string | Date): string {
  return format(new Date(iso), "d MMM yyyy")
}

// Enough precision for the sub-cent figures a single call is, without trailing
// noise for larger totals. Matches the cost-log table's formatting.
function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// "used / limit" (or "used / ∞" for unlimited tiers).
function formatMeter(meter: MeterStatus): string {
  const used = meter.used.toLocaleString()
  if (meter.unlimited) return `${used} / ∞`
  return `${used} / ${(meter.limit as number).toLocaleString()}`
}

function KpiCard({
  label,
  hint,
  value,
  icon: Icon,
}: {
  label: string
  hint: string
  // Numbers are localised; pre-formatted strings (e.g. currency) pass through.
  value: number | string
  icon: typeof VideoIcon
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
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

// Total revenue collected from a user, formatted in the currency Stripe billed
// them in. null means the account has no Stripe customer (never billed → £0.00);
// "error" means the lookup failed and the figure is unknown.
function formatMoneyMade(
  revenue: { totalMinorUnits: number; currency: string | null } | null | "error",
): string {
  if (revenue === "error") return "—"
  if (!revenue) return formatGbp(0)
  const currency = (revenue.currency ?? "gbp").toUpperCase()
  if (currency === "GBP") return formatGbp(revenue.totalMinorUnits)
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    revenue.totalMinorUnits / 100,
  )
}

// A single label/value tile, matching the settings billing summary styling.
function StatTile({
  label,
  value,
  tabular,
}: {
  label: string
  value: string
  tabular?: boolean
}) {
  // White in light mode so the tile lifts off the tinted page; dark mode keeps
  // its original muted fill untouched.
  return (
    <div className="rounded-lg border bg-card p-3 dark:bg-muted/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-heading text-lg font-semibold",
          tabular && "tabular-nums",
        )}
      >
        {value}
      </div>
    </div>
  )
}

// Resolves the plan/billing tiles from a live billing snapshot. Free accounts
// have no Stripe subscription, so their "cycle" is the usage window anchored to
// their account-creation date; paid accounts show Stripe's period plus whether
// the plan is set to renew or cancel.
function PlanOverview({ snapshot }: { snapshot: BillingSnapshot | null }) {
  if (!snapshot) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Billing information could not be loaded. Check the server logs.
      </p>
    )
  }

  const isFree = snapshot.planId === "free"
  const isPaid = snapshot.source === "paid"
  const isCancelling = Boolean(snapshot.cancelAtPeriodEnd && !isFree)
  const includesDeepDives = snapshot.plan.deepCreditsPerMonth > 0

  const statusValue = isFree
    ? "No subscription"
    : isCancelling
      ? "Cancelling"
      : "Active"

  const billingPeriodValue = snapshot.billingPeriod
    ? snapshot.billingPeriod === "annual"
      ? "Annual"
      : "Monthly"
    : "—"

  const priceValue = (() => {
    if (isFree || !snapshot.billingPeriod) return "Free"
    const perMonth = monthlyEquivalentPence(snapshot.plan, snapshot.billingPeriod)
    if (perMonth == null) return "—"
    return `${formatGbp(perMonth)}/mo`
  })()

  // Paid plans show Stripe's subscription window; Free plans show the rolling
  // usage window anchored to the account creation date.
  const cycleStart = isPaid
    ? snapshot.subscriptionPeriodStart
    : snapshot.periodStart
  const cycleEnd = isPaid ? snapshot.subscriptionPeriodEnd : snapshot.periodEnd
  const cycleValue =
    cycleStart && cycleEnd
      ? `${formatDate(cycleStart)} – ${formatDate(cycleEnd)}`
      : "—"

  const renewsCaption = isCancelling
    ? "Access ends"
    : isFree || snapshot.billingPeriod === "annual"
      ? "Usage resets"
      : "Renews"
  const renewsValue = formatDate(snapshot.periodEnd)

  const tiles: { label: string; value: string; tabular?: boolean }[] = [
    { label: "Plan", value: snapshot.plan.name },
    { label: "Status", value: statusValue },
    { label: "Billing period", value: billingPeriodValue },
    { label: "Price", value: priceValue },
    { label: "Billing cycle", value: cycleValue },
    { label: renewsCaption, value: renewsValue },
    {
      label: "Video analyses (this period)",
      value: formatMeter(snapshot.videoAnalyses),
      tabular: true,
    },
    ...(includesDeepDives
      ? [
          {
            label: "Deep-dive credits (this period)",
            value: formatMeter(snapshot.deepCredits),
            tabular: true,
          },
        ]
      : []),
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <StatTile
          key={tile.label}
          label={tile.label}
          value={tile.value}
          tabular={tile.tabular}
        />
      ))}
    </div>
  )
}

// Admin user detail: everything relevant about one account in a single view —
// headline KPIs, plan/billing state, and the full breakdown of the paid costs
// they've driven. All data is fetched server-side via the service-role client
// (behind the admin auth check), the same way the other admin surfaces read.
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params

  await requireAdminUser()
  const user = await getUserById(userId)
  if (!user) {
    notFound()
  }

  // Billing is an optional enhancement here: a lookup failure should still let
  // the rest of the page render rather than 500 the whole view. The same goes
  // for the Stripe-backed payment history and revenue total — a failed/absent
  // Stripe lookup falls back rather than sinking the page.
  const [kpis, snapshot, costLogs, invoices, videoAnalyses, revenue] =
    await Promise.all([
      getUserKpis(user.id),
      getBillingSnapshot(user.id).catch((error) => {
        console.error("Failed to load billing snapshot for user", error)
        return null
      }),
      listCostLogs({ userId: user.id }),
      getBillingInvoices(user.id).catch((error) => {
        console.error("Failed to load billing invoices for user", error)
        return []
      }),
      getUserVideoAnalyses(user.id).catch((error) => {
        console.error("Failed to load video analyses for user", error)
        return []
      }),
      getUserRevenue(user.id).catch((error) => {
        console.error("Failed to load revenue for user", error)
        return "error" as const
      }),
    ])

  // Per-cost-type spend, so the breakdown reads at a glance before the full log.
  const costByType = new Map<CostType, { count: number; total: number }>()
  for (const row of costLogs.rows) {
    const entry = costByType.get(row.costType) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += row.costUsd
    costByType.set(row.costType, entry)
  }
  const costBreakdown = Array.from(costByType.entries())
    .map(([type, entry]) => ({ type, ...entry }))
    .sort((a, b) => b.total - a.total)

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to users
        </Link>

        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            {user.avatarUrl && (
              <AvatarImage src={user.avatarUrl} alt={user.username} />
            )}
            <AvatarFallback>{initials(user.username)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-normal">
              {user.isAdmin && (
                <ShieldCheckIcon className="size-5 shrink-0 text-primary" />
              )}
              {user.username}
            </h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {user.email} · Joined {formatDate(user.createdAt)}
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">Economics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Money made from this account versus what serving it has cost. Shown
            in their billed currencies (revenue in GBP, AI/media spend in USD),
            so they aren&rsquo;t netted into a single figure.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard
            label="Money made"
            hint="Total paid via Stripe (all time)"
            value={formatMoneyMade(revenue)}
            icon={BanknoteIcon}
          />
          <KpiCard
            label="Money spent"
            hint="Total AI/media cost (all time)"
            value={formatUsd(costLogs.totalCostUsd)}
            icon={ReceiptIcon}
          />
        </div>
      </section>

      <Tabs defaultValue="video-analysis" className="gap-6">
        <TabsList>
          <TabsTrigger value="video-analysis">Video analysis</TabsTrigger>
          <TabsTrigger value="plan-billing">Plan &amp; billing</TabsTrigger>
          <TabsTrigger value="cost-logs">Cost logs</TabsTrigger>
        </TabsList>

        <TabsContent value="video-analysis" className="space-y-8">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold tracking-normal">Activity</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Videos analysed"
                hint="Light analysis"
                value={kpis.videosAnalysed}
                icon={VideoIcon}
              />
              <KpiCard
                label="Source files uploaded"
                hint="Deep analysis"
                value={kpis.sourceFilesUploaded}
                icon={FileVideoIcon}
              />
              <KpiCard
                label="Deep-dive credits used"
                hint="All time"
                value={kpis.deepCreditsUsed}
                icon={CoinsIcon}
              />
              <KpiCard
                label="Events generated"
                hint="Retention events synthesized"
                value={kpis.eventsGenerated}
                icon={SparklesIcon}
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-normal">
                Analysed videos
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every video this user has analysed, with its light/deep spend
                and the retention events each produced. Select a row for the
                full breakdown. Most recently analysed first.
              </p>
            </div>
            <AdminVideoAnalysesTable userId={user.id} videos={videoAnalyses} />
          </section>
        </TabsContent>

        <TabsContent value="plan-billing" className="space-y-8">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-normal">
                Plan &amp; billing
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The account&rsquo;s effective plan and current billing cycle.
              </p>
            </div>
            <PlanOverview snapshot={snapshot} />
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-normal">
                Billing history
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Payments and invoices from Stripe, most recent first.
              </p>
            </div>
            <AdminBillingHistoryTable invoices={invoices} />
          </section>
        </TabsContent>

        <TabsContent value="cost-logs" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">
              Cost logs
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every paid AI/media cost this user has driven.
              {costLogs.truncated ? " Showing the most recent 1,000." : ""}
            </p>
          </div>

          {costBreakdown.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {costBreakdown.map((entry) => (
                <div
                  key={entry.type}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 dark:bg-muted/30"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {COST_TYPE_LABELS[entry.type] ?? entry.type}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.count.toLocaleString()} entr
                      {entry.count === 1 ? "y" : "ies"}
                    </div>
                  </div>
                  <div className="font-medium tabular-nums">
                    {formatUsd(entry.total)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <AdminLlmCallsTable rows={costLogs.rows} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
