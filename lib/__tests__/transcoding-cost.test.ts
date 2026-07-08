import { afterEach, describe, expect, it } from "vitest"

import {
  transcodingCostPerMinuteUsd,
  transcodingCostUsd,
} from "@/lib/transcoding-cost"

afterEach(() => {
  delete process.env.QENCODE_TRANSCODING_USD_PER_MINUTE
})

describe("transcodingCostUsd", () => {
  it("charges $0.15 for a 10-minute video at the default rate", () => {
    expect(transcodingCostUsd(600)).toBeCloseTo(0.15, 6)
  })

  it("scales linearly with duration", () => {
    expect(transcodingCostUsd(300)).toBeCloseTo(0.075, 6)
    expect(transcodingCostUsd(60)).toBeCloseTo(0.015, 6)
  })

  it("is zero for an unknown or non-positive duration", () => {
    expect(transcodingCostUsd(null)).toBe(0)
    expect(transcodingCostUsd(undefined)).toBe(0)
    expect(transcodingCostUsd(0)).toBe(0)
    expect(transcodingCostUsd(-30)).toBe(0)
  })

  it("honours the per-minute rate override", () => {
    process.env.QENCODE_TRANSCODING_USD_PER_MINUTE = "0.02"
    expect(transcodingCostPerMinuteUsd()).toBe(0.02)
    expect(transcodingCostUsd(600)).toBeCloseTo(0.2, 6)
  })

  it("ignores an invalid or negative override and falls back to the default", () => {
    process.env.QENCODE_TRANSCODING_USD_PER_MINUTE = "not-a-number"
    expect(transcodingCostPerMinuteUsd()).toBe(0.015)
    process.env.QENCODE_TRANSCODING_USD_PER_MINUTE = "-1"
    expect(transcodingCostPerMinuteUsd()).toBe(0.015)
  })
})
