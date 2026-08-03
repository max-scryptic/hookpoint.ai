import { ChannelTrends, ChannelTrendsLocked } from "@/components/channel-trends"
import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { getChannelTrends, type ChannelTrendsData } from "@/lib/channel-trends"
import { createClient } from "@/lib/supabase/server"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

type ChannelTrendsResult =
  | { status: "locked" }
  | { status: "ok"; data: ChannelTrendsData }
  | { status: "error" }

// Cross-video intelligence rides on deep analysis, so access follows the deep
// credits budget: any plan with credits (Starter, Pro) sees the library, the
// Free plan sees the locked explainer. An entitlement lookup failure falls
// back to locked - the same fail-closed default the billing code uses.
async function loadChannelTrends(userId: string): Promise<ChannelTrendsResult> {
  try {
    const entitlement = await getEntitlement(userId)
    if (entitlement.plan.deepCreditsPerMonth <= 0) return { status: "locked" }
  } catch (error) {
    console.error("Failed to resolve plan for channel trends", error)
    return { status: "locked" }
  }

  try {
    const supabase = await createClient()
    // Every trend here is derived from the stored analytics snapshots, so bring
    // them up to date before reading. Throttled and best-effort: most loads
    // skip the YouTube round-trip and a failure just uses the last snapshots.
    await refreshAnalysedVideoStats(supabase, userId)
    const data = await getChannelTrends(supabase, userId)
    return { status: "ok", data }
  } catch (error) {
    console.error("Failed to load channel trends", error)
    return { status: "error" }
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const result = await loadChannelTrends(user.id)

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Channel Trends</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Channel Trends
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your evidence-backed playbook for keeping attention, repairing
            drop-offs and recovering viewers. Every deep analysis makes it
            sharper.
          </p>
        </div>

        {result.status === "ok" && <ChannelTrends data={result.data} />}
        {result.status === "locked" && <ChannelTrendsLocked />}
        {result.status === "error" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            We couldn&apos;t load your channel trends right now. Please try
            again later.
          </div>
        )}
      </div>
    </>
  )
}
