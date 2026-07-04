import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  synthesizeRetentionWindowEvents,
  type RetentionWindowEventSynthesizer,
  type WindowEvidence,
} from "@/lib/retention-window-event-synthesis"

const WINDOW_ROW = {
  id: "rw-1",
  kind: "drop_off",
  window_index: 0,
  window_key: null,
  label: null,
  from_seconds: 154,
  to_seconds: 176,
  start_watch_ratio: null,
  end_watch_ratio: null,
  delta: -0.083,
  relative_performance: null,
  steepness: 2.1,
  is_abnormally_steep: true,
  out_of_range: false,
  analysis_from_seconds: 124,
  analysis_to_seconds: 186,
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    retention_window_id: "rw-1",
    chunk_index: 0,
    timestamp_seconds: 150,
    storage_path: "user-1/av-1/rw-1/snapshot-0.jpg",
    status: "ready",
    error: null,
    ocr_text: null,
    analysis_status: "ready",
    analysis: { scene: "talking_head", description: "a person talking" },
    analysis_error: null,
    ...overrides,
  }
}

function audioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aud-1",
    retention_window_id: "rw-1",
    from_seconds: 124,
    to_seconds: 186,
    storage_path: "user-1/av-1/rw-1/audio.mp3",
    status: "ready",
    error: null,
    analysis_status: "ready",
    analysis: { tone: "excited", energy: "high", speech_rate: 148 },
    analysis_error: null,
    ...overrides,
  }
}

// A fake covering exactly the query shapes synthesizeRetentionWindowEvents
// issues: six parallel "select ... for the whole video" reads (canned per
// table), plus delete+insert on retention_window_events and update on
// retention_window_event_synthesis.
function makeFakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const updates: { table: string; id?: string; payload: Record<string, unknown> }[] =
    []
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = []
  const deletes: { table: string }[] = []

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        delete: () => {
          builder._delete = true
          return builder
        },
        insert: (rows: Record<string, unknown>[]) => {
          inserts.push({ table, rows })
          return Promise.resolve({ error: null })
        },
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          return builder
        },
        or: () => builder,
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId,
              payload: builder._payload as Record<string, unknown>,
            })
            return Promise.resolve({
              data: tables[table] ?? [],
              error: null,
            }).then(resolve)
          }
          if (builder._delete) {
            deletes.push({ table })
            return Promise.resolve({ error: null }).then(resolve)
          }
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(
            resolve,
          )
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, updates, inserts, deletes }
}

function fakeSynthesizer(): RetentionWindowEventSynthesizer & {
  synthesize: ReturnType<typeof vi.fn>
} {
  return { synthesize: vi.fn(async () => []) }
}

