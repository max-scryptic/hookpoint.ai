import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildWindowContrastRanges,
  dedupeAdjacentVisualFrames,
  synthesizeRetentionWindowEvents,
  type RetentionWindowEventSynthesizer,
  type WindowEvidence,
} from "@/lib/retention-window-event-synthesis"
import { zeroCost } from "@/lib/llm-cost"
import type { SnapshotAnalysis } from "@/lib/retention-window-media-analysis"

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
  const upserts: { table: string; row: Record<string, unknown> }[] = []

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
        upsert: (row: Record<string, unknown>) => {
          upserts.push({ table, row })
          return Promise.resolve({ error: null })
        },
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          return builder
        },
        // getRetentionAttribution reads a single analysed_videos row; there's
        // no seeded retention_attribution here, so it resolves to null and the
        // synthesizer just runs without a script-explanation dedup reference.
        maybeSingle: () =>
          Promise.resolve({ data: tables[table]?.[0] ?? null, error: null }),
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

  return { supabase, updates, inserts, deletes, upserts }
}

function fakeSynthesizer(): RetentionWindowEventSynthesizer & {
  synthesize: ReturnType<typeof vi.fn>
} {
  return {
    synthesize: vi.fn(async () => ({
      events: [],
      cost: zeroCost("fake-synth-model"),
    })),
  }
}

function visualFrame(
  overrides: Omit<Partial<WindowEvidence["visual"][number]>, "analysis"> & {
    analysis?: Partial<SnapshotAnalysis>
  } = {},
): WindowEvidence["visual"][number] {
  const { analysis: analysisOverrides, ...rest } = overrides
  return {
    chunkIndex: 0,
    timestampSeconds: 48,
    ocrText: null,
    analysis: {
      scene: "talking_head",
      face_visible: true,
      contains_text: false,
      contains_code: false,
      motion: "moderate",
      people_count: 1,
      camera_movement: "static",
      notable_event: null,
      description: "a person talking to camera",
      ...analysisOverrides,
    },
    ...rest,
  }
}

describe("dedupeAdjacentVisualFrames", () => {
  it("collapses a run of frames with identical categorical judgments", () => {
    // The reported talking-head case: four consecutive frames whose only
    // differences are the free-text notable_event/description narrating micro-
    // motion. They collapse to the first frame.
    const frames = [
      visualFrame({
        chunkIndex: 0,
        timestampSeconds: 48,
        analysis: { notable_event: "squinting", description: "eyes shut" },
      }),
      visualFrame({
        chunkIndex: 1,
        timestampSeconds: 49,
        analysis: { notable_event: "head dips", description: "leaning in" },
      }),
      visualFrame({
        chunkIndex: 2,
        timestampSeconds: 50,
        analysis: { notable_event: "tighter squint", description: "angled head" },
      }),
    ]

    const deduped = dedupeAdjacentVisualFrames(frames)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].timestampSeconds).toBe(48)
  })

  it("keeps frames that differ in a categorical field or OCR text", () => {
    const frames = [
      visualFrame({ chunkIndex: 0, analysis: { camera_movement: "static" } }),
      // A real cut's far side: the model tagged the movement, so it stays.
      visualFrame({ chunkIndex: 1, analysis: { camera_movement: "cut" } }),
      // Back to static but now a graphic's OCR text appears — still distinct.
      visualFrame({
        chunkIndex: 2,
        ocrText: "SALE 50% OFF",
        analysis: { camera_movement: "static", contains_text: true },
      }),
    ]

    expect(dedupeAdjacentVisualFrames(frames)).toHaveLength(3)
  })

  it("only collapses adjacent duplicates, not a later recurrence", () => {
    const frames = [
      visualFrame({ chunkIndex: 0, analysis: { scene: "talking_head" } }),
      visualFrame({ chunkIndex: 1, analysis: { scene: "screen_recording" } }),
      visualFrame({ chunkIndex: 2, analysis: { scene: "talking_head" } }),
    ]

    // The first and third match but aren't adjacent, so all three survive.
    expect(dedupeAdjacentVisualFrames(frames)).toHaveLength(3)
  })

  it("returns an empty array unchanged", () => {
    expect(dedupeAdjacentVisualFrames([])).toEqual([])
  })
})

