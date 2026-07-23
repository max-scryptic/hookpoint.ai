import { afterEach, describe, expect, it, vi } from "vitest"

import { getVideoThumbnailReach } from "@/lib/youtube/reporting"

afterEach(() => {
  vi.restoreAllMocks()
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

function csv(text: string): Response {
  return new Response(text)
}

const REACH_HEADER =
  "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr"

describe("getVideoThumbnailReach", () => {
  it("reuses an existing job and aggregates impression-weighted CTR", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // jobs.list — an existing reach job is found, so no create call.
      .mockResolvedValueOnce(
        json({
          jobs: [
            { id: "job-x", reportTypeId: "channel_other" },
            { id: "job-reach", reportTypeId: "channel_reach_basic_a1" },
          ],
        }),
      )
      // reports.list for job-reach — two days.
      .mockResolvedValueOnce(
        json({
          reports: [
            {
              startTime: "2026-07-20T00:00:00Z",
              createTime: "2026-07-21T00:00:00Z",
              downloadUrl: "https://dl/day1",
            },
            {
              startTime: "2026-07-21T00:00:00Z",
              createTime: "2026-07-22T00:00:00Z",
              downloadUrl: "https://dl/day2",
            },
          ],
        }),
      )
      // Downloads (newest day first after sort): day2 then day1.
      .mockResolvedValueOnce(
        csv(
          `${REACH_HEADER}\n2026-07-21,chan-1,vid-1,1000,0.10\n2026-07-21,chan-1,vid-2,500,0.20`,
        ),
      )
      .mockResolvedValueOnce(
        csv(`${REACH_HEADER}\n2026-07-20,chan-1,vid-1,3000,0.06`),
      )

    const reach = await getVideoThumbnailReach("token", "vid-1")

    // vid-1: 1000 impressions @ 0.10 + 3000 @ 0.06 = 4000 impressions,
    // weighted CTR = (100 + 180) / 4000 = 0.07.
    expect(reach).toEqual({
      impressions: 4000,
      impressionClickThroughRate: 0.07,
    })
    // No POST — the existing job was reused.
    const methods = fetchMock.mock.calls.map((call) => call[1]?.method ?? "GET")
    expect(methods).not.toContain("POST")
  })

  it("creates the job when none exists and returns null with no reports yet", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // jobs.list — no reach job present.
      .mockResolvedValueOnce(json({ jobs: [] }))
      // jobs.create — returns the new job id.
      .mockResolvedValueOnce(json({ id: "job-new" }))
      // reports.list — a brand-new job has no reports for ~24-48h.
      .mockResolvedValueOnce(json({ reports: [] }))

    const reach = await getVideoThumbnailReach("token", "vid-1")

    expect(reach).toBeNull()
    const createCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    )
    expect(createCall).toBeTruthy()
    expect(String(createCall?.[1]?.body)).toContain("channel_reach_basic_a1")
  })

  it("dedupes reissued reports for the same day by latest createTime", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({ jobs: [{ id: "job-reach", reportTypeId: "channel_reach_basic_a1" }] }),
      )
      .mockResolvedValueOnce(
        json({
          reports: [
            {
              startTime: "2026-07-20T00:00:00Z",
              createTime: "2026-07-21T00:00:00Z",
              downloadUrl: "https://dl/stale",
            },
            // A corrected report for the same day, generated later.
            {
              startTime: "2026-07-20T00:00:00Z",
              createTime: "2026-07-22T00:00:00Z",
              downloadUrl: "https://dl/fresh",
            },
          ],
        }),
      )
      // Only the fresh (latest createTime) report for that day is downloaded.
      .mockResolvedValueOnce(
        csv(`${REACH_HEADER}\n2026-07-20,chan-1,vid-1,2000,0.09`),
      )

    const reach = await getVideoThumbnailReach("token", "vid-1")

    // Not double-counted: a single 2000-impression day, not 4000.
    expect(reach).toEqual({
      impressions: 2000,
      impressionClickThroughRate: 0.09,
    })
  })

  it("returns null (never throws) when the jobs API fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status: 403 }),
    )

    await expect(getVideoThumbnailReach("token", "vid-1")).resolves.toBeNull()
  })
})
