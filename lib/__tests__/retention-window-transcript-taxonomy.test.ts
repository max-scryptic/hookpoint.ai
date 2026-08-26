import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { zeroCost } from "@/lib/llm-cost"
import {
  analyzeRetentionWindowTranscriptTaxonomies,
  isWindowTranscriptTaxonomyOutput,
  type RetentionWindowTranscriptTaxonomyDeps,
  type WindowTranscriptTaxonomy,
} from "@/lib/retention-window-transcript-taxonomy"

// A valid model output for the taxonomy schema (the "none" sentinel is a legal
// persuasion-device value the normaliser strips on the way in).
function validModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    momentSummary: "the uploader lays out the plan for the video",
    detail: {
      content: {
        substanceDensity: 6,
        concreteness: 7,
        novelty: 4,
        clarity: 8,
      },
      emotion: {
        dominantEmotion: "curiosity",
        energy: 5,
        trajectory: "rising",
        vulnerability: 2,
      },
      rhetoric: {
        narrativeVoice: "second_person_guide",
        directAddress: 7,
        persuasionDevices: ["storytelling", "none"],
        stakes: 4,
        posesQuestion: true,
      },
      flow: {
        topicShift: 3,
        openLoopOpened: true,
        openLoopResolved: false,
        hasCta: false,
        fillerLevel: 2,
      },
      primaryEngagementDriver: "information",
    },
    ...overrides,
  }
}

describe("isWindowTranscriptTaxonomyOutput", () => {
  it("accepts a well-formed model output", () => {
    expect(isWindowTranscriptTaxonomyOutput(validModelOutput())).toBe(true)
  })

  it("rejects an unknown enum value", () => {
    const bad = validModelOutput()
    ;(bad.detail.emotion as Record<string, unknown>).dominantEmotion = "elated"
    expect(isWindowTranscriptTaxonomyOutput(bad)).toBe(false)
  })

  it("rejects an out-of-range ordinal", () => {
    const bad = validModelOutput()
    ;(bad.detail.content as Record<string, unknown>).clarity = 11
    expect(isWindowTranscriptTaxonomyOutput(bad)).toBe(false)
  })

  it("rejects a missing block", () => {
    const bad = validModelOutput()
    delete (bad.detail as Record<string, unknown>).flow
    expect(isWindowTranscriptTaxonomyOutput(bad)).toBe(false)
  })
})

// One retention window row (matching the retention_windows select mapper) so
// the orchestrator can resolve the claimed transcript row's window kind.
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

function transcriptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rwt-1",
    retention_window_id: "rw-1",
    from_seconds: 124,
    to_seconds: 186,
    transcript: "here is the plan for todays video",
    taxonomy_status: "pending",
    taxonomy: null,
    taxonomy_error: null,
    taxonomy_model: null,
    ...overrides,
  }
}

// A fake covering the query shapes analyzeRetentionWindowTranscriptTaxonomies
// issues: the claim (update->select on transcripts), the retention_windows read,
// the per-row taxonomy update, and the cost upsert / cost_logs insert.
function makeFakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const updates: { table: string; id?: string; payload: Record<string, unknown> }[] =
    []
  const upserts: { table: string; row: Record<string, unknown> }[] = []
  const inserts: { table: string; row: Record<string, unknown> }[] = []

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row })
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
        neq: () => builder,
        or: () => builder,
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId,
              payload: builder._payload as Record<string, unknown>,
            })
            // The claim is an update-and-return: it resolves with the table's
            // rows. A per-row status update has an id and resolves empty.
            return Promise.resolve({
              data: pendingId ? [] : tables[table] ?? [],
              error: null,
            }).then(resolve)
          }
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(
            resolve,
          )
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, updates, upserts, inserts }
}

function fakeTaxonomy(): WindowTranscriptTaxonomy {
  return {
    momentSummary: "the uploader lays out the plan",
    detail: {
      content: { substanceDensity: 6, concreteness: 7, novelty: 4, clarity: 8 },
      emotion: {
        dominantEmotion: "curiosity",
        energy: 5,
        trajectory: "rising",
        vulnerability: 2,
      },
      rhetoric: {
        narrativeVoice: "second_person_guide",
        directAddress: 7,
        persuasionDevices: ["storytelling"],
        stakes: 4,
        posesQuestion: true,
      },
      flow: {
        topicShift: 3,
        openLoopOpened: true,
        openLoopResolved: false,
        hasCta: false,
        fillerLevel: 2,
      },
      primaryEngagementDriver: "information",
    },
    wordCount: 7,
    schemaVersion: 1,
    model: "fake-model",
    generatedAt: "2026-07-26T00:00:00.000Z",
  }
}

describe("analyzeRetentionWindowTranscriptTaxonomies", () => {
  it("generates, stores and costs a taxonomy for a claimed window", async () => {
    const { supabase, updates, upserts } = makeFakeSupabase({
      retention_window_transcripts: [transcriptRow()],
      retention_windows: [WINDOW_ROW],
    })
    const generate = vi.fn(async () => ({
      taxonomy: fakeTaxonomy(),
      cost: zeroCost("fake-model"),
    }))
    const deps: RetentionWindowTranscriptTaxonomyDeps = {
      generator: { generate },
    }

    await analyzeRetentionWindowTranscriptTaxonomies(
      supabase,
      "user-1",
      "av-1",
      deps,
    )

    // The window's kind was resolved and handed to the generator.
    expect(generate).toHaveBeenCalledWith({
      kind: "drop_off",
      transcript: "here is the plan for todays video",
    })

    const ready = updates.find(
      (u) => u.payload.taxonomy_status === "ready" && u.id === "rwt-1",
    )
    expect(ready).toBeDefined()
    expect(ready?.payload.taxonomy).toMatchObject({ schemaVersion: 1 })
    expect(ready?.payload.taxonomy_model).toBe("fake-model")

    const cost = upserts.find((u) => u.table === "retention_window_costs")
    expect(cost?.row).toMatchObject({
      step: "transcript_taxonomy",
      retention_window_id: "rw-1",
    })
  })

  it("marks an empty-transcript window skipped without costing it", async () => {
    const { supabase, updates, upserts } = makeFakeSupabase({
      retention_window_transcripts: [transcriptRow({ transcript: "" })],
      retention_windows: [WINDOW_ROW],
    })
    // An empty transcript yields no taxonomy - the generator returns null.
    const generate = vi.fn(async () => null)
    const deps: RetentionWindowTranscriptTaxonomyDeps = {
      generator: { generate },
    }

    await analyzeRetentionWindowTranscriptTaxonomies(
      supabase,
      "user-1",
      "av-1",
      deps,
    )

    const skipped = updates.find(
      (u) => u.payload.taxonomy_status === "skipped" && u.id === "rwt-1",
    )
    expect(skipped).toBeDefined()
    expect(upserts.find((u) => u.table === "retention_window_costs")).toBeUndefined()
  })
})
