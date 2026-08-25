import { describe, expect, it } from "vitest"

import { RETENTION_COMPARISON_REPORT_SCHEMA_VERSION } from "@/lib/comparison-report-versions"
import {
  buildComparisonVideo,
  buildRetentionComparison,
  computeEvidenceCalibration,
  type ComparisonVideo,
  type ComparisonVideoSummary,
} from "@/lib/retention-comparison"
import {
  checkpointsForModel,
  curveSamplesForModel,
  normalizeRetentionComparisonReport,
  retentionComparisonForModel,
  stretchSeconds,
  transcriptForStretch,
} from "@/lib/retention-comparison-report"
import type { RetentionPoint, TranscriptCue } from "@/lib/youtube/youtube"

function point(elapsedRatio: number, watchRatio: number): RetentionPoint {
  return {
    elapsedRatio,
    watchRatio,
    relativePerformance: null,
    timestampSeconds: elapsedRatio * 100,
  }
}

function summary(
  overrides: Partial<ComparisonVideoSummary> = {},
): ComparisonVideoSummary {
  return {
    id: "video-a",
    videoId: "yt-video-a",
    title: "Video A",
    thumbnailUrl: null,
    publishedAt: null,
    durationSeconds: 240,
    views: null,
    analyticsViews: null,
    averageViewDurationSeconds: null,
    averageViewPercentage: null,
    netSubscribersGained: null,
    ...overrides,
  }
}

function video(
  curve: RetentionPoint[],
  overrides: Partial<ComparisonVideoSummary> = {},
): ComparisonVideo {
  return buildComparisonVideo({
    summary: summary(overrides),
    curve,
    windows: [],
    events: [],
    readySynthesisWindowIds: new Set<string>(),
    calibration: computeEvidenceCalibration([]),
  })
}

function cue(startSeconds: number, endSeconds: number, text: string): TranscriptCue {
  return { startSeconds, endSeconds, text }
}

describe("curveSamplesForModel", () => {
  it("samples the curve every 5% with the clock time of each sample", () => {
    const samples = curveSamplesForModel(
      [point(0.5, 0.6), point(1, 0.3)],
      240,
    )
    expect(samples).toHaveLength(21)
    expect(samples[0]).toEqual({
      atPercent: 0,
      at: "0:00",
      // The synthetic 0:00 = 100% baseline the chart draws.
      stillWatchingPercent: 100,
    })
    expect(samples[samples.length - 1]).toEqual({
      atPercent: 100,
      at: "4:00",
      stillWatchingPercent: 30,
    })
  })
})

describe("checkpointsForModel", () => {
  it("reads the quarter, half, three quarter and final holds", () => {
    const checkpoints = checkpointsForModel(
      [point(0.25, 0.8), point(0.5, 0.6), point(0.75, 0.5), point(1, 0.4)],
      240,
    )
    expect(checkpoints).toEqual([
      { atPercent: 25, at: "1:00", stillWatchingPercent: 80 },
      { atPercent: 50, at: "2:00", stillWatchingPercent: 60 },
      { atPercent: 75, at: "3:00", stillWatchingPercent: 50 },
      { atPercent: 100, at: "4:00", stillWatchingPercent: 40 },
    ])
  })

  it("returns nothing for a video with no curve", () => {
    expect(checkpointsForModel([], 240)).toEqual([])
  })
})

describe("stretchSeconds", () => {
  it("puts the same share of runtime at different clock times on each side", () => {
    const divergence = {
      fromRatio: 0.2,
      toRatio: 0.45,
      widenedFor: "a" as const,
      gapChange: 0.2,
      gapChangeMargin: null,
      aFromRatio: 0.8,
      aToRatio: 0.75,
      bFromRatio: 0.6,
      bToRatio: 0.35,
    }
    // 20% to 45% is 1:12 to 2:42 in a six minute video and 0:48 to 1:48 in a
    // four minute one, which is the whole reason both are given to the model.
    expect(stretchSeconds(divergence, 360)).toEqual({
      fromSeconds: 72,
      toSeconds: 162,
    })
    expect(stretchSeconds(divergence, 240)).toEqual({
      fromSeconds: 48,
      toSeconds: 108,
    })
  })
})

