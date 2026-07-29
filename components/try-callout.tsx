import { SparklesIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cleanCopy } from "@/lib/copy-guardrails"

export function TryCallout({ children }: { children: ReactNode }) {
  // Every "Try:" tip funnels through here, so this is the one place to scrub
  // model-written copy of leaked JSON artifacts, em dashes and stray whitespace
  // before a user reads it. String children are the model-written tips; any
  // richer node is passed through untouched.
  const content = typeof children === "string" ? cleanCopy(children) : children
  return (
    <p className="inline-flex w-fit max-w-full items-start gap-2 text-sm text-blue-600 dark:text-blue-400">
      <SparklesIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="font-medium">Try:{" "}</span>
        {content}
      </span>
    </p>
  )
}
