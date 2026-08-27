import { describe, expect, it } from "vitest"

import {
  buildDemoVideo,
  DEMO_VIDEO_ID_PREFIX,
  isDemoVideoId,
  type DemoVideoPayload,
} from "@/lib/admin/demo-data/build"
import { DEMO_VIDEO_CONCEPTS } from "@/lib/admin/demo-data/content"
import { DEFAULT_DEMO_VIDEO_COUNT } from "@/lib/admin/demo-data/seed"
import { toDeliveryRead } from "@/lib/channel-delivery"
import type { ChannelEventRecord } from "@/lib/channel-event-history"
import { buildChannelTrends } from "@/lib/channel-trends"

// The demo library exists so that every page in the product has something on
// it. That only holds if the synthesized curves survive the REAL detectors:
// buildDemoVideo hands its curve to buildRetentionWindows, and the trends page
// then aggregates over whatever that produced. A curve that quietly stops
// producing drop-offs, or an event vocabulary that stops being lopsided enough
// for the playbook, turns the seeded library into a tour of empty states
// without anything failing. These tests are the tripwire for that.

const NOW = new Date("2026-08-27T12:00:00Z")
const SEED_KEY = "11111111-2222-3333-4444-555555555555"

function buildLibrary(count = DEFAULT_DEMO_VIDEO_COUNT): DemoVideoPayload[] {
  return DEMO_VIDEO_CONCEPTS.slice(0, count).map((concept, index) =>
    buildDemoVideo({
      concept,
      index,
      total: count,
      seedKey: SEED_KEY,
      now: NOW,
      // Mirrors the seeder: the most recent uploads are the deep-analysed ones.
      deepAnalysed: index >= count - Math.round(count * 0.7),
    }),
  )
}

// The same join the trends loader makes, so the aggregation under test reads
// the records it would read against a seeded database.
function toEventRecords(payloads: DemoVideoPayload[]): ChannelEventRecord[] {
  return payloads.flatMap((payload) =>
    payload.windowEvents.flatMap((group) => {
      const window = payload.windows.find(
        (candidate) =>
          candidate.kind === group.kind &&
          candidate.windowIndex === group.windowIndex,
      )
      if (!window) return []
      return group.events.map((event) => ({
        analysedVideoId: payload.videoId,
        windowKind: group.kind,
        eventType: event.eventType,
        narrative: event.narrative,
        confidence: event.confidence,
        timestampSeconds: event.timestampSeconds,
        primaryEvidence: event.primaryEvidence,
        windowDelta: window.delta,
        windowFromSeconds: window.fromSeconds,
        windowToSeconds: window.toSeconds,
        relativePerformance: window.relativePerformance,
      }))
    }),
  )
}

function trendsFor(payloads: DemoVideoPayload[]) {
  const deep = payloads.filter((payload) => payload.deepAnalysed)
  const idsWithKind = (kind: string) =>
    deep
      .filter((payload) =>
        payload.windows.some((window) => window.kind === kind),
      )
      .map((payload) => payload.videoId)

  return buildChannelTrends({
    records: toEventRecords(payloads),
    videos: payloads.map((payload) => ({
      id: payload.videoId,
      title: payload.title,
      dateAnalysed: payload.dateAnalysed,
      views: payload.analyticsSummary.views,
      subscribersGained: payload.analyticsSummary.subscribersGained,
      subscribersLost: payload.analyticsSummary.subscribersLost,
      publishedAt: payload.publishedAt,
      analyticsFetchedAt: payload.analyticsSummary.fetchedAt,
      browseSuggestedShare: 0.42,
      averageViewPercentage: payload.analyticsSummary.averageViewPercentage,
      impressionClickThroughRate:
        payload.analyticsSummary.impressionClickThroughRate,
      packaging: payload.packagingAlignment.taxonomy ?? null,
      script: payload.scriptTaxonomy,
      retention: payload.retention,
      durationSeconds: payload.videoDetails.durationSeconds,
    })),
    libraryVideoCount: deep.length,
    windowCount: deep.reduce((total, payload) => total + payload.windows.length, 0),
    kindVideoIds: {
      hook: idsWithKind("hook"),
      drop_off: idsWithKind("drop_off"),
      gain: idsWithKind("gain"),
      hold: idsWithKind("hold"),
    },
  })
}

describe("demo video ids", () => {
  it("marks every generated id so the cleanup path can find it", () => {
    for (const payload of buildLibrary()) {
      expect(payload.videoId.startsWith(DEMO_VIDEO_ID_PREFIX)).toBe(true)
      expect(isDemoVideoId(payload.videoId)).toBe(true)
      // A YouTube id is 11 characters and several surfaces build a URL out of
      // one, so demo ids keep that width.
      expect(payload.videoId).toHaveLength(11)
    }
  })

  it("does not treat a real YouTube id as a demo one", () => {
    expect(isDemoVideoId("nEn4MS-yTbY")).toBe(false)
  })

  it("is deterministic for the same account", () => {
    const first = buildLibrary()
    const second = buildLibrary()
    expect(second.map((payload) => payload.retention)).toEqual(
      first.map((payload) => payload.retention),
    )
    expect(second.map((payload) => payload.analyticsSummary.views)).toEqual(
      first.map((payload) => payload.analyticsSummary.views),
    )
  })
})

