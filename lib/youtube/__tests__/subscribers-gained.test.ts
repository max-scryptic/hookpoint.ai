import { afterEach, describe, expect, it, vi } from "vitest"

import { getSubscribersGainedByVideo } from "@/lib/youtube/youtube"

afterEach(() => {
  vi.restoreAllMocks()
})

function analyticsResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

describe("getSubscribersGainedByVideo", () => {
  it("maps one batched Analytics report into a per-video lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      analyticsResponse({
        columnHeaders: [{ name: "video" }, { name: "subscribersGained" }],
        rows: [
          ["vid-1", 25],
          ["vid-3", 4],
        ],
      }),
    )

    const gained = await getSubscribersGainedByVideo("token", [
      "vid-1",
      "vid-2",
      "vid-3",
    ])

    expect(gained.get("vid-1")).toBe(25)
    expect(gained.get("vid-3")).toBe(4)
    // Videos without subscriber activity are simply absent from the report.
    expect(gained.has("vid-2")).toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get("ids")).toBe("channel==MINE")
    expect(url.searchParams.get("dimensions")).toBe("video")
    expect(url.searchParams.get("metrics")).toBe("subscribersGained")
    expect(url.searchParams.get("filters")).toBe("video==vid-1,vid-2,vid-3")
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
