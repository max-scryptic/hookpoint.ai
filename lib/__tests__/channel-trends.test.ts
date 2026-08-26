import { describe, expect, it } from "vitest"

import type { ChannelEventRecord } from "@/lib/channel-event-history"
import {
  buildChannelInsights,
  buildChannelPlaybook,
  buildChannelRecurrence,
  buildChannelSignature,
  buildChannelSnapshot,
  buildChannelTrends,
  buildPackagingPatterns,
  buildSubscriberConversion,
  channelTrendsStage,
  packagingFeatures,
  videoReachPerDay,
  videoViews,
  type ChannelVideo,
} from "@/lib/channel-trends"
import type {
  PackagingDetail,
  PackagingTaxonomy,
} from "@/lib/packaging-taxonomy"

function record(overrides: Partial<ChannelEventRecord>): ChannelEventRecord {
  return {
    analysedVideoId: "av-1",
    windowKind: "drop_off",
    eventType: "pacing_change",
    narrative: "Cuts slow to a crawl here.",
    confidence: 0.7,
    ...overrides,
  }
}

function video(
  id: string,
  title: string | null = null,
  dateAnalysed: string | null = null,
  extras: Partial<
    Omit<ChannelVideo, "id" | "title" | "dateAnalysed">
  > = {},
): ChannelVideo {
  return {
    id,
    title,
    dateAnalysed,
    views: null,
    subscribersGained: null,
    subscribersLost: null,
    publishedAt: null,
    analyticsFetchedAt: null,
    browseSuggestedShare: null,
    averageViewPercentage: null,
    impressionClickThroughRate: null,
    packaging: null,
    script: null,
    retention: null,
    durationSeconds: null,
    ...extras,
  }
}

describe("channelTrendsStage", () => {
  it("maps library size onto the progressive unlock stages", () => {
    expect(channelTrendsStage(0)).toBe("empty")
    expect(channelTrendsStage(1)).toBe("building")
    expect(channelTrendsStage(2)).toBe("building")
    expect(channelTrendsStage(3)).toBe("early")
    expect(channelTrendsStage(5)).toBe("early")
    expect(channelTrendsStage(6)).toBe("established")
    expect(channelTrendsStage(25)).toBe("established")
  })
})

describe("buildChannelTrends", () => {
  it("aggregates trends per kind with distinct-video recurrence and titles", () => {
    const data = buildChannelTrends({
      records: [
        record({ analysedVideoId: "av-1", eventType: "pacing_change" }),
        record({ analysedVideoId: "av-2", eventType: "pacing_change" }),
        record({ analysedVideoId: "av-2", eventType: "scene_cut" }),
        record({
          analysedVideoId: "av-3",
          windowKind: "gain",
          eventType: "scene_cut",
          narrative: "A burst of quick cuts holds attention.",
        }),
      ],
      videos: [
        video("av-1", "How I edit"),
        video("av-2", "My studio tour"),
        video("av-3", "Gear review"),
      ],
      libraryVideoCount: 3,
      windowCount: 7,
    })

    expect(data.stage).toBe("early")
    expect(data.libraryVideoCount).toBe(3)
    expect(data.windowCount).toBe(7)
    expect(data.eventCount).toBe(4)
    expect(data.hooks).toBeNull()
    expect(data.dropOffs?.eventCount).toBe(3)
    expect(data.dropOffs?.trends[0]).toMatchObject({
      eventType: "pacing_change",
      eventCount: 2,
      videoCount: 2,
    })
    expect(data.gains?.trends).toEqual([
      {
        eventType: "scene_cut",
        eventCount: 1,
        videoCount: 1,
        events: [
          {
            narrative: "A burst of quick cuts holds attention.",
            videoTitle: "Gear review",
            confidence: 0.7,
          },
        ],
      },
    ])
    expect(data.holds).toBeNull()
  })

  it("keeps audience holds separate from retention gains", () => {
    const data = buildChannelTrends({
      records: [
        record({ analysedVideoId: "av-1", windowKind: "hold" }),
        record({ analysedVideoId: "av-2", windowKind: "hold" }),
        record({ analysedVideoId: "av-3", windowKind: "gain" }),
      ],
      videos: [
        video("av-1", "Hold one"),
        video("av-2", "Hold two"),
        video("av-3", "Gain one"),
      ],
      libraryVideoCount: 3,
      windowCount: 3,
    })

    expect(data.holds?.eventCount).toBe(2)
    expect(data.holds?.trends[0].videoCount).toBe(2)
    expect(data.gains?.eventCount).toBe(1)
  })

  it("orders trends by distinct-video recurrence before raw event volume", () => {
    const data = buildChannelTrends({
      records: [
        record({ analysedVideoId: "av-1", eventType: "topic_shift" }),
        record({ analysedVideoId: "av-1", eventType: "topic_shift" }),
        record({ analysedVideoId: "av-1", eventType: "topic_shift" }),
        record({ analysedVideoId: "av-1", eventType: "audio_change" }),
        record({ analysedVideoId: "av-2", eventType: "audio_change" }),
      ],
      videos: [],
      libraryVideoCount: 2,
      windowCount: 4,
    })

    expect(data.dropOffs?.trends.map((trend) => trend.eventType)).toEqual([
      "audio_change",
      "topic_shift",
    ])
  })

  it("ranks a trend's individual events by confidence for the drill-down", () => {
    const data = buildChannelTrends({
      records: [
        record({ analysedVideoId: "av-1", narrative: "n-0.5", confidence: 0.5 }),
        record({ analysedVideoId: "av-2", narrative: "n-0.9", confidence: 0.9 }),
        record({ analysedVideoId: "av-3", narrative: "n-null", confidence: null }),
        record({ analysedVideoId: "av-4", narrative: "n-0.8", confidence: 0.8 }),
      ],
      videos: [
        video("av-1", "One"),
        video("av-2", "Two"),
        video("av-3", "Three"),
        video("av-4", "Four"),
      ],
      libraryVideoCount: 4,
      windowCount: 4,
    })

    const trend = data.dropOffs?.trends[0]
    expect(trend?.videoCount).toBe(4)
    expect(trend?.eventCount).toBe(4)
    // Every occurrence is carried, highest-confidence first, each attributed.
    expect(trend?.events.map((event) => event.narrative)).toEqual([
      "n-0.9",
      "n-0.8",
      "n-0.5",
      "n-null",
    ])
    expect(trend?.events[0]).toEqual({
      narrative: "n-0.9",
      videoTitle: "Two",
      confidence: 0.9,
    })
  })

  it("reports an empty library without trends or derived views", () => {
    const data = buildChannelTrends({
      records: [],
      videos: [],
      libraryVideoCount: 0,
      windowCount: 0,
    })

    expect(data.stage).toBe("empty")
    expect(data.eventCount).toBe(0)
    expect(data.hooks).toBeNull()
    expect(data.dropOffs).toBeNull()
    expect(data.gains).toBeNull()
    expect(data.signature).toBeNull()
    expect(data.insights).toEqual([])
    expect(data.playbook).toEqual([])
    expect(data.recurrence).toBeNull()
    expect(data.subscribers).toBeNull()
    expect(data.packaging).toBeNull()
  })
})

