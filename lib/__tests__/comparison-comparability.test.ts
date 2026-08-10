import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  assessPairComparability,
  comparabilityForModel,
  comparabilityReason,
  COMPARABILITY_PROMPT,
  COMPARABILITY_RULES,
  isAnchored,
  trafficMixOverlap,
  trafficSourceLabel,
  type PairComparabilityInput,
} from "@/lib/comparison-comparability"

// The pair this module was written for, and the one every threshold below is
// sized against: two uploads three days apart, one that got distributed and one
// that did not.
//
//   Video A  1,100 views, 16% average watched
//   Video B     73 views, 19% average watched
//
// The Script head-to-head read the 3 point gap as a win for Video B and pointed
// every tip at it. The 95% margin on the difference between those two figures
// is about 9 points, and the two audiences barely overlap, so there was never a
// result there to point at.
const REAL_PAIR: PairComparabilityInput = {
  viewsA: 1_100,
  viewsB: 73,
  averageWatchedPercentA: 16,
  averageWatchedPercentB: 19,
}

// A pair that genuinely can be read: two well-watched videos, similarly
// reached, with a gap far outside the noise.
const HEALTHY_PAIR: PairComparabilityInput = {
  viewsA: 40_000,
  viewsB: 32_000,
  averageWatchedPercentA: 48,
  averageWatchedPercentB: 31,
  trafficSourcesA: [
    { source: "SUBSCRIBER", views: 26_000 },
    { source: "RELATED_VIDEO", views: 14_000 },
  ],
  trafficSourcesB: [
    { source: "SUBSCRIBER", views: 20_000 },
    { source: "RELATED_VIDEO", views: 12_000 },
  ],
}

describe("assessPairComparability: the watch question", () => {
  it("refuses to anchor the pair that produced this module", () => {
    const { watch } = assessPairComparability(REAL_PAIR)
    expect(watch.anchor).toBe("contrast")
    // Every reason at once: 73 viewers is too few to measure, 15x is too
    // lopsided to compare, and 3 points is inside the margin either way.
    expect(watch.caveats).toContain("small_sample")
    expect(watch.caveats).toContain("lopsided_samples")
    expect(watch.caveats).toContain("gap_within_noise")
  })

  it("anchors a pair that can actually carry a verdict", () => {
    const { watch } = assessPairComparability(HEALTHY_PAIR)
    expect(watch.anchor).toBe("anchored")
    expect(watch.caveats).toEqual([])
  })

  it("sizes the margin on the difference rather than on either figure alone", () => {
    const comparability = assessPairComparability(REAL_PAIR)
    expect(comparability.averageWatchedGapPoints).toBe(3)
    // Around 9 points, driven almost entirely by the 73 view side.
    expect(comparability.averageWatchedGapMarginPoints).toBeGreaterThan(8)
    expect(comparability.averageWatchedGapMarginPoints).toBeLessThan(11)
    expect(comparability.averageWatchedGapIsSignificant).toBe(false)
  })

  it("will not anchor two well-watched videos whose gap is inside the noise", () => {
    const { watch } = assessPairComparability({
      ...HEALTHY_PAIR,
      averageWatchedPercentA: 44,
      averageWatchedPercentB: 43.6,
    })
    expect(watch.anchor).toBe("contrast")
    expect(watch.caveats).toEqual(["gap_within_noise"])
  })

  it("catches a measured traffic mix difference that the view counts hide", () => {
    // Both videos well watched, similar view counts, gap far outside the noise,
    // so nothing about the audience sizes is wrong. They were simply shown to
    // completely different people, which moves a watch figure on its own.
    const { watch } = assessPairComparability({
      ...HEALTHY_PAIR,
      trafficSourcesA: [{ source: "SUBSCRIBER", views: 40_000 }],
      trafficSourcesB: [{ source: "YT_SEARCH", views: 32_000 }],
    })
    expect(watch.anchor).toBe("contrast")
    expect(watch.caveats).toEqual(["different_traffic_mix"])
  })

  it("is unknown, not anchored, when no view counts are stored", () => {
    const { watch } = assessPairComparability({
      viewsA: null,
      viewsB: null,
      averageWatchedPercentA: 40,
      averageWatchedPercentB: 20,
    })
    expect(watch.anchor).toBe("unknown")
  })
})

