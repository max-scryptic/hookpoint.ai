import { describe, expect, it } from "vitest"

import {
  buildChannelAlignmentAverage,
  buildChannelAxisProfile,
  buildChannelStyleProfile,
  videoTopics,
  type TaxonomyProfileVideo,
} from "@/lib/channel-taxonomy-trends"
import type { PackagingDetail, PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import type { ScriptDetail, ScriptTaxonomy } from "@/lib/script-taxonomy"

function packagingDetail(
  overrides: {
    titleSpecificity?: number
    titleCuriosityGap?: number
    faceProminence?: number
    payoffSpeed?: number
    titleThumbnailMatch?: number
    hookDeliversPromise?: number
    archetype?: PackagingDetail["drivers"]["archetype"]
    primaryDriver?: PackagingDetail["drivers"]["primaryDriver"]
  } = {},
): PackagingDetail {
  return {
    title: {
      specificity: overrides.titleSpecificity ?? 5,
      curiosityGap: overrides.titleCuriosityGap ?? 5,
      emotionalCharge: 5,
      emotionalValence: "curiosity",
      stakes: 5,
      personalFraming: "impersonal",
      relatability: 5,
      novelty: 5,
      clarity: 5,
      targetIdentity: "",
      concreteAnchors: [],
      powerDevices: [],
      characterLength: 40,
    },
    thumbnail: {
      faceProminence: overrides.faceProminence ?? 5,
      eyeContact: true,
      emotionIntensity: 5,
      sceneType: "talking_head_indoor",
      mood: "serious",
      colorContrast: 5,
      visualComplexity: 5,
      textVerbatim: "",
      impliedPromise: "",
    },
    hook: {
      openingType: "bold_claim",
      payoffSpeed: overrides.payoffSpeed ?? 5,
      restatesPromise: 5,
      stakesEstablished: 5,
      personalDisclosure: 5,
      specificity: 5,
      genericFiller: false,
      firstSentence: "",
    },
    cross: {
      titleThumbnailMatch: overrides.titleThumbnailMatch ?? 5,
      hookDeliversPromise: overrides.hookDeliversPromise ?? 5,
      singleClearPromise: "",
      contradiction: false,
      contradictionNote: "",
    },
    drivers: {
      clickDrivers: ["curiosity"],
      primaryDriver: overrides.primaryDriver ?? "curiosity",
      archetype: overrides.archetype ?? "tutorial",
      trendRelevance: 2,
      trendRelevanceConfidence: 2,
    },
  }
}

function packaging(
  overrides: Parameters<typeof packagingDetail>[0] & {
    detail?: false
    topics?: string[]
    titleStyles?: PackagingTaxonomy["titleStyles"]
    alignmentScore?: number
  } = {},
): PackagingTaxonomy {
  return {
    titleStyles: overrides.titleStyles ?? ["how_to"],
    thumbnailHasFace: true,
    thumbnailEmotion: "serious",
    thumbnailTextWordCount: 2,
    promiseType: "how_to",
    hookDelivery: "direct",
    alignmentScore: overrides.alignmentScore ?? 0.8,
    topics: overrides.topics ?? ["editing"],
    detail: overrides.detail === false ? undefined : packagingDetail(overrides),
    schemaVersion: 3,
    model: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function scriptDetail(
  overrides: { concreteness?: number; fillerLevel?: number } = {},
): ScriptDetail {
  return {
    structure: {
      segmentCount: 4,
      topicCohesion: 5,
      openLoops: 5,
      payoffPlacement: 5,
      hasCta: true,
    },
    substance: {
      substanceDensity: 5,
      concreteness: overrides.concreteness ?? 5,
      noveltyOfIdeas: 5,
      educationalValue: 5,
      entertainmentValue: 5,
      fillerLevel: overrides.fillerLevel ?? 5,
    },
    emotion: {
      dominantEmotion: "curiosity",
      energy: 5,
      emotionalRange: 5,
      arcShape: "rising",
      vulnerability: 5,
    },
    humor: { humorDensity: 3, humorStyle: null },
    rhetoric: {
      narrativeVoice: "second_person_guide",
      directAddress: 5,
      persuasionDevices: ["storytelling"],
      stakes: 5,
      relatability: 5,
    },
    drivers: {
      scriptArchetype: "educational_deep_dive",
      primaryEngagementDriver: "information",
    },
  }
}

function script(
  overrides: Parameters<typeof scriptDetail>[0] & {
    format?: ScriptTaxonomy["format"]
    topics?: string[]
  } = {},
): ScriptTaxonomy {
  return {
    format: overrides.format ?? "tutorial",
    oneLineSummary: "A test script.",
    segments: [],
    topics: overrides.topics ?? ["editing"],
    detail: scriptDetail(overrides),
    wordCount: 900,
    schemaVersion: 1,
    model: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
  }
}

interface TestVideo extends TaxonomyProfileVideo {
  reach: number | null
}

function video(
  id: string,
  reach: number | null,
  extras: Partial<Omit<TestVideo, "id" | "reach">> = {},
): TestVideo {
  return {
    id,
    title: id,
    reach,
    packaging: null,
    script: null,
    ...extras,
  }
}

const reachOf = (item: TestVideo) => item.reach

describe("buildChannelAxisProfile", () => {
  it("returns null until enough videos carry an enriched taxonomy", () => {
    expect(
      buildChannelAxisProfile({
        videos: [
          video("a", 10, { packaging: packaging() }),
          video("b", 5, { packaging: packaging() }),
        ],
        source: "packaging",
        outcome: "reach",
        outcomeOf: reachOf,
      }),
    ).toBeNull()
  })

  it("ignores a v1 packaging row that carries no detail block", () => {
    expect(
      buildChannelAxisProfile({
        videos: [
          video("a", 10, { packaging: packaging({ detail: false }) }),
          video("b", 8, { packaging: packaging({ detail: false }) }),
          video("c", 5, { packaging: packaging({ detail: false }) }),
        ],
        source: "packaging",
        outcome: "reach",
        outcomeOf: reachOf,
      }),
    ).toBeNull()
  })

  it("reports the channel median on every axis even with no outcome to split on", () => {
    const profile = buildChannelAxisProfile({
      videos: [
        video("a", null, { packaging: packaging({ titleSpecificity: 2 }) }),
        video("b", null, { packaging: packaging({ titleSpecificity: 4 }) }),
        video("c", null, { packaging: packaging({ titleSpecificity: 9 }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    expect(profile).not.toBeNull()
    expect(profile!.taxonomyVideoCount).toBe(3)
    expect(profile!.bandSize).toBe(0)
    expect(profile!.contrastVideoCount).toBe(0)
    expect(profile!.contrasts).toEqual([])
    const specificity = profile!.axes.find(
      (axis) => axis.key === "title.specificity",
    )
    expect(specificity?.channelMedian).toBe(4)
    expect(specificity?.topMedian).toBeNull()
    expect(specificity?.delta).toBeNull()
  })

  it("splits the library on the outcome and surfaces the axes that separate", () => {
    const profile = buildChannelAxisProfile({
      videos: [
        video("a", 100, {
          packaging: packaging({ titleSpecificity: 9, faceProminence: 5 }),
        }),
        video("b", 90, {
          packaging: packaging({ titleSpecificity: 8, faceProminence: 5 }),
        }),
        video("c", 10, {
          packaging: packaging({ titleSpecificity: 2, faceProminence: 5 }),
        }),
        video("d", 5, {
          packaging: packaging({ titleSpecificity: 1, faceProminence: 5 }),
        }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    expect(profile).not.toBeNull()
    expect(profile!.bandSize).toBe(2)
    expect(profile!.contrastVideoCount).toBe(4)
    expect(profile!.contrasts).toHaveLength(1)
    const [contrast] = profile!.contrasts
    expect(contrast.key).toBe("title.specificity")
    expect(contrast.topMedian).toBe(8.5)
    expect(contrast.bottomMedian).toBe(1.5)
    expect(contrast.delta).toBe(7)
    // An axis both halves scored alike on is present in the profile but is not
    // reported as a finding.
    expect(profile!.axes.some((axis) => axis.key === "thumbnail.faceProminence")).toBe(
      true,
    )
  })

  it("keeps a video with no outcome out of the split but in the medians", () => {
    const profile = buildChannelAxisProfile({
      videos: [
        video("a", 100, { packaging: packaging({ titleSpecificity: 10 }) }),
        video("b", 90, { packaging: packaging({ titleSpecificity: 10 }) }),
        video("c", 10, { packaging: packaging({ titleSpecificity: 0 }) }),
        video("d", 5, { packaging: packaging({ titleSpecificity: 0 }) }),
        video("e", null, { packaging: packaging({ titleSpecificity: 0 }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    const specificity = profile!.axes.find(
      (axis) => axis.key === "title.specificity",
    )
    expect(profile!.contrastVideoCount).toBe(4)
    expect(specificity?.videoCount).toBe(5)
    expect(specificity?.channelMedian).toBe(0)
    expect(specificity?.topMedian).toBe(10)
    expect(specificity?.bottomMedian).toBe(0)
  })

  it("reads the script taxonomy against retention the same way", () => {
    const profile = buildChannelAxisProfile({
      videos: [
        video("a", 60, { script: script({ concreteness: 9 }) }),
        video("b", 55, { script: script({ concreteness: 8 }) }),
        video("c", 20, { script: script({ concreteness: 2 }) }),
        video("d", 15, { script: script({ concreteness: 1 }) }),
      ],
      source: "script",
      outcome: "retention",
      outcomeOf: reachOf,
    })

    expect(profile!.source).toBe("script")
    expect(profile!.contrasts[0].key).toBe("substance.concreteness")
    expect(profile!.contrasts[0].delta).toBe(7)
  })
})

describe("buildChannelAlignmentAverage", () => {
  it("returns null until enough videos carry a packaging read", () => {
    expect(
      buildChannelAlignmentAverage([
        video("a", 10, { packaging: packaging() }),
        video("b", 5, { packaging: packaging() }),
      ]),
    ).toBeNull()
  })

  it("averages the headline onto the 0-10 scale a video report prints", () => {
    const average = buildChannelAlignmentAverage([
      video("a", 10, { packaging: packaging({ alignmentScore: 0.9 }) }),
      video("b", 5, { packaging: packaging({ alignmentScore: 0.6 }) }),
      video("c", 1, { packaging: packaging({ alignmentScore: 0.3 }) }),
      // No packaging read yet, so it is not part of the average.
      video("d", 8),
    ])

    expect(average).not.toBeNull()
    expect(average!.score).toBe(6)
    expect(average!.videoCount).toBe(3)
  })

  it("rounds a mean that lands between the integers to one decimal", () => {
    const average = buildChannelAlignmentAverage([
      video("a", 10, { packaging: packaging({ alignmentScore: 0.9 }) }),
      video("b", 5, { packaging: packaging({ alignmentScore: 0.9 }) }),
      video("c", 1, { packaging: packaging({ alignmentScore: 0.4 }) }),
    ])

    expect(average!.score).toBe(7.3)
  })

  it("averages the two cross axes the headline is made of", () => {
    const average = buildChannelAlignmentAverage([
      video("a", 10, {
        packaging: packaging({ titleThumbnailMatch: 9, hookDeliversPromise: 4 }),
      }),
      video("b", 5, {
        packaging: packaging({ titleThumbnailMatch: 8, hookDeliversPromise: 3 }),
      }),
      video("c", 1, {
        packaging: packaging({ titleThumbnailMatch: 7, hookDeliversPromise: 2 }),
      }),
    ])

    expect(average!.parts).toEqual([
      { key: "titleThumbnailMatch", value: 8 },
      { key: "hookDeliversPromise", value: 3 },
    ])
    expect(average!.partVideoCount).toBe(3)
  })

  it("still reports the headline when no video carries an enriched read", () => {
    const average = buildChannelAlignmentAverage([
      video("a", 10, {
        packaging: packaging({ detail: false, alignmentScore: 0.5 }),
      }),
      video("b", 5, {
        packaging: packaging({ detail: false, alignmentScore: 0.5 }),
      }),
      video("c", 1, {
        packaging: packaging({ detail: false, alignmentScore: 0.5 }),
      }),
    ])

    expect(average!.score).toBe(5)
    expect(average!.parts).toEqual([])
    expect(average!.partVideoCount).toBe(0)
  })

  // A library part way through the enriched rollout: the headline covers every
  // read video, the two parts only the ones carrying a detail block.
  it("counts the parts over the enriched videos alone", () => {
    const average = buildChannelAlignmentAverage([
      video("a", 10, { packaging: packaging({ titleThumbnailMatch: 8 }) }),
      video("b", 5, { packaging: packaging({ titleThumbnailMatch: 6 }) }),
      video("c", 1, { packaging: packaging({ detail: false }) }),
    ])

    expect(average!.videoCount).toBe(3)
    expect(average!.partVideoCount).toBe(2)
    expect(
      average!.parts.find((part) => part.key === "titleThumbnailMatch")?.value,
    ).toBe(7)
  })
})

describe("buildChannelStyleProfile", () => {
  it("returns null until enough videos carry the taxonomy", () => {
    expect(
      buildChannelStyleProfile({
        videos: [video("a", 10, { packaging: packaging() })],
        source: "packaging",
        outcome: "reach",
        outcomeOf: reachOf,
      }),
    ).toBeNull()
  })

  it("counts each dimension and puts the most repeated choice first", () => {
    const profile = buildChannelStyleProfile({
      videos: [
        video("a", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("b", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("c", 10, { packaging: packaging({ archetype: "tutorial" }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    const archetype = profile!.dimensions.find(
      (dimension) => dimension.key === "packaging.archetype",
    )
    expect(archetype?.videoCount).toBe(3)
    expect(archetype?.rows[0]).toMatchObject({ value: "warning", videoCount: 2 })
    expect(archetype?.rows[1]).toMatchObject({
      value: "tutorial",
      videoCount: 1,
    })
  })

  it("flags a non-dominant category that outperforms the channel median", () => {
    const profile = buildChannelStyleProfile({
      videos: [
        video("a", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("b", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("c", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("d", 100, { packaging: packaging({ archetype: "tutorial" }) }),
        video("e", 100, { packaging: packaging({ archetype: "tutorial" }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    const archetype = profile!.dimensions.find(
      (dimension) => dimension.key === "packaging.archetype",
    )
    expect(archetype?.standout?.value).toBe("tutorial")
    expect(archetype?.standout?.outcomeRatio).toBe(10)
  })

  it("leaves the ratio unset when a category has too few videos to judge", () => {
    const profile = buildChannelStyleProfile({
      videos: [
        video("a", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("b", 10, { packaging: packaging({ archetype: "warning" }) }),
        video("c", 100, { packaging: packaging({ archetype: "tutorial" }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    const archetype = profile!.dimensions.find(
      (dimension) => dimension.key === "packaging.archetype",
    )
    expect(
      archetype?.rows.find((row) => row.value === "tutorial")?.outcomeRatio,
    ).toBeNull()
    expect(archetype?.standout).toBeNull()
  })

  it("counts a video once per dimension even when it carries two title styles", () => {
    const profile = buildChannelStyleProfile({
      videos: [
        video("a", 10, {
          packaging: packaging({ titleStyles: ["how_to", "number_list"] }),
        }),
        video("b", 10, { packaging: packaging({ titleStyles: ["how_to"] }) }),
        video("c", 10, { packaging: packaging({ titleStyles: ["question"] }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    const titleStyle = profile!.dimensions.find(
      (dimension) => dimension.key === "packaging.titleStyle",
    )
    expect(titleStyle?.videoCount).toBe(3)
    expect(titleStyle?.rows[0]).toMatchObject({ value: "how_to", videoCount: 2 })
    expect(
      titleStyle?.rows.find((row) => row.value === "number_list")?.videoCount,
    ).toBe(1)
  })

  it("still profiles a v1 packaging row through its flat fields", () => {
    const profile = buildChannelStyleProfile({
      videos: [
        video("a", 10, { packaging: packaging({ detail: false }) }),
        video("b", 10, { packaging: packaging({ detail: false }) }),
        video("c", 10, { packaging: packaging({ detail: false }) }),
      ],
      source: "packaging",
      outcome: "reach",
      outcomeOf: reachOf,
    })

    expect(profile!.dimensions.map((dimension) => dimension.key)).toEqual([
      "packaging.titleStyle",
    ])
  })
})

describe("videoTopics", () => {
  it("unions the two taxonomies' topics without repeating one", () => {
    expect(
      videoTopics(
        video("a", 10, {
          packaging: packaging({ topics: ["editing", "gear"] }),
          script: script({ topics: ["editing", "workflow"] }),
        }),
      ).sort(),
    ).toEqual(["editing", "gear", "workflow"])
  })

  it("returns nothing for a video with neither taxonomy", () => {
    expect(videoTopics(video("a", 10))).toEqual([])
  })
})
