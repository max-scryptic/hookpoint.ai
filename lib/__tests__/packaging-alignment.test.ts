import { describe, expect, it } from "vitest"

import { prioritizePackagingImprovements } from "@/lib/packaging-alignment"

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
