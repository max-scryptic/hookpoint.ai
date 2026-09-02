"use client"

import { SparklesIcon } from "lucide-react"
import { useCallback, useRef, type ReactNode } from "react"

import { useFirstTipHint } from "@/components/first-tip-hint"
import {
  AnchoredHintCallout,
  HintCallout,
  HintTargetGlow,
} from "@/components/onboarding-hints"
import { TipMenu } from "@/components/tip-menu"
import { cleanCopy } from "@/lib/copy-guardrails"
import type { TipExample } from "@/lib/tip-examples"
import { tipLabelForSection } from "@/lib/tips"

// The one blue tip line, everywhere in the app. Still named for the label it
// wears most of the time, but the label itself is not fixed: a tip about a
// moment that went right is introduced with "Maintain:" rather than "Try:".
// tipLabelForSection (lib/tips.ts) is where that is decided and why.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.
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
  const clickable = actions && typeof tip === "string"
  // A report shows the coach mark on its first clickable tip and nowhere else.
  // Every tip offers itself; the provider (components/first-tip-hint.tsx) picks
  // the one that comes first in the page, and all the others get `shown: false`
  // and render exactly as they always have.
  const {
    ref: registerTip,
    shown: showTipHint,
    dismiss: dismissTipHint,
  } = useFirstTipHint(clickable)
  // The same box the provider ranks, kept here as well because that is what the
  // bubble hangs off. Merged into one ref callback rather than two, since an
  // element takes one ref: it fills this in, registers the tip, and undoes both
  // when the tip goes.
  const tipBoxRef = useRef<HTMLParagraphElement>(null)
  const tipBoxCallbackRef = useCallback(
    (node: HTMLParagraphElement | null) => {
      tipBoxRef.current = node
      const unregister = registerTip(node)
      return () => {
        tipBoxRef.current = null
        unregister?.()
      }
    },
    [registerTip],
  )
  // One tip and one only, everywhere in the app. A section that has more advice
  // to give holds it back rather than stacking a second line under this one: two
  // suggestions at once read as padding, and the reader has to work out which of
  // them is the one to act on.
  return (
    <p
      // The whole line is what the mark is drawn around and what the bubble
      // hangs off, rather than the advice alone: an inline run that wraps
      // mid-sentence has no box to ring, and the sparkle in front of it is part
      // of what a creator is being pointed at.
      ref={tipBoxCallbackRef}
      className="relative inline-flex w-fit max-w-full items-start gap-2 text-sm text-blue-600 dark:text-blue-400"
    >
      <SparklesIcon className="mt-0.5 size-4 shrink-0" />
      {/* Keep and flag live behind the tip itself. Only advice this component
          scrubbed is clickable: a richer node is someone else's copy, and there
          is no plain text of it to put on a checklist. When it is clickable the
          label goes inside the tip, so the label and the advice wrap as one
          sentence rather than sitting on separate lines. */}
      <span>
        {clickable ? (
          <TipMenu
            tip={tip as string}
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
      {/* Held a hair off the text on every side, so the ring reads as something
          drawn around the line rather than as a border the tip has grown. */}
      <HintTargetGlow shown={showTipHint} className="-inset-1" />
      {showTipHint && (
        <AnchoredHintCallout anchorRef={tipBoxRef}>
          <HintCallout
            title="Tips open up"
            arrow={{ side: "top", align: "end" }}
            onDismiss={dismissTipHint}
          >
            Click the advice for three worked examples of it, and to keep it on
            your checklist.
          </HintCallout>
        </AnchoredHintCallout>
      )}
    </p>
  )
}
