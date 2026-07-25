import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { stripEmDashes } from "@/lib/copy-guardrails"

// GUARDRAIL: the Channel Trends page must never render an em dash (U+2014)
// or an en dash (U+2013), in hard-coded copy or comments alike. Hyphens are
// fine. This test scans the page's source files so a stray dash fails CI
// before it ever ships; stripEmDashes covers the runtime (model-written)
// text. If this test fails, rewrite the offending text with a hyphen, comma,
// period or colon. Do NOT delete or weaken this test.

const CHANNEL_TRENDS_SOURCE_FILES = [
  "app/dashboard/channel-trends/page.tsx",
  "app/dashboard/video-comparator/page.tsx",
  "components/channel-trends.tsx",
  "components/channel-trends-copy.ts",
  "components/event-type-badge.tsx",
  "components/packaging-comparison.tsx",
  "components/previous-comparisons.tsx",
  "components/retention-comparison.tsx",
  "components/retention-comparison-chart.tsx",
  "components/retention-compare-picker.tsx",
  "components/video-comparison-tabs.tsx",
  "lib/packaging-comparison.ts",
  "lib/retention-comparison.ts",
  "lib/video-comparisons.ts",
]

const EM_DASH = "—"
const EN_DASH = "–"

describe("channel trends copy guardrails", () => {
  for (const file of CHANNEL_TRENDS_SOURCE_FILES) {
    it(`${file} contains no em or en dashes`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8")
      const offending = source
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => line.includes(EM_DASH) || line.includes(EN_DASH))
      expect(
        offending,
        `Em/en dashes are banned on the Channel Trends page. Found in ${file}: ${offending
          .map(({ number }) => `line ${number}`)
          .join(", ")}`,
      ).toEqual([])
    })
  }

  it("stripEmDashes scrubs runtime text before it reaches the page", () => {
    expect(stripEmDashes("pace drops — viewers leave")).toBe(
      "pace drops - viewers leave",
    )
    expect(stripEmDashes("pace drops—viewers leave")).toBe(
      "pace drops - viewers leave",
    )
    expect(stripEmDashes("1–3 words")).toBe("1-3 words")
    expect(stripEmDashes("a plain hyphen - stays put")).toBe(
      "a plain hyphen - stays put",
    )
  })
})
