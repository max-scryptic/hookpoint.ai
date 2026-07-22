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
      // Reach is dimensioned by video and filtered to this video, so it returns
      // just this video's row; our row is picked out by video id.
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [
            { name: "video" },
            { name: "videoThumbnailImpressions" },
            { name: "videoThumbnailImpressionsClickRate" },
          ],
          rows: [["vid-1", 25000, 4.8]],
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
      impressionClickThroughRate: 4.8,
    })
    expect(summary.trafficSources).toEqual([
      { source: "YT_SEARCH", views: 600 },
      { source: "RELATED_VIDEO", views: 300 },
    ])

    // Three reports, all filtered to the video. The reach report is also
    // dimensioned by video, which its impression metrics require.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(firstUrl.searchParams.get("filters")).toBe("video==vid-1")
    const reachUrl = new URL(String(fetchMock.mock.calls[2][0]))
    expect(reachUrl.searchParams.get("metrics")).toBe(
      "videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
    )
    expect(reachUrl.searchParams.get("dimensions")).toBe("video")
    expect(reachUrl.searchParams.get("filters")).toBe("video==vid-1")
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
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [
            { name: "video" },
            { name: "videoThumbnailImpressions" },
            { name: "videoThumbnailImpressionsClickRate" },
          ],
          rows: [["vid-1", 8000, 3.1]],
        }),
      )

    const summary = await getVideoAnalyticsSummary("token", video)

    expect(summary.views).toBe(500)
    expect(summary.likes).toBe(40)
    expect(summary.trafficSources).toEqual([])
    expect(summary.impressions).toBe(8000)
    expect(summary.impressionClickThroughRate).toBe(3.1)
  })

  it("still returns KPIs and traffic when the reach report is withheld", async () => {
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
      // YouTube 400s the reach report for a channel/date range it withholds.
      .mockResolvedValueOnce(new Response("unknown metric", { status: 400 }))

    const summary = await getVideoAnalyticsSummary("token", video)

    expect(summary.views).toBe(500)
    expect(summary.trafficSources).toEqual([{ source: "YT_SEARCH", views: 500 }])
    expect(summary.impressions).toBeNull()
    expect(summary.impressionClickThroughRate).toBeNull()
  })

  it("nulls reach when the report returns no row for this video", async () => {
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
      // Reach report ran but YouTube withholds reach for this video, so it comes
      // back with no rows. That must read back null, not throw.
      .mockResolvedValueOnce(
        analyticsResponse({
          columnHeaders: [
            { name: "video" },
            { name: "videoThumbnailImpressions" },
            { name: "videoThumbnailImpressionsClickRate" },
          ],
          rows: [],
        }),
      )

    const summary = await getVideoAnalyticsSummary("token", video)

    expect(summary.views).toBe(500)
    expect(summary.impressions).toBeNull()
    expect(summary.impressionClickThroughRate).toBeNull()
  })
})
