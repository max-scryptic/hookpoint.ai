import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CHANNEL_AVATAR_REFRESH_INTERVAL_MS,
  CHANNEL_AVATAR_RETRY_INTERVAL_MS,
  getChannelAvatarUrl,
} from "@/lib/youtube/channel-avatar"

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }))

const getGoogleAccessToken = vi.fn(async () => "access-token")
vi.mock("@/lib/youtube/google-auth", () => ({
  getGoogleAccessToken: (...args: unknown[]) =>
    getGoogleAccessToken(...(args as [])),
}))

const getMyChannelDetails = vi.fn(async () => ({
  id: "channel-1",
  title: "Viewlio Studio",
  description: "",
  thumbnailUrl: "https://yt3.example.com/fresh.jpg",
  subscriberCount: 1,
  viewCount: 1,
  videoCount: 1,
}))
vi.mock("@/lib/youtube/youtube", () => ({
  getMyChannelDetails: (...args: unknown[]) =>
    getMyChannelDetails(...(args as [])),
}))

type CachedRow = {
  youtube_avatar_url: string | null
  youtube_avatar_fetched_at: string | null
}

// The single users row the fake client serves, and the updates written back to
// it. `selectError` stands in for the schema not being there yet.
let storedRow: CachedRow | null = null
let selectError: { message: string } | null = null
const updates: Array<Record<string, unknown>> = []

function fakeAdminClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: selectError ? null : storedRow,
            error: selectError,
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        updates.push(values)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }
}

beforeEach(() => {
  storedRow = null
  selectError = null
  updates.length = 0
  createAdminClient.mockImplementation(
    fakeAdminClient as unknown as typeof createAdminClient,
  )
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("getChannelAvatarUrl", () => {
  it("fetches and caches the channel picture when nothing is stored", async () => {
    await expect(getChannelAvatarUrl("user-1")).resolves.toBe(
      "https://yt3.example.com/fresh.jpg",
    )

    expect(getMyChannelDetails).toHaveBeenCalledTimes(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].youtube_avatar_url).toBe(
      "https://yt3.example.com/fresh.jpg",
    )
    expect(typeof updates[0].youtube_avatar_fetched_at).toBe("string")
  })

  it("serves a recently cached picture without calling YouTube", async () => {
    storedRow = {
      youtube_avatar_url: "https://yt3.example.com/cached.jpg",
      youtube_avatar_fetched_at: new Date().toISOString(),
    }

    await expect(getChannelAvatarUrl("user-1")).resolves.toBe(
      "https://yt3.example.com/cached.jpg",
    )

    expect(getMyChannelDetails).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it("looks again once the cached picture has gone stale", async () => {
    storedRow = {
      youtube_avatar_url: "https://yt3.example.com/cached.jpg",
      youtube_avatar_fetched_at: new Date(
        Date.now() - CHANNEL_AVATAR_REFRESH_INTERVAL_MS - 1_000,
      ).toISOString(),
    }

    await expect(getChannelAvatarUrl("user-1")).resolves.toBe(
      "https://yt3.example.com/fresh.jpg",
    )
    expect(getMyChannelDetails).toHaveBeenCalledTimes(1)
  })

  it("retries an attempt that found no picture on the shorter interval", async () => {
    storedRow = {
      youtube_avatar_url: null,
      youtube_avatar_fetched_at: new Date(
        Date.now() - CHANNEL_AVATAR_RETRY_INTERVAL_MS / 2,
      ).toISOString(),
    }

    await expect(getChannelAvatarUrl("user-1")).resolves.toBeNull()
    expect(getMyChannelDetails).not.toHaveBeenCalled()

    storedRow = {
      youtube_avatar_url: null,
      youtube_avatar_fetched_at: new Date(
        Date.now() - CHANNEL_AVATAR_RETRY_INTERVAL_MS - 1_000,
      ).toISOString(),
    }

    await expect(getChannelAvatarUrl("user-1")).resolves.toBe(
      "https://yt3.example.com/fresh.jpg",
    )
    expect(getMyChannelDetails).toHaveBeenCalledTimes(1)
  })

  it("keeps showing the cached picture when the refresh fails", async () => {
    storedRow = {
      youtube_avatar_url: "https://yt3.example.com/cached.jpg",
      youtube_avatar_fetched_at: new Date(
        Date.now() - CHANNEL_AVATAR_REFRESH_INTERVAL_MS - 1_000,
      ).toISOString(),
    }
    getGoogleAccessToken.mockRejectedValueOnce(new Error("reconsent required"))

    await expect(getChannelAvatarUrl("user-1")).resolves.toBe(
      "https://yt3.example.com/cached.jpg",
    )
    expect(updates[0].youtube_avatar_url).toBe(
      "https://yt3.example.com/cached.jpg",
    )
  })

  it("returns null rather than throwing when the row can't be read", async () => {
    // Covers the window where this code is live but its migration has not been
    // applied: the sidebar falls back to initials instead of erroring.
    selectError = { message: "column users.youtube_avatar_url does not exist" }

    await expect(getChannelAvatarUrl("user-1")).resolves.toBeNull()
    expect(getMyChannelDetails).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })
})
