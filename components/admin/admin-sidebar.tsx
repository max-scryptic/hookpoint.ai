"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { AdminNavUser } from "@/components/admin/admin-nav-user"
import { BrandLogo } from "@/components/brand-logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  ReceiptTextIcon,
  UsersIcon,
} from "lucide-react"

const navMain = [
  {
    title: "Dashboard",
    url: "/admin",
    icon: <LayoutDashboardIcon />,
    exact: true,
  },
  {
    title: "Users",
    url: "/admin/users",
    icon: <UsersIcon />,
  },
  {
    title: "Cost Logs",
    url: "/admin/cost-logs",
    icon: <ReceiptTextIcon />,
  },
]

function SidebarBrand() {
  return (
    <div
      aria-label="hookpoint.ai admin"
      className="flex h-12 items-center gap-2 rounded-md px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <BrandLogo className="size-8" priority />
      <span className="min-w-0 truncate text-sm font-semibold tracking-normal text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        Admin
      </span>
    </div>
  )
}

// The collapsible admin sidebar — the same Sidebar primitives (and icon-only
// collapse behaviour) the front-end AppSidebar uses, so the two surfaces feel
// like one product. Nav items and the footer are admin-specific.
export function AdminSidebar({
  adminEmail,
  ...props
}: React.ComponentProps<typeof Sidebar> & { adminEmail: string | null }) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarMenu>
            {navMain.map((item) => {
              const isActive = item.exact
                ? pathname === item.url
                : pathname === item.url || pathname.startsWith(`${item.url}/`)
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isActive}
                    render={<Link href={item.url} />}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <AdminNavUser email={adminEmail} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
