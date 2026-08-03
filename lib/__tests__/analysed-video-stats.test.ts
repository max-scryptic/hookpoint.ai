import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import {
  getLifetimeMetricsByVideo,
  getVideoStatisticsByVideo,
  type VideoAnalyticsSummary,
  type VideoDetails,
  type VideoLifetimeMetrics,
  type VideoStatistics,
} from "@/lib/youtube/youtube"

vi.mock("@/lib/youtube/google-auth", () => ({
  getGoogleAccessToken: vi.fn(),
}))

vi.mock("@/lib/youtube/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube/youtube")>()),
  getVideoStatisticsByVideo: vi.fn(),
  getLifetimeMetricsByVideo: vi.fn(),
}))

const mockedToken = vi.mocked(getGoogleAccessToken)
const mockedStatistics = vi.mocked(getVideoStatisticsByVideo)
const mockedMetrics = vi.mocked(getLifetimeMetricsByVideo)

beforeEach(() => {
  mockedToken.mockResolvedValue("token")
  mockedStatistics.mockResolvedValue(new Map())
  mockedMetrics.mockResolvedValue(new Map())
})

afterEach(() => {
  vi.restoreAllMocks()
  mockedToken.mockReset()
  mockedStatistics.mockReset()
  mockedMetrics.mockReset()
})

const OLD = "2026-07-29T00:00:00Z"

function details(overrides: Partial<VideoDetails> = {}): VideoDetails {
  return {
    id: "vid-1",
    title: "The BEST Deck To Climb Arena 20",
    channelId: "chan-1",
    publishedAt: "2026-07-26T00:00:00Z",
    durationSeconds: 748,
    thumbnailUrl: "https://example.com/thumb.jpg",
    viewCount: 91,
    commentCount: 0,
    privacyStatus: "public",
    statisticsFetchedAt: OLD,
    ...overrides,
  }
}

function summary(
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
    reachAttemptedAt: OLD,
    trafficSources: [{ source: "YT_SEARCH", views: 12 }],
    trafficSourcesFetchedAt: OLD,
    fetchedAt: OLD,
    ...overrides,
  }
}

function statistics(overrides: Partial<VideoStatistics> = {}): VideoStatistics {
  return {
    viewCount: 186,
    commentCount: 4,
    durationSeconds: 748,
    privacyStatus: "public",
    ...overrides,
  }
}

function metrics(
  overrides: Partial<VideoLifetimeMetrics> = {},
): VideoLifetimeMetrics {
  return {
    views: 174,
    estimatedMinutesWatched: 700,
    averageViewDurationSeconds: 241,
    averageViewPercentage: 32,
    likes: 9,
    comments: 4,
    shares: 2,
    subscribersGained: 3,
    subscribersLost: 1,
    ...overrides,
  }
}

interface CapturedUpdate {
  id: string
  video_details?: VideoDetails
  analytics_summary?: VideoAnalyticsSummary
}

