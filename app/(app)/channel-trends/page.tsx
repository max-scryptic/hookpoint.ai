import Link from "next/link"
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react"

import { ChannelTrends, ChannelTrendsLocked } from "@/components/channel-trends"
import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { getChannelTrends, type ChannelTrendsData } from "@/lib/channel-trends"
import { createClient } from "@/lib/supabase/server"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            What repeats across your channel: where you lose viewers, what your
            packaging earns, and what your best videos say. Every analysis makes
            it sharper.
          </p>
        </div>

        {result.status === "ok" && <ChannelTrends data={result.data} />}
        {result.status === "locked" && <ChannelTrendsLocked />}
        {result.status === "error" && (
          <Card
            role="alert"
            className="max-w-2xl items-start gap-4 p-6 sm:flex-row sm:items-center"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <CircleAlertIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-base font-medium">
                Channel trends could not load
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your library is safe. Try loading the page again.
              </p>
            </div>
            <Link
              href="/channel-trends"
              className={buttonVariants({ variant: "outline" })}
            >
              <RefreshCwIcon />
              Try again
            </Link>
          </Card>
        )}
      </div>
    </>
  )
}
