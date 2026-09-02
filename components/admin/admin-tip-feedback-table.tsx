"use client"

import { useMemo, useState } from "react"
import { endOfDay, format, startOfDay } from "date-fns"
import {
  LayersIcon,
  ListFilterIcon,
  MessageSquareIcon,
  SearchIcon,
  TagIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { type DateRange } from "react-day-picker"

import type { AdminTipFeedbackRow } from "@/lib/admin/tip-feedback"
import {
  TIP_CATEGORIES,
  TIP_CATEGORY_LABELS,
  TIP_FEEDBACK_REASON_LABELS,
  TIP_FEEDBACK_REASONS,
  TIP_SURFACE_LABELS,
  TIP_SURFACES,
  type TipCategory,
  type TipFeedbackReason,
  type TipSurface,
} from "@/lib/tips"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DatePickerWithRange } from "@/components/date-range-picker"
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

// Every tip a creator flagged as not useful: who flagged it, the surface and
// section it was read in, what it was about, what it suggested, why it missed
// and whatever they wrote about it. Read-only, and filterable on every column
// that holds a value worth grouping by, so a run of complaints about one
// surface, one section, one kind of advice or one creator is easy to pull out.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

// Every single-choice filter uses "" for "no filter", so one empty check covers
// all of them and the dropdowns can share a component.
const ANY = ""

type NotesFilter = typeof ANY | "with" | "without"

const NOTES_FILTER_LABELS: Record<NotesFilter, string> = {
  "": "Notes: any",
  with: "With notes",
  without: "Without notes",
}

// The surface pill borrows the palette already used for tip controls, so the
// two surfaces stay apart at a glance without shouting over the reason.
const SURFACE_BADGE_CLASSES: Record<TipSurface, string> = {
  video_analysis:
    "bg-blue-500/10 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
  comparison_report:
    "bg-violet-500/10 text-violet-700 dark:bg-sky-400/10 dark:text-sky-300",
  unknown: "bg-muted text-muted-foreground",
}

function matchesSearch(row: AdminTipFeedbackRow, query: string): boolean {
  if (query.length === 0) return true
  return [
    row.username,
    row.email,
    row.section,
    row.tip,
    row.notes,
    row.sourcePath,
    TIP_SURFACE_LABELS[row.surface],
    TIP_CATEGORY_LABELS[row.category],
    TIP_FEEDBACK_REASON_LABELS[row.reason],
  ].some((field) => field != null && field.toLowerCase().includes(query))
}

// What the tip was about, which cuts across surfaces: the same advice about the
// hook can miss on a report and on a head-to-head alike. Kept quieter than the
// surface pill, since it sits under the section it was read in.
function CategoryBadge({ category }: { category: TipCategory }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-muted px-2 py-0.5 text-xs leading-tight font-medium text-muted-foreground">
      {TIP_CATEGORY_LABELS[category]}
    </span>
  )
}

function SurfaceBadge({ surface }: { surface: TipSurface }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs leading-tight font-medium",
        SURFACE_BADGE_CLASSES[surface],
      )}
    >
      {TIP_SURFACE_LABELS[surface]}
    </span>
  )
}

function ReasonBadge({ reason }: { reason: TipFeedbackReason }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-destructive/10 px-2 py-0.5 text-xs leading-tight font-medium text-destructive">
      {TIP_FEEDBACK_REASON_LABELS[reason]}
    </span>
  )
}

// One filter dropdown. Every filter on this table is a single choice out of a
// known list with an "any" option at the top, so they are all this control.
function FilterMenu({
  icon: Icon,
  label,
  srLabel,
  value,
  options,
  onChange,
  disabled = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  srLabel: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={srLabel}
        render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="max-w-[12rem] truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-auto min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
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
  )
}

