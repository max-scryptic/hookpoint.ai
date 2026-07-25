import { describe, expect, it } from "vitest"

import { buildScriptComparison } from "@/lib/script-comparison"
import {
  SCRIPT_TAXONOMY_SCHEMA_VERSION,
  type ScriptDetail,
  type ScriptTaxonomy,
} from "@/lib/script-taxonomy"

// Two fixtures model a real head-to-head: a dense, high-view educational
// explainer against a low-view, filler-heavy vlog, so the diff has clear
// stories to rank (substance, filler, format, emotion).

function detail(overrides: Partial<ScriptDetail> = {}): ScriptDetail {
  return {
    structure: {
      segmentCount: 4,
      topicCohesion: 5,
      openLoops: 5,
      payoffPlacement: 5,
      hasCta: false,
    },
    substance: {
      substanceDensity: 5,
      concreteness: 5,
      noveltyOfIdeas: 5,
      educationalValue: 5,
      entertainmentValue: 5,
      fillerLevel: 5,
    },
    emotion: {
      dominantEmotion: "neutral",
      energy: 5,
      emotionalRange: 5,
      arcShape: "flat",
      vulnerability: 5,
    },
    humor: {
      humorDensity: 5,
      humorStyle: null,
    },
    rhetoric: {
      narrativeVoice: "impersonal",
      directAddress: 5,
      persuasionDevices: [],
      stakes: 5,
      relatability: 5,
    },
    drivers: {
      scriptArchetype: "other",
      primaryEngagementDriver: "information",
    },
    ...overrides,
  }
}

function taxonomy(
  top: Partial<ScriptTaxonomy>,
  detailBlock: ScriptDetail,
): ScriptTaxonomy {
  return {
    format: "explainer",
    oneLineSummary: "",
    segments: [],
    topics: ["general"],
    detail: detailBlock,
    wordCount: 1000,
    schemaVersion: SCRIPT_TAXONOMY_SCHEMA_VERSION,
    model: "test-model",
    generatedAt: "2026-07-01T00:00:00Z",
    ...top,
  }
}

const explainerTaxonomy = taxonomy(
  {
    format: "explainer",
    oneLineSummary: "How compound interest builds wealth.",
    topics: ["personal finance", "investing"],
    wordCount: 1800,
    segments: [
      { approxStartSeconds: 0, label: "hook" },
      { approxStartSeconds: 40, label: "the maths" },
      { approxStartSeconds: 120, label: "worked example" },
    ],
  },
  detail({
    structure: {
      segmentCount: 3,
      topicCohesion: 9,
      openLoops: 6,
      payoffPlacement: 7,
      hasCta: true,
    },
    substance: {
      substanceDensity: 9,
      concreteness: 8,
      noveltyOfIdeas: 6,
      educationalValue: 9,
      entertainmentValue: 4,
      fillerLevel: 2,
    },
    emotion: {
      dominantEmotion: "curiosity",
      energy: 6,
      emotionalRange: 5,
      arcShape: "rising",
      vulnerability: 3,
    },
    drivers: {
      scriptArchetype: "educational_deep_dive",
      primaryEngagementDriver: "information",
    },
  }),
)

const vlogTaxonomy = taxonomy(
  {
    format: "vlog",
    oneLineSummary: "A day getting coffee and chatting.",
    topics: ["daily life"],
    wordCount: 900,
    segments: [
      { approxStartSeconds: 0, label: "waking up" },
      { approxStartSeconds: 30, label: "coffee run" },
    ],
  },
  detail({
    structure: {
      segmentCount: 2,
      topicCohesion: 4,
      openLoops: 2,
      payoffPlacement: 5,
      hasCta: false,
    },
    substance: {
      substanceDensity: 3,
      concreteness: 4,
      noveltyOfIdeas: 3,
      educationalValue: 2,
      entertainmentValue: 6,
      fillerLevel: 8,
    },
    emotion: {
      dominantEmotion: "warmth",
      energy: 5,
      emotionalRange: 6,
      arcShape: "roller_coaster",
      vulnerability: 6,
    },
    drivers: {
      scriptArchetype: "personal_vlog",
      primaryEngagementDriver: "personality",
    },
  }),
)