describe("buildChannelPlaybook", () => {
  it("builds keep, fix and recover rules against hold coverage", () => {
    const records = [
      record({
        analysedVideoId: "h-1",
        windowKind: "hold",
        eventType: "visual_change",
        timestampSeconds: 65,
        primaryEvidence: "visual",
        windowDelta: -0.002,
        confidence: 0.9,
      }),
      record({
        analysedVideoId: "h-2",
        windowKind: "hold",
        eventType: "visual_change",
        timestampSeconds: 92,
        confidence: 0.8,
      }),
      record({
        analysedVideoId: "d-1",
        windowKind: "drop_off",
        eventType: "pacing_change",
        confidence: 0.9,
      }),
      record({
        analysedVideoId: "d-2",
        windowKind: "drop_off",
        eventType: "pacing_change",
        confidence: 0.8,
      }),
      record({
        analysedVideoId: "g-1",
        windowKind: "gain",
        eventType: "scene_cut",
        confidence: 0.85,
      }),
      record({
        analysedVideoId: "g-2",
        windowKind: "gain",
        eventType: "scene_cut",
        confidence: 0.75,
      }),
    ]
    const rules = buildChannelPlaybook(
      records,
      [video("h-1", "Hold receipt")],
      6,
      {
        hold: ["h-1", "h-2", "h-3"],
        drop_off: ["d-1", "d-2", "d-3"],
        gain: ["g-1", "g-2", "g-3"],
      },
    )

    expect(rules.map((rule) => [rule.kind, rule.eventType])).toEqual([
      ["keep", "visual_change"],
      ["fix", "pacing_change"],
      ["recover", "scene_cut"],
    ])
    expect(rules[0]).toMatchObject({
      evidenceVideoCount: 2,
      targetCoveredVideoCount: 3,
      controlVideoCount: 0,
      controlCoveredVideoCount: 3,
      targetRate: 2 / 3,
      controlRate: 0,
    })
    expect(rules[0].receipts[0]).toMatchObject({
      analysedVideoId: "h-1",
      videoTitle: "Hold receipt",
      timestampSeconds: 65,
      primaryEvidence: "visual",
      windowDelta: -0.002,
    })
  })

  it("withholds a channel-style pattern that is equally common in holds and drops", () => {
    const records = [
      record({ analysedVideoId: "h-1", windowKind: "hold", eventType: "scene_cut" }),
      record({ analysedVideoId: "h-2", windowKind: "hold", eventType: "scene_cut" }),
      record({ analysedVideoId: "d-1", windowKind: "drop_off", eventType: "scene_cut" }),
      record({ analysedVideoId: "d-2", windowKind: "drop_off", eventType: "scene_cut" }),
    ]

    expect(
      buildChannelPlaybook(records, [], 4, {
        hold: ["h-1", "h-2"],
        drop_off: ["d-1", "d-2"],
      }),
    ).toEqual([])
  })
})