export function AdminTipFeedbackTable({
  rows: allRows,
}: {
  rows: AdminTipFeedbackRow[]
}) {
  const [search, setSearch] = useState("")
  const [userId, setUserId] = useState<string>(ANY)
  const [surface, setSurface] = useState<TipSurface | typeof ANY>(ANY)
  const [section, setSection] = useState<string>(ANY)
  const [category, setCategory] = useState<TipCategory | typeof ANY>(ANY)
  const [reason, setReason] = useState<TipFeedbackReason | typeof ANY>(ANY)
  const [notes, setNotes] = useState<NotesFilter>(ANY)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  // Only the accounts and surfaces actually present are offered, so no filter
  // in the bar can lead to an empty table on its own.
  const userOptions = useMemo(() => {
    const labels = new Map<string, string>()
    for (const row of allRows) {
      if (!labels.has(row.userId)) {
        labels.set(row.userId, row.email ?? row.username ?? row.userId)
      }
    }
    return [...labels]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allRows])

  const surfaceOptions = useMemo(() => {
    const present = new Set(allRows.map((row) => row.surface))
    return TIP_SURFACES.filter((value) => present.has(value)).map((value) => ({
      value,
      label: TIP_SURFACE_LABELS[value],
    }))
  }, [allRows])

  // The section list is the drill-down under the surface: picking a surface
  // narrows it to the sections that surface actually has.
  const sectionOptions = useMemo(() => {
    const present = new Set<string>()
    for (const row of allRows) {
      if (surface === ANY || row.surface === surface) present.add(row.section)
    }
    return [...present]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }))
  }, [allRows, surface])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const from = dateRange?.from ? startOfDay(dateRange.from).getTime() : null
    const to = dateRange?.to ? endOfDay(dateRange.to).getTime() : null

    return allRows.filter((row) => {
      if (userId !== ANY && row.userId !== userId) return false
      if (surface !== ANY && row.surface !== surface) return false
      if (section !== ANY && row.section !== section) return false
      if (category !== ANY && row.category !== category) return false
      if (reason !== ANY && row.reason !== reason) return false
      if (notes === "with" && row.notes == null) return false
      if (notes === "without" && row.notes != null) return false
      if (from != null || to != null) {
        const flaggedAt = new Date(row.createdAt).getTime()
        if (from != null && flaggedAt < from) return false
        if (to != null && flaggedAt > to) return false
      }
      return matchesSearch(row, query)
    })
  }, [
    allRows,
    category,
    dateRange,
    notes,
    reason,
    search,
    section,
    surface,
    userId,
  ])

  const { pageRows, currentPage, pageCount, setPageNumber } = usePagination(rows)

  // Every filter change jumps back to the first page, so a narrower result set
  // never strands the view on a now-empty page.
  function apply(change: () => void) {
    change()
    setPageNumber(1)
  }

  function changeSurface(value: string) {
    const next = value as TipSurface | typeof ANY
    apply(() => {
      setSurface(next)
      // A section belongs to one surface, so keeping the current section under
      // a different surface would filter to nothing. Drop it instead.
      const sectionStillOffered = allRows.some(
        (row) =>
          row.section === section && (next === ANY || row.surface === next),
      )
      if (!sectionStillOffered) setSection(ANY)
    })
  }

  function clearFilters() {
    setSearch("")
    setUserId(ANY)
    setSurface(ANY)
    setSection(ANY)
    setCategory(ANY)
    setReason(ANY)
    setNotes(ANY)
    setDateRange(undefined)
    setPageNumber(1)
  }

  const surfaceLabel =
    surface === ANY ? "All surfaces" : TIP_SURFACE_LABELS[surface]
  const categoryLabel =
    category === ANY ? "All categories" : TIP_CATEGORY_LABELS[category]
  const reasonLabel =
    reason === ANY ? "All reasons" : TIP_FEEDBACK_REASON_LABELS[reason]
  const userLabel =
    userOptions.find((option) => option.value === userId)?.label ?? "All users"

  const hasActiveFilters =
    search.trim().length > 0 ||
    userId !== ANY ||
    surface !== ANY ||
    section !== ANY ||
    category !== ANY ||
    reason !== ANY ||
    notes !== ANY ||
    dateRange?.from != null ||
    dateRange?.to != null

  const total = allRows.length
  const countLabel =
    rows.length === total
      ? `${total.toLocaleString()} flagged tip${total === 1 ? "" : "s"}.`
      : `${rows.length.toLocaleString()} of ${total.toLocaleString()} flagged tips.`

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{countLabel}</p>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => apply(() => setSearch(event.target.value))}
              placeholder="Search user, section, tip or notes"
              aria-label="Search tip feedback"
              className="h-9 w-full pl-8 sm:w-72"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterMenu
            icon={UsersIcon}
            srLabel="Filter by user"
            label={userLabel}
            value={userId}
            onChange={(value) => apply(() => setUserId(value))}
            disabled={userOptions.length === 0}
            options={[{ value: ANY, label: "All users" }, ...userOptions]}
          />
          <FilterMenu
            icon={LayersIcon}
            srLabel="Filter by where the tip was read"
            label={surfaceLabel}
            value={surface}
            onChange={changeSurface}
            disabled={surfaceOptions.length === 0}
            options={[{ value: ANY, label: "All surfaces" }, ...surfaceOptions]}
          />
          <FilterMenu
            icon={ListFilterIcon}
            srLabel="Filter by section"
            label={section === ANY ? "All sections" : section}
            value={section}
            onChange={(value) => apply(() => setSection(value))}
            disabled={sectionOptions.length === 0}
            options={[{ value: ANY, label: "All sections" }, ...sectionOptions]}
          />
          <FilterMenu
            icon={TagIcon}
            srLabel="Filter by what the tip was about"
            label={categoryLabel}
            value={category}
            onChange={(value) =>
              apply(() => setCategory(value as TipCategory | typeof ANY))
            }
            options={[
              { value: ANY, label: "All categories" },
              ...TIP_CATEGORIES.map((value) => ({
                value,
                label: TIP_CATEGORY_LABELS[value],
              })),
            ]}
          />
          <FilterMenu
            icon={ListFilterIcon}
            srLabel="Filter by reason"
            label={reasonLabel}
            value={reason}
            onChange={(value) =>
              apply(() => setReason(value as TipFeedbackReason | typeof ANY))
            }
            options={[
              { value: ANY, label: "All reasons" },
              ...TIP_FEEDBACK_REASONS.map((value) => ({
                value,
                label: TIP_FEEDBACK_REASON_LABELS[value],
              })),
            ]}
          />
          <FilterMenu
            icon={MessageSquareIcon}
            srLabel="Filter by whether the creator left notes"
            label={NOTES_FILTER_LABELS[notes]}
            value={notes}
            onChange={(value) => apply(() => setNotes(value as NotesFilter))}
            options={[
              { value: ANY, label: NOTES_FILTER_LABELS[ANY] },
              { value: "with", label: NOTES_FILTER_LABELS.with },
              { value: "without", label: NOTES_FILTER_LABELS.without },
            ]}
          />
          <DatePickerWithRange
            value={dateRange}
            onChange={(range) => apply(() => setDateRange(range))}
            placeholder="Flagged: any date"
          />
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5"
              onClick={clearFilters}
            >
              <XIcon className="size-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No tips have been flagged yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No flagged tips match your filters.
        </p>
      ) : (
        <>
          <div className="rounded-xl border bg-card">
            {/* Fixed layout with a floor on the total width: every column keeps
                its share whatever a tip or a note happens to be, and the prose
                columns wrap inside their own cell instead of running over the
                one beside them. */}
            <Table className="min-w-[68rem] table-fixed text-left">
              <TableHeader>
                <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
                  <TableHead className="w-[12%] px-4 py-3 text-accent-foreground">
                    User
                  </TableHead>
                  <TableHead className="w-[14%] px-4 py-3 text-accent-foreground">
                    Read on
                  </TableHead>
                  <TableHead className="w-[12%] px-4 py-3 text-accent-foreground">
                    Section
                  </TableHead>
                  <TableHead className="w-[22%] px-4 py-3 text-accent-foreground">
                    Tip
                  </TableHead>
                  <TableHead className="w-[17%] px-4 py-3 text-accent-foreground">
                    Reason
                  </TableHead>
                  <TableHead className="w-[13%] px-4 py-3 text-accent-foreground">
                    Notes
                  </TableHead>
                  <TableHead className="w-[10%] px-4 py-3 text-accent-foreground">
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
                        className="block truncate font-medium hover:underline"
                        title={row.username ?? undefined}
                      >
                        {row.username ?? "Unknown user"}
                      </Link>
                      <div
                        className="truncate text-xs text-muted-foreground"
                        title={row.email ?? row.userId}
                      >
                        {row.email ?? row.userId}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <SurfaceBadge surface={row.surface} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm break-words whitespace-normal">
                      {row.section}
                      <div className="mt-1">
                        <CategoryBadge category={row.category} />
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm break-words whitespace-normal">
                      <p className="line-clamp-4" title={row.tip}>
                        {row.tip}
                      </p>
                      {row.sourcePath && (
                        <div
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={row.sourcePath}
                        >
                          {row.sourcePath}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <ReasonBadge reason={row.reason} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm break-words whitespace-normal text-muted-foreground">
                      {row.notes ? (
                        <p className="line-clamp-4" title={row.notes}>
                          {row.notes}
                        </p>
                      ) : (
                        <span className="text-muted-foreground/70">
                          No notes
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm whitespace-nowrap tabular-nums text-muted-foreground">
                      {format(new Date(row.createdAt), "d MMM yyyy")}
                      <div className="text-xs">
                        {format(new Date(row.createdAt), "HH:mm")}
                      </div>
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
