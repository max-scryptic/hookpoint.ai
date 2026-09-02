import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import {
  countDeeplyAnalysedVideos,
  VIDEO_PLANNER_VIDEO_THRESHOLD,
} from "@/lib/deep-analysis-library"

// A tiny thenable PostgREST stub applying the eq filters the counter uses, so
// the test exercises the real filtering rather than a hand-fed answer.
function fakeSupabase(
  rows: Record<string, unknown>[],
  error: { message: string } | null = null,
): SupabaseClient {
  const from = () => {
    let remaining = [...rows]
    const builder: Record<string, unknown> = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        remaining = remaining.filter((row) => row[column] === value)
        return builder
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        return resolve({ data: error ? null : remaining, error })
      },
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

describe("countDeeplyAnalysedVideos", () => {
  it("counts distinct videos whose synthesis is ready", async () => {
    const supabase = fakeSupabase([
      { user_id: "u1", analysed_video_id: "a", status: "ready" },
      // A second ready window for the same video must not count twice.
      { user_id: "u1", analysed_video_id: "a", status: "ready" },
      { user_id: "u1", analysed_video_id: "b", status: "ready" },
      // Still synthesizing: not in the library yet.
      { user_id: "u1", analysed_video_id: "c", status: "pending" },
      // Another account's rows must never leak in.
      { user_id: "u2", analysed_video_id: "d", status: "ready" },
    ])

    expect(await countDeeplyAnalysedVideos(supabase, "u1")).toBe(2)
  })

  it("counts nothing for an account with no completed synthesis", async () => {
    const supabase = fakeSupabase([
      { user_id: "u1", analysed_video_id: "a", status: "failed" },
    ])

    expect(await countDeeplyAnalysedVideos(supabase, "u1")).toBe(0)
  })

  it("throws rather than reporting an empty library when the read fails", async () => {
    const supabase = fakeSupabase([], { message: "connection reset" })

    await expect(countDeeplyAnalysedVideos(supabase, "u1")).rejects.toThrow(
      /connection reset/,
    )
  })
})

describe("VIDEO_PLANNER_VIDEO_THRESHOLD", () => {
  it("is the ten videos the planner needs to ground a plan in", () => {
    expect(VIDEO_PLANNER_VIDEO_THRESHOLD).toBe(10)
  })
})