describe("buildSubscriberConversion", () => {
  // Three ordinary converters around 1/1k and one video converting at 10× the
  // median with a healthy absolute count - the motivating "+30 vs +2" case.
  const magnetVideos = [
    video("v-1", "Ordinary one", null, { views: 2000, subscribersGained: 2 }),
    video("v-2", "Ordinary two", null, { views: 3000, subscribersGained: 3 }),
    video("v-3", "Ordinary three", null, { views: 1000, subscribersGained: 1 }),
    video("v-4", "The breakout", null, { views: 3000, subscribersGained: 30 }),
  ]

  it("computes per-1k rates against the median and flags the magnet", () => {
    const conversion = buildSubscriberConversion([], magnetVideos, 4)

    expect(conversion?.coveredVideoCount).toBe(4)
    expect(conversion?.medianRatePer1k).toBe(1)
    // Sorted best rate first.
    expect(conversion?.rows.map((row) => row.id)).toEqual([
      "v-4",
      "v-1",
      "v-2",
      "v-3",
    ])
    expect(conversion?.rows[0]).toMatchObject({
      ratePer1k: 10,
      subscribersGained: 30,
      outcome: "magnet",
    })
    expect(conversion?.magnetCount).toBe(1)
    expect(
      conversion?.rows.slice(1).every((row) => row.outcome === "typical"),
    ).toBe(true)
  })

  it("withholds the magnet flag below the absolute-count floor", () => {
    // 9 subs on 300 views is a 30/1k rate but too few people to conclude from.
    const conversion = buildSubscriberConversion(
      [],
      [
        video("v-1", null, null, { views: 2000, subscribersGained: 2 }),
        video("v-2", null, null, { views: 3000, subscribersGained: 3 }),
        video("v-3", null, null, { views: 300, subscribersGained: 9 }),
      ],
      3,
    )

    expect(conversion?.rows.every((row) => row.outcome === "typical")).toBe(true)
  })

  it("flags a leak only on a meaningful net loss", () => {
    const conversion = buildSubscriberConversion(
      [],
      [
        video("v-1", null, null, {
          views: 2000,
          subscribersGained: 2,
          subscribersLost: 9, // −7 net
        }),
        video("v-2", null, null, {
          views: 3000,
          subscribersGained: 3,
          subscribersLost: 5, // −2 net: everyday churn, not a verdict
        }),
        video("v-3", null, null, { views: 1000, subscribersGained: 1 }),
      ],
      3,
    )

    const byId = new Map(conversion?.rows.map((row) => [row.id, row]))
    expect(byId.get("v-1")).toMatchObject({ netGained: -7, outcome: "leak" })
    expect(byId.get("v-2")).toMatchObject({ netGained: -2, outcome: "typical" })
    expect(byId.get("v-3")).toMatchObject({ netGained: null, outcome: "typical" })
    expect(conversion?.leakCount).toBe(1)
  })

  it("needs three covered videos, ignoring rows without a snapshot", () => {
    expect(
      buildSubscriberConversion(
        [],
        [
          video("v-1", null, null, { views: 2000, subscribersGained: 2 }),
          video("v-2", null, null, { views: 3000, subscribersGained: 3 }),
          video("v-3"), // no analytics snapshot
        ],
        3,
      ),
    ).toBeNull()
  })

  it("surfaces gain/hook patterns present in every magnet but rare elsewhere", () => {
    const records: ChannelEventRecord[] = [
      // The magnet's gains lean on text overlays; one other video has them too.
      record({
        analysedVideoId: "v-4",
        windowKind: "gain",
        eventType: "on_screen_text_change",
        narrative: "A payoff overlay lands as retention climbs.",
        confidence: 0.9,
      }),
      record({
        analysedVideoId: "v-1",
        windowKind: "gain",
        eventType: "on_screen_text_change",
        confidence: 0.7,
      }),
      // Scene cuts appear in the magnet AND most others - style, not a lead.
      record({ analysedVideoId: "v-4", windowKind: "gain", eventType: "scene_cut" }),
      record({ analysedVideoId: "v-1", windowKind: "gain", eventType: "scene_cut" }),
      record({ analysedVideoId: "v-2", windowKind: "gain", eventType: "scene_cut" }),
      // A drop-off in the magnet never becomes a subscriber explanation.
      record({ analysedVideoId: "v-4", eventType: "pacing_change" }),
      // A hook pattern unique to the magnet.
      record({
        analysedVideoId: "v-4",
        windowKind: "hook",
        eventType: "topic_shift",
        narrative: "The opening promises the result up front.",
        confidence: 0.8,
      }),
    ]

    const conversion = buildSubscriberConversion(records, magnetVideos, 4)

    expect(
      conversion?.patterns.map((p) => [p.side, p.eventType]),
    ).toEqual([
      ["hook", "topic_shift"],
      ["gain", "on_screen_text_change"],
    ])
    const hook = conversion?.patterns[0]
    expect(hook).toMatchObject({
      magnetVideoCount: 1,
      otherVideoCount: 0,
      otherTotal: 3,
    })
    expect(hook?.events).toEqual([
      {
        narrative: "The opening promises the result up front.",
        videoTitle: "The breakout",
        confidence: 0.8,
      },
    ])
  })

  it("reports no patterns when nothing broke away from the median", () => {
    const conversion = buildSubscriberConversion(
      [
        record({
          analysedVideoId: "v-1",
          windowKind: "gain",
          eventType: "scene_cut",
        }),
      ],
      [
        video("v-1", null, null, { views: 2000, subscribersGained: 2 }),
        video("v-2", null, null, { views: 3000, subscribersGained: 3 }),
        video("v-3", null, null, { views: 1000, subscribersGained: 1 }),
      ],
      3,
    )

    expect(conversion?.magnetCount).toBe(0)
    expect(conversion?.patterns).toEqual([])
  })
})

