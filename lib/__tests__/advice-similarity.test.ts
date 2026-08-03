import { describe, expect, it } from "vitest"

import { isNearDuplicateAdvice } from "@/lib/advice-similarity"

describe("isNearDuplicateAdvice", () => {
  // The pair that prompted this: a surface tip and the recommendation stacked
  // under it as an "Or:" line, which are one suggestion written twice.
  it("catches a tip and an alternative that restate the same change", () => {
    expect(
      isNearDuplicateAdvice(
        "Make the thumbnail show one outcome at a glance, using a simple before and after or result graphic instead of mixing a scene, a character, and a warning phrase.",
        "Build the thumbnail around one simple before and after or result, with large numbers and one directional cue, instead of combining multiple scene elements.",
      ),
    ).toBe(true)
  })

  it("catches a restatement that only swaps the wording", () => {
    expect(
      isNearDuplicateAdvice(
        "Cut the title to one claim and put the number first.",
        "Trim the title down to a single claim, leading with the number.",
      ),
    ).toBe(true)
  })

  it("catches a short alternative already covered by a longer tip", () => {
    expect(
      isNearDuplicateAdvice(
        "Cut the thumbnail to one subject and one line of text, sized to read at phone width.",
        "Keep the thumbnail to one subject.",
      ),
    ).toBe(true)
  })

  it("treats singulars, plurals and verb endings as the same word", () => {
    expect(
      isNearDuplicateAdvice(
        "Cut the scene down to one shot and drop the extra caption.",
        "Cutting the scenes to a single shot, drop extra captions.",
      ),
    ).toBe(true)
  })

  // The reason the thresholds sit where they do: two tips about one surface
  // share its vocabulary without saying the same thing, and both are worth
  // reading.
  it("keeps two different changes to the same surface", () => {
    expect(
      isNearDuplicateAdvice(
        "Put one number in the title and let the thumbnail carry the face.",
        "Lead the title with the result and keep the thumbnail to one subject.",
      ),
    ).toBe(false)
    expect(
      isNearDuplicateAdvice(
        "Cut the thumbnail text to three words so it reads at phone size.",
        "Drop the thumbnail text entirely and let the face carry the frame.",
      ),
    ).toBe(false)
  })

  it("keeps advice about different surfaces apart", () => {
    expect(
      isNearDuplicateAdvice(
        "Make the thumbnail show one outcome at a glance.",
        "Name the payoff in the first three seconds of the opening.",
      ),
    ).toBe(false)
  })

  it("is not fooled by shared function words alone", () => {
    expect(
      isNearDuplicateAdvice(
        "Open on the claim itself rather than on a greeting.",
        "Hold the shot for a beat before the first cut.",
      ),
    ).toBe(false)
  })

  it("treats a line with nothing but function words as distinct", () => {
    expect(isNearDuplicateAdvice("Do it.", "Open on the claim itself.")).toBe(
      false,
    )
  })
})
