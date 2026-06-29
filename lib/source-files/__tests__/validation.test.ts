import { describe, expect, it } from "vitest"

import {
  compareDuration,
  computeFilenameSimilarity,
  computeOverallValidationStatus,
  filenameStatusFromScore,
  normaliseForComparison,
} from "@/lib/source-files/validation"

describe("compareDuration", () => {
  it("passes when durations are identical", () => {
    const result = compareDuration(600, 600, 5)
    expect(result.status).toBe("passed")
    expect(result.differenceSeconds).toBe(0)
  })

  it("passes when within tolerance (inclusive)", () => {
    expect(compareDuration(602, 600, 5).status).toBe("passed")
    expect(compareDuration(605, 600, 5).status).toBe("passed") // exactly 5s
    expect(compareDuration(595, 600, 5).status).toBe("passed") // negative diff
  })

  it("fails when difference exceeds tolerance", () => {
    const result = compareDuration(610, 600, 5)
    expect(result.status).toBe("failed")
    expect(result.differenceSeconds).toBe(10)
  })

  it("honours a custom tolerance", () => {
    expect(compareDuration(600, 590, 15).status).toBe("passed")
    expect(compareDuration(600, 590, 5).status).toBe("failed")
  })
})

describe("normaliseForComparison", () => {
  it("strips the extension, separators, punctuation and filler words", () => {
    expect(
      normaliseForComparison("My-Awesome_Video.final.v2.mp4", {
        stripExtension: true,
      }),
    ).toEqual(["my", "awesome", "video"])
  })

  it("does not truncate titles that contain dots when not stripping", () => {
    expect(normaliseForComparison("Version 2.0 Review")).toEqual([
      "version",
      "review",
    ])
  })
})

describe("computeFilenameSimilarity", () => {
  it("scores a close filename/title match highly (passes)", () => {
    const score = computeFilenameSimilarity(
      "how-to-bake-sourdough-bread-final.mp4",
      "How To Bake Sourdough Bread",
    )
    expect(score).not.toBeNull()
    expect(score!).toBeGreaterThanOrEqual(0.3)
  })

  it("scores an unrelated filename low (warning)", () => {
    const score = computeFilenameSimilarity(
      "export_0012_render.mov",
      "How To Bake Sourdough Bread",
    )
    expect(score).not.toBeNull()
    expect(score!).toBeLessThan(0.3)
  })

  it("returns null when one side has no usable tokens", () => {
    expect(computeFilenameSimilarity("final.mp4", "My Great Video")).toBeNull()
    expect(computeFilenameSimilarity("clip.mp4", "")).toBeNull()
  })
})

describe("filenameStatusFromScore", () => {
  it("maps scores around the threshold", () => {
    expect(filenameStatusFromScore(0.5, 0.3)).toBe("passed")
    expect(filenameStatusFromScore(0.3, 0.3)).toBe("passed")
    expect(filenameStatusFromScore(0.29, 0.3)).toBe("warning")
    expect(filenameStatusFromScore(null, 0.3)).toBe("unknown")
  })
})

describe("computeOverallValidationStatus", () => {
  it("passes when both duration and filename pass", () => {
    expect(computeOverallValidationStatus("passed", "passed")).toBe("passed")
  })

  it("warns when duration passes but filename warns/unknown", () => {
    expect(computeOverallValidationStatus("passed", "warning")).toBe("warning")
    expect(computeOverallValidationStatus("passed", "unknown")).toBe("warning")
  })

  it("fails when duration fails, regardless of filename", () => {
    expect(computeOverallValidationStatus("failed", "passed")).toBe("failed")
    expect(computeOverallValidationStatus("failed", "warning")).toBe("failed")
  })
})
