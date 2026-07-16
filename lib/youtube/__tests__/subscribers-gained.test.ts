import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getSubscribersGainedByVideo,
  netSubscribersGained,
} from "@/lib/youtube/youtube"

afterEach(() => {
  vi.restoreAllMocks()
})

function analyticsResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

describe("getSubscribersGainedByVideo", () => {
  it("maps one batched Analytics report into a per-video net lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      analyticsResponse({
        columnHeaders: [
          { name: "video" },
          { name: "subscribersGained" },
          { name: "subscribersLost" },
        ],
        rows: [
          ["vid-1", 25, 3],
          ["vid-3", 4, 0],
        ],
      }),
    )

    const gained = await getSubscribersGainedByVideo("token", [
      "vid-1",
      "vid-2",
      "vid-3",
    ])

    expect(gained.get("vid-1")).toBe(22)
    expect(gained.get("vid-3")).toBe(4)
    // Videos without subscriber activity are simply absent from the report.
    expect(gained.has("vid-2")).toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get("ids")).toBe("channel==MINE")
    expect(url.searchParams.get("dimensions")).toBe("video")
    expect(url.searchParams.get("metrics")).toBe(
      "subscribersGained,subscribersLost",
    )
    expect(url.searchParams.get("filters")).toBe("video==vid-1,vid-2,vid-3")
  })

  it("reports a negative net when a video lost more subscribers than it gained", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      analyticsResponse({
        columnHeaders: [
          { name: "video" },
          { name: "subscribersGained" },
          { name: "subscribersLost" },
        ],
        rows: [["vid-1", 1, 3]],
      }),
    )

    const gained = await getSubscribersGainedByVideo("token", ["vid-1"])

    expect(gained.get("vid-1")).toBe(-2)
  })

  it("returns an empty map without calling the API for an empty batch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const gained = await getSubscribersGainedByVideo("token", [])

    expect(gained.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws on an Analytics API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("quota exceeded", { status: 403 }),
    )

    await expect(
      getSubscribersGainedByVideo("token", ["vid-1"]),
    ).rejects.toThrow("YouTube Analytics API error (403)")
  })
})

describe("netSubscribersGained", () => {
  it("subtracts lost from gained, allowing negative results", () => {
    expect(
      netSubscribersGained({ subscribersGained: 25, subscribersLost: 4 }),
    ).toBe(21)
    expect(
      netSubscribersGained({ subscribersGained: 1, subscribersLost: 3 }),
    ).toBe(-2)
  })

  it("treats a missing lost count as 0 for summaries cached before it existed", () => {
    expect(
      netSubscribersGained({ subscribersGained: 7, subscribersLost: null }),
    ).toBe(7)
  })

  it("returns null when YouTube reported no gained figure at all", () => {
    expect(
      netSubscribersGained({ subscribersGained: null, subscribersLost: 2 }),
    ).toBeNull()
  })
})
