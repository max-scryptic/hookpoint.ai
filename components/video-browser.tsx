"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
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
import { DatePickerWithRange } from "@/components/date-range-picker"
import { VideoList } from "@/components/video-list"
import { VideoTableRowsSkeleton } from "@/components/video-table-skeleton"
import type {
  RecentVideo,
  RecentVideosOrder,
  VideoPrivacyStatus,
} from "@/lib/youtube/youtube"

type PrivacyFilter = "all" | VideoPrivacyStatus

interface VideosPage {
  videos: RecentVideo[]
  nextPageToken: string | null
  prevPageToken: string | null
}

// How many videos a single displayed page holds, counted *after* the
// client-side filters (hidden analysed uploads, privacy, date range) have been
// applied. Every page is filled to this many visible rows before the user can
// advance — see the buffering effect below.
const PAGE_SIZE = 12

// How many uploads to pull from YouTube per API call while filling a page.
// search.list costs the same quota regardless of page size (up to 50), so we
// grab the max to minimise round-trips when many rows are filtered out.
const FETCH_SIZE = 50

// Sorting is server-side: search.list only keeps one page in memory at a time,
// so the order has to be passed to the API and the list refetched from page 1.
// YouTube limits forMine=true uploads to these three orders.
const SORT_OPTIONS: Array<{ value: RecentVideosOrder; label: string }> = [
  { value: "date", label: "Newest first" },
  { value: "title", label: "Title (A–Z)" },
  { value: "viewCount", label: "Most viewed" },
]

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