describe("buildChannelSignature", () => {
  it("computes confidence-weighted shares per side", () => {
    const signature = buildChannelSignature([
      record({ analysedVideoId: "av-1", eventType: "pacing_change", confidence: 0.8 }),
      record({ analysedVideoId: "av-2", eventType: "pacing_change", confidence: 0.8 }),
      record({ analysedVideoId: "av-2", eventType: "scene_cut", confidence: 0.4 }),
      record({
        analysedVideoId: "av-3",
        windowKind: "gain",
        eventType: "scene_cut",
        confidence: 0.8,
      }),
    ])

    const pacing = signature?.find((row) => row.eventType === "pacing_change")
    const scene = signature?.find((row) => row.eventType === "scene_cut")
    expect(pacing?.dropShare).toBeCloseTo(0.8)
    expect(pacing?.gainShare).toBe(0)
    expect(scene?.dropShare).toBeCloseTo(0.2)
    expect(scene?.gainShare).toBeCloseTo(1)
    expect(scene?.videoCount).toBe(2)
    // Hook events never enter the signature; drop-heaviest rows sort first.
    expect(signature?.map((row) => row.eventType)).toEqual([
      "pacing_change",
      "scene_cut",
    ])
  })

  it("withholds verdicts below the video floor, then calls lopsided rows", () => {
    const records: ChannelEventRecord[] = [
      // Pacing: drops only, 3 videos → hurting.
      record({ analysedVideoId: "av-1", eventType: "pacing_change" }),
      record({ analysedVideoId: "av-2", eventType: "pacing_change" }),
      record({ analysedVideoId: "av-3", eventType: "pacing_change" }),
      // Scene cuts: balanced across 3 videos → style.
      record({ analysedVideoId: "av-1", eventType: "scene_cut" }),
      record({
        analysedVideoId: "av-2",
        windowKind: "gain",
        eventType: "scene_cut",
      }),
      record({
        analysedVideoId: "av-3",
        windowKind: "gain",
        eventType: "scene_cut",
      }),
      record({ analysedVideoId: "av-3", eventType: "scene_cut" }),
      // Text: gains only, 3 videos → working.
      record({
        analysedVideoId: "av-1",
        windowKind: "gain",
        eventType: "on_screen_text_change",
      }),
      record({
        analysedVideoId: "av-2",
        windowKind: "gain",
        eventType: "on_screen_text_change",
      }),
      record({
        analysedVideoId: "av-3",
        windowKind: "gain",
        eventType: "on_screen_text_change",
      }),
      // Audio: one video → too little history for any verdict.
      record({ analysedVideoId: "av-1", eventType: "audio_change" }),
    ]

    const byType = new Map(
      buildChannelSignature(records)?.map((row) => [row.eventType, row.verdict]),
    )
    expect(byType.get("pacing_change")).toBe("hurting")
    expect(byType.get("scene_cut")).toBe("style")
    expect(byType.get("on_screen_text_change")).toBe("working")
    expect(byType.get("audio_change")).toBe("insufficient")
  })

  it("returns null when no drop or gain events exist", () => {
    expect(buildChannelSignature([])).toBeNull()
    expect(
      buildChannelSignature([record({ windowKind: "hook" })]),
    ).toBeNull()
  })
})

