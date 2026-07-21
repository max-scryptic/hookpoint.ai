"use client"

import { format } from "date-fns"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { AdminUserRow } from "@/lib/admin/users"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

function initials(value: string): string {
  return value.slice(0, 2).toUpperCase()
}

// Colour treatment per plan so the tier is scannable at a glance. Free is muted;
// the paid tiers pick up the brand accent.
function planBadgeClass(planId: AdminUserRow["planId"]): string {
  switch (planId) {
    case "pro":
      return "bg-primary/10 text-primary"
    case "starter":
      return "bg-primary/5 text-primary"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function PlanBadge({ user }: { user: AdminUserRow }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        planBadgeClass(user.planId),
      )}
    >
      {user.planName}
    </span>
  )
}

function UserCell({ user, href }: { user: AdminUserRow; href: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-8">
        {user.avatarUrl && (
          <AvatarImage src={user.avatarUrl} alt={user.username} />
        )}
        <AvatarFallback>{initials(user.username)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        {/* A real anchor keeps the row keyboard-focusable and supports
            middle/cmd-click; the row's onClick handles clicks elsewhere. */}
        <Link
          href={href}
          className="truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {user.username}
        </Link>
        <div className="truncate text-sm text-muted-foreground">
          {user.email}
        </div>
      </div>
    </div>
  )
}

// The read-only members table. Admin status is intentionally not editable here —
// it is granted directly in the database — so this surface only reports each
// account's plan and join date. Each row links through to the user's detail
// page (KPIs, plan/billing and cost-log breakdown); admins are listed
// separately and are intentionally not clickable.
export function AdminUsersTable({ users }: { users: AdminUserRow[] }) {
  const router = useRouter()

  if (users.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No users yet.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="text-left">
        <TableHeader>
          <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
            <TableHead className="px-4 py-3 text-accent-foreground">
              User
            </TableHead>
            <TableHead className="px-4 py-3 text-accent-foreground">
              Plan
            </TableHead>
            <TableHead className="px-4 py-3 text-accent-foreground">
              Joined
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const href = `/admin/users/${user.id}`
            return (
              <TableRow
                key={user.id}
                onClick={() => router.push(href)}
                className="cursor-pointer hover:bg-muted/40"
              >
                <TableCell className="px-4 py-3">
                  <UserCell user={user} href={href} />
                </TableCell>
                <TableCell className="px-4 py-3">
                  <PlanBadge user={user} />
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                  {format(new Date(user.createdAt), "d MMM yyyy")}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
