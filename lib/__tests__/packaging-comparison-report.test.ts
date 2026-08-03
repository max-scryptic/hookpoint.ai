import { afterEach, describe, expect, it, vi } from "vitest"

import {
  emptyHookEvidence,
  hasHookEvidence,
  type PackagingHookEvidence,
} from "@/lib/packaging-comparison-evidence"
import {
  generatePackagingComparisonReport,
  higherViewsSide,
  isPackagingComparisonReportOutput,
  normalizePackagingComparisonReport,
  packagingSideForModel,
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  type PackagingComparisonReportSide,
} from "@/lib/packaging-comparison-report"
import type { SnapshotAnalysis } from "@/lib/retention-window-media-analysis"

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_PACKAGING_COMPARISON_MODEL
})

function snapshotAnalysis(
  overrides: Partial<SnapshotAnalysis> = {},
): SnapshotAnalysis {
  return {
    scene: "talking_head",
    face_visible: true,
    contains_text: false,
    contains_code: false,
    motion: "low",
    people_count: 1,
    camera_movement: "static",
    notable_event: null,
    description: "A person speaking to camera.",
    ...overrides,
  }
}

function hookEvidence(
  overrides: Partial<PackagingHookEvidence> = {},
): PackagingHookEvidence {
  return {
    ...emptyHookEvidence(),
    retention: {
      fromSeconds: 0,
      toSeconds: 10,
      delta: -0.18,
      startWatchRatio: 1,
      endWatchRatio: 0.82,
      relativePerformance: 0.4,
      steepness: 0.02,
    },
    transcript: "I put every pound I had into one coin and it went to zero.",
    visual: [
      {
        timestampSeconds: 0,
        ocrText: "MY BIGGEST MISTAKE",
        analysis: snapshotAnalysis({ face_prominence: 8 }),
      },
      {
        timestampSeconds: 64,
        ocrText: null,
        analysis: snapshotAnalysis({ scene: "b_roll", face_visible: false }),
      },
    ],
    ...overrides,
  }
}

function side(
  overrides: Partial<PackagingComparisonReportSide> = {},
): PackagingComparisonReportSide {
  return {
    title: "I Lost Everything In Crypto At 26",
    thumbnailUrl: "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
    views: 120_000,
    packagingTaxonomy: null,
    hook: hookEvidence(),
    ...overrides,
  }
}

function modelOutput() {
  return {
    verdict: {
      strongerSide: "a",
      summary: "  Video A commits to one promise across all three surfaces.  ",
      confidence: 0.8,
    },
    surfaces: [
      {
        surface: "thumbnail",
        strongerSide: "a",
        aRead: " One face, one line of text. ",
        bRead: "Three subjects competing for the eye.",
        whyItMatters: "A single subject survives the feed at thumbnail size.",
        tip: "  Build the thumbnail around one subject at phone width.  ",
      },
      {
        surface: "hook",
        strongerSide: "a",
        aRead: "States the loss in the first sentence.",
        bRead: "Spends ten seconds on a channel intro.",
        whyItMatters: "The opening either cashes the title's promise or does not.",
        tip: "   ",
      },
    ],
    drivers: [
      {
        label: "  Thumbnail is doing three things at once  ",
        surface: "thumbnail",
        favours: "a",
        detail: "Video B's thumbnail splits attention across three subjects.",
        evidence: ["  frame text: MY BIGGEST MISTAKE  ", "", "visualComplexity 8 vs 3"],
        tip: "  Cut the thumbnail to one subject and one line of text.  ",
        confidence: 0.8,
      },
      {
        label: "Title buries the number",
        surface: "title",
        favours: "a",
        detail: "Video A names the figure, Video B gestures at it.",
        evidence: ["title A: I Lost Everything In Crypto At 26"],
        tip: "   ",
        confidence: 0.6,
      },
    ],
    recommendations: [
      {
        surface: "title",
        addsBeyondTip: "The tip is about the thumbnail, this one is the title.",
        action: "  Name the number the title is hiding.  ",
        rationale: "Video A's concrete figure is what makes its promise legible.",
        effort: "quick",
      },
      {
        surface: "hook",
        action: "   ",
        rationale: "Dropped because it has no action.",
        effort: "rework",
      },
    ],
  }
}