describe("buildChannelInsights", () => {
  const fixAndStrengthRecords: ChannelEventRecord[] = [
    record({ analysedVideoId: "av-1", eventType: "pacing_change", confidence: 0.8 }),
    record({ analysedVideoId: "av-2", eventType: "pacing_change", confidence: 0.8 }),
    record({ analysedVideoId: "av-3", eventType: "pacing_change", confidence: 0.8 }),
    record({
      analysedVideoId: "av-1",
      windowKind: "gain",
      eventType: "on_screen_text_change",
      confidence: 0.8,
    }),
    record({
      analysedVideoId: "av-2",
      windowKind: "gain",
      eventType: "on_screen_text_change",
      confidence: 0.8,
    }),
    record({
      analysedVideoId: "av-4",
      windowKind: "gain",
      eventType: "on_screen_text_change",
      confidence: 0.8,
    }),
  ]

  it("promotes the strongest lopsided pattern per side", () => {
    const signature = buildChannelSignature(fixAndStrengthRecords)
    const insights = buildChannelInsights(fixAndStrengthRecords, signature, 4)

    expect(insights.map((insight) => insight.kind)).toEqual([
      "fix",
      "strength",
    ])
    const fix = insights[0]
    expect(fix.eventType).toBe("pacing_change")
    expect(fix.videoCount).toBe(3)
    expect(fix.eventCount).toBe(3)
    expect(fix.meanConfidence).toBeCloseTo(0.8)
    expect(fix.contrast).toBe(1)
    // 100 × √(3/4) × 0.8 × 1
    expect(fix.signal).toBe(69)
    expect(insights[1].eventType).toBe("on_screen_text_change")
  })

  it("withholds insights that miss the video, confidence or contrast gates", () => {
    // Two videos: broad enough for a trend row, not for a written verdict.
    const tooFewVideos = fixAndStrengthRecords.filter(
      (r) => r.analysedVideoId !== "av-3" && r.analysedVideoId !== "av-4",
    )
    expect(
      buildChannelInsights(
        tooFewVideos,
        buildChannelSignature(tooFewVideos),
        4,
      ),
    ).toEqual([])

    // Confidently detected but evenly split between drops and gains: style,
    // not an insight.
    const balanced: ChannelEventRecord[] = [
      record({ analysedVideoId: "av-1", eventType: "scene_cut", confidence: 0.9 }),
      record({ analysedVideoId: "av-2", eventType: "scene_cut", confidence: 0.9 }),
      record({ analysedVideoId: "av-3", eventType: "scene_cut", confidence: 0.9 }),
      record({
        analysedVideoId: "av-1",
        windowKind: "gain",
        eventType: "scene_cut",
        confidence: 0.9,
      }),
      record({
        analysedVideoId: "av-2",
        windowKind: "gain",
        eventType: "scene_cut",
        confidence: 0.9,
      }),
      record({
        analysedVideoId: "av-3",
        windowKind: "gain",
        eventType: "scene_cut",
        confidence: 0.9,
      }),
    ]
    expect(
      buildChannelInsights(balanced, buildChannelSignature(balanced), 4),
    ).toEqual([])

    // Recurring but the synthesizer itself wasn't sure.
    const lowConfidence = fixAndStrengthRecords.map((r) => ({
      ...r,
      confidence: 0.4,
    }))
    expect(
      buildChannelInsights(
        lowConfidence,
        buildChannelSignature(lowConfidence),
        4,
      ),
    ).toEqual([])
  })

  it("promotes a hook pattern without a contrast term", () => {
    const records: ChannelEventRecord[] = [
      record({
        analysedVideoId: "av-1",
        windowKind: "hook",
        eventType: "topic_shift",
        confidence: 0.7,
      }),
      record({
        analysedVideoId: "av-2",
        windowKind: "hook",
        eventType: "topic_shift",
        confidence: 0.7,
      }),
      record({
        analysedVideoId: "av-3",
        windowKind: "hook",
        eventType: "topic_shift",
        confidence: 0.7,
      }),
    ]
    const insights = buildChannelInsights(records, null, 4)

    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({
      kind: "hook",
      eventType: "topic_shift",
      videoCount: 3,
      contrast: null,
    })
    // 100 × √(3/4) × 0.7
    expect(insights[0].signal).toBe(61)
  })
})

