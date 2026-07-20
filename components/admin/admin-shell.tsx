"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  LayoutDashboardIcon,
  LogOutIcon,
  UsersIcon,
} from "lucide-react"

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon, exact: true },
  { href: "/admin/users", label: "Users", icon: UsersIcon, exact: false },
]

// Chrome for the authenticated admin area: a left nav plus a header showing the
// signed-in admin and a sign-out control. Kept separate from the main app's
// AppSidebar (which is user/billing oriented) so the two surfaces stay
// independent.
export function AdminShell({
  adminEmail,
  children,
}: {
  adminEmail: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign("/admin/login")
  }

  return (
    <div className="flex min-h-svh bg-muted/40">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-16 items-center gap-2 border-b px-4 font-medium">
          <BrandLogo className="size-8" />
          <span>Admin</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <BrandLogo className="size-8" />
            <span className="font-medium">Admin</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {adminEmail && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {adminEmail}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              <LogOutIcon className="size-4" />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
