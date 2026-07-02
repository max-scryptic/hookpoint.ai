import { describe, expect, it } from "vitest"

import { buildSceneCueScanArgs, parseSceneCues } from "@/lib/media/scene-detection"

describe("buildSceneCueScanArgs", () => {
  it("chains downscale, freezedetect, blackdetect and scene-select in one -vf graph", () => {
    const args = buildSceneCueScanArgs("https://signed.example/video.mp4")

    expect(args[0]).toBe("-i")
    expect(args[1]).toBe("https://signed.example/video.mp4")
    expect(args).toContain("-an")

    const filters = args[args.indexOf("-vf") + 1]
    expect(filters).toContain("scale=")
    expect(filters).toContain("freezedetect=")
    expect(filters).toContain("blackdetect=")
    expect(filters).toContain("select=")
    expect(filters).toContain("showinfo")
    // freezedetect/blackdetect (non-destructive) must run before select
    // (destructive) so a single decode pass feeds all three.
    expect(filters.indexOf("freezedetect=")).toBeLessThan(filters.indexOf("select="))
    expect(filters.indexOf("blackdetect=")).toBeLessThan(filters.indexOf("select="))

    expect(args.slice(-3)).toEqual(["-f", "null", "-"])
  })
})

describe("parseSceneCues", () => {
  it("reads a cut timestamp from each showinfo line", () => {
    const stderr = [
      "[Parsed_showinfo_4 @ 0x1] n:   0 pts:      0 pts_time:0       fmt:yuv420p",
      "[Parsed_showinfo_4 @ 0x1] n:   1 pts:   1234 pts_time:12.34    fmt:yuv420p",
    ].join("\n")

    expect(parseSceneCues(stderr, 60).cuts).toEqual([
      { atSeconds: 0 },
      { atSeconds: 12.34 },
    ])
  })

  it("pairs freeze_start with the following freeze_duration into a span", () => {
    const stderr = [
      "[freezedetect @ 0x1] freeze_start: 5.5",
      "[freezedetect @ 0x1] freeze_duration: 2.5",
      "[freezedetect @ 0x1] freeze_end: 8.0",
    ].join("\n")

    expect(parseSceneCues(stderr, 60).freezes).toEqual([
      { fromSeconds: 5.5, toSeconds: 8 },
    ])
  })

  it("closes out a freeze still running at end of stream using durationSeconds", () => {
    const stderr = "[freezedetect @ 0x1] freeze_start: 55"

    expect(parseSceneCues(stderr, 60).freezes).toEqual([
      { fromSeconds: 55, toSeconds: 60 },
    ])
  })

  it("reads a black span from a single combined blackdetect line", () => {
    const stderr =
      "[blackdetect @ 0x1] black_start:20.1 black_end:22.6 black_duration:2.5"

    expect(parseSceneCues(stderr, 60).blacks).toEqual([
      { fromSeconds: 20.1, toSeconds: 22.6 },
    ])
  })

  it("finds nothing when none of the filters logged anything", () => {
    expect(parseSceneCues("no useful output", 60)).toEqual({
      cuts: [],
      freezes: [],
      blacks: [],
    })
  })
})
