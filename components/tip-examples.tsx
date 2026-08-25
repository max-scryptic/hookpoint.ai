"use client"

import { useEffect, useState } from "react"
import { RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { normaliseTipExamples, type TipExample } from "@/lib/tip-examples"
import { tipFingerprint } from "@/lib/tips"

// The three worked examples inside an opened tip: what the advice looks like
// once it has been carried out, tabbed through by the approach each one takes.
//
// A tip is one line ("Open on the specific claim rather than the setup"), and a
// creator who agrees with it still has to invent the version of it that fits
// their own video. That invention is the work this does for them, in their own
// subject matter, so the tip arrives as something to copy rather than something
// to interpret.
//
// Almost always the examples arrive with the tip, written by the same prompt
// that wrote the advice, and this renders them with nothing to wait for. The
// request below is the fallback for a tip that carries none: a report generated
// before the examples existed, or a deep-analysis tip whose hand-written branch
// has none. That path is a round trip, which is why nothing else in the card
// waits on it: the two actions under this panel are usable while it is still
// loading, and stay usable if it fails.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

// Examples already fetched during this visit, keyed by the tip and the page it
// was read on. Held for the whole page rather than per callout, for the two
// things that would otherwise cost a needless round trip: closing a tip and
// opening it again (the popup unmounts its contents), and the same advice
// appearing on two sections of one report.
const cache = new Map<string, TipExample[]>()

// The requests in flight, so two callouts opened in the same moment share one.
const inFlight = new Map<string, Promise<TipExample[]>>()

function cacheKey(tip: string, path: string): string {
  return `${tipFingerprint(tip)}|${path}`
}

async function requestExamples(
  tip: string,
  section: string,
  sourcePath: string,
): Promise<TipExample[]> {
  const response = await fetch("/api/tips/examples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tip, section, sourcePath }),
  })
  const result = (await response.json().catch(() => ({}))) as {
    examples?: unknown
    error?: string
  }
  if (!response.ok) {
    throw new Error(result.error ?? "Could not load examples for this tip.")
  }
  // Normalised again on arrival: the server holds the same rule, and this is
  // what stops a response shaped differently from rendering an empty strip of
  // tabs with nothing under them.
  const examples = normaliseTipExamples(result.examples)
  if (examples.length === 0) {
    throw new Error("Could not load examples for this tip.")
  }
  return examples
}

function ExamplesSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {/* Three equal tabs, because that is what the strip now holds: the labels
          are "Example 1 / 2 / 3" rather than phrases of differing length. */}
      <div className="flex gap-1">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  )
}

export function TipExamples({
  tip,
  section,
  // The page the tip is being read on, passed in rather than read here so the
  // panel and the two actions beneath it record the same one. It is what the
  // server grounds the examples in: the video behind that report is what the
  // creator makes videos about.
  sourcePath,
  // The examples the report already carries, where it carries them. Almost
  // every tip written now does: the prompt that wrote the advice wrote its
  // examples in the same response, with the transcript, the thumbnail and the
  // evidence still in front of it. Then there is nothing to fetch and nothing
  // to wait for, and the card opens with the examples already in it.
  //
  // The request below is what serves the rest: tips in reports generated before
  // that existed, and the hand-written deep-analysis tips whose examples are
  // written by hand only where a branch has them.
  examples: provided,
}: {
  tip: string
  section: string
  sourcePath: string
  examples?: readonly TipExample[]
}) {
  const key = cacheKey(tip, sourcePath)
  // Bumped by "Try again", which is the whole of retrying: the effect below
  // reruns and asks again. Held apart from the answer so a retry cannot be
  // mistaken for one.
  const [attempt, setAttempt] = useState(0)
  // What the last settled request for this tip answered. Keyed by the tip and
  // the attempt it belongs to, so an answer to an earlier question is ignored
  // rather than shown against a later one.
  const [answer, setAnswer] = useState<{
    key: string
    attempt: number
    examples: TipExample[] | null
    error: string | null
  }>(() => ({ key, attempt: 0, examples: null, error: null }))

  // Anything already fetched this visit is read straight through, which is what
  // makes reopening a tip instant: the popup unmounts its contents on close, so
  // this component is mounted fresh every time and would otherwise ask again.
  const settled = answer.key === key && answer.attempt === attempt
  const carried = provided && provided.length > 0 ? provided : null
  const examples = carried ?? cache.get(key) ?? (settled ? answer.examples : null)
  const error = carried ? null : settled ? answer.error : null

  useEffect(() => {
    // Written with the tip, or already answered above: either way there is
    // nothing to ask for.
    if (carried || cache.has(key)) return

    let active = true
    // Two callouts showing the same advice, opened in the same moment, share
    // one request rather than paying for two.
    let pending = inFlight.get(key)
    if (!pending) {
      pending = requestExamples(tip, section, sourcePath)
      inFlight.set(key, pending)
      const started = pending
      pending
        .then((result) => {
          cache.set(key, result)
        })
        .catch(() => {})
        .finally(() => {
          // Only clear the slot this request owns: a retry may already have
          // replaced it, and clearing that one would strand its followers.
          if (inFlight.get(key) === started) inFlight.delete(key)
        })
    }

    pending
      .then((result) => {
        if (active) setAnswer({ key, attempt, examples: result, error: null })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setAnswer({
          key,
          attempt,
          examples: null,
          error:
            cause instanceof Error
              ? cause.message
              : "Could not load examples for this tip.",
        })
      })

    return () => {
      active = false
    }
  }, [carried, key, attempt, tip, section, sourcePath])

  // Nothing settled and nothing cached: the request is still out. The skeleton
  // is the first paint of every tip opened for the first time.
  if (!examples && !error) return <ExamplesSkeleton />

  if (!examples) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setAttempt((previous) => previous + 1)}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      </div>
    )
  }

  return (
    <Tabs defaultValue="0" className="gap-2.5">
      {/* The tabs are numbered rather than named, in every tip popup on every
          report: a model-written label is a different length and a different
          kind of phrase each time, so a strip of them read differently from one
          card to the next and could push the row into a sideways scroll.
          "Example 1 / 2 / 3" is the same three words everywhere, which leaves
          the strip a place to move between examples rather than something to
          read, and the approach each one takes is said above the example
          itself, where there is room for it. */}
      <TabsList className="max-w-full overflow-x-auto">
        {examples.map((_, index) => (
          <TabsTrigger
            key={index}
            value={String(index)}
            className="px-2 py-1 text-xs"
          >
            Example {index + 1}
          </TabsTrigger>
        ))}
      </TabsList>
      {examples.map((example, index) => (
        <TabsContent key={index} value={String(index)} className="flex flex-col gap-1.5">
          {/* The approach this example takes, in the words the tip was written
              with. It used to be the tab's own label; it reads here instead, as
              a heading over the thing it describes. */}
          <span className="text-xs font-medium text-muted-foreground">
            {example.label}
          </span>
          {/* The rule down the side is what marks this out as the thing itself
              rather than more advice about it: an example is read the way a
              quote is. */}
          <p className="border-l-2 border-blue-500/40 pl-3 text-sm leading-relaxed text-foreground">
            {example.example}
          </p>
        </TabsContent>
      ))}
    </Tabs>
  )
}
