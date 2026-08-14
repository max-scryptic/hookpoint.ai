import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  cleanCopy,
  limitSentences,
  nameVideoSides,
  stripEmDashes,
} from "@/lib/copy-guardrails"

// GUARDRAIL: the Channel Trends page must never render an em dash (U+2014)
// or an en dash (U+2013), in hard-coded copy or comments alike. Hyphens are
// fine. This test scans the page's source files so a stray dash fails CI
// before it ever ships; stripEmDashes covers the runtime (model-written)
// text. If this test fails, rewrite the offending text with a hyphen, comma,
// period or colon. Do NOT delete or weaken this test.

const CHANNEL_TRENDS_SOURCE_FILES = [
  "app/dashboard/channel-trends/loading.tsx",
  "app/dashboard/channel-trends/page.tsx",
  "app/dashboard/checklist/loading.tsx",
  "app/dashboard/checklist/page.tsx",
  "app/dashboard/video-comparator/page.tsx",
  "app/dashboard/video-comparator/report/page.tsx",
  "components/admin/admin-tip-feedback-table.tsx",
  "components/channel-trends.tsx",
  "components/channel-trends-content.tsx",
  "components/channel-trends-copy.ts",
  "components/channel-trends-packaging.tsx",
  "components/channel-trends-retention.tsx",
  "components/channel-trends-shared.tsx",
  "components/channel-trends-tabs.tsx",
  "components/channel-trends-taxonomy.tsx",
  "components/comparison-processing.tsx",
  "components/comparison-report-tabs.tsx",
  "components/event-type-badge.tsx",
  "components/packaging-alignment-score.tsx",
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
  "lib/channel-taxonomy-trends.ts",
  "lib/comparison-cleanup.ts",
  "lib/comparison-comparability.ts",
  "lib/comparison-report-versions.ts",
  "lib/packaging-comparison.ts",
  "lib/packaging-comparison-evidence.ts",
  "lib/packaging-comparison-report.ts",
  "lib/retention-comparison.ts",
  "lib/retention-comparison-report.ts",
  "lib/retention-sample-size.ts",
  "lib/script-comparison-report.ts",
  "lib/tip-voice.ts",
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

  // The interface prints "Try:" in front of every tip, so a tip that opens on
  // "Try" reads the word twice on the page. The video analysis tips are plain
  // commands, and these have to read the same way.
  it("turns a tip that opens on Try back into the command it should have been", () => {
    expect(
      cleanCopy(
        "Try opening with a visually dynamic split-screen combined with a precise reason to watch.",
      ),
    ).toBe(
      "Open with a visually dynamic split-screen combined with a precise reason to watch.",
    )
    expect(
      cleanCopy(
        "Try maintaining focus on the main game content during mid-video stretches.",
      ),
    ).toBe("Maintain focus on the main game content during mid-video stretches.")
    expect(
      cleanCopy("Try including a split-screen layout during the late segments."),
    ).toBe("Include a split-screen layout during the late segments.")
    expect(cleanCopy("Try pacing narration steadily through the middle.")).toBe(
      "Pace narration steadily through the middle.",
    )
    expect(
      cleanCopy("Try incorporating a visual change early in the video."),
    ).toBe("Incorporate a visual change early in the video.")
    expect(cleanCopy("Try using one line of text on the thumbnail.")).toBe(
      "Use one line of text on the thumbnail.",
    )
  })

  it("drops the opener where the command is already written", () => {
    expect(cleanCopy("Try to open on the claim itself.")).toBe(
      "Open on the claim itself.",
    )
    expect(cleanCopy("Try and keep the picture moving.")).toBe(
      "Keep the picture moving.",
    )
    expect(cleanCopy("Try: cut the intro to one sentence.")).toBe(
      "Cut the intro to one sentence.",
    )
  })

  it("drops both openers when a tip carries them at once", () => {
    expect(cleanCopy("Next time, try opening on the claim itself.")).toBe(
      "Open on the claim itself.",
    )
  })

  it("leaves a Try it cannot rewrite into a command alone", () => {
    // No gerund to work from, so stripping the opener would leave a fragment.
    expect(cleanCopy("Try a colder open with no setup.")).toBe(
      "Try a colder open with no setup.",
    )
  })

  it("leaves the word alone anywhere but the opener", () => {
    expect(cleanCopy("Keep the setup short and try the payoff first.")).toBe(
      "Keep the setup short and try the payoff first.",
    )
    expect(cleanCopy("Trying a colder open is worth it.")).toBe(
      "Trying a colder open is worth it.",
    )
  })

  // The gerund has to come back as the verb itself, so the spellings that are
  // not a plain "drop the ending" are worth pinning down: a wrong word on the
  // page would be worse than the duplicated label this replaces.
  it("spells the command form of an awkward gerund correctly", () => {
    const command = (gerund: string) =>
      cleanCopy(`Try ${gerund} the hook.`).replace(/ the hook\.$/, "")

    expect(command("cutting")).toBe("Cut")
    expect(command("trimming")).toBe("Trim")
    expect(command("planning")).toBe("Plan")
    expect(command("adding")).toBe("Add")
    expect(command("calling")).toBe("Call")
    expect(command("making")).toBe("Make")
    expect(command("framing")).toBe("Frame")
    expect(command("naming")).toBe("Name")
    expect(command("breaking")).toBe("Break")
    expect(command("checking")).toBe("Check")
    expect(command("closing")).toBe("Close")
    expect(command("raising")).toBe("Raise")
    expect(command("focusing")).toBe("Focus")
    expect(command("comparing")).toBe("Compare")
    expect(command("measuring")).toBe("Measure")
    expect(command("handling")).toBe("Handle")
    expect(command("packaging")).toBe("Package")
    expect(command("bringing")).toBe("Bring")
    expect(command("stating")).toBe("State")
    expect(command("repeating")).toBe("Repeat")
    expect(command("editing")).toBe("Edit")
    expect(command("tightening")).toBe("Tighten")
    expect(command("front-loading")).toBe("Front-load")
    expect(command("holding")).toBe("Hold")
    expect(command("writing")).toBe("Write")
    expect(command("including")).toBe("Include")
    expect(command("continuing")).toBe("Continue")
    expect(command("moving")).toBe("Move")
    expect(command("signposting")).toBe("Signpost")
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

// Every summary card in the app is capped at two sentences, so a model that
// writes three or four is cut back at render time. See the SUMMARY LENGTH
// section of lib/copy-guardrails.ts.
describe("limitSentences", () => {
  it("keeps the first two sentences and drops the rest", () => {
    expect(
      limitSentences(
        "Video B packages itself better. Its title names the payoff while Video A only hints at it. The thumbnail carries one subject rather than three. Both openings then wander.",
      ),
    ).toBe(
      "Video B packages itself better. Its title names the payoff while Video A only hints at it.",
    )
  })

  it("leaves copy already inside the limit untouched", () => {
    expect(
      limitSentences(
        "Video A holds its audience through the midpoint. Video B sheds a third of its viewers in the first minute.",
      ),
    ).toBe(
      "Video A holds its audience through the midpoint. Video B sheds a third of its viewers in the first minute.",
    )
    expect(limitSentences("One sentence is plenty.")).toBe(
      "One sentence is plenty.",
    )
    expect(limitSentences("")).toBe("")
  })

  it("keeps a closing quote or bracket with the sentence it ends", () => {
    expect(
      limitSentences(
        'The title reads "Reaching Arena 16." Video B states the number up front. Video A buries it.',
      ),
    ).toBe(
      'The title reads "Reaching Arena 16." Video B states the number up front.',
    )
  })

  it("does not break on a decimal, a timestamp or an abbreviation", () => {
    expect(
      limitSentences(
        "Video A holds 42.1% at 1:30 against 31.4% for Video B. Video A vs. Video B is a two point gap on click-through, i.e. within noise. The openings differ more than the curves do.",
      ),
    ).toBe(
      "Video A holds 42.1% at 1:30 against 31.4% for Video B. Video A vs. Video B is a two point gap on click-through, i.e. within noise.",
    )
  })

  it("takes a limit of its own and handles prose with no terminator", () => {
    expect(
      limitSentences("First point. Second point. Third point.", 1),
    ).toBe("First point.")
    expect(limitSentences("An unterminated verdict with no full stop")).toBe(
      "An unterminated verdict with no full stop",
    )
  })
})