// Minimal chainable Supabase stand-in: serves a fixed row list for the SELECT
// (including the .in() filters the scoped refresh adds) and records each
// UPDATE's payload against the row id it targeted.
function fakeSupabase(
  rows: Array<{
    id: string
    video_id: string
    video_details: VideoDetails | null
    analytics_summary: VideoAnalyticsSummary | null
  }>,
  updates: CapturedUpdate[],
) {
  return {
    from() {
      const state: { op: string; payload: CapturedUpdate; id: string } = {
        op: "",
        payload: { id: "" },
        id: "",
      }
      const builder = {
        select() {
          state.op = "select"
          return builder
        },
        update(payload: CapturedUpdate) {
          state.op = "update"
          state.payload = payload
          return builder
        },
        eq(col: string, val: string) {
          if (col === "id") state.id = val
          return builder
        },
        in() {
          return builder
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          if (state.op === "update") {
            updates.push({ ...state.payload, id: state.id })
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return builder
    },
  }
}

describe("refreshAnalysedVideoStats", () => {
  it("replaces a stale row's public counters and KPI totals", async () => {
    mockedStatistics.mockResolvedValue(new Map([["vid-1", statistics()]]))
    mockedMetrics.mockResolvedValue(new Map([["vid-1", metrics()]]))
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details(),
            analytics_summary: summary(),
          },
        ],
        updates,
      ) as never,
      "user-1",
    )

    expect(updates).toHaveLength(1)
    const [update] = updates
    expect(update.id).toBe("row-1")
    // The list's number and the detail page's number both move on.
    expect(update.video_details?.viewCount).toBe(186)
    expect(update.video_details?.commentCount).toBe(4)
    expect(update.analytics_summary?.views).toBe(174)
    expect(update.analytics_summary?.subscribersGained).toBe(3)
    // Both halves record when they were read, so the next load can skip.
    expect(update.video_details?.statisticsFetchedAt).not.toBe(OLD)
    expect(update.analytics_summary?.fetchedAt).not.toBe(OLD)
    // Everything this pass does not fetch survives untouched.
    expect(update.video_details?.title).toBe(
      "The BEST Deck To Climb Arena 20",
    )
    expect(update.video_details?.durationSeconds).toBe(748)
    expect(update.analytics_summary?.impressions).toBe(4000)
    expect(update.analytics_summary?.impressionClickThroughRate).toBe(0.07)
    expect(update.analytics_summary?.trafficSources).toEqual([
      { source: "YT_SEARCH", views: 12 },
    ])
    expect(update.analytics_summary?.trafficSourcesFetchedAt).toBe(OLD)
  })

  it("skips rows read recently enough and makes no YouTube call", async () => {
    const now = new Date().toISOString()
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details({ statisticsFetchedAt: now }),
            analytics_summary: summary({ fetchedAt: now }),
          },
        ],
        updates,
      ) as never,
      "user-1",
    )

    expect(updates).toHaveLength(0)
    expect(mockedStatistics).not.toHaveBeenCalled()
    expect(mockedMetrics).not.toHaveBeenCalled()
  })

  it("refetches a freshly read row when forced", async () => {
    const now = new Date().toISOString()
    mockedStatistics.mockResolvedValue(new Map([["vid-1", statistics()]]))
    mockedMetrics.mockResolvedValue(new Map([["vid-1", metrics()]]))
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details({ statisticsFetchedAt: now }),
            analytics_summary: summary({ fetchedAt: now }),
          },
        ],
        updates,
      ) as never,
      "user-1",
      { analysedVideoIds: ["row-1"], force: true },
    )

    expect(updates).toHaveLength(1)
    expect(updates[0].analytics_summary?.views).toBe(174)
  })

  it("gives a video that has never had a summary one from the batch", async () => {
    mockedStatistics.mockResolvedValue(new Map([["vid-1", statistics()]]))
    mockedMetrics.mockResolvedValue(new Map([["vid-1", metrics()]]))
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details(),
            analytics_summary: null,
          },
        ],
        updates,
      ) as never,
      "user-1",
    )

    expect(updates[0].analytics_summary?.views).toBe(174)
    // The parts this pass cannot fetch stay unset for their own backfills.
    expect(updates[0].analytics_summary?.trafficSources).toEqual([])
    expect(
      updates[0].analytics_summary?.trafficSourcesFetchedAt,
    ).toBeUndefined()
    expect(updates[0].analytics_summary?.impressions).toBeNull()
  })

  it("keeps stored figures for a video the report omits, but records the read", async () => {
    mockedStatistics.mockResolvedValue(new Map([["vid-1", statistics()]]))
    mockedMetrics.mockResolvedValue(new Map())
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details(),
            analytics_summary: summary(),
          },
        ],
        updates,
      ) as never,
      "user-1",
    )

    expect(updates[0].analytics_summary?.views).toBe(18)
    expect(updates[0].analytics_summary?.fetchedAt).not.toBe(OLD)
  })

  it("still applies the counters when the Analytics report fails", async () => {
    mockedStatistics.mockResolvedValue(new Map([["vid-1", statistics()]]))
    mockedMetrics.mockRejectedValue(new Error("analytics down"))
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details(),
            analytics_summary: summary(),
          },
        ],
        updates,
      ) as never,
      "user-1",
    )

    expect(updates[0].video_details?.viewCount).toBe(186)
    // The half that failed is left exactly as it was, to retry next load.
    expect(updates[0].analytics_summary).toBeUndefined()
  })

  it("leaves every row alone when YouTube cannot be reached at all", async () => {
    mockedToken.mockRejectedValue(new Error("reconsent required"))
    const updates: CapturedUpdate[] = []

    await refreshAnalysedVideoStats(
      fakeSupabase(
        [
          {
            id: "row-1",
            video_id: "vid-1",
            video_details: details(),
            analytics_summary: summary(),
          },
        ],
        updates,
      ) as never,
      "user-1",
    )

    expect(updates).toHaveLength(0)
  })
})
