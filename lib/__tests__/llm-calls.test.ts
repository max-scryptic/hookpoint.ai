import { afterEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  COST_TYPE_LABELS,
  COST_TYPES,
  LLM_CALL_TYPES,
  LLM_CALL_TYPE_LABELS,
  recordCostLog,
  recordLlmCallCost,
  recordTranscodingCall,
} from "@/lib/llm-calls"

// A minimal fake service-role client that captures cost_logs inserts. `result`
// lets a test force the insert to report an error; `throwOnFrom` forces `from`
// to throw, standing in for a client that blows up entirely.
function fakeClient(options: {
  result?: { error: { message: string } | null }
  throwOnFrom?: boolean
} = {}) {
  const inserts: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      if (options.throwOnFrom) throw new Error("boom")
      expect(table).toBe("cost_logs")
      return {
        insert: async (payload: Record<string, unknown>) => {
          inserts.push(payload)
          return options.result ?? { error: null }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, inserts }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("cost log labels", () => {
  it("has a human label for every cost type", () => {
    for (const type of COST_TYPES) {
      expect(COST_TYPE_LABELS[type]).toBeTruthy()
    }
  })

  it("has a human label for every call type", () => {
    for (const type of LLM_CALL_TYPES) {
      expect(LLM_CALL_TYPE_LABELS[type]).toBeTruthy()
    }
  })

  it("no longer treats transcoding as a call type", () => {
    expect((LLM_CALL_TYPES as readonly string[]).includes("transcoding")).toBe(
      false,
    )
  })
})

describe("recordCostLog", () => {
  it("inserts a normalised row, defaulting provider and clamping tokens", async () => {
    const { client, inserts } = fakeClient()

    await recordCostLog(
      {
        userId: "user-1",
        analysedVideoId: "video-1",
        costType: "llm_call",
        callType: "pacing",
        model: "gpt-4.1-mini",
        inputTokens: 10.6,
        outputTokens: -5,
        costUsd: 0.0123,
      },
      client,
    )

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      user_id: "user-1",
      analysed_video_id: "video-1",
      cost_type: "llm_call",
      call_type: "pacing",
      provider: "openai",
      model: "gpt-4.1-mini",
      input_tokens: 11,
      output_tokens: 0,
      cost_usd: 0.0123,
    })
    // created_at is left to the database default when not supplied.
    expect(inserts[0]).not.toHaveProperty("created_at")
  })

  it("defaults call_type to null when absent", async () => {
    const { client, inserts } = fakeClient()
    await recordCostLog(
      { costType: "qencode_transcode", provider: "qencode", costUsd: 0.15 },
      client,
    )
    expect(inserts[0].call_type).toBeNull()
  })

  it("passes through an explicit created_at", async () => {
    const { client, inserts } = fakeClient()
    await recordCostLog(
      {
        costType: "llm_call",
        callType: "snapshot",
        costUsd: 0,
        createdAt: "2026-07-21T10:00:00.000Z",
      },
      client,
    )
    expect(inserts[0].created_at).toBe("2026-07-21T10:00:00.000Z")
  })

  it("never throws when the insert reports an error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = fakeClient({ result: { error: { message: "nope" } } })

    await expect(
      recordCostLog({ costType: "llm_call", callType: "audio", costUsd: 1 }, client),
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })

  it("never throws when the client itself blows up", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = fakeClient({ throwOnFrom: true })

    await expect(
      recordCostLog({ costType: "llm_call", callType: "audio", costUsd: 1 }, client),
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })
})

describe("recordLlmCallCost", () => {
  it("records an llm_call cost with its call type", async () => {
    const { client, inserts } = fakeClient()

    await recordLlmCallCost(
      "event_synthesis",
      {
        model: "gpt-4.1-mini",
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.002,
      },
      { userId: "user-2", analysedVideoId: "video-2" },
      client,
    )

    expect(inserts[0]).toMatchObject({
      cost_type: "llm_call",
      call_type: "event_synthesis",
      provider: "openai",
      model: "gpt-4.1-mini",
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.002,
      user_id: "user-2",
      analysed_video_id: "video-2",
    })
  })
})

describe("recordTranscodingCall", () => {
  it("records a qencode_transcode cost with no call type, model or tokens", async () => {
    const { client, inserts } = fakeClient()

    await recordTranscodingCall(
      0.15,
      { userId: "user-3", analysedVideoId: "video-3" },
      client,
    )

    expect(inserts[0]).toMatchObject({
      cost_type: "qencode_transcode",
      call_type: null,
      provider: "qencode",
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0.15,
      user_id: "user-3",
      analysed_video_id: "video-3",
    })
  })
})