describe("buildChannelRecurrence", () => {
  const videos = [
    video("v-3", "Third", "2026-01-03"),
    video("v-1", "First", "2026-01-01"),
    video("v-4", "Fourth", "2026-01-04"),
    video("v-2", "Second", "2026-01-02"),
  ]
  const records: ChannelEventRecord[] = [
    record({ analysedVideoId: "v-1", eventType: "pacing_change", confidence: 0.9 }),
    record({ analysedVideoId: "v-1", eventType: "pacing_change", confidence: 0.6 }),
    record({ analysedVideoId: "v-3", eventType: "pacing_change", confidence: 0.7 }),
    record({ analysedVideoId: "v-4", eventType: "pacing_change", confidence: 0.8 }),
    record({
      analysedVideoId: "v-2",
      windowKind: "gain",
      eventType: "on_screen_text_change",
      confidence: 0.8,
    }),
    record({
      analysedVideoId: "v-4",
      windowKind: "gain",
      eventType: "on_screen_text_change",
      confidence: null,
    }),
  ]

  it("lays each recurring pattern across the videos chronologically", () => {
    const recurrence = buildChannelRecurrence(
      records,
      videos,
      buildChannelSignature(records),
    )

    expect(recurrence?.videos.map((v) => v.id)).toEqual([
      "v-1",
      "v-2",
      "v-3",
      "v-4",
    ])
    expect(recurrence?.rows.map((row) => [row.eventType, row.side])).toEqual([
      ["pacing_change", "drop_off"],
      ["on_screen_text_change", "gain"],
    ])

    const pacing = recurrence?.rows[0]
    expect(pacing?.cells.map((cell) => cell.hit)).toEqual([
      true,
      false,
      true,
      true,
    ])
    // Two hits in v-1: the cell carries the highest confidence among them.
    expect(pacing?.cells[0].maxConfidence).toBe(0.9)
    expect(pacing?.hitCount).toBe(3)
    expect(pacing?.currentStreak).toBe(2)
    expect(pacing?.videosSinceLastHit).toBe(0)

    const text = recurrence?.rows[1]
    expect(text?.cells.map((cell) => cell.hit)).toEqual([
      false,
      true,
      false,
      true,
    ])
    // A hit whose only events predate the confidence column stays unranked.
    expect(text?.cells[3].maxConfidence).toBeNull()
  })

  it("keeps only the most recent ten videos", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      video(`v-${i}`, null, `2026-02-${String(i + 1).padStart(2, "0")}`),
    )
    const recurrence = buildChannelRecurrence(
      records.map((r) => ({ ...r, analysedVideoId: "v-11" })),
      many,
      buildChannelSignature(records),
    )

    expect(recurrence?.videos).toHaveLength(10)
    expect(recurrence?.videos[0].id).toBe("v-2")
    expect(recurrence?.videos[9].id).toBe("v-11")
  })

  it("needs a signature and at least two videos", () => {
    expect(buildChannelRecurrence(records, videos, null)).toBeNull()
    expect(
      buildChannelRecurrence(
        records,
        [video("v-1")],
        buildChannelSignature(records),
      ),
    ).toBeNull()
  })
})

function taxonomy(overrides: Partial<PackagingTaxonomy> = {}): PackagingTaxonomy {
  return {
    titleStyles: ["direct_label"],
    thumbnailHasFace: false,
    thumbnailEmotion: null,
    thumbnailTextWordCount: 0,
    promiseType: "other",
    hookDelivery: "delayed",
    alignmentScore: 0.6,
    topics: ["general"],
    model: "test-model",
    generatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  }
}

describe("packagingFeatures", () => {
  it("flattens a taxonomy into countable trait flags", () => {
    expect(
      packagingFeatures(
        taxonomy({
          titleStyles: ["curiosity_gap", "result_claim"],
          thumbnailHasFace: true,
          thumbnailEmotion: "excited",
          thumbnailTextWordCount: 5,
          promiseType: "transformation",
          hookDelivery: "direct",
          alignmentScore: 0.9,
        }),
      ),
    ).toEqual([
      "title:curiosity_gap",
      "title:result_claim",
      "thumb:face",
      "thumb:text_heavy",
      "promise:transformation",
      "hook:direct",
      "alignment:tight",
    ])
  })

  it("bands thumbnail text and only flags pronounced alignment", () => {
    expect(packagingFeatures(taxonomy())).toEqual([
      "title:direct_label",
      "thumb:no_face",
      "thumb:text_free",
      "promise:other",
      "hook:delayed",
      // 0.6 sits between loose (<0.5) and tight (>=0.75): no flag.
    ])
    expect(
      packagingFeatures(taxonomy({ thumbnailTextWordCount: 2, alignmentScore: 0.3 })),
    ).toContain("thumb:text_light")
    expect(
      packagingFeatures(taxonomy({ alignmentScore: 0.3 })),
    ).toContain("alignment:loose")
  })
})

