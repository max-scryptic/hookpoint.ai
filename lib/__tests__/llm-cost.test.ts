import { afterEach, describe, expect, it } from "vitest"

import {
  addLlmCallCost,
  chatCompletionsCallCost,
  responsesCallCost,
  zeroCost,
} from "@/lib/llm-cost"

afterEach(() => {
  delete process.env.OPENAI_MODEL_PRICING_JSON
})

describe("responsesCallCost", () => {
  it("prices input and output tokens at the model's rate", () => {
    // gpt-4.1-mini: $0.40/1M input, $1.60/1M output.
    const cost = responsesCallCost("gpt-4.1-mini", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(cost.inputTokens).toBe(1_000_000)
    expect(cost.outputTokens).toBe(1_000_000)
    expect(cost.costUsd).toBeCloseTo(0.4 + 1.6, 6)
  })

  it("is zero-cost when the usage block is missing", () => {
    const cost = responsesCallCost("gpt-4.1-mini", null)
    expect(cost).toEqual(zeroCost("gpt-4.1-mini"))
  })

  it("records tokens but $0 for an unpriced model", () => {
    const cost = responsesCallCost("some-unknown-model", {
      input_tokens: 500,
      output_tokens: 250,
    })
    expect(cost.inputTokens).toBe(500)
    expect(cost.outputTokens).toBe(250)
    expect(cost.costUsd).toBe(0)
  })

  it("honours an OPENAI_MODEL_PRICING_JSON override", () => {
    process.env.OPENAI_MODEL_PRICING_JSON = JSON.stringify({
      "custom-model": { inputText: 1, outputText: 2 },
    })
    const cost = responsesCallCost("custom-model", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(cost.costUsd).toBeCloseTo(3, 6)
  })
})

describe("chatCompletionsCallCost", () => {
  it("bills audio input tokens at the audio rate and the rest at text rates", () => {
    // gpt-audio-mini defaults: inputText 0.6, inputAudio 10, outputText 2.4.
    const cost = chatCompletionsCallCost("gpt-audio-mini", {
      prompt_tokens: 1_000_000, // 900k text + 100k audio
      prompt_tokens_details: { audio_tokens: 100_000 },
      completion_tokens: 1_000_000,
    })
    const expected = (900_000 * 0.6 + 100_000 * 10 + 1_000_000 * 2.4) / 1_000_000
    expect(cost.costUsd).toBeCloseTo(expected, 6)
    expect(cost.inputTokens).toBe(1_000_000)
    expect(cost.outputTokens).toBe(1_000_000)
  })
})

describe("addLlmCallCost", () => {
  it("sums token counts and dollar figures", () => {
    const a = { model: "m", inputTokens: 10, outputTokens: 5, costUsd: 0.01 }
    const b = { model: "m", inputTokens: 3, outputTokens: 2, costUsd: 0.002 }
    expect(addLlmCallCost(a, b)).toEqual({
      model: "m",
      inputTokens: 13,
      outputTokens: 7,
      costUsd: 0.012,
    })
  })
})
