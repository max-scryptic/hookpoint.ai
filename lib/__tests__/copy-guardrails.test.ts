import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { cleanCopy, nameVideoSides, stripEmDashes } from "@/lib/copy-guardrails"

// GUARDRAIL: the Channel Trends page must never render an em dash (U+2014)
// or an en dash (U+2013), in hard-coded copy or comments alike. Hyphens are
// fine. This test scans the page's source files so a stray dash fails CI
// before it ever ships; stripEmDashes covers the runtime (model-written)
// text. If this test fails, rewrite the offending text with a hyphen, comma,
// period or colon. Do NOT delete or weaken this test.

const CHANNEL_TRENDS_SOURCE_FILES = [
  "app/dashboard/channel-trends/page.tsx",
  "app/dashboard/checklist/loading.tsx",
  "app/dashboard/checklist/page.tsx",
  "app/dashboard/video-comparator/page.tsx",
  "app/dashboard/video-comparator/report/page.tsx",
  "components/admin/admin-tip-feedback-table.tsx",
  "components/channel-trends.tsx",
  "components/channel-trends-copy.ts",
  "components/channel-trends-tabs.tsx",
  "components/comparison-processing.tsx",
  "components/comparison-report-tabs.tsx",
  "components/event-type-badge.tsx",
  "components/packaging-comparison.tsx",
  "components/previous-comparisons.tsx",
  "components/retention-comparison.tsx",
  "components/retention-comparison-chart.tsx",
  "components/retention-compare-picker.tsx",
  "components/retention-head-to-head.tsx",
  "components/saved-tips-provider.tsx",
  "components/script-comparison.tsx",
  "components/tip-checklist.tsx",
  "components/tip-menu.tsx",
  "components/tip-feedback-dialog.tsx",
  "components/try-callout.tsx",
  "components/video-comparison-tabs.tsx",
  "lib/advice-similarity.ts",
  "lib/comparison-report-versions.ts",
  "lib/packaging-comparison.ts",
  "lib/packaging-comparison-evidence.ts",
  "lib/packaging-comparison-report.ts",
  "lib/retention-comparison.ts",
  "lib/retention-comparison-report.ts",
  "lib/script-comparison-report.ts",
  "lib/tips.ts",
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

// A head-to-head calls its two videos "Video A" and "Video B" everywhere the
// interface writes them itself, so the model's prose has to read the same way.
describe("nameVideoSides", () => {
  it("expands a bare side label into the name the interface uses", () => {
    expect(
      nameVideoSides(
        "B makes the promise instantly legible. A has more emotion and a face.",
      ),
    ).toBe(
      "Video B makes the promise instantly legible. Video A has more emotion and a face.",
    )
  })

  it("expands a label mid-sentence, possessive or paired", () => {
    expect(nameVideoSides("The payoff is clearer in B.")).toBe(
      "The payoff is clearer in Video B.",
    )
    expect(nameVideoSides("A's thumbnail carries three subjects.")).toBe(
      "Video A's thumbnail carries three subjects.",
    )
    expect(nameVideoSides("A and B both open on a face.")).toBe(
      "Video A and Video B both open on a face.",
    )
    expect(nameVideoSides("B, not A, states the number up front.")).toBe(
      "Video B, not Video A, states the number up front.",
    )
  })

  it("leaves a label that is already named alone", () => {
    expect(nameVideoSides("Video A opens on a face, Video B on a map.")).toBe(
      "Video A opens on a face, Video B on a map.",
    )
    expect(nameVideoSides("Video A and B both open on a face.")).toBe(
      "Video A and Video B both open on a face.",
    )
  })

  it("leaves an article, a quoted title and ordinary words alone", () => {
    expect(nameVideoSides("A wide shot with no face reads flat.")).toBe(
      "A wide shot with no face reads flat.",
    )
    expect(nameVideoSides("A series of quick cuts opens it.")).toBe(
      "A series of quick cuts opens it.",
    )
    expect(nameVideoSides('The title reads "A Day in the Life".')).toBe(
      'The title reads "A Day in the Life".',
    )
    expect(nameVideoSides("Plan B was to cut the intro.")).toBe(
      "Plan B was to cut the intro.",
    )
    expect(nameVideoSides("Cut to a b-roll insert, not a B-roll montage.")).toBe(
      "Cut to a b-roll insert, not a B-roll montage.",
    )
    expect(nameVideoSides("Arena 16 and the A1 preset stay put.")).toBe(
      "Arena 16 and the A1 preset stay put.",
    )
    expect(nameVideoSides("Run an A/B test on the next thumbnail.")).toBe(
      "Run an A/B test on the next thumbnail.",
    )
  })
})
