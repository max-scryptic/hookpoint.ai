import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { saveRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import type { TranscriptCue } from "@/lib/youtube/youtube"

// A minimal chainable fake of the Supabase query builder, just enough to
// capture what saveRetentionWindowTranscripts writes to the table.
function makeFakeSupabase() {
  const upserts: Record<string, Record<string, unknown>[]> = {}
  const deletes: { table: string; ids?: string[] }[] = []

  const supabase = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        upsert: (rows: Record<string, unknown>[]) => {
          upserts[table] = rows
          return Promise.resolve({ data: rows, error: null })
        },
        delete: () => builder,
        eq: () => builder,
        in: (_column: string, ids: string[]) => {
          deletes.push({ table, ids })
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, upserts, deletes }
}

function makeWindow(
  overrides: Partial<PersistedRetentionWindow> = {},
): PersistedRetentionWindow {
  return {
    id: "rw-1",
    kind: "drop_off",
    windowIndex: 0,
    windowKey: null,
    label: null,
    fromSeconds: 58,
    toSeconds: 62,
    startWatchRatio: null,
    endWatchRatio: null,
    delta: -0.2,
    relativePerformance: null,
    steepness: null,
    isAbnormallySteep: null,
    outOfRange: false,
    analysisFromSeconds: 30,
    analysisToSeconds: 70,
    ...overrides,
  }
}

const cues: TranscriptCue[] = [
  { startSeconds: 0, endSeconds: 10, text: "before the window" },
  { startSeconds: 35, endSeconds: 40, text: "leading into the drop" },
  { startSeconds: 55, endSeconds: 65, text: "the drop-off moment itself" },
  { startSeconds: 90, endSeconds: 95, text: "long after the window" },
]

describe("saveRetentionWindowTranscripts", () => {
  it("clips the transcript to each window's analysis range and upserts it", async () => {
    const { supabase, upserts } = makeFakeSupabase()
    const window = makeWindow()

    await saveRetentionWindowTranscripts(
      supabase,
      "user-1",
      "av-1",
      [window],
      cues,
    )

    const rows = upserts["retention_window_transcripts"]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      retention_window_id: "rw-1",
      from_seconds: 30,
      to_seconds: 70,
      transcript: "leading into the drop the drop-off moment itself",
      // A lone window is inside the deep-analysis budget, so it is marked for a
      // per-window transcript taxonomy, with any prior read cleared.
      taxonomy_status: "pending",
      taxonomy: null,
      taxonomy_error: null,
      taxonomy_model: null,
    })
  })

  it("only marks the deep-analysis-selected windows for a taxonomy", async () => {
    const previous = process.env.DEEP_ANALYSIS_MAX_WINDOWS
    process.env.DEEP_ANALYSIS_MAX_WINDOWS = "1"
    try {
      const { supabase, upserts } = makeFakeSupabase()
      // With a budget of one, the mandatory hook is kept and the drop-off is
      // not — so only the hook's row is pended for a taxonomy; the drop-off's
      // stays null ("not part of deep analysis").
      const hook = makeWindow({ id: "hook-1", kind: "hook", windowIndex: 0 })
      const dropOff = makeWindow({ id: "drop-1", kind: "drop_off" })

      await saveRetentionWindowTranscripts(
        supabase,
        "user-1",
        "av-1",
        [hook, dropOff],
        cues,
      )

      const rows = upserts["retention_window_transcripts"]
      const byId = new Map(rows.map((row) => [row.retention_window_id, row]))
      expect(byId.get("hook-1")).toMatchObject({ taxonomy_status: "pending" })
      expect(byId.get("drop-1")).toMatchObject({ taxonomy_status: null })
    } finally {
      if (previous == null) delete process.env.DEEP_ANALYSIS_MAX_WINDOWS
      else process.env.DEEP_ANALYSIS_MAX_WINDOWS = previous
    }
  })

  it("skips windows with no analysis window and prunes any stale row", async () => {
    const { supabase, upserts, deletes } = makeFakeSupabase()
    const window = makeWindow({
      id: "rw-2",
      analysisFromSeconds: null,
      analysisToSeconds: null,
    })

    await saveRetentionWindowTranscripts(
      supabase,
      "user-1",
      "av-1",
      [window],
      cues,
    )

    expect(upserts["retention_window_transcripts"]).toBeUndefined()
    expect(deletes).toEqual([
      { table: "retention_window_transcripts", ids: ["rw-2"] },
    ])
  })
})
