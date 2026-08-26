"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/client"
import { ChevronsUpDownIcon, SparklesIcon, Settings2Icon, LogOutIcon } from "lucide-react"

export function NavUser({
  showUpgradeToPro,
  user,
}: {
  showUpgradeToPro: boolean
  user: {
    email: string
    // The connected YouTube channel's profile picture. Absent until the channel
    // is connected, or while YouTube can't be reached - the initials below
    // stand in for it.
    avatarUrl?: string | null
  }
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const displayEmail = user.email || "Signed in"
  const avatarFallback = displayEmail.slice(0, 2).toUpperCase()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <Avatar>
              {user.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt="" />
              ) : null}
              <AvatarFallback>{avatarFallback}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{displayEmail}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-fit"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar>
                    {user.avatarUrl ? (
                      <AvatarImage src={user.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback>{avatarFallback}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayEmail}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {showUpgradeToPro ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<a href="/pricing" />}>
                    <SparklesIcon />
                    Upgrade to Pro
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<a href="/settings" />}>
                <Settings2Icon />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
