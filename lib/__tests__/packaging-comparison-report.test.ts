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
  packagingComparability,
  packagingComparisonForModel,
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
    // A pair of healthy, similarly reached videos by default, so the fixtures
    // that are not about comparability stay anchored and keep asserting what
    // they were written to assert.
    impressions: 2_000_000,
    impressionClickThroughRate: 0.061,
    averageViewPercentage: 42,
    trafficSources: [
      { source: "SUBSCRIBER", views: 80_000 },
      { source: "RELATED_VIDEO", views: 40_000 },
    ],
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

  it("returns null for a pair whose view counts cannot carry a verdict", () => {
    // The gap is real and it is not about packaging: at 73 views there is no
    // way to tell a thumbnail nobody clicked from one nobody was shown.
    expect(higherViewsSide({ views: 1_100 }, { views: 73 }, false)).toBeNull()
  })
})

describe("packagingComparability", () => {
  it("asks the click question, not the watch one", () => {
    // The same pair, read two ways. A 12x view gap between two well-watched
    // videos is a confound on how well each held its audience and is exactly
    // the outcome packaging is meant to move, so the click verdict survives it.
    const comparability = packagingComparability(
      side({ views: 120_000 }),
      side({ views: 10_000, impressionClickThroughRate: 0.021 }),
    )
    expect(comparability.watch.anchor).toBe("contrast")
    expect(comparability.click.anchor).toBe("anchored")
  })

  it("withholds a click verdict when one video was barely shown", () => {
    const comparability = packagingComparability(
      side({ views: 1_100, impressions: null, impressionClickThroughRate: null }),
      side({ views: 73, impressions: null, impressionClickThroughRate: null }),
    )
    expect(comparability.click.anchor).toBe("contrast")
    expect(comparability.click.caveats).toContain("small_sample")
  })
})

describe("packagingComparisonForModel", () => {
  it("withholds both view counts, and higherViewsSide, when the pair cannot be ranked", () => {
    const a = side({ views: 1_100, impressions: null, impressionClickThroughRate: null })
    const b = side({ views: 73, impressions: null, impressionClickThroughRate: null })
    const payload = packagingComparisonForModel(a, b, packagingComparability(a, b))

    expect(payload.higherViewsSide).toBeNull()
    expect(payload.videoA.views).toBeNull()
    expect(payload.videoB.views).toBeNull()
    // The evidence the report actually judges packaging on is untouched, and
    // so is the opening's own retention, which is measured inside one video
    // and carries none of the cross-video problem.
    expect(payload.videoA.hasThumbnailImage).toBe(true)
    expect(payload.videoA.hook.retention).not.toBeNull()
  })

  it("passes them through for a pair that earned a click verdict", () => {
    const a = side({ views: 120_000 })
    const b = side({ views: 10_000, impressionClickThroughRate: 0.021 })
    const payload = packagingComparisonForModel(a, b, packagingComparability(a, b))

    expect(payload.higherViewsSide).toBe("a")
    expect(payload.videoA.views).toBe(120_000)
    expect(payload.comparability.videoAClickThroughPercent).toBeCloseTo(6.1)
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

  // A surface gets one tip and one only, so the model is no longer asked for
  // the recommendations that used to sit under it. A report stored while it
  // still was carries them, and is read rather than rewritten, so one fed back
  // through here has to pass on its tips alone.
  it("still accepts a report carrying the recommendations it was stored with", () => {
    const output = modelOutput() as Record<string, unknown>
    output.recommendations = [
      {
        surface: "title",
        target: "b",
        action: "Name the number the title is hiding.",
        rationale: "Video A's concrete figure makes its promise legible.",
        effort: "quick",
      },
    ]
    expect(isPackagingComparisonReportOutput(output)).toBe(true)
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
    // Each surface closes on one tip and one only, so a new report carries no
    // recommendations behind it for anything to stack under that tip.
    expect(report).not.toHaveProperty("recommendations")
    // The report no longer carries a caveats list either: the tabs render the
    // reads and the tips only.
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
      side({ title: null, thumbnailUrl: null, views: null, hook: emptyHookEvidence() }),
      side({ title: null, thumbnailUrl: null, views: null, hook: emptyHookEvidence() }),
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
        views: 90_000,
        impressions: 1_800_000,
        impressionClickThroughRate: 0.048,
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
