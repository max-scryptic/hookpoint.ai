import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getVideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

afterEach(() => {
  vi.restoreAllMocks()
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
  it("maps KPIs by column name and orders traffic sources", async () => {
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
    })
    expect(summary.trafficSources).toEqual([
      { source: "YT_SEARCH", views: 600 },
      { source: "RELATED_VIDEO", views: 300 },
    ])

    // Reach is NOT an Analytics report - it comes from the Reporting API and is
    // populated separately (backfillChannelThumbnailReach). This summary carries
    // null reach and only makes the two Analytics calls (totals + traffic).
    expect(summary.impressions).toBeNull()
    expect(summary.impressionClickThroughRate).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(firstUrl.searchParams.get("filters")).toBe("video==vid-1")
  })

  it("still returns KPIs when the traffic-source report fails", async () => {
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
    expect(summary.impressions).toBeNull()
    expect(summary.impressionClickThroughRate).toBeNull()
  })
})
