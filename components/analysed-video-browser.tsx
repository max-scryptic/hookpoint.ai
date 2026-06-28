"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowUpDownIcon,
  BarChart3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  LinkIcon,
  ListFilterIcon,
  LockIcon,
  SearchIcon,
  VideoOffIcon,
  XIcon,
} from "lucide-react"
import { type DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DatePickerWithRange } from "@/components/date-range-picker"
import {
  Thumbnail,
  VisibilityCell,
  formatCount,
  formatPublishedAt,
} from "@/components/video-list"
import type { AnalysedVideo } from "@/lib/analysed-videos"
import type { RecentVideo, VideoPrivacyStatus } from "@/lib/youtube/youtube"

type PrivacyFilter = "all" | VideoPrivacyStatus

// All analysed videos are loaded up front, so we page through them client-side.
// Matches the Analyse Video table's page size for visual parity.
const PAGE_SIZE = 12

const PRIVACY_OPTIONS: Array<{
  value: PrivacyFilter
  label: string
  icon: typeof GlobeIcon | null
}> = [
  { value: "all", label: "All visibility", icon: null },
  { value: "public", label: "Public", icon: GlobeIcon },
  { value: "unlisted", label: "Unlisted", icon: LinkIcon },
  { value: "private", label: "Private", icon: LockIcon },
]

// Every analysed video is already in memory, so unlike the uploads list this
// table sorts client-side and can offer every field in both directions.
type SortOption =
  | "analysed-desc"
  | "analysed-asc"
  | "published-desc"
  | "published-asc"
  | "title-asc"
  | "title-desc"
  | "views-desc"
  | "views-asc"

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "analysed-desc", label: "Recently analysed" },
  { value: "analysed-asc", label: "Earliest analysed" },
  { value: "published-desc", label: "Newest" },
  { value: "published-asc", label: "Oldest" },
  { value: "title-asc", label: "Title (A–Z)" },
  { value: "title-desc", label: "Title (Z–A)" },
  { value: "views-desc", label: "Most viewed" },
  { value: "views-asc", label: "Least viewed" },
]

// The shape the table renders. `video` reuses the RecentVideo cell helpers; the
// extra fields carry data those helpers don't cover.
interface AnalysedRow {
  video: RecentVideo
  dateAnalysed: string
  // Rows analysed before we persisted visibility don't have a known status, so
  // they only ever match the "all" visibility filter.
  privacyKnown: boolean
}

// Treats a missing count as the given sentinel so null view counts always sort
// to the bottom regardless of direction.
function withFallback(value: number | null, fallback: number): number {
  return value == null ? fallback : value
}

function compareRows(a: AnalysedRow, b: AnalysedRow, sort: SortOption): number {
  switch (sort) {
    case "analysed-desc":
      return b.dateAnalysed.localeCompare(a.dateAnalysed)
    case "analysed-asc":
      return a.dateAnalysed.localeCompare(b.dateAnalysed)
    case "published-desc":
      return b.video.publishedAt.localeCompare(a.video.publishedAt)
    case "published-asc":
      return a.video.publishedAt.localeCompare(b.video.publishedAt)
    case "title-asc":
      return a.video.title.localeCompare(b.video.title)
    case "title-desc":
      return b.video.title.localeCompare(a.video.title)
    case "views-desc":
      return (
        withFallback(b.video.viewCount, -Infinity) -
        withFallback(a.video.viewCount, -Infinity)
      )
    case "views-asc":
      return (
        withFallback(a.video.viewCount, Infinity) -
        withFallback(b.video.viewCount, Infinity)
      )
  }
}

function toRow(analysed: AnalysedVideo): AnalysedRow {
  const details = analysed.videoDetails
  return {
    dateAnalysed: analysed.dateAnalysed,
    privacyKnown: details?.privacyStatus != null,
    video: {
      id: analysed.videoId,
      title: details?.title ?? analysed.videoTitle,
      description: details?.description ?? "",
      publishedAt: details?.publishedAt ?? "",
      thumbnailUrl: details?.thumbnailUrl ?? null,
      viewCount: details?.viewCount ?? null,
      commentCount: details?.commentCount ?? null,
      durationSeconds: details?.durationSeconds ?? null,
      privacyStatus: details?.privacyStatus ?? "private",
    },
  }
}

