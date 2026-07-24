import { beforeEach, describe, expect, it, vi } from "vitest"

// A per-table store the mocked admin client reads from. Declared via vi.hoisted
// so the vi.mock factory (which is hoisted above imports) can safely close over
// it. Each query — from(table).select(...).gte(...)[.in(...)] — resolves to the
// rows registered for that table, ignoring the filter args (the code under test
// does its own bucketing, which is what we're verifying).
const { tableData } = vi.hoisted(() => ({
  tableData: {} as Record<string, Record<string, unknown>[]>,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const rows = tableData[table] ?? []
      const builder = {
        select: () => builder,
        gte: () => builder,
        in: () => builder,
        eq: () => builder,
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      }
      return builder
    },
  }),
}))

import {
  getDailyActiveUsers,
  getVideosAnalysedByDay,
  recentUtcDates,
} from "@/lib/admin/activity"

const NOW = new Date("2026-07-21T12:00:00.000Z")

beforeEach(() => {
  for (const key of Object.keys(tableData)) delete tableData[key]
})

describe("recentUtcDates", () => {
  it("returns the last N UTC days, oldest first, ending today", () => {
    expect(recentUtcDates(3, NOW)).toEqual([
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
    ])
  })

  it("spans month boundaries correctly", () => {
    expect(recentUtcDates(2, new Date("2026-08-01T00:30:00.000Z"))).toEqual([
      "2026-07-31",
      "2026-08-01",
    ])
  })
})

describe("getDailyActiveUsers", () => {
  it("counts one distinct user per row per day and zero-fills quiet days", async () => {
    // One row per (user, day) is the table's invariant, so counting rows per
    // day is the distinct-user count.
    tableData.user_daily_activity = [
      { activity_date: "2026-07-21", user_id: "u1" },
      { activity_date: "2026-07-21", user_id: "u2" },
      { activity_date: "2026-07-20", user_id: "u1" },
    ]

    expect(await getDailyActiveUsers(3, NOW)).toEqual([
      { date: "2026-07-19", count: 0 },
      { date: "2026-07-20", count: 1 },
      { date: "2026-07-21", count: 2 },
    ])
  })

  it("excludes admin users from the daily counts", async () => {
    // u2 is an admin, so their activity must not be counted — the chart is
    // about real end users, not admins signing in to inspect the app.
    tableData.user_daily_activity = [
      { activity_date: "2026-07-21", user_id: "u1" },
      { activity_date: "2026-07-21", user_id: "u2" },
      { activity_date: "2026-07-20", user_id: "u2" },
    ]
    tableData.users = [{ id: "u2" }]

    expect(await getDailyActiveUsers(3, NOW)).toEqual([
      { date: "2026-07-19", count: 0 },
      { date: "2026-07-20", count: 0 },
      { date: "2026-07-21", count: 1 },
    ])
  })
})

describe("getVideosAnalysedByDay", () => {
  it("splits light vs deep, buckets on the UTC day, and zero-fills", async () => {
    tableData.analysed_videos = [
      { date_analysed: "2026-07-21T03:00:00.000Z" },
      { date_analysed: "2026-07-21T20:00:00.000Z" },
      { date_analysed: "2026-07-19T10:00:00.000Z" },
    ]
    tableData.source_files = [
      // Late-UTC timestamp must stay on its own UTC day, not shift a day.
      { created_at: "2026-07-20T23:30:00.000Z" },
      { created_at: "2026-07-21T00:30:00.000Z" },
    ]

    expect(await getVideosAnalysedByDay(3, NOW)).toEqual([
      { date: "2026-07-19", light: 1, deep: 0 },
      { date: "2026-07-20", light: 0, deep: 1 },
      { date: "2026-07-21", light: 2, deep: 1 },
    ])
  })
})
