import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getOrBackfillVideoAnalyticsSummary } from "@/lib/video-analytics"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import { fetchChannelThumbnailReach } from "@/lib/youtube/reporting"
import {
  getVideoAnalyticsSummary,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

vi.mock("@/lib/youtube/google-auth", () => ({
  getGoogleAccessToken: vi.fn(),
}))

vi.mock("@/lib/youtube/reporting", () => ({
  fetchChannelThumbnailReach: vi.fn(),
}))

vi.mock("@/lib/youtube/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube/youtube")>()),
  getVideoAnalyticsSummary: vi.fn(),
}))

const mockedToken = vi.mocked(getGoogleAccessToken)
const mockedReach = vi.mocked(fetchChannelThumbnailReach)
const mockedSummary = vi.mocked(getVideoAnalyticsSummary)

beforeEach(() => {
  mockedToken.mockResolvedValue("token")
  mockedReach.mockResolvedValue(new Map())
})

afterEach(() => {
  vi.restoreAllMocks()
  mockedToken.mockReset()
  mockedReach.mockReset()
  mockedSummary.mockReset()
})

const video: VideoDetails = {
  id: "vid-1",
  title: "The BEST Deck To Climb Arena 20",
  channelId: "chan-1",
  publishedAt: "2026-07-26T00:00:00Z",
  durationSeconds: 748,
  thumbnailUrl: "https://example.com/thumb.jpg",
}

const OLD = "2026-07-29T00:00:00Z"

function stored(
  overrides: Partial<VideoAnalyticsSummary> = {},
): VideoAnalyticsSummary {
  return {
    views: 18,
    estimatedMinutesWatched: 77,
    averageViewDurationSeconds: 257,
    averageViewPercentage: 34,
    likes: 2,
    comments: 0,
    shares: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    impressions: 4000,
    impressionClickThroughRate: 0.07,
    reachAttemptedAt: new Date().toISOString(),
    trafficSources: [{ source: "YT_SEARCH", views: 12 }],
    trafficSourcesFetchedAt: new Date().toISOString(),
    fetchedAt: OLD,
    ...overrides,
  }
}

// Minimal chainable Supabase stand-in covering the three shapes this path uses:
// the single-row summary read, the channel-wide reach backfill read, and the
// row updates each of them writes.
function fakeSupabase(
  summary: VideoAnalyticsSummary | null,
  saved: VideoAnalyticsSummary[],
) {
  return {
    from() {
      const state = { op: "", payload: null as VideoAnalyticsSummary | null }
      const builder = {
        select(cols: string) {
          state.op = cols.includes(",") ? "list" : "single"
          return builder
        },
        update(payload: { analytics_summary: VideoAnalyticsSummary }) {
          state.op = "update"
          state.payload = payload.analytics_summary
          return builder
        },
        eq() {
          return builder
        },
        not() {
          return builder
        },
        maybeSingle() {
          return Promise.resolve({
            data: { analytics_summary: summary },
            error: null,
          })
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          if (state.op === "update") {
            saved.push(state.payload as VideoAnalyticsSummary)
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          return Promise.resolve({
            data:
              state.op === "list"
                ? [{ id: "row-1", video_id: "vid-1", analytics_summary: summary }]
                : null,
            error: null,
          }).then(resolve)
        },
      }
      return builder
    },
  }
}

describe("getOrBackfillVideoAnalyticsSummary", () => {
  it("refetches KPI totals that have aged out and keeps the reach beside them", async () => {
    mockedSummary.mockResolvedValue({
      views: 174,
      estimatedMinutesWatched: 700,
      averageViewDurationSeconds: 241,
      averageViewPercentage: 32,
      likes: 9,
      comments: 4,
      shares: 2,
      subscribersGained: 3,
      subscribersLost: 1,
      impressions: null,
      impressionClickThroughRate: null,
      trafficSources: [{ source: "YT_SEARCH", views: 120 }],
      trafficSourcesFetchedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    })
    const saved: VideoAnalyticsSummary[] = []

    const summary = await getOrBackfillVideoAnalyticsSummary(
      fakeSupabase(stored(), saved) as never,
      "user-1",
      "row-1",
      video,
    )

    expect(mockedSummary).toHaveBeenCalledTimes(1)
    expect(summary?.views).toBe(174)
    // The refetch does not cover reach, so the stored reading carries across
    // instead of being reset to null.
    expect(summary?.impressions).toBe(4000)
    expect(summary?.impressionClickThroughRate).toBe(0.07)
    expect(saved[0]?.views).toBe(174)
    expect(saved[0]?.impressions).toBe(4000)
  })

  it("serves a recently fetched summary without calling YouTube", async () => {
    const saved: VideoAnalyticsSummary[] = []
    const current = stored({ fetchedAt: new Date().toISOString() })

    const summary = await getOrBackfillVideoAnalyticsSummary(
      fakeSupabase(current, saved) as never,
      "user-1",
      "row-1",
      video,
    )

    expect(summary).toEqual(current)
    expect(mockedSummary).not.toHaveBeenCalled()
    expect(mockedToken).not.toHaveBeenCalled()
    expect(saved).toHaveLength(0)
  })

  it("keeps serving the stored numbers when the refresh fails", async () => {
    mockedSummary.mockRejectedValue(new Error("analytics down"))
    const saved: VideoAnalyticsSummary[] = []

    const summary = await getOrBackfillVideoAnalyticsSummary(
      fakeSupabase(stored(), saved) as never,
      "user-1",
      "row-1",
      video,
    )

    expect(summary?.views).toBe(18)
    expect(saved).toHaveLength(0)
  })

  it("keeps the stored traffic-source mix when that report fails", async () => {
    mockedSummary.mockResolvedValue({
      ...stored({ views: 174 }),
      // A failed breakdown report comes back empty and unstamped.
      trafficSources: [],
      trafficSourcesFetchedAt: undefined,
      fetchedAt: new Date().toISOString(),
    })
    const saved: VideoAnalyticsSummary[] = []

    const summary = await getOrBackfillVideoAnalyticsSummary(
      fakeSupabase(stored(), saved) as never,
      "user-1",
      "row-1",
      video,
    )

    expect(summary?.views).toBe(174)
    expect(summary?.trafficSources).toEqual([
      { source: "YT_SEARCH", views: 12 },
    ])
  })
})
