import { describe, expect, it } from "vitest"

import type { ChannelEventRecord } from "@/lib/channel-event-history"
import { buildChannelTrends, channelTrendsStage } from "@/lib/channel-trends"

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
      videoTitleById: new Map([
        ["av-1", "How I edit"],
        ["av-2", "My studio tour"],
        ["av-3", "Gear review"],
      ]),
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
      videoTitles: ["How I edit", "My studio tour"],
    })
    expect(data.gains?.trends).toEqual([
      {
        eventType: "scene_cut",
        eventCount: 1,
        videoCount: 1,
        videoTitles: ["Gear review"],
        examples: [
          {
            narrative: "A burst of quick cuts holds attention.",
            videoTitle: "Gear review",
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
      videoTitleById: new Map(),
      libraryVideoCount: 2,
      windowCount: 4,
    })

    expect(data.dropOffs?.trends.map((trend) => trend.eventType)).toEqual([
      "audio_change",
      "topic_shift",
    ])
  })

  it("caps examples at the highest-confidence narratives and caps listed titles", () => {
    const data = buildChannelTrends({
      records: [
        record({ analysedVideoId: "av-1", narrative: "n-0.5", confidence: 0.5 }),
        record({ analysedVideoId: "av-2", narrative: "n-0.9", confidence: 0.9 }),
        record({ analysedVideoId: "av-3", narrative: "n-null", confidence: null }),
        record({ analysedVideoId: "av-4", narrative: "n-0.8", confidence: 0.8 }),
      ],
      videoTitleById: new Map([
        ["av-1", "One"],
        ["av-2", "Two"],
        ["av-3", "Three"],
        ["av-4", "Four"],
      ]),
      libraryVideoCount: 4,
      windowCount: 4,
    })

    const trend = data.dropOffs?.trends[0]
    expect(trend?.videoCount).toBe(4)
    expect(trend?.videoTitles).toHaveLength(3)
    expect(trend?.examples.map((example) => example.narrative)).toEqual([
      "n-0.9",
      "n-0.8",
    ])
  })

  it("reports an empty library without trends", () => {
    const data = buildChannelTrends({
      records: [],
      videoTitleById: new Map(),
      libraryVideoCount: 0,
      windowCount: 0,
    })

    expect(data.stage).toBe("empty")
    expect(data.eventCount).toBe(0)
    expect(data.hooks).toBeNull()
    expect(data.dropOffs).toBeNull()
    expect(data.gains).toBeNull()
  })
})
