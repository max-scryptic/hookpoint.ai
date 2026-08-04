import { SparklesIcon } from "lucide-react"
import type { ReactNode } from "react"

import { TipMenu } from "@/components/tip-menu"
import { isNearDuplicateAdvice } from "@/lib/advice-similarity"
import { cleanCopy } from "@/lib/copy-guardrails"

export function TryCallout({
  children,
  section,
  actions = true,
  alternatives = [],
}: {
  children: ReactNode
  // Where this tip is being read, e.g. "Retention: Drop-off" or
  // "Packaging: Title". Saved alongside the tip, so a checklist line still says
  // what part of a report it came from long after that report is closed, and so
  // a flag tells us which surface keeps producing advice that misses.
  section: string
  // Whether the tip itself is clickable. The menu behind it belongs to the
  // creator reading their own report, so surfaces that show someone else's tips
  // (the admin evidence view) turn it off and render the advice as plain text.
  actions?: boolean
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
  const tip = scrub(children)
  // The tip and the alternatives are written as separate fields by the model,
  // so two of them regularly land on the same advice in different words. Only
  // the first wording of each distinct suggestion is shown: an "Or:" that
  // restates the tip above it, or an earlier "Or:", is dropped rather than
  // stacked under it. Alternatives that are not plain strings are copy this
  // component did not write, so they are left alone.
  const distinctAlternatives: ReactNode[] = []
  for (const alternative of alternatives.map(scrub)) {
    const alreadySaid =
      typeof alternative === "string" &&
      [tip, ...distinctAlternatives].some(
        (said) =>
          typeof said === "string" && isNearDuplicateAdvice(said, alternative),
      )
    if (!alreadySaid) distinctAlternatives.push(alternative)
  }
  return (
    <p className="inline-flex w-fit max-w-full items-start gap-2 text-sm text-blue-600 dark:text-blue-400">
      <SparklesIcon className="mt-0.5 size-4 shrink-0" />
      <span className="flex flex-col gap-1">
        {/* Keep and flag live behind the tip itself. Only advice this
            component scrubbed is clickable: a richer node is someone else's
            copy, and there is no plain text of it to put on a checklist.
            When it is clickable the "Try:" goes inside the tip, so the label
            and the advice wrap as one sentence rather than sitting on
            separate lines. */}
        <span>
          {actions && typeof tip === "string" ? (
            <TipMenu tip={tip} section={section} label="Try:" />
          ) : (
            <>
              <span className="font-medium">Try: </span>
              {tip}
            </>
          )}
        </span>
        {distinctAlternatives.map((alternative, index) => (
          <span key={index}>
            {actions && typeof alternative === "string" ? (
              <TipMenu tip={alternative} section={section} label="Or:" />
            ) : (
              <>
                <span className="font-medium">Or: </span>
                {alternative}
              </>
            )}
          </span>
        ))}
      </span>
    </p>
  )
}
