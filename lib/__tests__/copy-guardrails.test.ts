import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { cleanCopy, stripEmDashes } from "@/lib/copy-guardrails"

// GUARDRAIL: the Channel Trends page must never render an em dash (U+2014)
// or an en dash (U+2013), in hard-coded copy or comments alike. Hyphens are
// fine. This test scans the page's source files so a stray dash fails CI
// before it ever ships; stripEmDashes covers the runtime (model-written)
// text. If this test fails, rewrite the offending text with a hyphen, comma,
// period or colon. Do NOT delete or weaken this test.

const CHANNEL_TRENDS_SOURCE_FILES = [
  "app/dashboard/channel-trends/page.tsx",
  "app/dashboard/video-comparator/page.tsx",
  "app/dashboard/video-comparator/report/page.tsx",
  "components/channel-trends.tsx",
  "components/channel-trends-copy.ts",
  "components/channel-trends-tabs.tsx",
  "components/comparison-processing.tsx",
  "components/event-type-badge.tsx",
  "components/packaging-comparison.tsx",
  "components/previous-comparisons.tsx",
  "components/retention-comparison.tsx",
  "components/retention-comparison-chart.tsx",
  "components/retention-compare-picker.tsx",
  "components/video-comparison-tabs.tsx",
  "lib/comparison-report-versions.ts",
  "lib/packaging-comparison.ts",
  "lib/packaging-comparison-evidence.ts",
  "lib/packaging-comparison-report.ts",
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

describe("cleanCopy", () => {
  it("strips a leaked JSON structural artifact off the end of a tip", () => {
    expect(
      cleanCopy(
        'Make the title more descriptive, e.g., "THE MINER MADE IT OUT THE MINE: Reaching Arena 16."]},',
      ),
    ).toBe(
      'Make the title more descriptive, e.g., "THE MINER MADE IT OUT THE MINE: Reaching Arena 16."',
    )
  })

  it("strips leaked braces and brackets off either end", () => {
    expect(cleanCopy("{Tighten the hook.")).toBe("Tighten the hook.")
    expect(cleanCopy("Tighten the hook.}")).toBe("Tighten the hook.")
    expect(cleanCopy("Tighten the hook.]}")).toBe("Tighten the hook.")
  })

  it("leaves ordinary sentence punctuation untouched", () => {
    expect(cleanCopy("Keep it short, direct, and clear.")).toBe(
      "Keep it short, direct, and clear.",
    )
    expect(cleanCopy("Ask yourself: does the promise land?")).toBe(
      "Ask yourself: does the promise land?",
    )
  })

  it("also removes em dashes and collapses runaway whitespace", () => {
    expect(cleanCopy("pace drops — viewers   leave")).toBe(
      "pace drops - viewers leave",
    )
    expect(cleanCopy("  Trim the intro.  ")).toBe("Trim the intro.")
  })

  // Every tip is understood to be about the uploader's next videos, so an
  // opener saying so only delays the advice and reads as a tic across a page
  // of tips. The tip has to start on the action.
  it("drops a forward-looking preamble so the tip opens on the advice", () => {
    expect(cleanCopy("Next time, open on the claim itself.")).toBe(
      "Open on the claim itself.",
    )
    expect(cleanCopy("In future videos, plan a b-roll insert here.")).toBe(
      "Plan a b-roll insert here.",
    )
    expect(cleanCopy("In your next video: signpost the shift first.")).toBe(
      "Signpost the shift first.",
    )
    expect(cleanCopy("Going forward, keep the delivery lifted.")).toBe(
      "Keep the delivery lifted.",
    )
  })

  it("drops the preamble when the tip leads with the moment it came from", () => {
    expect(
      cleanCopy(
        "Where the shot goes static around 1:23: in future videos, plan a graphic.",
      ),
    ).toBe("Where the shot goes static around 1:23: plan a graphic.")
  })

  it("leaves forward-looking wording alone once it is inside the sentence", () => {
    expect(
      cleanCopy("Keep an explanation like this shorter in future videos."),
    ).toBe("Keep an explanation like this shorter in future videos.")
    expect(cleanCopy("Next time you open cold, name the payoff.")).toBe(
      "Next time you open cold, name the payoff.",
    )
  })
})
