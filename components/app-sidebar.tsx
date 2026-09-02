"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { BrandLogo } from "@/components/brand-logo"
import {
  NavMain,
  type NavItemHint,
  type NavSection,
} from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { useFirstPendingHint } from "@/components/onboarding-hints"
import type { OnboardingHint } from "@/lib/onboarding-hints"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  ArrowLeftRightIcon,
  ClapperboardIcon,
  ListChecksIcon,
  ListVideoIcon,
  TrendingUpIcon,
  VideoIcon,
} from "lucide-react"

const navSections = [
  {
    label: "Analysis",
    items: [
      // "Analyse a Video" starts work rather than reviewing it, so it heads the
      // group. The longer title keeps it distinct from the "Analysed Videos"
      // archive beneath it, which the earlier "Analyse Video" wording did not.
      {
        title: "Analyse a Video",
        url: "/analyse-video",
        icon: <VideoIcon />,
      },
      {
        title: "Analysed Videos",
        url: "/analysed-videos",
        // Also light up while viewing a single analysed video at
        // /analysed-video/[videoId].
        match: "/analysed-video",
        icon: <ListVideoIcon />,
      },
      {
        title: "Channel Trends",
        url: "/channel-trends",
        icon: <TrendingUpIcon />,
      },
      {
        title: "Video Comparator",
        url: "/video-comparator",
        icon: <ArrowLeftRightIcon />,
      },
    ],
  },
  {
    label: "Planning",
    items: [
      {
        title: "Checklist",
        url: "/checklist",
        icon: <ListChecksIcon />,
      },
      {
        title: "Video Planner",
        url: "/video-planner",
        icon: <ClapperboardIcon />,
        badge: "Beta",
      },
    ],
  },
]

// The coach marks the sidebar can hang off a nav entry when a library gate
// opens, earliest gate first: a creator who crosses both at once meets Channel
// Trends' bubble now and the planner's when they wave it off, because two
// bubbles over one sidebar is a takeover rather than a pointer.
//
// Which of these an account has EARNED is decided on the server
// (app/(app)/layout.tsx), from the size of its deep-analysis library and what
// its plan carries. Whether an earned one is still to be MET is the hint's own
// record, so each is shown until it is used or waved off and never again.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments included).
// Hyphens are fine.
const UNLOCK_HINTS: { url: string; hint: NavItemHint }[] = [
  {
    url: "/channel-trends",
    hint: {
      hint: "channel_trends_unlocked",
      title: "Channel Trends is open",
      description:
        "Your library is big enough to read patterns off. See what repeats across your uploads: where you lose viewers, what your packaging earns, and what your best videos say.",
    },
  },
  {
    url: "/video-planner",
    hint: {
      hint: "video_planner_unlocked",
      title: "The Video Planner is open",
      description:
        "Your library can now ground a plan. Check a cut before it goes live: which of your titles it delivers on, how the thumbnail holds up beside it, and what to change.",
    },
  },
]

function SidebarBrand() {
  return (
    <div
      aria-label="Viewlio"
      className="flex h-12 items-center gap-2 rounded-md px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <BrandLogo className="size-8" />
      <span className="min-w-0 truncate font-heading text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        Viewlio
      </span>
    </div>
  )
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  showUpgradeToPro?: boolean
  // The library gates this account has crossed and whose feature its plan
  // carries, as the keys of UNLOCK_HINTS above. Passing one only offers its
  // coach mark: a gate crossed long ago whose bubble has already been met
  // stays quiet.
  unlockedFeatures?: OnboardingHint[]
  user?: {
    email: string | null
    // The connected YouTube channel's picture, loaded by the server component
    // rendering this sidebar (see lib/youtube/channel-avatar.ts).
    avatarUrl?: string | null
  }
}

export function AppSidebar({
  showUpgradeToPro = false,
  unlockedFeatures,
  user,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const userEmail = user?.email ?? ""

  // At most one bubble in the sidebar at a time: the first gate this account
  // has earned and not yet met.
  const earned = new Set(unlockedFeatures ?? [])
  const showingHint = useFirstPendingHint(
    UNLOCK_HINTS.filter(({ hint }) => earned.has(hint.hint)).map(
      ({ hint }) => hint.hint,
    ),
  )

  const sections: NavSection[] = navSections.map((section) => ({
    label: section.label,
    items: section.items.map((item) => {
      const matchPrefix = "match" in item ? item.match : undefined
      const unlock = UNLOCK_HINTS.find(({ url }) => url === item.url)
      return {
        ...item,
        isActive:
          pathname === item.url ||
          pathname.startsWith(`${item.url}/`) ||
          (matchPrefix !== undefined && pathname.startsWith(matchPrefix)),
        hint:
          unlock && unlock.hint.hint === showingHint ? unlock.hint : undefined,
      }
    }),
  }))

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <NavMain sections={sections} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          showUpgradeToPro={showUpgradeToPro}
          user={{ email: userEmail, avatarUrl: user?.avatarUrl ?? null }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
