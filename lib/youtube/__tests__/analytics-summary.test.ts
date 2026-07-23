import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getVideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"
import { getVideoThumbnailReach } from "@/lib/youtube/reporting"

// Reach comes from the Reporting API (a separate async subsystem, tested in
// reporting.test.ts). Here we stub it so these tests cover only how the
// Analytics-API totals/traffic reports are fetched and merged with reach.
vi.mock("@/lib/youtube/reporting", () => ({
  getVideoThumbnailReach: vi.fn(),
}))

const mockedReach = vi.mocked(getVideoThumbnailReach)

afterEach(() => {
  vi.restoreAllMocks()
  mockedReach.mockReset()
})

const video: VideoDetails = {
  id: "vid-1",
  title: "Test video",
  channelId: "chan-1",
  publishedAt: "2026-01-01T00:00:00Z",
  durationSeconds: 600,
  thumbnailUrl: "https://example.com/thumb.jpg",
}

function analyticsResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

describe("getVideoAnalyticsSummary", () => {
  it("maps KPIs by column name, orders traffic, and merges reach", async () => {
    mockedReach.mockResolvedValue({
      impressions: 25000,
      impressionClickThroughRate: 0.048,
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [
            { name: "views" },
            { name: "estimatedMinutesWatched" },
            { name: "averageViewDuration" },
            { name: "averageViewPercentage" },
            { name: "likes" },
            { name: "comments" },
            { name: "shares" },
            { name: "subscribersGained" },
            { name: "subscribersLost" },
          ],
          rows: [[1000, 4000, 180, 42.5, 120, 30, 15, 25, 4]],
        }),
      )
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [
            { name: "insightTrafficSourceType" },
            { name: "views" },
          ],
          rows: [
            ["YT_SEARCH", 600],
            ["RELATED_VIDEO", 300],
            // Zero-view rows are dropped.
            ["NOTIFICATION", 0],
          ],
        }),
      )

    const summary = await getVideoAnalyticsSummary("token", video)

    expect(summary).toMatchObject({
      views: 1000,
      estimatedMinutesWatched: 4000,
      averageViewDurationSeconds: 180,
      averageViewPercentage: 42.5,
      likes: 120,
      comments: 30,
      shares: 15,
      subscribersGained: 25,
      subscribersLost: 4,
      impressions: 25000,
      impressionClickThroughRate: 0.048,
    })
    expect(summary.trafficSources).toEqual([
      { source: "YT_SEARCH", views: 600 },
      { source: "RELATED_VIDEO", views: 300 },
    ])

    // Reach is not an Analytics report — only totals and traffic hit fetch, both
    // filtered to the video. Reach was sourced via the Reporting API stub.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(firstUrl.searchParams.get("filters")).toBe("video==vid-1")
    expect(mockedReach).toHaveBeenCalledWith("token", "vid-1")
  })

  it("still returns KPIs when the traffic-source report fails", async () => {
    mockedReach.mockResolvedValue({
      impressions: 8000,
      impressionClickThroughRate: 0.031,
    })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [{ name: "views" }, { name: "likes" }],
          rows: [[500, 40]],
        }),
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))

    const summary = await getVideoAnalyticsSummary("token", video)

    expect(summary.views).toBe(500)
    expect(summary.likes).toBe(40)
    expect(summary.trafficSources).toEqual([])
    expect(summary.impressions).toBe(8000)
    expect(summary.impressionClickThroughRate).toBe(0.031)
  })

  it("nulls reach when the Reporting API has nothing for this video", async () => {
    // A freshly created reporting job (or a video outside the report window)
    // yields null reach. That must not throw or disturb the KPI totals.
    mockedReach.mockResolvedValue(null)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [{ name: "views" }],
          rows: [[500]],
        }),
      )
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [
            { name: "insightTrafficSourceType" },
            { name: "views" },
          ],
          rows: [["YT_SEARCH", 500]],
        }),
      )

    const summary = await getVideoAnalyticsSummary("token", video)

    expect(summary.views).toBe(500)
    expect(summary.trafficSources).toEqual([{ source: "YT_SEARCH", views: 500 }])
    expect(summary.impressions).toBeNull()
    expect(summary.impressionClickThroughRate).toBeNull()
    // Even a null reading records an attempt time so it's retried later, not
    // cached as final.
    expect(typeof summary.reachAttemptedAt).toBe("string")
  })
})
