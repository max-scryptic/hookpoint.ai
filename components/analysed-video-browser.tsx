"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import {
  BarChart3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  LinkIcon,
  ListFilterIcon,
  LockIcon,
  MoreVerticalIcon,
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

// The shape the table renders. `video` reuses the RecentVideo cell helpers; the
// extra fields carry data those helpers don't cover.
interface AnalysedRow {
  video: RecentVideo
  dateAnalysed: string
  // Rows analysed before we persisted visibility don't have a known status, so
  // they only ever match the "all" visibility filter.
  privacyKnown: boolean
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

function RowActions({ video }: { video: RecentVideo }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Actions for ${video.title}`}
          />
        }
      >
        <MoreVerticalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={<Link href={`/dashboard/analyse-video/${video.id}`} />}
        >
          <BarChart3Icon className="size-4" />
          View analysis
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AnalysedVideoBrowser({ videos }: { videos: AnalysedVideo[] }) {
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
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(pageNumber, pageCount)

  const pageRows = filtered.slice(
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

  function clearFilters() {
    setSearch("")
    setPrivacy("all")
    setPublishedRange(undefined)
    setAnalysedRange(undefined)
    setPageNumber(1)
  }

  const privacyLabel =
    PRIVACY_OPTIONS.find((option) => option.value === privacy)?.label ??
    "All visibility"

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
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3 font-medium">Video</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">
                  Visibility
                </th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">
                  Published
                </th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                  Views
                </th>
                <th className="hidden px-4 py-3 text-right font-medium lg:table-cell">
                  Comments
                </th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">
                  Analysed
                </th>
                <th className="w-12 px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pageRows.map(({ video, dateAnalysed, privacyKnown }) => (
                <tr key={video.id} className="align-top hover:bg-muted/40">
                  <td className="px-4 py-3">
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
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    {privacyKnown ? (
                      <VisibilityCell status={video.privacyStatus} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                    {formatPublishedAt(video.publishedAt)}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-muted-foreground sm:table-cell">
                    {formatCount(video.viewCount)}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-muted-foreground lg:table-cell">
                    {formatCount(video.commentCount)}
                  </td>
                  <td className="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">
                    {formatAnalysedAt(dateAnalysed)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RowActions video={video} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
