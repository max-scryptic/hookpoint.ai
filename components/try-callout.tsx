import { SparklesIcon } from "lucide-react"
import type { ReactNode } from "react"

export function TryCallout({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex w-fit max-w-full items-start gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-foreground">
      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
      <span>
        <span className="font-medium text-blue-600 dark:text-blue-400">
          Try:{" "}
        </span>
        {children}
      </span>
    </p>
  )
}
