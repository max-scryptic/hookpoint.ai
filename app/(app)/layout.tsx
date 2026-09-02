import { AppSidebar } from "@/components/app-sidebar"
import { OnboardingHintsProvider } from "@/components/onboarding-hints"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import {
  countDeeplyAnalysedVideos,
  earnedLibraryUnlocks,
  type LibraryFeatureReach,
} from "@/lib/deep-analysis-library"
import {
  getPendingOnboardingHints,
  type OnboardingHint,
} from "@/lib/onboarding-hints"
import { planIncludesUploads } from "@/lib/plans"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import { createClient } from "@/lib/supabase/server"
import { listSavedTipFingerprints } from "@/lib/tips"
import { SavedTipsProvider } from "@/components/saved-tips-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { NotificationAlerts } from "@/components/notification-alerts"
import { getChannelAvatarUrl } from "@/lib/youtube/channel-avatar"

// The sidebar's coach marks: the one-time hints this creator has still to meet,
// and which of the library gates they have earned a bubble for right now.
//
// The library is only counted when a bubble could come of it, since a gate the
// creator has already been told about needs no count to stay quiet: one small
// read per page most of the time, two over the stretch where an announcement is
// still owed. Best-effort throughout - a shell that cannot tell whether a gate
// has opened simply shows no bubble, which is also what it shows on almost
// every other page load.
async function loadSidebarHints(
  userId: string,
  plan: LibraryFeatureReach,
): Promise<{
  pendingHints: OnboardingHint[]
  unlockedFeatures: OnboardingHint[]
}> {
  try {
    const supabase = await createClient()
    const pendingHints = await getPendingOnboardingHints(supabase, userId)

    // Narrowed to the gates that could still be announced: what the plan
    // carries, minus what this creator has already been told.
    const unannounced: LibraryFeatureReach = {
      canReadTrends:
        plan.canReadTrends && pendingHints.includes("channel_trends_unlocked"),
      canPlanVideos:
        plan.canPlanVideos && pendingHints.includes("video_planner_unlocked"),
    }
    if (!unannounced.canReadTrends && !unannounced.canPlanVideos) {
      return { pendingHints, unlockedFeatures: [] }
    }

    const libraryVideoCount = await countDeeplyAnalysedVideos(supabase, userId)
    return {
      pendingHints,
      unlockedFeatures: earnedLibraryUnlocks(libraryVideoCount, unannounced),
    }
  } catch (error) {
    console.error("Failed to load the sidebar's onboarding hints", error)
    return { pendingHints: [], unlockedFeatures: [] }
  }
}

// Which tips are already on this creator's checklist, read once for the whole
// shell so every "Try:" callout in it paints with the right bookmark state
// instead of each one asking the server about itself. Best-effort: a failure
// just means the bookmarks start empty and saving still works.
async function loadSavedTipFingerprints(userId: string): Promise<string[]> {
  try {
    const supabase = await createClient()
    return await listSavedTipFingerprints(supabase, userId)
  } catch (error) {
    console.error("Failed to load saved tips", error)
    return []
  }
}

// Shared shell for every signed-in app route. The (app) group is a route group,
// so it adds no URL segment: the pages beneath it live at /analyse-video,
// /analysed-videos and so on. Keeping the sidebar provider, the sidebar itself
// and the inset here - rather than re-declaring them in each page - means
// Next.js preserves them across navigations: clicking between tabs only swaps
// the page content instead of tearing down and rebuilding the whole shell every
// time. Auth is enforced once here so individual pages don't each repeat the
// check.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [defaultOpen, user] = await Promise.all([
    getSidebarDefaultOpen(),
    requireAuthenticatedUser(),
  ])
  // The connected channel's picture for the sidebar footer. Started here so it
  // overlaps the reads below instead of adding a hop after them; it is a single
  // row read on every render but the first one after its cache lapses, and it
  // resolves to null rather than throwing when YouTube can't be reached.
  const channelAvatarUrl = getChannelAvatarUrl(user.id)

  let showUpgradeToPro = false
  // Nothing is announced to an account whose plan could not open the page
  // anyway, so a failed read leaves both shut rather than pointing a free
  // account at an upgrade wall.
  const planReach: LibraryFeatureReach = {
    canReadTrends: false,
    canPlanVideos: false,
  }
  try {
    const entitlement = await getEntitlement(user.id)
    showUpgradeToPro = entitlement.planId === "free"
    planReach.canReadTrends = entitlement.plan.deepCreditsPerMonth > 0
    planReach.canPlanVideos = planIncludesUploads(entitlement.plan)
  } catch (error) {
    console.error("Failed to resolve sidebar plan", error)
  }

  // Both reads answer a different part of the shell and neither needs the
  // other, so they go out together rather than one after the last.
  const [savedTipFingerprints, { pendingHints, unlockedFeatures }] =
    await Promise.all([
      loadSavedTipFingerprints(user.id),
      loadSidebarHints(user.id, planReach),
    ])

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      {/* Wraps the shell rather than one page, because the hints it carries
          hang off the sidebar and so outlive whatever page is open. A page that
          declares its own provider for its own coach marks still shadows this
          one inside itself; the two sets of hints do not overlap. */}
      <OnboardingHintsProvider pendingHints={pendingHints}>
        <AppSidebar
          showUpgradeToPro={showUpgradeToPro}
          unlockedFeatures={unlockedFeatures}
          user={{ ...user, avatarUrl: await channelAvatarUrl }}
        />
        <SidebarInset>
          <SavedTipsProvider initialFingerprints={savedTipFingerprints}>
            {children}
          </SavedTipsProvider>
        </SidebarInset>
        <NotificationAlerts />
      </OnboardingHintsProvider>
    </SidebarProvider>
  )
}
