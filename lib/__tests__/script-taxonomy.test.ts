import { describe, expect, it } from "vitest"

import {
  isCurrentScriptTaxonomy,
  isScriptTaxonomyOutput,
  SCRIPT_TAXONOMY_SCHEMA_VERSION,
  type ScriptTaxonomy,
} from "@/lib/script-taxonomy"

const validDetail = {
  structure: {
    segmentCount: 4,
    topicCohesion: 7,
    openLoops: 6,
    payoffPlacement: 8,
    hasCta: true,
  },
  substance: {
    substanceDensity: 8,
    concreteness: 7,
    noveltyOfIdeas: 5,
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
  humor: {
    humorDensity: 2,
    humorStyle: "none",
  },
  rhetoric: {
    narrativeVoice: "second_person_guide",
    directAddress: 8,
    persuasionDevices: ["data_evidence", "analogy"],
    stakes: 6,
    relatability: 7,
  },
  drivers: {
    scriptArchetype: "educational_deep_dive",
    primaryEngagementDriver: "information",
  },
}

const valid = {
  format: "explainer",
  oneLineSummary: "How compound interest quietly builds wealth over decades.",
  segments: [
    { approxStartSeconds: 0, label: "intro" },
    { approxStartSeconds: 45, label: "the maths" },
  ],
  topics: ["personal finance"],
  detail: validDetail,
}

describe("isScriptTaxonomyOutput", () => {
  it("accepts a well-formed model output", () => {
    expect(isScriptTaxonomyOutput(valid)).toBe(true)
  })

  it("accepts the humour and persuasion 'none' sentinels", () => {
    expect(
      isScriptTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          humor: { humorDensity: 0, humorStyle: "none" },
          rhetoric: { ...validDetail.rhetoric, persuasionDevices: ["none"] },
        },
      }),
    ).toBe(true)
  })

  it("accepts an empty segment list (short or single-topic script)", () => {
    expect(isScriptTaxonomyOutput({ ...valid, segments: [] })).toBe(true)
  })

  it("rejects outputs outside the closed vocabulary or numeric ranges", () => {
    expect(isScriptTaxonomyOutput(null)).toBe(false)
    expect(isScriptTaxonomyOutput({ ...valid, format: "shortform" })).toBe(false)
    expect(isScriptTaxonomyOutput({ ...valid, topics: [] })).toBe(false)
    expect(
      isScriptTaxonomyOutput({
        ...valid,
        segments: [{ approxStartSeconds: -1, label: "intro" }],
      }),
    ).toBe(false)
    expect(
      isScriptTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          emotion: { ...validDetail.emotion, dominantEmotion: "joy" },
        },
      }),
    ).toBe(false)
  })

  it("requires the enriched detail block", () => {
    const { detail: _detail, ...withoutDetail } = valid
    void _detail
    expect(isScriptTaxonomyOutput(withoutDetail)).toBe(false)
  })

  it("rejects a detail block with an out-of-range ordinal", () => {
    expect(
      isScriptTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          substance: { ...validDetail.substance, substanceDensity: 11 },
        },
      }),
    ).toBe(false)
  })

  it("rejects a detail block missing a whole facet", () => {
    const { humor: _humor, ...detailWithoutHumor } = validDetail
    void _humor
    expect(
      isScriptTaxonomyOutput({ ...valid, detail: detailWithoutHumor }),
    ).toBe(false)
  })

  it("rejects a negative segment count", () => {
    expect(
      isScriptTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          structure: { ...validDetail.structure, segmentCount: -1 },
        },
      }),
    ).toBe(false)
  })
})

describe("isCurrentScriptTaxonomy", () => {
  const stored: ScriptTaxonomy = {
    format: "explainer",
    oneLineSummary: "",
    segments: [],
    topics: ["finance"],
    detail: validDetail as unknown as ScriptTaxonomy["detail"],
    wordCount: 1200,
    schemaVersion: SCRIPT_TAXONOMY_SCHEMA_VERSION,
    model: "test-model",
    generatedAt: "2026-07-01T00:00:00Z",
  }

  it("treats a taxonomy at the current schema version as current", () => {
    expect(isCurrentScriptTaxonomy(stored)).toBe(true)
  })

  it("treats a below-version taxonomy as stale", () => {
    expect(
      isCurrentScriptTaxonomy({
        ...stored,
        schemaVersion: SCRIPT_TAXONOMY_SCHEMA_VERSION - 1,
      }),
    ).toBe(false)
  })
})
