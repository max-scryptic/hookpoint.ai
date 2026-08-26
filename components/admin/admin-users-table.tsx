"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { ArrowUpDownIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { AdminUserRow } from "@/lib/admin/users"
import type { PlanId } from "@/lib/plans"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  TablePagination,
  usePagination,
} from "@/components/ui/table-pagination"
import { cn } from "@/lib/utils"

// The sort orders offered above the table. "Newest first" matches the order the
// rows arrive in, so it is the default.
const SORT_OPTIONS = [
  { value: "joined-desc", label: "Newest first" },
  { value: "joined-asc", label: "Oldest first" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "plan-desc", label: "Plan (high to low)" },
  { value: "plan-asc", label: "Plan (low to high)" },
] as const

type SortKey = (typeof SORT_OPTIONS)[number]["value"]

// Higher tiers rank higher, so plan sorting reads Pro → Starter → Free.
const PLAN_RANK: Record<PlanId, number> = { free: 0, starter: 1, pro: 2 }

function initials(value: string): string {
  return value.slice(0, 2).toUpperCase()
}

// Applies the active search (username or email, case-insensitive) and sort to
// the full member list. Kept pure so it can be memoised cheaply.
function filterAndSort(
  users: AdminUserRow[],
  search: string,
  sort: SortKey,
): AdminUserRow[] {
  const query = search.trim().toLowerCase()
  const filtered = query
    ? users.filter(
        (user) =>
          user.username.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query),
      )
    : users

  const sorted = [...filtered]
  switch (sort) {
    case "joined-asc":
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      break
    case "name-asc":
      sorted.sort((a, b) => a.username.localeCompare(b.username))
      break
    case "name-desc":
      sorted.sort((a, b) => b.username.localeCompare(a.username))
      break
    case "plan-desc":
      sorted.sort((a, b) => PLAN_RANK[b.planId] - PLAN_RANK[a.planId])
      break
    case "plan-asc":
      sorted.sort((a, b) => PLAN_RANK[a.planId] - PLAN_RANK[b.planId])
      break
    default:
      // "joined-desc": newest first, matching the incoming order.
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return sorted
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

// The read-only members table. Admin status is intentionally not editable here -
// it is granted directly in the database - so this surface only reports each
// account's plan and join date. Each row links through to the user's detail
// page (KPIs, plan/billing and cost-log breakdown); admins are listed
// separately and are intentionally not clickable.
export function AdminUsersTable({ users }: { users: AdminUserRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("joined-desc")

  const rows = useMemo(
    () => filterAndSort(users, search, sort),
    [users, search, sort],
  )
  const { pageRows, currentPage, pageCount, setPageNumber } =
    usePagination(rows)

  const sortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    SORT_OPTIONS[0].label

  // The account count tracks the active search so the header always describes
  // what is actually on screen.
  const countLabel = `${rows.length.toLocaleString()} account${
    rows.length === 1 ? "" : "s"
  }.`

  return (
    <div className="space-y-4">
      {/* Count on the left, search + sort on the right - inline, matching the
          filter-bar conventions used elsewhere in the admin surface. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{countLabel}</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                // Jump back to the first page so a new search never strands the
                // view on a now-empty page.
                setPageNumber(1)
              }}
              placeholder="Search name or email"
              aria-label="Search users by name or email"
              className="h-9 w-full pl-8 sm:w-64"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-9 gap-2" />
              }
            >
              <ArrowUpDownIcon className="size-4" />
              <span className="truncate">{sortLabel}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
            >
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => setSort(value as SortKey)}
              >
                {SORT_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="whitespace-nowrap"
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No users yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No users match your search.
        </p>
      ) : (
        <>
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
                {pageRows.map((user) => {
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
          <TablePagination
            currentPage={currentPage}
            pageCount={pageCount}
            onPageChange={setPageNumber}
          />
        </>
      )}
    </div>
  )
}
