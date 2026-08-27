import { TryCallout } from "@/components/try-callout"
import type { TipExample } from "@/lib/tip-examples"

// Recommendation tips share the borderless callout used across the retention
// tabs so the Pacing and Gains suggestions match the rest of the UI, label
// included: the callout works its own out from the section it is given.
export function RecommendationCallout({
  children,
  section,
  examples,
}: {
  children: string
  // Where the recommendation is being read, carried through to the callout so a
  // saved or flagged tip records the part of the report it came from.
  section: string
  // The worked examples the pacing pass wrote alongside this suggestion, where
  // the stored analysis carries them.
  examples?: readonly TipExample[]
}) {
  return (
    <TryCallout section={section} examples={examples}>
      {children}
    </TryCallout>
  )
}