describe("buildWindowContrastRanges", () => {
  it("uses an equally sized preceding control for a longer episode", () => {
    expect(
      buildWindowContrastRanges({
        kind: "drop_off",
        eventFromSeconds: 100,
        eventToSeconds: 120,
        analysisFromSeconds: 70,
        analysisToSeconds: 130,
      }),
    ).toEqual({
      controlRange: { fromSeconds: 80, toSeconds: 100 },
      targetRange: { fromSeconds: 100, toSeconds: 120 },
    })
  })

  it("uses a ten-second minimum control and clamps it to harvested footage", () => {
    expect(
      buildWindowContrastRanges({
        kind: "gain",
        eventFromSeconds: 8,
        eventToSeconds: 10,
        analysisFromSeconds: 3,
        analysisToSeconds: 30,
      }),
    ).toEqual({
      controlRange: { fromSeconds: 3, toSeconds: 8 },
      targetRange: { fromSeconds: 8, toSeconds: 10 },
    })
  })

  it("does not invent a control for the opening hook", () => {
    expect(
      buildWindowContrastRanges({
        kind: "hook",
        eventFromSeconds: 0,
        eventToSeconds: 10,
        analysisFromSeconds: 0,
        analysisToSeconds: 30,
      }),
    ).toBeNull()
  })
})

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
    const { supabase, updates, inserts, deletes, upserts } = makeFakeSupabase({
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
      retention_window_audio: [
        audioRow({
          analysis: {
            tone: "excited",
            energy: "high",
            speech_rate: 148,
            signal_timeline: [
              {
                from_seconds: 149,
                to_seconds: 154,
                average_volume: -22,
                silence: 0.2,
              },
              {
                from_seconds: 154,
                to_seconds: 159,
                average_volume: -16,
                silence: 0,
              },
            ],
          },
        }),
      ],
      retention_window_scene_cue_scans: [
        {
          retention_window_id: "rw-1",
          status: "ready",
          motion_buckets: [
            { fromSeconds: 149, toSeconds: 154, score: 0.05 },
            { fromSeconds: 154, toSeconds: 159, score: 0.2 },
          ],
        },
      ],
      video_scene_cues: [
        {
          id: "cue-1",
          retention_window_id: "rw-1",
          kind: "cut",
          from_seconds: 154,
          to_seconds: 154,
          score: null,
        },
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
      analysed_videos: [
        {
          transcript: [
            { startSeconds: 149, endSeconds: 153, text: "slow setup here" },
            {
              startSeconds: 155,
              endSeconds: 159,
              text: "now several much faster words arrive together",
            },
          ],
        },
      ],
    })
    const synthesizer = fakeSynthesizer()
    synthesizer.synthesize.mockResolvedValueOnce({
      events: [
        {
          eventType: "scene_cut",
          timestampSeconds: 154,
          narrative: "A hard cut lands right at the drop.",
          primaryEvidence: "editing",
          confidence: 0.82,
        },
      ],
      cost: zeroCost("fake-synth-model"),
    })

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
    expect(evidence.contrast).toMatchObject({
      controlRange: { fromSeconds: 132, toSeconds: 154 },
      targetRange: { fromSeconds: 154, toSeconds: 176 },
      controlEditing: { cutCount: 0, cutsPerMinute: 0 },
      targetEditing: { cutCount: 1 },
    })
    expect(evidence.contrast?.controlVisualChunkIndexes).toEqual([0])
    expect(evidence.contrast?.targetVisualChunkIndexes).toEqual([1])
    expect(evidence.contrast?.controlAudio).toMatchObject({
      averageVolumeDb: -22,
      silence: 0.2,
    })
    expect(evidence.contrast?.targetAudio).toMatchObject({
      averageVolumeDb: -16,
      silence: 0,
    })
    expect(evidence.contrast?.audioDelta.averageVolumeDb).toBe(6)
    expect(evidence.contrast?.controlMotion).toBeCloseTo(0.05)
    expect(evidence.contrast?.targetMotion).toBeCloseTo(0.2)
    expect(evidence.contrast?.motionDelta).toBeCloseTo(0.15)

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
    expect(upserts).toContainEqual(
      expect.objectContaining({
        table: "retention_window_costs",
        row: expect.objectContaining({
          retention_window_id: "rw-1",
          step: "event_synthesis",
        }),
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
