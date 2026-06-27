"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { format } from "date-fns"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  LinkIcon,
  ListFilterIcon,
  LockIcon,
  SearchIcon,
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
import { DatePickerWithRange } from "@/components/date-range-picker"
import { VideoList } from "@/components/video-list"
import type { RecentVideo, VideoPrivacyStatus } from "@/lib/youtube/youtube"

type PrivacyFilter = "all" | VideoPrivacyStatus

interface VideosPage {
  videos: RecentVideo[]
  nextPageToken: string | null
  prevPageToken: string | null
}

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

export function VideoBrowser({ initial }: { initial: VideosPage }) {
  // Filter inputs. Only `search` queries YouTube server-side; `privacy` and the
  // date range are applied client-side because search.list with forMine=true
  // can't filter on privacy and rejects publishedAfter/publishedBefore.
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [privacy, setPrivacy] = useState<PrivacyFilter>("all")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  // Normalise the picker's Date range to YYYY-MM-DD strings for comparison
  // against each video's (UTC) publish date.
  const dateFrom = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : ""
  const dateTo = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : ""

  const [page, setPage] = useState<VideosPage>(initial)
  const [pageNumber, setPageNumber] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // search.list (forMine=true) doesn't reliably return a prevPageToken, so we
  // can't depend on it to page backwards. Instead we track the token used for
  // each page we've visited; the last entry is the current page's token and
  // `null` is the first page. "Newer" re-fetches with the prior entry.
  const [tokenHistory, setTokenHistory] = useState<Array<string | null>>([null])

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(id)
  }, [search])

  const fetchPage = useCallback(
    async (pageToken: string | null): Promise<boolean> => {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (pageToken) params.set("pageToken", pageToken)
      if (debouncedSearch) params.set("q", debouncedSearch)

      try {
        const res = await fetch(`/api/videos?${params.toString()}`, {
          cache: "no-store",
        })
        const data = (await res.json()) as VideosPage & {
          error?: string
          message?: string
        }
        if (!res.ok) {
          setError(data.message ?? data.error ?? "Couldn't load your videos.")
          return false
        }
        setPage({
          videos: data.videos ?? [],
          nextPageToken: data.nextPageToken ?? null,
          prevPageToken: data.prevPageToken ?? null,
        })
        return true
      } catch {
        setError("Something went wrong loading your videos.")
        return false
      } finally {
        setLoading(false)
      }
    },
    [debouncedSearch],
  )

  // Re-query from the first page whenever a server-side filter changes. Skipped
  // on mount because the initial page already reflects the empty filter state.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setPageNumber(1)
    setTokenHistory([null])
    fetchPage(null)
  }, [fetchPage])

  async function goNext() {
    if (!page.nextPageToken || loading) return
    const token = page.nextPageToken
    if (await fetchPage(token)) {
      setTokenHistory((history) => [...history, token])
      setPageNumber((n) => n + 1)
    }
  }

  async function goPrev() {
    if (tokenHistory.length <= 1 || loading) return
    const prevToken = tokenHistory[tokenHistory.length - 2]
    if (await fetchPage(prevToken)) {
      setTokenHistory((history) => history.slice(0, -1))
      setPageNumber((n) => Math.max(1, n - 1))
    }
  }

  function clearFilters() {
    setSearch("")
    setPrivacy("all")
    setDateRange(undefined)
  }

  // Privacy and date range are filtered here rather than server-side (see the
  // note where the filter state is declared). Each video's publishedAt is an
  // ISO timestamp; its date portion compares directly against the YYYY-MM-DD
  // bounds, with `dateTo` inclusive of the whole day.
  const visibleVideos = page.videos.filter((video) => {
    if (privacy !== "all" && video.privacyStatus !== privacy) return false
    if (dateFrom || dateTo) {
      const publishedDate = video.publishedAt.slice(0, 10)
      if (!publishedDate) return false
      if (dateFrom && publishedDate < dateFrom) return false
      if (dateTo && publishedDate > dateTo) return false
    }
    return true
  })

  const hasActiveFilters =
    debouncedSearch !== "" ||
    privacy !== "all" ||
    dateFrom !== "" ||
    dateTo !== ""

  const privacyLabel =
    PRIVACY_OPTIONS.find((option) => option.value === privacy)?.label ??
    "All visibility"

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title"
            aria-label="Search videos by title"
            className="h-9 pl-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-9 gap-2" />
            }
          >
            <ListFilterIcon className="size-4" />
            {privacyLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={privacy}
              onValueChange={(value) => setPrivacy(value as PrivacyFilter)}
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

        <DatePickerWithRange value={dateRange} onChange={setDateRange} />

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

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Results */}
      <div
        aria-busy={loading}
        className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}
      >
        {visibleVideos.length === 0 && hasActiveFilters ? (
          <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            No videos match these filters.
          </div>
        ) : (
          <VideoList videos={visibleVideos} />
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Page {pageNumber}</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={goPrev}
            disabled={tokenHistory.length <= 1 || loading}
          >
            <ChevronLeftIcon className="size-4" />
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={goNext}
            disabled={!page.nextPageToken || loading}
          >
            Older
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
