import { describe, expect, it } from "vitest"

import { buildPackagingComparison } from "@/lib/packaging-comparison"
import {
  isCurrentTaxonomy,
  PACKAGING_TAXONOMY_SCHEMA_VERSION,
  type PackagingDetail,
  type PackagingTaxonomy,
} from "@/lib/packaging-taxonomy"
import type { TranscriptCue } from "@/lib/youtube/youtube"

// The two fixtures model the real head-to-head the feature was built for: a
// high-view first-person confession ("I'm 26, Living With My Parents, And Have
// Invested Everything Into Crypto") against a low-view generic command ("STOP
// CHECKING THE CHARTS") whose upbeat thumbnail fights its warning title.

function detail(overrides: Partial<PackagingDetail> = {}): PackagingDetail {
  return {
    title: {
      specificity: 5,
      curiosityGap: 5,
      emotionalCharge: 5,
      emotionalValence: "neutral",
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
      faceProminence: 5,
      eyeContact: false,
      emotionIntensity: 5,
      sceneType: "talking_head_indoor",
      mood: "serious",
      colorContrast: 5,
      visualComplexity: 5,
      textVerbatim: "",
      impliedPromise: "",
    },
    hook: {
      openingType: "context_setup",
      payoffSpeed: 5,
      restatesPromise: 5,
      stakesEstablished: 5,
      personalDisclosure: 5,
      specificity: 5,
      genericFiller: false,
      firstSentence: "",
    },
    cross: {
      titleThumbnailMatch: 5,
      hookDeliversPromise: 5,
      singleClearPromise: "",
      contradiction: false,
      contradictionNote: "",
    },
    drivers: {
      clickDrivers: ["curiosity"],
      primaryDriver: "curiosity",
      archetype: "other",
      trendRelevance: 5,
      trendRelevanceConfidence: 5,
    },
    ...overrides,
  }
}

function taxonomy(
  top: Partial<PackagingTaxonomy>,
  detailBlock: PackagingDetail | null,
): PackagingTaxonomy {
  return {
    titleStyles: ["direct_label"],
    thumbnailHasFace: true,
    thumbnailEmotion: "serious",
    thumbnailTextWordCount: 0,
    promiseType: "other",
    hookDelivery: "delayed",
    alignmentScore: 0.5,
    topics: ["crypto"],
    model: "test-model",
    generatedAt: "2026-07-01T00:00:00Z",
    ...(detailBlock
      ? { detail: detailBlock, schemaVersion: PACKAGING_TAXONOMY_SCHEMA_VERSION }
      : {}),
    ...top,
  }
}

const cryptoTaxonomy = taxonomy(
  {
    titleStyles: ["personal_story", "curiosity_gap"],
    promiseType: "story",
    hookDelivery: "direct",
    alignmentScore: 0.9,
    topics: ["crypto", "investing"],
  },
  detail({
    title: {
      specificity: 9,
      curiosityGap: 6,
      emotionalCharge: 8,
      emotionalValence: "fear",
      stakes: 9,
      personalFraming: "first_person_confession",
      relatability: 8,
      novelty: 6,
      clarity: 7,
      targetIdentity: "young people betting on crypto",
      concreteAnchors: ["26", "living with parents", "crypto"],
      powerDevices: ["number", "taboo"],
      characterLength: 62,
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
      trendRelevance: 8,
      trendRelevanceConfidence: 7,
    },
  }),
)

