import { describe, expect, it } from "vitest"

import type { ChannelEventRecord } from "@/lib/channel-event-history"
import {
  buildChannelInsights,
  buildChannelRecurrence,
  buildChannelSignature,
  buildChannelTrends,
  channelTrendsStage,
  type ChannelVideo,
} from "@/lib/channel-trends"

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
): ChannelVideo {
  return { id, title, dateAnalysed }
}

describe("channelTrendsStage", () => {
  it("maps library size onto the progressive unlock stages", () => {
    expect(channelTrendsStage(0)).toBe("empty")
    expect(channelTrendsStage(1)).toBe("building")
    expect(channelTrendsStage(2)).toBe("building")
    expect(channelTrendsStage(3)).toBe("early")
    expect(channelTrendsStage(9)).toBe("early")
    expect(channelTrendsStage(10)).toBe("established")
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
    expect(data.recurrence).toBeNull()
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