describe("buildPackagingPatterns", () => {
  // All published the same day with a snapshot ten days later, so views/day
  // is just views/10: 100, 50, 20, 10 - high band {r-1, r-2}, low {r-3, r-4}.
  const reachExtras = {
    publishedAt: "2026-01-01T00:00:00Z",
    analyticsFetchedAt: "2026-01-11T00:00:00Z",
  }
  const reachVideos = [
    video("r-1", "Breakout", null, {
      ...reachExtras,
      views: 1000,
      packaging: taxonomy({
        titleStyles: ["curiosity_gap"],
        thumbnailHasFace: true,
        thumbnailEmotion: "excited",
        topics: ["gear reviews"],
      }),
    }),
    video("r-2", "Solid", null, {
      ...reachExtras,
      views: 500,
      packaging: taxonomy({
        titleStyles: ["curiosity_gap"],
        thumbnailHasFace: true,
        thumbnailEmotion: "happy",
        topics: ["gear reviews"],
      }),
    }),
    video("r-3", "Quiet", null, {
      ...reachExtras,
      views: 200,
      packaging: taxonomy({ topics: ["vlogs"] }),
    }),
    video("r-4", "Quietest", null, {
      ...reachExtras,
      views: 100,
      packaging: taxonomy({ topics: ["vlogs", "one-off"] }),
    }),
  ]

  it("computes views/day, bands the halves and finds the feature contrast", () => {
    const patterns = buildPackagingPatterns(reachVideos, 4)

    expect(patterns?.videos.map((v) => [v.id, v.band])).toEqual([
      ["r-1", "high"],
      ["r-2", "high"],
      ["r-3", "low"],
      ["r-4", "low"],
    ])
    expect(patterns?.videos[0]).toMatchObject({
      views: 1000,
      ageDays: 10,
      viewsPerDay: 100,
      hasTaxonomy: true,
    })
    expect(patterns?.medianViewsPerDay).toBe(35)

    // Both high-band videos share a curiosity-gap title and a face; both
    // low-band videos have neither. Shared traits (promise, hook, text-free
    // thumbnail) never qualify.
    expect(patterns?.features.map((f) => f.feature)).toEqual([
      "thumb:face",
      "title:curiosity_gap",
    ])
    expect(patterns?.features[0]).toMatchObject({
      highCount: 2,
      highTotal: 2,
      lowCount: 0,
      lowTotal: 2,
    })
  })

  it("calls out topics that over- and under-perform the typical reach", () => {
    const patterns = buildPackagingPatterns(reachVideos, 4)

    // gear reviews: median 75/day vs channel 35 → ~2.1×; vlogs: 15 → ~0.43×.
    // "one-off" has a single video and never qualifies.
    expect(patterns?.topics.map((t) => t.topic)).toEqual([
      "gear reviews",
      "vlogs",
    ])
    expect(patterns?.topics[0].ratio).toBeCloseTo(75 / 35)
    expect(patterns?.topics[1].videoCount).toBe(2)
  })

  it("leaves the middle video of an odd split out of both bands", () => {
    const withMiddle = [
      ...reachVideos,
      video("r-5", "Median", null, { ...reachExtras, views: 300 }),
    ]
    const patterns = buildPackagingPatterns(withMiddle, 5)

    const bands = new Map(patterns?.videos.map((v) => [v.id, v.band]))
    expect(bands.get("r-5")).toBe("middle")
    expect(bands.get("r-2")).toBe("high")
    expect(bands.get("r-3")).toBe("low")
  })

  it("withholds features when a band lacks taxonomy coverage", () => {
    const sparse = reachVideos.map((v, index) =>
      index === 2 || index === 3 ? { ...v, packaging: null } : v,
    )
    const patterns = buildPackagingPatterns(sparse, 4)

    expect(patterns?.features).toEqual([])
    expect(patterns?.taxonomyVideoCount).toBe(2)
  })

  it("needs four videos with views, a publish date and a snapshot date", () => {
    expect(
      buildPackagingPatterns(
        [
          ...reachVideos.slice(0, 3),
          // No publish date: excluded from coverage.
          video("r-4", null, null, {
            views: 100,
            analyticsFetchedAt: "2026-01-11T00:00:00Z",
          }),
        ],
        4,
      ),
    ).toBeNull()
  })
})

describe("buildChannelSnapshot", () => {
  const snapshotVideos = [
    video("s-1", null, null, {
      views: 1000,
      publishedAt: "2026-01-01T00:00:00Z",
      analyticsFetchedAt: "2026-01-11T00:00:00Z",
      averageViewPercentage: 50,
      subscribersGained: 10,
      impressionClickThroughRate: 0.05,
    }),
    video("s-2", null, null, {
      views: 400,
      publishedAt: "2026-01-01T00:00:00Z",
      analyticsFetchedAt: "2026-01-11T00:00:00Z",
      averageViewPercentage: 40,
      subscribersGained: 4,
      impressionClickThroughRate: 0.03,
    }),
    video("s-3", null, null, {
      views: 200,
      publishedAt: "2026-01-01T00:00:00Z",
      analyticsFetchedAt: "2026-01-11T00:00:00Z",
      averageViewPercentage: 30,
      subscribersGained: 2,
      impressionClickThroughRate: 0.01,
    }),
  ]

  it("reports a median for every metric enough videos carry", () => {
    const snapshot = buildChannelSnapshot(snapshotVideos, 5)

    expect(snapshot.libraryVideoCount).toBe(5)
    expect(snapshot.medianViewsPerVideo).toBe(400)
    expect(snapshot.medianRetentionPercent).toBe(40)
    expect(snapshot.medianSubsPerVideo).toBe(4)
    expect(snapshot.medianClickThroughRate).toBe(0.03)
  })

  it("leaves a metric null rather than speaking for one or two videos", () => {
    const snapshot = buildChannelSnapshot(
      [snapshotVideos[0], video("s-4"), video("s-5")],
      3,
    )

    expect(snapshot.medianViewsPerVideo).toBeNull()
    expect(snapshot.medianRetentionPercent).toBeNull()
    expect(snapshot.medianSubsPerVideo).toBeNull()
    expect(snapshot.medianClickThroughRate).toBeNull()
    expect(snapshot.medianBrowseSuggestedShare).toBeNull()
  })
})

