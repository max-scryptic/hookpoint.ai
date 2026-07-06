import { SparklesIcon } from "lucide-react"
import type { ReactNode } from "react"

export function TryCallout({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex w-fit max-w-full items-start gap-2 text-sm text-blue-600 dark:text-blue-400">
      <SparklesIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="font-medium">Try:{" "}</span>
        {children}
      </span>
    </p>
  )
}
