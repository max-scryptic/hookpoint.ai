import { SparklesIcon } from "lucide-react"
import type { ReactNode } from "react"

import { TipMenu } from "@/components/tip-menu"
import { cleanCopy } from "@/lib/copy-guardrails"
import type { TipExample } from "@/lib/tip-examples"
import { tipLabelForSection } from "@/lib/tips"

// The one blue tip line, everywhere in the app. Still named for the label it
// wears most of the time, but the label itself is not fixed: a tip about a
// moment that went right is introduced with "Maintain:" rather than "Try:".
// tipLabelForSection (lib/tips.ts) is where that is decided and why.
export function TryCallout({
  children,
  section,
  examples,
  actions = true,
}: {
  children: ReactNode
  // Where this tip is being read, e.g. "Retention: Drop-off" or
  // "Packaging: Title". Saved alongside the tip, so a checklist line still says
  // what part of a report it came from long after that report is closed, and so
  // a flag tells us which surface keeps producing advice that misses. It also
  // decides the label the tip is read behind.
  section: string
  // The worked examples this tip was written with, where the report carries
  // them: the prompt that wrote the advice wrote three demonstrations of it in
  // the same response. Passed straight through to the card behind the tip,
  // which falls back to asking for them when a report predates them.
  examples?: readonly TipExample[]
  // Whether the tip itself is clickable. The menu behind it belongs to the
  // creator reading their own report, so surfaces that show someone else's tips
  // (the admin evidence view) turn it off and render the advice as plain text.
  actions?: boolean
}) {
  // Every tip funnels through here, so this is the one place to scrub
  // model-written copy of leaked JSON artifacts, em dashes, stray whitespace
  // and the openers the label in front of it already says ("Try ...", "Next
  // time, ...") before a user reads it. String children are the model-written
  // tips; any richer node is passed through untouched.
  const tip = typeof children === "string" ? cleanCopy(children) : children
  // "Try:" on advice about a weakness, "Maintain:" on a moment that already
  // worked. Both are one word and a colon, so a row keeps the same shape
  // whichever it gets.
  const label = `${tipLabelForSection(section)}:`
  // One tip and one only, everywhere in the app. A section that has more advice
  // to give holds it back rather than stacking a second line under this one: two
  // suggestions at once read as padding, and the reader has to work out which of
  // them is the one to act on.
  return (
    <p className="inline-flex w-fit max-w-full items-start gap-2 text-sm text-blue-600 dark:text-blue-400">
      <SparklesIcon className="mt-0.5 size-4 shrink-0" />
      {/* Keep and flag live behind the tip itself. Only advice this component
          scrubbed is clickable: a richer node is someone else's copy, and there
          is no plain text of it to put on a checklist. When it is clickable the
          label goes inside the tip, so the label and the advice wrap as one
          sentence rather than sitting on separate lines. */}
      <span>
        {actions && typeof tip === "string" ? (
          <TipMenu
            tip={tip}
            section={section}
            examples={examples}
            label={label}
          />
        ) : (
          <>
            <span className="font-medium">{label} </span>
            {tip}
          </>
        )}
      </span>
    </p>
  )
}
