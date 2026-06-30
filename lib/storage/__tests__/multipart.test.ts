import { describe, expect, it } from "vitest"

import {
  MAX_PARTS,
  MAX_PART_SIZE_BYTES,
  MIN_PART_SIZE_BYTES,
  planMultipartParts,
} from "@/lib/storage/multipart"

const MiB = 1024 * 1024
const GiB = 1024 * MiB

describe("planMultipartParts", () => {
  it("uses the target part size when the file fits within the part cap", () => {
    const plan = planMultipartParts(640 * MiB, 64 * MiB)
    expect(plan.partSizeBytes).toBe(64 * MiB)
    expect(plan.totalParts).toBe(10)
  })

  it("rounds the final (smaller) part up into its own part", () => {
    // 100 MiB with 64 MiB parts → one 64 MiB part + one 36 MiB remainder.
    const plan = planMultipartParts(100 * MiB, 64 * MiB)
    expect(plan.partSizeBytes).toBe(64 * MiB)
    expect(plan.totalParts).toBe(2)
  })

  it("never goes below the 5 MiB protocol floor", () => {
    const plan = planMultipartParts(20 * MiB, 1 * MiB)
    expect(plan.partSizeBytes).toBe(MIN_PART_SIZE_BYTES)
    expect(plan.totalParts).toBe(4)
  })

  it("grows the part size to stay under the 10,000-part ceiling", () => {
    // 30 GiB with a tiny 5 MiB target would need ~6,144 parts — under the cap, so
    // it stays at 5 MiB. Push past the cap to force growth.
    const huge = 30 * GiB
    const plan = planMultipartParts(huge, MIN_PART_SIZE_BYTES)
    expect(plan.totalParts).toBeLessThanOrEqual(MAX_PARTS)
    expect(plan.partSizeBytes * plan.totalParts).toBeGreaterThanOrEqual(huge)
  })

  it("forces growth when the target would exceed the part ceiling", () => {
    // 100 GiB at 5 MiB parts = ~20,480 parts (> 10,000), so the size must grow.
    const total = 100 * GiB
    const plan = planMultipartParts(total, MIN_PART_SIZE_BYTES)
    expect(plan.partSizeBytes).toBeGreaterThan(MIN_PART_SIZE_BYTES)
    expect(plan.totalParts).toBeLessThanOrEqual(MAX_PARTS)
  })

  it("handles a single small part below the floor", () => {
    const plan = planMultipartParts(1 * MiB, 64 * MiB)
    expect(plan.totalParts).toBe(1)
  })

  it("falls back to a single part for an unknown/zero size", () => {
    expect(planMultipartParts(0, 64 * MiB)).toEqual({
      partSizeBytes: MIN_PART_SIZE_BYTES,
      totalParts: 1,
    })
  })

  it("never exceeds the 5 GiB per-part ceiling", () => {
    const plan = planMultipartParts(40 * GiB, 10 * GiB)
    expect(plan.partSizeBytes).toBeLessThanOrEqual(MAX_PART_SIZE_BYTES)
  })
})
