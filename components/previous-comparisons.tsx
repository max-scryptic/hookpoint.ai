"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowUpDownIcon,
  HistoryIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { type DateRange } from "react-day-picker"

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
import type { SavedComparison } from "@/lib/video-comparisons"

// The Video Comparator's history: every head-to-head the creator has already
// generated (and paid for), laid out as a table that mirrors the analysed-video
// list. Each row shows both videos (thumbnail and title) and when they were
// compared; clicking the row re-opens that report for free, so this doubles as
// the free re-entry point into any past comparison.
//
// The whole set arrives in memory (capped at the query limit), so search, the
// "compared on" date-range filter, and sort all run client-side, mirroring the
// analysed-video browser's filter bar.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// Both directions of "compared on", since every field the history offers can be
// sorted client-side.
type SortOption = "compared-desc" | "compared-asc"

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "compared-desc", label: "Newest compared" },
  { value: "compared-asc", label: "Oldest compared" },
]

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

// A compact thumbnail-plus-title cell for one side of a comparison. Not a link
// (the whole row is clickable), so it never nests an anchor inside the row.
function VideoCell({
  title,
  thumbnailUrl,
}: {
  title: string | null
  thumbnailUrl: string | null
}) {
  const label = title ?? "Untitled video"
  return (
    <div className="flex items-center gap-3">
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted sm:w-28">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes="112px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <PlayIcon className="size-5" />
          </div>
        )}
      </div>
      <p className="line-clamp-2 min-w-0 text-sm font-medium">{label}</p>
    </div>
  )
}

export function PreviousComparisons({
  comparisons,
}: {
  comparisons: SavedComparison[]
}) {
  const router = useRouter()

  // Filter inputs. Everything filters client-side because the full history is
  // already in memory. Search matches either side's title; the date range is on
  // "compared on".
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [comparedRange, setComparedRange] = useState<DateRange | undefined>(
    undefined,
  )
  // Defaults to "Newest compared", which matches the order the rows arrive in.
  const [sort, setSort] = useState<SortOption>("compared-desc")

  // Debounce the search box so typing doesn't refilter on every keystroke.
  useEffect(() => {
    const id = setTimeout(
      () => setDebouncedSearch(search.trim().toLowerCase()),
      300,
    )
    return () => clearTimeout(id)
  }, [search])

  const comparedFrom = comparedRange?.from
    ? format(comparedRange.from, "yyyy-MM-dd")
    : ""
  const comparedTo = comparedRange?.to
    ? format(comparedRange.to, "yyyy-MM-dd")
    : ""

  const filtered = useMemo(() => {
    return comparisons.filter((comparison) => {
      if (debouncedSearch) {
        const aTitle = (comparison.videoATitle ?? "").toLowerCase()
        const bTitle = (comparison.videoBTitle ?? "").toLowerCase()
        if (
          !aTitle.includes(debouncedSearch) &&
          !bTitle.includes(debouncedSearch)
        ) {
          return false
        }
      }
      if (comparedFrom || comparedTo) {
        const compared = comparison.createdAt.slice(0, 10)
        if (!compared) return false
        if (comparedFrom && compared < comparedFrom) return false
        if (comparedTo && compared > comparedTo) return false
      }
      return true
    })
  }, [comparisons, debouncedSearch, comparedFrom, comparedTo])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) =>
      sort === "compared-asc"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    )
  }, [filtered, sort])

  const hasActiveFilters =
    debouncedSearch !== "" || comparedFrom !== "" || comparedTo !== ""

  function clearFilters() {
    setSearch("")
    setComparedRange(undefined)
    setSort("compared-desc")
  }

  const sortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    "Newest compared"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <HistoryIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Previous comparisons</h2>
      </div>

      {comparisons.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Comparisons you generate show up here so you can re-open them any time
          without spending more credits.
        </p>
      ) : (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by video"
                aria-label="Search comparisons by video title"
                className="h-9 pl-8"
              />
            </div>

            <DatePickerWithRange
              value={comparedRange}
              onChange={setComparedRange}
              placeholder="Compared on"
            />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="h-9 gap-2" />
                }
              >
                <ArrowUpDownIcon className="size-4" />
                {sortLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-[10rem]">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value as SortOption)}
                >
                  {SORT_OPTIONS.map(({ value, label }) => (
                    <DropdownMenuRadioItem
                      key={value}
                      value={value}
                      className="whitespace-nowrap"
                    >
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

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

          {sorted.length === 0 ? (
            <div className="rounded-xl border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
              No comparisons match your filters.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table className="text-left">
                <TableHeader>
                  <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
                    <TableHead className="px-4 py-3 text-accent-foreground">
                      Video 1
                    </TableHead>
                    <TableHead className="px-4 py-3 text-accent-foreground">
                      Video 2
                    </TableHead>
                    <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                      Compared on
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((comparison) => {
                    const href = `/dashboard/video-comparator/report?a=${encodeURIComponent(
                      comparison.videoAId,
                    )}&b=${encodeURIComponent(comparison.videoBId)}`
                    const aTitle = comparison.videoATitle ?? "Untitled video"
                    const bTitle = comparison.videoBTitle ?? "Untitled video"
                    return (
                      <TableRow
                        key={comparison.id}
                        className="cursor-pointer align-top hover:bg-muted/40"
                        onClick={() => router.push(href)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            router.push(href)
                          }
                        }}
                        tabIndex={0}
                        role="link"
                        aria-label={`Open comparison report for ${aTitle} vs ${bTitle}`}
                      >
                        <TableCell className="px-4 py-3 whitespace-normal">
                          <VideoCell
                            title={comparison.videoATitle}
                            thumbnailUrl={comparison.videoAThumbnailUrl}
                          />
                        </TableCell>
                        <TableCell className="px-4 py-3 whitespace-normal">
                          <VideoCell
                            title={comparison.videoBTitle}
                            thumbnailUrl={comparison.videoBThumbnailUrl}
                          />
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-right align-middle text-sm text-muted-foreground sm:table-cell">
                          {formatDate(comparison.createdAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
