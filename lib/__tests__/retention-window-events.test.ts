import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createPendingRetentionWindowEventSynthesis,
  getPendingRetentionWindowEventSynthesisJobs,
  getRetentionWindowEvents,
  replaceRetentionWindowEvents,
  updateRetentionWindowEventSynthesisStatus,
  type SynthesizedEvent,
} from "@/lib/retention-window-events"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

function makeWindow(
  overrides: Partial<PersistedRetentionWindow> = {},
): PersistedRetentionWindow {
  return {
    id: "rw-1",
    kind: "drop_off",
    windowIndex: 0,
    windowKey: null,
    label: null,
    fromSeconds: 154,
    toSeconds: 176,
    startWatchRatio: null,
    endWatchRatio: null,
    delta: -0.083,
    relativePerformance: null,
    steepness: 2.1,
    isAbnormallySteep: true,
    outOfRange: false,
    analysisFromSeconds: 124,
    analysisToSeconds: 186,
    ...overrides,
  }
}

// A minimal chainable fake of the Supabase query builder, covering the
// upsert/delete/select/update/insert/or shapes these functions issue.
function makeFakeSupabase(seedRows: Record<string, unknown>[] = []) {
  const upserts: Record<string, Record<string, unknown>[]> = {}
  const inserts: Record<string, Record<string, unknown>[]> = {}
  const updates: { table: string; id?: string; payload: Record<string, unknown> }[] =
    []
  const deletes: { table: string; ids?: string[] }[] = []
  const orCalls: { table: string; expr: string }[] = []

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      const builder: Record<string, unknown> = {
        upsert: (rows: Record<string, unknown>[]) => {
          upserts[table] = rows
          return Promise.resolve({ error: null })
        },
        insert: (rows: Record<string, unknown>[]) => {
          inserts[table] = rows
          return Promise.resolve({ error: null })
        },
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        delete: () => {
          builder._delete = true
          return builder
        },
        select: () => {
          builder._select = true
          return builder
        },
        order: () => builder,
        or: (expr: string) => {
          orCalls.push({ table, expr })
          return builder
        },
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          return builder
        },
        in: (_column: string, ids: string[]) => {
          deletes.push({ table, ids })
          return Promise.resolve({ error: null })
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId,
              payload: builder._payload as Record<string, unknown>,
            })
            return Promise.resolve({ error: null }).then(resolve)
          }
          if (builder._delete) {
            deletes.push({ table })
            return Promise.resolve({ error: null }).then(resolve)
          }
          return Promise.resolve({ data: seedRows, error: null }).then(resolve)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, upserts, inserts, updates, deletes, orCalls }
}

describe("createPendingRetentionWindowEventSynthesis", () => {
  it("creates one pending job per window with an analysis window", async () => {
    const { supabase, upserts } = makeFakeSupabase()

    await createPendingRetentionWindowEventSynthesis(supabase, "user-1", "av-1", [
      makeWindow(),
    ])

    const rows = upserts["retention_window_event_synthesis"]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      retention_window_id: "rw-1",
      status: "pending",
    })
  })

  it("skips windows with no analysis window", async () => {
    const { supabase, upserts } = makeFakeSupabase()
    const window = makeWindow({
      analysisFromSeconds: null,
      analysisToSeconds: null,
    })

    await createPendingRetentionWindowEventSynthesis(supabase, "user-1", "av-1", [
      window,
    ])

    expect(upserts["retention_window_event_synthesis"]).toBeUndefined()
  })
})

