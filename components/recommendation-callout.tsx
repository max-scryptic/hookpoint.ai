import { TryCallout } from "@/components/try-callout"

// Recommendation tips share the borderless "Try:" callout used across the
// retention tabs so the Pacing and Gains suggestions match the rest of the UI.
export function RecommendationCallout({ children }: { children: string }) {
  return <TryCallout>{children}</TryCallout>
}