describe("videoReachPerDay", () => {
  it("divides views by the days between publish and the snapshot", () => {
    expect(
      videoReachPerDay(
        video("v-1", null, null, {
          views: 900,
          publishedAt: "2026-01-01T00:00:00Z",
          analyticsFetchedAt: "2026-01-10T00:00:00Z",
        }),
      ),
    ).toBe(100)
  })

  it("floors the age at a day so an upload analysed on day zero still ranks", () => {
    expect(
      videoReachPerDay(
        video("v-2", null, null, {
          views: 50,
          publishedAt: "2026-01-01T00:00:00Z",
          analyticsFetchedAt: "2026-01-01T04:00:00Z",
        }),
      ),
    ).toBe(50)
  })

  it("returns null when either end of the measurement is missing", () => {
    expect(
      videoReachPerDay(video("v-3", null, null, { views: 900 })),
    ).toBeNull()
    expect(
      videoReachPerDay(
        video("v-4", null, null, {
          publishedAt: "2026-01-01T00:00:00Z",
          analyticsFetchedAt: "2026-01-10T00:00:00Z",
        }),
      ),
    ).toBeNull()
  })
})

describe("videoViews", () => {
  it("reads the stored lifetime views, no dates required", () => {
    expect(videoViews(video("v-1", null, null, { views: 12_345 }))).toBe(12_345)
  })

  it("returns null when nothing was stored, so the upload is left unranked", () => {
    expect(videoViews(video("v-2"))).toBeNull()
    expect(videoViews(video("v-3", null, null, { views: 0 }))).toBeNull()
  })
})

// A packaging read has to carry a detail block before any axis can be scored
// off it, and every axis reads its own surface, so the fixture is the whole
// shape rather than the one field a test looks at.
function packagingDetail(titleSpecificity: number): PackagingDetail {
  return {
    title: {
      specificity: titleSpecificity,
      curiosityGap: 5,
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
      faceProminence: 5,
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
      archetype: "tutorial",
      trendRelevance: 2,
      trendRelevanceConfidence: 2,
    },
  }
}

describe("buildChannelTrends packaging extremes", () => {
  // Three old uploads carrying most of the channel's views, and three fresh
  // ones with almost none. On views per day the two ends interleave, which is
  // exactly what makes this a test: the bands may only come out split by total
  // views.
  const SNAPSHOT = "2026-08-01T00:00:00Z"
  const rankedVideos = () => [
    { id: "old-a", views: 100_000, publishedAt: "2020-01-01T00:00:00Z" },
    { id: "old-b", views: 90_000, publishedAt: "2020-01-01T00:00:00Z" },
    { id: "old-c", views: 80_000, publishedAt: "2020-01-01T00:00:00Z" },
    { id: "new-d", views: 40, publishedAt: "2026-07-31T00:00:00Z" },
    { id: "new-e", views: 30, publishedAt: "2026-07-31T00:00:00Z" },
    { id: "new-f", views: 20, publishedAt: "2026-07-31T00:00:00Z" },
  ].map((entry) =>
    video(entry.id, entry.id, null, {
      views: entry.views,
      publishedAt: entry.publishedAt,
      analyticsFetchedAt: SNAPSHOT,
      packaging: taxonomy({ detail: packagingDetail(5) }),
    }),
  )

  it("ranks the two named bands on total views, not views per day", () => {
    const data = buildChannelTrends({
      records: [],
      videos: rankedVideos(),
      libraryVideoCount: 6,
      windowCount: 0,
    })

    const extremes = data.packagingExtremes
    expect(extremes).not.toBeNull()
    expect(extremes!.top.map((entry) => entry.id)).toEqual([
      "old-a",
      "old-b",
      "old-c",
    ])
    expect(extremes!.bottom.map((entry) => entry.id)).toEqual([
      "new-d",
      "new-e",
      "new-f",
    ])
    // The figure the band lists print is the view count itself.
    expect(extremes!.top.map((entry) => entry.outcome)).toEqual([
      100_000, 90_000, 80_000,
    ])
    // The fresh uploads out-reach two of the old ones per day, so a rate
    // ranking would have split these bands differently.
    expect(videoReachPerDay(rankedVideos()[3])).toBeGreaterThan(
      videoReachPerDay(rankedVideos()[1])!,
    )
  })
})
