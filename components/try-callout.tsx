import { SparklesIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cleanCopy } from "@/lib/copy-guardrails"

export function TryCallout({
  children,
  alternatives = [],
}: {
  children: ReactNode
  // The other things worth trying at this point, rendered as "Or:" lines under
  // the tip. Callers that only have one suggestion leave this out.
  alternatives?: ReactNode[]
}) {
  // Every "Try:" tip funnels through here, so this is the one place to scrub
  // model-written copy of leaked JSON artifacts, em dashes and stray whitespace
  // before a user reads it. String children are the model-written tips; any
  // richer node is passed through untouched.
  const scrub = (node: ReactNode) =>
    typeof node === "string" ? cleanCopy(node) : node
  return (
    <p className="inline-flex w-fit max-w-full items-start gap-2 text-sm text-blue-600 dark:text-blue-400">
      <SparklesIcon className="mt-0.5 size-4 shrink-0" />
      <span className="flex flex-col gap-1">
        <span>
          <span className="font-medium">Try:{" "}</span>
          {scrub(children)}
        </span>
        {alternatives.map((alternative, index) => (
          <span key={index}>
            <span className="font-medium">Or:{" "}</span>
            {scrub(alternative)}
          </span>
        ))}
      </span>
    </p>
  )
}
