"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { BrandLogo } from "@/components/brand-logo"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { createClient } from "@/lib/supabase/client"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { TerminalSquareIcon, VideoIcon } from "lucide-react"

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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const [userEmail, setUserEmail] = React.useState("")

  const items = navMain.map((item) => ({
    ...item,
    isActive:
      item.url === "/dashboard"
        ? pathname === "/dashboard"
        : pathname === item.url || pathname.startsWith(`${item.url}/`),
  }))

  React.useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? "")
    })

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserEmail(session?.user.email ?? "")
      },
    )

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ email: userEmail }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