const stopChartsTaxonomy = taxonomy(
  {
    titleStyles: ["negative_warning"],
    promiseType: "opinion",
    hookDelivery: "delayed",
    alignmentScore: 0.3,
    thumbnailEmotion: "happy",
    topics: ["crypto", "trading"],
  },
  detail({
    title: {
      specificity: 2,
      curiosityGap: 2,
      emotionalCharge: 3,
      emotionalValence: "neutral",
      stakes: 2,
      personalFraming: "second_person_command",
      relatability: 3,
      novelty: 2,
      clarity: 5,
      targetIdentity: "",
      concreteAnchors: [],
      powerDevices: ["all_caps", "negativity"],
      characterLength: 24,
    },
    thumbnail: {
      faceProminence: 7,
      eyeContact: true,
      emotionIntensity: 6,
      sceneType: "outdoor",
      mood: "celebratory",
      colorContrast: 5,
      visualComplexity: 4,
      textVerbatim: "",
      impliedPromise: "an upbeat, positive video",
    },
    hook: {
      openingType: "meta_intro",
      payoffSpeed: 3,
      restatesPromise: 3,
      stakesEstablished: 2,
      personalDisclosure: 2,
      specificity: 2,
      genericFiller: true,
      firstSentence: "Hey guys, welcome back to the channel.",
    },
    cross: {
      titleThumbnailMatch: 2,
      hookDeliversPromise: 3,
      singleClearPromise: "",
      contradiction: true,
      contradictionNote:
        "the title warns while the thumbnail celebrates",
    },
    drivers: {
      clickDrivers: ["authority"],
      primaryDriver: "authority",
      archetype: "warning",
      trendRelevance: 2,
      trendRelevanceConfidence: 3,
    },
  }),
)

// Cue lists long enough to run past the ten second mark, so the opening the
// comparison carries is a real slice rather than the whole transcript.
const cryptoCues: TranscriptCue[] = [
  { startSeconds: 0, endSeconds: 4, text: "I'm 26 and I live with my parents." },
  { startSeconds: 4, endSeconds: 9, text: "Every pound I have is in crypto." },
  { startSeconds: 9, endSeconds: 12, text: "Here is what that actually feels like." },
  { startSeconds: 12, endSeconds: 18, text: "So let's start with the numbers." },
]

const stopCues: TranscriptCue[] = [
  { startSeconds: 0, endSeconds: 5, text: "Hey guys, welcome back to the channel." },
  { startSeconds: 5, endSeconds: 10, text: "Before we start, hit that subscribe button." },
  { startSeconds: 10.5, endSeconds: 16, text: "Right, so the charts have been wild." },
]

const cryptoInput = {
  id: "crypto",
  title: "I'm 26, Living With My Parents, And Have Invested Everything Into Crypto",
  thumbnailUrl: "https://i.ytimg.com/vi/crypto/maxresdefault.jpg",
  views: 3515,
  transcript: cryptoCues,
  taxonomy: cryptoTaxonomy,
}

const stopInput = {
  id: "stop",
  title: "STOP CHECKING THE CHARTS",
  thumbnailUrl: "https://i.ytimg.com/vi/stop/maxresdefault.jpg",
  views: 131,
  transcript: stopCues,
  taxonomy: stopChartsTaxonomy,
}