describe("higherViewsSide", () => {
  it("names the side with more views", () => {
    expect(higherViewsSide({ views: 900 }, { views: 100 })).toBe("a")
    expect(higherViewsSide({ views: 100 }, { views: 900 })).toBe("b")
  })

  it("returns null when views are tied or unknown", () => {
    expect(higherViewsSide({ views: 500 }, { views: 500 })).toBeNull()
    expect(higherViewsSide({ views: null }, { views: 900 })).toBeNull()
    expect(higherViewsSide({ views: 900 }, { views: null })).toBeNull()
  })
})

describe("hasHookEvidence", () => {
  it("is false for an empty bundle", () => {
    expect(hasHookEvidence(emptyHookEvidence())).toBe(false)
  })

  it("is false when the transcript is only whitespace and nothing else landed", () => {
    expect(
      hasHookEvidence({ ...emptyHookEvidence(), transcript: "   " }),
    ).toBe(false)
  })

  it("is true once any one source landed", () => {
    expect(
      hasHookEvidence({
        ...emptyHookEvidence(),
        visual: hookEvidence().visual,
      }),
    ).toBe(true)
  })
})

describe("packagingSideForModel", () => {
  it("timestamps frames and events so the model can cite them", () => {
    const view = packagingSideForModel(side())
    expect(view.hook.visual.map((frame) => frame.at)).toEqual(["0:00", "1:04"])
    expect(view.hasThumbnailImage).toBe(true)
  })

  it("caps the frame list and the transcript", () => {
    const view = packagingSideForModel(
      side({
        hook: hookEvidence({
          transcript: "x".repeat(5_000),
          visual: Array.from({ length: 20 }, (_, index) => ({
            timestampSeconds: index,
            ocrText: null,
            analysis: snapshotAnalysis(),
          })),
        }),
      }),
    )
    expect(view.hook.visual).toHaveLength(10)
    expect(view.hook.transcript).toHaveLength(2_000)
  })
})

describe("isPackagingComparisonReportOutput", () => {
  it("accepts a well-formed report", () => {
    expect(isPackagingComparisonReportOutput(modelOutput())).toBe(true)
  })

  it("rejects an unknown surface", () => {
    const output = modelOutput()
    output.drivers[0].surface = "captions"
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })

  it("rejects a driver that favours neither side", () => {
    const output = modelOutput()
    output.drivers[0].favours = "neither"
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })

  it("rejects a confidence outside 0 to 1", () => {
    const output = modelOutput()
    output.verdict.confidence = 4
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })

  it("rejects a non-string driver tip", () => {
    const output = modelOutput()
    ;(output.drivers[0] as { tip: unknown }).tip = 7
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })

  it("still accepts a driver with no tip, as stored before schema version 2", () => {
    const output = modelOutput()
    delete (output.drivers[0] as { tip?: string }).tip
    expect(isPackagingComparisonReportOutput(output)).toBe(true)
  })

  it("rejects a non-string surface tip", () => {
    const output = modelOutput()
    ;(output.surfaces[0] as { tip: unknown }).tip = 7
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })

  it("still accepts a surface with no tip, as stored before schema version 5", () => {
    const output = modelOutput()
    delete (output.surfaces[0] as { tip?: string }).tip
    expect(isPackagingComparisonReportOutput(output)).toBe(true)
  })

  it("still accepts a recommendation that names a target side, as stored before schema version 3", () => {
    const output = modelOutput()
    ;(output.recommendations[0] as { target?: string }).target = "b"
    expect(isPackagingComparisonReportOutput(output)).toBe(true)
  })

  // The model has to name what a recommendation adds to the tip above it
  // before it writes the action, which is what keeps the two from being the
  // same advice twice. Nothing stored carries the field, so a report fed back
  // through here without one still validates.
  it("accepts a recommendation with or without the addsBeyondTip guardrail", () => {
    const output = modelOutput()
    expect(isPackagingComparisonReportOutput(output)).toBe(true)
    delete (output.recommendations[0] as { addsBeyondTip?: string })
      .addsBeyondTip
    expect(isPackagingComparisonReportOutput(output)).toBe(true)
  })

  it("rejects a recommendation whose addsBeyondTip is not text", () => {
    const output = modelOutput()
    ;(output.recommendations[0] as { addsBeyondTip?: unknown }).addsBeyondTip = 3
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })

  it("rejects a recommendation whose target is neither a side nor 'both'", () => {
    const output = modelOutput()
    ;(output.recommendations[0] as { target?: string }).target = "neither"
    expect(isPackagingComparisonReportOutput(output)).toBe(false)
  })
})

