import { describe, expect, it } from "vitest"

import {
  computeValidationOutcome,
  type ValidationContext,
  type ValidationDeps,
} from "@/lib/source-files/validation-service"

const baseCtx: ValidationContext = {
  originalFilename: "how-to-bake-sourdough-bread.mp4",
  youtubeDurationSeconds: 600,
  videoTitle: "How To Bake Sourdough Bread",
  uploadedDurationSeconds: 600,
}

function deps(overrides: Partial<ValidationDeps> = {}): ValidationDeps {
  return {
    toleranceSeconds: 5,
    filenameThreshold: 0.3,
    ...overrides,
  }
}

describe("computeValidationOutcome", () => {
  it("marks the file ready and passed when duration and filename both pass", () => {
    const outcome = computeValidationOutcome(baseCtx, deps())
    expect(outcome.uploadStatus).toBe("ready")
    expect(outcome.validationStatus).toBe("passed")
    expect(outcome.durationValidationStatus).toBe("passed")
    expect(outcome.filenameValidationStatus).toBe("passed")
    expect(outcome.uploadedDurationSeconds).toBe(600)
    expect(outcome.failureReason).toBeNull()
  })

  it("returns a warning when duration passes but the filename doesn't match", () => {
    const outcome = computeValidationOutcome(
      { ...baseCtx, originalFilename: "export_final_0007.mp4" },
      deps(),
    )
    expect(outcome.uploadStatus).toBe("ready")
    expect(outcome.validationStatus).toBe("warning")
    expect(outcome.durationValidationStatus).toBe("passed")
    expect(outcome.filenameValidationStatus).toBe("warning")
  })

  it("fails when the uploaded duration is outside tolerance", () => {
    const outcome = computeValidationOutcome(
      { ...baseCtx, uploadedDurationSeconds: 630 },
      deps(),
    )
    expect(outcome.uploadStatus).toBe("failed")
    expect(outcome.validationStatus).toBe("failed")
    expect(outcome.durationValidationStatus).toBe("failed")
    expect(outcome.durationDifferenceSeconds).toBe(30)
    expect(outcome.failureReason).toContain("duration")
  })

  it("degrades to a warning (not a failure) when the browser couldn't measure the duration", () => {
    const outcome = computeValidationOutcome(
      { ...baseCtx, uploadedDurationSeconds: null },
      deps(),
    )
    expect(outcome.uploadStatus).toBe("ready")
    expect(outcome.validationStatus).toBe("warning")
    expect(outcome.durationValidationStatus).toBeNull()
    expect(outcome.uploadedDurationSeconds).toBeNull()
    expect(outcome.failureReason).toBeNull()
  })

  it("treats a non-finite or non-positive duration as unmeasured", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = computeValidationOutcome(
        { ...baseCtx, uploadedDurationSeconds: value },
        deps(),
      )
      expect(outcome.durationValidationStatus).toBeNull()
      expect(outcome.uploadStatus).toBe("ready")
      expect(outcome.validationStatus).toBe("warning")
    }
  })

  it("can't check the duration when the YouTube duration is unknown", () => {
    const outcome = computeValidationOutcome(
      { ...baseCtx, youtubeDurationSeconds: 0 },
      deps(),
    )
    expect(outcome.durationValidationStatus).toBeNull()
    expect(outcome.uploadStatus).toBe("ready")
    expect(outcome.validationStatus).toBe("warning")
    // The measured duration is still recorded for display.
    expect(outcome.uploadedDurationSeconds).toBe(600)
  })
})