describe("assessPairComparability: the click question", () => {
  it("answers it separately from the watch question on the same pair", () => {
    // The whole point of two verdicts. This pair cannot say which video held
    // its audience better, and it is not disqualified from saying which one
    // earned its way in front of people, because a view gap is the outcome
    // packaging moves rather than a confound on it.
    const { watch, click } = assessPairComparability({
      ...REAL_PAIR,
      viewsB: 900,
      impressionsA: 400_000,
      impressionsB: 380_000,
      clickThroughRateA: 0.071,
      clickThroughRateB: 0.032,
    })
    expect(watch.anchor).toBe("contrast")
    expect(click.anchor).toBe("anchored")
  })

  it("does not treat a lopsided view gap as a reason to withhold a click verdict", () => {
    const { click } = assessPairComparability({
      viewsA: 400_000,
      viewsB: 9_000,
      averageWatchedPercentA: 40,
      averageWatchedPercentB: 41,
    })
    expect(click.anchor).toBe("anchored")
    // Views stood in for impressions, which the verdict says out loud.
    expect(click.caveats).toEqual(["no_impression_data"])
  })

  it("withholds it when one video was barely shown at all", () => {
    // 73 views with no impression data cannot separate a thumbnail nobody
    // clicked from a thumbnail nobody was offered.
    const { click } = assessPairComparability(REAL_PAIR)
    expect(click.anchor).toBe("contrast")
    expect(click.caveats).toContain("small_sample")
  })

  it("withholds it when two click-through rates are inside their own margin", () => {
    const { click } = assessPairComparability({
      ...HEALTHY_PAIR,
      impressionsA: 500_000,
      impressionsB: 480_000,
      clickThroughRateA: 0.0602,
      clickThroughRateB: 0.06,
    })
    expect(click.anchor).toBe("contrast")
    expect(click.caveats).toEqual(["gap_within_noise"])
  })

  it("withholds it when the impressions behind the rates are too thin", () => {
    const { click } = assessPairComparability({
      ...HEALTHY_PAIR,
      impressionsA: 400,
      impressionsB: 380,
      clickThroughRateA: 0.09,
      clickThroughRateB: 0.04,
    })
    expect(click.anchor).toBe("contrast")
    expect(click.caveats).toContain("small_sample")
  })
})

describe("trafficMixOverlap", () => {
  it("is 1 for two identically mixed audiences, whatever their sizes", () => {
    expect(
      trafficMixOverlap(
        [
          { source: "SUBSCRIBER", views: 800 },
          { source: "YT_SEARCH", views: 200 },
        ],
        [
          { source: "SUBSCRIBER", views: 8_000 },
          { source: "YT_SEARCH", views: 2_000 },
        ],
      ),
    ).toBeCloseTo(1)
  })

  it("is 0 for two audiences reached from completely different places", () => {
    expect(
      trafficMixOverlap(
        [{ source: "SUBSCRIBER", views: 500 }],
        [{ source: "YT_SEARCH", views: 500 }],
      ),
    ).toBeCloseTo(0)
  })

  it("measures the shared share when the mixes partly agree", () => {
    // 30% of one against 70% of the other on the shared source, plus 20 and 10
    // on the second: min(0.3, 0.7) + min(0.7, 0.3) is not the shape here, so
    // this checks the real arithmetic rather than a symmetry assumption.
    expect(
      trafficMixOverlap(
        [
          { source: "SUBSCRIBER", views: 700 },
          { source: "YT_SEARCH", views: 300 },
        ],
        [
          { source: "SUBSCRIBER", views: 300 },
          { source: "YT_SEARCH", views: 700 },
        ],
      ),
    ).toBeCloseTo(0.6)
  })

  it("is null when a breakdown is missing or too small to mean anything", () => {
    expect(trafficMixOverlap(null, [{ source: "SUBSCRIBER", views: 500 }])).toBeNull()
    expect(trafficMixOverlap([], [{ source: "SUBSCRIBER", views: 500 }])).toBeNull()
    expect(
      trafficMixOverlap(
        [{ source: "SUBSCRIBER", views: 10 }],
        [{ source: "SUBSCRIBER", views: 500 }],
      ),
    ).toBeNull()
  })
})

