// Which of the tips currently on a report comes first in the page.
//
// The report's "click the tip" coach mark goes on the first tip a creator
// reads, and no call site knows which tip that is: a report's advice comes from
// a dozen nested sections, each rendered only where the analysis had something
// to say, with tabs mounting and unmounting whole lists as they are switched.
// So the tips hand their own boxes to components/first-tip-hint.tsx and this
// picks the winner off the one thing that actually answers "first": their
// position in the document.
//
// Mount order would not do it. Every tip on a report mounts in the same commit,
// and a list brought forward by a tab switch mounts long after the sections
// above it - "the tip that registered first" and "the tip read first" are two
// different tips the moment anything on the page moves.

// The little of an element this rule needs, so it can be exercised without a
// DOM. Both members are the standard ones: `isConnected` is false for a node
// that has been taken out of the page, and `compareDocumentPosition` returns a
// mask that carries DOCUMENT_POSITION_PRECEDING (2) when the argument comes
// before the node it is called on.
export interface DocumentPositioned {
  isConnected: boolean
  compareDocumentPosition(other: this): number
}

// Node.DOCUMENT_POSITION_PRECEDING. Spelled out rather than read off `Node`,
// which does not exist on the server or under the test runner.
const PRECEDING = 2

// The earliest of `elements` in document order, ignoring any that have since
// left the page, or null when none are left. Order of iteration does not
// matter: every element is compared against the best so far.
export function earliestInDocument<T extends DocumentPositioned>(
  elements: Iterable<T>,
): T | null {
  let earliest: T | null = null
  for (const element of elements) {
    if (!element.isConnected) continue
    if (
      earliest === null ||
      (earliest.compareDocumentPosition(element) & PRECEDING) !== 0
    ) {
      earliest = element
    }
  }
  return earliest
}
