import { describe, expect, it, vi } from "vitest"

import {
  computeValidationOutcome,
  type ValidationContext,
  type ValidationDeps,
} from "@/lib/source-files/validation-service"
import {
  FfprobeReadError,
  FfprobeUnavailableError,
} from "@/lib/source-files/ffprobe"
import type { StorageProvider } from "@/lib/storage"

// A storage provider stub whose statObject / probe behaviour each test controls.
function fakeStorage(
  overrides: Partial<StorageProvider> & {
    exists?: boolean
  } = {},
): StorageProvider {
  return {
    name: "fake",
    createSignedUpload: vi.fn(),
    statObject: vi.fn(async () => ({
      exists: overrides.exists ?? true,
      sizeBytes: 1234,
      contentType: "video/mp4",
    })),
    createSignedReadUrl: vi.fn(async () => "https://signed.example/read"),
    deleteObject: vi.fn(),
    ...overrides,
  } as StorageProvider
}

const baseCtx: ValidationContext = {
  sourceFileId: "sf-1",
  storagePath: "user/video/sf-1/clip.mp4",
  originalFilename: "how-to-bake-sourdough-bread.mp4",
  youtubeDurationSeconds: 600,
  videoTitle: "How To Bake Sourdough Bread",
}

function deps(overrides: Partial<ValidationDeps> = {}): ValidationDeps {
  return {
    storage: fakeStorage(),
    extractDuration: vi.fn(async () => 600),
    toleranceSeconds: 5,
    filenameThreshold: 0.3,
    ...overrides,
  }
}

describe("computeValidationOutcome", () => {
  it("marks the file ready and passed when duration and filename both pass", async () => {
    const outcome = await computeValidationOutcome(baseCtx, deps())
    expect(outcome.uploadStatus).toBe("ready")
    expect(outcome.validationStatus).toBe("passed")
    expect(outcome.durationValidationStatus).toBe("passed")
    expect(outcome.filenameValidationStatus).toBe("passed")
    expect(outcome.failureReason).toBeNull()
  })

  it("returns a warning when duration passes but the filename doesn't match", async () => {
    const outcome = await computeValidationOutcome(
      { ...baseCtx, originalFilename: "export_final_0007.mp4" },
      deps(),
    )
    expect(outcome.uploadStatus).toBe("ready")
    expect(outcome.validationStatus).toBe("warning")
    expect(outcome.durationValidationStatus).toBe("passed")
    expect(outcome.filenameValidationStatus).toBe("warning")
  })

  it("fails when the uploaded duration is outside tolerance", async () => {
    const outcome = await computeValidationOutcome(
      baseCtx,
      deps({ extractDuration: vi.fn(async () => 630) }),
    )
    expect(outcome.uploadStatus).toBe("failed")
    expect(outcome.validationStatus).toBe("failed")
    expect(outcome.durationValidationStatus).toBe("failed")
    expect(outcome.durationDifferenceSeconds).toBe(30)
    expect(outcome.failureReason).toContain("duration")
  })

  it("fails when the storage object is missing", async () => {
    const outcome = await computeValidationOutcome(
      baseCtx,
      deps({ storage: fakeStorage({ exists: false }) }),
    )
    expect(outcome.uploadStatus).toBe("failed")
    expect(outcome.failureReason).toContain("missing")
  })

  it("fails gracefully when ffprobe is unavailable", async () => {
    const outcome = await computeValidationOutcome(
      baseCtx,
      deps({
        extractDuration: vi.fn(async () => {
          throw new FfprobeUnavailableError()
        }),
      }),
    )
    expect(outcome.uploadStatus).toBe("failed")
    expect(outcome.durationValidationStatus).toBeNull()
    expect(outcome.failureReason).toContain("unavailable")
  })

  it("fails when ffprobe cannot read the file", async () => {
    const outcome = await computeValidationOutcome(
      baseCtx,
      deps({
        extractDuration: vi.fn(async () => {
          throw new FfprobeReadError("corrupt")
        }),
      }),
    )
    expect(outcome.uploadStatus).toBe("failed")
    expect(outcome.failureReason).toContain("corrupt or in an unsupported format")
  })
})
