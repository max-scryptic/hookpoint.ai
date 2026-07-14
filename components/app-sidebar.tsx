"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { BrandLogo } from "@/components/brand-logo"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  ListVideoIcon,
  TerminalSquareIcon,
  TrendingUpIcon,
  VideoIcon,
} from "lucide-react"

const navMain = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: <TerminalSquareIcon />,
  },
  {
    title: "Analyse Video",
    url: "/dashboard/analyse-video",
    icon: <VideoIcon />,
  },
  {
    title: "Analysed Videos",
    url: "/dashboard/analysed-videos",
    // Also light up while viewing a single analysed video at
    // /dashboard/analysed-video/[videoId].
    match: "/dashboard/analysed-video",
    icon: <ListVideoIcon />,
  },
  {
    title: "Channel Trends",
    url: "/dashboard/channel-trends",
    icon: <TrendingUpIcon />,
  },
]

function SidebarBrand() {
  return (
    <div
      aria-label="hookpoint.ai"
      className="flex h-12 items-center gap-2 rounded-md px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <BrandLogo className="size-8" priority />
      <span className="min-w-0 truncate text-sm font-semibold tracking-normal text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        hookpoint.ai
      </span>
    </div>
  )
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  showUpgradeToPro?: boolean
  user?: {
    email: string | null
  }
}

export function AppSidebar({
  showUpgradeToPro = false,
  user,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const userEmail = user?.email ?? ""

  const items = navMain.map((item) => {
    const matchPrefix = "match" in item ? item.match : undefined
    return {
      ...item,
      isActive:
        item.url === "/dashboard"
          ? pathname === "/dashboard"
          : pathname === item.url ||
            pathname.startsWith(`${item.url}/`) ||
            (matchPrefix !== undefined && pathname.startsWith(matchPrefix)),
    }
  })

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          showUpgradeToPro={showUpgradeToPro}
          user={{ email: userEmail }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
