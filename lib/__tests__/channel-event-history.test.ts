import { describe, expect, it } from "vitest"

import {
  summarizeChannelEvents,
  type ChannelEventRecord,
} from "@/lib/channel-event-history"

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

describe("summarizeChannelEvents", () => {
  it("returns null with no history", () => {
    expect(summarizeChannelEvents([])).toBeNull()
  })

  it("returns null when only one other video has events - anecdote, not a trend", () => {
    expect(
      summarizeChannelEvents([
        record({ analysedVideoId: "av-1" }),
        record({ analysedVideoId: "av-1", eventType: "scene_cut" }),
      ]),
    ).toBeNull()
  })

  it("counts events and distinct videos per event type within each window kind", () => {
    const summary = summarizeChannelEvents([
      record({ analysedVideoId: "av-1", eventType: "pacing_change" }),
      record({ analysedVideoId: "av-2", eventType: "pacing_change" }),
      record({ analysedVideoId: "av-2", eventType: "pacing_change" }),
      record({ analysedVideoId: "av-2", eventType: "scene_cut" }),
    ])

    expect(summary?.videoCount).toBe(2)
    expect(summary?.dropOffs?.eventCount).toBe(4)
    expect(summary?.dropOffs?.trends).toEqual([
      { eventType: "pacing_change", eventCount: 3, videoCount: 2 },
      { eventType: "scene_cut", eventCount: 1, videoCount: 1 },
    ])
  })

  it("orders trends by distinct-video recurrence before raw event volume", () => {
    const summary = summarizeChannelEvents([
      // topic_shift: 3 events but all in one video.
      record({ analysedVideoId: "av-1", eventType: "topic_shift" }),
      record({ analysedVideoId: "av-1", eventType: "topic_shift" }),
      record({ analysedVideoId: "av-1", eventType: "topic_shift" }),
      // audio_change: fewer events, but spread across both videos.
      record({ analysedVideoId: "av-1", eventType: "audio_change" }),
      record({ analysedVideoId: "av-2", eventType: "audio_change" }),
    ])

    expect(summary?.dropOffs?.trends.map((trend) => trend.eventType)).toEqual([
      "audio_change",
      "topic_shift",
    ])
  })

  it("leaves window kinds with no history null and splits kinds into their own buckets", () => {
    const summary = summarizeChannelEvents([
      record({ analysedVideoId: "av-1", windowKind: "gain" }),
      record({ analysedVideoId: "av-2", windowKind: "gain" }),
    ])

    expect(summary?.hooks).toBeNull()
    expect(summary?.dropOffs).toBeNull()
    expect(summary?.gains?.eventCount).toBe(2)
    expect(summary?.holds).toBeNull()
  })

  it("summarizes audience holds separately from replay gains", () => {
    const summary = summarizeChannelEvents([
      record({ analysedVideoId: "av-1", windowKind: "hold" }),
      record({ analysedVideoId: "av-2", windowKind: "hold" }),
      record({ analysedVideoId: "av-2", windowKind: "gain" }),
    ])

    expect(summary?.holds?.eventCount).toBe(2)
    expect(summary?.holds?.trends[0]).toEqual({
      eventType: "pacing_change",
      eventCount: 2,
      videoCount: 2,
    })
    expect(summary?.gains?.eventCount).toBe(1)
  })

  it("keeps only the highest-confidence narratives as examples, treating null confidence as lowest", () => {
    const summary = summarizeChannelEvents([
      record({ analysedVideoId: "av-1", narrative: "n-0.6", confidence: 0.6 }),
      record({ analysedVideoId: "av-1", narrative: "n-null", confidence: null }),
      record({ analysedVideoId: "av-2", narrative: "n-0.9", confidence: 0.9 }),
      record({ analysedVideoId: "av-2", narrative: "n-0.8", confidence: 0.8 }),
      record({ analysedVideoId: "av-2", narrative: "n-0.7", confidence: 0.7 }),
    ])

    expect(summary?.dropOffs?.exampleNarratives).toEqual([
      "n-0.9",
      "n-0.8",
      "n-0.7",
    ])
  })
})
