import { describe, expect, it } from "vitest"

import { isPackagingTaxonomyOutput } from "@/lib/packaging-taxonomy"

const validDetail = {
  title: {
    specificity: 9,
    curiosityGap: 6,
    emotionalCharge: 8,
    emotionalValence: "fear",
    stakes: 9,
    personalFraming: "first_person_confession",
    relatability: 7,
    novelty: 5,
    clarity: 6,
    targetIdentity: "young crypto investors",
    concreteAnchors: ["26", "crypto"],
    powerDevices: ["number", "taboo"],
    characterLength: 62,
  },
  thumbnail: {
    faceProminence: 8,
    eyeContact: true,
    emotionIntensity: 5,
    sceneType: "talking_head_indoor",
    mood: "serious",
    colorContrast: 6,
    visualComplexity: 3,
    textVerbatim: "",
    impliedPromise: "a personal confession",
  },
  hook: {
    openingType: "cold_open_story",
    payoffSpeed: 7,
    restatesPromise: 8,
    stakesEstablished: 8,
    personalDisclosure: 9,
    specificity: 7,
    genericFiller: false,
    firstSentence: "So I put everything into crypto.",
  },
  cross: {
    titleThumbnailMatch: 9,
    hookDeliversPromise: 8,
    singleClearPromise: "a risky personal crypto bet",
    contradiction: false,
    contradictionNote: "",
  },
  drivers: {
    clickDrivers: ["identity", "curiosity"],
    primaryDriver: "identity",
    archetype: "personal_stakes_confession",
  },
}

const valid = {
  titleStyles: ["curiosity_gap"],
  thumbnailHasFace: true,
  thumbnailEmotion: "excited",
  thumbnailTextWordCount: 3,
  promiseType: "transformation",
  hookDelivery: "direct",
  alignmentScore: 0.8,
  topics: ["gear reviews"],
  detail: validDetail,
}

describe("isPackagingTaxonomyOutput", () => {
  it("accepts a well-formed model output, including the faceless sentinel", () => {
    expect(isPackagingTaxonomyOutput(valid)).toBe(true)
    expect(
      isPackagingTaxonomyOutput({
        ...valid,
        thumbnailHasFace: false,
        thumbnailEmotion: "none",
      }),
    ).toBe(true)
  })

  it("accepts the power-device 'none' sentinel and an empty anchor list", () => {
    expect(
      isPackagingTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          title: {
            ...validDetail.title,
            powerDevices: ["none"],
            concreteAnchors: [],
          },
        },
      }),
    ).toBe(true)
  })

  it("rejects outputs outside the closed vocabulary or numeric ranges", () => {
    expect(isPackagingTaxonomyOutput(null)).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, titleStyles: ["clickbait"] }),
    ).toBe(false)
    expect(isPackagingTaxonomyOutput({ ...valid, titleStyles: [] })).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, thumbnailEmotion: null }),
    ).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, thumbnailTextWordCount: -1 }),
    ).toBe(false)
    expect(
      isPackagingTaxonomyOutput({ ...valid, alignmentScore: 1.2 }),
    ).toBe(false)
    expect(isPackagingTaxonomyOutput({ ...valid, topics: [] })).toBe(false)
  })

  it("requires the enriched detail block", () => {
    const { detail: _detail, ...withoutDetail } = valid
    void _detail
    expect(isPackagingTaxonomyOutput(withoutDetail)).toBe(false)
  })

  it("rejects a detail block with an out-of-range ordinal", () => {
    expect(
      isPackagingTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          title: { ...validDetail.title, specificity: 11 },
        },
      }),
    ).toBe(false)
  })

  it("rejects a detail block with an unknown enum value", () => {
    expect(
      isPackagingTaxonomyOutput({
        ...valid,
        detail: {
          ...validDetail,
          drivers: { ...validDetail.drivers, primaryDriver: "clickbait" },
        },
      }),
    ).toBe(false)
  })

  it("rejects a detail block missing a whole surface", () => {
    const { thumbnail: _thumbnail, ...detailWithoutThumbnail } = validDetail
    void _thumbnail
    expect(
      isPackagingTaxonomyOutput({ ...valid, detail: detailWithoutThumbnail }),
    ).toBe(false)
  })
})