describe("trafficSourceLabel", () => {
  it("names the API's codes the way Studio names them", () => {
    // SUBSCRIBER is Studio's "Browse features", not "views by subscribers", and
    // a note that got this wrong would contradict the dashboard the creator
    // checks it against.
    expect(trafficSourceLabel("SUBSCRIBER")).toBe("Browse features")
    expect(trafficSourceLabel("RELATED_VIDEO")).toBe("Suggested videos")
    expect(trafficSourceLabel("YT_SEARCH")).toBe("YouTube search")
  })

  it("prettifies anything it has never seen rather than printing the code", () => {
    expect(trafficSourceLabel("SOME_NEW_SURFACE")).toBe("Some new surface")
  })
})

describe("comparabilityForModel", () => {
  it("withholds both performance figures from an unanchored watch comparison", () => {
    // The load-bearing assertion in this file. The prompt rules are the second
    // line of defence; this is the first. A number the model never receives
    // cannot orient a tip toward the video that happens to carry it.
    const comparability = assessPairComparability(REAL_PAIR)
    const view = comparabilityForModel(comparability, "watch")
    expect(view.anchor).toBe("contrast")
    expect(view.videoAViews).toBeNull()
    expect(view.videoBViews).toBeNull()
    expect(view.videoAAverageWatchedPercent).toBeNull()
    expect(view.videoBAverageWatchedPercent).toBeNull()
  })

  it("passes them through for a pair that earned them", () => {
    const view = comparabilityForModel(
      assessPairComparability(HEALTHY_PAIR),
      "watch",
    )
    expect(view.anchor).toBe("anchored")
    expect(view.videoAAverageWatchedPercent).toBe(48)
    expect(view.videoBAverageWatchedPercent).toBe(31)
  })

  it("hands each question its own verdict and its own figures", () => {
    const comparability = assessPairComparability({
      ...HEALTHY_PAIR,
      averageWatchedPercentA: 44,
      averageWatchedPercentB: 43.6,
      impressionsA: 500_000,
      impressionsB: 480_000,
      clickThroughRateA: 0.081,
      clickThroughRateB: 0.042,
    })
    const watch = comparabilityForModel(comparability, "watch")
    const click = comparabilityForModel(comparability, "click")

    // Watch is inside the noise and says nothing; click is a real result.
    expect(watch.anchor).toBe("contrast")
    expect(watch.videoAAverageWatchedPercent).toBeNull()
    expect(click.anchor).toBe("anchored")
    expect(click.videoAClickThroughPercent).toBeCloseTo(8.1)
  })

  it("names the question it is answering", () => {
    const comparability = assessPairComparability(HEALTHY_PAIR)
    expect(comparabilityForModel(comparability, "watch").question).toMatch(
      /held its audience/,
    )
    expect(comparabilityForModel(comparability, "click").question).toMatch(
      /earned the click/,
    )
  })
})

describe("comparabilityReason", () => {
  it("says nothing at all for an anchored pair", () => {
    const comparability = assessPairComparability(HEALTHY_PAIR)
    expect(isAnchored(comparability, "watch")).toBe(true)
    expect(comparabilityReason(comparability, "watch")).toBeNull()
  })

  it("names the smaller audience in real numbers", () => {
    const comparability = assessPairComparability(REAL_PAIR)
    expect(comparabilityReason(comparability, "watch")).toContain("73")
  })

  it("gives the click question its own wording rather than the watch one", () => {
    const comparability = assessPairComparability(REAL_PAIR)
    expect(comparabilityReason(comparability, "click")).toContain("thumbnail")
    expect(comparabilityReason(comparability, "watch")).toContain("watched by")
  })

  it("names the traffic mix when that is what disqualified the pair", () => {
    const reason = comparabilityReason(
      assessPairComparability({
        ...HEALTHY_PAIR,
        trafficSourcesA: [
          { source: "SUBSCRIBER", views: 34_000 },
          { source: "YT_SEARCH", views: 6_000 },
        ],
        trafficSourcesB: [
          { source: "SUBSCRIBER", views: 6_000 },
          { source: "YT_SEARCH", views: 26_000 },
        ],
      }),
      "watch",
    )
    expect(reason).toContain("different mixes of traffic")
  })
})

