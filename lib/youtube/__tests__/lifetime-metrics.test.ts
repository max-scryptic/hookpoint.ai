import { afterEach, describe, expect, it, vi } from "vitest"

import { getLifetimeMetricsByVideo } from "@/lib/youtube/youtube"

afterEach(() => {
  vi.restoreAllMocks()
})

function analyticsResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

const HEADERS = [
  { name: "video" },
  { name: "views" },
  { name: "estimatedMinutesWatched" },
  { name: "averageViewDuration" },
  { name: "averageViewPercentage" },
  { name: "likes" },
  { name: "comments" },
  { name: "shares" },
  { name: "subscribersGained" },
  { name: "subscribersLost" },
]

describe("getLifetimeMetricsByVideo", () => {
  it("keys one batched report's rows by video id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      analyticsResponse({
        columnHeaders: HEADERS,
        rows: [
          ["vid-1", 186, 400, 180, 42.5, 12, 3, 1, 4, 1],
          ["vid-2", 20, 30, 90, 15, 1, 0, 0, 0, 0],
        ],
      }),
    )

    const metrics = await getLifetimeMetricsByVideo("token", [
      "vid-1",
      "vid-2",
      // Reported no activity at all, so YouTube omits it entirely.
      "vid-3",
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get("dimensions")).toBe("video")
    expect(url.searchParams.get("filters")).toBe("video==vid-1,vid-2,vid-3")

    expect(metrics.get("vid-1")).toEqual({
      views: 186,
      estimatedMinutesWatched: 400,
      averageViewDurationSeconds: 180,
      averageViewPercentage: 42.5,
      likes: 12,
      comments: 3,
      shares: 1,
      subscribersGained: 4,
      subscribersLost: 1,
    })
    expect(metrics.get("vid-2")?.views).toBe(20)
    expect(metrics.has("vid-3")).toBe(false)
  })

  it("splits a library larger than one batch across several reports", async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        analyticsResponse({ columnHeaders: HEADERS, rows: [] }),
      )

    const ids = Array.from({ length: 51 }, (_, index) => `vid-${index}`)
    await getLifetimeMetricsByVideo("token", ids)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = new URL(String(fetchMock.mock.calls[1][0]))
    expect(second.searchParams.get("filters")).toBe("video==vid-50")
  })

  it("makes no call for an empty library", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    expect(await getLifetimeMetricsByVideo("token", [])).toEqual(new Map())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
