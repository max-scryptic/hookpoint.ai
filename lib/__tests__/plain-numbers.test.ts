import { describe, expect, it } from "vitest"

import { PLAIN_NUMBERS_PROMPT, PLAIN_NUMBERS_RULES } from "@/lib/plain-numbers"
import { defaultPromptText } from "@/lib/prompts/resolve"
import { PLAIN_NUMBERS_KEY, promptDefinition } from "@/lib/prompts/registry"

// GUARDRAIL: every prompt that writes prose an uploader reads must include the
// shared plain-number rules verbatim, so a figure reads the same way whichever
// analysis produced it. Before this existed each pass wrote its own units
// straight onto the page: a moment as "538 seconds" because that is what the
// retention API returns, speech as "229 wpm" because that is what the audio
// pass computes, loudness as "5 dB" because that is what ffmpeg reports. If a
// new prompt starts writing prose for the page, add its key here. Do NOT delete
// or weaken this test.
//
// As with the tip voice, the assertion is on the resolved text rather than on
// the source, since the prompts quote {{plain_numbers}} as a placeholder so an
// admin editing the fragment once changes every prompt that quotes it.
const PROSE_PROMPT_KEYS = [
  // Video analysis
  "packaging_alignment", // overall, summary, whatWorked, whatCouldBeBetter
  "pacing", // reason and suggestion, per stretch
  "retention_attribution", // explanation and tip, per moment
  "event_synthesis", // the narrative on every deep-analysis event
  // Head-to-head comparison reports
  "packaging_comparison", // verdict, reads, drivers, tips
  "retention_comparison", // summary, sections, tips
  "script_comparison", // summary, per video points, bodies, tips
  // Tips
  "tip_examples", // the three worked examples behind a tip
]

const EM_DASH = "\u2014"
const EN_DASH = "\u2013"

describe("plain numbers", () => {
  for (const key of PROSE_PROMPT_KEYS) {
    it(`${key} writes its figures under the shared plain-number rules`, () => {
      const definition = promptDefinition(key)
      expect(definition, `${key} is not a registered prompt`).not.toBeNull()

      // Declared as a fragment, so the admin page can tell an editor which
      // other prompts an edit to the rules will reach.
      expect(
        definition?.fragments.includes(PLAIN_NUMBERS_KEY),
        `${key} writes prose for the page, so it must declare the ${PLAIN_NUMBERS_KEY} fragment in lib/prompts/registry.ts.`,
      ).toBe(true)

      // Quoted by placeholder rather than restated, so one edit reaches all of
      // them, and present in the resolved text the model is actually sent.
      expect(
        definition?.default.includes(`{{${PLAIN_NUMBERS_KEY}}}`),
        `${key} must quote {{${PLAIN_NUMBERS_KEY}}} in its prompt text rather than restating the rule in its own words.`,
      ).toBe(true)
      expect(defaultPromptText(key)).toContain(PLAIN_NUMBERS_PROMPT)
    })
  }

  it("states the three rules the fragment exists for", () => {
    // The wording is free to change; what cannot go is the substance, since a
    // rewrite that quietly drops one of these is how the copy regresses. Each
    // check names a sentence that actually shipped to a user.

    // "Around 538 seconds, the audio shifts notably".
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/clock time/)
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/538 becomes 8:58/)
    // A length of time is not a moment and keeps its plain wording.
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/length of time/)

    // "your speech rate slows from about 229 wpm to 86 wpm".
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/single percentage/)
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/hold two numbers and subtract/)

    // "average volume rises by about 5 dB".
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/dB or decibels/)
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/wpm or words per minute/)
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/everyday words/)

    // The exception, so the rule does not eat the figures that do work.
    expect(PLAIN_NUMBERS_PROMPT).toMatch(/share of the audience/)
  })

  it("is one block of prompt text with no dashes the page bans", () => {
    expect(PLAIN_NUMBERS_PROMPT).toBe(PLAIN_NUMBERS_RULES.join(" "))
    expect(PLAIN_NUMBERS_PROMPT).not.toContain(EM_DASH)
    expect(PLAIN_NUMBERS_PROMPT).not.toContain(EN_DASH)
  })
})
