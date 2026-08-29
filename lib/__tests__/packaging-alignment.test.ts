import { describe, expect, it } from "vitest"

import { prioritizePackagingImprovements } from "@/lib/packaging-alignment"
import { PACKAGING_ALIGNMENT_PROMPT } from "@/lib/prompts/defaults/light-analysis"

describe("prioritizePackagingImprovements", () => {
  it("orders hook, title, and thumbnail feedback by product priority", () => {
    const points = [
      "Add a stronger thumbnail cue.",
      "Make the title more specific.",
      "State the payoff in the first 10 seconds of the hook.",
    ]

    expect(prioritizePackagingImprovements(points)).toEqual([
      points[2],
      points[1],
      points[0],
    ])
  })

  it("keeps the original order for uncategorised feedback", () => {
    const points = ["Clarify the promise.", "Tighten the framing."]

    expect(prioritizePackagingImprovements(points)).toEqual(points)
  })
})

// GUARDRAIL: this report's tips are about alignment, and the hook's tip is the
// one that drifts into retention advice ("...to hook viewers immediately"),
// which the creator already gets from the retention report, argued from the
// real curve. The wording of the prompt is free to change; the substance these
// check is what stops the Hook tab regressing into a second retention section.
// Do NOT delete or weaken this test. See THE HOOK TIP DRIFTS in
// lib/prompts/defaults/light-analysis.ts.
describe("packaging alignment prompt", () => {
  it("makes every improvement an alignment change", () => {
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(/is an alignment change/)
    // The floor under it: advice that never looked at the other two surfaces
    // is not an alignment point, whatever else it is.
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(/only that one component/)
  })

  it("holds the hook tip to alignment rather than attention", () => {
    // Stated for the hook in its own words, not left to the general rule.
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(
      /not the job of hooking a viewer/,
    )
    // The failure and its alignment form, beside each other.
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(/to hook viewers immediately/)
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(
      /in the same words the title uses/,
    )
    // The phrases the drift arrives in.
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(/hold attention/)
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(/keep them watching/)
    // And why nothing is lost by banning them here.
    expect(PACKAGING_ALIGNMENT_PROMPT).toMatch(/retention analysis's own/)
  })
})