describe("synthesizeRetentionWindowEvents", () => {
  it("does nothing when there are no pending jobs", async () => {
    const { supabase } = makeFakeSupabase({})
    const synthesizer = fakeSynthesizer()

    await synthesizeRetentionWindowEvents(supabase, "user-1", "av-1", {
      synthesizer,
    })

    expect(synthesizer.synthesize).not.toHaveBeenCalled()
  })

  it("skips a window whose snapshot analysis hasn't settled yet", async () => {
    const { supabase, updates, inserts } = makeFakeSupabase({
      retention_window_event_synthesis: [
        { id: "job-1", retention_window_id: "rw-1", status: "pending", error: null },
      ],
      retention_windows: [WINDOW_ROW],
      retention_window_snapshots: [snapshotRow({ analysis_status: "pending" })],
      retention_window_audio: [audioRow()],
      retention_window_scene_cue_scans: [
        { retention_window_id: "rw-1", status: "ready" },
      ],
      video_scene_cues: [],
      retention_window_transcripts: [
        { id: "t-1", retention_window_id: "rw-1", from_seconds: 124, to_seconds: 186, transcript: "..." },
      ],
    })
    const synthesizer = fakeSynthesizer()

    await synthesizeRetentionWindowEvents(supabase, "user-1", "av-1", {
      synthesizer,
    })

    expect(synthesizer.synthesize).not.toHaveBeenCalled()
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_event_synthesis",
        id: "job-1",
        payload: expect.objectContaining({ status: "pending" }),
      }),
    )
    expect(inserts).toHaveLength(0)
  })

  it("synthesizes without visual evidence when snapshot extraction failed", async () => {
    const { supabase, updates } = makeFakeSupabase({
      retention_window_event_synthesis: [
        { id: "job-1", retention_window_id: "rw-1", status: "pending", error: null },
      ],
      retention_windows: [WINDOW_ROW],
      retention_window_snapshots: [
        snapshotRow({
          status: "failed",
          storage_path: null,
          analysis_status: "pending",
          analysis: null,
        }),
      ],
      retention_window_audio: [audioRow()],
      retention_window_scene_cue_scans: [
        { retention_window_id: "rw-1", status: "ready" },
      ],
      video_scene_cues: [],
      retention_window_transcripts: [],
    })
    const synthesizer = fakeSynthesizer()

    await synthesizeRetentionWindowEvents(supabase, "user-1", "av-1", {
      synthesizer,
    })

    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1)
    expect(synthesizer.synthesize.mock.calls[0][0]).toMatchObject({ visual: [] })
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_event_synthesis",
        id: "job-1",
        payload: expect.objectContaining({ status: "ready" }),
      }),
    )
  })

  it("synthesizes events once every prerequisite has settled, and marks the job ready", async () => {
    const { supabase, updates, inserts, deletes } = makeFakeSupabase({
      retention_window_event_synthesis: [
        { id: "job-1", retention_window_id: "rw-1", status: "pending", error: null },
      ],
      retention_windows: [WINDOW_ROW],
      retention_window_snapshots: [
        snapshotRow({
          id: "snap-1",
          chunk_index: 0,
          timestamp_seconds: 150,
          ocr_text: "SALE 50% OFF",
        }),
        snapshotRow({ id: "snap-2", chunk_index: 1, timestamp_seconds: 158 }),
      ],
      retention_window_audio: [audioRow()],
      retention_window_scene_cue_scans: [
        { retention_window_id: "rw-1", status: "ready" },
      ],
      video_scene_cues: [
        { id: "cue-1", kind: "cut", from_seconds: 154, to_seconds: 154, score: null },
      ],
      retention_window_transcripts: [
        {
          id: "t-1",
          retention_window_id: "rw-1",
          from_seconds: 124,
          to_seconds: 186,
          transcript: "we made five thousand dollars last month",
        },
      ],
    })
    const synthesizer = fakeSynthesizer()
    synthesizer.synthesize.mockResolvedValueOnce([
      {
        eventType: "scene_cut",
        timestampSeconds: 154,
        narrative: "A hard cut lands right at the drop.",
        primaryEvidence: "editing",
      },
    ])

    await synthesizeRetentionWindowEvents(supabase, "user-1", "av-1", {
      synthesizer,
    })

    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1)
    const evidence = synthesizer.synthesize.mock.calls[0][0] as WindowEvidence
    expect(evidence.kind).toBe("drop_off")
    expect(evidence.delta).toBe(-0.083)
    expect(evidence.fromSeconds).toBe(124)
    expect(evidence.toSeconds).toBe(186)
    expect(evidence.transcript).toBe("we made five thousand dollars last month")
    expect(evidence.editing.cutCount).toBe(1)
    expect(evidence.visual).toHaveLength(2)
    expect(evidence.visual[0].ocrText).toBe("SALE 50% OFF")
    expect(evidence.visual[1].ocrText).toBeNull()
    expect(evidence.audio).toMatchObject({ tone: "excited", speech_rate: 148 })

    expect(deletes).toContainEqual({ table: "retention_window_events" })
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "retention_window_events",
        rows: [
          expect.objectContaining({
            retention_window_id: "rw-1",
            event_type: "scene_cut",
            timestamp_seconds: 154,
          }),
        ],
      }),
    )
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_event_synthesis",
        id: "job-1",
        payload: expect.objectContaining({ status: "ready" }),
      }),
    )
  })

  it("marks the job failed when the synthesizer throws, without writing any events", async () => {
    const { supabase, updates, inserts } = makeFakeSupabase({
      retention_window_event_synthesis: [
        { id: "job-1", retention_window_id: "rw-1", status: "pending", error: null },
      ],
      retention_windows: [WINDOW_ROW],
      retention_window_snapshots: [snapshotRow()],
      retention_window_audio: [audioRow()],
      retention_window_scene_cue_scans: [
        { retention_window_id: "rw-1", status: "ready" },
      ],
      video_scene_cues: [],
      retention_window_transcripts: [],
    })
    const synthesizer = fakeSynthesizer()
    synthesizer.synthesize.mockRejectedValueOnce(new Error("OpenAI request failed"))

    await synthesizeRetentionWindowEvents(supabase, "user-1", "av-1", {
      synthesizer,
    })

    expect(inserts).toHaveLength(0)
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
