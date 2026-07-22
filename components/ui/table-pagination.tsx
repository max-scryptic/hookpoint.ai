"use client"

import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// The shared page size for every paginated table across the app. Kept in one
// place so "50 rows per page" stays consistent everywhere.
export const TABLE_PAGE_SIZE = 50

// Client-side pagination over an in-memory array. The current page is clamped on
// every render so a shrinking result set (e.g. after a filter change) can never
// strand the view past the last page.
export function usePagination<T>(rows: T[], pageSize: number = TABLE_PAGE_SIZE) {
  const [pageNumber, setPageNumber] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(pageNumber, pageCount)
  const pageRows = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )
  return { pageRows, currentPage, pageCount, setPageNumber }
}

// The shared pagination control rendered beneath a paginated table. Renders
// nothing when there is only a single page, so short tables are visually
// unaffected. Labels default to Previous/Next but can be overridden (e.g. the
// date-sorted video lists read better as Newer/Older).
export function TablePagination({
  currentPage,
  pageCount,
  onPageChange,
  previousLabel = "Previous",
  nextLabel = "Next",
}: {
  currentPage: number
  pageCount: number
  onPageChange: (page: number) => void
  previousLabel?: string
  nextLabel?: string
}) {
  if (pageCount <= 1) return null

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Page {currentPage} of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          <ChevronLeftIcon className="size-4" />
          {previousLabel}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
          disabled={currentPage >= pageCount}
        >
          {nextLabel}
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