describe("getPendingRetentionWindowEventSynthesisJobs", () => {
  it("maps pending rows to their camelCase shape", async () => {
    const { supabase } = makeFakeSupabase([
      { id: "job-1", retention_window_id: "rw-1", status: "pending", error: null },
    ])

    const jobs = await getPendingRetentionWindowEventSynthesisJobs(
      supabase,
      "user-1",
      "av-1",
    )

    expect(jobs).toEqual([
      { id: "job-1", retentionWindowId: "rw-1", status: "pending", error: null },
    ])
  })

  it("retries a failure long enough ago, not just pending jobs", async () => {
    const { supabase, orCalls } = makeFakeSupabase([])

    await getPendingRetentionWindowEventSynthesisJobs(supabase, "user-1", "av-1")

    const call = orCalls.find(
      (c) => c.table === "retention_window_event_synthesis",
    )
    expect(call?.expr).toContain("status.eq.pending")
    expect(call?.expr).toContain("status.eq.failed")
    expect(call?.expr).toContain("updated_at.lt.")
  })
})

describe("updateRetentionWindowEventSynthesisStatus", () => {
  it("records the model and clears any prior error when marking ready", async () => {
    const { supabase, updates } = makeFakeSupabase()

    await updateRetentionWindowEventSynthesisStatus(supabase, "user-1", "job-1", {
      status: "ready",
      model: "gpt-5.4-mini",
    })

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_event_synthesis",
        id: "job-1",
        payload: expect.objectContaining({
          status: "ready",
          error: null,
          model: "gpt-5.4-mini",
        }),
      }),
    )
  })

  it("records the error message when marking failed", async () => {
    const { supabase, updates } = makeFakeSupabase()

    await updateRetentionWindowEventSynthesisStatus(supabase, "user-1", "job-1", {
      status: "failed",
      error: "OpenAI request failed",
    })

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_event_synthesis",
        id: "job-1",
        payload: expect.objectContaining({
          status: "failed",
          error: "OpenAI request failed",
        }),
      }),
    )
  })
})

describe("replaceRetentionWindowEvents", () => {
  it("clears previous events and inserts the fresh set in order", async () => {
    const { supabase, inserts, deletes } = makeFakeSupabase()
    const events: SynthesizedEvent[] = [
      {
        eventType: "scene_cut",
        timestampSeconds: 160,
        narrative: "A hard cut coincides with the drop.",
        primaryEvidence: "editing",
      },
      {
        eventType: "topic_shift",
        timestampSeconds: 168,
        narrative: "The speaker changes topic right after.",
        primaryEvidence: "transcript",
      },
    ]

    await replaceRetentionWindowEvents(supabase, "user-1", "av-1", "rw-1", events)

    expect(deletes).toContainEqual({ table: "retention_window_events" })
    expect(inserts["retention_window_events"]).toEqual([
      expect.objectContaining({
        retention_window_id: "rw-1",
        event_index: 0,
        event_type: "scene_cut",
        timestamp_seconds: 160,
        primary_evidence: "editing",
      }),
      expect.objectContaining({
        retention_window_id: "rw-1",
        event_index: 1,
        event_type: "topic_shift",
        timestamp_seconds: 168,
        primary_evidence: "transcript",
      }),
    ])
  })

  it("skips the insert when there are no events", async () => {
    const { supabase, inserts } = makeFakeSupabase()

    await replaceRetentionWindowEvents(supabase, "user-1", "av-1", "rw-1", [])

    expect(inserts["retention_window_events"]).toBeUndefined()
  })
})

describe("getRetentionWindowEvents", () => {
  it("maps rows to their camelCase shape", async () => {
    const { supabase } = makeFakeSupabase([
      {
        id: "ev-1",
        retention_window_id: "rw-1",
        event_index: 0,
        event_type: "scene_cut",
        timestamp_seconds: 160,
        narrative: "A hard cut coincides with the drop.",
        primary_evidence: "editing",
      },
    ])

    const events = await getRetentionWindowEvents(supabase, "user-1", "av-1")

    expect(events).toEqual([
      {
        id: "ev-1",
        retentionWindowId: "rw-1",
        eventIndex: 0,
        eventType: "scene_cut",
        timestampSeconds: 160,
        narrative: "A hard cut coincides with the drop.",
        primaryEvidence: "editing",
      },
    ])
  })
})