// GUARDRAIL: every prompt that writes advice about a PAIR of videos must
// include the shared comparability rules verbatim, so no surface can go back to
// crowning a winner out of two view counts on its own. This is the same
// arrangement lib/__tests__/tip-voice.test.ts enforces for the voice of a tip,
// and for the same reason: the rule was restated per prompt once before, and
// the prompts drifted. If a new head-to-head starts writing advice, add its
// file here. Do NOT delete or weaken this test.

const PAIR_ADVICE_SOURCE_FILES = [
  "lib/packaging-comparison-report.ts",
  "lib/script-comparison-report.ts",
]

const EM_DASH = "—"
const EN_DASH = "–"

describe("comparability guardrail", () => {
  for (const file of PAIR_ADVICE_SOURCE_FILES) {
    it(`${file} writes its advice under the shared comparability rules`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8")
      expect(
        source.includes("COMPARABILITY_PROMPT"),
        `${file} writes advice about a pair of videos, so its prompt must include COMPARABILITY_PROMPT from lib/comparison-comparability.ts rather than deciding for itself what the pair's performance figures are worth.`,
      ).toBe(true)
    })

    it(`${file} withholds the pair's performance figures when it may not rank them`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8")
      expect(
        source.includes("isAnchored"),
        `${file} must gate what it sends the model on isAnchored, not only tell the model in the prompt what it is allowed to conclude. The rules are the second line of defence; withholding the numbers is the first.`,
      ).toBe(true)
    })
  }

  it("states the rules the reports exist to follow", () => {
    // The wording is free to change; the substance is not, since a rewrite that
    // quietly drops one of these is how the reports regress. Each check names a
    // failure that actually shipped.

    // The verdict is computed, not negotiated.
    expect(COMPARABILITY_PROMPT).toMatch(/not negotiable/)

    // Both halves of why, since fixing only the noise leaves the confounder.
    expect(COMPARABILITY_PROMPT).toMatch(/chance alone/)
    expect(COMPARABILITY_PROMPT).toMatch(/already follow the channel/)

    // The ban that the screenshot needed: no winner, and no causal language
    // smuggling the ranking back in through a section body.
    expect(COMPARABILITY_PROMPT).toMatch(
      /never name either video the better performer/i,
    )
    expect(COMPARABILITY_PROMPT).toMatch(/supports, drives, sustains/)

    // The tip filter, which is what actually changes the advice on the page.
    expect(COMPARABILITY_PROMPT).toMatch(/stand on the craft evidence alone/)

    // Said once. A limit repeated in every section reads as an apology and
    // buries the comparison underneath it.
    expect(COMPARABILITY_PROMPT).toMatch(/exactly once/)

    // And the report still has to say something. Without this the model hedges
    // every field and the page becomes mush.
    expect(COMPARABILITY_PROMPT).toMatch(/as specific and as confident/)

    // Within-video evidence survives, so the reports keep the good half of
    // their evidence instead of throwing it out with the rankings.
    expect(COMPARABILITY_PROMPT).toMatch(/against itself/)
  })

  it("is one block of prompt text with no dashes the page bans", () => {
    expect(COMPARABILITY_PROMPT).toBe(COMPARABILITY_RULES.join(" "))
    expect(COMPARABILITY_PROMPT).not.toContain(EM_DASH)
    expect(COMPARABILITY_PROMPT).not.toContain(EN_DASH)
  })
})