describe("demo retention curves", () => {
  const payloads = buildLibrary()

  it("stays inside a plausible band and never bottoms out", () => {
    for (const payload of payloads) {
      const ratios = payload.retention.map((point) => point.watchRatio)
      expect(payload.retention[0].watchRatio).toBe(1)
      expect(Math.min(...ratios)).toBeGreaterThan(0.1)
      expect(Math.max(...ratios)).toBeLessThanOrEqual(1)
    }
  })

  it("produces the fixed hook windows and real drop-offs on every video", () => {
    for (const payload of payloads) {
      const kinds = payload.windows.map((window) => window.kind)
      expect(kinds.filter((kind) => kind === "hook")).toHaveLength(2)
      expect(kinds).toContain("drop_off")
      expect(kinds).toContain("hold")
    }
  })

  it("produces gains and holds across the library", () => {
    const kinds = new Set(
      payloads.flatMap((payload) =>
        payload.windows.map((window) => window.kind),
      ),
    )
    expect([...kinds].sort()).toEqual(["drop_off", "gain", "hold", "hook"])
  })

  it("spreads reach and retention rather than repeating one video", () => {
    const views = payloads.map((payload) => payload.analyticsSummary.views ?? 0)
    expect(new Set(views).size).toBe(views.length)
    expect(Math.max(...views) / Math.max(1, Math.min(...views))).toBeGreaterThan(2)
  })
})

describe("channel trends over a demo library", () => {
  const trends = trendsFor(buildLibrary())

  it("reaches the established stage", () => {
    expect(trends.stage).toBe("established")
  })

  it("fills every section the page renders", () => {
    expect(trends.eventCount).toBeGreaterThan(0)
    expect(trends.signature).not.toBeNull()
    expect(trends.signature!.length).toBeGreaterThan(0)
    expect(trends.insights.length).toBeGreaterThan(0)
    // One rule per creator job: what to keep, what to fix, what to recover.
    expect(trends.playbook.length).toBe(3)
    expect(trends.recurrence).not.toBeNull()
    expect(trends.subscribers).not.toBeNull()
    expect(trends.packaging).not.toBeNull()
    expect(trends.snapshot).not.toBeNull()
    expect(trends.averageCurve).not.toBeNull()
    expect(trends.packagingAxes).not.toBeNull()
    expect(trends.scriptAxes).not.toBeNull()
    expect(trends.packagingStyle).not.toBeNull()
    expect(trends.scriptStyle).not.toBeNull()
  })

  it("gives the measured delivery read figures on every axis", () => {
    // The delivery read is measured off a source file, so only the
    // deep-analysed half of the library carries one. Every axis needs a figure
    // or a reader of the baseline gets a partial shape.
    const [deepPayload] = buildLibrary().filter(
      (payload) => payload.deepAnalysed,
    )
    const read = toDeliveryRead(deepPayload.deepFeatureBaseline)
    expect(read).not.toBeNull()
    for (const value of Object.values(read!.detail)) {
      expect(value).not.toBeNull()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(10)
    }
  })

  it("leaves a light-analysed video without a delivery read", () => {
    const light = buildLibrary().find((payload) => !payload.deepAnalysed)
    expect(light).toBeDefined()
    expect(light!.deepFeatureBaseline).toBeNull()
    expect(toDeliveryRead(light!.deepFeatureBaseline)).toBeNull()
  })

  it("reports hook, drop-off, gain and hold trends", () => {
    for (const kind of [
      trends.hooks,
      trends.dropOffs,
      trends.gains,
      trends.holds,
    ]) {
      expect(kind).not.toBeNull()
      expect(kind!.trends.length).toBeGreaterThan(0)
    }
  })
})

describe("demo payload freshness", () => {
  it("stores taxonomies at the current schema versions", async () => {
    const [payload] = buildLibrary(1)
    const { isCurrentTaxonomy } = await import("@/lib/packaging-taxonomy")
    const { isCurrentScriptTaxonomy } = await import("@/lib/script-taxonomy")
    const { RETENTION_ATTRIBUTION_SCHEMA_VERSION } = await import(
      "@/lib/retention-attribution"
    )

    // Anything below the current version is regenerated on the next detail-page
    // visit, at our cost. A demo row that looks stale would quietly buy a model
    // call every time somebody opened it.
    expect(payload.packagingAlignment.taxonomy).toBeDefined()
    expect(isCurrentTaxonomy(payload.packagingAlignment.taxonomy!)).toBe(true)
    expect(isCurrentScriptTaxonomy(payload.scriptTaxonomy)).toBe(true)
    expect(payload.retentionAttribution.schemaVersion).toBe(
      RETENTION_ATTRIBUTION_SCHEMA_VERSION,
    )
  })

  it("writes one attribution moment per retention window", () => {
    const [payload] = buildLibrary(1)
    expect(payload.retentionAttribution.moments).toHaveLength(
      payload.windows.length,
    )
  })
})