describe("buildPackagingComparison", () => {
  it("orients toward the higher-viewed video and reports full coverage", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    expect(result).not.toBeNull()
    expect(result?.higherViewsSide).toBe("a")
    expect(result?.detailCoverage).toBe("both")
  })

  it("surfaces the title specificity gap as the leading, view-aligned story", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    const specificity = result?.highlights.find(
      (h) => h.key === "title.specificity",
    )
    expect(specificity).toBeDefined()
    expect(specificity?.favours).toBe("a")
    expect(specificity?.detail).toContain("9 vs 2")
    // Every ranked difference points the same way: the higher-viewed video.
    expect(result?.highlights.length).toBeGreaterThan(0)
    expect(
      result?.highlights.every((h) => h.favours !== "b"),
    ).toBe(true)
  })

  it("flags the thumbnail/title contradiction in the low-view video", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    const contradiction = result?.highlights.find(
      (h) => h.key === "cross.contradiction",
    )
    expect(contradiction).toBeDefined()
    expect(contradiction?.favours).toBe("a")

    const flagRow = result?.flags.find((f) => f.key === "cross.contradiction")
    expect(flagRow?.a).toBe(false)
    expect(flagRow?.b).toBe(true)
    expect(flagRow?.favours).toBe("a")
  })

  it("diffs framing as a categorical mismatch with pretty labels", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    const framing = result?.categoricals.find(
      (c) => c.key === "title.personalFraming",
    )
    expect(framing?.match).toBe(false)
    expect(framing?.onlyA).toEqual(["First person confession"])
    expect(framing?.onlyB).toEqual(["Second person command"])
  })

  it("puts the verbatim opening lines side by side", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    const firstSentence = result?.spans.find(
      (s) => s.key === "hook.firstSentence",
    )
    expect(firstSentence?.b).toContain("welcome back")
  })

  it("carries the whole spoken first ten seconds, not just the opening line", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    expect(result?.a.hookTranscript).toBe(
      "I'm 26 and I live with my parents. Every pound I have is in crypto. Here is what that actually feels like.",
    )
    // The whole hook, so every sentence inside the window is present rather
    // than only the first one the taxonomy recorded.
    expect(result?.b.hookTranscript).toContain("welcome back to the channel")
    expect(result?.b.hookTranscript).toContain("hit that subscribe button")
  })

  it("stops the opening at the ten second mark", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    // Cues starting after the window are left out; one still running at ten
    // seconds is carried whole rather than cut mid-sentence.
    expect(result?.a.hookTranscript).not.toContain("start with the numbers")
    expect(result?.b.hookTranscript).not.toContain("charts have been wild")
  })

  it("leaves the opening unset when the video has no transcript", () => {
    const result = buildPackagingComparison(
      { ...cryptoInput, transcript: [] },
      stopInput,
    )
    expect(result?.a.hookTranscript).toBeNull()
    expect(result?.b.hookTranscript).not.toBeNull()
  })

  it("diffs the topic's trend relevance as a driver ordinal", () => {
    const result = buildPackagingComparison(cryptoInput, stopInput)
    const trend = result?.ordinals.find((o) => o.key === "drivers.trendRelevance")
    expect(trend?.surface).toBe("drivers")
    expect(trend?.a).toBe(8)
    expect(trend?.b).toBe(2)
    expect(trend?.delta).toBe(6)
  })

  it("keeps the alignment axis available even without a detail block", () => {
    const stopNoDetail = {
      ...stopInput,
      taxonomy: taxonomy(
        { titleStyles: ["negative_warning"], alignmentScore: 0.3 },
        null,
      ),
    }
    const result = buildPackagingComparison(cryptoInput, stopNoDetail)
    expect(result?.detailCoverage).toBe("one")
    const alignment = result?.ordinals.find(
      (o) => o.key === "overall.alignment",
    )
    expect(alignment?.a).toBe(9)
    expect(alignment?.b).toBe(3)
    expect(alignment?.delta).toBe(6)
  })

  it("returns a bodyless comparison when only one side has a taxonomy", () => {
    const result = buildPackagingComparison(cryptoInput, {
      ...stopInput,
      taxonomy: null,
    })
    expect(result).not.toBeNull()
    expect(result?.ordinals).toEqual([])
    expect(result?.a.hasTaxonomy).toBe(true)
    expect(result?.b.hasTaxonomy).toBe(false)
  })

  it("returns null when neither side has a taxonomy", () => {
    const result = buildPackagingComparison(
      { ...cryptoInput, taxonomy: null },
      { ...stopInput, taxonomy: null },
    )
    expect(result).toBeNull()
  })

  it("leaves the view orientation unset when views are tied or unknown", () => {
    const tied = buildPackagingComparison(
      { ...cryptoInput, views: 100 },
      { ...stopInput, views: 100 },
    )
    expect(tied?.higherViewsSide).toBeNull()
  })
})

describe("isCurrentTaxonomy", () => {
  it("accepts a taxonomy at the current schema version", () => {
    expect(isCurrentTaxonomy(cryptoTaxonomy)).toBe(true)
  })

  it("rejects a taxonomy with no detail block", () => {
    expect(isCurrentTaxonomy(taxonomy({}, null))).toBe(false)
  })

  it("rejects a taxonomy whose schema version predates the current one", () => {
    const stale = { ...cryptoTaxonomy, schemaVersion: 1 }
    expect(isCurrentTaxonomy(stale)).toBe(false)
  })
})