function formatAnalysedAt(iso: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function AnalysedVideoBrowser({ videos }: { videos: AnalysedVideo[] }) {
  const router = useRouter()
  const rows = useMemo(() => videos.map(toRow), [videos])

  // Filter inputs. All filtering is client-side because the full set is already
  // in memory. Search by title, visibility, and two independent date ranges:
  // when the video was published and when it was analysed.
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [privacy, setPrivacy] = useState<PrivacyFilter>("all")
  const [publishedRange, setPublishedRange] = useState<DateRange | undefined>(
    undefined,
  )
  const [analysedRange, setAnalysedRange] = useState<DateRange | undefined>(
    undefined,
  )
  // Defaults to "Recently analysed", which matches the order the rows arrive in.
  const [sort, setSort] = useState<SortOption>("analysed-desc")
  const [pageNumber, setPageNumber] = useState(1)

  // Debounce the search box so typing doesn't refilter on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 300)
    return () => clearTimeout(id)
  }, [search])

  const publishedFrom = publishedRange?.from
    ? format(publishedRange.from, "yyyy-MM-dd")
    : ""
  const publishedTo = publishedRange?.to
    ? format(publishedRange.to, "yyyy-MM-dd")
    : ""
  const analysedFrom = analysedRange?.from
    ? format(analysedRange.from, "yyyy-MM-dd")
    : ""
  const analysedTo = analysedRange?.to
    ? format(analysedRange.to, "yyyy-MM-dd")
    : ""

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (debouncedSearch && !row.video.title.toLowerCase().includes(debouncedSearch)) {
        return false
      }
      if (privacy !== "all" && (!row.privacyKnown || row.video.privacyStatus !== privacy)) {
        return false
      }
      if (publishedFrom || publishedTo) {
        const published = row.video.publishedAt.slice(0, 10)
        if (!published) return false
        if (publishedFrom && published < publishedFrom) return false
        if (publishedTo && published > publishedTo) return false
      }
      if (analysedFrom || analysedTo) {
        const analysed = row.dateAnalysed.slice(0, 10)
        if (!analysed) return false
        if (analysedFrom && analysed < analysedFrom) return false
        if (analysedTo && analysed > analysedTo) return false
      }
      return true
    })
  }, [
    rows,
    debouncedSearch,
    privacy,
    publishedFrom,
    publishedTo,
    analysedFrom,
    analysedTo,
  ])

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareRows(a, b, sort)),
    [filtered, sort],
  )

  const hasActiveFilters =
    debouncedSearch !== "" ||
    privacy !== "all" ||
    publishedFrom !== "" ||
    publishedTo !== "" ||
    analysedFrom !== "" ||
    analysedTo !== ""

  // Filter changes reset the view to page 1 (handled in the setters below); the
  // current page is clamped on render so a shrinking result set can never leave
  // us stranded past the last page.
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(pageNumber, pageCount)

  const pageRows = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  function changeSearch(value: string) {
    setSearch(value)
    setPageNumber(1)
  }

  function changePrivacy(value: PrivacyFilter) {
    setPrivacy(value)
    setPageNumber(1)
  }

  function changePublishedRange(range: DateRange | undefined) {
    setPublishedRange(range)
    setPageNumber(1)
  }

  function changeAnalysedRange(range: DateRange | undefined) {
    setAnalysedRange(range)
    setPageNumber(1)
  }

  function changeSort(value: SortOption) {
    setSort(value)
    setPageNumber(1)
  }

  function clearFilters() {
    setSearch("")
    setPrivacy("all")
    setPublishedRange(undefined)
    setAnalysedRange(undefined)
    setSort("analysed-desc")
    setPageNumber(1)
  }

  const privacyLabel =
    PRIVACY_OPTIONS.find((option) => option.value === privacy)?.label ??
    "All visibility"

  const sortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    "Recently analysed"

  const isEmpty = filtered.length === 0
  const emptyMessage = hasActiveFilters
    ? "No videos match your filters."
    : "You haven't analysed any videos yet."

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search by title"
            aria-label="Search videos by title"
            className="h-9 pl-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
          >
            <ListFilterIcon className="size-4" />
            {privacyLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={privacy}
              onValueChange={(value) => changePrivacy(value as PrivacyFilter)}
            >
              {PRIVACY_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {Icon && <Icon className="size-4" />}
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DatePickerWithRange
          value={publishedRange}
          onChange={changePublishedRange}
          placeholder="Published"
        />
        <DatePickerWithRange
          value={analysedRange}
          onChange={changeAnalysedRange}
          placeholder="Analysed"
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
          >
            <ArrowUpDownIcon className="size-4" />
            {sortLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => changeSort(value as SortOption)}
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value}>
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

      {/* Results */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-muted/30 px-6 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <VideoOffIcon className="size-6" />
          </div>
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          {!hasActiveFilters && (
            <Link
              href="/dashboard/analyse-video"
              className="text-sm font-medium underline underline-offset-4"
            >
              Analyse a video
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="text-left">
            <TableHeader>
              <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
                <TableHead className="px-4 py-3 text-accent-foreground">
                  Video
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-accent-foreground md:table-cell">
                  Visibility
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-accent-foreground lg:table-cell">
                  Published
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                  Views
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-right text-accent-foreground lg:table-cell">
                  Comments
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-accent-foreground sm:table-cell">
                  Analysed
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(({ video, dateAnalysed, privacyKnown }) => {
                const href = `/dashboard/analysed-video/${video.id}`
                return (
                <TableRow
                  key={video.id}
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
                  aria-label={`View analysis for ${video.title}`}
                >
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="flex gap-3 sm:gap-4">
                      <Thumbnail video={video} />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium">
                          {video.title}
                        </p>
                        {video.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {video.description}
                          </p>
                        )}
                        {/* Compact metadata shown only when columns are hidden. */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:hidden">
                          {privacyKnown && (
                            <VisibilityCell status={video.privacyStatus} />
                          )}
                          {video.publishedAt && (
                            <span>{formatPublishedAt(video.publishedAt)}</span>
                          )}
                          <span className="sm:hidden">
                            {formatCount(video.viewCount)} views
                          </span>
                          <span className="sm:hidden">
                            Analysed {formatAnalysedAt(dateAnalysed)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 align-top md:table-cell">
                    {privacyKnown ? (
                      <VisibilityCell status={video.privacyStatus} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 align-top text-sm text-muted-foreground lg:table-cell">
                    {formatPublishedAt(video.publishedAt)}
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 align-top text-right text-sm tabular-nums text-muted-foreground sm:table-cell">
                    {formatCount(video.viewCount)}
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 align-top text-right text-sm tabular-nums text-muted-foreground lg:table-cell">
                    {formatCount(video.commentCount)}
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 align-top text-sm text-muted-foreground sm:table-cell">
                    {formatAnalysedAt(dateAnalysed)}
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination — only shown when the result set spans more than one page. */}
      {!isEmpty && pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setPageNumber(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeftIcon className="size-4" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setPageNumber(Math.min(pageCount, currentPage + 1))}
              disabled={currentPage >= pageCount}
            >
              Older
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