const explainerInput = {
  id: "explainer",
  title: "Compound Interest Explained",
  views: 42000,
  taxonomy: explainerTaxonomy,
}

const vlogInput = {
  id: "vlog",
  title: "A Chill Coffee Day",
  views: 900,
  taxonomy: vlogTaxonomy,
}

describe("buildScriptComparison", () => {
  it("orients the higher-viewed side and passes each topic map through", () => {
    const comparison = buildScriptComparison(explainerInput, vlogInput)
    expect(comparison).not.toBeNull()
    expect(comparison?.higherViewsSide).toBe("a")
    expect(comparison?.segments.a).toHaveLength(3)
    expect(comparison?.segments.b).toHaveLength(2)
  })

  it("diffs raw metrics like word count and segment count", () => {
    const comparison = buildScriptComparison(explainerInput, vlogInput)
    const words = comparison?.metrics.find(
      (row) => row.key === "overall.wordCount",
    )
    expect(words?.a).toBe(1800)
    expect(words?.b).toBe(900)
    expect(words?.delta).toBe(900)
  })

  it("favours the lower side on a 'lower is better' axis (filler)", () => {
    const comparison = buildScriptComparison(explainerInput, vlogInput)
    const fillerHighlight = comparison?.highlights.find(
      (h) => h.key === "substance.fillerLevel",
    )
    // Explainer (A) has less filler (2 vs 8), so the lower value should win.
    expect(fillerHighlight?.favours).toBe("a")
  })

  it("favours the higher side on a 'higher is better' axis (substance)", () => {
    const comparison = buildScriptComparison(explainerInput, vlogInput)
    const density = comparison?.highlights.find(
      (h) => h.key === "substance.substanceDensity",
    )
    expect(density?.favours).toBe("a")
  })

  it("never orients a descriptive axis toward a side", () => {
    // Two taxonomies identical apart from topicCohesion, so it is guaranteed to
    // be the top highlight and can be checked directly.
    const high = {
      id: "high",
      title: "High cohesion",
      views: 2,
      taxonomy: taxonomy(
        {},
        detail({
          structure: {
            segmentCount: 4,
            topicCohesion: 9,
            openLoops: 5,
            payoffPlacement: 5,
            hasCta: false,
          },
        }),
      ),
    }
    const low = {
      id: "low",
      title: "Low cohesion",
      views: 1,
      taxonomy: taxonomy(
        {},
        detail({
          structure: {
            segmentCount: 4,
            topicCohesion: 3,
            openLoops: 5,
            payoffPlacement: 5,
            hasCta: false,
          },
        }),
      ),
    }
    const comparison = buildScriptComparison(high, low)
    const cohesion = comparison?.highlights.find(
      (h) => h.key === "structure.topicCohesion",
    )
    expect(cohesion).toBeDefined()
    expect(cohesion?.favours).toBe("neither")
  })

  it("splits categorical axes into shared and distinct values", () => {
    const comparison = buildScriptComparison(explainerInput, vlogInput)
    const format = comparison?.categoricals.find(
      (row) => row.key === "overall.format",
    )
    expect(format?.onlyA).toEqual(["Explainer"])
    expect(format?.onlyB).toEqual(["Vlog"])
    const topics = comparison?.categoricals.find(
      (row) => row.key === "overall.topics",
    )
    // Tokens are pretty-printed for display (first letter capitalised).
    expect(topics?.onlyA).toContain("Personal finance")
  })

  it("returns identity only when just one side has a taxonomy", () => {
    const comparison = buildScriptComparison(explainerInput, {
      id: "missing",
      title: "No read yet",
      views: 10,
      taxonomy: null,
    })
    expect(comparison).not.toBeNull()
    expect(comparison?.a.hasTaxonomy).toBe(true)
    expect(comparison?.b.hasTaxonomy).toBe(false)
    expect(comparison?.ordinals).toHaveLength(0)
    expect(comparison?.highlights).toHaveLength(0)
  })

  it("returns null when neither side has a taxonomy", () => {
    const comparison = buildScriptComparison(
      { id: "a", title: "A", views: 1, taxonomy: null },
      { id: "b", title: "B", views: 2, taxonomy: null },
    )
    expect(comparison).toBeNull()
  })
})
