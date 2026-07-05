import { SparklesIcon } from "lucide-react"

export function RecommendationCallout({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm text-foreground">
      <SparklesIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-primary"
      />
      <p className="leading-relaxed">
        <span className="font-semibold text-primary">Try:</span> {children}
      </p>
    </div>
  )
}
