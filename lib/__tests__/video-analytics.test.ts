import { afterEach, describe, expect, it, vi } from "vitest"

import { backfillChannelThumbnailReach } from "@/lib/video-analytics"
import { fetchChannelThumbnailReach } from "@/lib/youtube/reporting"
import type { VideoAnalyticsSummary } from "@/lib/youtube/youtube"

vi.mock("@/lib/youtube/reporting", () => ({
  fetchChannelThumbnailReach: vi.fn(),
}))

const mockedReach = vi.mocked(fetchChannelThumbnailReach)

afterEach(() => {
  vi.restoreAllMocks()
  mockedReach.mockReset()
})

// A summary analysed a while ago whose reach is still null - due for a retry.
function staleSummary(): VideoAnalyticsSummary {
  return {
    views: 100,
    estimatedMinutesWatched: 10,
    averageViewDurationSeconds: 60,
    averageViewPercentage: 40,
    likes: 5,
    comments: 1,
    shares: 0,
    subscribersGained: 2,
    subscribersLost: 0,
    impressions: null,
    impressionClickThroughRate: null,
    trafficSources: [],
    fetchedAt: "2026-01-01T00:00:00Z",
  }
}

interface CapturedUpdate {
  id: string
  summary: VideoAnalyticsSummary
}

// Minimal chainable Supabase stand-in: serves a fixed row list for the backfill
// SELECT and records each UPDATE's payload + id.
function fakeSupabase(
  rows: Array<{
    id: string
    video_id: string
    analytics_summary: VideoAnalyticsSummary | null
  }>,
  updates: CapturedUpdate[],
) {
  return {
    from() {
      const state: { op: string; payload: unknown; id: string } = {
        op: "",
        payload: null,
        id: "",
      }
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
        eq(col: string, val: string) {
          if (col === "id") state.id = val
          return builder
        },
        not() {
          return builder
        },
        then(
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) {
          if (state.op === "update") {
            updates.push({
              id: state.id,
              summary: state.payload as VideoAnalyticsSummary,
            })
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return builder
    },
  }
}

describe("backfillChannelThumbnailReach", () => {
  it("fans one channel-wide reach fetch out across every analysed video", async () => {
    mockedReach.mockResolvedValue(
      new Map([
        ["vid-1", { impressions: 4000, impressionClickThroughRate: 0.07 }],
        ["vid-2", { impressions: 500, impressionClickThroughRate: 0.2 }],
      ]),
    )
    const rows = [
      { id: "a", video_id: "vid-1", analytics_summary: staleSummary() },
      { id: "b", video_id: "vid-2", analytics_summary: staleSummary() },
      // vid-3 has no reach in the report yet - stays null but is stamped.
      { id: "c", video_id: "vid-3", analytics_summary: staleSummary() },
    ]
    const updates: CapturedUpdate[] = []

    const map = await backfillChannelThumbnailReach(
      fakeSupabase(rows, updates) as never,
      "user-1",
      "token",
    )

    // The single fetch was reused for every video.
    expect(mockedReach).toHaveBeenCalledTimes(1)
    expect(map.get("vid-1")?.impressions).toBe(4000)

    const byId = Object.fromEntries(updates.map((u) => [u.id, u.summary]))
    // Videos present in the report get their reach.
    expect(byId.a.impressions).toBe(4000)
    expect(byId.a.impressionClickThroughRate).toBe(0.07)
    expect(byId.b.impressions).toBe(500)
    // A video not yet in a report stays null but records the attempt so it's
    // throttled from refetching on the next view.
    expect(byId.c.impressions).toBeNull()
    expect(typeof byId.c.reachAttemptedAt).toBe("string")
  })

  it("skips rows whose null reach was already attempted recently", async () => {
    mockedReach.mockResolvedValue(new Map())
    const fresh = { ...staleSummary(), reachAttemptedAt: new Date().toISOString() }
    const rows = [{ id: "a", video_id: "vid-1", analytics_summary: fresh }]
    const updates: CapturedUpdate[] = []

    await backfillChannelThumbnailReach(
      fakeSupabase(rows, updates) as never,
      "user-1",
      "token",
    )

    // No reach to fill and the null was attempted recently - leave it alone.
    expect(updates).toHaveLength(0)
  })
})
