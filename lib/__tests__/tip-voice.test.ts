import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { TIP_VOICE_PROMPT, TIP_VOICE_RULES } from "@/lib/tip-voice"

// GUARDRAIL: every prompt that writes a "Try:" tip must include the shared tip
// voice verbatim, so a tip reads the same way whichever analysis produced it.
// Before this existed each prompt restated the rule in its own words and they
// drifted: the retention prompt banned "re-cut this", the packaging prompt said
// nothing at all, and the pages showed two different products. If a new prompt
// starts writing tips, add its file here. Do NOT delete or weaken this test.

const TIP_PROMPT_SOURCE_FILES = [
  // Video analysis
  "lib/packaging-alignment.ts", // whatCouldBeBetter, per packaging component
  "lib/pacing-analysis.ts", // suggestion, per slow or repetitive stretch
  "lib/retention-attribution.ts", // tip, per hook / drop-off / gain / hold
  // Head-to-head comparison reports
  "lib/packaging-comparison-report.ts", // driver tips, surface tips
  "lib/retention-comparison-report.ts", // section tips
  "lib/script-comparison-report.ts", // section tips
]

const EM_DASH = "—"
const EN_DASH = "–"

describe("tip voice", () => {
  for (const file of TIP_PROMPT_SOURCE_FILES) {
    it(`${file} writes its tips under the shared tip voice`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8")
      expect(
        source.includes("TIP_VOICE_PROMPT"),
        `${file} generates tips, so its prompt must include TIP_VOICE_PROMPT from lib/tip-voice.ts rather than restating the rule in its own words.`,
      ).toBe(true)
    })
  }

  it("states the rule the tips exist to follow", () => {
    // The wording is free to change; what cannot go is the substance, since a
    // rewrite that quietly drops one of these is how the tips regress. Each
    // check names a failure seen on the page.

    // "Open with a punchier teaser that highlights why this deck is mysterious"
    // only makes sense with the analysed video in front of the reader.
    expect(TIP_VOICE_PROMPT).toMatch(/does not exist yet/)
    expect(TIP_VOICE_PROMPT).toMatch(/this deck/)

    // A comparative grades the next video against the one just watched.
    expect(TIP_VOICE_PROMPT).toMatch(/punchier/)
    expect(TIP_VOICE_PROMPT).toMatch(/plain adjective/)

    // The published video cannot be changed.
    expect(TIP_VOICE_PROMPT).toMatch(/already published/)
    expect(TIP_VOICE_PROMPT).toMatch(/re-edit/)

    // The framing belongs in the advice, not in a lead-in, and the interface
    // already prints "Try:" in front of every tip.
    expect(TIP_VOICE_PROMPT).toMatch(/Next time/)
    expect(TIP_VOICE_PROMPT).toMatch(/never begin one with 'Try'/)

    // "Give a spoken point like this something to look at as you make it"
    // parses and still leaves a beginner with nothing to do.
    expect(TIP_VOICE_PROMPT).toMatch(/plain English/)
    expect(TIP_VOICE_PROMPT).toMatch(/never edited a video/)
    expect(TIP_VOICE_PROMPT).toMatch(/One instruction, one sentence/)
  })

  it("is one block of prompt text with no dashes the page bans", () => {
    expect(TIP_VOICE_PROMPT).toBe(TIP_VOICE_RULES.join(" "))
    expect(TIP_VOICE_PROMPT).not.toContain(EM_DASH)
    expect(TIP_VOICE_PROMPT).not.toContain(EN_DASH)
  })
})