export function VideoBrowser({
  initial,
  analysedVideoIds = [],
}: {
  initial: VideosPage
  // The user's full set of analysed video IDs. Passed once and checked per row
  // so analysed uploads stay flagged across every paginated page.
  analysedVideoIds?: string[]
}) {
  const analysedIds = useMemo(
    () => new Set(analysedVideoIds),
    [analysedVideoIds],
  )

  // Filter inputs. `search`/`order` query YouTube server-side; `privacy`/date
  // range / the analysed toggle are applied client-side because search.list
  // can't filter on them.
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [privacy, setPrivacy] = useState<PrivacyFilter>("all")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [order, setOrder] = useState<RecentVideosOrder>("date")
  // This page's whole job is picking a video to analyse, so already-analysed
  // uploads are hidden by default. The toggle brings them back (and, when on,
  // surfaces the "Analysed" column) for the occasional re-visit.
  const [showAnalysed, setShowAnalysed] = useState(false)

  // Normalise the picker's Date range to YYYY-MM-DD strings for comparison
  // against each video's (UTC) publish date.
  const dateFrom = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : ""
  const dateTo = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : ""

  // The running feed of uploads fetched from YouTube for the current
  // search/order query, plus the cursor for the next batch (null once YouTube
  // has no more). Because the client-side filters throw rows away, we keep
  // fetching batches into this feed until a full page's worth of *visible* rows
  // is buffered. Refs mirror the state so the async buffering loop can read and
  // extend the feed without racing on stale closures.
  const [feed, setFeed] = useState<RecentVideo[]>(initial.videos)
  const feedRef = useRef<RecentVideo[]>(initial.videos)
  const nextTokenRef = useRef<string | null>(initial.nextPageToken)

  const [pageNumber, setPageNumber] = useState(1)
  // Start in the loading state when the server-rendered first page doesn't
  // already hold a full page of visible rows and YouTube has more to give — the
  // buffering effect will immediately fetch more, and seeding `loading` to true
  // means the very first paint shows the skeleton instead of the handful of
  // initial rows that would otherwise flash before jumping to the full list. At
  // mount only the "hide analysed" filter is active (privacy=all, no dates), so
  // the initial visible count is just the uploads not yet analysed.
  const [loading, setLoading] = useState(() => {
    const initialVisible = initial.videos.reduce(
      (n, video) => (analysedIds.has(video.id) ? n : n + 1),
      0,
    )
    return initialVisible < PAGE_SIZE + 1 && initial.nextPageToken !== null
  })
  const [error, setError] = useState<string | null>(null)

  // The server-side query (search + order). When it changes the feed is stale
  // and has to be rebuilt from YouTube page 1; the ref tracks the query the
  // current feed was built for. Seeded to match the `initial` prop (empty
  // search, newest-first) so no refetch fires on mount.
  const queryKey = `${debouncedSearch} ${order}`
  const feedQueryKeyRef = useRef(queryKey)

  // The search string and order flow into the fetch through refs so the fetch
  // helper can stay identity-stable — otherwise every keystroke would rebuild
  // the buffering effect and retrigger it.
  const debouncedSearchRef = useRef(debouncedSearch)
  const orderRef = useRef(order)
  useEffect(() => {
    debouncedSearchRef.current = debouncedSearch
  }, [debouncedSearch])
  useEffect(() => {
    orderRef.current = order
  }, [order])

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(id)
  }, [search])

  // Predicate for the client-side filters. Kept as a stable-ish callback so the
  // buffering effect only reruns when a filter that changes visibility changes.
  const isVisible = useCallback(
    (video: RecentVideo) => {
      if (!showAnalysed && analysedIds.has(video.id)) return false
      if (privacy !== "all" && video.privacyStatus !== privacy) return false
      if (dateFrom || dateTo) {
        const publishedDate = video.publishedAt.slice(0, 10)
        if (!publishedDate) return false
        if (dateFrom && publishedDate < dateFrom) return false
        if (dateTo && publishedDate > dateTo) return false
      }
      return true
    },
    [showAnalysed, analysedIds, privacy, dateFrom, dateTo],
  )

  // Fetch one batch of uploads from YouTube. Reads the query from refs so its
  // identity never changes; throws on error so callers can bail the loop.
  const fetchBatch = useCallback(
    async (pageToken: string | null): Promise<VideosPage> => {
      const params = new URLSearchParams()
      params.set("maxResults", String(FETCH_SIZE))
      if (pageToken) params.set("pageToken", pageToken)
      if (debouncedSearchRef.current) params.set("q", debouncedSearchRef.current)
      if (orderRef.current !== "date") params.set("order", orderRef.current)

      const res = await fetch(`/api/videos?${params.toString()}`, {
        cache: "no-store",
      })
      const data = (await res.json()) as VideosPage & {
        error?: string
        message?: string
      }
      if (!res.ok) {
        throw new Error(
          data.message ?? data.error ?? "Couldn't load your videos.",
        )
      }
      return {
        videos: data.videos ?? [],
        nextPageToken: data.nextPageToken ?? null,
        prevPageToken: data.prevPageToken ?? null,
      }
    },
    [],
  )

  // Applying a client-side filter jumps back to page 1 so we never strand the
  // user on a page that no longer exists. The setters are wrapped so every
  // entry point (dropdowns, toggle, clear) resets the page in one place.
  function changePrivacy(value: PrivacyFilter) {
    setPrivacy(value)
    setPageNumber(1)
  }
  function changeDateRange(value: DateRange | undefined) {
    setDateRange(value)
    setPageNumber(1)
  }
  function toggleShowAnalysed() {
    setShowAnalysed((value) => !value)
    setPageNumber(1)
  }

  // The buffering engine. On every change to the query, the page, or the
  // filters it (a) rebuilds the feed from scratch when the server-side query
  // changed, then (b) keeps pulling YouTube batches until enough *visible* rows
  // are buffered to fill the current page — plus one extra, which is how we
  // know whether an older page exists.
  useEffect(() => {
    let cancelled = false

    async function run() {
      setError(null)
      let videos = feedRef.current
      let token = nextTokenRef.current

      const queryChanged = feedQueryKeyRef.current !== queryKey
      if (queryChanged) {
        setLoading(true)
        try {
          const batch = await fetchBatch(null)
          if (cancelled) return
          videos = batch.videos
          token = batch.nextPageToken
          feedRef.current = videos
          nextTokenRef.current = token
          feedQueryKeyRef.current = queryKey
          setFeed(videos)
          // Rebuilding the feed means we're back on page 1. Bail and let the
          // pageNumber change retrigger this effect for the buffering pass.
          if (pageNumber !== 1) {
            setPageNumber(1)
            setLoading(false)
            return
          }
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Something went wrong loading your videos.",
            )
            setLoading(false)
          }
          return
        }
      }

      // One extra visible row past the current page tells us an older page
      // exists without having to guess from YouTube's cursor.
      const target = pageNumber * PAGE_SIZE + 1
      const countVisible = (list: RecentVideo[]) =>
        list.reduce((n, video) => (isVisible(video) ? n + 1 : n), 0)

      if (countVisible(videos) < target && token !== null) {
        setLoading(true)
        try {
          while (!cancelled && countVisible(videos) < target && token !== null) {
            const batch = await fetchBatch(token)
            videos = [...videos, ...batch.videos]
            token = batch.nextPageToken
          }
          if (cancelled) return
          feedRef.current = videos
          nextTokenRef.current = token
          setFeed(videos)
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Something went wrong loading your videos.",
            )
          }
        }
      }

      if (!cancelled) setLoading(false)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [queryKey, pageNumber, isVisible, fetchBatch])

  function goNext() {
    if (loading) return
    setPageNumber((n) => n + 1)
  }

  function goPrev() {
    if (loading) return
    setPageNumber((n) => Math.max(1, n - 1))
  }

  function clearFilters() {
    setSearch("")
    setPrivacy("all")
    setDateRange(undefined)
    setOrder("date")
    setPageNumber(1)
  }

  // The filtered feed, then the slice for the current page. Because buffering
  // guarantees at least `pageNumber * PAGE_SIZE (+1)` visible rows are loaded
  // (unless YouTube is exhausted), every page but the last is filled to
  // PAGE_SIZE.
  const visibleVideos = useMemo(
    () => feed.filter(isVisible),
    [feed, isVisible],
  )
  const startIndex = (pageNumber - 1) * PAGE_SIZE
  const pageVideos = visibleVideos.slice(startIndex, startIndex + PAGE_SIZE)

  const hasActiveFilters =
    debouncedSearch !== "" ||
    privacy !== "all" ||
    dateFrom !== "" ||
    dateTo !== ""

  const privacyLabel =
    PRIVACY_OPTIONS.find((option) => option.value === privacy)?.label ??
    "All visibility"

  const sortLabel =
    SORT_OPTIONS.find((option) => option.value === order)?.label ??
    "Newest first"

  // A newer page always exists off page 1; an older page exists whenever we've
  // buffered at least one visible row beyond the current page.
  const canGoPrev = pageNumber > 1
  const canGoNext = visibleVideos.length > pageNumber * PAGE_SIZE

  // While a page is still being buffered we won't yet have a full slice of rows.
  // Rather than flash that partial set (and then have it jump to the full page
  // once the remaining batches land), show the table skeleton until the page is
  // complete. A settled last page legitimately holds fewer than PAGE_SIZE rows,
  // but by then `loading` is false, so it renders normally.
  const showSkeleton = loading && pageVideos.length < PAGE_SIZE

  // When a query returns nothing, show a blank slate instead of the list and
  // hide the pagination controls — there are no further pages to step through.
  const isEmpty = !showSkeleton && pageVideos.length === 0
  const emptyMessage = hasActiveFilters
    ? "No videos match your filters."
    : "No videos found on your YouTube channel yet."

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

        <DatePickerWithRange value={dateRange} onChange={changeDateRange} />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-9 gap-2" />
            }
          >
            <ArrowUpDownIcon className="size-4" />
            {sortLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={order}
              onValueChange={(value) => setOrder(value as RecentVideosOrder)}
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {analysedIds.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            aria-pressed={showAnalysed}
            onClick={toggleShowAnalysed}
          >
            {showAnalysed ? (
              <EyeOffIcon className="size-4" />
            ) : (
              <EyeIcon className="size-4" />
            )}
            {showAnalysed ? "Hide analysed" : "Show analysed"}
          </Button>
        )}

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
      {showSkeleton ? (
        // The page isn't fully buffered yet — show the skeleton rather than the
        // partial row set so the table doesn't visibly grow as batches land.
        <VideoTableRowsSkeleton rows={PAGE_SIZE} />
      ) : (
        <div
          aria-busy={loading}
          className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}
        >
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-6 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <VideoOffIcon className="size-6" />
              </div>
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          ) : (
            <VideoList
              videos={pageVideos}
              analysedIds={analysedIds}
              showAnalysedColumn={showAnalysed}
            />
          )}
        </div>
      )}

      {/* Pagination — hidden when there are no videos to page through, and while
          the skeleton is up (the buttons would only be disabled mid-buffer). */}
      {!isEmpty && !showSkeleton && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Page {pageNumber}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={goPrev}
              disabled={!canGoPrev || loading}
            >
              <ChevronLeftIcon className="size-4" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={goNext}
              disabled={!canGoNext || loading}
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
