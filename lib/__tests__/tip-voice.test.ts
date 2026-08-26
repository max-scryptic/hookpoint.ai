import { describe, expect, it } from "vitest"

import { defaultPromptText } from "@/lib/prompts/resolve"
import { promptDefinition, TIP_VOICE_KEY } from "@/lib/prompts/registry"
import { TIP_VOICE_PROMPT, TIP_VOICE_RULES } from "@/lib/tip-voice"

// GUARDRAIL: every prompt that writes a "Try:" tip must include the shared tip
// voice verbatim, so a tip reads the same way whichever analysis produced it.
// Before this existed each prompt restated the rule in its own words and they
// drifted: the retention prompt banned "re-cut this", the packaging prompt said
// nothing at all, and the pages showed two different products. If a new prompt
// starts writing tips, add its key here. Do NOT delete or weaken this test.
//
// The prompts quote the voice as a {{tip_voice}} placeholder now rather than
// interpolating the constant, so that an admin editing the tip voice once in
// the Prompts page changes every prompt that quotes it. That indirection is
// exactly what this test has to see through: it asserts on the resolved text,
// which is what actually reaches the model, rather than on the source that
// produces it.
const TIP_PROMPT_KEYS = [
  // Video analysis
  "packaging_alignment", // whatCouldBeBetter, per packaging component
  "pacing", // suggestion, per slow or repetitive stretch
  "retention_attribution", // tip, per hook / drop-off / gain / hold
  // Head-to-head comparison reports
  "packaging_comparison", // driver tips, surface tips
  "retention_comparison", // section tips
  "script_comparison", // section tips
]

const EM_DASH = "\u2014"
const EN_DASH = "\u2013"

describe("tip voice", () => {
  for (const key of TIP_PROMPT_KEYS) {
    it(`${key} writes its tips under the shared tip voice`, () => {
      const definition = promptDefinition(key)
      expect(definition, `${key} is not a registered prompt`).not.toBeNull()

      // Declared as a fragment, so the admin page can tell an editor which
      // other prompts an edit to the tip voice will reach.
      expect(
        definition?.fragments.includes(TIP_VOICE_KEY),
        `${key} generates tips, so it must declare the ${TIP_VOICE_KEY} fragment in lib/prompts/registry.ts.`,
      ).toBe(true)

      // Quoted by placeholder rather than restated, so one edit reaches all of
      // them, and present in the resolved text the model is actually sent.
      expect(
        definition?.default.includes(`{{${TIP_VOICE_KEY}}}`),
        `${key} must quote {{${TIP_VOICE_KEY}}} in its prompt text rather than restating the rule in its own words.`,
      ).toBe(true)
      expect(defaultPromptText(key)).toContain(TIP_VOICE_PROMPT)
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
