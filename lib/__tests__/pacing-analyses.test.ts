import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getOrGeneratePacingAnalysis,
  getPacingAnalysis,
  savePacingAnalysis,
} from "@/lib/pacing-analyses"
import type { PacingAnalysis } from "@/lib/pacing-analysis"

const pacingAnalysis: PacingAnalysis = {
  overallPacing: "Fast opening, followed by a measured explanation.",
  videoWidePatterns: ["The pace settles after the hook."],
  notableTransitions: [{ atSeconds: 30, description: "The setup begins." }],
  slowOrRepetitiveStretches: [],
  windows: [
    {
      id: "hook",
      label: "Hook",
      kind: "hook",
      startSeconds: 0,
      endSeconds: 30,
      wordCount: 75,
      wordsPerMinute: 150,
      role: "Introduces the premise",
      pace: "fast",
      informationDensity: "high",
      progression: "strong",
      pacingChange: "stable",
      evidence: ["The premise arrives immediately."],
      possibleIssue: null,
      confidence: 0.9,
    },
  ],
  model: "test-gpt",
  generatedAt: "2026-06-30T12:00:00.000Z",
}

describe("savePacingAnalysis", () => {
  it("upserts the report and its typed window rows", async () => {
    let savedAnalysis: Record<string, unknown> | undefined
    let savedWindows: Array<Record<string, unknown>> | undefined
    let staleFromIndex: number | undefined

    const deleteBuilder = {
      eq: () => deleteBuilder,
      gte: async (_column: string, value: number) => {
        staleFromIndex = value
        return { error: null }
      },
    }
    const supabase = {
      from: (table: string) => {
        if (table === "pacing_analyses") {
          return {
            upsert: (value: Record<string, unknown>) => {
              savedAnalysis = value
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: "pacing-1" },
                    error: null,
                  }),
                }),
              }
            },
          }
        }
        return {
          upsert: async (value: Array<Record<string, unknown>>) => {
            savedWindows = value
            return { error: null }
          },
          delete: () => deleteBuilder,
        }
      },
    } as unknown as SupabaseClient

    await savePacingAnalysis(
      supabase,
      "user-1",
      "analysed-video-1",
      pacingAnalysis,
    )

    expect(savedAnalysis).toMatchObject({
      analysed_video_id: "analysed-video-1",
      user_id: "user-1",
      model: "test-gpt",
      prompt_version: "v1",
      overall_pacing: pacingAnalysis.overallPacing,
    })
    expect(savedWindows).toMatchObject([
      {
        pacing_analysis_id: "pacing-1",
        user_id: "user-1",
        window_index: 0,
        start_seconds: 0,
        end_seconds: 30,
        words_per_minute: 150,
        pace: "fast",
      },
    ])
    expect(staleFromIndex).toBe(1)
  })
})

describe("getPacingAnalysis", () => {
  it("reconstructs the pacing result from the parent and window tables", async () => {
    const analysisBuilder = {
      select: () => analysisBuilder,
      eq: () => analysisBuilder,
      maybeSingle: async () => ({
        data: {
          id: "pacing-1",
          model: pacingAnalysis.model,
          overall_pacing: pacingAnalysis.overallPacing,
          video_wide_patterns: pacingAnalysis.videoWidePatterns,
          notable_transitions: pacingAnalysis.notableTransitions,
          slow_or_repetitive_stretches:
            pacingAnalysis.slowOrRepetitiveStretches,
          generated_at: pacingAnalysis.generatedAt,
        },
        error: null,
      }),
    }
    const windowBuilder = {
      select: () => windowBuilder,
      eq: () => windowBuilder,
      order: async () => ({
        data: [
          {
            window_index: 0,
            kind: "hook",
            label: "Hook",
            start_seconds: 0,
            end_seconds: 30,
            word_count: 75,
            words_per_minute: 150,
            role: "Introduces the premise",
            pace: "fast",
            information_density: "high",
            progression: "strong",
            pacing_change: "stable",
            evidence: ["The premise arrives immediately."],
            possible_issue: null,
            confidence: 0.9,
          },
        ],
        error: null,
      }),
    }
    const supabase = {
      from: (table: string) =>
        table === "pacing_analyses" ? analysisBuilder : windowBuilder,
    } as unknown as SupabaseClient

    await expect(
      getPacingAnalysis(supabase, "user-1", "analysed-video-1"),
    ).resolves.toEqual(pacingAnalysis)
  })
})

describe("getOrGeneratePacingAnalysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  const video = { title: "Test", durationSeconds: 20 }
  const transcript = [
    { startSeconds: 0, endSeconds: 10, text: "one two three four five" },
  ]

  const modelOutput = {
    overallPacing: "Fast throughout.",
    videoWidePatterns: [],
    notableTransitions: [],
    slowOrRepetitiveStretches: [],
    windows: [
      {
        windowIndex: 0,
        role: "Hook",
        pace: "fast",
        informationDensity: "high",
        progression: "strong",
        pacingChange: "stable",
        evidence: ["Gets to the point immediately."],
        possibleIssue: null,
        confidence: 0.9,
      },
    ],
  }

  // A no-op holder for tables this helper doesn't exercise meaningfully
  // (pacing_windows), so both the read side (getPacingAnalysis's window
  // lookup) and the write side (savePacingAnalysis's upsert/delete) resolve
  // without error.
  function pacingWindowsBuilder() {
    const deleteBuilder = { eq: () => deleteBuilder, gte: async () => ({ error: null }) }
    const readBuilder: Record<string, unknown> = {
      select: () => readBuilder,
      eq: () => readBuilder,
      order: async () => ({ data: [], error: null }),
    }
    return {
      select: () => readBuilder,
      upsert: async () => ({ error: null }),
      delete: () => deleteBuilder,
    }
  }

  function makeFakeSupabase(options: {
    existingAnalysis?: Record<string, unknown> | null
    claimSucceeds?: boolean
  }) {
    const analysedVideoUpdates: Record<string, unknown>[] = []

    const supabase = {
      from(table: string) {
        if (table === "analysed_videos") {
          const builder: Record<string, unknown> = {
            update: (payload: Record<string, unknown>) => {
              analysedVideoUpdates.push(payload)
              builder._payload = payload
              return builder
            },
            eq: () => builder,
            or: () => builder,
            select: () => ({
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({
                  data: options.claimSucceeds === false ? [] : [{ id: "av-1" }],
                  error: null,
                }).then(resolve),
            }),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(resolve),
          }
          return builder
        }
        if (table === "pacing_analyses") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: options.existingAnalysis ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
            upsert: () => ({
              select: () => ({
                single: async () => ({ data: { id: "pacing-1" }, error: null }),
              }),
            }),
          }
        }
        return pacingWindowsBuilder()
      },
    } as unknown as SupabaseClient

    return { supabase, analysedVideoUpdates }
  }

  function stubFetchWithModelOutput() {
    process.env.OPENAI_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              { content: [{ type: "output_text", text: JSON.stringify(modelOutput) }] },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
  }

  it("returns the existing analysis without calling the LLM", async () => {
    const { supabase } = makeFakeSupabase({
      existingAnalysis: {
        id: "pacing-1",
        model: "gpt-5.4-mini",
        overall_pacing: "Already generated.",
        video_wide_patterns: [],
        notable_transitions: [],
        slow_or_repetitive_stretches: [],
        generated_at: "2026-07-01T00:00:00.000Z",
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await getOrGeneratePacingAnalysis(
      supabase,
      "user-1",
      "av-1",
      video,
      transcript,
    )

    expect(result?.overallPacing).toBe("Already generated.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("skips generating when another caller already holds the claim", async () => {
    const { supabase } = makeFakeSupabase({ claimSucceeds: false })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await getOrGeneratePacingAnalysis(
      supabase,
      "user-1",
      "av-1",
      video,
      transcript,
    )

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("claims, generates, saves, and clears the claim on success", async () => {
    const { supabase, analysedVideoUpdates } = makeFakeSupabase({})
    stubFetchWithModelOutput()

    const result = await getOrGeneratePacingAnalysis(
      supabase,
      "user-1",
      "av-1",
      video,
      transcript,
    )

    expect(result?.overallPacing).toBe(modelOutput.overallPacing)
    expect(analysedVideoUpdates).toContainEqual(
      expect.objectContaining({ pacing_analysis_status: "processing" }),
    )
    expect(analysedVideoUpdates).toContainEqual(
      expect.objectContaining({ pacing_analysis_status: null }),
    )
  })

  it("marks the claim failed (not stuck processing) and rethrows when generation errors", async () => {
    const { supabase, analysedVideoUpdates } = makeFakeSupabase({})
    process.env.OPENAI_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    )

    await expect(
      getOrGeneratePacingAnalysis(supabase, "user-1", "av-1", video, transcript),
    ).rejects.toThrow()

    expect(analysedVideoUpdates).toContainEqual(
      expect.objectContaining({ pacing_analysis_status: "failed" }),
    )
  })
})
