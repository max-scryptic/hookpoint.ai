import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { DashboardKpiCards } from "@/components/dashboard-kpi-cards"
import { ConnectedYouTubeAccountCard } from "@/components/connected-youtube-account-card"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { getDashboardKpis, type DashboardKpis } from "@/lib/dashboard/kpis"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import {
  getMyChannelDetails,
  type YouTubeChannelDetails,
} from "@/lib/youtube/youtube"

// Best-effort KPI load: a failure here should degrade to the blank slate, never
// take down the whole dashboard.
async function loadKpis(userId: string): Promise<DashboardKpis | null> {
  try {
    const supabase = await createClient()
    return await getDashboardKpis(supabase, userId)
  } catch (error) {
    console.error("Failed to load dashboard KPIs", error)
    return null
  }
}

// The account summary is helpful context, but the rest of the dashboard should
// remain usable if YouTube is temporarily unavailable or needs reconnecting.
async function loadConnectedAccount(
  userId: string,
): Promise<YouTubeChannelDetails | null> {
  try {
    const accessToken = await getGoogleAccessToken(userId)
    return await getMyChannelDetails(accessToken)
  } catch (error) {
    console.error("Failed to load connected YouTube account", error)
    return null
  }
}

export default async function Page() {
  const user = await requireAuthenticatedUser()
  const [kpis, connectedAccount] = await Promise.all([
    loadKpis(user.id),
    loadConnectedAccount(user.id),
  ])
  // Show KPI cards once the user has analysed at least one video; otherwise keep
  // the blank-slate prompt to analyse their first one.
  const hasAnalysed = (kpis?.videosAnalysed ?? 0) > 0

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
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back. Analyse your YouTube videos to find where viewers
            drop off.
          </p>
        </div>

        {connectedAccount && (
          <ConnectedYouTubeAccountCard channel={connectedAccount} />
        )}

        {hasAnalysed && kpis ? (
          <DashboardKpiCards kpis={kpis} />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border bg-muted/30 p-8">
            <div>
              <p className="font-medium">Analyse a video</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick one of your recent uploads or paste a video URL to see its
                audience retention.
              </p>
            </div>
            <Link href="/dashboard/analyse-video" className={buttonVariants()}>
              Analyse Video
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
