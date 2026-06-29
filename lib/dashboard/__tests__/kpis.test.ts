import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getDashboardKpis } from "@/lib/dashboard/kpis"

// A tiny chainable fake of the Supabase query builder. Each query in
// getDashboardKpis terminates by being awaited, so the builder is thenable and
// resolves to the canned `{ data, error }` registered for its table.
type TableResult = { data: unknown; error: unknown }

function makeFakeSupabase(byTable: Record<string, TableResult>): SupabaseClient {
  return {
    from(table: string) {
      const result = byTable[table] ?? { data: [], error: null }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe("getDashboardKpis", () => {
  it("counts analysed videos and tallies analysed + deeply analysed minutes", async () => {
    const supabase = makeFakeSupabase({
      analysed_videos: {
        data: [{ duration: 600 }, { duration: 300 }, { duration: 120 }],
        error: null,
      },
      source_files: {
        data: [
          { youtube_duration_seconds: 600 },
          { youtube_duration_seconds: 300 },
        ],
        error: null,
      },
    })

    const kpis = await getDashboardKpis(supabase, "user-1")

    expect(kpis).toEqual({
      videosAnalysed: 3,
      secondsAnalysed: 1020,
      secondsDeeplyAnalysed: 900,
    })
  })

  it("treats missing or invalid durations as zero without dropping the count", async () => {
    const supabase = makeFakeSupabase({
      analysed_videos: {
        data: [{ duration: null }, { duration: 200 }, { duration: -5 }],
        error: null,
      },
      source_files: {
        data: [{ youtube_duration_seconds: null }],
        error: null,
      },
    })

    const kpis = await getDashboardKpis(supabase, "user-1")

    expect(kpis).toEqual({
      videosAnalysed: 3,
      secondsAnalysed: 200,
      secondsDeeplyAnalysed: 0,
    })
  })

  it("returns zeros when the user has no data", async () => {
    const supabase = makeFakeSupabase({
      analysed_videos: { data: [], error: null },
      source_files: { data: [], error: null },
    })

    const kpis = await getDashboardKpis(supabase, "user-1")

    expect(kpis).toEqual({
      videosAnalysed: 0,
      secondsAnalysed: 0,
      secondsDeeplyAnalysed: 0,
    })
  })

  it("throws when a query fails", async () => {
    const supabase = makeFakeSupabase({
      analysed_videos: { data: null, error: { message: "boom" } },
      source_files: { data: [], error: null },
    })

    await expect(getDashboardKpis(supabase, "user-1")).rejects.toThrow(/boom/)
  })
})
