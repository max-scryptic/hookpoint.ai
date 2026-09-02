import { describe, expect, it } from "vitest"

import {
  earliestInDocument,
  type DocumentPositioned,
} from "@/lib/first-tip-order"

// A stand-in for a tip's box on the page. `position` is where it sits in the
// document, and comparing two of them answers the same question a real node's
// compareDocumentPosition does: the mask carries DOCUMENT_POSITION_PRECEDING
// (2) when the element passed in comes before this one.
class FakeTip implements DocumentPositioned {
  isConnected = true

  constructor(readonly position: number) {}

  compareDocumentPosition(other: this): number {
    if (other.position === this.position) return 0
    return other.position < this.position ? 2 : 4
  }
}

describe("earliestInDocument", () => {
  it("picks the tip that comes first in the page, whatever order it is offered in", () => {
    const packaging = new FakeTip(1)
    const dropOff = new FakeTip(2)
    const pacing = new FakeTip(3)

    // Tips register as they mount, which is not the order they are read in: a
    // list brought forward by a tab switch registers long after the sections
    // above it.
    expect(earliestInDocument([pacing, packaging, dropOff])).toBe(packaging)
    expect(earliestInDocument([dropOff, pacing, packaging])).toBe(packaging)
    expect(earliestInDocument([packaging, dropOff, pacing])).toBe(packaging)
  })

  // A tab switch takes a whole list of tips off the page. React's ref cleanup
  // is what unregisters them, and a set read before that has run must not hand
  // back a box that is no longer on screen.
  it("passes over a tip that has left the page", () => {
    const packaging = new FakeTip(1)
    const dropOff = new FakeTip(2)
    packaging.isConnected = false

    expect(earliestInDocument([packaging, dropOff])).toBe(dropOff)
  })

  it("has nothing to point at when no tip is left", () => {
    const gone = new FakeTip(1)
    gone.isConnected = false

    expect(earliestInDocument([])).toBeNull()
    expect(earliestInDocument([gone])).toBeNull()
  })

  it("handles a single tip", () => {
    const only = new FakeTip(7)
    expect(earliestInDocument([only])).toBe(only)
  })
})
