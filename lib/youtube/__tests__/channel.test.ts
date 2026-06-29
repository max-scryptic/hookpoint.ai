import { afterEach, describe, expect, it, vi } from "vitest"

import { getMyChannelDetails } from "@/lib/youtube/youtube"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getMyChannelDetails", () => {
  it("loads the authenticated channel profile and lifetime statistics", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "channel-1",
              snippet: {
                title: "Hookpoint Studio",
                description: "Stories about better videos.",
                thumbnails: {
                  default: { url: "https://example.com/default.jpg" },
                  high: { url: "https://example.com/high.jpg" },
                },
              },
              statistics: {
                subscriberCount: "12345",
                viewCount: "987654",
                videoCount: "42",
              },
            },
          ],
        }),
      ),
    )

    await expect(getMyChannelDetails("access-token")).resolves.toEqual({
      id: "channel-1",
      title: "Hookpoint Studio",
      description: "Stories about better videos.",
      thumbnailUrl: "https://example.com/high.jpg",
      subscriberCount: 12345,
      viewCount: 987654,
      videoCount: 42,
    })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]
    const url = new URL(String(requestUrl))
    expect(url.pathname).toBe("/youtube/v3/channels")
    expect(url.searchParams.get("part")).toBe("snippet,statistics")
    expect(url.searchParams.get("mine")).toBe("true")
    expect(requestInit).toMatchObject({
      headers: { Authorization: "Bearer access-token" },
      cache: "no-store",
    })
  })

  it("does not expose a subscriber count when the channel hides it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "channel-1",
              statistics: {
                subscriberCount: "12345",
                hiddenSubscriberCount: true,
              },
            },
          ],
        }),
      ),
    )

    const channel = await getMyChannelDetails("access-token")

    expect(channel?.subscriberCount).toBeNull()
  })
})