describe("normalizePackagingComparisonReport", () => {
  it("trims, clamps and drops empty entries", () => {
    const parsed = modelOutput()
    // Out of range on the way in, so the clamp is exercised even though the
    // schema also constrains it server-side.
    parsed.verdict.confidence = 1.4

    const report = normalizePackagingComparisonReport(
      parsed as never,
      "test-gpt",
    )

    expect(report.verdict.summary).toBe(
      "Video A commits to one promise across all three surfaces.",
    )
    expect(report.verdict.confidence).toBe(1)
    expect(report.drivers[0].label).toBe(
      "Thumbnail is doing three things at once",
    )
    expect(report.drivers[0].evidence).toEqual([
      "frame text: MY BIGGEST MISTAKE",
      "visualComplexity 8 vs 3",
    ])
    expect(report.drivers[0].tip).toBe(
      "Cut the thumbnail to one subject and one line of text.",
    )
    // Each surface carries its own tip, so a tab the drivers passed over still
    // closes on advice. Trimmed like the driver tips, and dropped rather than
    // stored blank when the model wrote only whitespace.
    expect(report.surfaces[0].tip).toBe(
      "Build the thumbnail around one subject at phone width.",
    )
    expect(report.surfaces[1].tip).toBeUndefined()
    // A whitespace-only tip is dropped rather than stored blank, so the report
    // renders no empty "Try:" line under that driver.
    expect(report.drivers[1].tip).toBeUndefined()
    // The recommendation with a blank action is dropped, the real one kept.
    expect(report.recommendations).toHaveLength(1)
    expect(report.recommendations[0].action).toBe(
      "Name the number the title is hiding.",
    )
    // A stored recommendation carries no side any more: it is advice for the
    // next video, not a change to either published one.
    expect(report.recommendations[0]).not.toHaveProperty("target")
    // addsBeyondTip is the model checking its own work, not copy, so it is
    // dropped rather than stored.
    expect(report.recommendations[0]).not.toHaveProperty("addsBeyondTip")
    // The report no longer carries a caveats list: the tabs render the reads,
    // drivers and recommendations only.
    expect(report).not.toHaveProperty("caveats")
    expect(report.model).toBe("test-gpt")
    expect(report.schemaVersion).toBe(
      PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
    )
  })
})

describe("generatePackagingComparisonReport", () => {
  it("returns null without calling OpenAI when neither video has anything to compare", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await generatePackagingComparisonReport(
      { title: null, thumbnailUrl: null, views: null, packagingTaxonomy: null, hook: emptyHookEvidence() },
      { title: null, thumbnailUrl: null, views: null, packagingTaxonomy: null, hook: emptyHookEvidence() },
    )

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends both thumbnails as images alongside the evidence, and stores the parsed report", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    process.env.OPENAI_PACKAGING_COMPARISON_MODEL = "test-gpt"
    const parsed = modelOutput()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            { content: [{ type: "output_text", text: JSON.stringify(parsed) }] },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const report = await generatePackagingComparisonReport(
      side(),
      side({
        title: "STOP CHECKING THE CHARTS",
        thumbnailUrl: "https://i.ytimg.com/vi/def/maxresdefault.jpg",
        views: 4_000,
      }),
    )

    expect(report).toMatchObject({
      model: "test-gpt",
      verdict: { strongerSide: "a", confidence: 0.8 },
    })

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body,
    ) as {
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>
    }
    const userContent = body.input[1].content
    const images = userContent.filter((part) => part.type === "input_image")
    expect(images.map((image) => image.image_url)).toEqual([
      "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
      "https://i.ytimg.com/vi/def/maxresdefault.jpg",
    ])
    const payload = JSON.parse(userContent[0].text as string) as {
      higherViewsSide: string | null
    }
    expect(payload.higherViewsSide).toBe("a")
  })

  it("throws when the model returns a report that fails validation", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    const invalid = modelOutput()
    invalid.drivers[0].favours = "neither"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  { type: "output_text", text: JSON.stringify(invalid) },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    await expect(
      generatePackagingComparisonReport(side(), side()),
    ).rejects.toThrow("invalid packaging comparison report")
  })
})
