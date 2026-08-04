"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { SearchIcon } from "lucide-react"
import Link from "next/link"

import type { AdminTipFeedbackRow } from "@/lib/admin/tip-feedback"
import {
  TIP_CATEGORIES,
  TIP_CATEGORY_LABELS,
  TIP_FEEDBACK_REASON_LABELS,
  TIP_FEEDBACK_REASONS,
  type TipCategory,
  type TipFeedbackReason,
} from "@/lib/tips"
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

// Every tip a creator flagged as not useful: which section it was read in, what
// it was about, what it suggested, why it missed and whatever they wrote about
// it. Read-only, and filterable by category, by reason and by free text, so a
// run of complaints about one surface or one kind of advice is easy to pull
// out.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

type ReasonFilter = TipFeedbackReason | "all"
type CategoryFilter = TipCategory | "all"

function matchesSearch(row: AdminTipFeedbackRow, query: string): boolean {
  if (query.length === 0) return true
  return [
    row.username,
    row.email,
    row.section,
    TIP_CATEGORY_LABELS[row.category],
    row.tip,
    row.notes,
  ].some((field) => field != null && field.toLowerCase().includes(query))
}

function CategoryBadge({ category }: { category: TipCategory }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
      {TIP_CATEGORY_LABELS[category]}
    </span>
  )
}

function ReasonBadge({ reason }: { reason: TipFeedbackReason }) {
  return (
    <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-destructive">
      {TIP_FEEDBACK_REASON_LABELS[reason]}
    </span>
  )
}

export function AdminTipFeedbackTable({
  rows: allRows,
}: {
  rows: AdminTipFeedbackRow[]
}) {
  const [search, setSearch] = useState("")
  const [reason, setReason] = useState<ReasonFilter>("all")
  const [category, setCategory] = useState<CategoryFilter>("all")

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allRows.filter(
      (row) =>
        (reason === "all" || row.reason === reason) &&
        (category === "all" || row.category === category) &&
        matchesSearch(row, query),
    )
  }, [allRows, category, reason, search])

  const { pageRows, currentPage, pageCount, setPageNumber } = usePagination(rows)

  const reasonLabel =
    reason === "all" ? "All reasons" : TIP_FEEDBACK_REASON_LABELS[reason]
  const categoryLabel =
    category === "all" ? "All categories" : TIP_CATEGORY_LABELS[category]

  const countLabel = `${rows.length.toLocaleString()} flagged tip${
    rows.length === 1 ? "" : "s"
  }.`

  return (
    <div className="space-y-4">
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
              placeholder="Search user, section, tip or notes"
              aria-label="Search tip feedback"
              className="h-9 w-full pl-8 sm:w-72"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-9 gap-2" />
              }
            >
              <span className="truncate">{categoryLabel}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
            >
              <DropdownMenuRadioGroup
                value={category}
                onValueChange={(value) => {
                  setCategory(value as CategoryFilter)
                  setPageNumber(1)
                }}
              >
                <DropdownMenuRadioItem value="all" className="whitespace-nowrap">
                  All categories
                </DropdownMenuRadioItem>
                {TIP_CATEGORIES.map((option) => (
                  <DropdownMenuRadioItem
                    key={option}
                    value={option}
                    className="whitespace-nowrap"
                  >
                    {TIP_CATEGORY_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-9 gap-2" />
              }
            >
              <span className="truncate">{reasonLabel}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
            >
              <DropdownMenuRadioGroup
                value={reason}
                onValueChange={(value) => {
                  setReason(value as ReasonFilter)
                  setPageNumber(1)
                }}
              >
                <DropdownMenuRadioItem value="all" className="whitespace-nowrap">
                  All reasons
                </DropdownMenuRadioItem>
                {TIP_FEEDBACK_REASONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option}
                    value={option}
                    className="whitespace-nowrap"
                  >
                    {TIP_FEEDBACK_REASON_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {allRows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No tips have been flagged yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No flagged tips match your filters.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table className="text-left">
              <TableHeader>
                <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
                  <TableHead className="px-4 py-3 text-accent-foreground">
                    User
                  </TableHead>
                  <TableHead className="px-4 py-3 text-accent-foreground">
                    Section
                  </TableHead>
                  <TableHead className="px-4 py-3 text-accent-foreground">
                    Tip
                  </TableHead>
                  <TableHead className="px-4 py-3 text-accent-foreground">
                    Reason
                  </TableHead>
                  <TableHead className="px-4 py-3 text-accent-foreground">
                    Notes
                  </TableHead>
                  <TableHead className="px-4 py-3 text-accent-foreground">
                    Flagged
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="px-4 py-3">
                      <Link
                        href={`/admin/users/${row.userId}`}
                        className="font-medium hover:underline"
                      >
                        {row.username ?? "Unknown user"}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.email ?? row.userId}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm whitespace-nowrap">
                      {row.section}
                      <div className="mt-1">
                        <CategoryBadge category={row.category} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md px-4 py-3 text-sm">
                      {row.tip}
                      {row.sourcePath && (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {row.sourcePath}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <ReasonBadge reason={row.reason} />
                    </TableCell>
                    <TableCell className="max-w-sm px-4 py-3 text-sm text-muted-foreground">
                      {row.notes ?? "No notes"}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                      {format(new Date(row.createdAt), "d MMM yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
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
