import {
  comparabilityNote,
  type ComparisonQuestion,
  type PairComparability,
} from "@/lib/comparison-comparability"

// The line a written head-to-head shows above itself when its pair carries no
// usable performance anchor: one of the two videos was barely watched, or the
// two were reached by different enough traffic that their watch figures cannot
// be read against each other.
//
// It exists so the reader knows why nothing on the page crowns a winner. A
// report that quietly stops ranking looks like a report that got vaguer, and
// the tips underneath it read as weaker advice rather than as more honest
// advice; naming the reason is what turns that around.
//
// Renders nothing for an anchored pair, and nothing for a report stored before
// its tab carried a verdict at all, so an older report is never captioned with
// a limit it was not written under. The wording lives in
// lib/comparison-comparability.ts beside the verdict it describes, so the copy
// and the rule cannot drift apart, and so both tabs say it identically. Styled
// to match the reliability note on the Retention tab
// (components/retention-comparison.tsx), which says the same kind of thing
// about the same pair.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

export function ComparabilityNote({
  comparability,
  // Which question this tab is asking. The Script tab asks whether one video
  // held its audience better, the Packaging tab whether one earned the click
  // better, and the same pair can be readable on one and not the other, so each
  // tab shows the note for its own question rather than a shared one.
  question,
}: {
  comparability: PairComparability | undefined
  question: ComparisonQuestion
}) {
  const note =
    comparability != null ? comparabilityNote(comparability, question) : null
  if (note == null) return null
  return (
    <p className="rounded-r-md border-l-2 border-l-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
      {note}
    </p>
  )
}
