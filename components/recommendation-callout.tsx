import { TryCallout } from "@/components/try-callout"

// Recommendation tips share the borderless "Try:" callout used across the
// retention tabs so the Pacing and Gains suggestions match the rest of the UI.
export function RecommendationCallout({
  children,
  section,
}: {
  children: string
  // Where the recommendation is being read, carried through to the callout so a
  // saved or flagged tip records the part of the report it came from.
  section: string
}) {
  return <TryCallout section={section}>{children}</TryCallout>
}