describe("transcriptForStretch", () => {
  const cues = [
    cue(0, 5, "Opening line"),
    cue(60, 65, "Inside the stretch"),
    cue(115, 125, "Overlapping the end"),
    cue(200, 205, "Well past it"),
  ]

  it("keeps every cue overlapping the stretch, timestamped", () => {
    expect(transcriptForStretch(cues, 50, 120)).toBe(
      "[1:00] Inside the stretch\n[1:55] Overlapping the end",
    )
  })

  it("is empty when nothing was said across the stretch", () => {
    expect(transcriptForStretch(cues, 300, 320)).toBe("")
    expect(transcriptForStretch([], 0, 100)).toBe("")
  })
})

describe("retentionComparisonForModel", () => {
  // Video B starts ahead and falls away after the halfway mark, so the stretch
  // where the gap grows runs from the quarter point to the end rather than
  // across the whole video: enough for the transcript clipping to bite.
  const a = video([point(0.25, 0.7), point(0.5, 0.65), point(1, 0.6)], {
    id: "video-a",
    title: "The one that held",
    durationSeconds: 240,
  })
  const b = video([point(0.25, 0.9), point(0.5, 0.85), point(1, 0.2)], {
    id: "video-b",
    videoId: "yt-video-b",
    title: "The one that did not",
    durationSeconds: 120,
  })
  const data = buildRetentionComparison(a, b, computeEvidenceCalibration([]))

  it("names the divergence in real clock time on both sides", () => {
    const payload = retentionComparisonForModel(data, [], [])
    expect(payload.divergence).not.toBeNull()
    expect(payload.divergence!.widenedFor).toBe("Video A")
    // The same share of runtime, read off each video's own clock.
    expect(payload.divergence!.inVideoA).not.toBe(payload.divergence!.inVideoB)
  })

  it("gives each side only the transcript spanning the divergence stretch", () => {
    const payload = retentionComparisonForModel(
      data,
      [cue(0, 4, "Video A opening"), cue(70, 75, "Video A mid stretch")],
      [cue(0, 4, "Video B opening"), cue(35, 40, "Video B mid stretch")],
    )
    expect(payload.videoA.divergenceTranscript).toContain("Video A mid stretch")
    expect(payload.videoA.divergenceTranscript).not.toContain("Video A opening")
    expect(payload.videoB.divergenceTranscript).toContain("Video B mid stretch")
  })

  it("passes no transcript through when a video has no captions", () => {
    const payload = retentionComparisonForModel(data, [], [])
    expect(payload.videoA.divergenceTranscript).toBeNull()
    expect(payload.videoB.divergenceTranscript).toBeNull()
  })

  it("carries each side's checkpoints so the prose and the page agree", () => {
    const payload = retentionComparisonForModel(data, [], [])
    expect(payload.videoA.checkpoints).toHaveLength(4)
    expect(payload.videoA.checkpoints[0].stillWatchingPercent).toBe(70)
    expect(payload.videoA.checkpoints[3].stillWatchingPercent).toBe(60)
    expect(payload.videoB.checkpoints[3].stillWatchingPercent).toBe(20)
  })

  // The model cannot work out for itself whether a gap is bigger than the noise
  // in the audience it came from, so it is never asked to: the verdict arrives
  // already decided, and the prompt binds the report to it.
  describe("reliability", () => {
    const pairWithViews = (viewsA: number | null, viewsB: number | null) =>
      buildRetentionComparison(
        video([point(0.25, 0.55), point(0.88, 0.04), point(1, 0.043)], {
          id: "video-a",
          analyticsViews: viewsA,
        }),
        video([point(0.25, 0.27), point(0.88, 0.09), point(1, 0.088)], {
          id: "video-b",
          analyticsViews: viewsB,
        }),
        computeEvidenceCalibration([]),
      )

    it("hands over the verdict and the audience behind each curve", () => {
      const payload = retentionComparisonForModel(
        pairWithViews(2_000, 80),
        [],
        [],
      )
      expect(payload.reliability.comparable).toBe("shape_only")
      expect(payload.reliability.caveats).toContain("small_sample")
      expect(payload.reliability.videoBViewers).toBe(80)
      expect(payload.videoB.viewersBehindCurve).toBe(80)
      // The 4.5 point ending gap sits inside its own margin.
      expect(payload.reliability.endingGapIsSignificant).toBe(false)
      // About 11 points at 80 viewers, about 2 at 2,000.
      expect(payload.reliability.videoBPointMarginInPoints!).toBeGreaterThan(
        payload.reliability.videoAPointMarginInPoints!,
      )
    })

    it("opens the level reading up when both audiences are large", () => {
      const payload = retentionComparisonForModel(
        pairWithViews(20_000, 18_000),
        [],
        [],
      )
      expect(payload.reliability.comparable).toBe("level_and_shape")
      expect(payload.reliability.endingGapIsSignificant).toBe(true)
    })

    it("sizes the divergence against its own margin", () => {
      const payload = retentionComparisonForModel(
        pairWithViews(2_000, 80),
        [],
        [],
      )
      // The shape difference is real even at 80 viewers, and the model is told
      // by how much, so it cannot treat every divergence as equally solid.
      expect(payload.divergence).not.toBeNull()
      expect(
        payload.divergence!.gapChangeMarginInPoints!,
      ).toBeLessThan(payload.divergence!.gapChangeInPoints)
    })

    it("reports unknown rather than guessing when no views are stored", () => {
      const payload = retentionComparisonForModel(
        pairWithViews(null, null),
        [],
        [],
      )
      expect(payload.reliability.comparable).toBe("unknown")
      expect(payload.reliability.videoAPointMarginInPoints).toBeNull()
    })
  })
})

