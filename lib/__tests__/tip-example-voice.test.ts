import { describe, expect, it } from "vitest"

import { defaultPromptText } from "@/lib/prompts/resolve"
import {
  promptDefinition,
  TIP_EXAMPLE_VOICE_KEY,
  TIP_VOICE_KEY,
} from "@/lib/prompts/registry"
import {
  TIP_EXAMPLE_VOICE_PROMPT,
  TIP_EXAMPLE_VOICE_RULES,
} from "@/lib/tip-example-voice"

// GUARDRAIL: every prompt that writes a "Try:" tip must also write that tip's
// three worked examples, under the shared example voice, quoted verbatim. The
// examples are written beside the advice on purpose: that call is the one
// holding the transcript, the thumbnail and the evidence, and it is the only
// one that can make an example concrete. A prompt that stops writing them
// silently falls back to the on-demand pass, which sees the tip and a video
// title and nothing else. If a new prompt starts writing tips, add its key
// here. Do NOT delete or weaken this test.
//
// Same shape as tip-voice.test.ts beside it, and for the same reason: the
// prompts quote a {{tip_example_voice}} placeholder rather than interpolating
// the constant, so an admin editing the rules once changes every prompt that
// writes an example. This asserts on the resolved text, which is what actually
// reaches the model.
const TIP_PROMPT_KEYS = [
  // Video analysis
  "packaging_alignment", // examples, per packaging component
  "pacing", // examples, per slow or repetitive stretch
  "retention_attribution", // tipExamples, per moment that earned a tip
  // Head-to-head comparison reports
  "packaging_comparison", // tipExamples, per surface tip
  "retention_comparison", // tipExamples, per section tip
  "script_comparison", // tipExamples, per section tip
]

// The fallback that writes examples for a tip which arrived without any. It is
// held to the same rules, and it is the one prompt here that writes examples
// without also writing the tip.
const ON_DEMAND_KEY = "tip_examples"

const EM_DASH = "\u2014"
const EN_DASH = "\u2013"

describe("tip example voice", () => {
  for (const key of [...TIP_PROMPT_KEYS, ON_DEMAND_KEY]) {
    it(`${key} writes its examples under the shared example voice`, () => {
      const definition = promptDefinition(key)
      expect(definition, `${key} is not a registered prompt`).not.toBeNull()

      // Declared as a fragment, so the admin page can tell an editor which
      // other prompts an edit to the example voice will reach.
      expect(
        definition?.fragments.includes(TIP_EXAMPLE_VOICE_KEY),
        `${key} writes worked examples, so it must declare the ${TIP_EXAMPLE_VOICE_KEY} fragment in lib/prompts/registry.ts.`,
      ).toBe(true)

      expect(
        definition?.default.includes(`{{${TIP_EXAMPLE_VOICE_KEY}}}`),
        `${key} must quote {{${TIP_EXAMPLE_VOICE_KEY}}} rather than restating the example rules.`,
      ).toBe(true)

      const resolved = defaultPromptText(key)
      for (const rule of TIP_EXAMPLE_VOICE_RULES) {
        expect(
          resolved.includes(rule),
          `${key} does not carry the example rule: ${rule.slice(0, 60)}...`,
        ).toBe(true)
      }
    })
  }

  // The two voices govern opposite things and must not be confused: a tip is a
  // plain command with no "Try" in front of it, an example is that advice
  // already carried out, in quotation marks where it is words. The prompts that
  // write both quote both.
  it("is a separate rule from the tip voice, quoted alongside it", () => {
    for (const key of TIP_PROMPT_KEYS) {
      const definition = promptDefinition(key)
      expect(definition?.fragments.includes(TIP_VOICE_KEY), key).toBe(true)
      expect(definition?.fragments.includes(TIP_EXAMPLE_VOICE_KEY), key).toBe(
        true,
      )
    }
    // The on-demand prompt writes examples only, so it is the one that must NOT
    // be handed the tip rules: they would turn its examples back into tips.
    const onDemand = promptDefinition(ON_DEMAND_KEY)
    expect(onDemand?.fragments.includes(TIP_VOICE_KEY)).toBe(false)
  })

  it("asks for the three the tab strip is built for", () => {
    expect(TIP_EXAMPLE_VOICE_PROMPT).toContain("exactly three examples")
  })

  // The other half of the division of labour: the tip is written as the general
  // rule (lib/tip-voice.ts), so the examples are the only place this channel's
  // own subject matter appears. Dropping this leaves the tips general and the
  // examples abstract, which is worse than either failure on its own.
  it("keeps the channel's own subject matter in the examples", () => {
    expect(TIP_EXAMPLE_VOICE_PROMPT).toMatch(/this channel makes videos about/)
    expect(TIP_EXAMPLE_VOICE_PROMPT).toMatch(/general rule/)
  })

  it("contains no em or en dashes", () => {
    expect(TIP_EXAMPLE_VOICE_PROMPT.includes(EM_DASH)).toBe(false)
    expect(TIP_EXAMPLE_VOICE_PROMPT.includes(EN_DASH)).toBe(false)
  })
})
