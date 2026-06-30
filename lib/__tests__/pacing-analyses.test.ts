import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import {
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