describe("normalizeRetentionComparisonReport", () => {
  it("trims, stamps the shape version and keeps the tips", () => {
    const report = normalizeRetentionComparisonReport(
      {
        summary: "  Video A held its audience.  ",
        sections: [
          { heading: " The openings ", body: " Video A kept more. ", tip: " Open on the payoff. " },
          { heading: "The divergence", body: "Video B fell away.", tip: "" },
          { heading: "The endings", body: "Video A finished higher.", tip: "Close on one idea." },
        ],
      },
      "gpt-4.1-mini",
    )
    expect(report.summary).toBe("Video A held its audience.")
    expect(report.sections[0]).toEqual({
      heading: "The openings",
      body: "Video A kept more.",
      tip: "Open on the payoff.",
    })
    // An empty tip is dropped rather than stored, so the renderer's presence
    // check is all it needs.
    expect(report.sections[1].tip).toBeUndefined()
    expect(report.schemaVersion).toBe(RETENTION_COMPARISON_REPORT_SCHEMA_VERSION)
    expect(report.model).toBe("gpt-4.1-mini")
  })

  it("keeps the worked examples written with a tip, and drops them with it", () => {
    const report = normalizeRetentionComparisonReport(
      {
        summary: "A verdict.",
        sections: [
          {
            heading: "The openings",
            body: "Video A kept more.",
            tip: "Open on the payoff.",
            tipExamples: [
              { label: "Straight to the result", example: '"It held for six months."' },
              { label: "Open on the obstacle", example: "  Everyone says   this cannot work.  " },
              { label: "", example: "" },
            ],
          },
          {
            heading: "The endings",
            body: "Video B fell away.",
            tip: "",
            // Examples with no tip left to demonstrate go with it.
            tipExamples: [{ label: "Orphaned", example: "Never rendered." }],
          },
        ],
      },
      "gpt-4.1-mini",
    )
    expect(report.sections[0].tipExamples).toEqual([
      { label: "Straight to the result", example: '"It held for six months."' },
      { label: "Open on the obstacle", example: "Everyone says this cannot work." },
    ])
    expect(report.sections[1].tip).toBeUndefined()
    expect(report.sections[1].tipExamples).toBeUndefined()
  })

  it("drops a section with no heading or no body", () => {
    const report = normalizeRetentionComparisonReport(
      {
        summary: "A verdict.",
        sections: [
          { heading: "Kept", body: "Something.", tip: "Do a thing." },
          { heading: "", body: "Orphaned body.", tip: "Ignored." },
          { heading: "No body", body: "   ", tip: "Ignored." },
        ],
      },
      "gpt-4.1-mini",
    )
    expect(report.sections.map((section) => section.heading)).toEqual(["Kept"])
  })
})
