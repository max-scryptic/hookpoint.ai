"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { BrandLogo } from "@/components/brand-logo"
import { NavMain, type NavSection } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
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
      },
    ],
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
  user?: {
    email: string | null
    // The connected YouTube channel's picture, loaded by the server component
    // rendering this sidebar (see lib/youtube/channel-avatar.ts).
    avatarUrl?: string | null
  }
}

export function AppSidebar({
  showUpgradeToPro = false,
  user,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const userEmail = user?.email ?? ""

  const sections: NavSection[] = navSections.map((section) => ({
    label: section.label,
    items: section.items.map((item) => {
      const matchPrefix = "match" in item ? item.match : undefined
      return {
        ...item,
        isActive:
          pathname === item.url ||
          pathname.startsWith(`${item.url}/`) ||
          (matchPrefix !== undefined && pathname.startsWith(matchPrefix)),
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
