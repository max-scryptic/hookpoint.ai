"use client"

import * as React from "react"
import Image from "next/image"

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
import { TerminalSquareIcon } from "lucide-react"

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: (
        <TerminalSquareIcon
        />
      ),
      isActive: true,
    },
  ],
}

function SidebarBrand() {
  return (
    <div
      aria-label="hookpoint.ai"
      className="flex h-12 items-center gap-2 rounded-md px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <div className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
        <Image
          src="/brand/hookpoint-logo-on-black.png"
          alt=""
          width={64}
          height={64}
          className="size-full scale-[1.7] object-cover"
          priority
        />
      </div>
      <span className="min-w-0 truncate text-sm font-semibold tracking-normal text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        hookpoint.ai
      </span>
    </div>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [userEmail, setUserEmail] = React.useState("")

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
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ email: userEmail }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
