import { afterEach, describe, expect, it, vi } from "vitest"

import {
  generateScriptComparisonReport,
  scriptComparability,
  scriptComparisonForModel,
  scriptSideForModel,
  SCRIPT_COMPARISON_INSTRUCTIONS,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
  type ScriptComparisonReportSide,
} from "@/lib/script-comparison-report"
import type { TranscriptCue } from "@/lib/youtube/youtube"

// The Script head-to-head's job is to compare two scripts. What it used to do
// as well, unasked, was rank the two videos on their watch figures and point
// every tip at whichever number was higher, however few viewers stood behind
// it. These tests cover the seam where that happened.

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_SCRIPT_COMPARISON_MODEL
})

function cues(...lines: string[]): TranscriptCue[] {
  return lines.map((text, index) => ({
    text,
    startSeconds: index * 30,
    endSeconds: index * 30 + 30,
    durationSeconds: 30,
  }))
}

function side(
  overrides: Partial<ScriptComparisonReportSide> = {},
): ScriptComparisonReportSide {
  return {
    title: "This Top Ranked Deck Has ZERO Spells",
    views: 40_000,
    averageViewPercentage: 48,
    trafficSources: [
      { source: "SUBSCRIBER", views: 26_000 },
      { source: "RELATED_VIDEO", views: 14_000 },
    ],
    packagingTaxonomy: null,
    transcript: cues("So this deck runs no spells at all.", "Here is why."),
    ...overrides,
  }
}

// The pair from the report that prompted all of this: a video that got
// distributed against one that did not, three days apart.
function lopsidedPair(): [ScriptComparisonReportSide, ScriptComparisonReportSide] {
  return [
    side({ views: 1_100, averageViewPercentage: 16 }),
    side({
      title: "Portable Graveyard Is OP",
      views: 73,
      averageViewPercentage: 19,
      trafficSources: [{ source: "SUBSCRIBER", views: 73 }],
    }),
  ]
}

function modelOutput() {
  return {
    summary: "  Video A meanders where Video B stays on one line.  ",
    sections: [
      {
        heading: " Structure and pacing ",
        body: " Video A digresses between hands; Video B moves hand to hand. ",
        tip: "  Keep every aside between plays under one sentence.  ",
      },
      {
        heading: "Substance",
        body: "Video B names the tactical reason for each swap.",
        tip: "Name the reason for a swap in the same breath as the swap.",
      },
      {
        heading: "Hook",
        body: "Both open on the deck itself rather than on a claim.",
        tip: "Open on the claim the deck makes, then show the list.",
      },
    ],
  }
}

function responseOf(payload: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(payload) }] },
      ],
    }),
  )
}

describe("scriptComparability", () => {
  it("refuses to anchor the pair this guardrail was written for", () => {
    const [a, b] = lopsidedPair()
    const { watch } = scriptComparability(a, b)
    expect(watch.anchor).toBe("contrast")
    expect(watch.caveats).toContain("small_sample")
  })

  it("anchors a pair whose two watch figures can be read against each other", () => {
    const { watch } = scriptComparability(
      side(),
      side({ views: 32_000, averageViewPercentage: 31 }),
    )
    expect(watch.anchor).toBe("anchored")
  })
})

describe("scriptSideForModel", () => {
  it("carries the performance figures for an anchored pair", () => {
    const view = scriptSideForModel(side(), true)
    expect(view.views).toBe(40_000)
    expect(view.averageViewPercentage).toBe(48)
  })

  it("withholds them for a pair that cannot be ranked, and nothing else", () => {
    const view = scriptSideForModel(side(), false)
    expect(view.views).toBeNull()
    expect(view.averageViewPercentage).toBeNull()
    // The script itself is untouched: the report loses its ability to rank the
    // two videos, not its ability to read them.
    expect(view.transcript).toContain("no spells at all")
    expect(view.title).toBe("This Top Ranked Deck Has ZERO Spells")
  })
})

describe("scriptComparisonForModel", () => {
  it("sends no watch figure at all for a pair with no performance anchor", () => {
    const [a, b] = lopsidedPair()
    const payload = scriptComparisonForModel(a, b, scriptComparability(a, b))

    expect(payload.comparability.anchor).toBe("contrast")
    expect(payload.videoA.views).toBeNull()
    expect(payload.videoB.views).toBeNull()
    expect(payload.videoA.averageViewPercentage).toBeNull()
    expect(payload.videoB.averageViewPercentage).toBeNull()

    // Belt and braces: 19 and 16 are the two numbers that produced the bad
    // report, and neither reaches the model in any field, under any key.
    const serialised = JSON.stringify(payload)
    expect(serialised).not.toContain('"averageViewPercentage":19')
    expect(serialised).not.toContain('"averageViewPercentage":16')
  })

  it("passes them through for a pair that earned them", () => {
    const a = side()
    const b = side({ views: 32_000, averageViewPercentage: 31 })
    const payload = scriptComparisonForModel(a, b, scriptComparability(a, b))

    expect(payload.comparability.anchor).toBe("anchored")
    expect(payload.videoA.averageViewPercentage).toBe(48)
    expect(payload.videoB.averageViewPercentage).toBe(31)
  })
})

describe("SCRIPT_COMPARISON_INSTRUCTIONS", () => {
  it("tells the summary where the pair's one hedge goes", () => {
    expect(SCRIPT_COMPARISON_INSTRUCTIONS).toMatch(/one place the pair's limit/)
  })

  it("no longer asks for a stronger retention play unconditionally", () => {
    // The old instruction read "which reads as the stronger retention play, if
    // either", with nothing conditioning it. That single clause is what turned
    // a 3 point gap on 73 views into a verdict.
    expect(SCRIPT_COMPARISON_INSTRUCTIONS).not.toMatch(
      /giving the overall verdict on how the two scripts compare and which reads as the stronger retention play/,
    )
  })
})

describe("generateScriptComparisonReport", () => {
  it("returns null without calling OpenAI when neither video has a transcript", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await generateScriptComparisonReport(
      side({ transcript: [] }),
      side({ transcript: [] }),
    )

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stores the verdict it wrote under alongside the report", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    process.env.OPENAI_SCRIPT_COMPARISON_MODEL = "test-gpt"
    const fetchMock = vi.fn().mockResolvedValue(responseOf(modelOutput()))
    vi.stubGlobal("fetch", fetchMock)

    const [a, b] = lopsidedPair()
    const report = await generateScriptComparisonReport(a, b)

    expect(report).toMatchObject({
      model: "test-gpt",
      schemaVersion: SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
    })
    // Stored so the page can caption the report with the same limit the model
    // wrote under, rather than recomputing it from analytics that may have
    // moved since.
    expect(report?.comparability?.watch.anchor).toBe("contrast")
    expect(report?.sections[0].tip).toBe(
      "Keep every aside between plays under one sentence.",
    )
  })

  it("hands the model the comparability verdict before the evidence", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    const fetchMock = vi.fn().mockResolvedValue(responseOf(modelOutput()))
    vi.stubGlobal("fetch", fetchMock)

    const [a, b] = lopsidedPair()
    await generateScriptComparisonReport(a, b)

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body,
    ) as { input: Array<{ content: Array<{ text: string }> }> }

    const instructions = body.input[0].content[0].text
    expect(instructions).toContain("comparability")

    const payload = JSON.parse(body.input[1].content[0].text) as {
      comparability: { anchor: string; reason: string | null }
      videoA: { views: number | null }
    }
    expect(payload.comparability.anchor).toBe("contrast")
    expect(payload.comparability.reason).toContain("73")
    expect(payload.videoA.views).toBeNull()
  })
})
